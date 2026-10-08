// P3-B preview: a GPU-generated 4 km cloudscape (512 x 512 x 64 at 8 m) over a ground plane, rendered through @clouds/three.
// ?preset=cumulus|congestus|stratocumulus  ?seed=N  ?jobs=N (generation jobs per frame)  ?bookmark=ground|horizon|above
// ?sky=1 turns on the distant sky layer (P3-C1/C2); sky_<setting>=N overrides a SkyLayerSettings field (sky_debug, sky_densityScale, sky_temporal, ...).
// With the layer on, the generator's weather border is 0 (one continuous field, hard partition at the box wall); ?sky_rim=N restores a cross-fade.
// ?pan=D yaws the camera D degrees per frame after a bookmark (motion test for the layer's temporal history).
// Any NvdfParams field can be overridden in the query (e.g. ?billowAmp=0.2&domeExponent=2.5) for tuning.
import { ACESFilmicToneMapping, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend } from '@clouds/three';
import { CLOUD_PRESETS, createVolumeGenerator, encodeProceduralWeatherMap, loadCloudNoise, type CloudPresetName, type NvdfParams, type VolumeGenerator } from '@clouds/runtime';
import { installCloudsHarness } from '../harness/clouds-contract';
import { CameraRig } from '../flagship/controls';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);

/** Compass: north = -Z. The field is centred 2.3 km north of the origin and spans z = -4350 .. -250. */
const BOOKMARKS = {
  ground: { pos: [0, 2, -150], sunEl: 48, sunAz: 140, lookAz: 0, pitch: 12 },
  horizon: { pos: [0, 30, 1300], sunEl: 45, sunAz: 150, lookAz: 0, pitch: 2 },
  above: { pos: [0, 1250, -1400], sunEl: 40, sunAz: 150, lookAz: 0, pitch: -32 },
  // Across the box boundary: east edge is x = 2048, south edge z = -250.
  seamEast: { pos: [1450, 70, -2300], sunEl: 45, sunAz: 150, lookAz: 90, pitch: 7 },
  seamSouth: { pos: [0, 70, -750], sunEl: 45, sunAz: 150, lookAz: 180, pitch: 8 },
  seamNorth: { pos: [0, 60, 250], sunEl: 45, sunAz: 150, lookAz: 0, pitch: 7 },
  seamHigh: { pos: [0, 520, 800], sunEl: 45, sunAz: 150, lookAz: 0, pitch: -3 },
} as const;
type BookmarkName = keyof typeof BOOKMARKS;
const NAMES = Object.keys(BOOKMARKS) as BookmarkName[];
const isName = (n: string): n is BookmarkName => n in BOOKMARKS;

const FIELD = { dims: [512, 512, 64] as [number, number, number], voxel: 8, base: 150, centre: [0, -2300] as const };
const JOBS_PER_FRAME = Number(query.get('jobs') ?? 8);
const presetName = (CLOUD_PRESETS[query.get('preset') as CloudPresetName] ? query.get('preset') : 'cumulus') as CloudPresetName;
const preset = CLOUD_PRESETS[presetName];

