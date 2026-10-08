import { validateDensityDescriptor, type DensityDescriptor, type Vec3 } from '../../packages/core/src/index';
import type { DenseDensityField } from '../../packages/three/src/sources/density';

/** World-space extent used by the cumulus candidate source (metres). */
export const CUMULUS_BOUNDS: { readonly min: Vec3; readonly max: Vec3 } = {
  min: [-1200, 700, -1000],
  max: [1200, 2700, 1000],
};

const DEFAULT_RESOLUTION = 96 as const;
const DEFAULT_SEED = 17;
const DEFAULT_EROSION = 0.55;
const EXTINCTION_SCALE = 0.003;

export interface CumulusFieldOptions {
  readonly resolution?: 64 | 96;
  readonly seed?: number;
  readonly erosion?: number;
}

type FieldPoint = readonly [x: number, y: number, z: number];
type Lobe = readonly [centre: FieldPoint, radius: FieldPoint];

// The 1.08 support radius in ellipsoid() leaves a generous empty margin above
// the upper silhouette. Keeping this table static avoids rebuilding it per voxel.
const CUMULUS_LOBES: readonly Lobe[] = [
  [[-0.34, 0.38, 0.02], [0.44, 0.32, 0.43]],
  [[0.02, 0.43, -0.03], [0.49, 0.38, 0.46]],
  [[0.35, 0.47, 0.03], [0.38, 0.34, 0.39]],
  [[-0.19, 0.59, 0.04], [0.34, 0.21, 0.34]],
  [[0.18, 0.64, -0.03], [0.36, 0.23, 0.35]],
  [[-0.48, 0.51, -0.06], [0.27, 0.22, 0.30]],
  [[0.44, 0.54, 0.10], [0.27, 0.21, 0.28]],
];

