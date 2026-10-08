/**
 * Seeded, periodic noise fields for procedural cloud morphology.
 *
 * These fields are intended to be uploaded as three RGBA textures: a 2D
 * weather map and separate 3D shape and detail volumes. Voxel order is
 * X-fastest, then Y, then Z. The implementation is deliberately standalone
 * and uses only integer hashing plus periodic lattice noise.
 */

export interface MorphologyNoiseOptions {
  readonly seed?: number;
  readonly volumeResolution?: 16 | 32 | 64;
  readonly weatherResolution?: 32 | 64 | 128;
}

export interface MorphologyNoiseResources {
  readonly seed: number;
  readonly volumeResolution: 16 | 32 | 64;
  readonly weatherResolution: 32 | 64 | 128;
  /** RGBA weather map, X fastest, then Y. */
  readonly weather: Uint8Array;
  /** RGBA shape volume, X fastest, then Y, then Z. */
  readonly shape: Uint8Array;
  /** RGBA detail volume, X fastest, then Y, then Z. */
  readonly detail: Uint8Array;
}

const DEFAULT_SEED = 17;
const DEFAULT_VOLUME_RESOLUTION = 64;
const DEFAULT_WEATHER_RESOLUTION = 128;
export interface NoiseMipLevel {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (seed ^ Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

function hash2(x: number, y: number, seed: number): number {
  return hash3(x, y, 0, seed);
}

function unitHash(hash: number): number {
  return hash / 0xffffffff;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

const GRADIENTS_3D: readonly (readonly [number, number, number])[] = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

const GRADIENTS_2D: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.70710678118, 0.70710678118], [-0.70710678118, 0.70710678118],
  [0.70710678118, -0.70710678118], [-0.70710678118, -0.70710678118],
];

function wrapCell(value: number, cells: number): number {
  return ((value % cells) + cells) % cells;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Periodic gradient Perlin noise. Coordinates are normalized to a unit tile. */
export function periodicGradientNoise3D(
  x: number,
  y: number,
  z: number,
  cells: number,
  seed: number,
): number {
  const px = x * cells;
  const py = y * cells;
  const pz = z * cells;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const iz = Math.floor(pz);
  const fx = px - ix;
  const fy = py - iy;
  const fz = pz - iz;
  const u = fade(fx);
  const v = fade(fy);
  const w = fade(fz);

  const corner = (dx: number, dy: number, dz: number): number => {
    const gx = GRADIENTS_3D[hash3(wrapCell(ix + dx, cells), wrapCell(iy + dy, cells), wrapCell(iz + dz, cells), seed) % GRADIENTS_3D.length];
    return gx[0] * (fx - dx) + gx[1] * (fy - dy) + gx[2] * (fz - dz);
  };

  const x00 = lerp(corner(0, 0, 0), corner(1, 0, 0), u);
  const x10 = lerp(corner(0, 1, 0), corner(1, 1, 0), u);
  const x01 = lerp(corner(0, 0, 1), corner(1, 0, 1), u);
  const x11 = lerp(corner(0, 1, 1), corner(1, 1, 1), u);
  // The scale maps the gradient dot range into a useful approximately [-1, 1].
  return Math.max(-1, Math.min(1, lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 1.6));
}

/** Periodic 2D gradient Perlin noise. Coordinates are normalized to a unit tile. */
export function periodicGradientNoise2D(
  x: number,
  y: number,
  cells: number,
  seed: number,
): number {
  const px = x * cells;
  const py = y * cells;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const u = fade(fx);
  const v = fade(fy);
  const corner = (dx: number, dy: number): number => {
    const gradient = GRADIENTS_2D[hash2(wrapCell(ix + dx, cells), wrapCell(iy + dy, cells), seed) % GRADIENTS_2D.length];
    return gradient[0] * (fx - dx) + gradient[1] * (fy - dy);
  };
  return Math.max(-1, Math.min(1, lerp(
    lerp(corner(0, 0), corner(1, 0), u),
    lerp(corner(0, 1), corner(1, 1), u),
    v,
  ) * 1.45));
}

function normalizedFbm2D(x: number, y: number, cells: number, seed: number, octaves = 4): number {
  let total = 0;
  let weight = 0;
  let amplitude = 0.58;
  for (let octave = 0; octave < octaves; octave++) {
    total += (periodicGradientNoise2D(x, y, cells * (1 << octave), seed + octave * 1013) * 0.5 + 0.5) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
  }
  return total / weight;
}

function normalizedFbm3D(x: number, y: number, z: number, cells: number, seed: number, octaves = 4): number {
  let total = 0;
  let weight = 0;
  let amplitude = 0.58;
  for (let octave = 0; octave < octaves; octave++) {
    total += (periodicGradientNoise3D(x, y, z, cells * (1 << octave), seed + octave * 1013) * 0.5 + 0.5) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
  }
  return total / weight;
}

function worleyF1(x: number, y: number, z: number, cells: number, seed: number): number {
  const px = x * cells;
  const py = y * cells;
  const pz = z * cells;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const iz = Math.floor(pz);
  let nearestSquared = 3;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx;
    const cy = iy + dy;
    const cz = iz + dz;
    const h = hash3(wrapCell(cx, cells), wrapCell(cy, cells), wrapCell(cz, cells), seed);
    const featureX = cx + unitHash(h);
    const featureY = cy + unitHash(hash3(wrapCell(cx, cells), wrapCell(cy, cells), wrapCell(cz, cells), seed ^ 0x68bc21eb));
    const featureZ = cz + unitHash(hash3(wrapCell(cx, cells), wrapCell(cy, cells), wrapCell(cz, cells), seed ^ 0x02e5be93));
    const vx = featureX - px;
    const vy = featureY - py;
    const vz = featureZ - pz;
    nearestSquared = Math.min(nearestSquared, vx * vx + vy * vy + vz * vz);
  }
  // A fixed scale preserves broad, useful contrast across octave frequencies.
  return Math.max(0, Math.min(1, Math.sqrt(nearestSquared) / 1.35));
}

function normalizedWorleyFbm(x: number, y: number, z: number, cells: number, seed: number): number {
  const weights = [0.625, 0.25, 0.125] as const;
  let value = 0;
  for (let octave = 0; octave < weights.length; octave++) {
    value += worleyF1(x, y, z, cells * (1 << octave), seed + octave * 1013) * weights[octave];
  }
  return value;
}

function byte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

function validateOptions(options: MorphologyNoiseOptions): Required<MorphologyNoiseOptions> {
  const seed = options.seed ?? DEFAULT_SEED;
  const volumeResolution = options.volumeResolution ?? DEFAULT_VOLUME_RESOLUTION;
  const weatherResolution = options.weatherResolution ?? DEFAULT_WEATHER_RESOLUTION;
  if (!Number.isInteger(seed) || seed < -0x80000000 || seed > 0x7fffffff) {
    throw new RangeError('seed must be a signed 32-bit integer');
  }
  if (volumeResolution !== 16 && volumeResolution !== 32 && volumeResolution !== 64) {
    throw new RangeError('volumeResolution must be 16, 32, or 64');
  }
  if (weatherResolution !== 32 && weatherResolution !== 64 && weatherResolution !== 128) {
    throw new RangeError('weatherResolution must be 32, 64, or 128');
  }
  return { seed, volumeResolution, weatherResolution };
}

/**
 * Build box-filtered RGBA mip levels from a square 2D or cubic 3D payload.
 * The returned chain includes the original level and continues through 1x1
 * (or 1x1x1). Each lower level averages four or eight source texels.
 */
export function createNoiseMipChain(
  data: Uint8Array,
  resolution: number,
  dimension: 2 | 3,
): NoiseMipLevel[] {
  if (dimension !== 2 && dimension !== 3) throw new RangeError('dimension must be 2 or 3');
  if (!Number.isInteger(resolution) || resolution < 1 || (resolution & (resolution - 1)) !== 0) {
    throw new RangeError('resolution must be a positive power of two');
  }
  if (!(data instanceof Uint8Array)) throw new TypeError('data must be a Uint8Array RGBA payload');
  const baseDepth = dimension === 2 ? 1 : resolution;
  const expectedLength = resolution * resolution * baseDepth * 4;
  if (data.length !== expectedLength) {
    throw new RangeError(`RGBA payload must contain ${expectedLength} bytes for this resolution and dimension`);
  }

  const levels: NoiseMipLevel[] = [{ data: data.slice(), width: resolution, height: resolution, depth: baseDepth }];
  let previous = levels[0];
  while (previous.width > 1) {
    const width = previous.width / 2;
    const height = previous.height / 2;
    const depth = dimension === 2 ? 1 : previous.depth / 2;
    const nextData = new Uint8Array(width * height * depth * 4);
    const taps = dimension === 2 ? 4 : 8;
    for (let z = 0; z < depth; z++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const destination = (x + y * width + z * width * height) * 4;
      for (let channel = 0; channel < 4; channel++) {
        let sum = 0;
        for (let dz = 0; dz < (dimension === 2 ? 1 : 2); dz++) {
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            const sourceX = x * 2 + dx;
            const sourceY = y * 2 + dy;
            const sourceZ = dimension === 2 ? 0 : z * 2 + dz;
            const source = (sourceX + sourceY * previous.width + sourceZ * previous.width * previous.height) * 4;
            sum += previous.data[source + channel];
          }
        }
        nextData[destination + channel] = Math.round(sum / taps);
      }
    }
    const level = { data: nextData, width, height, depth };
    levels.push(level);
    previous = level;
  }
  return levels;
}

