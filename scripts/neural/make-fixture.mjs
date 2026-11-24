#!/usr/bin/env node
// N5.4: regenerates the neural parity fixture (one packed feature frame + the authors' network output for it, at 256 and 512).
//   node scripts/neural/make-fixture.mjs [--sizes 256,512] [--wasm-runs 2] [--out <dir>] [--preview work/captures/N5-4/out_512.jpg]
// Starts its own vite on a free port and its own headless Chrome (real GPU), loads examples/lab/neural-fixture/, and pulls the page's
// buffers out over CDP in 1 MB chunks. Default output: <main checkout>/artifacts/research/neural/fixture/ (local only, not committed).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { CDP } from '../gpu/cdp.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const root = resolve(new URL('../..', import.meta.url).pathname);
// worktree: <main>/.claude/worktrees/<name>; plain checkout: root itself
const main = existsSync(join(root, '../../../artifacts')) && root.includes('/.claude/worktrees/') ? resolve(root, '../../..') : root;
const outDir = resolve(opt('out', join(main, 'artifacts/research/neural/fixture')));
const previewFile = resolve(root, opt('preview', 'work/captures/N5-4/out_512.jpg'));
const sizes = opt('sizes', '256,512').split(',').map(Number);
const wasmRuns = Number(opt('wasm-runs', 2));
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const children = [];
const cleanup = () => { for (const c of children) try { c.kill('SIGKILL'); } catch { /* gone */ } };
process.on('exit', cleanup);
const hard = setTimeout(() => { console.error('hard limit (25 min)'); cleanup(); process.exit(2); }, 25 * 60 * 1000);
async function waitFor(fn, ms, what) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(200); } throw new Error('timed out: ' + what); }

const vitePort = await freePort();
const vite = spawn(join(root, 'node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: root, stdio: 'ignore', env: { ...process.env, CLOUDS_NO_WATCH: '1' } });
children.push(vite);
const base = `http://127.0.0.1:${vitePort}`;
await waitFor(async () => (await fetch(base + '/')).ok, 30000, 'vite');
const debugPort = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'n54-chrome-'));
children.push(spawn(chrome, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=800,600', '--headless=new', 'about:blank'], { stdio: 'ignore' }));
let code = 0;
try {
  const tab = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t => t.type === 'page'), 15000, 'Chrome');
  const cdp = await CDP.connect(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: `${base}/neural-fixture/` });
  const ev = (e, ms = 120000) => cdp.evaluate(e, ms);
  await waitFor(async () => { const r = await ev(`window.__fx ? 'ok' : (window.__fxError ?? null)`); if (r && r !== 'ok') throw new Error(r); return r === 'ok'; }, 120000, 'fixture page');
  mkdirSync(outDir, { recursive: true });
  const perSize = {};
  for (const size of sizes) {
    console.log(`size ${size} ...`);
    perSize[size] = await ev(`window.__fx.run(${size}, ${wasmRuns})`, 20 * 60 * 1000);
    console.log(JSON.stringify(perSize[size]));
  }
  const files = {};
  const pull = async (name, file) => {
    const total = await ev(`window.__fx.byteLength(${JSON.stringify(name)})`), parts = [], CH = 1 << 20;
    for (let off = 0; off < total; off += CH) parts.push(Buffer.from(await ev(`window.__fx.chunk(${JSON.stringify(name)}, ${off}, ${CH})`), 'base64'));
    const buf = Buffer.concat(parts);
    if (buf.length !== total) throw new Error(`${name}: got ${buf.length} of ${total}`);
    writeFileSync(join(outDir, file), buf); files[file] = total;
  };
  for (const size of sizes) {
    await pull(`cond_${size}`, `cond_${size}.f32`);
    await pull(`out_wasm_${size}`, `out_wasm_${size}.f32`);
    await pull(`out_webgpu_${size}`, `out_webgpu_${size}.f32`);
    await pull(`light_${size}`, `light_intensity_${size}.f32`);
    await pull(`env_${size}`, `environment_scale_${size}.f32`);
  }
  const last = sizes[sizes.length - 1];
  const jpg = await ev(`window.__fx.previewJpeg('out_wasm_${last}', ${last})`);
  mkdirSync(resolve(previewFile, '..'), { recursive: true });
  writeFileSync(previewFile, Buffer.from(jpg.split(',')[1], 'base64'));
  const meta = await ev(`window.__fx.meta()`);
  const fixture = {
    made: new Date().toISOString(), command: 'node scripts/neural/make-fixture.mjs',
    layout: 'float32 little-endian, NCHW, rdv pixel order (our image turned 180 degrees); cond [1,17,S,S] channel order = PACKED_CHANNELS in experiments/neural/feature-pass.ts; out [1,3,S,S] radiance',
    inputs: { condition: '[1,17,S,S]', light_intensity: '[3]', environment_scale: '[3]' }, output: 'radiance [1,3,S,S]',
    settings: await ev(`window.__fx.settings`), ortVersion: '1.30.0 (onnxruntime-web ort.webgpu.min.mjs, jsDelivr CDN)',
    providers: { reference: 'wasm (CPU), fp32 model', other: 'webgpu, fp32 model, same device as feature pass' },
    page: meta, sizes: perSize, files,
  };
  writeFileSync(join(outDir, 'fixture.json'), JSON.stringify(fixture, null, 2));
  console.log(`wrote ${Object.keys(files).length} files + fixture.json -> ${outDir}\npreview -> ${previewFile}`);
  cdp.close();
} catch (e) { console.error(e); code = 1; }
cleanup();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
clearTimeout(hard);
process.exit(code);
