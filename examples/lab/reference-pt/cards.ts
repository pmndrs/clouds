// P0.4 the scene card: five cloud densities, each reaching the path tracer and the runtime from the same field (see direct.ts), and the four
// suns. One description object per cloud: where its density comes from, its world box and voxel, its extinction scale, how the runtime renders
// it, and the camera ring that frames it (radius from the cloud's centre, camera height). `loadCard` sets the cloud up on the runtime and
// returns what the page needs for the path tracer (a grid per camera, its sigma_t per unit) and for the manifest.
import { loadCloudVolume, type CloudNoiseAsset, type CloudRuntime, type CloudSettings, type CloudVolumeAsset } from '@clouds/runtime';
import { VDBGridPool } from '@pmndrs/vdb';
import { FOCUS_BOX, placeCloud } from '../flagship/bookmarks';
import { DirectResampler, readVdbSource, type UpAxis } from '../vdb-sky/vdb-direct';
import { bakeDensity, type DensityGrid, type V3 } from './bake';
import { buildDirectCloud, occupiedBox, worldToLattice, type DirectCloud } from './direct';
import { createProcBaker } from './proc-bake';
import { bakeTower } from './tower-bake';
import { bakeTower2 } from './tower2-bake';

/** P2.4a tower: sigma (1/m) at density 1, about the sky card's densityRef (0.42) to max (0.50). */
const TOWER_SIGMA = 0.45;

declare const __REPO_ROOT__: string;

export const CARD_CLOUDS = ['parkouring', 'embergen02', 'wdas', 'sky', 'stratus', 'tower', 'tower2'] as const;
export type CardCloudKey = (typeof CARD_CLOUDS)[number];

/** Suns: time of day (lat 40, day of year @pmndrs/sky's default) and the camera's ring angle from the sun's azimuth (0 = sun behind the camera). */
export const SUNS = {
  noon: { time: 13, ring: 70 },          // elevation 69.3, azimuth 221.2
  low: { time: 17.6, ring: 70 },         // 19.5, 284.7
  backlit: { time: 17.6, ring: 140 },    // 19.5: the camera on the far side of the cloud from the sun (PT1's convention)
  // P0.4: 5 degrees above the horizon. solarPosition({ timeOfDay, latitude: 40 }) solved by bisection: 18.949 h -> elevation 5.000, azimuth 296.6.
  // Ring 120: side / back lit (between the low sun's 70 and backlit's 140), so the sunset frame shows a lit rim and a shaded body.
  sunset: { time: 18.949, ring: 120 },
  // P1.7b: looking toward the sun, the sun just behind the cloud's top edge (silver-lining geometry). Ring 180 gives the camera's side of the
  // cloud; its distance and aim come from `sunwardCamera` (the ring distance is only the search's starting scale).
  sunward: { time: 16.45, ring: 180 },
} as const;
export type SunName = keyof typeof SUNS;

/** P1.7b sunward view: the sun direction this many degrees inside the top silhouette (tau >= silhouetteTau), the view aimed aimBelowDeg below the sun. */
export const SUNWARD = { insideDeg: 3, silhouetteTau: 0.1, aimBelowDeg: 7 } as const;

/** Optical depth along a ray through the grid (nearest voxel, steps of half a voxel), sigma per unit density `sigma`, capped at `cap`. */
function rayTau(g: DensityGrid, sigma: number, o: V3, d: V3, cap = 50): number {
  let t0 = 0, t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < g.min[a] || o[a] > g.max[a]) return 0; continue; }
    const ta = (g.min[a] - o[a]) / d[a], tb = (g.max[a] - o[a]) / d[a];
    t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
  }
  if (t1 <= t0) return 0;
  const [nx, ny, nz] = g.resolution, step = g.voxel * 0.5;
  let tau = 0;
  for (let t = t0 + step * 0.5; t < t1; t += step) {
    const i = Math.floor((o[0] + d[0] * t - g.min[0]) / g.voxel), j = Math.floor((o[1] + d[1] * t - g.min[1]) / g.voxel), k = Math.floor((o[2] + d[2] * t - g.min[2]) / g.voxel);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
    tau += g.density[i + nx * (j + ny * k)] * sigma * step;
    if (tau > cap) break;
  }
  return tau;
}

export interface SunwardInfo { distance: number; sunElevationDeg: number; edgeElevationDeg: number; insideDeg: number; tauAlongSun: number; silhouetteTau: number; aimBelowDeg: number }

