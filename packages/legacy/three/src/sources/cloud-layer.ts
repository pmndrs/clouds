import { validateDensityDescriptor, type DensityDescriptor, type Vec3 } from '@clouds/core';
import type { DenseDensityField } from './density';

/** The broad, repeatable world-space domain used by the cloud-layer source. */
export const CLOUD_LAYER_BOUNDS: { readonly min: Vec3; readonly max: Vec3 } = {
  min: [-5000, 900, -5000],
  max: [5000, 3100, 5000],
};

const DEFAULT_RESOLUTION = 96 as const;
const DEFAULT_SEED = 17;
const DEFAULT_COVERAGE = 0.65;
const DEFAULT_DENSITY = 1;
const DEFAULT_EROSION = 0.5;
const EXTINCTION_SCALE = 0.004;

export interface CloudLayerFieldOptions {
  readonly resolution?: 64 | 96;
  readonly seed?: number;
  readonly coverage?: number;
  readonly density?: number;
  readonly erosion?: number;
}

export interface CloudLayerFieldStatistics {
  readonly nonzeroFraction: number;
  readonly meanDensity: number;
  readonly intermediateFraction: number;
  readonly peakDensity: number;
  readonly largestClusterFraction: number;
  readonly secondLargestClusterFraction: number;
  readonly centroid: readonly [x: number, y: number, z: number];
}

type Point3 = readonly [x: number, y: number, z: number];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smooth(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  return smooth(clamp01((value - edge0) / (edge1 - edge0)));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** A stable integer hash makes fields deterministic and independent of loop order. */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 0x1f123bb5);
  h = Math.imul(h ^ Math.imul(y | 0, 0x5f356495), 0x27d4eb2d);
  h = Math.imul(h ^ Math.imul(z | 0, 0x165667b1), 0x85ebca6b);
  h = Math.imul(h ^ (seed | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return (h >>> 0) / 0x1_0000_0000;
}

function hash2(x: number, z: number, seed: number): number {
  return hash3(x, 0, z, seed);
}

function valueNoise2(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smooth(x - x0);
  const tz = smooth(z - z0);
  const a = lerp(hash2(x0, z0, seed), hash2(x0 + 1, z0, seed), tx);
  const b = lerp(hash2(x0, z0 + 1, seed), hash2(x0 + 1, z0 + 1, seed), tx);
  return lerp(a, b, tz);
}

function valueNoise3(point: Point3, seed: number): number {
  const x0 = Math.floor(point[0]);
  const y0 = Math.floor(point[1]);
  const z0 = Math.floor(point[2]);
  const tx = smooth(point[0] - x0);
  const ty = smooth(point[1] - y0);
  const tz = smooth(point[2] - z0);
  const c000 = hash3(x0, y0, z0, seed);
  const c100 = hash3(x0 + 1, y0, z0, seed);
  const c010 = hash3(x0, y0 + 1, z0, seed);
  const c110 = hash3(x0 + 1, y0 + 1, z0, seed);
  const c001 = hash3(x0, y0, z0 + 1, seed);
  const c101 = hash3(x0 + 1, y0, z0 + 1, seed);
  const c011 = hash3(x0, y0 + 1, z0 + 1, seed);
  const c111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
  const x00 = lerp(c000, c100, tx);
  const x10 = lerp(c010, c110, tx);
  const x01 = lerp(c001, c101, tx);
  const x11 = lerp(c011, c111, tx);
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
}

function fractalNoise2(x: number, z: number, seed: number): number {
  let result = 0;
  let amplitude = 0.56;
  let total = 0;
  for (let octave = 0; octave < 3; octave++) {
    result += valueNoise2(x * (1 << octave), z * (1 << octave), seed + octave * 977) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
  }
  return result / total;
}

function fractalNoise3(point: Point3, seed: number): number {
  let result = 0;
  let amplitude = 0.56;
  let total = 0;
  for (let octave = 0; octave < 3; octave++) {
    result += valueNoise3([point[0] * (1 << octave), point[1] * (1 << octave), point[2] * (1 << octave)], seed + octave * 977) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
  }
  return result / total;
}

/** Two-dimensional Worley F1 used for distributed weather cells. */
function worley2(x: number, z: number, seed: number): number {
  const cellX = Math.floor(x);
  const cellZ = Math.floor(z);
  let closest = 1.25;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const ix = cellX + dx;
    const iz = cellZ + dz;
    const px = ix + 0.18 + hash2(ix, iz, seed) * 0.64;
    const pz = iz + 0.18 + hash2(ix, iz, seed + 31) * 0.64;
    const ddx = x - px;
    const ddz = z - pz;
    closest = Math.min(closest, Math.sqrt(ddx * ddx + ddz * ddz));
  }
  return clamp01(closest / 0.707);
}

