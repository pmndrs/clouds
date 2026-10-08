import type { DensityDescriptor, Vec3 } from '@clouds/core';
import { validateDensityDescriptor } from '@clouds/core';

/** The built-in fields used by the first-cloud reference scene. */
export type DensityPreset = 'cumulus' | 'tower' | 'wisps' | 'authored' | 'homogeneous' | 'empty';

/** A dense, single-channel voxel field ready for upload to an r8unorm 3D texture. */
export interface DenseDensityField {
  readonly descriptor: DensityDescriptor;
  /** X is the fastest varying coordinate: x + y * width + z * width * height. */
  readonly data: Uint8Array;
}

export const DEFAULT_DENSITY_RESOLUTION = 64;
export const DEFAULT_DENSITY_BOUNDS: { readonly min: Vec3; readonly max: Vec3 } = {
  min: [-300, 100, -250],
  max: [300, 600, 250],
};
export const DEFAULT_EXTINCTION_SCALE = 0.025;

const PRESETS: ReadonlySet<DensityPreset> = new Set([
  'cumulus',
  'tower',
  'wisps',
  'authored',
  'homogeneous',
  'empty',
]);

type Lobe = readonly [x: number, y: number, z: number, rx: number, ry: number, rz: number];

/*
 * These are intentionally small, deterministic value-noise helpers rather than
 * a dependency on a random/noise package.  Hashing lattice points means changing
 * the iteration order (or generating only a subregion later) cannot change a field.
 */
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

