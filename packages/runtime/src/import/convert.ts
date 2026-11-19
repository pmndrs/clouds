// CPU half of the in-browser .vdb import: parse, pick grids, resample onto the runtime lattice, derive the NVDF channels.
// The GPU half (SDF by jump flood) is `importVdb` in ./index.ts. No three, no GPU: runs in node for tests.
//
// This is a port of scripts/vdb/vdb_to_nvdf.py (Houdini side replaced by packages/runtime/vendor/vdb-web-tools) and scripts/vdb/nvdf_math.py.
// Axes: a VDB is y-up with index (X, Y, Z). The runtime texture is (x = VDB X, map row = VDB Z, slice/up = VDB Y), see assets/clouds/README.md.
import { parseVdb, VDBUnsupportedError, type VdbFile, type VdbFloatGrid, type VdbGridDescriptor } from '@pmndrs/vdb/tools';
import { signedDistanceCpu } from '../generate/cpu-edt';
import { activeBounds, planLattice, resampleGrid, type Vec3 } from './grid-read';
import { clamp01, gaussianBlur, heightFractions, packDetail, packProfile, packScale, PACK_FIT, quantizeUnorm8, smoothNoise } from './pack-fit';

export type VdbImportMode = 'auto' | 'fog' | 'sdf' | 'pack';

export interface VdbImportOptions {
  /** Runtime voxel size in metres. Default 8. */
  voxelSize?: number;
  /** Multiplies the VDB's world units to get metres. Default 1. */
  worldScale?: number;
  /** Default 'auto': Nubis pack VDBs (dimensional_profile grid) use 'pack'; otherwise a density grid is 'fog' and a level set 'sdf'. */
  mode?: VdbImportMode;
  /** Scale the cloud so its larger horizontal extent (X or Z of the active voxels) is this many metres. Overrides worldScale. */
  targetWidthMeters?: number;
  /** Grid to use in fog / sdf mode (default: 'density', else the first fog volume; sdf: the first level set). */
  grid?: string;
  /** fog: density threshold that defines the cloud surface. Default 0.05. */
  iso?: number;
  /** sdf: the surface is at sdf == offset metres (positive grows the cloud). Default 0. */
  sdfOffset?: number;
  /** Crop margin around profile > 0 in target voxels. Default 8. */
  margin?: number;
  /** fog / sdf: seed, noise scale, profile gain, density-scale gain, SDF smoothing (voxels) and a fixed density reference (default p99) for the fitted mapping. */
  seed?: number;
  profileNoise?: number;
  profileGain?: number;
  scaleGain?: number;
  smooth?: number;
  densityRef?: number;
  scaleFloor?: number;
  /** Also return the exact CPU signed distance field (metres, x-fastest) of the cropped cloud. fog mode computes it anyway. */
  cpuSdf?: boolean;
  /**
   * importVdb only (P13-H4): also build a fine hero layer at this voxel size (4 or 2 m under 8 m). The VDB is converted once at the fine size
   * (margin and noise correlation kept in metres), the coarse volume is its P8 reduction (so fine occupancy lies inside coarse occupancy and
   * the coarse SDF bounds both), and the fine profile is uploaded as bricks (`volume.fine`). Default: none.
   */
  fineVoxelSize?: number;
}

export type VdbImportErrorCode = 'blosc' | 'unsupported-codec' | 'unsupported-grid' | 'no-grid' | 'grid-not-found' | 'wrong-class' | 'empty' | 'too-large' | 'format';

export class VdbImportError extends Error {
  constructor(readonly code: VdbImportErrorCode, message: string) {
    super(message);
    this.name = 'VdbImportError';
  }
}

export const BLOSC_HELP = 'In Houdini set File Compression to ZIP (or None) on the Geometry ROP / File SOP that writes the .vdb, then re-export.';

export interface VdbGridSummary {
  name: string;
  valueType: string;
  gridClass: string;
  /** Voxel size in the file's world units, per axis. */
  voxelSize: Vec3 | null;
  indexBBox: { min: Vec3; max: Vec3 } | null;
  compression: 'blosc' | 'zip' | 'none';
  unsupported: string | null;
  /** What the importer did with it: 'profile' | 'detail' | 'scale' | 'density' | 'level-set' | 'clamp-reference' | 'unused'. */
  role: string;
}