try {
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = Number(query.get('exposure') ?? 0.35);
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
  const ground = new Mesh(new PlaneGeometry(400000, 400000).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x2f3a28, roughness: 1 }));
  scene.add(ground);
  const clouds = new Clouds(renderer, { sky, quality: (query.get('quality') as 'high') ?? 'high' });
  const post = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  post.outputNode = clouds.node(scenePass.getTextureNode(), scenePass);

  const device = sharedBackend(renderer).device;
  await clouds.setNoise(await loadCloudNoise('/clouds/noise/'));
  const params: Partial<NvdfParams> = { ...preset.params, seed: Number(query.get('seed') ?? 7) };
  for (const k of Object.keys(params).concat(['topFraction', 'domeExponent', 'billowAmp', 'billowCellMeters', 'scaleBase', 'scaleTop', 'profileSigma', 'detailBias', 'baseDefault', 'coverageThreshold', 'baseLift'])) {
    const v = query.get(k); if (v !== null) (params as Record<string, number>)[k] = Number(v);
  }
  const skyOn = query.get('sky') === '1';
  // ?c_<setting>=N overrides a CloudSettings field (e.g. c_densityScale=0.0001 with sky_densityScale=10000&sky_rim=-1 renders the box with the layer alone: parity check).
  for (const k of Object.keys(clouds.core.settings)) { const v = query.get('c_' + k); if (v !== null && typeof (clouds.core.settings as unknown as Record<string, unknown>)[k] === 'number') (clouds.core.settings as unknown as Record<string, number>)[k] = Number(v); }
  const weatherOpts = { ...preset.weather, size: [FIELD.dims[0], FIELD.dims[1]] as [number, number], seed: Number(query.get('seed') ?? 7), ...(skyOn ? { border: 0 } : {}) };
  for (const k of ['scale', 'cellular', 'cellScale', 'coverageLo', 'coverageHi']) { const v = query.get('w_' + k); if (v !== null) (weatherOpts as unknown as Record<string, number>)[k] = Number(v); }
  const encoder = device.createCommandEncoder();
  const weather = encodeProceduralWeatherMap(device, encoder, weatherOpts);
  device.queue.submit([encoder.finish()]);
  if (skyOn) {
    // The same weather recipe and shaping the generator gets: the sky layer continues that world-anchored field outward.
    const layer = clouds.core.skyLayer;
    layer.configure({ weather: weatherOpts, shape: params, voxelSize: FIELD.voxel, rimWidth: query.get('sky_rim') === null ? undefined : Number(query.get('sky_rim')), window: { size: Number(query.get('sky_window') ?? 51200), resolution: Number(query.get('sky_res') ?? 2048) } });
    for (const k of Object.keys(layer.settings)) { const v = query.get('sky_' + k); if (v !== null) (layer.settings as unknown as Record<string, number | boolean>)[k] = typeof (layer.settings as unknown as Record<string, unknown>)[k] === 'boolean' ? v === '1' : Number(v); }
    layer.settings.enabled = true;
  }
  const gen: { current?: VolumeGenerator; frames: number; startMs: number; doneMs: number } = { frames: 0, startMs: performance.now(), doneMs: 0 };
  gen.current = createVolumeGenerator(device, { dims: FIELD.dims, voxelSize: FIELD.voxel, weather, sliceDepth: 4, params });
  const cloudPos: [number, number, number] = [FIELD.centre[0] - (FIELD.dims[0] * FIELD.voxel) / 2, FIELD.base, FIELD.centre[1] - (FIELD.dims[1] * FIELD.voxel) / 2];
  const stepGeneration = () => {
    const g = gen.current;
    if (!g) return;
    const encoder = device.createCommandEncoder({ label: 'cloud generation' });
    g.generate(encoder, JOBS_PER_FRAME);
    device.queue.submit([encoder.finish()]);
    gen.frames++;
    if (g.done) {
      gen.doneMs = performance.now() - gen.startMs;
      gen.current = undefined;
      void device.queue.onSubmittedWorkDone().then(() => clouds.core.setVolume(g.volume, { position: cloudPos })).then(() => { volumeReady = true; });
    }
  };

  // With the layer on, `ready` waits for its (async) pipelines and its first amortization cycle, so short settles still capture it.
  let volumeReady = false, readyFired = false;
  const maybeReady = () => {
    if (readyFired || !volumeReady) return;
    if (skyOn && (clouds.core.skyLayer.info?.frames ?? 0) < 20) return;
    readyFired = true; ready();
  };
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);
  resize();

  let bookmark: BookmarkName = isName(query.get('bookmark') ?? '') ? (query.get('bookmark') as BookmarkName) : 'ground';
  const panPerFrame = Number(query.get('pan') ?? 0);
  let panAz = 0;
  const lookFrom = (b: (typeof BOOKMARKS)[BookmarkName], azDeg: number) => {
    const az = (azDeg * Math.PI) / 180, pitch = (b.pitch * Math.PI) / 180;
    const d = [Math.sin(az) * Math.cos(pitch), Math.sin(pitch), -Math.cos(az) * Math.cos(pitch)];
    rig.set([...b.pos], [b.pos[0] + d[0] * 100, b.pos[1] + d[1] * 100, b.pos[2] + d[2] * 100]);
  };
  const applyBookmark = (name: string) => {
    if (!isName(name)) throw new Error(`unknown bookmark: ${name}`);
    bookmark = name;
    const b = BOOKMARKS[name];
    sky.setSunDirection({ elevation: b.sunEl, azimuth: b.sunAz });
    panAz = b.lookAz;
    lookFrom(b, panAz);
  };
  const hud = document.createElement('pre');
  hud.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:4px 6px;background:#0008;color:#fff;font:12px monospace;pointer-events:none';
  document.body.appendChild(hud);
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;right:8px;top:8px;display:flex;gap:4px';
  for (const name of NAMES) { const b = document.createElement('button'); b.textContent = name; b.onclick = () => applyBookmark(name); bar.appendChild(b); }
  document.body.appendChild(bar);

  const frameTimes: number[] = [];
  let last = performance.now(), frame = 0;
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pct = (p: number) => { const s = [...frameTimes].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  const gpuMs = () => { const c = clouds.timings; return { ...c, cloudsTotal: Object.values(c).reduce((x, y) => x + y, 0) }; };
  renderer.setAnimationLoop(now => {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    if (frame > 30) { frameTimes.push(dt * 1000); if (frameTimes.length > 240) frameTimes.shift(); }
    stepGeneration();
    if (panPerFrame !== 0) { panAz += panPerFrame; lookFrom(BOOKMARKS[bookmark], panAz); }
    rig.update(dt);
    camera.near = Math.min(50, Math.max(0.2, camera.position.y * 0.05));
    camera.updateProjectionMatrix();
    sky.update(camera);
    void sky.updateAerialPerspective();
    post.render();
    if (frame++ % 10 === 0) {
      hud.textContent = `${presetName}  frame p50 ${pct(0.5).toFixed(2)} ms  ${renderer.domElement.width}x${renderer.domElement.height}\n` +
        `clouds ${clouds.isReady ? 'on' : gen.current ? `generating ${gen.current.jobsDone}/${gen.current.jobsTotal}` : 'loading'}`;
    }
    harness.frame();
    maybeReady();
  });
  applyBookmark(bookmark);
  const ready = () => harness.ready({
    bookmark: name => applyBookmark(name),
    report: () => ({
      gpuMs: gpuMs(), frameMs: { p50: pct(0.5), p95: pct(0.95), mean: mean(frameTimes) }, renderSize: [renderer.domElement.width, renderer.domElement.height], bookmark, frames: frame, cloudsReady: clouds.isReady, sky: skyOn ? { ...clouds.core.skyLayer.settings, info: clouds.core.skyLayer.info } : null,
      generation: { preset: presetName, params, jobsPerFrame: JOBS_PER_FRAME, frames: gen.frames, wallMs: gen.doneMs },
    }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
