#!/usr/bin/env node
// Screenshots from one HZD bench page load for several settings configs and views (the same page, so the sky pipelines compile once):
// waits until the sky layer's pass shows in the GPU timer (its trace pipeline compiles asynchronously, minutes under load), then for each
// (config, view): apply the config through window.__tune.apply (it resets every tuned setting first), go to the view, settle, screenshot (PNG).
//
//   node scripts/gpu/bench-shots.mjs --url "http://127.0.0.1:5391/hzd/?quality=ultra&clean=1&motion=0&sky_temporal=0" --views gp7,horizon \
//        --configs work/captures/PF1/shot-configs.json --out work/captures/PF1/shots --settle 12
// Output: <out>/<config name>/<view>.png. configs.json as bench-sweep.mjs. With sky_temporal=0 (a full-resolution trace every frame, no history)
// the render is deterministic, so two configs that should not differ can be compared pixel for pixel.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { CDP } from './cdp.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : fallback; };
const root = resolve(new URL('../..', import.meta.url).pathname);
const url = opt('url');
const views = opt('views', 'gp7,ground,horizon,high').split(',');
const settle = Number(opt('settle', 12));
const [width, height] = opt('size', '1920x1080').split('x').map(Number);
// --base '{"c.animSpeed":0}': settings merged under every config (apply() resets tuned settings to the code defaults, so URL overrides are lost).
const baseSet = JSON.parse(opt('base', '{}'));
const configs = JSON.parse(readFileSync(resolve(root, opt('configs')), 'utf8')).map(c => ({ ...c, set: { ...baseSet, ...(c.set ?? {}) } }));
const out = resolve(root, opt('out', 'work/captures/scratch/shots'));
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
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--window-size=${width},${height}`, '--headless=new', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { browser.kill('SIGTERM'); } catch { /* gone */ } try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ } };
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(130); }); process.on('SIGTERM', () => { cleanup(); process.exit(143); });
try {
  const page = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t => t.type === 'page'), 15000, 'Chrome');
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url });
  const ev = e => cdp.evaluate(e);
  await waitFor(() => ev(`(() => { const c = window.__clouds; if (!c) return null; if (c.error) return { error: String(c.error) }; return c.ready ? { ok: true } : null; })()`), 120000, 'ready');
  for (let i = 0; i < 400; i++) { await ev(`window.__clouds.settle(10)`); if ((await ev(`window.__clouds.report().gpuLast`))?.skyLayer !== undefined) break; }
  await ev(`window.__clouds.settle(30)`);
  for (const cfg of configs) {
    const dir = join(out, cfg.name.replace(/[^\w.-]+/g, '_'));
    mkdirSync(dir, { recursive: true });
    for (const view of views) {
      await ev(`window.__tune.apply({ settings: ${JSON.stringify(cfg.set ?? {})}, savedAt: '' })`);
      await ev(`window.__clouds.bookmark(${JSON.stringify(view)})`);
      await ev(`window.__clouds.settle(${settle})`);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, 240000);
      writeFileSync(join(dir, `${view}.png`), Buffer.from(data, 'base64'));
      console.log(`${cfg.name} / ${view}`);
    }
  }
  cdp.close();
} finally { cleanup(); }