export interface VdbImportTimings {
  parseMs: number;
  resampleMs: number;
  channelsMs: number;
  /** Filled by importVdb. */
  uploadMs?: number;
  sdfGpuMs?: number;
  /** Filled by importVdb with fineVoxelSize: the reduction, brick packing and pool upload. */
  fineMs?: number;
  totalMs: number;
}

export interface VdbImportInfo {
  mode: Exclude<VdbImportMode, 'auto'>;
  fileVersion: number;
  fileBytes: number;
  grids: VdbGridSummary[];
  baseGrid: string;
  /** Source voxel size (metres, after worldScale) and the runtime voxel size. */
  sourceVoxelSizeMeters: Vec3;
  voxelSizeMeters: number;
  worldScale: number;
  /** Larger horizontal extent of the active voxels of the base grid in metres (after worldScale), before resampling. */
  sourceWidthMeters: number;
  /** Texture dims (x, map row, up) and the crop offset in the lattice anchored at VDB index 0 (same axes). */
  dims: [number, number, number];
  cropOffset: [number, number, number];
  /** Occupied (profile > 0) voxel bounds in crop-local texture coordinates, max inclusive. */
  occupiedMin: [number, number, number];
  occupiedMax: [number, number, number];
  occupiedFraction: number;
  /** World-axes (x, y-up, z) size of the volume box in metres. */
  sizeMeters: [number, number, number];
  /** Position of the crop's min corner in the VDB's world frame after worldScale (VDB axes x, y-up, z). */
  houdiniMinMeters: [number, number, number];
  /** fog mode: density that mapped to density scale 1. */
  densityRef?: number;
  /** importVdb with fineVoxelSize: the fine layer (dims in texture axes, nested in `dims`, same min corner). */
  fine?: { voxelSizeMeters: number; dims: [number, number, number]; occupiedFraction: number; bricks: number; gpuBytes: number };
  notes: string[];
  timings: VdbImportTimings;
}

