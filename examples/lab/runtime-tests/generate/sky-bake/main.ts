// P9-B2: the sky layer's weather bake in the running runtime. cloudscape-gen's scene (cumulus, 512 x 512 x 64 at 8 m, ?sky=1), then a series of
// weather changes (skyLayer.configure with a new seed / coverage / species). Every frame records the bake progress and the shadow map's pending
// rows; the clouds' GPU timer readbacks give the per-frame GPU ms of the bake passes ('skyWeather' tiles, 'skyWeatherMips') and of all cloud passes.
// Checks: each change is baked in tiles over frames, no frame spends more than 1 ms in bake passes, the old window renders until the new one is
// complete (the layer never stops rendering), the swap dissolves the history instead of resetting it (no full-resolution trace frame), and the
// shadow map is invalidated once per change, on the swap frame (not while tiles land).
// ?rows=N sets SkyLayerSettings.bakeRows (2048 = the old one-shot bake, for comparison; the 1 ms check is then reported, not enforced).
// ?changes=0 skips the weather changes (the layer then matches the voxel field) for the seam bookmarks: cameras on a box wall's plane looking
// along it, so the wall projects to the vertical centre line of the image (left of it one side of the wall, right the other): a cloud that
// straddles the wall shows a step there if the voxel field and the layer disagree. wallEast / wallSouth from the side, from below the cloud base,
// wallEastTop from above.
import { ACESFilmicToneMapping, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend } from '@clouds/three';
import { CLOUD_PRESETS, createVolumeGenerator, encodeProceduralWeatherMap, loadCloudNoise, type NvdfParams } from '@clouds/runtime';
import { installCloudsHarness } from '../../../harness/clouds-contract';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const out = document.getElementById('out')!;
const lines: string[] = [];
const log = (s: string) => { lines.push(s); out.textContent = lines.join('\n'); };
const failures: string[] = [];
const check = (ok: boolean, msg: string) => { log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); };

const FIELD = { dims: [512, 512, 64] as [number, number, number], voxel: 8, base: 150, centre: [0, -2300] as const };
const ROWS = Number(query.get('rows') ?? 32);   // the SkyLayerSettings default
const CHANGES = query.get('changes') !== '0';
// Box: x -2048 .. 2048, z -4348 .. -252, y 150 .. 662 (FIELD below).
const BOOKMARKS: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  wallEast: { pos: [2048, 60, 1200], target: [2048, 330, -2800] },
  wallSouth: { pos: [-3400, 60, -252], target: [600, 330, -252] },
  wallEastTop: { pos: [2048, 2600, 300], target: [2048, 300, -2200] },
};
const preset = CLOUD_PRESETS.cumulus;
const frameWait = () => new Promise<void>(r => requestAnimationFrame(() => r()));

