// Ocean preview: @pmndrs/sky + the reusable open-water scene, orbit/fly camera, bookmarks and the window.__clouds contract.
// Ocean GPU cost is measured as (frame with ocean) - (frame with ocean hidden) over the render-pass timestamp, before ready().
import { ACESFilmicToneMapping, PerspectiveCamera, Scene } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { Sky } from '@pmndrs/sky';
import { installCloudsHarness } from '../harness/clouds-contract';
import { createOcean } from '../scenes/ocean';
import { CameraRig } from './controls';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);

/** Sun is placed by elevation/azimuth (compass, north = -Z); the camera looks along `lookAz` from `height` metres. */
const BOOKMARKS = {
  shore: { height: 2, sunEl: 32, sunAz: 150, lookAz: 95, pitch: 1 },
  horizon: { height: 20, sunEl: 42, sunAz: 205, lookAz: 120, pitch: -2 },
  sunset: { height: 4, sunEl: 3, sunAz: 270, lookAz: 262, pitch: 4 },
} as const;
type BookmarkName = keyof typeof BOOKMARKS;
const NAMES = Object.keys(BOOKMARKS) as BookmarkName[];
const isName = (n: string): n is BookmarkName => n in BOOKMARKS;

const state = {
  bookmark: (isName(query.get('bookmark') ?? '') ? query.get('bookmark') : 'shore') as BookmarkName,
  scale: Math.min(2, Math.max(0.25, Number(query.get('scale') ?? 1) || 1)),
  oceanVisible: query.get('ocean') !== '0',
};

