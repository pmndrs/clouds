// V1 (Compass G4, owner decision d3 "publish and adopt WebVDB"): an artist VDB cloud read through @pmndrs/vdb, lit like our sky and
// composited inside our cloud scene (procedural HZD sky around it, water or ground below). Two routes, switchable on the page:
//
//   A  runtime  @pmndrs/vdb parses the file into its sparse NanoVDB pool on our device; one compute pass resamples it into a runtime *direct*
//               volume (vdb-direct.ts); our runtime marches it with its own lighting (M1 direct material), the sky's sun / ambient / aerial
//               perspective, its shadow map and light grid, inside the procedural sky (densityModel 'hybrid', the sky carved out of the box).
//   B  froxel   @pmndrs/vdb/three's VDBFrameRenderer draws the same pool grid (sparse source, full resolution) in the three scene, lit by the
//               sky's sun light (sky.createSun) and its environment; our clouds composite over the scene (the procedural sky is carved out of
//               the same box by an empty runtime volume).
//
// Query (every one has a visible control too): ?route=a|b  ?asset=<key>  ?sky=hybrid|off  ?surface=water|ground  ?sunel= ?sunaz=
//   ?voxel=<m> (route A lattice)  ?density=<x> (route A directDensity / route B extinction scale)  ?quality=high|ultra|...  ?clean=1
// Bookmarks (capture.mjs --shots): near, far, sunset, above.
// Assets are local only (artifacts/research, never committed): WDAS cloud (CC BY-SA 3.0, Disney) and the JangaFX CloudPack (EmberGen, CC0).
import { ACESFilmicToneMapping, DirectionalLight, Group, Matrix4, PerspectiveCamera, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass, vec4 } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend, type CloudQuality } from '@clouds/three';
import { createEmptyCloudVolume, loadCloudNoise, type GpuCloudVolume } from '@clouds/runtime';
import { VDBGridPool } from '@pmndrs/vdb';
import { VDBFrameRenderer, VDBFrameVolume, VDBGridNode, vdbSparseSource } from '@pmndrs/vdb/three';
import { createProceduralClouds, type ProceduralClouds } from '../../../packages/runtime/src/procedural';
import { PROCEDURAL_STYLES, applyProceduralStyle, captureStyleBase } from '../../../packages/runtime/src/procedural/styles';
import { installCloudsHarness } from '../harness/clouds-contract';
import { CameraRig } from '../flagship/controls';
import { createOcean } from '../scenes/ocean';
import { DirectResampler, readVdbSource, vdbDeviceLimits, type DirectInfo, type UpAxis, type VdbSource } from './vdb-direct';

declare const __REPO_ROOT__: string;
const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);

