#!/usr/bin/env node
// Headless WebGPU capture of CONSECUTIVE frames at a fixed time step (for motion and jitter checks; capture.mjs settles and takes single shots).
//
//   node scripts/gpu/step-frames.mjs --url "http://localhost:5231/hzd/?view=ground&pitch=-35&motion=20&clean=1" --out work/captures/SH1/old \
//        --warm 150 --frames 40 --setup "__tune.set('shadow.advect', false)"
//
// The page's clock is replaced before it loads: performance.now() and the requestAnimationFrame timestamp advance by exactly 1/fps per frame, and after
// the page is ready the frame loop is held and released one frame at a time, so frame i is the same moment in every run. --setup is evaluated once the
// page is ready (before the warm-up frames); --windOffset sets the renderer's wind offset (m, "x,y,z") after the warm-up so runs line up.
// Writes <out>/f000.png ... and capture.json (frame count, wind offsets per frame). Our own renders only.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { CDP } from './cdp.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : fallback; };
const root = resolve(new URL('../..', import.meta.url).pathname);
const url = opt('url');
const out = resolve(root, opt('out', 'work/captures/scratch'));
const [width, height] = opt('size', '960x540').split('x').map(Number);
const warm = Number(opt('warm', 150)), frames = Number(opt('frames', 40)), fps = Number(opt('fps', 60));
const shot = opt('shot', '')                    // a bookmark name (a view, with @ variants) applied once ready
const probe = opt('probe', '')                  // JS evaluated after the warm-up; its value is printed
const setup = opt('setup', ''), windOffset = opt('windOffset', '');
const every = Number(opt('every', 1));          // capture every n-th frame (the loop still steps one frame at a time)
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!url) { console.error('--url is required'); process.exit(2); }

const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(100); }
  throw new Error(`Timed out waiting for ${what}`);
}

const clock = `(() => {
  const STEP = 1000 / ${fps};
  let vt = 1000, hold = false, allow = 0, nextId = 0, pending = [];
  const realRaf = window.requestAnimationFrame.bind(window);
  performance.now = () => vt;
  window.requestAnimationFrame = cb => { const id = ++nextId; pending.push([id, cb]); return id; };
  window.cancelAnimationFrame = id => { pending = pending.filter(x => x[0] !== id); };
  const tick = () => {
    if (!hold || allow > 0) {
      if (hold) allow--;
      vt += STEP;
      const list = pending; pending = [];
      for (const [, cb] of list) { try { cb(vt); } catch (e) { console.error(e); } }
    }
    realRaf(tick);
  };
  realRaf(tick);
  // WebGPU errors and device loss go to the console (the script prints them).
  const reqDev = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = async function (...a) {
    const d = await reqDev.apply(this, a);
    d.addEventListener('uncapturederror', e => console.error('WebGPU uncaptured: ' + e.error.message.slice(0, 500)));
    d.lost.then(i => console.error('WebGPU device lost: ' + i.reason + ' ' + i.message));
    return d;
  };
  window.__step = { hold: v => { hold = v; }, go: n => { allow += n; }, get left() { return allow; } };
})();`;

const children = [];
const cleanup = () => { for (const c of children) try { c.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(130); });

const debugPort = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'clouds-chrome-'));
const browser = spawn(chrome, [
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  `--window-size=${width},${height}`, '--headless=new', 'about:blank',
], { stdio: 'ignore' });
children.push(browser);

let failed = false;
const report = { url, size: [width, height], warm, frames, fps, setup, windOffset, wind: [], errors: [] };
try {
  const page = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t => t.type === 'page'), 15000, 'Chrome');
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: clock });
  await cdp.send('Page.navigate', { url });
  const ev = expr => cdp.evaluate(expr);
  await waitFor(() => ev(`(() => { const c = window.__clouds; if (!c) return null; if (c.error) return { error: String(c.error) }; return c.ready ? { ok: true } : null; })()`), 90000, 'window.__clouds.ready');
  const run = async n => { await ev(`window.__step.go(${n})`); await waitFor(() => ev('window.__step.left === 0'), 120000, 'frames'); await sleep(60); };
  await ev('window.__step.hold(true)');
  if (shot) await ev(`window.__clouds.bookmark(${JSON.stringify(shot)})`);
  if (setup) await ev(setup);
  await run(warm);
  if (probe) console.log('probe:', JSON.stringify(await ev(probe)));
  if (windOffset) { await ev(`__tune.set('c.windOffset', [${windOffset}])`); }
  mkdirSync(out, { recursive: true });
  for (let i = 0; i < frames; i++) {
    await run(1);
    if (i % every !== 0) continue;
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, 60000);
    writeFileSync(join(out, `f${String(i).padStart(3, '0')}.png`), Buffer.from(data, 'base64'));
  }
  for (const e of cdp.events) {
    if (e.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(e.params.type)) { const t = e.params.args.map(a => a.value ?? a.description).join(' '); if (!/state\.gl|backwards/.test(t)) report.errors.push(`${e.params.type}: ${t.slice(0, 600)}`); }
    if (e.method === 'Log.entryAdded' && ['error', 'warning'].includes(e.params.entry.level) && !String(e.params.entry.url ?? '').endsWith('favicon.ico')) report.errors.push(`log: ${String(e.params.entry.text).slice(0, 600)}`);
    if (e.method === 'Runtime.exceptionThrown') report.errors.push(e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
  }
  report.info = await ev(`(() => { const t = window.__tune; return t && t.snapshot ? Object.keys(t.snapshot().settings).length : null; })()`).catch(() => null);
  cdp.close();
} catch (error) {
  report.errors.push(error.message); failed = true;
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'capture.json'), JSON.stringify(report, null, 2));
if (report.errors.length) console.error(report.errors.join('\n'));
console.log(failed ? 'FAILED' : 'OK', out);
cleanup();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
process.exit(failed ? 1 : 0);
