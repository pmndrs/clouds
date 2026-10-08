/**
 * Experimental, CPU-side weather field used by the coverage viewer.
 *
 * The coverage value is a source mask, rather than a claim about the fraction
 * of sky occupied by clouds. This is a compact weather field, not a physical
 * weather simulation.
 */

export const WEATHER_COORDINATE_LIMIT_METRES = 1_000_000;
export const WEATHER_MIN_SCALE_METRES = 64;
export const WEATHER_MAX_SCALE_METRES = 100_000;

const DEFAULT_SCALE_METRES = 1_800;
const DEFAULT_SEED = 0;

export interface WeatherSourceOptions {
  seed?: number;
  scaleMetres?: number;
}

export interface WeatherSampleOptions {
  coverage: number;
  density: number;
}

export interface WeatherSample {
  /** The spatial source mask after applying the requested coverage. */
  coverage: number;
  /**
   * A non-negative potential-density coefficient. Consumers combine it with
   * coverage (for example, `coverage * density`) when producing cloud density.
   */
  density: number;
  baseMetres: number;
  topMetres: number;
  /** Stable continuous morphology parameter in the inclusive range 0..1. */
  type: number;
}

export interface WeatherSource {
  sample(
    xMetres: number,
    zMetres: number,
    options: WeatherSampleOptions,
  ): WeatherSample;
}

function assertFiniteNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function assertOptionsRecord(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/** A stable integer mixer; bitwise operations deliberately work on signed XZ cells. */
function hashCell(x: number, z: number, seed: number, salt: number): number {
  let value = Math.imul(x | 0, 0x45d9f3b);
  value = Math.imul(value ^ Math.imul(z | 0, 0x119de1f3), 0x45d9f3b);
  value = Math.imul(value ^ Math.imul(seed | 0, 0x27d4eb2d), 0x165667b1);
  value = Math.imul(value ^ Math.imul(salt, 0x9e3779b9), 0x85ebca6b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function fade(value: number): number {
  // Quintic interpolation keeps the first derivative continuous at cell edges.
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function valueNoise(
  xMetres: number,
  zMetres: number,
  cellMetres: number,
  seed: number,
  salt: number,
): number {
  const x = xMetres / cellMetres;
  const z = zMetres / cellMetres;
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const tz = fade(z - z0);

  const n00 = hashCell(x0, z0, seed, salt);
  const n10 = hashCell(x0 + 1, z0, seed, salt);
  const n01 = hashCell(x0, z0 + 1, seed, salt);
  const n11 = hashCell(x0 + 1, z0 + 1, seed, salt);
  const nx0 = n00 + (n10 - n00) * tx;
  const nx1 = n01 + (n11 - n01) * tx;
  return nx0 + (nx1 - nx0) * tz;
}

function regionalNoise(
  xMetres: number,
  zMetres: number,
  scaleMetres: number,
  seed: number,
  salt: number,
): number {
  // The three bands make broad contours with enough local structure to avoid
  // a grid of independent full-cell decisions.
  return clamp01(
    0.57 * valueNoise(xMetres, zMetres, scaleMetres, seed, salt) +
      0.28 * valueNoise(xMetres, zMetres, scaleMetres * 0.43, seed, salt + 1) +
      0.15 * valueNoise(xMetres, zMetres, scaleMetres * 0.13, seed, salt + 2),
  );
}

function validateSourceOptions(options: WeatherSourceOptions): { seed: number; scaleMetres: number } {
  assertOptionsRecord(options, 'options');
  const seedValue = options.seed === undefined ? DEFAULT_SEED : options.seed;
  const scaleValue = options.scaleMetres === undefined ? DEFAULT_SCALE_METRES : options.scaleMetres;
  assertFiniteNumber(seedValue, 'options.seed');
  assertFiniteNumber(scaleValue, 'options.scaleMetres');
  if (!Number.isInteger(seedValue)) {
    throw new RangeError('options.seed must be an integer');
  }
  if (seedValue < -0x8000_0000 || seedValue > 0x7fff_ffff) {
    throw new RangeError('options.seed must be within the signed 32-bit range');
  }
  if (
    scaleValue < WEATHER_MIN_SCALE_METRES ||
    scaleValue > WEATHER_MAX_SCALE_METRES
  ) {
    throw new RangeError(
      `options.scaleMetres must be between ${WEATHER_MIN_SCALE_METRES} and ${WEATHER_MAX_SCALE_METRES}`,
    );
  }
  return { seed: Math.trunc(seedValue), scaleMetres: scaleValue };
}

function validateSampleArguments(
  xMetres: number,
  zMetres: number,
  options: WeatherSampleOptions,
): void {
  assertFiniteNumber(xMetres, 'xMetres');
  assertFiniteNumber(zMetres, 'zMetres');
  if (
    Math.abs(xMetres) > WEATHER_COORDINATE_LIMIT_METRES ||
    Math.abs(zMetres) > WEATHER_COORDINATE_LIMIT_METRES
  ) {
    throw new RangeError(
      `xMetres and zMetres must be within +/-${WEATHER_COORDINATE_LIMIT_METRES} metres`,
    );
  }
  assertOptionsRecord(options, 'sample options');
  assertFiniteNumber(options.coverage, 'sample options.coverage');
  assertFiniteNumber(options.density, 'sample options.density');
  if (options.coverage < 0 || options.coverage > 1) {
    throw new RangeError('sample options.coverage must be between 0 and 1');
  }
  if (options.density < 0) {
    throw new RangeError('sample options.density must be non-negative');
  }
}

/**
 * Create a deterministic, camera-independent weather field in global XZ.
 *
 * Coordinates are intentionally bounded to a practical regional range. This
 * implementation does not promise infinite or planet-scale continuity; the
 * bound also keeps integer hash cells away from accidental coordinate aliases.
 */
export function createWeatherSource(options: WeatherSourceOptions = {}): WeatherSource {
  const { seed, scaleMetres } = validateSourceOptions(options);

  return {
    sample(xMetres: number, zMetres: number, sampleOptions: WeatherSampleOptions): WeatherSample {
      validateSampleArguments(xMetres, zMetres, sampleOptions);

      const sourceMask = regionalNoise(xMetres, zMetres, scaleMetres, seed, 11);
      const requestedCoverage = sampleOptions.coverage;
      // The explicit endpoint branches make the control exact. Between them,
      // lowering the threshold exposes coherent regional contours monotonically.
      // Sweeping the threshold beyond the source-mask range keeps the mapping
      // continuous as the control approaches either exact endpoint.
      const coverage = smoothstep((sourceMask - 1 + requestedCoverage * 1.18) / 0.18);

      // Shape bands have separate salts and never depend on coverage or density.
      const baseNoise = regionalNoise(xMetres, zMetres, scaleMetres * 1.7, seed, 101);
      const thicknessNoise = regionalNoise(xMetres, zMetres, scaleMetres * 1.15, seed, 131);
      const baseMetres = 800 + baseNoise * 1_000;
      const topMetres = baseMetres + 600 + thicknessNoise * 1_000;
      const type = regionalNoise(xMetres, zMetres, scaleMetres * 2.4, seed, 151);

      // Density is a separate potential-density field. It does not suppress
      // coverage or alter the geometric shape returned above.
      const densityNoise = regionalNoise(xMetres, zMetres, scaleMetres * 0.8, seed, 181);
      const density = sampleOptions.density * (0.72 + densityNoise * 0.28);
      return { coverage, density, baseMetres, topMetres, type };
    },
  };
}