try {
  const app = document.getElementById('app')!;
  const renderer = new WebGPURenderer({ antialias: true, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  app.appendChild(renderer.domElement);
  await renderer.init();

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, 0.3, 400000);
  const rig = new CameraRig(camera, renderer.domElement);

  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 14, latitude: 40, north: '-Z', mirrorBelowHorizon: true });
  sky.attach(scene);
  const sun = sky.createSun({ physical: true }); // colour/intensity come from the sky LUTs
  sun.attach(scene);
  await sky.compileAsync();
  const ocean = createOcean(renderer, scene, sky, { sun, waves: Number(query.get('waves') ?? 12), rings: Number(query.get('rings') ?? 220), segments: Number(query.get('segments') ?? 512) });
  ocean.mesh.visible = state.oceanVisible;
  for (const [key, value] of query) if (key.startsWith('o.') && key.slice(2) in ocean.settings) (ocean.settings as unknown as Record<string, number>)[key.slice(2)] = Number(value);

  const renderSize = { width: 1, height: 1 };
  const resize = () => {
    renderer.setPixelRatio(1);
    renderSize.width = Math.max(1, Math.round(innerWidth * state.scale));
    renderSize.height = Math.max(1, Math.round(innerHeight * state.scale));
    renderer.setSize(renderSize.width, renderSize.height, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  const applyBookmark = (name: string) => {
    if (!isName(name)) throw new Error(`unknown bookmark: ${name}`);
    state.bookmark = name;
    const b = BOOKMARKS[name];
    sky.setSunDirection({ elevation: b.sunEl, azimuth: b.sunAz });
    const az = (b.lookAz * Math.PI) / 180, pitch = (b.pitch * Math.PI) / 180;
    const dir = [Math.sin(az) * Math.cos(pitch), Math.sin(pitch), -Math.cos(az) * Math.cos(pitch)];
    rig.set([0, b.height, 0], [dir[0] * 100, b.height + dir[1] * 100, dir[2] * 100]);
    for (const n of NAMES) buttons[n].classList.toggle('on', n === name);
  };

  // ---- HUD + panel ----
  const hud = document.getElementById('hud')!;
  const panel = document.getElementById('panel')!;
  const buttons = {} as Record<BookmarkName, HTMLButtonElement>;
  const row = Object.assign(document.createElement('div'), { className: 'row' });
  panel.appendChild(row);
  for (const n of NAMES) { const b = document.createElement('button'); b.textContent = n; b.onclick = () => applyBookmark(n); row.appendChild(b); buttons[n] = b; }
  const modeBtn = document.createElement('button');
  modeBtn.textContent = 'mode: orbit (F)';
  const toggleMode = () => { rig.setMode(rig.mode === 'orbit' ? 'fly' : 'orbit'); modeBtn.textContent = `mode: ${rig.mode} (F)`; };
  modeBtn.onclick = toggleMode;
  panel.appendChild(modeBtn);
  addEventListener('keydown', e => { if (e.code === 'KeyF') toggleMode(); });
  const slider = (name: keyof typeof ocean.settings, min: number, max: number, step: number) => {
    const l = document.createElement('label'); l.append(name);
    const i = Object.assign(document.createElement('input'), { type: 'range', min: String(min), max: String(max), step: String(step), value: String(ocean.settings[name]) });
    i.oninput = () => { (ocean.settings as unknown as Record<string, number>)[name] = Number(i.value); };
    l.appendChild(i); panel.appendChild(l);
  };
  slider('waveScale', 0.2, 3, 0.05); slider('choppiness', 0, 1.5, 0.05); slider('windDirection', -180, 180, 1);

  // ---- timing ----
  const frameTimes: number[] = [];
  const renderMs: number[] = []; // render-pass GPU ms for the current ocean visibility
  const phases: { skyOnly: number; withOcean: number } = { skyOnly: 0, withOcean: 0 };
  let timestampBusy = false;
  const pct = (p: number) => { if (!frameTimes.length) return 0; const s = [...frameTimes].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const gpuMs = () => ({ scene: quantile(renderMs.slice(-120), 0.25), skyOnly: phases.skyOnly, ocean: Math.max(0, phases.withOcean - phases.skyOnly) });
  const f = (n: number, d = 2) => n.toFixed(d);

  // Ocean GPU cost = render-pass timestamp with the ocean visible minus hidden, both measured live over rAF-paced frames before ready().
  // Apple GPUs ramp their clock when lightly loaded, which makes individual samples bimodal, so the 25th percentile of each phase is used.
  const CAL_START = 40, CAL_MID = 200, CAL_END = 360, CAL_SKIP = 40; // first CAL_SKIP samples after each switch are dropped (timestamps lag)
  const quantile = (a: number[], q: number) => { const x = [...a].sort((p, r) => p - r); return x.length ? x[Math.floor(q * (x.length - 1))] : 0; };
  const setOcean = (v: boolean) => { ocean.mesh.visible = v; };
  let calibrating = !query.has('nocal');
  const calStep = () => {
    if (frame === CAL_START - 1) { renderMs.length = 0; setOcean(false); }
    if (frame === CAL_MID) { phases.skyOnly = quantile(renderMs.slice(CAL_SKIP), 0.25); renderMs.length = 0; setOcean(state.oceanVisible); }
    if (frame === CAL_END) { phases.withOcean = quantile(renderMs.slice(CAL_SKIP), 0.25); renderMs.length = 0; calibrating = false; ready(); }
  };
  const t0 = performance.now();
  let last = t0, frame = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (frame > 30) { frameTimes.push(dt * 1000); if (frameTimes.length > 240) frameTimes.shift(); }
    if (calibrating) calStep();
    rig.update(dt);
    // keep the camera above the local swell (the waves are metres tall at the long end)
    camera.position.y = Math.max(camera.position.y, ocean.heightAt(camera.position.x, camera.position.z) + 0.6);
    camera.near = Math.min(50, Math.max(0.2, camera.position.y * 0.05));
    camera.updateProjectionMatrix();
    sky.update(camera);
    ocean.update(dt, camera);
    renderer.render(scene, camera);
    if (!timestampBusy) {
      timestampBusy = true;
      renderer.resolveTimestampsAsync('render').then(ms => { if (typeof ms === 'number' && ms > 0) { renderMs.push(ms); if (renderMs.length > 600) renderMs.shift(); } }).catch(() => {}).finally(() => { timestampBusy = false; });
    }
    if (frame++ % 10 === 0) {
      const g = gpuMs(), p50 = pct(0.5);
      hud.textContent = [`fps ${f(p50 > 0 ? 1000 / p50 : 0, 0)}   frame ${f(frameTimes[frameTimes.length - 1] ?? 0)} ms (p50 ${f(p50)}  p95 ${f(pct(0.95))})`,
        `render ${renderSize.width}x${renderSize.height}`, `gpu ms: scene ${f(g.scene)}  sky-only ${f(g.skyOnly)}  ocean ${f(g.ocean)}`,
        `cam ${camera.position.toArray().map(v => f(v, 1)).join(', ')} [${rig.mode}]`].join('\n');
    }
    harness.frame();
  };
  const ready = () => harness.ready({
    bookmark: name => applyBookmark(name),
    report: () => ({ gpuMs: gpuMs(), frameMs: { p50: pct(0.5), p95: pct(0.95), last: frameTimes[frameTimes.length - 1] ?? 0 }, renderSize: [renderSize.width, renderSize.height], bookmark: state.bookmark, frames: frame }),
  });
  applyBookmark(state.bookmark);
  renderer.setAnimationLoop(loop);
  if (!calibrating) ready();
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