// ---- assets: research files of the main checkout (a worktree's own artifacts/ is empty; vite.config.ts researchDirs() allows both)
interface AssetDef { label: string; file: string; up: UpAxis; widthMeters: number; density: number; extinction: number }
const ASSETS: Record<string, AssetDef> = {
  'wdas-eighth': { label: 'WDAS cloud 1/8 (.vdb, 3.1 M voxels)', file: 'disney-cloud/wdas_cloud_eighth.vdb', up: 'y', widthMeters: 1800, density: 0.6, extinction: 160 },
  'wdas-eighth-nvdb': { label: 'WDAS cloud 1/8 (Fp8 .nvdb)', file: 'v1-vdb/wdas_cloud_eighth_fp8.nvdb', up: 'y', widthMeters: 1800, density: 0.6, extinction: 160 },
  'wdas-quarter-nvdb': { label: 'WDAS cloud 1/4 (Fp8 .nvdb, 24 M voxels)', file: 'v1-vdb/wdas_cloud_quarter_fp8.nvdb', up: 'y', widthMeters: 1800, density: 0.6, extinction: 160 },
  'wdas-quarter': { label: 'WDAS cloud 1/4 (.vdb, 68 MB)', file: 'disney-cloud/wdas_cloud_quarter.vdb', up: 'y', widthMeters: 1800, density: 0.6, extinction: 160 },
  'cloudpack-02': { label: 'JangaFX CloudPack 02 (EmberGen .vdb)', file: 'vdbs/CloudPack/CloudPackVDB/cloud_02_variant_0000.vdb', up: 'z', widthMeters: 1900, density: 0.6, extinction: 100 },
  'cloudpack-10': { label: 'JangaFX CloudPack 10 (EmberGen .vdb)', file: 'vdbs/CloudPack/CloudPackVDB/cloud_10_variant_0000.vdb', up: 'z', widthMeters: 1900, density: 0.6, extinction: 100 },
};
type AssetKey = string;
const RESEARCH_CANDIDATES = [`${__REPO_ROOT__}artifacts/research/`, `${__REPO_ROOT__}../../../artifacts/research/`];
let researchBase: string | null = null;
async function assetUrl(file: string): Promise<string> {
  if (!researchBase) {
    for (const base of RESEARCH_CANDIDATES) {
      // A missing file falls through to the dev server's index.html (200, text/html): only a plain-text answer counts.
      try { const r = await fetch(`/@fs${base}disney-cloud/README.txt`, { method: 'HEAD' }); if (r.ok && !(r.headers.get('content-type') ?? '').includes('html')) { researchBase = base; break; } } catch { /* next */ }
    }
    if (!researchBase) throw new Error(`artifacts/research not found (tried ${RESEARCH_CANDIDATES.join(', ')})`);
  }
  return `/@fs${researchBase}${file}`;
}

/** The cloud's base centre: 6 km north of the origin, base at 900 m (a fair-weather cumulus base). */
const CLOUD_AT = { x: 0, base: 900, z: -6000 };
const BOOKMARKS = {
  near: { pos: [400, 30, -3000], look: [0, 1500, -6000], sunEl: 38, sunAz: 150 },
  far: { pos: [-1400, 25, 1000], look: [0, 1300, -6000], sunEl: 30, sunAz: 120 },
  sunset: { pos: [900, 25, -1500], look: [0, 1300, -6000], sunEl: 4, sunAz: 290 },
  above: { pos: [2600, 2600, -2600], look: [0, 1200, -6000], sunEl: 45, sunAz: 160 },
} as const;
type BookmarkName = keyof typeof BOOKMARKS;
const isBookmark = (n: string): n is BookmarkName => n in BOOKMARKS;

const num = (k: string, d: number) => (query.has(k) && query.get(k) !== '' ? Number(query.get(k)) : d);
const state = {
  route: (query.get('route') === 'b' ? 'b' : 'a') as 'a' | 'b',
  asset: (query.get('asset') && query.get('asset')! in ASSETS ? query.get('asset')! : 'wdas-eighth') as AssetKey,
  sky: (query.get('sky') === 'off' ? 'off' : 'hybrid') as 'hybrid' | 'off',
  surface: (query.get('surface') === 'ground' ? 'ground' : 'water') as 'water' | 'ground',
  sunEl: num('sunel', NaN), sunAz: num('sunaz', NaN),
  voxel: num('voxel', 0), // 0: the source's own voxel (x world scale), clamped so the lattice stays under MAX_TEXELS
  density: num('density', NaN),
  bookmark: (isBookmark(query.get('bookmark') ?? '') ? query.get('bookmark') : 'near') as BookmarkName,
};
const MAX_TEXELS = 48e6; // route A: 8 B per texel on the GPU (nvdf + sdf + direct) plus the 4 B readback

