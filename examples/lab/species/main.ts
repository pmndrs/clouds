// P9-C species page: one generated cloudscape per cloud species (the species profile table, generate/shaders.ts the SP_* species rows / the H_* rows), plus a
// mixed sky (stratocumulus, humilis, mediocris and congestus regions under altocumulus patches) and a valley sea (stratus over a terrain stub).
//   ?species=humilis|mediocris|congestus|stratocumulus|altocumulus|stratus|valley|mixed|cumulus   (default mixed)
//   ?bookmark=ground|side|above|horizon|wall   views; a species name as a bookmark regenerates that species (give it time: --settle 200)
//   ?sky=0 turns the distant sky layer off. ?horizon=1|0 forces the HZD horizon rule (default: on for mixed and cumulus, off for one species,
//   so an isolated capture shows that species to the horizon). ?seed=N ?jobs=N; NvdfParams fields and w_<weather option> override as on cloudscape-gen.
//   ?fields=low|all: what the variety harness reads (default low: the columns below the altocumulus layer, so the cumulus layer is scored on its own).
import { ACESFilmicToneMapping, BufferAttribute, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend } from '@clouds/three';
import { CLOUD_PRESETS, createVolumeGenerator, encodeProceduralWeatherMap, loadCloudNoise, type CloudPreset, type CloudPresetName, type NvdfParams, type ProceduralWeatherOptions, type VolumeGenerator } from '@clouds/runtime';
import { installCloudsHarness, type CloudColumnFields } from '../harness/clouds-contract';
import { CameraRig } from '../flagship/controls';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const num = (k: string, d: number) => (query.has(k) ? Number(query.get(k)) : d);

const SPECIES = ['humilis', 'mediocris', 'congestus', 'stratocumulus', 'altocumulus', 'stratus', 'valley', 'mixed', 'cumulus'] as const;
type Species = (typeof SPECIES)[number];
const isSpecies = (n: string): n is Species => (SPECIES as readonly string[]).includes(n);
const DEFAULT_VOLUME = { dims: [512, 512, 64] as [number, number, number], voxelSize: 8 };

/** The valley sea: stratus (a flat lid 170 m over the condensation level) pooled between hills of the terrain stub. */
const VALLEY: CloudPreset = {
  weather: { ...CLOUD_PRESETS.stratus.weather, coverageLo: 0.05, coverageHi: 0.3, border: 0.12 },
  params: { ...CLOUD_PRESETS.stratus.params, baseDefault: 0.16 },
};
const presetOf = (s: Species): CloudPreset => (s === 'valley' ? VALLEY : CLOUD_PRESETS[s as CloudPresetName]);

/**
 * Terrain for the valley sea (CONTENT): rolling hills and ridges, 0-430 m above the volume base, the same function for the ground mesh and the
 * generator's terrain stub (VolumeGeneratorOptions.terrain). x, z world metres.
 */
function hills(x: number, z: number): number {
  const r = (a: number, b: number) => Math.sin(a) * Math.cos(b);
  const h = 0.5 + 0.28 * r(x / 610, z / 730) + 0.18 * r(x / 260 + 1.3, z / 310 - 0.7) + 0.07 * r(x / 120 + 4.1, z / 140 + 2.2);
  const ridge = Math.pow(Math.abs(Math.sin(x / 900 + z / 1500)), 3);
  return Math.max(0, 430 * Math.min(1, Math.max(0, h - 0.22) * 1.4) * (0.55 + 0.45 * ridge));
}
/** float32 -> float16 bits (round to nearest even is not needed for a heightfield). */
function toHalf(v: number): number {
  const f = new Float32Array([v]), u = new Uint32Array(f.buffer)[0];
  const sign = (u >> 16) & 0x8000, exp = ((u >> 23) & 0xff) - 127 + 15, mant = (u >> 13) & 0x3ff;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7c00;
  return sign | (exp << 10) | mant;
}

