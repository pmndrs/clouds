import { describe, expect, it } from 'vitest';
import {
  createMorphologyNoise,
  createNoiseMipChain,
  periodicGradientNoise2D,
  periodicGradientNoise3D,
} from './morphology-noise';

function stats(data: Uint8Array, channel: number): { min: number; max: number; mean: number } {
  let min = 255;
  let max = 0;
  let sum = 0;
  for (let index = channel; index < data.length; index += 4) {
    const value = data[index];
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }
  return { min, max, mean: sum / (data.length / 4) };
}

describe('procedural morphology noise', () => {
  it('is deterministic, seed-sensitive, and packs RGBA in X-fastest order', () => {
    const options = { seed: 17, volumeResolution: 16 as const, weatherResolution: 32 as const };
    const first = createMorphologyNoise(options);
    const repeat = createMorphologyNoise(options);
    const changed = createMorphologyNoise({ ...options, seed: 18 });
    expect(first.seed).toBe(17);
    expect(first.shape).toEqual(repeat.shape);
    expect(first.weather).toEqual(repeat.weather);
    expect(first.detail).toEqual(repeat.detail);
    expect(first.shape).not.toEqual(changed.shape);
    expect(first.weather).not.toEqual(changed.weather);
    expect(first.detail).not.toEqual(changed.detail);
    expect(first.weather).toHaveLength(32 * 32 * 4);
    expect(first.shape).toHaveLength(16 ** 3 * 4);
    expect(first.detail).toHaveLength(16 ** 3 * 4);
    expect(first.weather[3]).toBe(255);
    expect(first.shape[3]).toBe(255);
    expect(first.detail[3]).toBe(255);
    // Adjacent X samples occupy adjacent RGBA texels.
    expect(first.shape.slice(0, 4)).not.toEqual(first.shape.slice(4, 8));
  });

  it('joins smoothly across periodic boundaries in 2D and 3D', () => {
    const epsilon = 1e-4;
    const noise2d = (x: number) => periodicGradientNoise2D(x, 0.371, 8, 42);
    const noise3d = (x: number) => periodicGradientNoise3D(x, 0.371, 0.619, 8, 42);
    expect(noise2d(0)).toBeCloseTo(noise2d(1), 12);
    expect(noise3d(0)).toBeCloseTo(noise3d(1), 12);
    expect(Math.abs(noise2d(epsilon) - noise2d(1 - epsilon))).toBeLessThan(0.003);
    expect(Math.abs(noise3d(epsilon) - noise3d(1 - epsilon))).toBeLessThan(0.003);
    // The first derivative also joins: slopes just inside either side agree.
    const slope2dLeft = (noise2d(epsilon) - noise2d(0)) / epsilon;
    const slope2dRight = (noise2d(1) - noise2d(1 - epsilon)) / epsilon;
    expect(Math.abs(slope2dLeft - slope2dRight)).toBeLessThan(0.02);
  });

  it('keeps weather, billowy mass, warps, and detail channels varied and finite', () => {
    const fields = createMorphologyNoise({ seed: 17, volumeResolution: 16, weatherResolution: 32 });
    for (const field of [fields.weather, fields.shape, fields.detail]) {
      expect(field.every(value => Number.isFinite(value) && value >= 0 && value <= 255)).toBe(true);
      expect(stats(field, 3)).toEqual({ min: 255, max: 255, mean: 255 });
      for (let channel = 0; channel < 3; channel++) {
        const { min, max } = stats(field, channel);
        expect(max - min).toBeGreaterThan(30);
      }
    }
    const mass = stats(fields.shape, 0);
    expect(mass.mean).toBeGreaterThan(70);
    expect(mass.mean).toBeLessThan(190);
  });

  it('rejects unsupported resolutions and non-integer seeds before allocation', () => {
    expect(() => createMorphologyNoise({ seed: 1.5 })).toThrow(/seed/i);
    expect(() => createMorphologyNoise({ seed: Number.POSITIVE_INFINITY })).toThrow(/seed/i);
    expect(() => createMorphologyNoise({ seed: 0x80000000 })).toThrow(/32-bit/i);
    expect(() => createMorphologyNoise({ volumeResolution: 48 as 16 })).toThrow(/volumeResolution/i);
    expect(() => createMorphologyNoise({ weatherResolution: 96 as 32 })).toThrow(/weatherResolution/i);
  });

  it('preserves constant RGBA values through every 2D and 3D mip level', () => {
    for (const dimension of [2, 3] as const) {
      const resolution = 8;
      const depth = dimension === 2 ? 1 : resolution;
      const constant = new Uint8Array(resolution * resolution * depth * 4);
      for (let i = 0; i < constant.length; i += 4) {
        constant[i] = 37;
        constant[i + 1] = 96;
        constant[i + 2] = 181;
        constant[i + 3] = 255;
      }
      const chain = createNoiseMipChain(constant, resolution, dimension);
      expect(chain.map(level => [level.width, level.height, level.depth])).toEqual(
        dimension === 2
          ? [[8, 8, 1], [4, 4, 1], [2, 2, 1], [1, 1, 1]]
          : [[8, 8, 8], [4, 4, 4], [2, 2, 2], [1, 1, 1]],
      );
      expect(chain.every(level => Array.from(level.data).every((value, index) => value === [37, 96, 181, 255][index % 4]))).toBe(true);
    }
  });

  it('box-filters lower mips while keeping the final RGBA mean close to the input', () => {
    for (const dimension of [2, 3] as const) {
      const resolution = 8;
      const depth = dimension === 2 ? 1 : resolution;
      const data = new Uint8Array(resolution * resolution * depth * 4);
      for (let i = 0; i < data.length; i++) data[i] = (i * 37 + Math.floor(i / 4) * 11) % 256;
      const inputMeans = [0, 1, 2, 3].map(channel => stats(data, channel).mean);
      const chain = createNoiseMipChain(data, resolution, dimension);
      expect(chain[0].data).toEqual(data);
      const last = chain.at(-1)!;
      const outputMeans = [0, 1, 2, 3].map(channel => stats(last.data, channel).mean);
      for (let channel = 0; channel < 4; channel++) {
        expect(Math.abs(outputMeans[channel] - inputMeans[channel])).toBeLessThanOrEqual(2);
      }
    }
  });

  it('rejects invalid mip dimensions, resolutions, and RGBA payload lengths', () => {
    expect(() => createNoiseMipChain(new Uint8Array(4), 3, 2)).toThrow(/power of two/i);
    expect(() => createNoiseMipChain(new Uint8Array(4), 0, 2)).toThrow(/power of two/i);
    expect(() => createNoiseMipChain(new Uint8Array(15), 2, 2)).toThrow(/RGBA payload/i);
    expect(() => createNoiseMipChain(new Uint8Array(4), 2, 3)).toThrow(/RGBA payload/i);
  });
});
