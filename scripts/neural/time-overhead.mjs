#!/usr/bin/env node
// N1b: where does a HaloRT demo frame go? Wall time per stage with the pipeline forced serial, CPU encode time of the network
// stage, and per-frame counts of compute passes / dispatches / setBindGroup / setPipeline. Injected script only; demo files untouched.
//   node scripts/neural/time-overhead.mjs --base http://127.0.0.1:8765 --out work/captures/N1b
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { CDP } from '../gpu/cdp.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const base = opt('base', 'http://127.0.0.1:8765');
const out = resolve(opt('out', 'work/captures/N1b'));
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
mkdirSync(out, { recursive: true });
const debugPort = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'n1b-chrome-'));
const browser = spawn(chrome, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-webgpu-developer-features', '--disable-dawn-features=disallow_unsafe_apis',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=1100,900', '--headless=new', 'about:blank'], { stdio: 'ignore' });
const hard = setTimeout(() => { browser.kill('SIGKILL'); process.exit(2); }, 10 * 60 * 1000);

const INJECT = `(() => {
  const P = { frames: [], cur: null, n: { passes: 0, dispatches: 0, setBindGroup: 0, setPipeline: 0 }, dev: null };
  window.__P = P; window.__serial = false;
  const rd = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = async function (d) { const dev = await rd.call(this, d); P.dev = dev; return dev; };
  const bcp = GPUCommandEncoder.prototype.beginComputePass;
  const markOf = new WeakMap(), cbMark = new WeakMap();
  GPUCommandEncoder.prototype.beginComputePass = function (d) {
    P.n.passes++;
    if (d && d.timestampWrites) markOf.set(this, d.timestampWrites.beginningOfPassWriteIndex);
    return bcp.call(this, d);
  };
  const fin = GPUCommandEncoder.prototype.finish;
  GPUCommandEncoder.prototype.finish = function (d) { const cb = fin.call(this, d); if (markOf.has(this)) cbMark.set(cb, markOf.get(this)); return cb; };
  for (const [m, k] of [['setPipeline', 'setPipeline'], ['setBindGroup', 'setBindGroup'], ['dispatchWorkgroups', 'dispatches'], ['dispatchWorkgroupsIndirect', 'dispatches']]) {
    const f = GPUComputePassEncoder.prototype[m];
    GPUComputePassEncoder.prototype[m] = function (...a) { P.n[k]++; return f.apply(this, a); };
  }
  const sub = GPUQueue.prototype.submit;
  GPUQueue.prototype.submit = function (cbs) {
    const t = performance.now();
    let mk = -1; for (const cb of cbs) if (cbMark.has(cb)) mk = cbMark.get(cb);
    if (mk === 0) { P.cur = { t0: t, n0: { ...P.n }, done: {} }; }
    const r = sub.call(this, cbs);
    if (mk >= 0 && P.cur) {
      const f = P.cur;
      f['s' + mk] = t; f['n' + mk] = { ...P.n };
      this.onSubmittedWorkDone().then(() => { f.done[mk] = performance.now(); if (mk === 3) P.frames.push(f); });
    }
    return r;
  };
  const pm = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (m, ...r) {
    if (window.__serial && P.dev && m === 0) { P.dev.queue.onSubmittedWorkDone().then(() => pm.call(this, m, ...r)); return; }
    return pm.call(this, m, ...r);
  };
})();`;

const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const summarize = frames => {
  const f = frames.slice(-20);
  const d = k => f.map(x => k(x));
  const net = x => x.n2.passes - x.n1.passes - 1; // minus mark(2)'s own empty pass
  return {
    n: f.length,
    featuresWall: med(d(x => x.done[1] - x.t0)), networkWall: med(d(x => x.done[2] - x.done[1])), accumWall: med(d(x => x.done[3] - x.done[2])),
    frameWall: med(d(x => x.done[3] - x.t0)),
    interval: f.length > 1 ? (f.at(-1).done[3] - f[0].done[3]) / (f.length - 1) : null,
    networkEncodeCpu: med(d(x => x.s2 - x.s1)),
    passes: med(d(net)), dispatches: med(d(x => x.n2.dispatches - x.n1.dispatches)),
    setBindGroup: med(d(x => x.n2.setBindGroup - x.n1.setBindGroup)), setPipeline: med(d(x => x.n2.setPipeline - x.n1.setPipeline)),
  };
};
const results = [];
try {
  const dbg = `http://127.0.0.1:${debugPort}`;
  for (let i = 0; i < 100; i++) { try { await fetch(dbg + '/json/version'); break; } catch { await sleep(150); } }
  const page = (await (await fetch(dbg + '/json/list')).json()).find(t => t.type === 'page');
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  const ev = (e, t = 60000) => cdp.evaluate(e, t);
  await cdp.send('Page.navigate', { url: `${base}/halort/index.html` });
  await sleep(3000);
  for (let i = 0; i < 200 && !(await ev(`document.getElementById('stats')?.textContent.includes('features')`)); i++) await sleep(300);
  // [prec, serial, replay]
  const runs = [['fp16', false, true], ['fp16', true, true], ['fp32', true, true], ['fp16', true, false]];
  for (const [prec, serial, replay] of runs) {
    await ev(`(() => { window.__serial = ${serial};
      const s = document.getElementById('maxSpp'); s.max = 100000; s.value = 100000; s.dispatchEvent(new Event('input'));
      const r = document.getElementById('resolution'); r.value = '512'; r.dispatchEvent(new Event('input'));
      const p = document.getElementById('precision'); p.value = '${prec}'; p.dispatchEvent(new Event('input'));
      const c = document.getElementById('replay'); c.checked = ${replay}; c.dispatchEvent(new Event('input'));
      window.__P.frames.length = 0; })()`);
    await sleep(2000);
    await ev(`window.__P.frames.length = 0`);
    let n = 0;
    for (let i = 0; i < 240 && n < 25; i++) { await sleep(500); n = await ev(`window.__P.frames.length`); }
    const frames = JSON.parse(await ev(`JSON.stringify(window.__P.frames)`));
    const r = { prec, serial, replay, res: 512, ...summarize(frames) };
    results.push(r); console.error(JSON.stringify(r));
  }
  cdp.close();
} finally { clearTimeout(hard); browser.kill('SIGKILL'); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
writeFileSync(join(out, 'overhead.json'), JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
