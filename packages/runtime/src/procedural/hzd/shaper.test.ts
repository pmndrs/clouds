import { describe, expect, it } from 'vitest';
import { defaultProceduralSettings, packProceduralParams, PROC_PARAM_FLOATS, hzdNdfKey, PROC_HZD_FORMS_OFFSET, PROC_HZD_N3_OFFSET, PROC_HZD_LUT_OFFSET, PROC_HZD_LUT_FLOATS } from '../settings';
import { PROC_PARAMS_WGSL } from '../density.wgsl';
import { profilePeaks, profileTablesSmoothed, sampleProfileTable } from '../../generate/profile-tables';
import { HZD_GRADIENTS, HZD_LUT_BUFFER_WORDS, HZD_LUT_WORDS, packHzdLutQuads, hzdHeightGradient, hzdTableProfile, hzdTableType, PROC_HZD_WGSL, procShaperWgsl, procShaperBindingsWgsl } from './shaper.wgsl';
import { HZD_DETAIL_GAINS, HZD_SHAPE_GAINS, hzdNoiseBakeWgsl, worleyLadder } from './noise.wgsl';
import { HZD_NDF_SAMPLE_WGSL } from './ndf.wgsl';

describe('HZD shaper (H1)', () => {
  it('uses the shipped Nutshell gradient stops (nut s7-8) and the GP7 constants', () => {
    expect(HZD_GRADIENTS.cumulus).toEqual([0.01, 0.09, 0.65, 0.8]);
    expect(PROC_HZD_WGSL).toContain('vec4(0.04, 0.16, 0.32, 0.48)');
    expect(PROC_HZD_WGSL).toContain('A.g * 0.625 + A.b * 0.25 + A.a * 0.125');          // gp7 p.106
    expect(PROC_HZD_WGSL).toContain('hzdRemap(pw, -(1.0 - lowFbm), 1.0, 0.0, 1.0)');    // gp7 p.106 dilation (pw = R, H5 contrast off by default)
    expect(PROC_HZD_WGSL).toContain('hzdRemap(baseCloud, 1.0 - cov, 1.0, 0.0, 1.0)');   // hfw p.17 coverage sign
    expect(PROC_HZD_WGSL).toContain('saturate(h / select(P.hzExtra.z, 0.2, hag))');      // gp7 p.108 h*10 switch (wispyHeight 0.1; hag: h*5)
    expect(PROC_HZD_WGSL).toContain('select(mix(P.hzSkirt.w, P.hzExtra.y, saturate(h / P.hzExtra.z)), 0.35 * exp(-0.75 * cov), hag)'); // gp7 p.109 *0.2 = erosionStrength (hag eq 16)
  });
  it('evaluates the gradients as linear trapezoids, lerping the stops by type', () => {
    // Pure types: stratus is full only between 0.07 and 0.11, cumulus between 0.09 and 0.65 and gone at 0.80.
    expect(hzdHeightGradient(0, 0.09)).toBeCloseTo(1);
    expect(hzdHeightGradient(0, 0.2)).toBe(0);
    expect(hzdHeightGradient(1, 0.5)).toBeCloseTo(1);
    expect(hzdHeightGradient(1, 0.725)).toBeCloseTo(0.5);
    expect(hzdHeightGradient(1, 0.8)).toBe(0);
    expect(hzdHeightGradient(0.5, 0.25)).toBeCloseTo(1);               // stratocumulus plateau 0.16..0.32
    // 'points' keeps one flat core between the types; 'curves' sums two humps.
    expect(hzdHeightGradient(0.75, 0.45, 'points')).toBeCloseTo(1);    // stops (0.025, 0.125, 0.485, 0.64)
    expect(hzdHeightGradient(0.75, 0.45, 'curves')).toBeLessThan(0.8);
  });
  it('H6: topRound widens the top fall and smooth ramps keep the stops', () => {
    // Cumulus falls over 0.65..0.80 (Nutshell); topRound 0.7 starts the fall at 0.65 + (0.09 - 0.65) * 0.7 = 0.258.
    expect(hzdHeightGradient(1, 0.5)).toBeCloseTo(1);
    expect(hzdHeightGradient(1, 0.5, 'points', { topRound: 0.7 })).toBeCloseTo((0.8 - 0.5) / (0.8 - 0.258), 3);
    expect(hzdHeightGradient(1, 0.725, 'points', { smooth: true })).toBeCloseTo(0.5);
    expect(hzdHeightGradient(1, 0.8, 'curves', { topRound: 0.7, smooth: true })).toBe(0);
    expect(PROC_HZD_WGSL).toContain('let c = mix(s.z, s.y, P.hzProf.x);');
  });
  it('H6: packs the new words (defaults) and keeps every H6 term switchable', () => {
    const s = defaultProceduralSettings('hzd');
    const out = new Float32Array(PROC_PARAM_FLOATS);
    packProceduralParams(s, out);
    expect(Array.from(out.subarray(152, 156))).toEqual([1, 0.3, 0.2, 1].map(Math.fround));           // contrast, erosion 0.3, wispy 0.2, 'hfw'
    expect(Array.from(out.subarray(156, 160))).toEqual([0.7, 1, 0.4, 0.4].map(Math.fround));         // topRound, smooth, height from coverage
    expect(Array.from(out.subarray(160, 164))).toEqual([0, 0.5, 0.08, 0.04].map(Math.fround));       // density from coverage off, veil width/density (H6 defaults)
    expect(Array.from(out.subarray(164, 168))).toEqual([0.25, 0.5, 3, 15000].map(Math.fround));
    s.hzd.erosionOrder = 'gp7'; s.hzd.veilNoise = 'shape';
    packProceduralParams(s, out);
    expect(out[155]).toBe(0);
    expect(out[168]).toBe(1);
    expect(PROC_HZD_WGSL).toContain('let be = hzdRemap(base, modifier * strength * fade + lobe, 1.0, 0.0, 1.0);');   // HFW p.15 order
  });
  it('H7: packs the skirt and wispy-bottom words; the H6 veil is one switch away', () => {
    const s = defaultProceduralSettings('hzd');
    // H7's look is an option, not the default (judged 2026-10-10): apply it explicitly.
    Object.assign(s.hzd, { skirtMode: 'skirt', bottomCurl: 2.5, bottomCurlDown: 0.5, bottomErosion: 0.5, lobeStrength: 0.6, baseLump: 0.04, typeBlend: 'hybrid' });
    const out = new Float32Array(PROC_PARAM_FLOATS);
    packProceduralParams(s, out);
    expect(Array.from(out.subarray(168, 172))).toEqual([0, 1, 500, 2.5].map(Math.fround));      // veil noise, skirt mode, trail (m), stretch
    expect(Array.from(out.subarray(172, 176))).toEqual([0.08, 2.5, 0.5, 0.3].map(Math.fround));  // peak, bottom curl, its downward share, wispy strength
    expect(Array.from(out.subarray(176, 180))).toEqual([3, 2, 0.5, 0.25].map(Math.fround));      // skirt scale, trail width, bottom erosion, gap
    s.hzd.skirtMode = 'veil';
    packProceduralParams(s, out);
    expect(out[169]).toBe(0);
    expect(PROC_HZD_WGSL).toContain('let skirtOn = P.hzVeil.y > 0.5;');
  });
  it('H7: packs the lobe rung and the shelf words', () => {
    const s = defaultProceduralSettings('hzd');
    // H7's look is an option, not the default (judged 2026-10-10): apply it explicitly.
    Object.assign(s.hzd, { skirtMode: 'skirt', bottomCurl: 2.5, bottomCurlDown: 0.5, bottomErosion: 0.5, lobeStrength: 0.6, baseLump: 0.04, typeBlend: 'hybrid' });
    const out = new Float32Array(PROC_PARAM_FLOATS);
    packProceduralParams(s, out);
    expect(Array.from(out.subarray(180, 184))).toEqual([1050, 0.6, 0.45, 1].map(Math.fround));    // lobe tile, strength, full height, cubic
    expect(out[187]).toBeCloseTo(0.5);                                                           // lobe coverage reference
    s.hzd.lobeStrength = 0;
    packProceduralParams(s, out);
    expect(out[181]).toBe(0);
    expect(PROC_HZD_WGSL).toContain('if (P.hzLobe.y > 0.0 || (edgeOn && P.hzEdge4.x > 0.0)) {');
  });
  it('H7: the hybrid blend takes one lerped rise and the summed falls', () => {
    // Type 0.75: the lerped rise (stratocumulus..cumulus stops) is full above 0.125; below it the hybrid follows one ramp, not two.
    expect(hzdHeightGradient(0.75, 0.2, 'hybrid')).toBeCloseTo(hzdHeightGradient(0.75, 0.2, 'curves'));
    expect(hzdHeightGradient(0.75, 0.02, 'hybrid')).toBeCloseTo(0);   // below the lerped rise start (0.025 .. 0.125)
    expect(hzdHeightGradient(0.75, 0.02, 'curves')).toBeGreaterThan(0.05);   // the cumulus rise alone already shows: a second base
  });
  it('packs the HZD words and spans the shell over the layer', () => {
    const s = defaultProceduralSettings('hzd');
    const out = new Float32Array(PROC_PARAM_FLOATS);
    expect(packProceduralParams(s, out)).toEqual([1500, 5000]);
    expect(Array.from(out.subarray(120, 124))).toEqual([1500, 5000, 32000, s.hzd.extinction].map(Math.fround));
    expect(out[140]).toBeCloseTo(0.5);                 // drift: the map moves at half the wind offset
    s.hzd.ndfMotion = 'static';
    packProceduralParams(s, out);
    expect(out[140]).toBe(0);                          // static: Nubis / HZD, noise-only scroll
    expect(PROC_PARAMS_WGSL.match(/: vec4<f32>/g)!.length).toBe(PROC_HZD_LUT_OFFSET / 4);   // the struct matches the packer (then the F1 tables)
    expect(PROC_PARAM_FLOATS).toBe(PROC_HZD_LUT_OFFSET + PROC_HZD_LUT_FLOATS);
  });
  it('reads the NDF through ndfSample from a 2-layer array, and binds it as such', () => {
    expect(HZD_NDF_SAMPLE_WGSL).toContain('fn ndfSample(xz: vec2<f32>) -> NdfSample');
    expect(procShaperBindingsWgsl('hzd', 1, 9)).toContain('var procWeather: texture_2d_array<f32>');
    expect(procShaperBindingsWgsl('takram', 1, 9)).toContain('var procWeather: texture_2d<f32>');
    expect(procShaperWgsl('hzd')).toBe(PROC_HZD_WGSL);
  });
  it('re-generates the NDF only when its inputs change', () => {
    const a = defaultProceduralSettings('hzd').hzd.ndf;
    expect(hzdNdfKey({ ...a })).toBe(hzdNdfKey(a));
    expect(hzdNdfKey({ ...a, seed: a.seed + 1 })).not.toBe(hzdNdfKey(a));
    expect(hzdNdfKey({ ...a, tileMeters: 1 })).toBe(hzdNdfKey(a));   // the tile is a sampling scale, not a generator input
  });
});