/**
 * P1.7b: the camera for the `sunward` view. The camera stands on the far side of the cloud from the sun (horizontal direction through the
 * occupied box centre), at `height`; its horizontal distance is solved (bisection) so that, in the vertical plane toward the sun, the cloud's top
 * silhouette (highest elevation whose ray has tau >= silhouetteTau) sits insideDeg above the sun. The view looks toward the sun, aimBelowDeg lower.
 */
export function sunwardCamera(g: DensityGrid, sigma: number, sun: V3, centre: V3, height: number, distance0: number): { position: V3; target: V3; info: SunwardInfo } {
  const hl = Math.hypot(sun[0], sun[2]) || 1, h = [sun[0] / hl, sun[2] / hl];
  const elSun = (Math.asin(Math.min(1, sun[1])) * 180) / Math.PI;
  const camAt = (D: number): V3 => [centre[0] - h[0] * D, height, centre[2] - h[1] * D];
  const dirAt = (elDeg: number): V3 => { const e = (elDeg * Math.PI) / 180; return [h[0] * Math.cos(e), Math.sin(e), h[1] * Math.cos(e)]; };
  const topEdge = (D: number): number => {
    const cam = camAt(D);
    for (let el = 85; el > elSun - 20; el -= 0.1) if (rayTau(g, sigma, cam, dirAt(el), SUNWARD.silhouetteTau * 2) >= SUNWARD.silhouetteTau) return el;
    return -90;
  };
  const want = elSun + SUNWARD.insideDeg;
  let lo = distance0 * 0.2, hi = distance0 * 4;   // topEdge falls with distance
  for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (topEdge(mid) > want) lo = mid; else hi = mid; }
  const D = (lo + hi) / 2, position = camAt(D), edge = topEdge(D);
  const aim = dirAt(elSun - SUNWARD.aimBelowDeg);
  const target: V3 = [position[0] + aim[0] * 1000, position[1] + aim[1] * 1000, position[2] + aim[2] * 1000];
  const info = { distance: D, sunElevationDeg: elSun, edgeElevationDeg: edge, insideDeg: edge - elSun, tauAlongSun: rayTau(g, sigma, position, dirAt(elSun), 1e9), silhouetteTau: SUNWARD.silhouetteTau, aimBelowDeg: SUNWARD.aimBelowDeg };
  return { position, target, info };
}

export interface CardCloudDef {
  key: CardCloudKey;
  label: string;
  /** Where the density comes from, in one line (for the panel, the manifest and the report). */
  source: string;
  /** How the runtime renders it. */
  runtime: 'nvdf' | 'direct';
  /** Camera ring radius (m, horizontal, from the occupied box centre) and camera height (m above the ground). */
  camera: { distance: number; height: number };
  /** The PT side's opacity mask: 'nearest' voxel at 1 m steps (PT1's, kept for Parkouring), 'trilinear' at voxel / 4 (the PT's own lookup). */
  alphaFilter: 'nearest' | 'trilinear';
}

export const CARD_DEFS: Record<CardCloudKey, CardCloudDef> = {
  parkouring: { key: 'parkouring', label: 'A Parkouring (Nubis pack NVDF)', source: 'Nubis pack hero "Parkouring" (NVDF + runtime up-rez noise), baked per camera at 2 m', runtime: 'nvdf', camera: { distance: 1150, height: 120 }, alphaFilter: 'nearest' },
  embergen02: { key: 'embergen02', label: 'B EmberGen 02 (CloudPack VDB)', source: 'JangaFX CloudPack cloud_02_variant_0000.vdb (EmberGen, Z-up), 1 voxel = 4 m, sigma_t = 0.6 x density / m', runtime: 'direct', camera: { distance: 3100, height: 150 }, alphaFilter: 'trilinear' },
  wdas: { key: 'wdas', label: 'C Disney cloud (WDAS 1/8 VDB)', source: 'Walt Disney Animation Studios cloud, 1/8 resolution .vdb (CC BY-SA 3.0), 1800 m wide, sigma_t = 0.6 x density / m', runtime: 'direct', camera: { distance: 3400, height: 150 }, alphaFilter: 'trilinear' },
  sky: { key: 'sky', label: 'D procedural sky patch (HZD bench)', source: 'HZD bench sky (default settings, NDF seed 3, wind frozen): a baked 3 x 3 km patch of procSample', runtime: 'direct', camera: { distance: 6800, height: 150 }, alphaFilter: 'trilinear' },
  // Below the slab (1200 m from its centre, inside its 3 km footprint), looking up at about 28 degrees.
  stratus: { key: 'stratus', label: 'E stratus slab (HZD deck)', source: 'HZD shaper deck slot, form stratus (main layer off): a baked 3 x 3 km slab of procSample', runtime: 'direct', camera: { distance: 1200, height: 100 }, alphaFilter: 'trilinear' },
  // P2.4a proof: one cumulus tower from a smooth union of nested spheres (tower-bake.ts). Low camera, tower about half the frame height.
  tower: { key: 'tower', label: 'F sphere-hierarchy tower (P2.4a probe)', source: 'P2.4a: 9 + level-1 + level-2 spheres, smooth union, 2-octave noise, flat soft base; GPU bake at 8 m, sigma 0.45 / m at density 1', runtime: 'direct', camera: { distance: 8000, height: 150 }, alphaFilter: 'trilinear' },
  // P2.6a: the same tower plus the Houdini variance stage (tower2-bake.ts): ellipsoid, jittered, clumped lobes, a level 3, billow displacement on
  // the tops fading to eroded wisps underneath, non-uniform interior. Same camera and sigma as `tower` for A/B.
  tower2: { key: 'tower2', label: 'G tower + variance (P2.6a probe)', source: 'P2.6a: tower lobes as jittered clumped ellipsoids + level 3, billow displacement on tops, eroded soft underside, fbm interior; GPU bake at 8 m, sigma 0.45 / m', runtime: 'direct', camera: { distance: 8000, height: 150 }, alphaFilter: 'trilinear' },
};