try {
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.35;
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight, false);
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 600000);
  camera.position.set(0, 30, 1300); camera.lookAt(0, 30 + Math.tan((2 * Math.PI) / 180) * 1000, 300);
  const applyBookmark = (name: string) => {
    const b = BOOKMARKS[name];
    if (!b) throw new Error(`unknown bookmark: ${name}`);
    camera.position.set(...b.pos); camera.up.set(0, 1, 0); camera.lookAt(...b.target); camera.updateMatrixWorld();
  };
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 14, latitude: 40, north: '-Z', mirrorBelowHorizon: true });
  sky.attach(scene);
  const sun = sky.createSun({ physical: true });
  sun.attach(scene);
  await sky.compileAsync();
  sky.setSunDirection({ elevation: 45, azimuth: 150 });
  scene.add(new Mesh(new PlaneGeometry(400000, 400000).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x2f3a28, roughness: 1 })));
  const clouds = new Clouds(renderer, { sky, quality: 'high' });
  const post = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  post.outputNode = clouds.node(scenePass.getTextureNode(), scenePass);
  const device = sharedBackend(renderer).device;
  await clouds.setNoise(await loadCloudNoise('/clouds/noise/'));

  // Per-frame GPU readbacks: GpuTimer pushes every pass of one frame synchronously from one mapAsync callback, so pushes within 0.2 ms are one frame.
  type Timed = { at: number; passes: Record<string, number> };
  const timed: Timed[] = [];
  const timer = (clouds as unknown as { timer: { push(name: string, ms: number): void } }).timer;
  const push = timer.push.bind(timer);
  let lastPush = -1;
  timer.push = (name: string, ms: number) => {
    const now = performance.now();
    if (now - lastPush > 0.2 || !timed.length) timed.push({ at: now, passes: {} });
    lastPush = now;
    const t = timed[timed.length - 1].passes;
    t[name] = (t[name] ?? 0) + ms;
    push(name, ms);
  };

  const params: Partial<NvdfParams> = { ...preset.params, seed: 7 };
  const weatherOpts = { ...preset.weather, size: [FIELD.dims[0], FIELD.dims[1]] as [number, number], seed: 7, border: 0 };
  const enc = device.createCommandEncoder();
  const weather = encodeProceduralWeatherMap(device, enc, weatherOpts);
  device.queue.submit([enc.finish()]);
  const layer = clouds.core.skyLayer;
  if (query.has('rows')) layer.settings.bakeRows = ROWS;
  layer.configure({ weather: weatherOpts, shape: params, voxelSize: FIELD.voxel, window: { size: 51200, resolution: 2048 } });
  layer.settings.enabled = true;
  // ?sky_<setting>=N overrides a SkyLayerSettings field, as on cloudscape-gen (sky_resolutionScale=1, sky_temporal=0, ...).
  for (const k of Object.keys(layer.settings)) { const v = query.get('sky_' + k); if (v !== null) (layer.settings as unknown as Record<string, number | boolean>)[k] = typeof (layer.settings as unknown as Record<string, unknown>)[k] === 'boolean' ? v === '1' : Number(v); }
  const gen = createVolumeGenerator(device, { dims: FIELD.dims, voxelSize: FIELD.voxel, weather, sliceDepth: 4, params });
  const cloudPos: [number, number, number] = [FIELD.centre[0] - (FIELD.dims[0] * FIELD.voxel) / 2, FIELD.base, FIELD.centre[1] - (FIELD.dims[1] * FIELD.voxel) / 2];

  // Frame loop: render, and remember per frame what the layer and the shadow map were doing.
  interface FrameRec { frame: number; at: number; baking: { tilesDone: number; tiles: number } | null; bakes: number; layerFrames: number; resets: number; shadowRemaining: number; shadowRefreshes: number }
  const recs: FrameRec[] = [];
  let frame = 0, genDone = false, volumeReady = false;
  renderer.setAnimationLoop(() => {
    if (!genDone) {
      const e = device.createCommandEncoder();
      gen.generate(e, 8);
      device.queue.submit([e.finish()]);
      if (gen.done) { genDone = true; void device.queue.onSubmittedWorkDone().then(() => clouds.core.setVolume(gen.volume, { position: cloudPos })).then(() => { volumeReady = true; }); }
    }
    sky.update(camera);
    void sky.updateAerialPerspective();
    post.render();
    const i = layer.info, sm = clouds.core.shadowMap.info;
    recs.push({ frame, at: performance.now(), baking: i?.baking ? { tilesDone: i.baking.tilesDone, tiles: i.baking.tiles } : null, bakes: i?.bakes ?? 0, layerFrames: i?.frames ?? 0, resets: i?.resets ?? 0, shadowRemaining: sm.remainingRows, shadowRefreshes: sm.refreshes });
    frame++;
    harness.frame();
  });

  // Wait for the volume, the first window and a settled layer, then the shadow map's first full sweep.
  while (!volumeReady || (layer.info?.frames ?? 0) < 40 || !clouds.core.shadowMap.info.valid) await frameWait();
  for (let k = 0; k < 30; k++) await frameWait();
  log(`bakeRows ${ROWS}; first window baked (${layer.info!.bakes} bake), layer rendering, shadow map valid`);

  // Weather changes (the generator's field is left as is: this isolates the layer's bake).
  const changes: { name: string; weather: typeof weatherOpts }[] = !CHANGES ? [] : [
    { name: 'seed 7 -> 8', weather: { ...weatherOpts, seed: 8 } },
    { name: 'coverageLo 0.56 -> 0.5', weather: { ...weatherOpts, seed: 8, coverageLo: 0.5 } },
    { name: 'species +0.5', weather: { ...weatherOpts, seed: 8, coverageLo: 0.5, species: 0.5 } },
  ];
  const results: Record<string, unknown>[] = [];
  for (const c of changes) {
    // Start from a quiet state: no shadow refresh pending (the previous swap's), no dissolve running.
    while (clouds.core.shadowMap.info.remainingRows > 0) await frameWait();
    for (let k = 0; k < 30; k++) await frameWait();
    const bakesBefore = layer.info!.bakes;
    const r0 = recs.length, t0 = performance.now();
    layer.configure({ weather: c.weather, shape: params, voxelSize: FIELD.voxel, window: { size: 51200, resolution: 2048 } });
    while (layer.info!.bakes === bakesBefore) await frameWait();
    for (let k = 0; k < 24; k++) await frameWait();   // readbacks lag 2-3 frames; the dissolve runs 16 frames
    const frames = recs.slice(r0);
    const t1 = frames[frames.length - 1].at;
    // GPU readbacks that landed during this window, in submission order (the ring keeps that order).
    const gpu = timed.filter(t => t.at >= t0 && t.at <= t1 + 1);
    const bakeFrames = gpu.filter(t => t.passes.skyWeather !== undefined || t.passes.skyWeatherMips !== undefined);
    const series = bakeFrames.map(t => +((t.passes.skyWeather ?? 0) + (t.passes.skyWeatherMips ?? 0)).toFixed(3));
    const total = (t: Timed) => Object.values(t.passes).reduce((a, b) => a + b, 0);
    const steady = timed.filter(t => t.at < t0).slice(-30).map(total);
    const steadyMean = steady.reduce((a, b) => a + b, 0) / Math.max(1, steady.length);
    const totals = bakeFrames.map(t => +total(t).toFixed(2));
    const swapIdx = frames.findIndex(f => f.bakes > bakesBefore);
    const bakingFrames = frames.slice(0, swapIdx).filter(f => f.baking).length;
    const layerRendered = frames.every((f, i) => i === 0 || f.layerFrames > frames[i - 1].layerFrames);
    // Shadow map: rows pending jump to N only from the swap frame on (a weather change while tiles land must not refresh it).
    const firstStale = frames.findIndex(f => f.shadowRemaining > 0);
    const worst = Math.max(...series);
    const resetsAtSwap = frames[Math.min(frames.length - 1, swapIdx + 17)].resets - frames[Math.max(0, swapIdx - 1)].resets;
    // GPU ms of all cloud passes on the frames after the swap (the dissolve), against the steady state.
    const swapGpuAt = bakeFrames.length ? bakeFrames[bakeFrames.length - 1].at : t1;
    const after = timed.filter(t => t.at > swapGpuAt).slice(0, 18).map(t => +total(t).toFixed(2));
    const res = {
      change: c.name, framesToSwap: swapIdx + 1, bakingFrames, tiles: frames[0].baking?.tiles ?? null, timedBakeFrames: series.length,
      bakeMsSeries: series, worstBakeMs: worst, cloudsGpuMsSeries: totals, cloudsGpuMsSteady: +steadyMean.toFixed(2),
      skyWeatherTiles: bakeFrames.filter(t => t.passes.skyWeather !== undefined).length, mipFrames: bakeFrames.filter(t => t.passes.skyWeatherMips !== undefined).length,
      layerRenderedEveryFrame: layerRendered, shadowFirstStaleFrame: firstStale, swapFrame: swapIdx, historyResetsAtSwap: resetsAtSwap, cloudsGpuMsAfterSwap: after,
    };
    results.push(res);
    log(`${c.name}: swap on frame ${swapIdx + 1} after the change (${bakingFrames} frames baking, ${res.tiles} tiles); bake GPU ms per frame (${series.length} timed): ${series.join(' ')}`);
    log(`  all cloud passes on those frames: ${totals.join(' ')} (steady before: ${steadyMean.toFixed(2)}); shadow map first stale on frame ${firstStale} (swap ${swapIdx})`);
    log(`  after the swap (dissolve, ${resetsAtSwap} history resets): ${after.join(' ')}`);
    check(ROWS >= 2048 || worst <= 1, `${c.name}: no frame over 1 ms of bake work (worst ${worst.toFixed(3)} ms)`);
    check(series.length >= 0.9 * ((res.tiles ?? 0) + 1), `${c.name}: GPU timings cover the bake (${series.length} of ${(res.tiles ?? 0) + 1} bake frames timed)`);
    check(layerRendered, `${c.name}: the layer renders every frame while the new window bakes (old window kept)`);
    check(firstStale === swapIdx, `${c.name}: the shadow map is invalidated on the swap frame, not before (first stale ${firstStale}, swap ${swapIdx})`);
    check(resetsAtSwap === 0, `${c.name}: the swap dissolves the sky history instead of a full-resolution reset (${resetsAtSwap} resets)`);
  }

  log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED');
  if (failures.length) harness.fail(`sky-bake: ${failures.join('; ')}`);
  else harness.ready({
    bookmark: name => applyBookmark(name),
    report: () => ({
      gpuMs: clouds.timings, frameMs: 0, renderSize: [renderer.domElement.width, renderer.domElement.height],
      bakeRows: ROWS, results, layer: layer.info,
    }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
