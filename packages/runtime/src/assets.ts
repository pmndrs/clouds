/** Runtime cloud assets produced by scripts/nubis/convert.mjs (see assets/clouds/README.md). */
import { packFineBricks, type FineBricks } from './hero/bricks';
import { decodeFineNvdb } from './hero/nvdb';

export interface CloudVolumeAsset {
  name: string;
  /** Texture dims in source axes: x = map column, y = map row, z = up. */
  dims: [number, number, number];
  voxelSizeMeters: number;
  /** rgba8: R profile, G detail type, B density scale. x fastest, then y, then z. */
  nvdf: Uint8Array<ArrayBuffer>;
  /**
   * D1: the same fields as rgba16float bits (IEEE half), the profile un-quantised (cloud.json `nvdf16`, written by vdb_to_nvdf.py --nvdf16 from the
   * pack VDBs). When present, uploadCloudVolume binds it as the NVDF texture; `nvdf` stays for the fine hero bricks and the CPU paths.
   */
  nvdf16?: Uint16Array<ArrayBuffer>;
  /** Signed distance in metres (negative inside), never larger than the true distance. */
  sdfMeters: Float32Array;
  /** P13-H3: the fine hero profile (cloud.json `fine`, `fine.nvdb`), decoded and brick-packed; uploadCloudVolume attaches it as `.fine`. */
  fine?: CloudFineAsset;
  /**
   * V2: a direct asset (scripts/vdb/vdb_to_direct.py, cloud.json `direct`): the VDB's density, rendered as-is instead of through the Nubis
   * up-rez. Half-float bits of density / densityRef, same layout as `nvdf`. The runtime marches it whenever it is present (CloudSettings.directDensity).
   */
  direct?: CloudDirectAsset;
}

/** V2: raw density of a direct asset. */
export interface CloudDirectAsset {
  /** r16float bits (IEEE half), density / densityRef, x fastest. */
  density: Uint16Array<ArrayBuffer>;
  /** VDB density that the stored value 1 stands for. */
  densityRef: number;
}

/** A hero's fine profile (work/specs/P8-hero-vdb.md section 5.1): a lattice nested in the coarse one, same min corner. */
export interface CloudFineAsset {
  voxelSizeMeters: number;
  /** Fine lattice dims, texture axes (x, map row, up): coarse dims x (coarse voxel / fine voxel). */
  dims: [number, number, number];
  /** The fine bricks (rgba slabs: R the fine profile, G/B of the coarse voxel holding each texel), ready for uploadFineBricks. */
  bricks: FineBricks;
  /** Leaves in `fine.nvdb`. */
  leaves: number;
  /** CPU ms of the decode and the brick packing (the loader cost; the fetch is not counted). */
  loadMs: number;
}

export interface LoadCloudVolumeOptions {
  /** Load the fine hero profile when cloud.json has one. Default true; pass false on tiers with fine off (mobile) to skip the download. */
  fine?: boolean;
}

export interface CloudNoiseAsset {
  size: number;
  /** rgba8 mips, largest first. */
  mips: Uint8Array<ArrayBuffer>[];
  /** D1: rgba16float mips (IEEE half bits), largest first, from the pack's float VDB (noise.json `mips16`); uploadCloudNoise prefers them. */
  mips16?: Uint16Array<ArrayBuffer>[];
  tilingMeters: number;
}

interface CloudJson {
  name: string;
  dims: [number, number, number];
  voxelSizeMeters: number;
  nvdf: { file: string; bytes: number };
  nvdf16?: { file: string; bytes: number };
  sdf: { file: string; bytes: number; encoding: { minMeters: number; maxMeters: number } };
  fine?: { file: string; voxelSizeMeters: number; dims: [number, number, number]; offsetFineVoxels?: [number, number, number] };
  direct?: { file: string; densityRef: number };
}
interface NoiseJson { dims: [number, number, number]; mips: { dims: [number, number, number]; byteOffset: number; bytes: number }[]; tilingMeters: number; file16?: string; mips16?: { dims: [number, number, number]; byteOffset: number; bytes: number }[] }

const join = (base: string, file: string) => base.replace(/\/?$/, '/') + file;
async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return response;
}

