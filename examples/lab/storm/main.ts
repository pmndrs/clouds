// Phase 6 demo (P6-B): a storm cell. One cumulus grows through congestus into a cumulonimbus with a spreading anvil over ~2 minutes of simulated
// time on top of the evolving cumulus field (P6-A), and lightning flashes light it from inside (runtime.flash / settings.lightning).
//
//   ?timeScale=<n>   simulated seconds per real second (default 4: the build takes 30 s of demo)
//   ?sim=<s>         simulated seconds. Frozen there: the field is generated once, completely (deterministic captures). ?play=1 plays from it.
//   ?step=1          deterministic playback: the clock advances 1/60 s of demo time per rendered frame
//   ?flash=hold      a steady flash at the cell's centre (look development / captures); ?flash=x,y,z,r,i a steady flash at a world position, radius, intensity
//   ?lightning=0     no lightning (the A/B for its cost: also no active flash);  ?rate=<flashes/s> automatic flash rate (default 0.25 once the cell is a congestus)
//   ?storm=0         no storm cell (the same field without it: the A/B for the cell's cost)
//   ?bookmark=ground|distant|top|inside|anvil   ?wind=<x>,<z> ?cadence= ?seed= ?exposure= ?sunEl= ?sunAz= ?quality= ?hud=0 ?clean=1
//   ?p_<NvdfParams key>=<n>   override a shaping parameter (e.g. p_profileSigma=0 for the A/B of the profile noise)   ?height= ?radius= ?anvil= the cell's mature size (m)
// Lines tagged `// INTEGRATION` are what clouds cost this scene; the evolving cloudscape is content, tagged `// CONTENT`.
import { ACESFilmicToneMapping, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend, type CloudQuality } from '@clouds/three'; // INTEGRATION
import { createEvolvingCloudscape, loadCloudNoise, stormCellState, type EvolveUpdate, type NvdfParams } from '@clouds/runtime'; // CONTENT
import { installCloudsHarness } from '../harness/clouds-contract';
import { CameraRig } from '../flagship/controls';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const num = (k: string, d: number) => (query.has(k) ? Number(query.get(k)) : d);

// The box is 4096 x 4096 m, 2048 m tall (256 x 256 x 128 voxels of 16 m), centred on x = z = 0, its base at BASE_Y.
const DIMS: [number, number, number] = [256, 256, 128], VOXEL = 16, BASE_Y = num('base', 250), REF = DIMS[0] * VOXEL;
const BOX_CENTRE: [number, number] = [0, 0];
const TOWER = { radius: num('radius', 560), height: num('height', 1560), grow: 120, anvil: num('anvil', 2000), base: 60 };   // CONTENT: the cell's mature size (m; turrets reach 1.15 x height) and the simulated seconds it takes to grow
const STORM_START = -10;                                                    // CONTENT: the cell is already 10 s old at sim t = 0 (a small cumulus)
const STORM_CENTRE: [number, number] = [0.5, 0.5];
const TIME_SCALE = num('timeScale', 4);
const STEP = 1 / 60;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const BOOKMARKS = {
  // ground: under the field, looking at the tower and anvil from 2.3 km south; distant: the whole cell from the far side of the box; inside: in the anvil's shadow under the tower, close to the discharge region
  // Sun from the east-south-east (P6-C: side light, so the lobes shade; P6-B had it behind the camera, which lit the tower flat).
  ground: { pos: [-150, 2, 2900], sunEl: 24, sunAz: 100, lookAz: 0, pitch: 17 },
  distant: { pos: [-700, 120, 5900], sunEl: 24, sunAz: 100, lookAz: 3, pitch: 13 },
  top: { pos: [0, 5200, 1200], sunEl: 24, sunAz: 100, lookAz: 0, pitch: -80 },
  inside: { pos: [150, 560, 760], sunEl: 24, sunAz: 100, lookAz: 195, pitch: 8 },
  // under the downwind edge of the anvil, looking back at the tower: the overhang and the underside
  anvil: { pos: [1900, 40, 1500], sunEl: 24, sunAz: 100, lookAz: 230, pitch: 28 },
} as const;
type BookmarkName = keyof typeof BOOKMARKS;
const NAMES = Object.keys(BOOKMARKS) as BookmarkName[];
const isName = (n: string): n is BookmarkName => n in BOOKMARKS;

