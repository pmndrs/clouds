/**
 * CPU reference for the cloud density function: a line-for-line port of GetVoxelCloudDensitySamples and
 * GetUprezzedVoxelCloudDensity from assets/nubis-voxel-clouds/Code Fragments/VoxelCloudSampler.cg, with the
 * signature semantics of work/specs/P1-runtime.md ("Density function: fixed signature").
 * Used to verify DENSITY_WGSL on the GPU (examples/lab/runtime-tests/density). Double precision throughout.
 */

export type Vec3 = readonly [number, number, number];

/** NVDF as the GPU sees it. Texture axes are (world x, world z, world y); dims are texture dims. */
export interface DensityVolume {
  /** Texture dims (x = map column, y = map row, z = slice/up). */
  dims: Vec3;
  voxelSize: number;
  /** rgba8, x fastest, then y, then z. */
  nvdf: Uint8Array;
  /** Emulate fixed-point filter weights: round each fractional weight to k / weightSteps. Default: exact. */
  weightSteps?: number;
  /** World min corner (x, y-up, z), metres. */
  minCorner: Vec3;
}

/** Noise mip 0 only. rgba8, x fastest, then y, then z. */
export interface DensityNoise {
  size: number;
  data: Uint8Array;
  /** Noise coordinate = (p - wind) * noiseScale. Shipping value: 0.01 (100 m tiling). */
  noiseScale: number;
  /** See DensityVolume.weightSteps. */
  weightSteps?: number;
}

export interface DensityInputs {
  /** World-space offset subtracted from the sample position before the noise lookup. wind.y should be 0. */
  wind: Vec3;
  mipDistanceScale: number;
  baseMip: number;
  hfDetails: boolean;
}

// GPU saturate maps NaN to 0 (0/0 in valueErosion when composite == profile == 1); Math.min/max would propagate it.
const saturate = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);
const lerp = (a: number, b: number, t: number) => a + t * (b - a);
export const valueRemap = (v: number, oldMin: number, oldMax: number, newMin: number, newMax: number) =>
  newMin + saturate((v - oldMin) / (oldMax - oldMin)) * (newMax - newMin);
export const valueErosion = (v: number, oldMin: number) => saturate((v - oldMin) / (1.0 - oldMin));
export const fractionFromValue = (v: number, lo: number, hi: number) => saturate((v - lo) / (hi - lo));

const EPSILON = 1e-5;

/** Noise LOD per the spec: log2(1 + |rayDistance * mipDistanceScale|) + baseMip. */
export function noiseMipLevel(rayDistance: number, inputs: Pick<DensityInputs, 'mipDistanceScale' | 'baseMip'>): number {
  return Math.log2(1 + Math.abs(rayDistance * inputs.mipDistanceScale)) + inputs.baseMip;
}

/**
 * Trilinear sample of an rgba8 3D texture at normalised coordinates, texel centres at (i + 0.5) / n.
 * `repeat` wraps, otherwise clamp-to-edge. Returns four channels in 0..1.
 */
export function sampleTrilinear(data: Uint8Array, dims: Vec3, uvw: Vec3, repeat: boolean, weightSteps = 0): [number, number, number, number] {
  const idx: number[][] = [[], [], []];
  const wgt: number[] = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const n = dims[a];
    const t = uvw[a] * n - 0.5;
    const f = Math.floor(t);
    wgt[a] = weightSteps > 0 ? Math.round((t - f) * weightSteps) / weightSteps : t - f;
    for (let k = 0; k < 2; k++) {
      const i = f + k;
      idx[a][k] = repeat ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i));
    }
  }
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const w = (x ? wgt[0] : 1 - wgt[0]) * (y ? wgt[1] : 1 - wgt[1]) * (z ? wgt[2] : 1 - wgt[2]);
    if (w === 0) continue;
    const o = ((idx[2][z] * dims[1] + idx[1][y]) * dims[0] + idx[0][x]) * 4;
    for (let c = 0; c < 4; c++) out[c] += w * (data[o + c] / 255);
  }
  return out;
}

/** World point to NVDF texture coordinate: world (x, y-up, z) -> texture (x, z, y), divided by the extent. */
export function volumeUvw(volume: DensityVolume, p: Vec3): [number, number, number] {
  const qx = p[0] - volume.minCorner[0], qy = p[1] - volume.minCorner[1], qz = p[2] - volume.minCorner[2];
  const v = volume.voxelSize;
  return [qx / (volume.dims[0] * v), qz / (volume.dims[1] * v), qy / (volume.dims[2] * v)];
}

