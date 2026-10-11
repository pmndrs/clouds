import { describe, expect, it } from 'vitest';
import { HZD_NDF_DEFAULTS, hzdNdfKey } from '../settings';
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
  it('authored maps: image centre at the world origin, heights kept ordered', () => {
    expect(HZD_NDF_IMAGE_WGSL).toContain('/ vec2<f32>(size) + 0.5');
    expect(HZD_NDF_IMAGE_WGSL).toContain('max(b.g, min(b.r + 1.0 / 255.0, 1.0))');
  });
});
