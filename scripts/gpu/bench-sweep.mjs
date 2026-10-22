#!/usr/bin/env node
// Timing sweep on the HZD bench: one page load, then for every (repetition, config, view) apply the config through the bench's tuner
// (window.__tune.apply resets every setting to its starting value first, then sets the config's), go to the view, settle, and read the
// GPU timer. The GPU timer is the pane's 60-sample mean (examples/lab/compare/panes/ours.ts stats()).
//
//   node scripts/gpu/bench-sweep.mjs --url http://127.0.0.1:5391/hzd/?quality=ultra --views gp7,ground,horizon,high --reps 3 \
//        --configs work/captures/PF1/configs.json --out work/captures/PF1/timing.json [--settle 150] [--size 1920x1080]
//
// configs.json: [{ "name": "base", "set": {} }, { "name": "veil off", "set": { "hzd.veilWidth": 0 } }, ...]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { CDP } from './cdp.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : fallback; };
const root = resolve(new URL('../..', import.meta.url).pathname);
const url = opt('url');
const views = opt('views', 'gp7,ground,horizon,high').split(',');
const reps = Number(opt('reps', 3));
const settle = Number(opt('settle', 60));
const settleMs = Number(opt('settle-ms', 2500));
const sampleMs = Number(opt('sample-ms', 5000));
const [width, height] = opt('size', '1920x1080').split('x').map(Number);
const configs = JSON.parse(readFileSync(resolve(root, opt('configs')), 'utf8'));
const out = resolve(root, opt('out', 'work/captures/scratch/timing.json'));
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(150); }
  throw new Error(`Timed out waiting for ${what}`);
}
const debugPort = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'clouds-chrome-'));
const browser = spawn(chrome, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu',
  '--disable-background-timer-throttling', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-renderer-backgrounding', `--window-size=${width},${height}`, '--headless=new', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { browser.kill('SIGTERM'); } catch { /* gone */ } try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ } };
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(130); }); process.on('SIGTERM', () => { cleanup(); process.exit(143); });
const rows = [];
try {
  const page = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t => t.type === 'page'), 15000, 'Chrome');
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url });
  const ev = e => cdp.evaluate(e);
  await waitFor(() => ev(`(() => { const c = window.__clouds; if (!c) return null; if (c.error) return { error: String(c.error) }; return c.ready ? { ok: true } : null; })()`), 120000, 'ready');
  const gpu = await ev(`(async () => { const a = await navigator.gpu?.requestAdapter(); return a ? { vendor: a.info?.vendor, architecture: a.info?.architecture } : null; })()`);
  console.log('gpu', JSON.stringify(gpu));
  await ev(`window.__clouds.settle(600)`);
  if (opt('probe')) { console.log(JSON.stringify(await ev(opt('probe')))); }
  for (let rep = 0; rep < reps; rep++) {
    for (const cfg of configs) {
      for (const view of views) {
        await ev(`window.__tune.apply({ settings: ${JSON.stringify(cfg.set ?? {})}, savedAt: '' })`);
        await ev(`window.__clouds.bookmark(${JSON.stringify(view)})`);
        await ev(`window.__clouds.settle(${settle})`);
        await sleep(settleMs);
        // Sample the pane's latest per-pass GPU times (clouds.lastTimings) every 30 ms for sampleMs; each new value is one sample.
        const samples = [];
        let lastKey = '';
        const end = Date.now() + sampleMs;
        while (Date.now() < end) {
          const g = (await ev(`window.__clouds.report().gpuLast`)) ?? {};
          const key = JSON.stringify(g);
          if (key !== lastKey) { samples.push(g); lastKey = key; }
          await sleep(30);
        }
        const r = await ev(`window.__clouds.report()`);
        const med = k => { const a = samples.map(x => x[k]).filter(x => typeof x === 'number').sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
        const names = [...new Set(samples.flatMap(x => Object.keys(x)))];
        const sceneMean = r.gpuMs?.scene ?? 0;
        r.gpuMs = Object.fromEntries(names.map(k => [k, med(k)]));
        r.gpuMs.n = samples.length;
        r.gpuMs.scene = sceneMean;
        r.gpuMs.cloudsTotal = names.reduce((a, k) => a + (med(k) ?? 0), 0);
        r.gpuMs.total = r.gpuMs.cloudsTotal + sceneMean;
        rows.push({ rep, config: cfg.name, view, gpuMs: r.gpuMs, load: loadavg()[0] });
        console.log(`rep ${rep} ${cfg.name} / ${view}: total ${r.gpuMs?.total?.toFixed(2)}  sky ${r.gpuMs?.skyLayer?.toFixed(2)}`);
      }
    }
  }
  cdp.close();
} finally {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ url, size: [width, height], settle, at: new Date().toISOString(), rows }, null, 1));
  cleanup();
}
