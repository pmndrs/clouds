#!/usr/bin/env node
// W2: a LIVE weather transition on the HZD bench, screenshots every --every ms (default 700) while it runs, plus the scheduler's progress, to
// check there is no pop (compare consecutive frames). Not a deterministic capture: see capture.mjs with the bookmark variant wx:<from>:<to>:<t>.
//   node scripts/gpu/w2-transition.mjs --url "http://127.0.0.1:5247/hzd/?view=high&hz_ndfMotion=static&wx=clear" --to overcast --seconds 10 --out work/captures/W2/c-live
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { CDP } from './cdp.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const url = opt('url'), to = opt('to', 'overcast'), seconds = Number(opt('seconds', 10)), every = Number(opt('every', 700));
const [width, height] = opt('size', '960x540').split('x').map(Number);
const out = resolve(opt('out', 'work/captures/W2/c-live'));
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
async function waitFor(fn, ms) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(150); } throw new Error('timeout'); }

const port = await freePort();
const browser = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'clouds-chrome-'))}`, '--no-first-run', '--enable-unsafe-webgpu',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--window-size=${width},${height}`, '--headless=new', 'about:blank'], { stdio: 'ignore' });
try {
  const page = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'), 15000);
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url });
  await waitFor(() => cdp.evaluate('window.__clouds && window.__clouds.ready && window.__weather ? true : null'), 90000);
  await cdp.evaluate('window.__clouds.settle(150)');
  // --eval '<expr>' or --evalfile <js>: run a page expression and print its result; --shot <file.jpg>: then screenshot (after --settle frames) and stop.
  const expr = opt('evalfile') ? (await import('node:fs')).readFileSync(opt('evalfile'), 'utf8') : opt('eval');
  if (expr) {
    console.log(JSON.stringify(await cdp.evaluate(expr)));
    if (opt('shot')) { await cdp.evaluate(`window.__clouds.settle(${Number(opt('settle', 150))})`); const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 }); writeFileSync(resolve(opt('shot')), Buffer.from(data, 'base64')); }
    cdp.close(); process.exit(0);
  }
  mkdirSync(out, { recursive: true });
  const log = [];
  const shot = async name => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
    writeFileSync(join(out, `${name}.jpg`), Buffer.from(data, 'base64'));
    const st = await cdp.evaluate('window.__weather.state()');
    log.push({ name, t: Date.now(), progress: st.progress });
  };
  await shot('00-before');
  await cdp.evaluate(`window.__weather.go(${JSON.stringify(to)}, ${seconds})`);
  const start = Date.now();
  for (let i = 1; Date.now() - start < (seconds + 2) * 1000; i++) { await shot(String(i).padStart(2, '0')); await sleep(every); }
  writeFileSync(join(out, 'live.json'), JSON.stringify(log, null, 1));
  console.log(`${log.length} frames -> ${out}`);
  cdp.close();
} finally { browser.kill('SIGTERM'); }
