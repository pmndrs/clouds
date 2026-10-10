import { describe, expect, it } from 'vitest';
import { PROFILE_TABLE_FLOOR, PROFILE_TABLE_SIZE, packProfileTables, profilePeaks, profileTables, profileTablesSmoothed, profileTopEnds, sampleProfileTable, speciesTopType } from './profile-tables';

// H4: the N3 s18 tables as committed, checked against what the research notes read from the CSVs (n3/slides-001-046.md "Profile tables").
const N = PROFILE_TABLE_SIZE;
const at = (t: Uint8Array, col: number, row: number) => t[row * N + col] / 255;

describe('N3 s18 profile tables', () => {
  const { top, bottom } = profileTables();
  it('decodes two 64 x 64 byte tables', () => {
    expect(top.length).toBe(N * N);
    expect(bottom.length).toBe(N * N);
  });
  it('shares the floor at row 17: top 1 and bottom 0 below it', () => {
    for (let c = 0; c < N; c++) for (let r = 0; r < 16; r++) {
      expect(at(top, c, r)).toBe(1);
      expect(at(bottom, c, r)).toBe(0);
    }
    expect(at(bottom, 0, 17)).toBeGreaterThan(0.1);
    expect(PROFILE_TABLE_FLOOR).toBeCloseTo(0.266, 3);
  });
  it('makes bottom type 0 the crisp base and bottom type 1 the slow ragged one', () => {
    // type 0 reaches 0.8 within 0.1 of the floor; type 1 is still near 0.4 there and reaches 0.8 only about half the column higher
    expect(at(bottom, 0, 24)).toBeGreaterThanOrEqual(0.78);
    expect(at(bottom, 63, 24)).toBeLessThan(0.35);
    const halfRise = (c: number) => { for (let r = 17; r < N; r++) if (at(bottom, c, r) >= 0.5) return (r + 0.5) / N; return 1; };
    expect(halfRise(0)).toBeLessThan(0.33);
    expect(halfRise(63)).toBeGreaterThan(0.42);
    expect(Math.max(...bottom) / 255).toBeLessThan(0.95);   // the product never reaches 1
  });
  it('raises the top with type, in steps, and gives the tall types a tiered (non-monotone) top', () => {
    const ends = profileTopEnds();
    expect(ends[0]).toBeLessThan(0.3);   // type 0: a one-row sheet on the floor
    for (let c = 1; c < N; c++) expect(ends[c]).toBeGreaterThanOrEqual(ends[c - 1] - 1e-6);
    expect(ends[63]).toBeGreaterThan(0.95);
    // type 0.75: a dip around h 0.5-0.6 under a second shoulder at 0.65-0.7
    const col = 48, dip = Math.min(...[34, 36, 38].map(r => at(top, col, r))), shoulder = Math.max(...[42, 44, 46].map(r => at(top, col, r)));
    expect(shoulder).toBeGreaterThan(dip + 0.05);
  });
  it('samples bilinearly on texel centres', () => {
    expect(sampleProfileTable(top, 0, (17 + 0.5) / N)).toBeCloseTo(at(top, 0, 17), 6);
    expect(sampleProfileTable(bottom, 1, (30 + 0.5) / N)).toBeCloseTo(at(bottom, 63, 30), 6);
    const mid = sampleProfileTable(bottom, 0, 18 / N);   // halfway between rows 17 and 18
    expect(mid).toBeCloseTo((at(bottom, 0, 17) + at(bottom, 0, 18)) / 2, 6);
  });
  it('smooths the palette steps but keeps the floor and the crisp-vs-ragged bases', () => {
    const sm = profileTablesSmoothed();
    for (let c = 0; c < N; c++) for (let r = 0; r < 16; r++) { expect(at(sm.top, c, r)).toBe(1); expect(at(sm.bottom, c, r)).toBe(0); }
    expect(at(sm.bottom, 0, 23)).toBeGreaterThanOrEqual(0.72);
    expect(at(sm.bottom, 63, 23)).toBeLessThan(0.35);
    // no flat run of more than 3 rows in the bottom table's rise (the raw palette has runs of 4-6)
    let run = 0, maxRun = 0;
    for (let r = 18; r < 40; r++) { run = sm.bottom[r * N + 32] === sm.bottom[(r - 1) * N + 32] ? run + 1 : 0; maxRun = Math.max(maxRun, run); }
    expect(maxRun).toBeLessThan(3);
  });
  it('packs 4 bytes per little-endian word, top table first', () => {
    const w = packProfileTables();
    const { top, bottom } = profileTablesSmoothed();
    expect(w.length).toBe(3072);
    const byte = (i: number) => (w[i >> 2] >>> ((i & 3) * 8)) & 255;
    for (const i of [0, 5, 17 * N + 3, 4095]) expect(byte(i)).toBe(top[i]);
    for (const i of [0, 17 * N + 1, 40 * N + 63]) expect(byte(N * N + i)).toBe(bottom[i]);
  });
  it('stores the column peak of top * bottom per type pair', () => {
    const pk = profilePeaks(), sm = profileTablesSmoothed();
    let m = 0;
    for (let r = 0; r < N; r++) m = Math.max(m, at(sm.top, 40, r) * at(sm.bottom, 0, r));
    expect(pk[0 * N + 40] / 255).toBeCloseTo(m, 2);
    expect(pk[63 * N + 63]).toBeLessThan(pk[0 * N + 63]);   // the ragged base never fills as much as the crisp one
  });
  it('maps the species rows to top types with a body, rising from stratus to congestus', () => {
    const t = [0, 0.25, 0.5, 0.75, 1].map(speciesTopType);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    expect(t[0]).toBeGreaterThanOrEqual(0.12);
    expect(speciesTopType(0.125)).toBeCloseTo((t[0] + t[1]) / 2, 6);
  });
});