try {
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = num('exposure', 0.3);
  document.body.style.cssText = 'margin:0;overflow:hidden';
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  renderer.setPixelRatio(1);
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, 0.5, 600000);
  const rig = new CameraRig(camera, renderer.domElement);
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 14, latitude: 40, north: '-Z', mirrorBelowHorizon: true });
  sky.attach(scene);
  const sun = sky.createSun({ physical: true });
  sun.attach(scene);
  await sky.compileAsync();
  scene.add(new Mesh(new PlaneGeometry(400000, 400000).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x2f3a28, roughness: 1 })));

  const clouds = new Clouds(renderer, { sky, quality: (query.get('quality') as CloudQuality) ?? 'high' }); // INTEGRATION
  const post = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera); // INTEGRATION
  post.outputNode = clouds.node(scenePass.getTextureNode(), scenePass); // INTEGRATION
  await clouds.setNoise(await loadCloudNoise('/clouds/noise/')); // INTEGRATION
  { const s = clouds.settings; s.windVelocity[0] = s.windVelocity[1] = s.windVelocity[2] = 0; }   // the detail noise is anchored to the clouds (generator)

  // ---- the evolving field with the storm cell (CONTENT) ----
  const device = sharedBackend(renderer).device; // CONTENT
  const wind = (query.get('wind') ?? '3,1.5').split(',').map(Number) as [number, number];
  const stormOn = query.get('storm') !== '0';
  const paramOverrides: Partial<NvdfParams> = {};
  for (const [k, v] of query) if (k.startsWith('p_')) (paramOverrides as Record<string, number>)[k.slice(2)] = Number(v);
  const evolution = createEvolvingCloudscape(device, { // CONTENT
    preset: 'storm', dims: DIMS, voxelSize: VOXEL, seed: num('seed', 7), lifeSeconds: num('life', 600), wind,
    cadence: num('cadence', 1.5), border: 0.06, sliceDepth: 4,
    // storm=0 keeps the same recipe (map heights, same preset) without the cell: the cost A/B isolates the cell itself.
    ...(stormOn ? { storm: { center: STORM_CENTRE, start: STORM_START, growSeconds: TOWER.grow, towerRadius: TOWER.radius, towerHeight: TOWER.height, anvilRadius: TOWER.anvil, baseHeight: TOWER.base } } : {}),
    params: { ...(stormOn ? {} : { useMapHeights: true }), ...paramOverrides },
  });
  const HALF = DIMS[0] * VOXEL / 2;
  const cornerOf = (off: readonly [number, number]): [number, number, number] => [BOX_CENTRE[0] + off[0] - HALF, BASE_Y, BOX_CENTRE[1] + off[1] - HALF];
  const show = (u: EvolveUpdate) => { // INTEGRATION: a same-size swap that keeps the temporal history and the light grid (runtime P6-A hook), else a full setVolume
    if (!clouds.core.swapVolume(u.volume, { position: cornerOf(u.offset) })) void clouds.setVolume(u.volume, { position: [BOX_CENTRE[0] + u.offset[0], BASE_Y, BOX_CENTRE[1] + u.offset[1]] });
  };

  // ---- clock ----
  const hasSim = query.has('sim');
  const stepMode = query.get('step') === '1';
  const live = !hasSim || query.get('play') === '1' || stepMode;
  let demoT = num('sim', 0) / TIME_SCALE;
  const simT = () => demoT * TIME_SCALE;
  let update = await evolution.start(simT());
  show(update);

  // ---- lightning (INTEGRATION: runtime.flash / settings.lightning; CONTENT: where the storm is) ----
  /** The cell's state at simulated time t (the generator's life cycle, runtime stormCellState): phase, tower height and radius, world centre of the tower. */
  const cell = (t: number) => {
    const ph = (t - STORM_START) / TOWER.grow, st = stormCellState(ph);
    return {
      ph, height: st.heightScale * TOWER.height, radius: st.radiusScale * TOWER.radius, envT: st.towerEnvelope,
      x: BOX_CENTRE[0] + (STORM_CENTRE[0] - 0.5) * REF + wind[0] * t, z: BOX_CENTRE[1] + (STORM_CENTRE[1] - 0.5) * REF + wind[1] * t,
    };
  };
  const lightningOn = query.get('lightning') !== '0' && stormOn;
  const baseRate = num('rate', 0.25);
  const L = clouds.settings.lightning;                                       // INTEGRATION
  L.radiusRange = [500, 900]; L.intensityRange = [0.8, 1.8]; L.durationRange = [0.25, 0.45];
  const steadyFlash = (query.get('flash') ?? '');
  let flashHeld = false;
  const placeLightning = () => {
    const c = cell(simT());
    // strikes live in the tower's body, a little below its top and above the base
    L.region = { center: [c.x, BASE_Y + TOWER.base + 100, c.z], radius: Math.max(40, c.radius * 0.7), height: Math.max(100, c.height * 0.75) };
    L.rate = lightningOn ? baseRate * smooth(0.3, 0.6, c.ph) * c.envT : 0;
  };
  const holdFlash = () => {
    const c = cell(simT());
    const v = steadyFlash === 'hold' ? [c.x - 60, BASE_Y + TOWER.base + c.height * 0.4, c.z + 300, 1300, 1.0] : steadyFlash.split(',').map(Number);
    clouds.core.flash({ position: [v[0], v[1], v[2]], radius: v[3], intensity: v[4], duration: 1e6, steady: true }); // INTEGRATION
    flashHeld = true;
  };
  window.addEventListener('keydown', e => {
    if (e.key === 'f') { const c = cell(simT()); clouds.core.flash({ position: [c.x, BASE_Y + c.height * (0.3 + 0.5 * Math.random()), c.z], radius: 750, intensity: 1.4 }); }
  });

  // ---- camera, HUD, bookmarks ----
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);
  resize();
  let bookmark: BookmarkName = isName(query.get('bookmark') ?? '') ? (query.get('bookmark') as BookmarkName) : 'ground';
  const applyBookmark = (name: string) => {
    if (!isName(name)) throw new Error(`unknown bookmark: ${name}`);
    bookmark = name;
    const b = BOOKMARKS[name];
    sky.setSunDirection({ elevation: num('sunEl', b.sunEl), azimuth: num('sunAz', b.sunAz) });
    const az = (b.lookAz * Math.PI) / 180, pitch = (b.pitch * Math.PI) / 180;
    const d = [Math.sin(az) * Math.cos(pitch), Math.sin(pitch), -Math.cos(az) * Math.cos(pitch)];
    rig.set([...b.pos], [b.pos[0] + d[0] * 100, b.pos[1] + d[1] * 100, b.pos[2] + d[2] * 100]);
  };
  const hud = document.createElement('pre');
  hud.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:4px 6px;background:#0008;color:#fff;font:12px monospace;pointer-events:none';
  if (query.get('hud') === '0') hud.style.display = 'none';
  document.body.appendChild(hud);
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;right:8px;top:8px;display:flex;gap:4px';
  if (query.get('clean') === '1') bar.style.display = 'none';
  document.body.appendChild(bar);
  for (const name of NAMES) { const b = document.createElement('button'); b.textContent = name; b.onclick = () => applyBookmark(name); bar.appendChild(b); }

  // ---- measurement ----
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const quant = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  const frameTimes: number[] = [], sceneGpu: number[] = [];
  const flashFrames: { cloudsTotal: number; level: number }[] = [], calmFrames: number[] = [];
  const gpuMs = () => { const c = clouds.timings; const sum = Object.values(c).reduce((x, y) => x + y, 0); const grid = (c.lightGrid ?? 0) + (c.lightGridReduce ?? 0);
    return { scene: mean(sceneGpu), ...c, cloudsTotal: sum, cloudsMarch: sum - grid, total: mean(sceneGpu) + sum }; };
  let frame = 0, last = performance.now(), busy = false;
  renderer.setAnimationLoop(now => {
    const rawDt = Math.min(0.25, (now - last) / 1000); last = now;
    const dt = stepMode ? STEP : rawDt;
    if (frame > 30) frameTimes.push(rawDt * 1000);
    if (frameTimes.length > 600) frameTimes.shift();
    if (live) demoT += dt;
    if (live) {
      update = evolution.update(simT(), dt);
      if (update.swapped) show(update);
      clouds.core.setVolumePosition(cornerOf([wind[0] * simT() - update.advection[0], wind[1] * simT() - update.advection[1]])); // INTEGRATION
    }
    placeLightning();
    if (steadyFlash && !flashHeld && frame > 2) holdFlash();
    rig.update(dt);
    camera.near = Math.min(50, Math.max(0.2, camera.position.y * 0.05));
    camera.updateProjectionMatrix();
    sky.update(camera); // INTEGRATION (the sky needs this anyway)
    void sky.updateAerialPerspective(); // INTEGRATION (the sky needs this anyway)
    post.render();
    if (!busy) {
      busy = true;
      renderer.resolveTimestampsAsync('render').then(ms => { if (typeof ms === 'number' && ms > 0) { sceneGpu.push(ms); if (sceneGpu.length > 60) sceneGpu.shift(); } }).catch(() => {}).finally(() => { busy = false; });
    }
    if (frame > 60) {
      const total = Object.values(clouds.lastTimings).reduce((x, y) => x + y, 0);
      const lvl = clouds.core.flashLevel;
      if (lvl > 0) { flashFrames.push({ cloudsTotal: total, level: lvl }); if (flashFrames.length > 4000) flashFrames.shift(); }
      else { calmFrames.push(total); if (calmFrames.length > 4000) calmFrames.shift(); }
    }
    if (frame++ % 10 === 0) {
      const g = gpuMs(), c = cell(simT());
      hud.textContent = `storm  sim ${simT().toFixed(1)} s (x${TIME_SCALE})  ${live ? (stepMode ? 'stepping' : 'playing') : 'frozen'}  cell ${c.ph.toFixed(2)}  tower ${c.height.toFixed(0)} m\n` +
        `frame p50 ${quant(frameTimes, 0.5).toFixed(2)} p95 ${quant(frameTimes, 0.95).toFixed(2)} ms  ${renderer.domElement.width}x${renderer.domElement.height}  swaps ${evolution.stats.swaps}  lightning ${L.rate.toFixed(2)}/s\n` +
        Object.entries(g).map(([k, v]) => `${k.padEnd(14)} ${v.toFixed(2)}`).join('\n');
    }
    harness.frame();
  });
  applyBookmark(bookmark);

  harness.ready({
    bookmark: name => applyBookmark(name),
    report: () => ({
      gpuMs: gpuMs(), frameMs: { p50: quant(frameTimes, 0.5), p95: quant(frameTimes, 0.95) }, renderSize: [renderer.domElement.width, renderer.domElement.height],
      bookmark, simT: simT(), timeScale: TIME_SCALE, frames: frame, cloudsReady: clouds.isReady, mode: stepMode ? 'step' : live ? 'play' : 'frozen',
      storm: stormOn ? { ...cell(simT()), grow: TOWER.grow } : null,
      lightning: { rate: L.rate, flashHeld, flashFrames: flashFrames.length, calmFrames: calmFrames.length,
        cloudsTotalDuringFlash: { mean: mean(flashFrames.map(f => f.cloudsTotal)), p95: quant(flashFrames.map(f => f.cloudsTotal), 0.95), max: Math.max(0, ...flashFrames.map(f => f.cloudsTotal)) },
        cloudsTotalCalm: { mean: mean(calmFrames), p95: quant(calmFrames, 0.95) } },
      evolution: { swaps: evolution.stats.swaps, memoryMB: evolution.memoryBytes / 1048576 },
    }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