function smooth(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** A stable integer hash; seed is deliberately folded as a signed 32-bit value. */
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

function valueNoise(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const tz = smooth(z - z0);
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

function fractalNoise(point: FieldPoint, seed: number, octaves: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let total = 0;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave++) {
    sum += valueNoise(point[0] * frequency, point[1] * frequency, point[2] * frequency, seed + octave * 977) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function ellipsoid(point: FieldPoint, centre: FieldPoint, radius: FieldPoint): number {
  const x = (point[0] - centre[0]) / radius[0];
  const y = (point[1] - centre[1]) / radius[1];
  const z = (point[2] - centre[2]) / radius[2];
  return 1 - smoothstep(0.55, 1.08, x * x + y * y + z * z);
}

function normalizeOptions(options: CumulusFieldOptions | undefined): Required<CumulusFieldOptions> {
  if (options !== undefined && (options === null || typeof options !== 'object' || Array.isArray(options))) {
    throw new Error('Cumulus field options must be an object.');
  }
  const input = options ?? {};
  const resolution = input.resolution ?? DEFAULT_RESOLUTION;
  if (resolution !== 64 && resolution !== 96) {
    throw new Error('Cumulus resolution must be 64 or 96.');
  }
  const seed = input.seed ?? DEFAULT_SEED;
  if (!Number.isSafeInteger(seed) || seed < -0x8000_0000 || seed > 0x7fff_ffff) {
    throw new Error('Cumulus seed must be a signed 32-bit integer.');
  }
  const erosion = input.erosion ?? DEFAULT_EROSION;
  if (!Number.isFinite(erosion) || erosion < 0 || erosion > 1) {
    throw new Error('Cumulus erosion must be finite and between 0 and 1.');
  }
  return { resolution, seed, erosion };
}

/**
 * Evaluate one normalized world point. The broad profile supplies connected
 * cloud mass; noise only modulates it, so detail cannot create isolated specks.
 */
function sampleDensity(point: FieldPoint, seed: number, erosion: number): number {
  const [x, y, z] = point;

  // A low-frequency warp makes the lobe boundaries lean and drift together.
  const warp = fractalNoise([x * 1.25 + 4.3, y * 1.1 - 2.1, z * 1.35 + 1.7], seed + 101, 2);
  const warpX = (warp - 0.5) * 0.11;
  const warpY = (fractalNoise([x * 1.0 - 2.4, y * 1.3 + 3.7, z * 1.15 - 1.9], seed + 211, 2) - 0.5) * 0.07;
  const warpZ = (fractalNoise([x * 1.2 + 0.8, y * 1.05 + 1.6, z * 1.25 + 4.1], seed + 307, 2) - 0.5) * 0.11;
  const warped: FieldPoint = [x + warpX, y + warpY, z + warpZ];

  // A broad, fairly flat condensation base binds the upper billows together.
  const radial = Math.sqrt((warped[0] / 0.78) ** 2 + (warped[2] / 0.72) ** 2);
  const basePlanform = 1 - smoothstep(0.72, 1.04, radial);
  // The long upper fade overlaps the lower lobes, avoiding a hard shelf where
  // a short cylindrical condensation base would otherwise terminate.
  const baseVertical = smoothstep(0.045, 0.14, warped[1]) * (1 - smoothstep(0.34, 0.68, warped[1]));
  const base = basePlanform * baseVertical;

  // Overlapping, unequal lobes form an identifiable body with asymmetric tops.
  let broad = base * 0.72;
  for (const [centre, radius] of CUMULUS_LOBES) broad = Math.max(broad, ellipsoid(warped, centre, radius));
  if (broad <= 0) return 0;

  const low = fractalNoise([warped[0] * 2.3 + 1.7, warped[1] * 2.0 - 0.3, warped[2] * 2.45 - 2.2], seed + 401, 3);
  const detail = fractalNoise([warped[0] * 7.0 - 1.1, warped[1] * 6.0 + 0.4, warped[2] * 7.5 + 2.6], seed + 503, 3);
  // The low band makes broad billows while the second band breaks their rims;
  // amplitudes are large enough to read at 64³ without making disconnected fuzz.
  const cloudSignal = broad + (low - 0.5) * 1.25 + (detail - 0.5) * 0.72;
  let density = smoothstep(0.18, 0.72, cloudSignal) * smoothstep(0.02, 0.30, broad);
  density *= 0.82 + detail * 0.18;

  // The loss is concentrated at the rim. Thus increasing erosion can only
  // lower a voxel's density and does not change the formation's core location.
  const edgeLoss = 1 - smoothstep(0.26, 0.88, broad);
  density = Math.max(0, density - erosion * edgeLoss * (0.22 + detail * 0.26));
  return clamp01(density);
}

function voxelIndex(x: number, y: number, z: number, size: number): number {
  return x + y * size + z * size * size;
}

/** Create a deterministic r8unorm cumulus candidate for the P2 source experiment. */
export function createCumulusField(options?: CumulusFieldOptions): DenseDensityField {
  const { resolution, seed, erosion } = normalizeOptions(options);
  const data = new Uint8Array(resolution * resolution * resolution);
  for (let z = 1; z < resolution - 1; z++) {
    const pz = ((z + 0.5) / resolution) * 2 - 1;
    for (let y = 1; y < resolution - 1; y++) {
      const py = (y + 0.5) / resolution;
      for (let x = 1; x < resolution - 1; x++) {
        const px = ((x + 0.5) / resolution) * 2 - 1;
        data[voxelIndex(x, y, z, resolution)] = Math.round(sampleDensity([px, py, pz], seed, erosion) * 255);
      }
    }
  }
  const descriptor: DensityDescriptor = {
    id: `cumulus-candidate-r${resolution}-s${seed}-e${erosion}`,
    revision: 0,
    dimensions: [resolution, resolution, resolution],
    bounds: {
      min: [...CUMULUS_BOUNDS.min] as Vec3,
      max: [...CUMULUS_BOUNDS.max] as Vec3,
    },
    extinctionScale: EXTINCTION_SCALE,
    encoding: 'r8unorm',
  };
  validateDensityDescriptor(descriptor);
  return { descriptor, data };
}