/** VDB assets (local research files, never committed: artifacts/research of the main checkout), at vdb-sky's presentation. */
const VDBS: Partial<Record<CardCloudKey, { file: string; up: UpAxis; widthMeters: number; extinction: number }>> = {
  embergen02: { file: 'vdbs/CloudPack/CloudPackVDB/cloud_02_variant_0000.vdb', up: 'z', widthMeters: 1900, extinction: 0.6 },
  wdas: { file: 'disney-cloud/wdas_cloud_eighth.vdb', up: 'y', widthMeters: 1800, extinction: 0.6 },
};
/** VDB clouds sit with their lattice's base at this height, centred on the origin (vdb-sky's CLOUD_AT base). */
const VDB_BASE = 900;

/**
 * Procedural patches: the HZD model's settings on top of its defaults (the bench's: defaultProceduralSettings('hzd') + lightProfile 'exact' +
 * style 'horizon', which sets nothing), the world box of the patch and the bake voxel. Chosen with `scanProcedural` (work/reports/P0-4-scene-card.md).
 */
export const PROC_PATCHES: Record<'sky' | 'stratus', { configure: Record<string, number | string>; box: { min: V3; max: V3 }; voxel: number }> = {
  // A 3 x 3 km window of the seed-3 map whose border crosses almost no cloud (2 % of its edge columns above optical depth 1, at a 50 m scan):
  // two main cumulus masses and a few small ones, bases about 1675 m, tops to about 2525 m.
  sky: { configure: {}, box: { min: [3000, 1550, -8800], max: [6000, 3150, -5800] }, voxel: 8 },
  // The deck slot's stratus (main layer off): a continuous deck with holes. This 3 x 3 km window is the deck breaking up (column optical
  // depth median 0.9, p90 6.9 at a 25 m scan; 35 % of the columns below 0.1): shaded where it is thick, sky through its holes and thin parts.
  stratus: { configure: { coverageBias: -1, deckForm: 'stratus' }, box: { min: [2000, 590, 1000], max: [5000, 870, 4000] }, voxel: 8 },
};

const RESEARCH_CANDIDATES = [`${__REPO_ROOT__}artifacts/research/`, `${__REPO_ROOT__}../../../artifacts/research/`];
let researchBase: string | null = null;
async function researchUrl(file: string): Promise<string> {
  if (!researchBase) {
    for (const base of RESEARCH_CANDIDATES) {
      // A missing file falls through to the dev server's index.html (200, text/html): only a plain-text answer counts.
      try { const r = await fetch(`/@fs${base}disney-cloud/README.txt`, { method: 'HEAD' }); if (r.ok && !(r.headers.get('content-type') ?? '').includes('html')) { researchBase = base; break; } } catch { /* next */ }
    }
    if (!researchBase) throw new Error(`artifacts/research not found (tried ${RESEARCH_CANDIDATES.join(', ')})`);
  }
  return `/@fs${researchBase}${file}`;
}

export interface CardContext {
  device: GPUDevice;
  runtime: CloudRuntime;
  noiseAsset: CloudNoiseAsset;
  /** The page's PT voxel for Parkouring's per-camera bake (?voxel=, default 2). */
  parkouringVoxel: number;
  status(s: string): void;
}

