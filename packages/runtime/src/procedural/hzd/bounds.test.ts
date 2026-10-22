import { describe, expect, it } from 'vitest';
import { defaultProceduralSettings, packProceduralParams, PROC_HZD_MIX_OFFSET, PROC_PARAM_FLOATS } from '../settings';
import { hzdBoundsCell } from './bounds';
import { HZD_BOUNDS_GRID, HZD_BOUNDS_OPEN, HZD_BOUNDS_WORDS, HZD_LUT_BUFFER_WORDS, HZD_LUT_WORDS, PROC_HZD_WGSL } from './shaper.wgsl';

describe('HZD empty-space skipping (PF1)', () => {
  it('keeps the bounds words after the profile tables, open until the pass has run', () => {
    expect(HZD_LUT_BUFFER_WORDS).toBe(HZD_LUT_WORDS + HZD_BOUNDS_WORDS);
    expect(HZD_BOUNDS_WORDS).toBe(HZD_BOUNDS_GRID * HZD_BOUNDS_GRID);
    // max coverage 1, min height 0, max height 1: nothing can be skipped.
    expect([HZD_BOUNDS_OPEN & 255, (HZD_BOUNDS_OPEN >> 8) & 255, (HZD_BOUNDS_OPEN >> 16) & 255]).toEqual([255, 0, 255]);
  });
  it('packs the mode into hzMix.w: off 0, exact 2, free 3', () => {
    const out = new Float32Array(PROC_PARAM_FLOATS);
    const s = defaultProceduralSettings('hzd');
    for (const [mode, code] of [['off', 0], ['exact', 2], ['free', 3]] as const) {
      s.hzd.emptySkip = mode;
      packProceduralParams(s, out);
      expect(out[PROC_HZD_MIX_OFFSET + 3]).toBe(code);
    }
  });
  it('bounds a cell by its texels, their bilinear neighbours and the margin, wrapping at the tile edge', () => {
    const size = 128, g = HZD_BOUNDS_GRID, k = size / g;   // 2 texels per cell
    const cov = new Uint8Array(size * size), lo = new Uint8Array(size * size).fill(200), hi = new Uint8Array(size * size);
    // One covered texel at (10, 10): cell (5, 5) holds it.
    cov[10 * size + 10] = 77; lo[10 * size + 10] = 30; hi[10 * size + 10] = 120;
    expect(hzdBoundsCell(size, cov, lo, hi, 5, 5)).toEqual([77, 30, 120]);
    // The neighbour cell two texels away reaches it through the bilinear footprint (one texel) and the rounding slack (one more).
    expect(hzdBoundsCell(size, cov, lo, hi, 6, 5)[0]).toBe(77);
    expect(hzdBoundsCell(size, cov, lo, hi, 7, 5)[0]).toBe(0);
    // A margin of 2 texels reaches one more cell.
    expect(hzdBoundsCell(size, cov, lo, hi, 7, 5, 2)[0]).toBe(77);
    // The last cell reads across the tile edge into the first texels.
    const wrap = new Uint8Array(size * size); wrap[3 * size + 0] = 9;
    expect(hzdBoundsCell(size, wrap, lo, hi, g - 1, 1)[0]).toBe(9);
    expect(k).toBe(2);
  });
  it('tests the main layer, the sheets, the ring, storms and fractus before skipping', () => {
    expect(PROC_HZD_WGSL).toContain('if (P.hzStorm.w > 0.0) { return false; }');
    expect(PROC_HZD_WGSL).toContain('cov = max(cov, P.hzRing.z)');
    expect(PROC_HZD_WGSL).toContain('aMax > P.hzMid.y && aMin < P.hzMid.y + P.hzMid.z');
    expect(PROC_HZD_WGSL).toContain('aMax > P.hzDeck.y && aMin < P.hzDeck.y + P.hzDeck.z');
    expect(PROC_HZD_WGSL).toContain('P.hzLayer.x - P.hzFrac.z');
  });
});
