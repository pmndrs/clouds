import { describe, expect, it } from 'vitest';
import { cloudDensityCpu, sampleModelingCpu, sampleTrilinear, valueRemap, volumeUvw, type DensityInputs, type DensityNoise, type DensityVolume } from './density';

const inputs = (over: Partial<DensityInputs> = {}): DensityInputs => ({ wind: [0, 0, 0], mipDistanceScale: 0, baseMip: 0, hfDetails: false, ...over });

// 2x2x2 NVDF, 8 m voxels, min corner at the origin. Texture dims (x, row, slice) = world (x, z, y).
function volume(texels: [number, number, number][]): DensityVolume {
  const nvdf = new Uint8Array(8 * 4);
  texels.forEach((t, i) => nvdf.set([t[0], t[1], t[2], 0], i * 4));
  return { dims: [2, 2, 2], voxelSize: 8, nvdf, minCorner: [0, 0, 0] };
}
const uniformVolume = (r: number, g: number, b: number) => volume(Array(8).fill([r, g, b]));
const uniformNoise = (r: number, g: number, b: number, a: number): DensityNoise => {
  const data = new Uint8Array(2 * 2 * 2 * 4);
  for (let i = 0; i < 8; i++) data.set([r, g, b, a], i * 4);
  return { size: 2, data, noiseScale: 0.01 };
};

describe('trilinear sampling', () => {
  it('clamps at the edge and interpolates between texel centres', () => {
    const data = new Uint8Array([0, 0, 0, 0, 255, 0, 0, 0]); // 2x1x1, R = 0 | 255
    expect(sampleTrilinear(data, [2, 1, 1], [0.0, 0.5, 0.5], false)[0]).toBeCloseTo(0, 12);
    expect(sampleTrilinear(data, [2, 1, 1], [0.5, 0.5, 0.5], false)[0]).toBeCloseTo(0.5, 12);
    expect(sampleTrilinear(data, [2, 1, 1], [0.75, 0.5, 0.5], false)[0]).toBeCloseTo(1, 12);
    expect(sampleTrilinear(data, [2, 1, 1], [1.0, 0.5, 0.5], false)[0]).toBeCloseTo(1, 12);
  });
  it('wraps when repeating', () => {
    const data = new Uint8Array([0, 0, 0, 0, 255, 0, 0, 0]);
    expect(sampleTrilinear(data, [2, 1, 1], [0.0, 0.5, 0.5], true)[0]).toBeCloseTo(0.5, 12);
    expect(sampleTrilinear(data, [2, 1, 1], [1.0, 0.5, 0.5], true)[0]).toBeCloseTo(0.5, 12);
  });
});

describe('world to texture axes', () => {
  it('maps world (x, y-up, z) to texture (x, z, y)', () => {
    const v = uniformVolume(0, 0, 0);
    expect(volumeUvw(v, [4, 12, 8])).toEqual([4 / 16, 8 / 16, 12 / 16]);
  });
  it('samples the texel whose slice index follows world height', () => {
    // Texel (x=0, row=0, slice=1) is index 4: world (0..8, y 8..16, z 0..8).
    const t: [number, number, number][] = Array(8).fill([0, 0, 0]);
    t[4] = [255, 0, 0];
    const v = volume(t);
    expect(sampleModelingCpu(v, [4, 12, 4])[0]).toBeCloseTo(1, 12); // centre of that texel
    expect(sampleModelingCpu(v, [4, 4, 4])[0]).toBeCloseTo(0, 12);
    expect(sampleModelingCpu(v, [4, 12, 12])[0]).toBeCloseTo(0, 12);
  });
  it('is zero outside the box', () => {
    expect(sampleModelingCpu(uniformVolume(255, 255, 255), [-0.1, 8, 8])).toEqual([0, 0, 0]);
    expect(sampleModelingCpu(uniformVolume(255, 255, 255), [8, 16.1, 8])).toEqual([0, 0, 0]);
  });
});

