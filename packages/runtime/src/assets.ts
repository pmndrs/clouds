/** Runtime cloud assets produced by scripts/nubis/convert.mjs (see assets/clouds/README.md). */

export interface CloudVolumeAsset {
  name: string;
  /** Texture dims in source axes: x = map column, y = map row, z = up. */
  dims: [number, number, number];
  voxelSizeMeters: number;
  /** rgba8: R profile, G detail type, B density scale. x fastest, then y, then z. */
  nvdf: Uint8Array<ArrayBuffer>;
  /** Signed distance in metres (negative inside), never larger than the true distance. */
  sdfMeters: Float32Array;
}

export interface CloudNoiseAsset {
  size: number;
  /** rgba8 mips, largest first. */
  mips: Uint8Array<ArrayBuffer>[];
  tilingMeters: number;
}

interface CloudJson {
  name: string;
  dims: [number, number, number];
  voxelSizeMeters: number;
  nvdf: { file: string; bytes: number };
  sdf: { file: string; bytes: number; encoding: { minMeters: number; maxMeters: number } };
}
interface NoiseJson { dims: [number, number, number]; mips: { dims: [number, number, number]; byteOffset: number; bytes: number }[]; tilingMeters: number }

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

/** Load `<base>/cloud.json` with its NVDF and SDF. */
export async function loadCloudVolume(baseUrl: string): Promise<CloudVolumeAsset> {
  const meta: CloudJson = await (await fetchOk(join(baseUrl, 'cloud.json'))).json();
  const [nvdfBuffer, sdfBuffer] = await Promise.all([
    fetchOk(join(baseUrl, meta.nvdf.file)).then(r => r.arrayBuffer()),
    fetchOk(join(baseUrl, meta.sdf.file)).then(r => r.arrayBuffer()),
  ]);
  const count = meta.dims[0] * meta.dims[1] * meta.dims[2];
  if (nvdfBuffer.byteLength !== count * 4 || sdfBuffer.byteLength !== count * 2) throw new Error(`Cloud ${meta.name}: payload size does not match dims.`);
  return {
    name: meta.name,
    dims: meta.dims,
    voxelSizeMeters: meta.voxelSizeMeters,
    nvdf: new Uint8Array(nvdfBuffer),
    sdfMeters: decodeSdf(new Uint16Array(sdfBuffer), meta.sdf.encoding.minMeters, meta.sdf.encoding.maxMeters),
  };
}

/** Load `<base>/noise.json` and its mip chain. */
export async function loadCloudNoise(baseUrl: string): Promise<CloudNoiseAsset> {
  const meta: NoiseJson = await (await fetchOk(join(baseUrl, 'noise.json'))).json();
  const buffer = await (await fetchOk(join(baseUrl, 'noise.bin'))).arrayBuffer();
  return {
    size: meta.dims[0],
    tilingMeters: meta.tilingMeters,
    mips: meta.mips.map(m => new Uint8Array(buffer, m.byteOffset, m.bytes)),
  };
}