/** Per-column maps of the generated field (as examples/lab/harness readCloudColumns), limited to z < zMax so the cumulus layer is scored without the altocumulus above it. */
async function readColumns(device: GPUDevice, nvdf: GPUTexture, dims: readonly [number, number, number], voxel: number, zMax: number, meta: Record<string, unknown>): Promise<CloudColumnFields> {
  const [nx, ny, nz] = dims;
  const bytesPerRow = Math.ceil((nx * 4) / 256) * 256;
  const buffer = device.createBuffer({ size: bytesPerRow * ny * nz, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture: nvdf }, { buffer, bytesPerRow, rowsPerImage: ny }, [nx, ny, nz]);
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const data = new Uint8Array(buffer.getMappedRange());
  const thickness = new Uint8Array(nx * ny), baseZ = new Uint8Array(nx * ny).fill(255), topZ = new Uint8Array(nx * ny).fill(255);
  for (let z = 0; z < Math.min(nz, zMax); z++) for (let y = 0; y < ny; y++) {
    const row = (z * ny + y) * bytesPerRow, col = y * nx;
    for (let x = 0; x < nx; x++) {
      if (data[row + x * 4] === 0) continue;
      thickness[col + x]++;
      if (baseZ[col + x] === 255) baseZ[col + x] = z;
      topZ[col + x] = z;
    }
  }
  buffer.unmap(); buffer.destroy();
  const b64 = (a: Uint8Array) => { let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
  return { size: [nx, ny, nz], voxel, thickness: b64(thickness), baseZ: b64(baseZ), topZ: b64(topZ), meta };
}

/**
 * Generator cost (?timegen=1): the current field generated three times with a timestamp pair per job (8 z per job), with the species profiles on
 * and off (the same weather), best of the last two. Reported as report().genTiming.
 */
async function timeGeneration(device: GPUDevice, f: { dims: [number, number, number]; voxel: number; params: Partial<NvdfParams> }, weather: GPUTexture, terrain?: GPUTexture) {
  if (!device.features.has('timestamp-query')) return null;
  const run = async (params: Partial<NvdfParams>) => {
    let best = Infinity, jobs = 0;
    const byStage: Record<string, number> = {};
    for (let rep = 0; rep < 3; rep++) {
      const qs = device.createQuerySet({ type: 'timestamp', count: 512 });
      let n = 0;
      const labels: string[] = [];
      const gen = createVolumeGenerator(device, { dims: f.dims, voxelSize: f.voxel, weather, sliceDepth: 8, params, terrain, timestamps: label => { if (n >= 256) return undefined; labels.push(label); const w = { querySet: qs, beginningOfPassWriteIndex: 2 * n, endOfPassWriteIndex: 2 * n + 1 }; n++; return w; } });
      const enc = device.createCommandEncoder();
      gen.generate(enc);
      const res = device.createBuffer({ size: 512 * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      const read = device.createBuffer({ size: 512 * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      enc.resolveQuerySet(qs, 0, 2 * n, res, 0);
      enc.copyBufferToBuffer(res, 0, read, 0, 512 * 8);
      device.queue.submit([enc.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const t = new BigInt64Array(read.getMappedRange());
      let total = 0;
      const stage: Record<string, number> = {};
      for (let i = 0; i < n; i++) { const ms = Number(t[2 * i + 1] - t[2 * i]) / 1e6; total += ms; stage[labels[i]] = (stage[labels[i]] ?? 0) + ms; }
      read.unmap(); read.destroy(); res.destroy(); qs.destroy(); jobs = gen.jobsTotal; gen.destroy();
      if (rep > 0 && total < best) { best = total; Object.assign(byStage, stage); }
    }
    return { totalMs: best, jobs, perJobMs: best / jobs, byStage };
  };
  return { profiles: await run({ ...f.params, profiles: true }), legacy: await run({ ...f.params, profiles: false }) };
}

try {
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = num('exposure', 0.35);
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
  const flat = new Mesh(new PlaneGeometry(400000, 400000).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x2f3a28, roughness: 1 }));
  scene.add(flat);
  const clouds = new Clouds(renderer, { sky, quality: (query.get('quality') as 'high') ?? 'high' });
  const post = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  post.outputNode = clouds.node(scenePass.getTextureNode(), scenePass);
  const device = sharedBackend(renderer).device;
  await clouds.setNoise(await loadCloudNoise('/clouds/noise/'));
  const skyOn = query.get('sky') !== '0';
  const jobsPerFrame = num('jobs', 8);

  // ---- one species: weather, generator, sky layer, terrain ----
  interface Field { species: Species; dims: [number, number, number]; voxel: number; base: number; centre: [number, number]; weather: ProceduralWeatherOptions; params: Partial<NvdfParams> }
  let field!: Field;
  let gen: VolumeGenerator | undefined, shown: VolumeGenerator | undefined, weatherTex: GPUTexture | undefined, terrainTex: GPUTexture | undefined, terrainMesh: Mesh | undefined;
  let genStart = 0, genMs = 0, genFrames = 0, volumeReady = false, skyFramesAtSwap = 0;
  const setup = (species: Species) => {
    const preset = presetOf(species);
    const vol = preset.volume ?? DEFAULT_VOLUME;
    const dims = vol.dims, voxel = vol.voxelSize, extent = dims[0] * voxel, height = dims[2] * voxel;
    // The box's base centre: its south edge 250 m north of the origin (the ground bookmark stands just south of it).
    const base = species === 'valley' ? 0 : num('base', 150);
    const centre: [number, number] = [0, -(extent / 2 + 250)];
    const seed = num('seed', 7);
    const params: Partial<NvdfParams> = { ...preset.params, seed };
    for (const k of Object.keys(params).concat(['topFraction', 'domeExponent', 'billowAmp', 'billowCellMeters', 'scaleBase', 'scaleTop', 'profileSigma', 'detailBias', 'baseDefault', 'coverageThreshold', 'baseLift', 'altoBase', 'altoDepth'])) {
      const v = query.get(k); if (v !== null) (params as Record<string, number>)[k] = Number(v);
    }
    // Cell sizes are per map: keep the preset's metres at the preset's 4096 m reference when the volume is wider.
    const k = extent / 4096;
    const w = preset.weather;
    const weather: ProceduralWeatherOptions = {
      ...w, size: [dims[0], dims[1]], seed, extentMeters: extent, heightMeters: height,
      ...(w.cellScale ? { cellScale: w.cellScale * k } : {}), ...(w.scale ? { scale: w.scale * k } : {}),
      ...(w.alto ? { alto: { ...w.alto, cells: (w.alto.cells ?? 18) * k, patches: (w.alto.patches ?? 1.5) * k } } : {}),
      ...(skyOn ? { border: 0 } : {}),
    };
    for (const key of ['scale', 'cellular', 'cellScale', 'coverageLo', 'coverageHi', 'fractus', 'lobeSplit', 'species']) { const v = query.get('w_' + key); if (v !== null) (weather as unknown as Record<string, number>)[key] = Number(v); }
    field = { species, dims, voxel, base, centre, weather, params };
    // Terrain stub (valley): heights above the volume base on the map's texels, and the same hills as a mesh.
    terrainTex?.destroy(); terrainTex = undefined;
    if (terrainMesh) { scene.remove(terrainMesh); terrainMesh.geometry.dispose(); terrainMesh = undefined; }
    flat.visible = species !== 'valley';
    const minX = centre[0] - extent / 2, minZ = centre[1] - extent / 2;
    if (species === 'valley') {
      const [nx, ny] = [dims[0], dims[1]];
      const data = new Uint16Array(nx * ny);
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) data[y * nx + x] = toHalf(hills(minX + (x + 0.5) * voxel, minZ + (y + 0.5) * voxel) - base);
      terrainTex = device.createTexture({ label: 'valley terrain', size: [nx, ny], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      device.queue.writeTexture({ texture: terrainTex }, data, { bytesPerRow: nx * 2 }, [nx, ny]);
      const span = 40000, seg = 400;
      const geo = new PlaneGeometry(span, span, seg, seg).rotateX(-Math.PI / 2);
      geo.translate(centre[0], 0, centre[1]);
      const pos = geo.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < pos.count; i++) pos.setY(i, hills(pos.getX(i), pos.getZ(i)));
      geo.computeVertexNormals();
      terrainMesh = new Mesh(geo, new MeshStandardMaterial({ color: 0x3b4630, roughness: 1 }));
      scene.add(terrainMesh);
    }
    const encoder = device.createCommandEncoder();
    const oldWeather = weatherTex;
    weatherTex = encodeProceduralWeatherMap(device, encoder, weather);
    device.queue.submit([encoder.finish()]);
    if (skyOn) {
      const layer = clouds.core.skyLayer;
      const horizonOn = query.has('horizon') ? query.get('horizon') === '1' : species === 'mixed' || species === 'cumulus';
      layer.configure({ weather, shape: params, voxelSize: voxel, horizon: horizonOn ? undefined : false, rimWidth: query.has('sky_rim') ? Number(query.get('sky_rim')) : undefined, window: { size: num('sky_window', 51200), resolution: num('sky_res', 2048) } });
      for (const key of Object.keys(layer.settings)) { const v = query.get('sky_' + key); if (v !== null) (layer.settings as unknown as Record<string, number | boolean>)[key] = typeof (layer.settings as unknown as Record<string, unknown>)[key] === 'boolean' ? v === '1' : Number(v); }
      layer.settings.enabled = true;
    }
    // ?c_<setting>=N overrides a CloudSettings field (c_densityScale=0.0001 with sky_densityScale=10000&sky_rim=-1: the box drawn by the layer alone, a parity check).
    for (const key of Object.keys(clouds.core.settings)) { const v = query.get('c_' + key); if (v !== null && typeof (clouds.core.settings as unknown as Record<string, unknown>)[key] === 'number') (clouds.core.settings as unknown as Record<string, number>)[key] = Number(v); }
    gen?.destroy();
    gen = createVolumeGenerator(device, { dims, voxelSize: voxel, weather: weatherTex, sliceDepth: 4, params, terrain: terrainTex, label: `species ${species}` });
    genStart = performance.now(); genFrames = 0; volumeReady = false;
    void device.queue.onSubmittedWorkDone().then(() => oldWeather?.destroy());
  };
  const stepGeneration = () => {
    const g = gen;
    if (!g) return;
    const encoder = device.createCommandEncoder({ label: 'species generation' });
    g.generate(encoder, jobsPerFrame);
    device.queue.submit([encoder.finish()]);
    genFrames++;
    if (g.done) {
      genMs = performance.now() - genStart;
      gen = undefined;
      const f = field;
      const old = shown;
      shown = g;
      void device.queue.onSubmittedWorkDone()
        .then(() => clouds.core.setVolume(g.volume, { position: [f.centre[0] - (f.dims[0] * f.voxel) / 2, f.base, f.centre[1] - (f.dims[1] * f.voxel) / 2] }))
        .then(() => { volumeReady = true; skyFramesAtSwap = clouds.core.skyLayer.info?.frames ?? 0; old?.destroy(); });
    }
  };

  // ---- views, relative to the box (its south edge is at z = -250, its base at field.base) ----
  type View = { pos: [number, number, number]; sunEl: number; sunAz: number; lookAz: number; pitch: number };
  const views = (): Record<'ground' | 'side' | 'above' | 'horizon' | 'wall', View> => {
    const ext = field.dims[0] * field.voxel, h = field.dims[2] * field.voxel, b = field.base;
    const tall = h > 1000;
    return {
      // on the ground under the field's south edge, looking north and up into it
      // (valley: standing 50 m over the sea's flat top, looking across it)
      ground: { pos: [0, field.species === 'valley' ? 240 : 2, -150], sunEl: 48, sunAz: 140, lookAz: 0, pitch: field.species === 'valley' ? -3 : tall ? 16 : 14 },
      // the silhouettes: from the ground well south of the box, nearly level (the sky layer's clouds overhead are the same species)
      side: { pos: [0, 2, tall ? 2600 : 1400], sunEl: 35, sunAz: 120, lookAz: 0, pitch: tall ? 7 : 4 },
      // from above, looking down on the field (footprints, bands, cell spacing)
      above: { pos: [0, b + h + (tall ? 2600 : 1100), tall ? 1600 : -800], sunEl: 40, sunAz: 150, lookAz: 0, pitch: -40 },
      // the far field: from the ground, a little south, low
      horizon: { pos: [0, 30, 1300], sunEl: 45, sunAz: 150, lookAz: 0, pitch: tall ? 4 : 2 },
      // parity at the box wall: on the east wall's plane (x = ext / 2) just inside its south end, looking north along it and up:
      // the voxel field is left of the image's centre column, the sky layer right of it
      wall: { pos: [ext / 2, 2, -400], sunEl: 35, sunAz: 120, lookAz: 0, pitch: tall ? 22 : 14 },
    } satisfies Record<string, View>;
  };
  const VIEW_NAMES = ['ground', 'side', 'above', 'horizon', 'wall'] as const;
  type ViewName = (typeof VIEW_NAMES)[number];
  let view: ViewName = (VIEW_NAMES as readonly string[]).includes(query.get('bookmark') ?? '') ? (query.get('bookmark') as ViewName) : 'side';
  const valleyView = (): View => ({ pos: [-600, 520, 900], sunEl: 30, sunAz: 120, lookAz: 8, pitch: -9 });
  const applyView = (name: ViewName) => {
    view = name;
    const v = field.species === 'valley' && name === 'side' ? valleyView() : views()[name];
    sky.setSunDirection({ elevation: num('sunel', v.sunEl), azimuth: num('sunaz', v.sunAz) });
    const az = (v.lookAz * Math.PI) / 180, pitch = (v.pitch * Math.PI) / 180;
    const d = [Math.sin(az) * Math.cos(pitch), Math.sin(pitch), -Math.cos(az) * Math.cos(pitch)];
    rig.set([...v.pos], [v.pos[0] + d[0] * 100, v.pos[1] + d[1] * 100, v.pos[2] + d[2] * 100]);
  };
  const applyBookmark = (name: string) => {
    if (isSpecies(name)) { setup(name); applyView(view); return; }
    if (!(VIEW_NAMES as readonly string[]).includes(name)) throw new Error(`unknown bookmark: ${name}`);
    applyView(name as ViewName);
  };

  const initial = query.get('species') ?? 'mixed';
  if (!isSpecies(initial)) throw new Error(`unknown species: ${initial}`);
  setup(initial);
  applyView(view);

  const hud = document.createElement('pre');
  hud.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:4px 6px;background:#0008;color:#fff;font:12px monospace;pointer-events:none';
  document.body.appendChild(hud);
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;right:8px;top:8px;display:flex;flex-wrap:wrap;gap:4px;max-width:60vw;justify-content:flex-end';
  for (const name of [...SPECIES, ...VIEW_NAMES]) { const b = document.createElement('button'); b.textContent = name; b.onclick = () => applyBookmark(name); bar.appendChild(b); }
  document.body.appendChild(bar);
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);
  resize();

  let genTiming: Awaited<ReturnType<typeof timeGeneration>> = null;
  let readyFired = false;
  const maybeReady = () => {
    if (readyFired || !volumeReady) return;
    if (skyOn && (clouds.core.skyLayer.info?.frames ?? 0) - skyFramesAtSwap < 20 && (clouds.core.skyLayer.info?.frames ?? 0) < 20) return;
    readyFired = true;
    if (query.get('timegen') === '1') { void timeGeneration(device, field, weatherTex!, terrainTex).then(t => { genTiming = t; ready(); }); return; }
    ready();
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
      hud.textContent = `species ${field.species}  view ${view}  frame p50 ${pct(0.5).toFixed(2)} ms  ${renderer.domElement.width}x${renderer.domElement.height}\n` +
        `field ${field.dims.join('x')} @ ${field.voxel} m  ${gen ? `generating ${gen.jobsDone}/${gen.jobsTotal}` : clouds.isReady ? 'on' : 'loading'}`;
    }
    harness.frame();
    maybeReady();
  });
  const ready = () => harness.ready({
    bookmark: name => applyBookmark(name),
    fields: () => {
      const f = field;
      const altoZ = f.params.altoBase ? Math.floor(f.params.altoBase / f.voxel) - 2 : f.dims[2];
      const zMax = query.get('fields') === 'all' ? f.dims[2] : altoZ;
      return readColumns(device, shown!.volume.nvdf, f.dims, f.voxel, zMax, { preset: f.species, weather: f.weather, params: f.params, extentMeters: f.dims[0] * f.voxel, baseMeters: f.base, zMax });
    },
    report: () => ({
      gpuMs: gpuMs(), frameMs: { p50: pct(0.5), p95: pct(0.95), mean: mean(frameTimes) }, renderSize: [renderer.domElement.width, renderer.domElement.height],
      bookmark: view, species: field.species, frames: frame, cloudsReady: clouds.isReady,
      sky: skyOn ? { info: clouds.core.skyLayer.info } : null,
      genTiming,
      generation: { species: field.species, dims: field.dims, voxel: field.voxel, params: field.params, jobsPerFrame, frames: genFrames, wallMs: genMs },
    }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