try {
  // ---- renderer on a device with the pool's limits (VDBGridPool.requiredLimits) and room for large direct volumes
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU: no adapter');
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true, requiredLimits: vdbDeviceLimits(adapter) } as ConstructorParameters<typeof WebGPURenderer>[0]);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = num('exposure', 0.35);
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  renderer.setPixelRatio(1);
  const device = sharedBackend(renderer).device;
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, 1, 600000);
  const rig = new CameraRig(camera, renderer.domElement);
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 14, latitude: 40, north: '-Z', mirrorBelowHorizon: true });
  sky.attach(scene);
  const sun = sky.createSun({ physical: true }); // route B lights the froxel volume with this light (the clouds take the sky's LUTs directly)
  sun.attach(scene);
  const ground = sky.createGround({ mode: 'plane', size: 8000000, color: 0x34461f, roughness: 1 });
  ground.attach(scene);
  await sky.compileAsync();
  const clouds = new Clouds(renderer, { sky, quality: (query.get('quality') ?? 'high') as CloudQuality });
  const ocean = createOcean(renderer, scene, sky, { sun, reflection: dir => clouds.reflection(dir) });
  const applySurface = () => { ocean.mesh.visible = state.surface === 'water'; ground.mesh.visible = state.surface === 'ground'; };
  applySurface();
  const post = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const withClouds = clouds.node(scenePass.getTextureNode(), scenePass);
  // Route B: the froxel volume renders in its own scene (cleared to transparent black, srgbBlending off: premultiplied linear colour and
  // alpha) and goes over the clouds' composite. In the main scene it would sit under every procedural cloud, behind it included (our
  // composite only knows the scene's depth, and the froxel proxy writes none).
  const vdbScene = new Scene();
  const vdbSun = new DirectionalLight();
  vdbScene.add(vdbSun, vdbSun.target);
  const vdbPass = pass(vdbScene, camera);
  renderer.setClearColor(0x000000, 0);
  const vdbColor = vdbPass.getTextureNode();
  const outputA = withClouds, outputB = vec4(vdbColor.rgb.add(withClouds.rgb.mul(vdbColor.a.oneMinus())), withClouds.a);
  post.outputNode = outputA;
  await clouds.setNoise(await loadCloudNoise('/clouds/noise/'));

  // ---- the procedural sky (HZD shaper, Nubis lighting + exact profile, S1 'real' style): the voxel box carves it out (boxCarve)
  let proc: ProceduralClouds | null = null;
  const styleTargets = () => ({ proc: proc!.settings as unknown as Record<string, unknown>, hzd: proc!.settings.hzd as unknown as Record<string, unknown>, ndf: proc!.settings.hzd.ndf as unknown as Record<string, unknown>, cloud: clouds.core.settings as unknown as Record<string, unknown> });
  const startSky = async () => {
    proc = createProceduralClouds(device, { shaper: 'hzd' });
    proc.settings.lightingModel = 'nubis';
    proc.settings.hzd.lightProfile = 'exact';
    proc.settings.boxCarve = 300;
    await proc.load({ hzd: true });
    applyProceduralStyle(styleTargets(), 'real', captureStyleBase(styleTargets()));
    for (const [k, v] of query) if (k.startsWith('proc_') && typeof (proc.settings as unknown as Record<string, unknown>)[k.slice(5)] === 'number') (proc.settings as unknown as Record<string, number>)[k.slice(5)] = Number(v);
    for (const [k, v] of query) if (k.startsWith('hz_') && typeof (proc.settings.hzd as unknown as Record<string, unknown>)[k.slice(3)] === 'number') (proc.settings.hzd as unknown as Record<string, number>)[k.slice(3)] = Number(v);
  };
  const applySky = () => {
    clouds.core.setProceduralModel(state.sky === 'hybrid' ? proc : null);
    clouds.core.settings.densityModel = state.sky === 'hybrid' ? 'hybrid' : 'nvdf';
  };
  if (state.sky === 'hybrid') await startSky();
  void PROCEDURAL_STYLES;

  // ---- @pmndrs/vdb: one pool on our device, a resampler (route A) and a froxel renderer (route B)
  const pool = await VDBGridPool.create(device, { label: 'vdb-sky' });
  const resampler = new DirectResampler(device, pool);
  const frameRenderer = new VDBFrameRenderer();
  let grids: VDBGridNode | null = null;

  interface Loaded { key: AssetKey; src: VdbSource; id: number; fetchMs: number; addMs: number }
  const loaded = new Map<AssetKey, Loaded>();
  let current: { key: AssetKey; route: 'a' | 'b'; volume?: GpuCloudVolume; direct?: DirectInfo; froxel?: { group: Group; volume: VDBFrameVolume; source: ReturnType<typeof vdbSparseSource> }; carve?: GpuCloudVolume; setVolumeMs?: number; worldScale: number; voxel: number } | null = null;
  let lastError: string | null = null;
  let loading = false;

  async function loadAsset(key: AssetKey): Promise<Loaded> {
    const hit = loaded.get(key);
    if (hit) return hit;
    const def = ASSETS[key]!;
    const t0 = performance.now();
    const res = await fetch(await assetUrl(def.file));
    if (!res.ok) throw new Error(`fetch ${def.file}: ${res.status}${def.file.startsWith('v1-vdb/') ? ' (bake it: see work/reports/V1-vdb-sky.md)' : ''}`);
    const bytes = await res.arrayBuffer();
    const t1 = performance.now();
    const src = readVdbSource(def.file.split('/').pop()!, bytes);
    const t2 = performance.now();
    const id = pool.add(src.image, { label: key });
    pool.flush();
    await pool.settled();
    const entry: Loaded = { key, src, id, fetchMs: t1 - t0, addMs: performance.now() - t2 };
    loaded.set(key, entry);
    return entry;
  }

  /** World scale (m per VDB unit) from the asset's target width, and the route A voxel (the source voxel x scale unless ?voxel). */
  function placementFor(entry: Loaded) {
    const def = ASSETS[entry.key]!;
    const info = pool.info(entry.id);
    const ext = [0, 1, 2].map(a => info.worldBBox.max[a] - info.worldBBox.min[a]);
    const horiz = def.up === 'y' ? Math.max(ext[0], ext[2]) : Math.max(ext[0], ext[1]);
    const worldScale = def.widthMeters / horiz;
    const native = Math.max(...info.voxelSize) * worldScale;
    let voxel = state.voxel > 0 ? state.voxel : Math.max(2, Math.round(native * 2) / 2);
    for (let i = 0; i < 8; i++) {
      const L = resampler.lattice(entry.id, { worldScale, voxelSize: voxel, up: def.up });
      if (L.dims[0] * L.dims[1] * L.dims[2] <= MAX_TEXELS) break;
      voxel *= 1.25;
    }
    return { worldScale, voxel, up: def.up, native };
  }

  /** Base-centre placement of the lattice box (the runtime's setVolume convention) and the VDB-world-to-our-world matrix for route B. */
  function boxAndMatrix(entry: Loaded, p: ReturnType<typeof placementFor>) {
    const L = resampler.lattice(entry.id, { worldScale: p.worldScale, voxelSize: p.voxel, up: p.up });
    const [w, h] = L.dims;
    const minCorner = [CLOUD_AT.x - (w * p.voxel) / 2, CLOUD_AT.base, CLOUD_AT.z - (h * p.voxel) / 2];
    // our = minCorner + s * R (w - origin); R = identity (y-up) or (X, Y, Z) -> (X, Z, -Y) (z-up).
    const s = p.worldScale, o = L.origin;
    const m = new Matrix4();
    if (p.up === 'y') m.set(s, 0, 0, minCorner[0] - s * o[0], 0, s, 0, minCorner[1] - s * o[1], 0, 0, s, minCorner[2] - s * o[2], 0, 0, 0, 1);
    else m.set(s, 0, 0, minCorner[0] - s * o[0], 0, 0, s, minCorner[1] - s * o[2], 0, -s, 0, minCorner[2] + s * o[1], 0, 0, 0, 1);
    return { L, minCorner, matrix: m };
  }

  function disposeCurrent(): void {
    if (!current) return;
    if (current.froxel) { vdbScene.remove(current.froxel.group); current.froxel.volume.dispose(); current.froxel.source.dispose(); }
    // the runtime may still hold the old volume this frame: release after the new one is bound (show() calls this after setVolume)
    const old = current;
    setTimeout(() => { old.volume?.destroy(); old.carve?.destroy(); }, 500);
    current = null;
  }

  async function show(): Promise<void> {
    loading = true; lastError = null;
    try {
      const entry = await loadAsset(state.asset);
      const def = ASSETS[state.asset]!;
      const p = placementFor(entry);
      const { L, minCorner, matrix } = boxAndMatrix(entry, p);
      const base: [number, number, number] = [CLOUD_AT.x, CLOUD_AT.base, CLOUD_AT.z];
      const prev = current;
      if (state.route === 'a') {
        const { volume, info } = await resampler.build(entry.id, { worldScale: p.worldScale, voxelSize: p.voxel, up: p.up }, `vdb ${state.asset}`);
        const t = performance.now();
        await clouds.setVolume(volume, { position: base });
        clouds.core.settings.directDensity = Number.isFinite(state.density) ? state.density : def.density;
        current = { key: state.asset, route: 'a', volume, direct: info, setVolumeMs: performance.now() - t, worldScale: p.worldScale, voxel: p.voxel };
      } else {
        // An empty runtime box over the grid: the procedural sky is carved out of it (hybrid), nothing is marched in it.
        const carveVoxel = 32;
        const dims: [number, number, number] = [Math.ceil((L.dims[0] * p.voxel) / carveVoxel), Math.ceil((L.dims[1] * p.voxel) / carveVoxel), Math.ceil((L.dims[2] * p.voxel) / carveVoxel)];
        const carve = createEmptyCloudVolume(device, dims, carveVoxel, 'vdb-sky carve');
        await clouds.setVolume(carve, { position: base });
        if (!grids) grids = new VDBGridNode(renderer, pool, { profile: 'march', helpers: ['cellBoundTrilinear', 'hddaCellEnd', 'nodeAverage', 'fastTrilinear'] });
        const source = vdbSparseSource(grids, { density: entry.id }, { lod: 'coarse-pyramid', images: { density: entry.src.image } });
        const ext = Number.isFinite(state.density) ? def.extinction * state.density / def.density : def.extinction;
        const volume = new VDBFrameVolume(source, { frameRenderer, extinction: ext, angstromExponent: 0, normalizeDensity: true });
        const group = new Group();
        group.matrixAutoUpdate = false;
        group.matrix.copy(matrix);
        group.add(volume);
        vdbScene.add(group);
        current = { key: state.asset, route: 'b', froxel: { group, volume, source }, carve, worldScale: p.worldScale, voxel: p.voxel };
        void minCorner;
      }
      if (prev) { const keep = current; current = prev; disposeCurrent(); current = keep; }
      const out = state.route === 'b' ? outputB : outputA;
      if (post.outputNode !== out) { post.outputNode = out; post.needsUpdate = true; }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.warn('vdb-sky: load failed (shown on the page):', lastError);
    } finally { loading = false; }
  }

  // ---- froxel renderer settings (route B): demo 11's sky-clouds setup at 'medium', full-res self shadow
  const fs = frameRenderer.settings;
  fs.lighting = 'volume'; fs.width = 256; fs.height = 256; fs.depth = 32; fs.subSteps = 16; fs.shadowResolution = 64;
  fs.multipleScattering = 'neural'; fs.temporal = true; fs.jitter = true;
  fs.environmentLighting = 'spherical-harmonics'; fs.environmentShOrder = 2;
  fs.phase = 'dual-lobe'; fs.phaseG = 0.8; fs.phaseBackG = -0.3; fs.phaseBackWeight = 0.2;
  fs.srgbBlending = false; // premultiplied linear output over a transparent clear (see vdbPass)
  /** Route B's light: the sky's sun light (sky.createSun: colour and intensity from the sky LUTs) and the sky's environment, copied each frame. */
  const syncVdbLights = () => {
    const l = sun.light;
    vdbSun.color.copy(l.color); vdbSun.intensity = l.intensity;
    vdbSun.position.copy(l.position); vdbSun.target.position.copy(sun.target.position);
    vdbSun.updateMatrixWorld(); vdbSun.target.updateMatrixWorld();
    vdbScene.environment = scene.environment;
  };

  // ---- camera, sun, bookmarks
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);
  resize();
  const setSun = (el: number, az: number) => { state.sunEl = el; state.sunAz = az; sky.setSunDirection({ elevation: el, azimuth: az }); };
  const applyBookmark = (name: string) => {
    if (!isBookmark(name)) throw new Error(`unknown bookmark: ${name}`);
    state.bookmark = name;
    const b = BOOKMARKS[name];
    setSun(query.has('sunel') ? num('sunel', b.sunEl) : b.sunEl, query.has('sunaz') ? num('sunaz', b.sunAz) : b.sunAz);
    rig.set([...b.pos] as [number, number, number], [...b.look] as [number, number, number]);
    syncPanel();
  };

  // ---- panel (every review item has a visible control)
  const css = (el: HTMLElement, text: string) => { el.style.cssText = text; return el; };
  const hud = css(document.createElement('pre'), 'position:fixed;left:8px;top:8px;margin:0;padding:4px 6px;background:#0009;color:#fff;font:12px/1.35 monospace;pointer-events:none;max-width:56vw;white-space:pre-wrap');
  const panel = css(document.createElement('div'), 'position:fixed;right:8px;top:8px;display:flex;flex-direction:column;gap:4px;padding:6px 8px;background:#000a;color:#fff;font:12px system-ui;border-radius:4px;min-width:240px');
  document.body.append(hud, panel);
  if (query.get('clean') === '1') { hud.style.display = 'none'; panel.style.display = 'none'; }
  const row = (label: string, el: HTMLElement) => { const r = document.createElement('label'); r.style.cssText = 'display:flex;justify-content:space-between;gap:8px;align-items:center'; r.append(label, el); panel.append(r); return el; };
  const select = (label: string, options: [string, string][], value: string, on: (v: string) => void) => {
    const s = document.createElement('select');
    for (const [v, t] of options) { const o = document.createElement('option'); o.value = v; o.textContent = t; s.append(o); }
    s.value = value; s.onchange = () => on(s.value); return row(label, s) as HTMLSelectElement;
  };
  const range = (label: string, min: number, max: number, step: number, value: number, on: (v: number) => void) => {
    const i = document.createElement('input'); i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(value);
    i.oninput = () => on(Number(i.value)); return row(label, i) as HTMLInputElement;
  };
  const title = document.createElement('b'); title.textContent = 'V1 vdb-sky (Review)'; panel.prepend(title);
  const routeSel = select('route', [['a', 'A: our runtime (direct)'], ['b', 'B: vdb froxel renderer']], state.route, v => { state.route = v as 'a' | 'b'; void show(); });
  const assetSel = select('asset', Object.entries(ASSETS).map(([k, d]) => [k, d.label]), state.asset, v => { state.asset = v; state.density = NaN; void show(); });
  const skySel = select('sky', [['hybrid', 'procedural HZD sky (hybrid)'], ['off', 'off (VDB only)']], state.sky, async v => { state.sky = v as 'hybrid' | 'off'; if (state.sky === 'hybrid' && !proc) await startSky(); applySky(); });
  const surfSel = select('surface', [['water', 'water'], ['ground', 'ground']], state.surface, v => { state.surface = v as 'water' | 'ground'; applySurface(); });
  const elIn = range('sun elevation', -2, 85, 0.5, 30, v => setSun(v, state.sunAz));
  const azIn = range('sun azimuth', 0, 360, 1, 150, v => setSun(state.sunEl, v));
  const densIn = range('density x', 0.05, 3, 0.05, 1, v => {
    const def = ASSETS[state.asset]!;
    state.density = def.density * v;
    if (current?.route === 'a') clouds.core.settings.directDensity = state.density;
    if (current?.froxel) current.froxel.volume.extinction = def.extinction * v;
  });
  const qualSel = select('quality', ['low', 'medium', 'high', 'ultra'].map(q => [q, q]), clouds.quality, v => clouds.setQuality(v as CloudQuality));
  const bmRow = document.createElement('div'); bmRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
  for (const name of Object.keys(BOOKMARKS)) { const b = document.createElement('button'); b.textContent = name; b.onclick = () => applyBookmark(name); bmRow.append(b); }
  panel.append(bmRow);
  const drop = document.createElement('input'); drop.type = 'file'; drop.accept = '.vdb,.nvdb'; drop.style.cssText = 'color:#fff;font:11px monospace;max-width:220px';
  drop.onchange = async () => {
    const f = drop.files?.[0]; if (!f) return;
    const key = `file:${f.name}`;
    ASSETS[key] = { label: f.name, file: '', up: 'y', widthMeters: 1800, density: 0.6, extinction: 120 };
    const t = performance.now(); const bytes = await f.arrayBuffer();
    const src = readVdbSource(f.name, bytes);
    const id = pool.add(src.image, { label: key }); pool.flush(); await pool.settled();
    loaded.set(key, { key, src, id, fetchMs: performance.now() - t, addMs: 0 });
    const o = document.createElement('option'); o.value = key; o.textContent = f.name; assetSel.append(o); assetSel.value = key;
    state.asset = key; void show();
  };
  row('drop .vdb / .nvdb (y-up)', drop);
  function syncPanel() {
    routeSel.value = state.route; assetSel.value = state.asset; skySel.value = state.sky; surfSel.value = state.surface; qualSel.value = clouds.quality;
    elIn.value = String(state.sunEl); azIn.value = String(state.sunAz);
    densIn.value = String(Number.isFinite(state.density) ? state.density / ASSETS[state.asset]!.density : 1);
  }

  // ---- frame loop
  const frameTimes: number[] = [], sceneGpu: number[] = [];
  let last = performance.now(), frame = 0, busy = false, firstFrameAfterLoad = 0;
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pct = (p: number) => { const s = [...frameTimes].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  const gpuMs = () => { const c = clouds.timings; const cloudSum = Object.values(c).reduce((x, y) => x + y, 0); return { scene: mean(sceneGpu), ...c, cloudsTotal: cloudSum, total: mean(sceneGpu) + cloudSum }; };
  const describe = () => {
    const e = current && loaded.get(current.key);
    const lines = [`route ${state.route.toUpperCase()}  asset ${state.asset}${loading ? '  (loading...)' : ''}${lastError ? `\nERROR ${lastError}` : ''}`];
    if (e) {
      const gi = pool.info(e.id);
      lines.push(`${e.src.kind} ${(e.src.fileBytes / 1048576).toFixed(1)} MB, grid "${e.src.gridName}" ${gi.type} ${(e.src.voxels / 1e6).toFixed(2)} M voxels, pool ${(gi.imageBytes / 1048576).toFixed(1)} MB`);
      lines.push(`load ms: fetch ${e.fetchMs.toFixed(0)}  parse ${e.src.parseMs.toFixed(0)}  build ${e.src.buildMs.toFixed(0)}  pool add ${e.addMs.toFixed(0)}`);
      lines.push(`world scale ${current!.worldScale.toFixed(3)} m/unit`);
    }
    if (current?.direct) {
      const d = current.direct;
      lines.push(`direct ${d.dims.join('x')} @ ${d.voxelSize} m (${d.taps}^3 taps) = ${d.sizeMeters.map(v => v.toFixed(0)).join(' x ')} m, ${(d.gpuBytes / 1048576).toFixed(0)} MB, densityRef ${d.densityRef.toPrecision(3)}`);
      lines.push(`build ms: resample+readback ${d.timings.resampleGpuMs.toFixed(0)}  pack ${d.timings.packMs.toFixed(0)}  upload+sdf ${d.timings.uploadSdfMs.toFixed(0)}  setVolume ${(current.setVolumeMs ?? 0).toFixed(0)}`);
    }
    const g = gpuMs();
    lines.push(`frame p50 ${pct(0.5).toFixed(1)} p95 ${pct(0.95).toFixed(1)} ms  ${renderer.domElement.width}x${renderer.domElement.height}  q ${clouds.quality}`);
    lines.push(Object.entries(g).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  '));
    return lines.join('\n');
  };
  renderer.setAnimationLoop(now => {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    if (frame > 30) { frameTimes.push(dt * 1000); if (frameTimes.length > 240) frameTimes.shift(); }
    rig.update(dt);
    camera.near = Math.min(50, Math.max(0.5, camera.position.y * 0.02));
    camera.updateProjectionMatrix();
    ground.mesh.position.set(camera.position.x, 0, camera.position.z);
    sky.update(camera);
    void sky.updateAerialPerspective();
    ocean.update(dt, camera);
    pool.flush(); // no-op unless something is staged
    grids?.update();
    syncVdbLights();
    post.render();
    if (!busy) {
      busy = true;
      renderer.resolveTimestampsAsync('render').then(ms => { if (typeof ms === 'number' && ms > 0) { sceneGpu.push(ms); if (sceneGpu.length > 60) sceneGpu.shift(); } }).catch(() => {}).finally(() => { busy = false; });
    }
    if (frame++ % 10 === 0) hud.textContent = describe();
    if (!firstFrameAfterLoad && current) firstFrameAfterLoad = frame;
    harness.frame();
  });

  applySky();
  applyBookmark(state.bookmark);
  await show();
  // The procedural sky's layer needs its first amortisation cycle (open-water waits the same way); without it a capture can catch no sky.
  const t0 = performance.now();
  await new Promise<void>(resolve => {
    const poll = () => ((state.sky === 'off' || (clouds.core.skyLayer.info?.frames ?? 0) >= 20 || performance.now() - t0 > 60000) ? resolve() : requestAnimationFrame(poll));
    poll();
  });
  harness.ready({
    bookmark: async name => { applyBookmark(name); },
    report: () => {
      const e = current && loaded.get(current.key);
      return {
        route: state.route, asset: state.asset, sky: state.sky, surface: state.surface, bookmark: state.bookmark, sun: { elevation: state.sunEl, azimuth: state.sunAz },
        gpuMs: gpuMs(), frameMs: { p50: pct(0.5), p95: pct(0.95) }, renderSize: [renderer.domElement.width, renderer.domElement.height], quality: clouds.quality, frames: frame, cloudsReady: clouds.isReady,
        load: e ? { kind: e.src.kind, fileBytes: e.src.fileBytes, voxels: e.src.voxels, fetchMs: e.fetchMs, parseMs: e.src.parseMs, buildMs: e.src.buildMs, poolAddMs: e.addMs, poolBytes: pool.info(e.id).imageBytes, gridType: pool.info(e.id).type } : null,
        direct: current?.direct ?? null, setVolumeMs: current?.setVolumeMs, worldScale: current?.worldScale, voxel: current?.voxel, error: lastError,
        directDensity: clouds.core.settings.directDensity,
      };
    },
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
