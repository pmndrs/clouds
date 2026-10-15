import { describe, expect, it } from 'vitest';
import { dab, falloff, fromNdfLayers, gradient, MapFields, mapNoise, mapToWorld, strokePoints, toNdfFields, toPngPixels, worldToMap, writeImage, type Brush } from './fields';

const brush = (o: Partial<Brush> = {}): Brush => ({ op: 'paint', radius: 4, hardness: 0, strength: 1, noiseCells: 4, noiseSeed: 1, ...o });

describe('weather-map painter fields', () => {
  it('falls off from 1 at the centre to 0 at the radius', () => {
    expect(falloff(0, 0)).toBe(1);
    expect(falloff(1, 0)).toBe(0);
    expect(falloff(0.5, 0)).toBeCloseTo(0.5);
    expect(falloff(0.5, 0.6)).toBe(1);
  });

  it('paints toward the target and wraps across the map edge', () => {
    const f = new MapFields(16);
    dab(f, brush(), 0.5, 8.5, ['coverage'], { coverage: 1 });
    expect(f.at('coverage', 0, 8)).toBeCloseTo(1);
    expect(f.at('coverage', 15, 8)).toBeGreaterThan(0.5);   // the dab crosses the left edge onto the right
    expect(f.at('coverage', 8, 8)).toBe(0);
    expect(f.at('topType', 0, 8)).toBe(1);                  // other channels untouched
  });

  it('raises, lowers, restores and smooths within 0..1', () => {
    const f = new MapFields(16, { coverage: 0.5 });
    const base = f.clone();
    for (let i = 0; i < 50; i++) dab(f, brush({ op: 'raise' }), 8, 8, ['coverage'], {});
    expect(f.at('coverage', 7, 7)).toBe(1);
    dab(f, brush({ op: 'restore' }), 7.5, 7.5, ['coverage'], {}, { base });
    expect(f.at('coverage', 7, 7)).toBeCloseTo(0.5);
    const g = new MapFields(16);
    g.data.coverage[8 * 16 + 8] = 1;
    dab(g, brush({ op: 'smooth', radius: 6 }), 8.5, 8.5, ['coverage'], {});
    expect(g.at('coverage', 8, 8)).toBeLessThan(1);
    expect(g.at('coverage', 9, 8)).toBeGreaterThan(0);
  });

  it('smudges values along the stroke', () => {
    const f = new MapFields(32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) f.data.coverage[y * 32 + x] = 1;
    dab(f, brush({ op: 'smudge', radius: 6 }), 16, 16, ['coverage'], {}, { dx: 3, dy: 0 });
    expect(f.at('coverage', 17, 16)).toBeGreaterThan(0.5);   // the left half pushed right
  });

  it('spaces stroke dabs evenly across calls', () => {
    const a = strokePoints([0, 0], [10, 0], 4, 0);
    expect(a.points.map(p => p[0])).toEqual([4, 8]);
    const b = strokePoints([10, 0], [20, 0], 4, a.carry);
    expect(b.points.map(p => p[0])).toEqual([12, 16, 20]);
  });

  it('runs a gradient from the start to the end point', () => {
    const f = new MapFields(16);
    gradient(f, f.clone(), [0, 8], [16, 8], ['coverage'], { coverage: 1 }, 1);
    expect(f.at('coverage', 0, 3)).toBeGreaterThan(0.95);
    expect(f.at('coverage', 15, 3)).toBeLessThan(0.05);
  });

  it('keeps the noise periodic across the map', () => {
    expect(mapNoise(0, 0.3, 4, 2)).toBeCloseTo(mapNoise(1, 0.3, 4, 2), 6);
  });

  it('rolls the map so its centre is the NDF texel at the world origin, and back', () => {
    const n = 8, f = new MapFields(n, { topType: 0.5 });
    f.data.coverage[4 * n + 4] = 1;          // the map centre's pixel (world 0..1 texel)
    const nd = toNdfFields(f);
    expect(nd.coverage[0]).toBe(255);
    expect(nd.topType[0]).toBe(128);
    const l0 = new Uint8Array(n * n * 4), l1 = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) { l0[i * 4] = nd.coverage[i]; l0[i * 4 + 1] = nd.topType[i]; l1[i * 4] = nd.minHeight[i]; l1[i * 4 + 1] = nd.maxHeight[i]; }
    const g = fromNdfLayers(n, l0, l1);
    expect(g.at('coverage', 4, 4)).toBe(1);
    expect(g.at('coverage', 0, 0)).toBe(0);
    // World: the centre pixel spans 0..tile/n east and south of the origin.
    expect(mapToWorld(4, 4, n, 800)).toEqual([0, 0]);
    expect(worldToMap(0, 0, n, 800)).toEqual([4, 4]);
  });

  it('keeps the top above the base in the outputs', () => {
    const f = new MapFields(4, { minHeight: 0.6, maxHeight: 0.2 });
    expect(toNdfFields(f).maxHeight[0]).toBe(154);
    expect(toPngPixels(f).height[1]).toBe(154);
  });

  it('reads an image into channels (same size: exact)', () => {
    const n = 4, px = new Uint8ClampedArray(n * n * 4);
    for (let i = 0; i < n * n; i++) { px[i * 4] = i * 10; px[i * 4 + 1] = 200; px[i * 4 + 2] = 7; px[i * 4 + 3] = 255; }
    const f = new MapFields(n);
    writeImage(f, px, n, n, ['coverage', 'topType', null]);
    expect(f.at('coverage', 3, 2)).toBeCloseTo(110 / 255);
    expect(f.at('topType', 1, 1)).toBeCloseTo(200 / 255);
    expect(f.at('bottomType', 1, 1)).toBe(0);
    const back = toPngPixels(f).main;
    expect(back[(2 * n + 3) * 4]).toBe(110);
  });

  it('STORM1: the storm channel paints, rolls into the NDF, and goes to the height PNG\'s B and back', () => {
    const n = 16, f = new MapFields(n);
    dab(f, brush({ radius: 3 }), 8.5, 8.5, ['storm'], { storm: 1 });
    expect(f.at('storm', 8, 8)).toBeCloseTo(1);
    expect(f.at('coverage', 8, 8)).toBe(0);                 // other channels untouched
    const nf = toNdfFields(f);
    expect(nf.storm[0]).toBe(255);                          // the map centre is the NDF texel at the world origin
    const png = toPngPixels(f).height;
    expect(png[(8 * n + 8) * 4 + 2]).toBe(255);
    const back = new MapFields(n);
    writeImage(back, png, n, n, ['minHeight', 'maxHeight', 'storm']);
    expect(back.at('storm', 8, 8)).toBeCloseTo(1);
    expect(back.at('storm', 1, 1)).toBe(0);
    // layer 1's B is the storm channel in the NDF layout
    const l0 = new Uint8Array(n * n * 4), l1 = new Uint8Array(n * n * 4);
    l1[(0 * n + 0) * 4 + 2] = 200;
    expect(fromNdfLayers(n, l0, l1).at('storm', 8, 8)).toBeCloseTo(200 / 255);
  });
});
