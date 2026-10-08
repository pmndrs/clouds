import { describe, expect, it } from 'vitest';
import {
  WEATHER_COORDINATE_LIMIT_METRES,
  createWeatherSource,
} from './weather';

const options = { coverage: 0.58, density: 1.2 };

describe('experimental weather source', () => {
  it('is deterministic and camera-independent for a seed', () => {
    const first = createWeatherSource({ seed: 17, scaleMetres: 1_700 });
    const second = createWeatherSource({ seed: 17, scaleMetres: 1_700 });
    expect(first.sample(12_345.25, -9_876.5, options)).toEqual(
      second.sample(12_345.25, -9_876.5, options),
    );
    expect(first.sample(-12_345.25, 9_876.5, options)).toEqual(
      first.sample(-12_345.25, 9_876.5, options),
    );
  });

  it('changes the field for a different seed', () => {
    const first = createWeatherSource({ seed: 17 });
    const second = createWeatherSource({ seed: 18 });
    expect(first.sample(4_321, -7_654, options)).not.toEqual(
      second.sample(4_321, -7_654, options),
    );
  });

  it('stays coherent for nearby points and varies across remote points', () => {
    const source = createWeatherSource({ seed: 23, scaleMetres: 1_200 });
    const nearby = source.sample(8_000, -2_000, options);
    const oneMetreAway = source.sample(8_001, -1_999, options);
    const remote = source.sample(100_000, 100_000, options);
    expect(Math.abs(nearby.coverage - oneMetreAway.coverage)).toBeLessThan(0.08);
    expect(Math.abs(nearby.baseMetres - oneMetreAway.baseMetres)).toBeLessThan(10);
    expect(
      Math.abs(nearby.coverage - remote.coverage) +
        Math.abs(nearby.baseMetres - remote.baseMetres) +
        Math.abs(nearby.type - remote.type),
    ).toBeGreaterThan(0.01);
  });

  it('has exact clear and full coverage endpoints', () => {
    const source = createWeatherSource({ seed: 31 });
    expect(source.sample(10, 20, { coverage: 0, density: 1 }).coverage).toBe(0);
    expect(source.sample(10, 20, { coverage: 1, density: 1 }).coverage).toBe(1);
  });

  it('is monotonic in coverage at every sampled point', () => {
    const source = createWeatherSource({ seed: 41 });
    for (const [x, z] of [
      [-1_200, 800],
      [0, 0],
      [9_999, -4_444],
      [300_000, -200_000],
    ] as const) {
      const low = source.sample(x, z, { coverage: 0.2, density: 1 });
      const high = source.sample(x, z, { coverage: 0.8, density: 1 });
      expect(high.coverage).toBeGreaterThanOrEqual(low.coverage);
    }
  });

  it('keeps shape and coverage independent from the density multiplier', () => {
    const source = createWeatherSource({ seed: 53 });
    const sparse = source.sample(5_000, 7_000, { coverage: 0.63, density: 0.25 });
    const dense = source.sample(5_000, 7_000, { coverage: 0.63, density: 2 });
    expect(dense.coverage).toBe(sparse.coverage);
    expect(dense.baseMetres).toBe(sparse.baseMetres);
    expect(dense.topMetres).toBe(sparse.topMetres);
    expect(dense.type).toBe(sparse.type);
    expect(dense.density).toBeGreaterThan(sparse.density);
    expect(source.sample(0, 0, { coverage: 0.63, density: 0 }).density).toBe(0);
  });

  it('keeps heights in the planned finite envelope', () => {
    const source = createWeatherSource({ seed: 67 });
    for (const point of [
      [-WEATHER_COORDINATE_LIMIT_METRES, -WEATHER_COORDINATE_LIMIT_METRES],
      [0, 0],
      [WEATHER_COORDINATE_LIMIT_METRES, WEATHER_COORDINATE_LIMIT_METRES],
    ] as const) {
      const sample = source.sample(point[0], point[1], options);
      expect(sample.baseMetres).toBeGreaterThanOrEqual(700);
      expect(sample.topMetres).toBeLessThanOrEqual(3_500);
      expect(sample.topMetres).toBeGreaterThan(sample.baseMetres);
      expect(sample.type).toBeGreaterThanOrEqual(0);
      expect(sample.type).toBeLessThanOrEqual(1);
    }
  });

  it('rejects malformed options and unsupported coordinates', () => {
    expect(() => createWeatherSource({ seed: Number.NaN })).toThrow();
    expect(() => createWeatherSource({ seed: 1.5 })).toThrow();
    expect(() => createWeatherSource({ seed: -0x8000_0001 })).toThrow();
    expect(() => createWeatherSource({ scaleMetres: 0 })).toThrow();
    expect(() => createWeatherSource({ scaleMetres: Number.POSITIVE_INFINITY })).toThrow();

    const source = createWeatherSource();
    expect(() => source.sample(Number.NaN, 0, options)).toThrow();
    expect(() => source.sample(0, WEATHER_COORDINATE_LIMIT_METRES + 1, options)).toThrow();
    expect(() => source.sample(0, 0, { coverage: -0.01, density: 1 })).toThrow();
    expect(() => source.sample(0, 0, { coverage: 0.5, density: -1 })).toThrow();
    expect(() => source.sample(0, 0, { coverage: 0.5, density: Number.NaN })).toThrow();
  });

  it('stays continuous across signed noise-cell boundaries', () => {
    const source = createWeatherSource({ seed: -0x8000_0000, scaleMetres: 1_200 });
    const left = source.sample(-1_200 - 0.001, 0, { coverage: 0.57, density: 1 });
    const right = source.sample(-1_200 + 0.001, 0, { coverage: 0.57, density: 1 });
    expect(Math.abs(left.coverage - right.coverage)).toBeLessThan(0.001);
    expect(Math.abs(left.baseMetres - right.baseMetres)).toBeLessThan(0.1);
    expect(Math.abs(left.topMetres - right.topMetres)).toBeLessThan(0.1);
  });
});