describe('HZD noise bake recipe (H1)', () => {
  it('rounds the Nubis Worley ladder to integer cells per tile so every octave tiles', () => {
    expect(worleyLadder(HZD_SHAPE_GAINS[0])).toEqual([10, 19, 25, 37, 5]);
    expect(worleyLadder(HZD_SHAPE_GAINS[1])).toEqual([17, 32, 43, 63, 9]);
    expect(worleyLadder(HZD_SHAPE_GAINS[2])).toEqual([23, 44, 57, 85, 12]);
    // The detail ladder's finest octave sits at the 32^3 Nyquist limit (16 cells).
    expect(Math.max(...worleyLadder(HZD_DETAIL_GAINS[2]))).toBe(16);
  });
  it('builds the shape kernel for either texture format', () => {
    expect(hzdNoiseBakeWgsl('rgba16float')).toContain('texture_storage_3d<rgba16float, write>');
  });
});

describe('HZD shaper F1: types and forms', () => {
  it('step 1: packs the N3 s18 tables 3 bytes per float, exactly and NaN-free', () => {
    const s = defaultProceduralSettings('hzd');
    const out = new Float32Array(PROC_PARAM_FLOATS);
    packProceduralParams(s, out);
    const lut = out.subarray(PROC_HZD_LUT_OFFSET, PROC_HZD_LUT_OFFSET + PROC_HZD_LUT_FLOATS);
    expect(lut.every(v => Number.isInteger(v) && v >= 0 && v < 2 ** 24)).toBe(true);
    // Decode as the WGSL does (hzdLutTexel) and compare with the smoothed tables H4 uses.
    const { top, bottom } = profileTablesSmoothed();
    const byte = (i: number) => (lut[Math.floor(i / 3)] >> ((i % 3) * 8)) & 255;
    for (const i of [0, 17 * 64 + 5, 4095]) { expect(byte(i)).toBe(top[i]); expect(byte(4096 + i)).toBe(bottom[i]); }
    expect(byte(8192 + 64 * 10 + 30)).toBe(profilePeaks()[64 * 10 + 30]);
    expect(PROC_PARAMS_WGSL).toContain('hzLut: array<vec4<f32>, 1024>');
  });
  it('F2 step 1: the storage buffer holds each texel\'s bilinear quad; filtered as the shader does, it matches the uniform path\'s read', () => {
    const words = packHzdLutQuads();
    expect(words.length).toBe(HZD_LUT_WORDS);
    const tables = [...Object.values(profileTablesSmoothed()), profilePeaks()];
    // hzdLut's storage branch: x0 = min(floor(63 t), 62), y0 = min(floor(clamp(64 v - 0.5, 0, 63)), 62), one word, unpack4x8unorm.
    const read = (t: number, type: number, v: number) => {
      const x = Math.min(Math.max(type, 0), 1) * 63, y = Math.min(Math.max(v * 64 - 0.5, 0), 63);
      const x0 = Math.min(Math.floor(x), 62), y0 = Math.min(Math.floor(y), 62), fx = x - x0, fy = y - y0;
      const w = words[t * 4096 + y0 * 64 + x0], c = [0, 8, 16, 24].map(s => ((w >>> s) & 255) / 255);
      const a = c[0] + (c[1] - c[0]) * fx, b = c[2] + (c[3] - c[2]) * fx;
      return a + (b - a) * fy;
    };
    for (let t = 0; t < 3; t++) for (const [type, v] of [[0, 0], [0.4, 0.3], [0.77, 0.61], [1, 1], [0.123, 0.999], [0.999, 0.5]]) {
      expect(read(t, type, v)).toBeCloseTo(sampleProfileTable(tables[t], type, v), 6);
    }
    expect(PROC_HZD_WGSL).toContain('let c = unpack4x8unorm(procLut[t * 4096u + y0 * 64u + x0]);');
    expect(procShaperBindingsWgsl('hzd', 1, 9)).toContain(`@binding(17) var<storage, read> procLut: array<u32, ${HZD_LUT_BUFFER_WORDS}>;`);
  });
  it('step 1: the table profile gives crisp bases at bottom type 0, ragged ones at 1, and taller tops with the top type', () => {
    // Bottom type 0 reaches most of its peak within 15 % of the column; bottom type 1 rises slowly.
    expect(hzdTableProfile(0.4, 0, 0.15)).toBeGreaterThan(0.8);
    expect(hzdTableProfile(0.4, 1, 0.1)).toBeLessThan(0.75 * hzdTableProfile(0.4, 0, 0.1));   // the peak normalisation narrows the gap
    expect(hzdTableProfile(0.4, 1, 0.03)).toBeLessThan(0.5 * hzdTableProfile(0.4, 0, 0.03));
    // NE's cumulus type (0.4) is gone above about 0.8 of the column; the tall tiered types reach the top.
    expect(hzdTableProfile(0.4, 0, 0.85)).toBeLessThan(0.05);
    expect(hzdTableProfile(0.9, 0, 0.85)).toBeGreaterThan(0.4);
    // Normalised: every pair peaks at 1 (within the bilinear read).
    const peak = (tt: number, bt: number) => Math.max(...Array.from({ length: 101 }, (_, i) => hzdTableProfile(tt, bt, i / 100)));
    expect(peak(0.27, 0)).toBeGreaterThan(0.95);
    expect(peak(0.75, 1)).toBeGreaterThan(0.95);
    expect(hzdTableType(0, [0.14, 0.27, 0.4])).toBeCloseTo(0.14);
    expect(hzdTableType(0.75, [0.14, 0.27, 0.4])).toBeCloseTo(0.335);
  });
  it('step 1: packs the type words; F2: the tables (storage source) are the default, Nutshell stays selectable', () => {
    const s = defaultProceduralSettings('hzd');
    const out = new Float32Array(PROC_PARAM_FLOATS);
    packProceduralParams(s, out);
    const o = PROC_HZD_FORMS_OFFSET;
    expect(Array.from(out.subarray(o, o + 4))).toEqual([2, 0.14, 0.27, 0.4].map(Math.fround));
    s.hzd.profileMode = 'nutshell';
    packProceduralParams(s, out);
    expect(out[o]).toBe(0);
    s.hzd.profileMode = 'tables'; s.hzd.bottomTypeVariation = 0.6;
    packProceduralParams(s, out);
    expect(out[o]).toBe(2);                    // F2: the storage-buffer source is the default
    expect(out[o + 5]).toBeCloseTo(0.6);
    s.hzd.tableSource = 'uniform';
    packProceduralParams(s, out);
    expect(out[o]).toBe(1);                    // F1's uniform-array path stays selectable
    expect(PROC_HZD_WGSL).toContain('if (P.hzType.x > 0.5) { return hzdTableProfile(hzdTableType(cloudType), h, hr); }');
  });
  it('N1: packs the Nubis Cubed noise block (nubis3 the default erosion noise, HZD selectable; pack shape off) between the forms and the tables', () => {
    const s = defaultProceduralSettings('hzd');
    const out = new Float32Array(PROC_PARAM_FLOATS);
    packProceduralParams(s, out);
    const o = PROC_HZD_N3_OFFSET;
    expect(o).toBe(PROC_HZD_FORMS_OFFSET + 44);
    expect(PROC_HZD_LUT_OFFSET).toBe(o + 40);   // P2.5a/b: + 4 edge vec4; L3: the hzMix vec4 and (STORM1) three storm vec4 sit between the N1 block and the tables
    expect(Array.from(out.subarray(o, o + 8))).toEqual([1, 600, 1, 0.5, 900, 1, 0, 0]);
    s.hzd.noiseSet = 'hzd'; s.hzd.shapeNoise = 'nubis3';
    packProceduralParams(s, out);
    expect(out[o]).toBe(0);
    expect(out[o + 7]).toBe(4000);
    expect(PROC_PARAMS_WGSL).toContain('hzN3b: vec4<f32>,');
    expect(PROC_HZD_WGSL).toContain('textureSampleLevel(cloudNoise, repeatSampler, q / P.hzN3.y');
    expect(PROC_HZD_WGSL).toContain('let billowy = mix(n.b * 0.3, n.a * 0.3, sqrt(sqrt(prof)));');
  });
  it('step 2: anvils (n17 exponent with its clamp switch, hag eq 17-18) and a placed storm cell that lifts the shell', () => {
    const s = defaultProceduralSettings('hzd');
    const out = new Float32Array(PROC_PARAM_FLOATS);
    expect(packProceduralParams(s, out)).toEqual([1500, 5000]);            // storms off: the H6 shell
    const o = PROC_HZD_FORMS_OFFSET;
    expect(Array.from(out.subarray(o + 8, o + 12))).toEqual([0, 1, 0, 0]);  // anvil off, clamped
    expect(out[o + 15]).toBe(0);                                           // storm strength
    s.hzd.stormStrength = 1;
    expect(packProceduralParams(s, out)).toEqual([1500, 10000]);           // the storm top lifts the march shell
    s.hzd.stormStrength = 0; s.hzd.stormTypeStart = 0.95;
    expect(packProceduralParams(s, out)[1]).toBe(10000);                   // type-driven storms too
    expect(PROC_HZD_WGSL).toContain('var e = hzdRemap(h, 0.7, 0.8, 1.0, lo);');                                    // n17 p.46
    expect(PROC_HZD_WGSL).toContain('if (P.hzAnvil.y > 0.5) { e = clamp(e, lo, 1.0); }');
    expect(PROC_HZD_WGSL).toContain('pow(g, max(saturate(hzdRemap(h, 0.65, 0.95, 1.0, 1.0 - fl)), 0.05))');      // hag eq 17
    expect(PROC_HZD_WGSL).toContain('saturate(hzdRemap(sqrt(h), 0.4, 0.95, 1.0, 0.2))');                          // hag eq 18
  });
  it('step 3: two sheet slots with their own forms; each widens the shell only when on', () => {
    const s = defaultProceduralSettings('hzd');
    const out = new Float32Array(PROC_PARAM_FLOATS);
    const o = PROC_HZD_FORMS_OFFSET;
    packProceduralParams(s, out);
    expect(out[o + 20]).toBe(0);
    expect(out[o + 28]).toBe(0);
    s.hzd.midForm = 'altocumulus'; s.hzd.deckForm = 'stratus';
    expect(packProceduralParams(s, out)).toEqual([600, 5850]);              // deck 600 + 400 below the layer, Ac 5400 + 450 above
    expect(Array.from(out.subarray(o + 20, o + 24))).toEqual([1, 5400, 450, 0.5].map(Math.fround));
    expect(out[o + 28]).toBe(3);
    s.hzd.midForm = 'altostratus';
    packProceduralParams(s, out);
    expect(out[o + 20]).toBe(2);
    expect(PROC_HZD_WGSL).toContain('hzdSheetSample(P.hzMid, P.hzMid2, p, t, footprint, full)');
  });
  it('step 4: fractus is off by default, looks upwind for a body base and lowers the shell by its drop', () => {
    const s = defaultProceduralSettings('hzd');
    const out = new Float32Array(PROC_PARAM_FLOATS);
    const o = PROC_HZD_FORMS_OFFSET;
    packProceduralParams(s, out);
    expect(out[o + 36]).toBe(0);
    s.hzd.fractusDensity = 0.2;
    expect(packProceduralParams(s, out)).toEqual([1500 - s.hzd.fractusDrop, 5000]);
    expect(Array.from(out.subarray(o + 36, o + 40))).toEqual([0.2, 900, 220, 0.08].map(Math.fround));
    expect(out[o + 42]).toBe(3);                                                       // taps: overhead + 2 upwind
    expect(PROC_HZD_WGSL).toContain('let b = hzdBelly(p.xz - wind2 * (P.hzFrac.y * f), lod);');
    expect(PROC_HZD_WGSL).toContain('F *= 1.0 - 0.85 * over;');                          // not under the whole base: from the lee edge
    expect(PROC_HZD_WGSL).toContain('if (P.hzFrac.x > 0.0 && full && o.sigma <= 0.0) { o = hzdFractusSample(p, t, footprint); }');
  });
});
