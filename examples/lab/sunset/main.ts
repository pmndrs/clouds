// T4 layered sunset (docs/research/deck-scenes.md §4 T4; SY s67, N3 s37 / s110): long stratocumulus bands and lumps with gaps in the low
// layer, a broken altocumulus layer at about 1.6 km above them, haze at the horizon, and the sun low in the west behind the bands.
// Composed as Guerrilla do (deck-scenes §2.6): the camera stands on the ground at the east side of the field looking west, so the bands lie across
// the view and read as silhouettes against the sun's arc; the bands run along the wind (north-south here).
//   ?bookmark=golden|sunset|afterglow|side|zenith   golden +4 deg, sunset +1 deg, afterglow -1 deg (high cloud still lit from below, low cloud in the
//                                                   earth's shadow), side: +1 deg with the sun off to the left, zenith: afterglow looking up the sun side
//   ?sunel= ?sunaz= ?lookaz= ?pitch= ?fov= ?exposure=   override the bookmark (exposure is absolute; each bookmark has its own, like a camera's auto exposure)
//   ?seed=N ?quality=low|medium|high ?sky=0 ?hud=0 ?clean=1; ?c_<setting>=N a CloudSettings number, ?sky_<setting>=N a sky-layer setting,
//   ?w_<key>=N a weather option, ?<NvdfParams key>=N a shaping parameter (as the species page).
import { ACESFilmicToneMapping, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend, type CloudQuality } from '@clouds/three';
import { CLOUD_PRESETS, createVolumeGenerator, encodeProceduralWeatherMap, loadCloudNoise, type NvdfParams, type ProceduralWeatherOptions, type VolumeGenerator } from '@clouds/runtime';
import { installCloudsHarness } from '../harness/clouds-contract';
import { CameraRig } from '../flagship/controls';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const num = (k: string, d: number) => (query.has(k) ? Number(query.get(k)) : d);

/** A view: camera on the ground plane (y up, north -Z, east +X; compass azimuths), the sun, the lens and a photographer's exposure. */
interface View { pos: [number, number, number]; lookAz: number; pitch: number; sunEl: number; sunAz: number; fov: number; exposure: number }
// The field is centred on the origin; the camera stands 2.6 km east of the centre, under the field's east part, looking west.
const CAM: [number, number, number] = [2600, 2, 0];
const BOOKMARKS: Record<string, View> = {
  golden: { pos: CAM, lookAz: 270, pitch: 16, sunEl: 4, sunAz: 262, fov: 55, exposure: 0.45 },
  sunset: { pos: CAM, lookAz: 270, pitch: 16, sunEl: 1, sunAz: 262, fov: 55, exposure: 0.7 },
  afterglow: { pos: CAM, lookAz: 270, pitch: 16, sunEl: -1, sunAz: 262, fov: 55, exposure: 1.6 },
  side: { pos: CAM, lookAz: 320, pitch: 12, sunEl: 1, sunAz: 262, fov: 55, exposure: 0.7 },
  zenith: { pos: CAM, lookAz: 270, pitch: 38, sunEl: -1, sunAz: 262, fov: 55, exposure: 1.6 },
};
const BOOKMARK_NAMES = Object.keys(BOOKMARKS);