export interface ConvertedVdb {
  /** rgba8: R profile, G detail type, B density scale, A 0. x fastest, then map row, then up. */
  nvdf: Uint8Array<ArrayBuffer>;
  dims: [number, number, number];
  voxelSize: number;
  /** Exact signed distance (metres, negative inside) of the cropped mask, when cpuSdf or fog mode computed it. */
  sdfMeters?: Float32Array;
  info: VdbImportInfo;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const PACK_PROFILE = 'dimensional_profile', PACK_DETAIL = 'detail_type', PACK_SCALE = 'density_scale', PACK_SDF = 'sdf';

function compressionLabel(c: VdbGridDescriptor['compression']): 'blosc' | 'zip' | 'none' {
  return c.blosc ? 'blosc' : c.zip ? 'zip' : 'none';
}

function summarize(d: VdbGridDescriptor): VdbGridSummary {
  const m = d.transform?.matrix;
  return {
    name: d.name, valueType: d.valueType, gridClass: d.gridClass,
    voxelSize: m ? [Math.abs(m[0]), Math.abs(m[5]), Math.abs(m[10])] : null,
    indexBBox: d.indexBBox, compression: compressionLabel(d.compression), unsupported: d.unsupported, role: 'unused',
  };
}

function wrapParseError(e: unknown): Error {
  if (e instanceof VdbImportError) return e;
  const message = e instanceof Error ? e.message : String(e);
  if (/blosc/i.test(message)) {
    const codec = /codec "?([\w#]+)"? is not supported/.exec(message)?.[1]?.toLowerCase();
    return new VdbImportError(codec ? 'unsupported-codec' : 'blosc',
      `This .vdb is Blosc-compressed with ${codec ? `the "${codec}" codec, which is` : 'a variant that is'} not supported by the in-browser reader (lz4 Blosc, ZIP and uncompressed are). ${BLOSC_HELP}`);
  }
  if (e instanceof VDBUnsupportedError) return new VdbImportError('unsupported-grid', message);
  return new VdbImportError('format', message);
}

interface Selection {
  mode: Exclude<VdbImportMode, 'auto'>;
  base: VdbGridDescriptor;
  needed: Set<string>;
  roles: Map<string, string>;
}

function selectGrids(descriptors: VdbGridDescriptor[], options: VdbImportOptions): Selection {
  const ok = descriptors.filter(d => !d.unsupported);
  if (!ok.length) {
    const why = descriptors.map(d => `"${d.name}" (${d.unsupported ?? 'unknown'})`).join('; ');
    throw new VdbImportError('unsupported-grid', `No usable grid in this .vdb: only float grids with the 5-4-3 tree are supported. ${why || 'The file contains no grids.'}`);
  }
  const named = (n: string) => ok.find(d => d.name === n);
  const isLevelSet = (d: VdbGridDescriptor) => /level/i.test(d.gridClass);
  let mode = options.mode ?? 'auto';
  if (mode === 'auto') mode = named(PACK_PROFILE) ? 'pack' : options.grid && named(options.grid) ? (isLevelSet(named(options.grid)!) ? 'sdf' : 'fog') : ok.some(d => !isLevelSet(d)) ? 'fog' : 'sdf';
  const roles = new Map<string, string>();
  const needed = new Set<string>();
  let base: VdbGridDescriptor | undefined;
  if (mode === 'pack') {
    base = named(PACK_PROFILE);
    if (!base) throw new VdbImportError('grid-not-found', `pack mode needs a grid named "${PACK_PROFILE}"; this file has: ${ok.map(d => d.name).join(', ')}`);
    roles.set(PACK_PROFILE, 'profile');
    for (const [n, role] of [[PACK_DETAIL, 'detail'], [PACK_SCALE, 'scale']] as const) if (named(n)) roles.set(n, role);
    for (const n of roles.keys()) needed.add(n);
    if (named(PACK_SDF)) roles.set(PACK_SDF, 'clamp-reference'); // not decoded: the crop is clamped to its bounds, the SDF is rebuilt on the GPU
  } else if (mode === 'fog') {
    base = options.grid ? named(options.grid) : named('density') ?? ok.find(d => !isLevelSet(d));
    if (!base) throw new VdbImportError(options.grid ? 'grid-not-found' : 'no-grid', options.grid ? `grid "${options.grid}" not found or unsupported; usable grids: ${ok.map(d => d.name).join(', ')}` : `fog mode found no density grid; usable grids: ${ok.map(d => `${d.name} (${d.gridClass || 'no class'})`).join(', ')}`);
    if (isLevelSet(base)) throw new VdbImportError('wrong-class', `grid "${base.name}" is a level set; use mode "sdf"`);
    roles.set(base.name, 'density'); needed.add(base.name);
  } else {
    base = options.grid ? named(options.grid) : ok.find(isLevelSet);
    if (!base) throw new VdbImportError(options.grid ? 'grid-not-found' : 'no-grid', options.grid ? `grid "${options.grid}" not found or unsupported; usable grids: ${ok.map(d => d.name).join(', ')}` : `sdf mode found no level-set grid; usable grids: ${ok.map(d => `${d.name} (${d.gridClass || 'no class'})`).join(', ')}`);
    if (!isLevelSet(base)) throw new VdbImportError('wrong-class', `grid "${base.name}" is not a level set; use mode "fog" for density grids`);
    roles.set(base.name, 'level-set'); needed.add(base.name);
  }
  return { mode, base, needed, roles };
}

function checkAxisAligned(d: VdbGridDescriptor): Vec3 {
  const m = d.transform!.matrix;
  const s: Vec3 = [m[0], m[5], m[10]];
  if (s.some(v => !(v > 0))) throw new VdbImportError('unsupported-grid', `grid "${d.name}" has a negative or zero voxel size ${s.join(', ')}`);
  return s;
}

/** Cheap look at a file (header and grid descriptors only): what importVdb would pick, and the native size of the cloud. */
export function inspectVdb(buffer: ArrayBuffer, options: VdbImportOptions = {}): { fileVersion: number; grids: VdbGridSummary[]; mode: Exclude<VdbImportMode, 'auto'>; baseGrid: string; nativeWidth: number } {
  let file: VdbFile;
  try { file = parseVdb(buffer, { select: () => false }); } catch (e) { throw wrapParseError(e); }
  const sel = selectGrids(file.descriptors, options);
  const grids = file.descriptors.map(summarize);
  for (const g of grids) g.role = sel.roles.get(g.name) ?? 'unused';
  const sv = checkAxisAligned(sel.base), bb = sel.base.indexBBox;
  const nativeWidth = bb ? Math.max((bb.max[0] - bb.min[0] + 1) * sv[0], (bb.max[2] - bb.min[2] + 1) * sv[2]) : 0;
  return { fileVersion: file.fileVersion, grids, mode: sel.mode, baseGrid: sel.base.name, nativeWidth };
}

function sameTransform(a: VdbGridDescriptor, b: VdbGridDescriptor): boolean {
  const ma = a.transform!.matrix, mb = b.transform!.matrix;
  return ma.every((v, i) => Math.abs(v - mb[i]) <= 1e-9 * Math.max(1, Math.abs(v)));
}

/** Parse a .vdb and build the NVDF bytes on the runtime lattice. Pure CPU; throws VdbImportError with actionable messages. */
export function convertVdb(buffer: ArrayBuffer, options: VdbImportOptions = {}): ConvertedVdb {
  const t0 = now();
  const margin = options.margin ?? 8;
  const tv = options.voxelSize ?? 8;
  if (!(tv > 0)) throw new VdbImportError('format', 'voxelSize must be positive');
  const notes: string[] = [];

  let first: VdbFile;
  try { first = parseVdb(buffer, { select: () => false }); } catch (e) { throw wrapParseError(e); }
  const sel = selectGrids(first.descriptors, options);
  let file: VdbFile;
  try { file = parseVdb(buffer, { select: d => sel.needed.has(d.name) }); } catch (e) { throw wrapParseError(e); }
  const grid = (name: string): VdbFloatGrid | undefined => file.grids.find((g): g is VdbFloatGrid => g.name === name && g.valueType === 'float');
  const base = grid(sel.base.name)!;
  const t1 = now();

  const svNative = checkAxisAligned(sel.base);
  const bounds = activeBounds(base);
  if (!bounds) throw new VdbImportError('empty', `grid "${base.name}" has no active voxels`);
  const nativeWidth = Math.max((bounds.max[0] - bounds.min[0]) * svNative[0], (bounds.max[2] - bounds.min[2]) * svNative[2]);
  const worldScale = options.targetWidthMeters ? options.targetWidthMeters / nativeWidth : options.worldScale ?? 1;
  if (!(worldScale > 0) || !Number.isFinite(worldScale)) throw new VdbImportError('format', `invalid world scale ${worldScale}`);
  const sv: Vec3 = [svNative[0] * worldScale, svNative[1] * worldScale, svNative[2] * worldScale];
  const ratio = sv.map(s => { const r = tv / s; return Math.abs(r - 1) < 1e-9 ? 1 : r; }) as Vec3;

  // Source region: active bounds plus margin, clamped to the pack grid in pack mode (so the crop is cut at the grid faces).
  const pad = ratio.map(r => Math.ceil(margin * r) + 2);
  const lo = bounds.min.map((v, a) => v - pad[a]) as Vec3, hi = bounds.max.map((v, a) => v + pad[a]) as Vec3;
  if (sel.mode === 'pack') {
    const ref = first.descriptors.find(d => d.name === PACK_SDF) ?? first.descriptors.find(d => d.name === PACK_DETAIL);
    if (ref?.indexBBox) for (let a = 0; a < 3; a++) { lo[a] = Math.max(lo[a], ref.indexBBox.min[a]); hi[a] = Math.min(hi[a], ref.indexBBox.max[a] + 1); }
  }
  let plan;
  try { plan = planLattice(lo, hi, ratio); } catch (e) { throw new VdbImportError('too-large', (e as Error).message); }
  const [nx, ny, nz] = plan.dims;
  const tdims: [number, number, number] = [nx, nz, ny]; // texture dims (x, map row, up)

  // --- fields on the target lattice (texture order)
  let r8: Uint8Array | undefined;
  let g8Src: Float32Array | null = null, b8Src: Float32Array | null = null;
  let density: Float32Array | undefined, given: Float32Array | undefined;
  let mask: Uint8Array;
  const nTotal = nx * ny * nz;
  if (sel.mode === 'pack') {
    const prof = resampleGrid(base, plan);
    r8 = new Uint8Array(nTotal);
    for (let i = 0; i < nTotal; i++) r8[i] = quantizeUnorm8(prof[i]);
    mask = new Uint8Array(nTotal);
    for (let i = 0; i < nTotal; i++) mask[i] = r8[i] > 0 ? 1 : 0;
    for (const [n, role] of [[PACK_DETAIL, 'detail'], [PACK_SCALE, 'scale']] as const) {
      const g = grid(n);
      const d = g && first.descriptors.find(x => x.name === n)!;
      if (!g || !d) continue;
      if (!sameTransform(sel.base, d)) throw new VdbImportError('format', `grid "${n}" has a different transform than "${PACK_PROFILE}"`);
      const field = resampleGrid(g, plan);
      if (role === 'detail') g8Src = field; else b8Src = field;
    }
    if (!g8Src) notes.push(`no "${PACK_DETAIL}" grid: detail type fixed at 0.5`);
    if (!b8Src) notes.push(`no "${PACK_SCALE}" grid: density scale fixed at 1`);
  } else if (sel.mode === 'fog') {
    density = resampleGrid(base, plan);
    const iso = options.iso ?? 0.05;
    mask = new Uint8Array(nTotal);
    for (let i = 0; i < nTotal; i++) mask[i] = density[i] >= iso ? 1 : 0;
  } else {
    given = resampleGrid(base, plan, worldScale);
    const off = options.sdfOffset ?? 0;
    mask = new Uint8Array(nTotal);
    for (let i = 0; i < nTotal; i++) mask[i] = given[i] < off ? 1 : 0;
  }
  const t2 = now();

  // --- crop on the mask: occupied bounds plus margin, clamped to the array
  let omin: Vec3 = [nx, nz, ny], omax: Vec3 = [-1, -1, -1];
  for (let z = 0; z < ny; z++) for (let y = 0; y < nz; y++) {
    const row = (z * nz + y) * nx;
    for (let x = 0; x < nx; x++) if (mask[row + x]) {
      if (x < omin[0]) omin[0] = x; if (x > omax[0]) omax[0] = x;
      if (y < omin[1]) omin[1] = y; if (y > omax[1]) omax[1] = y;
      if (z < omin[2]) omin[2] = z; if (z > omax[2]) omax[2] = z;
    }
  }
  if (omax[0] < 0) {
    throw new VdbImportError('empty', sel.mode === 'fog'
      ? `no voxel reaches the density threshold iso = ${options.iso ?? 0.05} (lower options.iso)`
      : sel.mode === 'sdf' ? `no voxel is inside the level set at offset ${options.sdfOffset ?? 0} m` : `grid "${PACK_PROFILE}" has no voxel above zero after quantisation`);
  }
  const cmin: Vec3 = [0, 1, 2].map(a => Math.max(0, omin[a] - margin)) as Vec3;
  const cmax: Vec3 = [0, 1, 2].map(a => Math.min(tdims[a] - 1, omax[a] + margin)) as Vec3;
  const cd: [number, number, number] = [cmax[0] - cmin[0] + 1, cmax[1] - cmin[1] + 1, cmax[2] - cmin[2] + 1];
  const cropF = <T extends Float32Array | Uint8Array>(a: T): T => {
    const out = new (a.constructor as { new (n: number): T })(cd[0] * cd[1] * cd[2]);
    for (let z = 0; z < cd[2]; z++) for (let y = 0; y < cd[1]; y++) {
      const src = ((z + cmin[2]) * tdims[1] + (y + cmin[1])) * tdims[0] + cmin[0];
      out.set(a.subarray(src, src + cd[0]), (z * cd[1] + y) * cd[0]);
    }
    return out;
  };
  const maskC = cropF(mask);
  const count = cd[0] * cd[1] * cd[2];
  const r = new Uint8Array(count), g = new Uint8Array(count), b = new Uint8Array(count);
  let sdfMeters: Float32Array | undefined;
  let densityRef: number | undefined;

  if (sel.mode === 'pack') {
    const rC = cropF(r8!);
    r.set(rC);
    const gC = g8Src ? cropF(g8Src) : null, bC = b8Src ? cropF(b8Src) : null;
    for (let i = 0; i < count; i++) { g[i] = gC ? quantizeUnorm8(gC[i]) : 128; b[i] = bC ? quantizeUnorm8(bC[i]) : 255; }
    if (options.cpuSdf) sdfMeters = signedDistanceCpu(maskC, cd, tv);
  } else {
    // Depth below the surface drives the fitted mapping: exact EDT of the mask (fog, smoothed) or the VDB's own distance (sdf).
    let driver: Float32Array;
    if (sel.mode === 'fog') {
      sdfMeters = signedDistanceCpu(maskC, cd, tv);
      driver = gaussianBlur(sdfMeters, cd, options.smooth ?? 1);
    } else {
      // A narrow-band level set (Houdini's default) is a constant -background everywhere deeper than a few voxels, which would cap the depth
      // at a thin shell. The exact EDT of the mask is deeper there and equals the VDB distance elsewhere, so take the deeper of the two
      // (the Python converter uses the VDB distance alone).
      sdfMeters = signedDistanceCpu(maskC, cd, tv);
      driver = cropF(given!);
      for (let i = 0; i < count; i++) if (sdfMeters[i] < driver[i]) driver[i] = sdfMeters[i];
    }
    const hz = heightFractions(maskC, cd);
    const noise = smoothNoise(cd, PACK_FIT.profile.corrMeters / tv, options.seed ?? 1);
    const pn = options.profileNoise ?? 1, pg = options.profileGain ?? 1, sg = options.scaleGain ?? 1, floor = options.scaleFloor ?? 0;
    const densC = density ? cropF(density) : null;
    if (densC) {
      if (options.densityRef !== undefined) densityRef = options.densityRef;
      else {
        const pos = densC.filter(v => v > 0).sort();
        densityRef = pos.length ? pos[Math.min(pos.length - 1, Math.floor(0.99 * (pos.length - 1) + 0.5))] : 1;
        // numpy percentile interpolates linearly; at these sizes the difference is below the 8-bit quantum
      }
      densityRef = Math.max(densityRef!, 1e-9);
    }
    const layer = cd[0] * cd[1];
    for (let i = 0; i < count; i++) {
      if (!maskC[i]) continue;
      const h = hz[Math.floor(i / layer)];
      const depth = Math.max(-driver[i], 0);
      const prof = clamp01(packProfile(depth, h, noise[i] * pn) * pg);
      r[i] = Math.max(quantizeUnorm8(prof), 1);
      g[i] = quantizeUnorm8(packDetail(depth, h));
      let scale = clamp01(packScale(h) * sg);
      if (densC) scale = Math.max(clamp01(packScale(h) * (0.5 + 0.5 * clamp01(densC[i] / densityRef!)) * sg), floor);
      b[i] = quantizeUnorm8(scale);
    }
  }
  const nvdf = new Uint8Array(count * 4);
  let occupied = 0;
  for (let i = 0; i < count; i++) {
    nvdf[i * 4] = r[i]; nvdf[i * 4 + 1] = g[i]; nvdf[i * 4 + 2] = b[i];
    if (r[i]) occupied++;
  }
  const t3 = now();

  // --- info
  const o: [number, number, number] = [plan.origin[0], plan.origin[2], plan.origin[1]]; // lattice origin in texture axes
  const cropOffset: [number, number, number] = [o[0] + cmin[0], o[1] + cmin[1], o[2] + cmin[2]];
  const m = sel.base.transform!.matrix;
  const corner0: Vec3 = [(m[3] - 0.5 * svNative[0]) * worldScale, (m[7] - 0.5 * svNative[1]) * worldScale, (m[11] - 0.5 * svNative[2]) * worldScale];
  const grids = first.descriptors.map(summarize);
  for (const s of grids) s.role = sel.roles.get(s.name) ?? 'unused';
  const info: VdbImportInfo = {
    mode: sel.mode, fileVersion: first.fileVersion, fileBytes: buffer.byteLength, grids, baseGrid: base.name,
    sourceVoxelSizeMeters: sv, voxelSizeMeters: tv, worldScale, sourceWidthMeters: nativeWidth * worldScale,
    dims: cd, cropOffset,
    occupiedMin: [omin[0] - cmin[0], omin[1] - cmin[1], omin[2] - cmin[2]], occupiedMax: [omax[0] - cmin[0], omax[1] - cmin[1], omax[2] - cmin[2]],
    occupiedFraction: occupied / count,
    sizeMeters: [cd[0] * tv, cd[2] * tv, cd[1] * tv],
    houdiniMinMeters: [corner0[0] + cropOffset[0] * tv, corner0[1] + cropOffset[2] * tv, corner0[2] + cropOffset[1] * tv],
    ...(densityRef !== undefined ? { densityRef } : {}),
    notes,
    timings: { parseMs: t1 - t0, resampleMs: t2 - t1, channelsMs: t3 - t2, totalMs: t3 - t0 },
  };
  return { nvdf, dims: cd, voxelSize: tv, ...(sdfMeters ? { sdfMeters } : {}), info };
}