export interface CardScene {
  def: CardCloudDef;
  /** The occupied box (the camera ring's centre is its centre). */
  focus: { min: V3; max: V3 };
  /** The PT grid seen from `camera` (Parkouring's bake depends on the camera: its noise mip follows the distance; the others do not). */
  grid(camera: V3): Promise<DensityGrid>;
  /** sigma_t per unit of the grid (1/m). */
  ptExtinction(): number;
  /** For the manifest: the cloud's parameters as both sides use them. */
  describe(): Record<string, unknown>;
}

/** Sets the cloud up on the runtime (setVolume; the caller has set the noise) and returns the card scene. */
export async function loadCard(key: CardCloudKey, ctx: CardContext): Promise<CardScene> {
  const def = CARD_DEFS[key];
  const { device, runtime } = ctx;
  if (key === 'parkouring') {
    // PT1 / P0.3 exactly: the runtime renders the NVDF with its up-rez; the PT reads a bake of that up-rezzed density per camera.
    const volumeAsset: CloudVolumeAsset = await loadCloudVolume('/clouds/parkouring/');
    const volumeMin = placeCloud(volumeAsset) as V3;
    await runtime.setVolume(volumeAsset, { position: volumeMin });
    const focus = { min: [...FOCUS_BOX.min] as V3, max: [...FOCUS_BOX.max] as V3 };
    const settings = runtime.settings as CloudSettings;
    return {
      def, focus,
      grid: camera => {
        const m = 8;   // metres of empty margin around the occupied box
        return bakeDensity(device, volumeAsset, ctx.noiseAsset, volumeMin, settings, camera, { min: FOCUS_BOX.min.map(v => v - m) as V3, max: FOCUS_BOX.max.map(v => v + m) as V3 }, ctx.parkouringVoxel);
      },
      ptExtinction: () => settings.densityScale,
      describe: () => ({ source: def.source, runtime: 'NVDF + up-rez (DENSITY_WGSL cloudDensity), CloudSettings.densityScale', volumeMin, volumeDims: volumeAsset.dims, volumeVoxel: volumeAsset.voxelSizeMeters, ptBake: `DENSITY_WGSL cloudDensity(...).x per camera at ${ctx.parkouringVoxel} m`, extinctionScale: settings.densityScale }),
    };
  }

  let built: DirectCloud;
  let extra: Record<string, unknown> = {};
  const vdb = VDBS[key];
  if (vdb) {
    ctx.status(`fetching ${vdb.file}`);
    const t0 = performance.now();
    const res = await fetch(await researchUrl(vdb.file));
    if (!res.ok) throw new Error(`fetch ${vdb.file}: ${res.status}`);
    const src = readVdbSource(vdb.file.split('/').pop()!, await res.arrayBuffer());
    const pool = await VDBGridPool.create(device, { label: 'p0.4 card' });
    const id = pool.add(src.image, { label: key });
    pool.flush(); await pool.settled();
    const resampler = new DirectResampler(device, pool);
    const info = pool.info(id);
    const ext = [0, 1, 2].map(a => info.worldBBox.max[a] - info.worldBBox.min[a]);
    const worldScale = vdb.widthMeters / (vdb.up === 'y' ? Math.max(ext[0], ext[2]) : Math.max(ext[0], ext[1]));
    const native = Math.max(...info.voxelSize) * worldScale;
    // vdb-sky's route A lattice: the source voxel x the world scale, rounded to 0.5 m (no 48 M texel cap needed for these two).
    const voxel = Math.max(2, Math.round(native * 2) / 2);
    const placement = { worldScale, voxelSize: voxel, up: vdb.up };
    ctx.status(`resampling ${key} at ${voxel} m`);
    const r = await resampler.resample(id, placement, `card ${key}`);
    pool.dispose();
    const [w, h] = r.dims;
    const min: V3 = [-(w * voxel) / 2, VDB_BASE, -(h * voxel) / 2];
    built = await buildDirectCloud(device, r.density, r.dims, voxel, min, vdb.extinction, `card ${key}`);
    extra = { file: vdb.file, gridName: src.gridName, sourceVoxels: src.voxels, up: vdb.up, worldScale, nativeVoxel: native, taps: r.taps, loadMs: performance.now() - t0,
      resample: `vdb-direct.ts DirectResampler: the mean of ${r.taps}^3 trilinear taps per texel (vdbModuleWgsl 'sample' profile)` };
  } else if (key === 'tower') {
    ctx.status('baking the P2.4a sphere tower');
    const voxel = Number(new URLSearchParams(location.search).get('towerVoxel') ?? 8);
    const levels = Number(new URLSearchParams(location.search).get('towerLevels') ?? 2);
    const { grid, perLevel } = await bakeTower(device, voxel, levels);
    console.log(`tower bake: spheres per level ${perLevel.join(' / ')}, grid ${grid.resolution.join(' x ')} at ${voxel} m, ${(grid.density.byteLength / 1048576).toFixed(0)} MB f32, ${grid.ms.toFixed(0)} ms`);
    const { density, dims } = worldToLattice(grid);
    built = await buildDirectCloud(device, density, dims, voxel, grid.min, TOWER_SIGMA, 'card tower');
    extra = { perLevel, bakeMs: grid.ms, gridDims: grid.resolution, voxel, occupancy: grid.occupancy };
  } else if (key === 'tower2') {
    ctx.status('baking the P2.6a tower with variance');
    const voxel = Number(new URLSearchParams(location.search).get('towerVoxel') ?? 8);
    const levels = Number(new URLSearchParams(location.search).get('towerLevels') ?? 3);
    const { grid, perLevel } = await bakeTower2(device, voxel, levels);
    console.log(`tower2 bake: lobes per level ${perLevel.join(' / ')}, grid ${grid.resolution.join(' x ')} at ${voxel} m, ${(grid.density.byteLength / 1048576).toFixed(0)} MB f32, ${grid.ms.toFixed(0)} ms`);
    const { density, dims } = worldToLattice(grid);
    built = await buildDirectCloud(device, density, dims, voxel, grid.min, TOWER_SIGMA, 'card tower2');
    extra = { perLevel, bakeMs: grid.ms, gridDims: grid.resolution, voxel, occupancy: grid.occupancy };
  } else {
    const patch = PROC_PATCHES[key as 'sky' | 'stratus'];
    ctx.status(`baking the procedural ${key} patch at ${patch.voxel} m`);
    const baker = await createProcBaker(device, ctx.noiseAsset, p => {
      p.settings.lightingModel = 'nubis';
      p.settings.hzd.lightProfile = 'exact';
      Object.assign(p.settings.hzd, patch.configure);
    });
    const c: V3 = [(patch.box.min[0] + patch.box.max[0]) / 2, 2, (patch.box.min[2] + patch.box.max[2]) / 2];
    const opts = { t: def.camera.distance, footprint: patch.voxel, camera: c };
    const grid = await baker.bake(patch.box, patch.voxel, opts);
    const settings = { hzd: { ...baker.proc.settings.hzd, ndf: { ...baker.proc.settings.hzd.ndf } }, densityScale: baker.proc.settings.densityScale };
    baker.dispose();
    const { density, dims } = worldToLattice(grid);
    built = await buildDirectCloud(device, density, dims, patch.voxel, grid.min, 1, `card ${key}`);
    extra = { patch: patch.box, configure: patch.configure, bake: { ...opts, kernel: 'procSample(p, t, footprint, true, 0.5).sigma * densityScale * procCarve(p)', bakeMs: grid.ms },
      ndf: { seed: settings.hzd.ndf.seed, tileMeters: settings.hzd.ndf.tileMeters, resolution: settings.hzd.ndf.resolution }, hzdExtinction: settings.hzd.extinction, layer: [settings.hzd.layerBottom, settings.hzd.layerTop] };
  }
  ctx.status(`setVolume ${key}`);
  // The runtime's default for a direct volume: setVolume's material 'auto' applies DIRECT_VOLUME_SETTINGS (M1), as vdb-sky does.
  await runtime.setVolume(built.volume, { position: built.ptGrid.min });
  runtime.settings.directDensity = built.directDensity;
  const focus = occupiedBox(built.ptGrid);
  return {
    def, focus,
    grid: async () => built.ptGrid,
    ptExtinction: () => built.ptExtinction,
    describe: () => ({
      source: def.source, runtime: 'direct volume (V2 DIRECT_DENSITY_WGSL: r16f density / densityRef marched as-is, no up-rez), material auto (DIRECT_VOLUME_SETTINGS)',
      latticeDims: built.info.dims, voxel: built.info.voxelSize, densityRef: built.info.densityRef, densityMaxSource: built.info.max, directDensity: built.directDensity,
      extinctionScale: built.directDensity, ptSigmaPerUnit: built.ptExtinction, boxMin: built.ptGrid.min, boxMax: built.ptGrid.max, occupied: focus, ...extra,
    }),
  };
}