function smooth(t: number): number {
  // Quintic interpolation has a zero derivative at lattice boundaries.
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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

function fractalNoise(x: number, y: number, z: number, seed: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let amplitudeSum = 0;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave++) {
    value += valueNoise(x * frequency, y * frequency, z * frequency, seed + octave * 1013) * amplitude;
    amplitudeSum += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / amplitudeSum;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lobeDensity(x: number, y: number, z: number, lobe: Lobe): number {
  const dx = (x - lobe[0]) / lobe[3];
  const dy = (y - lobe[1]) / lobe[4];
  const dz = (z - lobe[2]) / lobe[5];
  const distanceSquared = dx * dx + dy * dy + dz * dz;
  // A broad plateau with a long, soft falloff reads as a cloud volume instead
  // of a hard-edged collection of spheres.
  return 1 - smoothstep(0.42, 1, distanceSquared);
}

const LOBES: Record<Exclude<DensityPreset, 'homogeneous' | 'empty'>, readonly Lobe[]> = {
  cumulus: [
    [-0.34, 0.38, 0.03, 0.31, 0.23, 0.30],
    [-0.16, 0.53, 0.00, 0.34, 0.31, 0.31],
    [0.08, 0.56, -0.04, 0.35, 0.34, 0.32],
    [0.31, 0.42, 0.04, 0.29, 0.25, 0.29],
    [-0.02, 0.76, 0.01, 0.23, 0.23, 0.23],
    [0.24, 0.67, -0.02, 0.21, 0.21, 0.22],
  ],
  tower: [
    [0.00, 0.16, 0.00, 0.30, 0.17, 0.27],
    [-0.04, 0.34, 0.03, 0.31, 0.22, 0.28],
    [0.04, 0.52, -0.01, 0.27, 0.22, 0.25],
    [-0.03, 0.69, 0.03, 0.22, 0.20, 0.22],
    [0.06, 0.84, -0.02, 0.16, 0.16, 0.17],
    [0.00, 0.39, 0.00, 0.42, 0.18, 0.36],
  ],
  wisps: [
    [-0.02, 0.24, 0.00, 0.54, 0.085, 0.22],
    [-0.25, 0.39, 0.08, 0.38, 0.075, 0.16],
    [0.24, 0.47, -0.04, 0.43, 0.09, 0.18],
    [-0.02, 0.63, 0.04, 0.58, 0.075, 0.19],
    [0.18, 0.78, -0.06, 0.33, 0.06, 0.15],
  ],
  authored: [
    [-0.08, 0.32, 0.00, 0.36, 0.26, 0.30],
    [0.17, 0.45, -0.05, 0.29, 0.31, 0.25],
    [-0.27, 0.49, 0.07, 0.22, 0.20, 0.21],
    [0.02, 0.65, 0.02, 0.25, 0.26, 0.24],
    [-0.14, 0.78, -0.03, 0.16, 0.19, 0.17],
  ],
};

function normalizeResolution(resolution: number | undefined): number {
  const value = resolution ?? DEFAULT_DENSITY_RESOLUTION;
  // 256³ is a 16 MiB r8 field and keeps accidental inputs from causing an
  // unbounded allocation while leaving room for large authored test fixtures.
  if (!Number.isSafeInteger(value) || value < 1 || value > 256) {
    throw new Error('Density resolution must be a safe integer between 1 and 256.');
  }
  return value;
}

function normalizeSeed(seed: number | undefined): number {
  const value = seed ?? 0;
  if (!Number.isSafeInteger(value)) throw new Error('Density seed must be a safe integer.');
  return value;
}

function shapeDensity(
  preset: Exclude<DensityPreset, 'homogeneous' | 'empty'>,
  x: number,
  y: number,
  z: number,
  seed: number,
  cellHalfWidth: number,
): number {
  // Leave an empty voxel layer at every face. Besides preventing clipped lobes,
  // this gives a ray entering at a volume boundary a stable zero-density sample
  // before it reaches the cloud. The subtraction makes the first texel centre
  // exactly zero while the following texels fade in smoothly.
  const faceDistance = Math.min(x + 0.5, 0.5 - x, y, 1 - y, z + 0.5, 0.5 - z) - cellHalfWidth;
  const boundaryFade = smoothstep(0, 0.09, faceDistance);
  if (boundaryFade <= 0) return 0;
  let broad = 0;
  for (const lobe of LOBES[preset]) broad = Math.max(broad, lobeDensity(x, y, z, lobe));
  if (broad <= 0) return 0;

  // Low frequency noise changes the mass of a lobe; the higher frequency term
  // breaks up the rim and produces visible billows without making pinholes.
  const low = fractalNoise((x + 0.37) * 3.0, (y + 0.11) * 2.8, (z - 0.23) * 3.0, seed + 17, 3);
  const detail = fractalNoise((x - 0.19) * 10.0, (y + 0.31) * 8.0, (z + 0.07) * 10.0, seed + 43, 4);
  const eroded = broad + (low - 0.5) * 0.24 + (detail - 0.5) * 0.14;
  const rim = smoothstep(0.0, 0.34, broad);
  let density = smoothstep(0.10, 0.64, eroded) * rim;
  density *= 0.82 + detail * 0.18;

  // Keep an airy base and a slightly denser centre on wisps. This also makes
  // the preset visibly distinct at a distance while preserving soft edges.
  if (preset === 'wisps') density *= 0.84 + 0.16 * smoothstep(0.08, 0.7, broad);
  return Math.max(0, Math.min(1, density * boundaryFade));
}

function voxelIndex(x: number, y: number, z: number, size: number): number {
  return x + y * size + z * size * size;
}

/**
 * Create a deterministic dense r8unorm density field. Density is dimensionless;
 * the descriptor's extinctionScale maps it to inverse metres in the integrator.
 */
export function createDensityField(
  preset: DensityPreset,
  resolution: number = DEFAULT_DENSITY_RESOLUTION,
  seed: number = 0,
): DenseDensityField {
  if (!PRESETS.has(preset)) throw new Error(`Unknown density preset: ${String(preset)}`);
  const size = normalizeResolution(resolution);
  const normalizedSeed = normalizeSeed(seed);
  const voxelCount = size * size * size;
  const data = new Uint8Array(voxelCount);
  if (preset === 'homogeneous') data.fill(255);
  else if (preset !== 'empty') {
    const cellHalfWidth = 0.5 / size;
    for (let z = 0; z < size; z++) {
      // Data3DTexture's linear sampler addresses texel centres at (i + .5) / n.
      const pz = (z + 0.5) / size - 0.5;
      for (let y = 0; y < size; y++) {
        const py = (y + 0.5) / size;
        for (let x = 0; x < size; x++) {
          const px = (x + 0.5) / size - 0.5;
          data[voxelIndex(x, y, z, size)] = Math.round(
            shapeDensity(preset, px, py, pz, normalizedSeed, cellHalfWidth) * 255,
          );
        }
      }
    }
  }

  const descriptor: DensityDescriptor = {
    id: `generated-${preset}-r${size}-s${normalizedSeed}`,
    revision: 0,
    dimensions: [size, size, size],
    bounds: {
      min: [...DEFAULT_DENSITY_BOUNDS.min] as Vec3,
      max: [...DEFAULT_DENSITY_BOUNDS.max] as Vec3,
    },
    extinctionScale: DEFAULT_EXTINCTION_SCALE,
    encoding: 'r8unorm',
  };
  validateDensityDescriptor(descriptor);
  return { descriptor, data };
}