/** Zero outside the box [min, min + extent] (inclusive), like sampleModeling in volume.wgsl. */
export function sampleModelingCpu(volume: DensityVolume, p: Vec3): [number, number, number] {
  const v = volume.voxelSize;
  const ext = [volume.dims[0] * v, volume.dims[2] * v, volume.dims[1] * v];
  for (let a = 0; a < 3; a++) {
    const q = p[a] - volume.minCorner[a];
    if (q < 0 || q > ext[a]) return [0, 0, 0];
  }
  const s = sampleTrilinear(volume.nvdf, volume.dims, volumeUvw(volume, p), false, volume.weightSteps);
  return [s[0], s[1], s[2]];
}

/** Noise sample for a world position: repeat addressing, mip 0 only. */
export function sampleNoiseCpu(noise: DensityNoise, p: Vec3, wind: Vec3): [number, number, number, number] {
  const s = noise.noiseScale;
  return sampleTrilinear(noise.data, [noise.size, noise.size, noise.size],
    [(p[0] - wind[0]) * s, (p[1] - wind[1]) * s, (p[2] - wind[2]) * s], true, noise.weightSteps);
}

/** GetUprezzedVoxelCloudDensity. */
export function uprezzedDensity(
  noise: DensityNoise, p: Vec3, rayDistance: number, profile: number, type: number, densityScale: number, inputs: DensityInputs,
): number {
  const mip = noiseMipLevel(rayDistance, inputs);
  if (mip > 1e-6) throw new Error(`CPU noise reference samples mip 0 only; got mip ${mip}. Use mipDistanceScale = 0 and baseMip = 0.`);
  return uprezzedDensityFromSample(sampleNoiseCpu(noise, p, inputs.wind), rayDistance, profile, type, densityScale, inputs);
}

/** The arithmetic of GetUprezzedVoxelCloudDensity given an already-filtered noise sample (lets tests inject GPU samples). */
export function uprezzedDensityFromSample(
  n: readonly [number, number, number, number], rayDistance: number, profile: number, type: number, densityScale: number, inputs: DensityInputs,
): number {
  const [nr, ng, nb, na] = n;

  const wispy = lerp(nr, ng, profile);
  const billowy = lerp(nb * 0.3, na * 0.3, Math.pow(profile, 0.25));
  let composite = lerp(wispy, billowy, type);

  if (inputs.hfDetails) {
    const hhf = saturate(lerp(
      1.0 - Math.pow(Math.abs(Math.abs(ng * 2.0 - 1.0) * 2.0 - 1.0), 4.0),
      Math.pow(Math.abs(Math.abs(na * 2.0 - 1.0) * 2.0 - 1.0), 2.0),
      type));
    const blender = valueRemap(rayDistance, 50.0, 150.0, 0.9, 1.0);
    composite = lerp(hhf, composite, blender);
  }

  let d = valueErosion(profile, composite);
  const poweredScale = Math.pow(saturate(densityScale), 4.0);
  d *= poweredScale;
  d = Math.pow(d, lerp(0.3, 0.6, Math.max(EPSILON, poweredScale)));
  if (inputs.hfDetails) {
    const f = fractionFromValue(rayDistance, 50.0, 150.0);
    d = Math.pow(d, lerp(0.5, 1.0, f)) * lerp(0.666, 1.0, f);
  }
  return d;
}

/**
 * GetVoxelCloudDensitySamples (non-dome branch). Returns [full, profile] = (x: up-rezzed density with the
 * near-camera fade, y: dimensional profile * density scale).
 */
export function cloudDensityCpu(volume: DensityVolume, noise: DensityNoise, p: Vec3, rayDistance: number, inputs: DensityInputs): [number, number] {
  const modeling = sampleModelingCpu(volume, p);
  if (!(modeling[0] > 0)) return [0, 0];
  const mip = noiseMipLevel(rayDistance, inputs);
  if (mip > 1e-6) throw new Error(`CPU noise reference samples mip 0 only; got mip ${mip}. Use mipDistanceScale = 0 and baseMip = 0.`);
  return cloudDensityFromSamples(modeling, sampleNoiseCpu(noise, p, inputs.wind), rayDistance, inputs);
}

/** GetVoxelCloudDensitySamples given already-filtered NVDF (profile, type, scale) and noise samples. */
export function cloudDensityFromSamples(
  modeling: readonly [number, number, number], noise: readonly [number, number, number, number], rayDistance: number, inputs: DensityInputs,
): [number, number] {
  const [profile, type, densityScale] = modeling;
  if (!(profile > 0)) return [0, 0];
  const full = uprezzedDensityFromSample(noise, rayDistance, profile, type, densityScale, inputs) * valueRemap(rayDistance, 10.0, 120.0, 0.25, 1.0);
  return [full, profile * densityScale];
}
