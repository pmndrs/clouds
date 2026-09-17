/**
 * A small CPU baseline for the cloudscape atlas. It is deliberately generated
 * once at startup and uploaded as an r8unorm 3D texture; this is not a Nubis
 * port or a GPU weather simulation. The procedural field keeps the reference
 * renderer self contained while later phases can replace this source.
 */

export interface CloudscapeAtlas {
  /** Packed r8unorm voxels. X is fastest, followed by Y and Z. */
  readonly data: Uint8Array;
  readonly dimensions: readonly [number, number, number];
  readonly tileSize: number;
  readonly tilesPerAxis: 2;
  readonly tileCount: 8;
  /** Fraction of all atlas voxels whose stored density is non-zero. */
  readonly occupiedFraction: number;
}

type Lobe = readonly [
  x: number,
  y: number,
  z: number,
  radiusX: number,
  radiusY: number,
  radiusZ: number,
  weight?: number,
];

interface Variant {
  readonly lobes: readonly Lobe[];
  readonly warp: number;
  readonly erosion: number;
  readonly tower: number;
}

const TILE_AXIS = 2 as const;
const TILE_COUNT = 8 as const;
const DEFAULT_TILE_SIZE = 48;
const MAX_TILE_SIZE = 96;

// The lobes overlap into broad masses. Their deliberately different bases,
// shoulders and caps produce eight silhouettes rather than eight copies of a
// single cloud with a changed noise seed.
const VARIANTS: readonly Variant[] = [
  {
    // Open cumulus: a broad, softly flattened base with several billows.
    lobes: [
      [-0.42, 0.22, 0.04, 0.42, 0.20, 0.35, 1.0],
      [-0.18, 0.34, 0.02, 0.43, 0.29, 0.37, 1.0],
      [0.13, 0.38, -0.05, 0.40, 0.32, 0.35, 1.0],
      [0.40, 0.27, 0.03, 0.34, 0.22, 0.31, 0.9],
      [-0.12, 0.64, 0.03, 0.28, 0.25, 0.27, 0.9],
      [0.23, 0.58, -0.06, 0.25, 0.24, 0.24, 0.85],
      [-0.37, 0.49, 0.08, 0.23, 0.20, 0.22, 0.8],
    ],
    warp: 0.15,
    erosion: 0.18,
    tower: 0.08,
  },
  {
    // A rising tower with a lopsided crown and a substantial stem.
    lobes: [
      [-0.08, 0.16, 0.01, 0.34, 0.16, 0.31, 1.0],
      [-0.03, 0.34, 0.03, 0.34, 0.23, 0.30, 1.0],
      [0.03, 0.54, -0.01, 0.29, 0.24, 0.27, 1.0],
      [-0.02, 0.73, 0.01, 0.24, 0.21, 0.24, 0.95],
      [0.08, 0.88, -0.04, 0.27, 0.14, 0.26, 0.85],
      [0.30, 0.83, -0.02, 0.23, 0.16, 0.23, 0.8],
      [-0.23, 0.78, 0.04, 0.18, 0.14, 0.18, 0.75],
    ],
    warp: 0.12,
    erosion: 0.2,
    tower: 0.25,
  },
  {
    // A broad cluster with a low left shelf and a higher right-hand lobe.
    lobes: [
      [-0.46, 0.25, 0.02, 0.39, 0.22, 0.34, 1.0],
      [-0.22, 0.30, -0.05, 0.43, 0.27, 0.38, 1.0],
      [0.14, 0.25, 0.04, 0.42, 0.23, 0.37, 1.0],
      [0.42, 0.34, -0.02, 0.36, 0.30, 0.31, 0.95],
      [-0.38, 0.55, 0.06, 0.28, 0.23, 0.26, 0.8],
      [-0.02, 0.50, -0.01, 0.30, 0.25, 0.28, 0.9],
      [0.30, 0.66, 0.02, 0.29, 0.31, 0.27, 0.9],
      [0.05, 0.86, 0.01, 0.18, 0.16, 0.18, 0.7],
    ],
    warp: 0.18,
    erosion: 0.21,
    tower: 0.1,
  },
  {
    // Chunky wisps: broad ribbons with enough vertical thickness to remain
    // real volume, plus small detached billows near the upper edge.
    lobes: [
      [-0.34, 0.22, 0.02, 0.53, 0.16, 0.25, 0.95],
      [0.06, 0.28, -0.03, 0.54, 0.18, 0.27, 1.0],
      [0.39, 0.38, 0.04, 0.38, 0.16, 0.22, 0.9],
      [-0.27, 0.49, 0.06, 0.42, 0.15, 0.22, 0.9],
      [0.13, 0.56, -0.03, 0.50, 0.17, 0.25, 0.95],
      [-0.15, 0.75, 0.03, 0.31, 0.14, 0.18, 0.75],
      [0.32, 0.78, -0.04, 0.25, 0.13, 0.17, 0.7],
    ],
    warp: 0.2,
    erosion: 0.23,
    tower: 0.02,
  },
  {
    // Anvil-like storm cloud: dense core, high uneven top and wide shoulders.
    lobes: [
      [-0.28, 0.19, 0.00, 0.42, 0.18, 0.35, 1.0],
      [0.10, 0.25, 0.01, 0.46, 0.23, 0.39, 1.0],
      [-0.04, 0.47, 0.03, 0.36, 0.30, 0.31, 1.0],
      [-0.19, 0.74, 0.01, 0.26, 0.29, 0.25, 0.95],
      [0.16, 0.70, -0.03, 0.32, 0.24, 0.29, 0.9],
      [0.48, 0.55, 0.03, 0.30, 0.17, 0.24, 0.78],
      [-0.48, 0.48, -0.02, 0.29, 0.16, 0.25, 0.75],
    ],
    warp: 0.16,
    erosion: 0.17,
    tower: 0.16,
  },
  {
    // Cumulus field with one dominant lobe and smaller satellites.
    lobes: [
      [-0.08, 0.24, -0.02, 0.53, 0.24, 0.41, 1.0],
      [0.31, 0.30, 0.03, 0.35, 0.27, 0.30, 0.88],
      [-0.42, 0.33, 0.02, 0.29, 0.20, 0.27, 0.75],
      [-0.23, 0.55, -0.01, 0.32, 0.31, 0.28, 0.9],
      [0.12, 0.68, 0.04, 0.28, 0.28, 0.25, 0.88],
      [-0.02, 0.90, -0.01, 0.18, 0.12, 0.18, 0.7],
    ],
    warp: 0.17,
    erosion: 0.22,
    tower: 0.12,
  },
  {
    // Low cluster with a few pronounced cauliflower towers.
    lobes: [
      [-0.42, 0.21, 0.03, 0.39, 0.19, 0.33, 0.95],
      [-0.16, 0.26, -0.02, 0.44, 0.22, 0.37, 1.0],
      [0.19, 0.27, 0.04, 0.40, 0.23, 0.35, 1.0],
      [0.43, 0.23, -0.01, 0.32, 0.20, 0.28, 0.9],
      [-0.25, 0.53, 0.03, 0.25, 0.32, 0.23, 0.88],
      [0.04, 0.70, -0.03, 0.19, 0.29, 0.20, 0.85],
      [0.29, 0.57, 0.02, 0.22, 0.26, 0.21, 0.8],
    ],
    warp: 0.19,
    erosion: 0.2,
    tower: 0.18,
  },
  {
    // Tall, wind-sheared tower whose upper lobes lean to one side.
    lobes: [
      [0.08, 0.16, 0.00, 0.36, 0.17, 0.31, 1.0],
      [0.04, 0.36, 0.03, 0.35, 0.25, 0.30, 1.0],
      [0.09, 0.58, -0.02, 0.30, 0.27, 0.27, 1.0],
      [0.19, 0.76, 0.00, 0.25, 0.21, 0.24, 0.9],
      [0.34, 0.90, -0.03, 0.25, 0.13, 0.23, 0.82],
      [-0.19, 0.74, 0.02, 0.18, 0.17, 0.19, 0.72],
      [0.45, 0.70, 0.01, 0.22, 0.16, 0.20, 0.7],
    ],
    warp: 0.14,
    erosion: 0.24,
    tower: 0.3,
  },
];

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
  let sum = 0;
  let amplitude = 0.5;
  let normalization = 0;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave++) {
    sum += valueNoise(x * frequency, y * frequency, z * frequency, seed + octave * 1013) * amplitude;
    normalization += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / normalization;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lobeField(x: number, y: number, z: number, lobe: Lobe): number {
  const dx = (x - lobe[0]) / lobe[3];
  const dy = (y - lobe[1]) / lobe[4];
  const dz = (z - lobe[2]) / lobe[5];
  const distanceSquared = dx * dx + dy * dy + dz * dz;
  const weight = lobe[6] ?? 1;
  // The broad falloff leaves connected, substantial voxels between billows.
  return smoothstep(1.12, 0.16, distanceSquared) * weight;
}

function atlasIndex(tileX: number, tileY: number, tileZ: number): number {
  return tileX + TILE_AXIS * tileY + TILE_AXIS * TILE_AXIS * tileZ;
}

function voxelIndex(x: number, y: number, z: number, size: number): number {
  return x + y * size + z * size * size;
}

function normalizeTileSize(tileSize: number): number {
  if (!Number.isSafeInteger(tileSize) || tileSize < 2 || tileSize > MAX_TILE_SIZE) {
    throw new Error(`Cloudscape atlas tileSize must be a safe integer between 2 and ${MAX_TILE_SIZE}.`);
  }
  return tileSize;
}

function normalizeSeed(seed: number): number {
  if (!Number.isSafeInteger(seed)) throw new Error('Cloudscape atlas seed must be a safe integer.');
  return seed;
}

function sampleDensity(
  variant: Variant,
  tileVariant: number,
  x: number,
  y: number,
  z: number,
  seed: number,
): number {
  // Domain warp moves the lobe boundary itself, giving the silhouette broken,
  // weather-like edges instead of smooth ellipsoid outlines.
  const warpSeed = seed + tileVariant * 179 + 29;
  const warpX = (fractalNoise(x * 2.2 + 4.1, y * 2.0 - 1.2, z * 2.2 + 3.7, warpSeed, 2) - 0.5) * variant.warp;
  const warpY = (fractalNoise(x * 2.0 - 2.3, y * 2.4 + 3.5, z * 2.0 - 0.8, warpSeed + 17, 2) - 0.5) * variant.warp * 0.65;
  const warpZ = (fractalNoise(x * 2.2 + 1.7, y * 2.1 + 0.5, z * 2.3 - 4.6, warpSeed + 31, 2) - 0.5) * variant.warp;
  const wx = x + warpX;
  const wy = y + warpY;
  const wz = z + warpZ;

  let broad = 0;
  for (const lobe of variant.lobes) broad = Math.max(broad, lobeField(wx, wy, wz, lobe));
  if (broad <= 0.015) return 0;

  const noiseSeed = seed + tileVariant * 233 + 71;
  const low = fractalNoise(wx * 3.1 + 0.8, wy * 2.7 - 0.4, wz * 3.0 + 1.3, noiseSeed, 2);
  const detail = fractalNoise(wx * 8.5 - 1.1, wy * 7.8 + 0.7, wz * 8.3 + 2.4, noiseSeed + 47, 3);
  const eroded = broad + (low - 0.5) * variant.erosion + (detail - 0.5) * variant.erosion * 0.72;
  let density = smoothstep(0.08, 0.68, eroded);
  density *= 0.77 + detail * 0.23;

  // Cloud bases are broad and relatively flat, while the upper half is free to
  // form cauliflower lobes and towers. A modest base fade protects the guard
  // layer without turning the cloud into a duplicated thin horizontal sheet.
  const baseFade = smoothstep(0.025, 0.12, y);
  const topLift = 1 + variant.tower * smoothstep(0.48, 0.92, y) * (0.10 + low * 0.12);
  density *= baseFade * topLift;
  return clamp01(density);
}

/**
 * Generate eight deterministic cloud volumes in a 2x2x2 r8unorm atlas.
 *
 * The sample position for every local voxel is its normalized texel centre,
 * `(coordinate + 0.5) / tileSize`. This matches linear 3D texture sampling and
 * keeps each tile's one-voxel empty guard isolated from its neighbours.
 */
export function createCloudscapeAtlas(tileSize: number = DEFAULT_TILE_SIZE, seed: number = 17): CloudscapeAtlas {
  const size = normalizeTileSize(tileSize);
  const normalizedSeed = normalizeSeed(seed);
  const atlasSize = size * TILE_AXIS;
  const data = new Uint8Array(atlasSize * atlasSize * atlasSize);
  let occupied = 0;

  for (let tileZ = 0; tileZ < TILE_AXIS; tileZ++) {
    for (let tileY = 0; tileY < TILE_AXIS; tileY++) {
      for (let tileX = 0; tileX < TILE_AXIS; tileX++) {
        const tile = atlasIndex(tileX, tileY, tileZ);
        const variant = VARIANTS[tile];
        for (let localZ = 0; localZ < size; localZ++) {
          const w = (localZ + 0.5) / size;
          const z = w * 2 - 1;
          for (let localY = 0; localY < size; localY++) {
            const v = (localY + 0.5) / size;
            for (let localX = 0; localX < size; localX++) {
              // Every face gets a true zero texel. This is stronger than a
              // faded edge and prevents trilinear bleed across packed tiles.
              if (
                localX === 0 || localX === size - 1 ||
                localY === 0 || localY === size - 1 ||
                localZ === 0 || localZ === size - 1
              ) continue;
              const u = (localX + 0.5) / size;
              const x = u * 2 - 1;
              const density = sampleDensity(variant, tile, x, v, z, normalizedSeed);
              if (density <= 0) continue;
              const value = Math.round(density * 255);
              const globalX = tileX * size + localX;
              const globalY = tileY * size + localY;
              const globalZ = tileZ * size + localZ;
              data[voxelIndex(globalX, globalY, globalZ, atlasSize)] = value;
              occupied++;
            }
          }
        }
      }
    }
  }

  return {
    data,
    dimensions: [atlasSize, atlasSize, atlasSize],
    tileSize: size,
    tilesPerAxis: TILE_AXIS,
    tileCount: TILE_COUNT,
    occupiedFraction: occupied / data.length,
  };
}
