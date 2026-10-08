#!/usr/bin/env node
// Throwaway driver: Tidewater cloud reference captures via CDP.
//   (in /Users/dex/Developer/tidewater)  npm ci && npx vite --host 127.0.0.1 --port 5189
//   node work/captures/P0-04/drive.mjs [--url http://127.0.0.1:5189/] [--only a,b] [--headed]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { CDP } from '../../../scripts/gpu/cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const url = opt('url', 'http://127.0.0.1:5189/');
const only = opt('only', '') ? opt('only').split(',') : null;
const settleMs = Number(opt('settle', 12000));
const W = 1920, H = 1080;
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Views: p = camera position (m; y up, sea level 0), pitch in radians (+ = up), time = Tidewater timeOfDay (h).
// yaw: number (rad; forward = (-sin yaw, 0, -cos yaw)) or 'sun' (face the sun) / 'antisun'.
const VIEWS = {
  'a-ground-cumulus-midday': { p: [15, 3, -58], yaw: Math.PI, pitch: 0.75, time: 12.5 },
  'b-horizon-distant-layer': { p: [15, 3, -58], yaw: Math.PI, pitch: 0.10, time: 13.0 },
  'c-golden-hour-backlit':   { p: [20, 2.5, -50], yaw: 'sun', pitch: 0.30, time: 17.6 },
  'd-summit-across-clouds':  { p: [-60, 300, -470], yaw: Math.PI * 1.02, pitch: 0.12, time: 15.0 },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
async function waitFor(fn, ms, what) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(500); } throw new Error('Timed out: ' + what); }

const port = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'tw-chrome-'));
const browser = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--window-size=${W},${H}`,
  ...(argv.includes('--headed') ? [] : ['--headless=new']), 'about:blank'], { stdio: 'ignore' });
const done = () => { try { browser.kill('SIGTERM'); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', done);
try {
  const page = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'), 15000, 'Chrome');
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url });
  console.log('loading (shader compile can take minutes)...');
  await waitFor(() => cdp.evaluate(`!!(window.__app && window.__app.ui && window.__app.fps > 0)`), 600000, 'app ready');
  console.log('app ready');
  await cdp.evaluate(`(() => { try { window.__ui.startEl.click(); } catch (e) {} })()`);  // dismiss the 'Click to explore' overlay
  await sleep(2500);
  await cdp.evaluate(`document.querySelectorAll('.gm-guide-skip').forEach(b => b.click())`);  // skip the first-play guide card
  await sleep(1000);
  const meta = [];
  for (const [name, v] of Object.entries(VIEWS)) {
    if (only && !only.includes(name.split('-')[0])) continue;
    const info = await cdp.evaluate(`(() => {
      const app = window.__app, v = ${JSON.stringify(v)};
      window.__ui.setPhotoMode(true);                 // hide HUD/UI
      app.settings.timeSpeed = 0; app.settings.timeOfDay = v.time; app.updateSun();
      const s = app.atmosphere.sunDir.value;
      let yaw = v.yaw;
      if (yaw === 'sun') yaw = Math.atan2(-s.x, -s.z);
      app.setFreeCam(true);
      app.fly.setPose(new app.camera.position.constructor(...v.p), yaw, v.pitch);
      app.fly.velocity.set(0, 0, 0);
      return { sunElevationDeg: Math.asin(s.y) * 180 / Math.PI, sunAzimuthYawRad: Math.atan2(-s.x, -s.z), yawUsed: yaw, fovDeg: app.camera.fov, aspect: app.camera.aspect,
               cloudCoverage: app.clouds && app.clouds.coverage.value, exposure: app.settings.exposure, renderScale: app.settings.renderScale };
    })()`);
    await sleep(settleMs);   // let temporal cloud history / panorama converge
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
    writeFileSync(join(here, name + '.jpg'), Buffer.from(data, 'base64'));
    const fps = await cdp.evaluate('window.__app.fps');
    meta.push({ name, ...v, ...info, fps });
    console.log(name, JSON.stringify(info), 'fps', fps);
  }
  writeFileSync(join(here, 'views.json'), JSON.stringify(meta, null, 1));
  cdp.close();
} finally { done(); }
process.exit(0);
