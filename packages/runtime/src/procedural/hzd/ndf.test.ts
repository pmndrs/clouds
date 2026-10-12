import { describe, expect, it } from 'vitest';
import { defaultProceduralSettings, HZD_NDF_DEFAULTS, HZD_NDF_TILE_16KM, hzdNdfKey, packProceduralParams, PROC_PARAM_FLOATS } from '../settings';
import { HZD_NDF_GEN_WGSL, HZD_NDF_IMAGE_WGSL } from './ndf.wgsl';
import { hzdNdfImageKey, packHzdNdfGen } from './ndf';

describe('W1 weather map (NDF generator)', () => {
  it('packs the generator uniform to the NdfGen struct (7 vec4) with the recipe switch', () => {
    const g = packHzdNdfGen(HZD_NDF_DEFAULTS);
    expect(g.length).toBe(28);
    expect((HZD_NDF_GEN_WGSL.match(/: vec4<f32>,/g) ?? []).length).toBe(7);
    expect(g[20]).toBe(HZD_NDF_DEFAULTS.recipe === 'n17' ? 1 : 0);
    expect(packHzdNdfGen({ ...HZD_NDF_DEFAULTS, recipe: 'h6' })[20]).toBe(0);
    expect(packHzdNdfGen({ ...HZD_NDF_DEFAULTS, recipe: 'n17', gateLo: 0.2, gateHi: 0.1 })[23]).toBeGreaterThan(0.2);   // gate hi kept above lo
  });
  it('n17: coverage = footprint x gate; the Perlin-Worley footprint dilates (n17 recipe) instead of carving (h6)', () => {
    expect(HZD_NDF_GEN_WGSL).toContain('coverage *= smoothstep(G.n17.z, G.n17.w, ndfFbm(uv, G.n17.y, 4u, seed + 601u))');
    expect(HZD_NDF_GEN_WGSL).toContain('saturate(coverage + G.n17b.w * (w - 0.5))');
  });
  it('the recipe and its inputs re-generate the map; the images are their own key', () => {
    const a = HZD_NDF_DEFAULTS;
    for (const k of ['recipe', 'gateCells', 'gateLo', 'gateHi', 'footLo', 'footHi', 'islandGain', 'typeContrast'] as const) {
      const b = { ...a, [k]: k === 'recipe' ? (a.recipe === 'n17' ? 'h6' : 'n17') : (a[k] as number) + 0.5 };
      expect(hzdNdfKey(b)).not.toBe(hzdNdfKey(a));
    }
    expect(hzdNdfImageKey('k', { image: '', heightImage: '' })).toBe('k');
    expect(hzdNdfImageKey('k', { image: '/a.png', heightImage: '' })).not.toBe(hzdNdfImageKey('k', { image: '/b.png', heightImage: '' }));
  });
  it('F2: the bottom type varies by area and with the top type; range 0 and correlation 0 give the old constant', () => {
    const g = packHzdNdfGen(HZD_NDF_DEFAULTS);
    expect([g[10], g[11], g[15], g[18]]).toEqual([HZD_NDF_DEFAULTS.bottomType, HZD_NDF_DEFAULTS.bottomTypeRange, HZD_NDF_DEFAULTS.bottomTypeCells, HZD_NDF_DEFAULTS.bottomTypeCorrelation].map(Math.fround));
    expect(HZD_NDF_GEN_WGSL).toContain('var bottomType = G.types.z + G.foot.z * (tN - 0.5);');
    expect(HZD_NDF_GEN_WGSL).toContain('if (G.types.w != 0.0) { bottomType += G.types.w * 1.6 * ndfFbm(uv, G.heights.w, 2u, seed + 701u); }');
    for (const k of ['bottomTypeRange', 'bottomTypeCells', 'bottomTypeCorrelation'] as const) {
      expect(hzdNdfKey({ ...HZD_NDF_DEFAULTS, [k]: HZD_NDF_DEFAULTS[k] + 0.5 })).not.toBe(hzdNdfKey(HZD_NDF_DEFAULTS));
    }
  });
  it('F2: the 32 km tile at 1024^2 keeps the 16 km texel and feature sizes; HZD_NDF_TILE_16KM restores the old tile', () => {
    const n = HZD_NDF_DEFAULTS, o = { ...n, ...HZD_NDF_TILE_16KM };
    expect([n.tileMeters, n.resolution]).toEqual([32000, 1024]);
    expect(n.tileMeters / n.resolution).toBe(o.tileMeters / o.resolution);
    for (const k of ['coverageCells', 'islandCells', 'typeCells', 'worleyCells', 'gateCells', 'bottomTypeCells', 'heightCells'] as const) expect(n[k] / n.tileMeters).toBe(o[k] / o.tileMeters);
    expect(packHzdNdfGen(o)[3]).toBe(3);   // H1-W1's fixed height cells
  });
  it('authored maps: image centre at the world origin, heights kept ordered', () => {
    expect(HZD_NDF_IMAGE_WGSL).toContain('/ vec2<f32>(size) + 0.5');
    expect(HZD_NDF_IMAGE_WGSL).toContain('max(b.g, min(b.r + 1.0 / 255.0, 1.0))');
  });
});

describe('W1 map-advection policy', () => {
  const speeds = (m: 'drift' | 'static' | 'rigid' | 'shape' | 'detail') => {
    const s = defaultProceduralSettings('hzd');
    Object.assign(s.hzd, { ndfMotion: m, ndfDrift: 0.5, shapeSpeed: 1, detailSpeed: 0.8, upwardBias: 0.1 });
    const out = new Float32Array(PROC_PARAM_FLOATS);
    packProceduralParams(s, out);
    return [out[140], out[141], out[142], out[139]].map(v => +v.toFixed(3));   // map, shape, detail, upward bias
  };
  it('packs map / shape / detail speeds per policy (anchored noises take the map speed)', () => {
    expect(speeds('drift')).toEqual([0.5, 1, 0.8, 0.1]);
    expect(speeds('static')).toEqual([0, 1, 0.8, 0.1]);
    expect(speeds('rigid')).toEqual([0.5, 0.5, 0.5, 0]);
    expect(speeds('shape')).toEqual([0.5, 0.5, 0.8, 0.1]);
    expect(speeds('detail')).toEqual([0.5, 1, 0.5, 0.1]);
  });
});