describe('cloudDensityCpu', () => {
  it('returns 0 where the profile is 0', () => {
    expect(cloudDensityCpu(uniformVolume(0, 255, 255), uniformNoise(128, 128, 128, 128), [8, 8, 8], 500, inputs())).toEqual([0, 0]);
  });
  it('returns 0 outside the volume', () => {
    expect(cloudDensityCpu(uniformVolume(255, 0, 255), uniformNoise(0, 0, 0, 0), [100, 8, 8], 500, inputs())).toEqual([0, 0]);
  });
  it('matches a hand-computed wispy value (far, no HF)', () => {
    // profile 1, type 0 (wispy), scale 1, noise r = 51/255 = 0.2, g = 0.2.
    // wispy = 0.2; erosion = (1 - 0.2) / (1 - 0.2) = 1; scale = 1; pow(1, ..) = 1; fade at 500 m = 1.
    const r = cloudDensityCpu(uniformVolume(255, 0, 255), uniformNoise(51, 51, 0, 0), [8, 8, 8], 500, inputs());
    expect(r[0]).toBeCloseTo(1, 12);
    expect(r[1]).toBeCloseTo(1, 12);
  });
  it('matches a hand-computed partial value', () => {
    // profile 0.5 (127.5 is unrepresentable; use 255 and 0 mix via 8-bit: 128/255), scale 0.5^(1/4) -> use 255*0.5 -> approximate in-test.
    const profile = 128 / 255, scale = 192 / 255, noise = 64 / 255;
    const eroded = (profile - noise) / (1 - noise);
    const ps = Math.pow(scale, 4);
    const expected = Math.pow(eroded * ps, 0.3 + 0.3 * ps);
    const r = cloudDensityCpu(uniformVolume(128, 0, 192), uniformNoise(64, 64, 0, 0), [8, 8, 8], 500, inputs());
    expect(r[0]).toBeCloseTo(expected, 12);
    expect(r[1]).toBeCloseTo(profile * scale, 12);
  });
  it('applies the near-camera fade', () => {
    const args = [uniformVolume(255, 0, 255), uniformNoise(51, 51, 0, 0), [8, 8, 8] as const] as const;
    const near = cloudDensityCpu(...args, 10, inputs())[0];
    const mid = cloudDensityCpu(...args, 65, inputs())[0];
    expect(near).toBeCloseTo(0.25, 12);
    expect(mid).toBeCloseTo(valueRemap(65, 10, 120, 0.25, 1), 12);
  });
  it('hfDetails path at rayDistance 0 uses the folded noise', () => {
    // type 0, profile 128/255, scale 1; noise g = 191/255 (wispy = lerp(r, g, profile) with profile 128/255 and r = 0). blender = 0.9 at d <= 50, hhf = 1 - |..|^4.
    const g = 191 / 255;
    const fold = Math.abs(Math.abs(g * 2 - 1) * 2 - 1);
    const hhf = Math.min(1, Math.max(0, 1 - Math.pow(fold, 4)));
    const wispy = g * (128 / 255);
    const composite = hhf + 0.9 * (wispy - hhf); 
    const profile = 128 / 255;
    const eroded = Math.min(1, Math.max(0, (profile - composite) / (1 - composite)));
    const r = cloudDensityCpu(uniformVolume(128, 0, 255), uniformNoise(0, 191, 0, 0), [8, 8, 8], 0, inputs({ hfDetails: true }));
    // d = eroded * 1; pow(d, lerp(0.3, 0.6, 1)=0.6); at distance 0 the HF stage applies pow(., 0.5) * 0.666; fade 0.25.
    expect(r[0]).toBeCloseTo(Math.pow(Math.pow(eroded, 0.6), 0.5) * 0.666 * 0.25, 12);
  });
  it('rejects mip > 0 (reference is mip 0 only)', () => {
    expect(() => cloudDensityCpu(uniformVolume(255, 0, 255), uniformNoise(0, 0, 0, 0), [8, 8, 8], 100, inputs({ mipDistanceScale: 0.1 }))).toThrow();
  });
  it('wind shifts the noise lookup', () => {
    // Noise g varies along x only: texel0 g=0, texel1 g=255 (size 2); profile 1 so wispy = g. noiseScale 0.01 -> p.x=50 -> u=0.5.
    const data = new Uint8Array(2 * 2 * 2 * 4);
    for (let i = 0; i < 8; i++) if (i % 2 === 1) data[i * 4 + 1] = 255;
    const noise: DensityNoise = { size: 2, data, noiseScale: 0.01 };
    const vol: DensityVolume = { dims: [8, 8, 8], voxelSize: 8, nvdf: new Uint8Array(8 * 8 * 8 * 4).map((_, i) => (i % 4 === 0 ? 128 : i % 4 === 2 ? 255 : 0)), minCorner: [0, 0, 0] };
    const a = cloudDensityCpu(vol, noise, [50, 32, 32], 500, inputs())[0];
    const b = cloudDensityCpu(vol, noise, [50, 32, 32], 500, inputs({ wind: [-25, 0, 0] }))[0];
    expect(a).not.toBeCloseTo(b, 3);
  });
});
