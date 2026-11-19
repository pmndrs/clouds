#!/usr/bin/env node
// Headless WebGPU capture: renders a lab page in Chrome, collects its timing report and screenshots.
//
//   node scripts/gpu/capture.mjs --serve --page flagship/ --shots ground,inside --out work/captures/P0-03
//
// Page contract (window.__clouds): { ready: boolean, error?: string, bookmark?(name): Promise,
// settle?(frames): Promise, report?(): object }. See work/README.md.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { CDP } from './cdp.mjs';

const argv = process.argv.slice(2);
const flag = name => argv.includes('--' + name);
const opt = (name, fallback) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : fallback; };
if (flag('help')) {
  console.log(`--page <path>       lab page under examples/lab (default flagship/)
--url <url>         full URL instead of --page (no --serve needed)
--query <q>         extra query string, e.g. "cloud=parkouring&quality=high"
--shots a,b         bookmark names; each is applied, settled and captured (default: current view)
--size WxH          viewport in CSS px at DPR 1 (default 1920x1080)
--settle <frames>   frames to wait after load/bookmark (default 90)
--out <dir>         output directory (default work/captures/scratch)
--format jpeg|png   screenshot format (default jpeg)
--quality <n>       jpeg quality (default 88; 100 for judged crops: q88's 8x8 blocking reads as contour banding at 1:1)
--serve             start the vite dev server for the run
--headed            show the browser window
--timeout <s>       ready timeout in seconds (default 60)
--no-contract       page has no window.__clouds: stub it after load and just settle frames`);
  process.exit(0);
}
const root = resolve(new URL('../..', import.meta.url).pathname);
const out = resolve(root, opt('out', 'work/captures/scratch'));
const [width, height] = opt('size', '1920x1080').split('x').map(Number);
const settleFrames = Number(opt('settle', 90));
const format = opt('format', 'jpeg');
const quality = Number(opt('quality', 88));
const timeoutMs = Number(opt('timeout', 60)) * 1000;
const shots = (opt('shots', '') || '').split(',').filter(Boolean);
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(150); }
  throw new Error(`Timed out waiting for ${what}`);
}

const children = [];
const cleanup = () => { for (const c of children) try { c.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(130); });

let url = opt('url');
if (!url) {
  let base = 'http://127.0.0.1:5173';
  if (flag('serve')) {
    const port = await freePort();
    const vite = spawn(join(root, 'node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CLOUDS_NO_WATCH: '1' } }); // no hot reload mid-capture
    children.push(vite);
    let log = ''; vite.stdout.on('data', d => { log += d; }); vite.stderr.on('data', d => { log += d; });
    base = `http://127.0.0.1:${port}`;
    await waitFor(async () => (await fetch(base + '/')).ok, 30000, 'vite dev server').catch(e => { console.error(log); throw e; });
  }
  const query = opt('query', '');
  url = `${base}/${opt('page', 'flagship/')}${query ? '?' + query : ''}`;
}

const debugPort = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'clouds-chrome-'));
const browser = spawn(chrome, [
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  `--window-size=${width},${height}`, ...(flag('headed') ? [] : ['--headless=new']), 'about:blank',
], { stdio: 'ignore' });
children.push(browser);

const report = { url, size: [width, height], startedAt: new Date().toISOString(), shots: [], console: [], errors: [] };
let failed = false;
try {
  const page = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t => t.type === 'page'), 15000, 'Chrome');
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url });
  const eval_ = expr => cdp.evaluate(expr);
  // --no-contract: pages without window.__clouds (the legacy labs) get a stub once the document has loaded, then the usual frame settle.
  if (flag('no-contract')) await waitFor(() => eval_(`document.readyState === 'complete' && (window.__clouds ??= { ready: true }, true)`), timeoutMs, 'document load');
  const ready = await waitFor(() => eval_(`(() => { const c = window.__clouds; if (!c) return null; if (c.error) return { error: String(c.error) }; return c.ready ? { ok: true } : null; })()`), timeoutMs, 'window.__clouds.ready')
    .catch(e => ({ error: e.message }));
  report.gpu = await eval_(`(async () => { const a = await navigator.gpu?.requestAdapter(); return a ? { vendor: a.info?.vendor, architecture: a.info?.architecture } : null; })()`).catch(() => null);
  if (ready.error) throw new Error('Page did not become ready: ' + ready.error);
  const settle = `(async () => { const c = window.__clouds; if (c.settle) return c.settle(${settleFrames}); for (let i = 0; i < ${settleFrames}; i++) await new Promise(r => requestAnimationFrame(r)); })()`;
  mkdirSync(out, { recursive: true });
  const seen = new Map();
  for (const shot of shots.length ? shots : ['view']) {
    const n = (seen.get(shot) ?? 0) + 1; seen.set(shot, n);
    const fileName = n > 1 ? `${shot}-${n}` : shot; // repeated shots (e.g. flicker checks) keep separate files
    if (shot !== 'view') await eval_(`window.__clouds.bookmark ? window.__clouds.bookmark(${JSON.stringify(shot)}) : Promise.reject(new Error('page has no bookmark()'))`);
    await eval_(settle);
    const pageReport = await eval_(`(() => { const c = window.__clouds; return c.report ? c.report() : null; })()`);
    // PNG at 4k (a dithered frame compresses slowly) can take well over the default 45 s.
    const { data } = await cdp.send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality } : {}) }, format === 'png' ? 240000 : 45000);
    const file = join(out, `${fileName}.${format === 'jpeg' ? 'jpg' : 'png'}`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    report.shots.push({ name: fileName, file: file.slice(root.length + 1), report: pageReport });
    console.log(`captured ${shot} -> ${file.slice(root.length + 1)}${pageReport?.gpuMs ? '  gpu ' + JSON.stringify(pageReport.gpuMs) : ''}`);
  }
  for (const e of cdp.events) {
    if (e.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(e.params.type)) report.console.push(`${e.params.type}: ${e.params.args.map(a => a.value ?? a.description).join(' ')}`);
    if (e.method === 'Runtime.exceptionThrown') report.errors.push(e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
    if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && !String(e.params.entry.url ?? '').endsWith('favicon.ico')) report.console.push('log: ' + e.params.entry.text);
  }
  failed = report.errors.length > 0 || report.console.some(l => l.startsWith('error'));
  cdp.close();
} catch (error) {
  report.errors.push(error.message); failed = true;
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'capture.json'), JSON.stringify(report, null, 2));
if (report.errors.length || report.console.length) console.error([...report.errors, ...report.console].join('\n'));
console.log(failed ? 'FAILED' : 'OK', '->', join(out, 'capture.json').slice(root.length + 1));
cleanup();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
process.exit(failed ? 1 : 0);