try {
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  document.body.style.cssText = 'margin:0;overflow:hidden;background:#000';
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  renderer.setPixelRatio(1);
  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 1, 0.5, 600000);
  const rig = new CameraRig(camera, renderer.domElement);
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 19, latitude: 40, north: '-Z', mirrorBelowHorizon: true });
  sky.attach(scene);
  sky.createSun({ physical: true }).attach(scene);
  await sky.compileAsync();
  // Dry late-summer field (dark olive): its bounce is the C1 ground term, and it reads as the dark foreground band of the photos.
  scene.add(new Mesh(new PlaneGeometry(400000, 400000).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x2f3324, roughness: 1 })));
  const clouds = new Clouds(renderer, { sky, quality: (query.get('quality') as CloudQuality) ?? 'high' });
  const post = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  post.outputNode = clouds.node(scenePass.getTextureNode(), scenePass);
  const device = sharedBackend(renderer).device;
  await clouds.setNoise(await loadCloudNoise('/clouds/noise/'));
  const skyOn = query.get('sky') !== '0';

  // ---- the cloudscape: the `layered` preset (stratocumulus bands under altocumulus cells), 6.1 km square and 2 km tall at 16 m ----
  const preset = CLOUD_PRESETS.layered;
  const vol = preset.volume!;
  const dims = vol.dims, voxel = vol.voxelSize, extent = dims[0] * voxel, height = dims[2] * voxel;
  const base = num('base', 150);
  // Seed 11: Sc bands low in the west with alto cells over most of the sky; seed 5 is a near-overcast deck with one bright gap at the horizon.
  const seed = num('seed', 11);
  const params: Partial<NvdfParams> = { ...preset.params, seed };
  for (const k of Object.keys(params).concat(['billowAmp', 'billowCellMeters', 'scaleBase', 'scaleTop', 'detailBias', 'baseDefault', 'coverageThreshold', 'altoBase', 'altoDepth', 'shearX', 'shearY'])) {
    const v = query.get(k); if (v !== null) (params as Record<string, number>)[k] = Number(v);
  }
  const k = extent / 4096; // the preset's cell counts are per 4096 m map
  const w = preset.weather;
  const weather: ProceduralWeatherOptions = {
    ...w, size: [dims[0], dims[1]], seed, extentMeters: extent, heightMeters: height,
    ...(w.cellScale ? { cellScale: w.cellScale * k } : {}), ...(w.scale ? { scale: w.scale * k } : {}),
    ...(w.alto ? { alto: { ...w.alto, cells: (w.alto.cells ?? 18) * k, patches: (w.alto.patches ?? 1.5) * k } } : {}),
    ...(skyOn ? { border: 0 } : {}),
  };
  for (const key of ['scale', 'cellular', 'cellScale', 'coverageLo', 'coverageHi', 'fractus', 'lobeSplit', 'species']) { const v = query.get('w_' + key); if (v !== null) (weather as unknown as Record<string, number>)[key] = Number(v); }
  if (query.has('w_alto')) weather.alto = { ...weather.alto!, cover: Number(query.get('w_alto')) };
  if (query.has('w_range')) weather.speciesRange = query.get('w_range')!.split(',').map(Number) as [number, number];
  if (query.has('w_cells')) weather.alto = { ...weather.alto!, cells: Number(query.get('w_cells')) * k };
  if (query.has('w_patches')) weather.alto = { ...weather.alto!, patches: Number(query.get('w_patches')) * k };
  if (query.has('w_wind')) weather.wind = query.get('w_wind')!.split(',').map(Number) as [number, number];
  const encoder = device.createCommandEncoder();
  const weatherTex = encodeProceduralWeatherMap(device, encoder, weather);
  device.queue.submit([encoder.finish()]);
  if (skyOn) {
    const layer = clouds.core.skyLayer;
    layer.configure({ weather, shape: params, voxelSize: voxel, horizon: false });
    for (const key of Object.keys(layer.settings)) { const v = query.get('sky_' + key); if (v !== null) (layer.settings as unknown as Record<string, number | boolean>)[key] = typeof (layer.settings as unknown as Record<string, unknown>)[key] === 'boolean' ? v === '1' : Number(v); }
    layer.settings.enabled = true;
  }
  // T4 tuning: keep 40% of the sun's share in the scattering body at low sun (C1 default 0.05). The thin altocumulus cells then glow peach/pink from
  // below as in the photos while the dense low bands stay mauve/slate (they lose the sun through bodyDepth and the earth's shadow anyway). With the
  // default the alto cells are only rim-lit (warm area above 5 deg: 9% at sunset vs 19% here; report T4). An engine task keys this on optical depth.
  clouds.core.settings.bodySunFloor = 0.4;
  for (const key of Object.keys(clouds.core.settings)) { const v = query.get('c_' + key); if (v !== null && typeof (clouds.core.settings as unknown as Record<string, unknown>)[key] === 'number') (clouds.core.settings as unknown as Record<string, number>)[key] = Number(v); }
  if (query.get('phase') === 'mie') clouds.core.settings.phaseModel = 'mie';

  let gen: VolumeGenerator | undefined = createVolumeGenerator(device, { dims, voxelSize: voxel, weather: weatherTex, sliceDepth: 4, params, label: 'sunset layered' });
  let volumeReady = false, skyFramesAtSwap = 0;
  const genStart = performance.now();
  let genMs = 0;
  const stepGeneration = () => {
    const g = gen;
    if (!g) return;
    const enc = device.createCommandEncoder({ label: 'sunset generation' });
    g.generate(enc, num('jobs', 8));
    device.queue.submit([enc.finish()]);
    if (g.done) {
      gen = undefined;
      genMs = performance.now() - genStart;
      void device.queue.onSubmittedWorkDone()
        .then(() => clouds.core.setVolume(g.volume, { position: [-extent / 2, base, -extent / 2] }))
        .then(() => { volumeReady = true; skyFramesAtSwap = clouds.core.skyLayer.info?.frames ?? 0; });
    }
  };

  // ---- views ----
  let bookmark = BOOKMARK_NAMES.includes(query.get('bookmark') ?? '') ? query.get('bookmark')! : 'sunset';
  let view: View = BOOKMARKS[bookmark];
  const applyBookmark = (name: string) => {
    const b = BOOKMARKS[name];
    if (!b) throw new Error(`unknown bookmark: ${name}`);
    bookmark = name;
    view = { ...b, sunEl: num('sunel', b.sunEl), sunAz: num('sunaz', b.sunAz), lookAz: num('lookaz', b.lookAz), pitch: num('pitch', b.pitch), fov: num('fov', b.fov), exposure: num('exposure', b.exposure) };
    sky.setSunDirection({ elevation: view.sunEl, azimuth: view.sunAz });
    renderer.toneMappingExposure = view.exposure;
    camera.fov = view.fov;
    camera.updateProjectionMatrix();
    const az = (view.lookAz * Math.PI) / 180, p = (view.pitch * Math.PI) / 180;
    const d = [Math.sin(az) * Math.cos(p), Math.sin(p), -Math.cos(az) * Math.cos(p)];
    rig.set([...view.pos], [view.pos[0] + d[0] * 100, view.pos[1] + d[1] * 100, view.pos[2] + d[2] * 100]);
  };
  applyBookmark(bookmark);

  const hud = document.createElement('pre');
  hud.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:4px 6px;background:#0008;color:#fff;font:12px monospace;pointer-events:none';
  if (query.get('hud') !== '0' && query.get('clean') !== '1') document.body.appendChild(hud);
  if (query.get('clean') !== '1') {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;right:8px;top:8px;display:flex;flex-wrap:wrap;gap:4px;max-width:60vw;justify-content:flex-end';
    for (const name of BOOKMARK_NAMES) { const b = document.createElement('button'); b.textContent = name; b.onclick = () => applyBookmark(name); bar.appendChild(b); }
    const sl = document.createElement('label');
    sl.style.cssText = 'color:#fff;font:12px monospace;background:#0008;padding:2px 4px';
    const i = document.createElement('input'); i.type = 'range'; i.min = '-6'; i.max = '20'; i.step = '0.25'; i.value = String(view.sunEl);
    i.oninput = () => { view.sunEl = Number(i.value); sky.setSunDirection({ elevation: view.sunEl, azimuth: view.sunAz }); };
    sl.append('sun el ', i);
    bar.appendChild(sl);
    document.body.appendChild(bar);
  }
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);
  resize();

  let readyFired = false;
  const maybeReady = () => {
    if (readyFired || !volumeReady || !clouds.isReady) return;
    if (skyOn && (clouds.core.skyLayer.info?.frames ?? 0) - skyFramesAtSwap < 20) return;
    readyFired = true;
    harness.ready({
      bookmark: name => applyBookmark(name),
      report: () => ({
        gpuMs: gpuMs(), frameMs: { p50: pct(0.5), p95: pct(0.95), mean: mean(frameTimes) }, renderSize: [renderer.domElement.width, renderer.domElement.height],
        bookmark, view, quality: query.get('quality') ?? 'high', frames: frame, generation: { dims, voxel, wallMs: genMs, params, weather },
        sky: skyOn ? { info: clouds.core.skyLayer.info } : null,
      }),
    });
  };
  const frameTimes: number[] = [];
  let last = performance.now(), frame = 0;
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pct = (p: number) => { const s = [...frameTimes].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  const gpuMs = () => { const c = clouds.timings; return { ...c, cloudsTotal: Object.values(c).reduce((x, y) => x + y, 0) }; };
  renderer.setAnimationLoop(now => {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    if (frame > 30) { frameTimes.push(dt * 1000); if (frameTimes.length > 240) frameTimes.shift(); }
    stepGeneration();
    rig.update(dt);
    camera.near = Math.min(50, Math.max(0.2, camera.position.y * 0.05));
    camera.updateProjectionMatrix();
    sky.update(camera);
    void sky.updateAerialPerspective();
    post.render();
    if (frame++ % 10 === 0) {
      hud.textContent = `T4 layered sunset  ${bookmark}  sun el ${view.sunEl.toFixed(2)} az ${view.sunAz}  exposure ${view.exposure}\n` +
        `frame p50 ${pct(0.5).toFixed(2)} ms  clouds gpu ${gpuMs().cloudsTotal.toFixed(2)} ms  ${renderer.domElement.width}x${renderer.domElement.height}  ${gen ? `generating ${gen.jobsDone}/${gen.jobsTotal}` : 'on'}`;
    }
    harness.frame();
    maybeReady();
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