/** Decode r16 unorm SDF samples to metres. Exported for tests. */
export function decodeSdf(raw: Uint16Array, minMeters: number, maxMeters: number): Float32Array {
  const out = new Float32Array(raw.length);
  const range = maxMeters - minMeters;
  for (let i = 0; i < raw.length; i++) out[i] = minMeters + (raw[i] / 65535) * range;
  return out;
}

/**
 * Load `<base>/cloud.json` with its NVDF and SDF, and the fine hero profile when the asset has one (decoded and packed into bricks here, so
 * the upload is a copy; brick allocation margin ceil(1.5 x the voxel ratio), the P13-H1 rule).
 */
export async function loadCloudVolume(baseUrl: string, options: LoadCloudVolumeOptions = {}): Promise<CloudVolumeAsset> {
  const meta: CloudJson = await (await fetchOk(join(baseUrl, 'cloud.json'))).json();
  const f = options.fine !== false ? meta.fine : undefined;
  const [nvdfBuffer, sdfBuffer, fineBuffer, directBuffer, nvdf16Buffer] = await Promise.all([
    fetchOk(join(baseUrl, meta.nvdf.file)).then(r => r.arrayBuffer()),
    fetchOk(join(baseUrl, meta.sdf.file)).then(r => r.arrayBuffer()),
    f && fetchOk(join(baseUrl, f.file)).then(r => r.arrayBuffer()),
    meta.direct && fetchOk(join(baseUrl, meta.direct.file)).then(r => r.arrayBuffer()),
    meta.nvdf16 && fetchOk(join(baseUrl, meta.nvdf16.file)).then(r => r.arrayBuffer()),
  ]);
  const count = meta.dims[0] * meta.dims[1] * meta.dims[2];
  if (nvdfBuffer.byteLength !== count * 4 || sdfBuffer.byteLength !== count * 2) throw new Error(`Cloud ${meta.name}: payload size does not match dims.`);
  const asset: CloudVolumeAsset = {
    name: meta.name,
    dims: meta.dims,
    voxelSizeMeters: meta.voxelSizeMeters,
    nvdf: new Uint8Array(nvdfBuffer),
    sdfMeters: decodeSdf(new Uint16Array(sdfBuffer), meta.sdf.encoding.minMeters, meta.sdf.encoding.maxMeters),
  };
  if (meta.nvdf16 && nvdf16Buffer) {
    if (nvdf16Buffer.byteLength !== count * 8) throw new Error(`Cloud ${meta.name}: nvdf16 size does not match dims.`);
    asset.nvdf16 = new Uint16Array(nvdf16Buffer);
  }
  if (meta.direct && directBuffer) {
    if (directBuffer.byteLength !== count * 2) throw new Error(`Cloud ${meta.name}: direct density size does not match dims.`);
    asset.direct = { density: new Uint16Array(directBuffer), densityRef: meta.direct.densityRef };
  }
  if (f && fineBuffer) {
    const ratio = meta.voxelSizeMeters / f.voxelSizeMeters;
    const t0 = performance.now();
    const { profile, leaves } = decodeFineNvdb(fineBuffer, f.dims);
    const bricks = packFineBricks(profile, f.dims, f.voxelSizeMeters, { margin: Math.ceil(1.5 * ratio), coarse: { rgba: asset.nvdf, ratio } });
    asset.fine = { voxelSizeMeters: f.voxelSizeMeters, dims: f.dims, bricks, leaves, loadMs: performance.now() - t0 };
  }
  return asset;
}

/** Load `<base>/noise.json` and its mip chain. */
export async function loadCloudNoise(baseUrl: string): Promise<CloudNoiseAsset> {
  const meta: NoiseJson = await (await fetchOk(join(baseUrl, 'noise.json'))).json();
  const [buffer, buffer16] = await Promise.all([
    (await fetchOk(join(baseUrl, 'noise.bin'))).arrayBuffer(),
    meta.file16 && meta.mips16 ? (await fetchOk(join(baseUrl, meta.file16))).arrayBuffer() : undefined,
  ]);
  return {
    size: meta.dims[0],
    tilingMeters: meta.tilingMeters,
    mips: meta.mips.map(m => new Uint8Array(buffer, m.byteOffset, m.bytes)),
    ...(buffer16 && meta.mips16 ? { mips16: meta.mips16.map(m => new Uint16Array(buffer16, m.byteOffset, m.bytes / 2)) } : {}),
  };
}
