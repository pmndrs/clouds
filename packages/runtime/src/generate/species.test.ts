import { describe, expect, it } from 'vitest';
import { BILLOW_WGSL, WEATHER_WGSL } from './shaders';
import { CLOUD_PRESETS } from './presets';
import { altoFractions } from './volume-generator';

// P9-C: the species profile table lives in WGSL (shared by the generator and the sky layer); these read it back and check the
// relations the species depend on, so a retune cannot silently swap two species.
const numbers = (src: string) => src.split(',').map(s => Number(s.trim()));
function speciesRows() {
  const rows: Record<string, { depth: number; topExp: number; baseOff: number; bottom: number; billowAmp: number; billowCell: number; flip: number; scale: number }> = {};
  for (const m of BILLOW_WGSL.matchAll(/const SP_(\w+) = SpeciesRow\(([^)]*)\)/g)) {
    const [depth, topExp, baseOff, bottom, billowAmp, billowCell, flip, scale] = numbers(m[2]);
    rows[m[1].toLowerCase()] = { depth, topExp, baseOff, bottom, billowAmp, billowCell, flip, scale };
  }
  return rows;
}
function horizontalRows() {
  return ['STRATUS', 'STRATOCUMULUS', 'HUMILIS', 'MEDIOCRIS', 'CONGESTUS'].map(n => new RegExp(`const H_${n} = HRow\\(([-\\d., ]+)\\)`).exec(WEATHER_WGSL)!).map(m => {
    const [size, pk, split, elong, align, deck, presBig, presSmall, emul] = numbers(m[1]);
    return { size, pk, split, elong, align, deck, presBig, presSmall, emul };
  });
}

describe('species profile table', () => {
  const r = speciesRows();
  it('has the six rows', () => {
    expect(Object.keys(r).sort()).toEqual(['altocumulus', 'congestus', 'humilis', 'mediocris', 'stratocumulus', 'stratus']);
  });
  it('orders the cumulus by height: humilis < mediocris < congestus, congestus a tower of over 1.5 km', () => {
    expect(r.humilis.depth).toBeLessThan(r.mediocris.depth);
    expect(r.mediocris.depth).toBeLessThan(r.congestus.depth);
    expect(r.congestus.depth).toBeGreaterThan(1500);
    expect(r.humilis.depth).toBeLessThan(300);
  });
  it('flattens the tops from congestus to stratus, and no species is a cone (top exponent at least 1.5)', () => {
    const order = [r.congestus, r.mediocris, r.humilis, r.stratocumulus, r.stratus].map(x => x.topExp);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    expect(Math.min(...order)).toBeGreaterThanOrEqual(1.5);
  });
  it('keeps the cumulus bases flat and lets the stratus base sag and sit lower', () => {
    for (const k of ['humilis', 'mediocris', 'congestus'] as const) { expect(r[k].bottom).toBeLessThanOrEqual(10); expect(r[k].baseOff).toBe(0); }
    expect(r.stratus.bottom).toBeGreaterThan(r.humilis.bottom);
    expect(r.stratus.baseOff).toBeLessThan(0);
  });
  it('flips from wispy to billowy lower for the convective species (NE p.99), stratus nearly all wispy', () => {
    expect(r.congestus.flip).toBeLessThan(r.mediocris.flip);
    expect(r.mediocris.flip).toBeLessThan(r.humilis.flip);
    expect(r.stratus.flip).toBeGreaterThan(0.8);
    expect(r.stratus.billowAmp).toBeLessThan(0.2);
  });
});

describe('horizontal species table', () => {
  const [stratus, sc, humilis, mediocris, congestus] = horizontalRows();
  it('gives stratus a full sheet, stratocumulus a banded sheet along the wind, cumulus no sheet', () => {
    expect(stratus.deck).toBe(1);
    expect(sc.deck).toBeGreaterThan(0.5);
    expect(sc.align).toBe(1);
    expect(sc.elong).toBeGreaterThan(2.5);
    for (const c of [humilis, mediocris, congestus]) expect(c.deck).toBe(0);
  });
  it('makes humilis small and mostly small cells, congestus rising with turrets', () => {
    expect(humilis.size).toBeLessThan(mediocris.size);
    expect(humilis.presBig).toBeLessThan(0.3);
    expect(congestus.pk).toBeGreaterThan(mediocris.pk);
    expect(congestus.split).toBeGreaterThan(humilis.split);
  });
});

describe('presets', () => {
  it('use the profile table everywhere except the storm scene', () => {
    for (const [name, p] of Object.entries(CLOUD_PRESETS)) expect(!!p.params.profiles).toBe(name !== 'storm');
  });
  it('select single species with equal species ranges', () => {
    expect(CLOUD_PRESETS.humilis.weather.speciesRange).toEqual([0.5, 0.5]);
    expect(CLOUD_PRESETS.mediocris.weather.speciesRange).toEqual([0.75, 0.75]);
    expect(CLOUD_PRESETS.stratocumulus.weather.speciesRange).toEqual([0.25, 0.25]);
    expect(CLOUD_PRESETS.stratus.weather.speciesRange).toEqual([0, 0]);
  });
});

describe('altoFractions', () => {
  it('is off without profiles or a base', () => {
    expect(altoFractions({ profiles: false, altoBase: 1400, altoDepth: 180 }, 2048)).toEqual([0, 0]);
    expect(altoFractions({ profiles: true, altoBase: 0, altoDepth: 180 }, 2048)).toEqual([0, 0]);
  });
  it('keeps a layer that fits and moves one that does not under 0.95 of the volume', () => {
    const [b, d] = altoFractions({ profiles: true, altoBase: 1400, altoDepth: 180 }, 2048);
    expect(b * 2048).toBeCloseTo(1400, 3);
    expect(d * 2048).toBeCloseTo(180, 3);
    const [b2, d2] = altoFractions({ profiles: true, altoBase: 1400, altoDepth: 180 }, 512);
    expect(b2 + d2).toBeCloseTo(0.95, 5);
    expect(b2).toBeGreaterThanOrEqual(0.3);
  });
});