/** Worley F1. Jittered cell points keep the erosion coherent rather than speckled. */
function worley3(point: Point3, seed: number): number {
  const cellX = Math.floor(point[0]);
  const cellY = Math.floor(point[1]);
  const cellZ = Math.floor(point[2]);
  let closest = 1.75;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const ix = cellX + dx;
    const iy = cellY + dy;
    const iz = cellZ + dz;
    const px = ix + 0.18 + hash3(ix, iy, iz, seed) * 0.64;
    const py = iy + 0.18 + hash3(ix, iy, iz, seed + 31) * 0.64;
    const pz = iz + 0.18 + hash3(ix, iy, iz, seed + 67) * 0.64;
    const ddx = point[0] - px;
    const ddy = point[1] - py;
    const ddz = point[2] - pz;
    closest = Math.min(closest, Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz));
  }
  return clamp01(closest / 0.866);
}

function voxelIndex(x: number, y: number, z: number, size: number): number {
  return x + y * size + z * size * size;
}

function normalizeOptions(options: CloudLayerFieldOptions | undefined): Required<CloudLayerFieldOptions> {
  if (options !== undefined && (options === null || typeof options !== 'object' || Array.isArray(options))) {
    throw new Error('Cloud layer field options must be an object.');
  }
  const input = options ?? {};
  const resolution = input.resolution ?? DEFAULT_RESOLUTION;
  if (resolution !== 64 && resolution !== 96) throw new Error('Cloud layer resolution must be 64 or 96.');
  const seed = input.seed ?? DEFAULT_SEED;
  if (!Number.isSafeInteger(seed) || seed < -0x8000_0000 || seed > 0x7fff_ffff) {
    throw new Error('Cloud layer seed must be a signed 32-bit integer.');
  }
  const coverage = input.coverage ?? DEFAULT_COVERAGE;
  const density = input.density ?? DEFAULT_DENSITY;
  const erosion = input.erosion ?? DEFAULT_EROSION;
  for (const [name, value] of [['coverage', coverage], ['density', density], ['erosion', erosion]] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Cloud layer ${name} must be finite and between 0 and 1.`);
  }
  return { resolution, seed, coverage, density, erosion };
}

/**
 * Evaluate one normalized cloud-layer point. The layer is formed by broad
 * weather, coherent 3D noise, and low/high-frequency Worley bands; it cannot
 * turn into a union of geometric primitives.
 */
function sampleDensity(
  point: Point3,
  seed: number,
  coverage: number,
  densityScale: number,
  erosion: number,
  weather: number,
  weatherCell: number,
  cloudType: number,
  warpX: number,
  warpZ: number,
): number {
  const [x, y, z] = point;

  // Local bases and tops vary with weather/type, while staying within a single
  // atmospheric layer. This produces shallow stratiform patches and taller
  // billows without a separate lobe or cap primitive.
  const base = 0.085 + weather * 0.12 + (cloudType - 0.5) * 0.07;
  const height = 0.40 + cloudType * 0.40 + weather * 0.12;
  const top = Math.min(0.965, base + height);
  const layer = smoothstep(base, base + 0.12, y) * (1 - smoothstep(top - 0.16, top, y));
  if (layer <= 0) return 0;
  const localHeight = clamp01((y - base) / Math.max(0.12, top - base));

  // Low-frequency domain warp keeps the coherent masses from aligning to the
  // normalized voxel lattice while preserving a connected cloud field.
  const warped: Point3 = [x * 9.0 + warpX, y * 2.8, z * 9.0 + warpZ];
  const coherentNoise = fractalNoise3(warped, seed + 503);
  // A low-frequency cellular band supplies broad, separated cauliflower
  // bodies. Perlin/value noise alone tends to make one smooth bank at this
  // scale, while the cellular term gives each formation a coherent core.
  const cellularBase = .6 * (1 - worley3([x * 10.5, y * 2.7, z * 10.5], seed + 601))
    + .3 * (1 - worley3([x * 21, y * 5.4, z * 21], seed + 619))
    + .1 * (1 - worley3([x * 42, y * 10.8, z * 42], seed + 631));
  const coherent = .2 + .8 * (.45 * coherentNoise + .55 * cellularBase);

  // Original implicit height field: coverage sets the broad ceiling, coherent
  // 3D noise makes billows, and cellular detail carves the boundary. This is
  // the general weather/profile hierarchy used by volumetric cloud systems.
  const distributedWeather = weather * .6 + weatherCell * .4;
  const ceiling = coverage * 1.2 + (distributedWeather - .5) * 1.8 + (coherent - .65) * 1.3;
  const fine = worley3([x * 17 + warpX * 4, y * 11, z * 17 + warpZ * 4], seed + 701);
  const erosionLoss = erosion * fine * .18;
  const heightDensity = smoothstep(0, .12, ceiling - localHeight - erosionLoss);
  const baseFade = smoothstep(0, .10, localHeight);
  const result = coverage === 0 ? 0 : layer * heightDensity * baseFade * densityScale;

  return clamp01(result);
}

/** Create a deterministic r8unorm cloud-layer field for a broad world layer. */
export function createCloudLayerField(options?: CloudLayerFieldOptions): DenseDensityField {
  const { resolution, seed, coverage, density, erosion } = normalizeOptions(options);
  const data = new Uint8Array(resolution * resolution * resolution);
  // Weather, cloud type, and horizontal domain warp are 2D signals. Cache
  // them once per column: this is both a useful source-model distinction and
  // keeps a 96³ bake within a few seconds in a browser worker.
  const columns = resolution * resolution;
  const weather = new Float32Array(columns);
  const weatherCell = new Float32Array(columns);
  const cloudType = new Float32Array(columns);
  const warpX = new Float32Array(columns);
  const warpZ = new Float32Array(columns);
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
    const px = (x + 0.5) / resolution;
    const pz = (z + 0.5) / resolution;
    const index = x + z * resolution;
    weather[index] = fractalNoise2(px * 2.25 + 3.1, pz * 2.05 - 1.7, seed + 101);
    weatherCell[index] = 1 - worley2(px * 2.8 + 6.4, pz * 2.8 - 5.2, seed + 811);
    cloudType[index] = fractalNoise2(px * 1.3 - 4.2, pz * 1.45 + 2.6, seed + 211);
    warpX[index] = (fractalNoise2(px * 2.0 + 1.3, pz * 2.1 - 3.4, seed + 307) - 0.5) * 0.18;
    warpZ[index] = (fractalNoise2(px * 2.1 - 2.7, pz * 2.0 + 4.1, seed + 401) - 0.5) * 0.18;
  }
  for (let z = 0; z < resolution; z++) {
    const pz = (z + 0.5) / resolution;
    for (let y = 1; y < resolution - 1; y++) {
      const py = (y + 0.5) / resolution;
      for (let x = 0; x < resolution; x++) {
        const px = (x + 0.5) / resolution;
        const column = x + z * resolution;
        data[voxelIndex(x, y, z, resolution)] = Math.round(sampleDensity(
          [px, py, pz], seed, coverage, density, erosion,
          weather[column], weatherCell[column], cloudType[column], warpX[column], warpZ[column],
        ) * 255);
      }
    }
  }
  const descriptor: DensityDescriptor = {
    id: `cloud-layer-r${resolution}-s${seed}-c${coverage}-d${density}-e${erosion}`,
    revision: 0,
    dimensions: [resolution, resolution, resolution],
    bounds: {
      min: [...CLOUD_LAYER_BOUNDS.min] as Vec3,
      max: [...CLOUD_LAYER_BOUNDS.max] as Vec3,
    },
    extinctionScale: EXTINCTION_SCALE,
    encoding: 'r8unorm',
  };
  validateDensityDescriptor(descriptor);
  return { descriptor, data };
}

/** Return compact field metrics useful for source benchmarks and fixtures. */
export function summarizeCloudLayerField(field: DenseDensityField): CloudLayerFieldStatistics {
  const [width, height, depth] = field.descriptor.dimensions;
  let nonzero = 0;
  let intermediate = 0;
  let mass = 0;
  let peakDensity = 0;
  let weightedX = 0;
  let weightedY = 0;
  let weightedZ = 0;
  for (let z = 0; z < depth; z++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = field.data[x + y * width + z * width * height] / 255;
    peakDensity = Math.max(peakDensity, value);
    if (value > 0) nonzero++;
    if (value > 8 / 255 && value < 247 / 255) intermediate++;
    mass += value;
    weightedX += value * ((x + 0.5) / width);
    weightedY += value * ((y + 0.5) / height);
    weightedZ += value * ((z + 0.5) / depth);
  }
  const threshold = Math.round(0.2 * 255);
  const seen = new Uint8Array(field.data.length);
  const queue = new Int32Array(field.data.length);
  let largestCluster = 0;
  let secondLargestCluster = 0;
  for (let z = 0; z < depth; z++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const start = x + y * width + z * width * height;
    if (seen[start] !== 0 || field.data[start] < threshold) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const index = queue[head++];
      const iz = Math.floor(index / (width * height));
      const remainder = index - iz * width * height;
      const iy = Math.floor(remainder / width);
      const ix = remainder - iy * width;
      const neighbours = [[ix + 1, iy, iz], [ix - 1, iy, iz], [ix, iy + 1, iz], [ix, iy - 1, iz], [ix, iy, iz + 1], [ix, iy, iz - 1]] as const;
      for (const [nx, ny, nz] of neighbours) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || nz < 0 || nz >= depth) continue;
        const next = nx + ny * width + nz * width * height;
        if (seen[next] === 0 && field.data[next] >= threshold) {
          seen[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (tail > largestCluster) {
      secondLargestCluster = largestCluster;
      largestCluster = tail;
    } else if (tail > secondLargestCluster) {
      secondLargestCluster = tail;
    }
  }
  const voxelCount = width * height * depth;
  return {
    nonzeroFraction: nonzero / voxelCount,
    meanDensity: mass / voxelCount,
    intermediateFraction: intermediate / voxelCount,
    peakDensity,
    largestClusterFraction: largestCluster / voxelCount,
    secondLargestClusterFraction: secondLargestCluster / voxelCount,
    centroid: mass === 0 ? [0.5, 0.5, 0.5] : [weightedX / mass, weightedY / mass, weightedZ / mass],
  };
}
