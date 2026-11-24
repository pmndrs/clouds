#!/usr/bin/env node
// N1: time the HaloRT authors' WebGPU demo (rendervous/rdv_on_the_web) in headless Chrome on the real GPU.
//   node scripts/neural/time-demo.mjs --base http://127.0.0.1:8765 --out work/captures/N1
// The demo folder is untrusted third-party code, served as static files by the caller. Reads the page's own stats overlay
// (GPU timestamps) after ~60 frames per configuration and prints a JSON table.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { CDP } from '../gpu/cdp.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const base = opt('base', 'http://127.0.0.1:8765');
const out = resolve(opt('out', 'work/captures/N1'));
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
mkdirSync(out, { recursive: true });

const debugPort = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'n1-chrome-'));
const browser = spawn(chrome, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-webgpu-developer-features', '--disable-dawn-features=disallow_unsafe_apis',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=1100,900', '--headless=new', 'about:blank'], { stdio: 'ignore' });
const hard = setTimeout(() => { browser.kill('SIGKILL'); process.exit(2); }, 14 * 60 * 1000); // guard: whole run
const parse = text => {
  const g = (label) => { const m = text.match(new RegExp(label + '\\s+(?:-|[\\d.]+) ms\\s+avg ([\\d.]+)')); return m ? Number(m[1]) : null; };
  const iv = text.match(/frame interval ([\d.]+) ms/);
  return { features: g('features \\(rdv\\)'), network: g('network \\(HaloRT\\)'), accumulate: g('accumulate'), gpu: g('GPU per frame'),
    interval: iv ? Number(iv[1]) : null, gpuName: (text.match(/GPU: (.*)/) ?? [])[1] };
};

// Metal drops timestamps written by EMPTY compute passes (the demo's mark() uses exactly that), so every read is 0. With --pad, an
// injected script (not a change to the demo files) gives each timestamp-writing pass one trivial dispatch.
const PAD = `(() => {
  const ra = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = async function (d) {
    const dev = await ra.call(this, d);
    const mod = dev.createShaderModule({ code: '@compute @workgroup_size(1) fn main() {}' });
    dev.__noop = dev.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
    return dev;
  };
  const dev = new WeakMap();
  const cce = GPUDevice.prototype.createCommandEncoder;
  GPUDevice.prototype.createCommandEncoder = function (d) { const e = cce.call(this, d); dev.set(e, this); return e; };
  const bcp = GPUCommandEncoder.prototype.beginComputePass;
  GPUCommandEncoder.prototype.beginComputePass = function (d) {
    const pass = bcp.call(this, d);
    if (d && d.timestampWrites) {
      const device = dev.get(this); const end = pass.end.bind(pass);
      pass.end = () => { pass.setPipeline(device.__noop); pass.dispatchWorkgroups(1); end(); };
    }
    return pass;
  };
})();`;
const results = [];
try {
  const dbg = `http://127.0.0.1:${debugPort}`;
  for (let i = 0; i < 100; i++) { try { await fetch(dbg + '/json/version'); break; } catch { await sleep(150); } }
  const page = (await (await fetch(dbg + '/json/list')).json()).find(t => t.type === 'page');
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  if (argv.includes('--pad')) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PAD });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  const ev = (e, t = 60000) => cdp.evaluate(e, t);
  const runs = [['halort', 256, 'fp32'], ['halort', 256, 'fp16'], ['halort', 512, 'fp32'], ['halort', 512, 'fp16'], ['halort_dir', 512, 'fp32'], ['halort_dir', 512, 'fp16']];
  let current = null;
  for (const [pg, res, prec] of runs) {
    if (current !== pg) {
      await cdp.send('Page.navigate', { url: `${base}/${pg}/index.html` });
      await sleep(3000);
      current = pg;
      for (let i = 0; i < 200 && !(await ev(`document.getElementById('stats')?.textContent.includes('features')`)); i++) await sleep(300);
    }
    await ev(`(() => { const s = document.getElementById('maxSpp'); s.max = 100000; s.value = 100000; s.dispatchEvent(new Event('input'));
      const r = document.getElementById('resolution'); r.value = '${res}'; r.dispatchEvent(new Event('input'));
      const p = document.getElementById('precision'); p.value = '${prec}'; p.dispatchEvent(new Event('input')); })()`);
    // wait for >=70 frames in this configuration, then read
    let text = '', ok = false;
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      text = await ev(`document.getElementById('stats').textContent + '\\nERR:' + document.getElementById('error').textContent + '\\nPREC:' + document.getElementById('precision').value + '\\nRES:' + document.getElementById('resolution').value`);
      const m = text.match(/(\d+)×(\d+) px\s+(\d+) frames/);
      if (m && Number(m[1]) === res && Number(m[3]) >= 70 && text.includes('PREC:' + prec)) { ok = true; break; }
    }
    const r = { page: pg, res, prec, ok, ...parse(text), err: (text.match(/ERR:(.*)/) ?? [])[1] };
    results.push(r); console.error(JSON.stringify(r));
    if (pg === 'halort' && res === 512 && prec === 'fp32') {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, 60000);
      writeFileSync(join(out, 'halort-512-fp32.png'), Buffer.from(shot.data, 'base64'));
      writeFileSync(join(out, 'halort-512-fp32-stats.txt'), text);
    }
  }
  cdp.close();
} finally { clearTimeout(hard); browser.kill('SIGKILL'); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
writeFileSync(join(out, 'timings.json'), JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