/** Generate deterministic tileable weather, shape, and detail texture data. */
export function createMorphologyNoise(options: MorphologyNoiseOptions = {}): MorphologyNoiseResources {
  const { seed, volumeResolution, weatherResolution } = validateOptions(options);
  const weather = new Uint8Array(weatherResolution * weatherResolution * 4);
  const shape = new Uint8Array(volumeResolution ** 3 * 4);
  const detail = new Uint8Array(volumeResolution ** 3 * 4);

  for (let y = 0; y < weatherResolution; y++) for (let x = 0; x < weatherResolution; x++) {
    const u = (x + 0.5) / weatherResolution;
    const v = (y + 0.5) / weatherResolution;
    const index = (x + y * weatherResolution) * 4;
    // Broad coverage has distinct meso-scale variation to avoid a smooth blob.
    const broad = normalizedFbm2D(u, v, 3, seed + 11, 3);
    const meso = normalizedFbm2D(u, v, 9, seed + 47, 3);
    weather[index] = byte(Math.max(0, Math.min(1, 0.54 * broad + 0.46 * meso)));
    weather[index + 1] = byte(normalizedFbm2D(u, v, 5, seed + 173, 4));
    weather[index + 2] = byte(normalizedFbm2D(u, v, 7, seed + 389, 4));
    weather[index + 3] = 255;
  }

  for (let z = 0; z < volumeResolution; z++) for (let y = 0; y < volumeResolution; y++) for (let x = 0; x < volumeResolution; x++) {
    const u = (x + 0.5) / volumeResolution;
    const v = (y + 0.5) / volumeResolution;
    const w = (z + 0.5) / volumeResolution;
    const index = (x + y * volumeResolution + z * volumeResolution * volumeResolution) * 4;

    // Two slow, independent gradient fields bend the billowy base coordinates.
    const warpX = (periodicGradientNoise3D(u, v, w, 3, seed + 521) + periodicGradientNoise3D(u, v, w, 6, seed + 557) * 0.35) * 0.055;
    const warpY = (periodicGradientNoise3D(u, v, w, 3, seed + 601) + periodicGradientNoise3D(u, v, w, 6, seed + 647) * 0.35) * 0.055;
    const sx = u + warpX;
    const sy = v + warpY;
    const sz = w + (periodicGradientNoise3D(u, v, w, 3, seed + 683) * 0.035);

    const billow = normalizedFbm3D(sx, sy, sz, 4, seed + 719, 4);
    const cellular = normalizedWorleyFbm(sx, sy, sz, 4, seed + 761);
    // Inverted Worley supplies rounded cellular cores. The bounded Perlin
    // factor dilates and irregularizes each cell instead of adding a smooth
    // field that washes out the billows.
    const gradientFactor = Math.max(0.08, Math.min(0.96, 0.08 + billow * 0.88));
    const perlinWorley = Math.max(0, Math.min(1, (1 - cellular) + gradientFactor * cellular));
    // This threshold keeps substantial clear gaps while spreading the broad
    // core values across the useful middle and upper parts of the channel.
    const mass = Math.max(0, Math.min(1, 0.5 + (perlinWorley - 0.77) * 2.5));
    const warpFieldX = normalizedFbm3D(u, v, w, 2, seed + 811, 3);
    const warpFieldY = normalizedFbm3D(u, v, w, 3, seed + 853, 3);
    shape[index] = byte(mass);
    shape[index + 1] = byte(warpFieldX);
    shape[index + 2] = byte(warpFieldY);
    shape[index + 3] = 255;

    detail[index] = byte(normalizedWorleyFbm(u, v, w, 4, seed + 907));
    detail[index + 1] = byte(normalizedWorleyFbm(u, v, w, 8, seed + 953));
    detail[index + 2] = byte(normalizedWorleyFbm(u, v, w, 16, seed + 997));
    detail[index + 3] = 255;
  }

  return { seed, volumeResolution, weatherResolution, weather, shape, detail };
}
