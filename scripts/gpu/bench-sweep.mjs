#!/usr/bin/env node
// Timing sweep on the HZD bench: one page load (headless Chrome with vsync and the frame limit off, so the frame time is the GPU's), then for every
// (repetition, config, view) apply the config through the bench's tuner (window.__tune.apply resets every tuned setting to the code default first, then
// sets --base and the config's), go to the view, settle, and measure: 3 windows of --frames frames timed by requestAnimationFrame (frameMs), plus every
// new value of the pane's latest per-pass GPU timer samples (skyLayer etc.; the timer delivers only a few per second). Waits first until the sky layer's
// trace pipeline has compiled (minutes under load). Run it when the machine is quiet; the load average is recorded per row.
//
//   node scripts/gpu/bench-sweep.mjs --url "http://127.0.0.1:5391/hzd/?quality=ultra&clean=1" --base '{"c.animSpeed":0}' --views gp7,ground,horizon,high \
//        --reps 3 --configs work/captures/PF1/configs.json --out work/captures/PF1/timing2.json [--settle 40] [--settle-ms 1500] [--frames 100] [--size 1920x1080]
//
// configs.json: [{ "name": "base", "set": {} }, { "name": "veil off", "set": { "hzd.veilWidth": 0 } }, ...]  (put the configs to compare next to each other, and repeat the base)
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
const frames = Number(opt('frames', 100));
const [width, height] = opt('size', '1920x1080').split('x').map(Number);
// --base '{"c.animSpeed":0}': settings merged under every config (apply() resets tuned settings to the code defaults, so URL overrides are lost).
const baseSet = JSON.parse(opt('base', '{}'));
const configs = JSON.parse(readFileSync(resolve(root, opt('configs')), 'utf8')).map(c => ({ ...c, set: { ...baseSet, ...(c.set ?? {}) } }));
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
  // The sky layer's trace pipeline compiles asynchronously (long under load): wait until its pass shows up in the GPU timer.
  for (let i = 0; i < 120; i++) { await ev(`window.__clouds.settle(30)`); if ((await ev(`window.__clouds.report().gpuLast`))?.skyLayer !== undefined) break; }
  await ev(`window.__clouds.settle(200)`);
  if (opt('probe')) { console.log(JSON.stringify(await ev(opt('probe')))); }
  for (let rep = 0; rep < reps; rep++) {
    for (const cfg of configs) {
      for (const view of views) {
        await ev(`window.__tune.apply({ settings: ${JSON.stringify(cfg.set ?? {})}, savedAt: '' })`);
        await ev(`window.__clouds.bookmark(${JSON.stringify(view)})`);
        await ev(`window.__clouds.settle(${settle})`);
        await sleep(settleMs);
        // In the page: 3 windows of `frames` frames, each timed by requestAnimationFrame (the GPU-bound frame time: the bench runs with vsync and the frame limit off),
        // and every new value of the pane's latest per-pass GPU times (clouds.lastTimings) is one timer sample.
        const res = await ev(`(async () => {
          const frameMs = [], samples = []; let lastKey = '';
          for (let w = 0; w < 3; w++) {
            const t0 = performance.now(); let n = 0;
            await new Promise(done => { const f = () => { const g = window.__clouds.report().gpuLast ?? {}; const k = JSON.stringify(g); if (k !== lastKey) { samples.push(g); lastKey = k; } if (++n >= ${frames}) done(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
            frameMs.push((performance.now() - t0) / ${frames});
          }
          return { frameMs, samples };
        })()`);
        const { frameMs, samples } = res;
        const r = await ev(`window.__clouds.report()`);
        const stat = k => { const a = samples.map(x => x[k]).filter(x => typeof x === 'number').sort((x, y) => x - y); return a.length ? { med: a[a.length >> 1], min: a[0], n: a.length } : null; };
        const names = [...new Set(samples.flatMap(x => Object.keys(x)))];
        const per = Object.fromEntries(names.map(k => [k, stat(k)]));
        const sums = samples.map(x => Object.values(x).reduce((p, q) => p + q, 0)).sort((x, y) => x - y);
        const fm = [...frameMs].sort((x, y) => x - y);
        r.gpuMs = { ...Object.fromEntries(names.map(k => [k, per[k].med])), skyLayerMin: per.skyLayer?.min ?? null, skyLayerN: per.skyLayer?.n ?? 0, avg: r.gpuMs,
          cloudsTotal: sums.length ? sums[sums.length >> 1] : null, frameMs: fm[1], frameMsMin: fm[0], frameMsAll: frameMs };
        rows.push({ rep, config: cfg.name, view, gpuMs: r.gpuMs, load: loadavg()[0] });
        console.log(`rep ${rep} ${cfg.name} / ${view}: frame ${r.gpuMs?.frameMs?.toFixed(1)} ms (best window ${r.gpuMs?.frameMsMin?.toFixed(1)})  sky ${r.gpuMs?.skyLayer?.toFixed(1)} (min ${r.gpuMs?.skyLayerMin?.toFixed(1)}, n ${r.gpuMs?.skyLayerN})  load ${loadavg()[0].toFixed(0)}`);
      }
    }
  }
  cdp.close();
} finally {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ url, size: [width, height], settle, at: new Date().toISOString(), rows }, null, 1));
  cleanup();
}
