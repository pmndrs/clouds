import { describe, expect, it } from 'vitest';
import { CLOUD_ART_SETTINGS, CLOUD_DECK_SETTINGS, CLOUD_DECIMA_SETTINGS, CLOUD_QUALITY_ORDER, CLOUD_QUALITY_PRESETS, cloudLookSettings, estimateCloudMemory } from './runtime';

describe('looks (D0)', () => {
  it('art and deck set the same knobs', () => {
    expect(Object.keys(CLOUD_DECK_SETTINGS).sort()).toEqual(Object.keys(CLOUD_ART_SETTINGS).sort());
  });
  it('deck drops every term the Nubis Cubed deck does not state', () => {
    const d = CLOUD_DECK_SETTINGS;
    expect([d.edgeDarkening, d.glowBoost, d.glowFront, d.deepScatter, d.ambientFloor, d.microShadow, d.detailBias, d.wispyBias, d.typeFromScale, d.bodyEnv, d.hazeDensity]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(d.ambientLaw).toBe(1);   // exp(-tauUp), N3 s128
    expect(d.ambientSkyBias).toBe(1);   // sky ambient only
    expect(d.bodySunFloor).toBe(1);   // no low-sun handoff
    expect(cloudLookSettings('deck', 'ultra').microDist).toBe(0);
  });
  it('decima (D1) sets the same knobs, drops the glow terms, keeps the deck ambient law bounded and puts the in-line taps in the grid units', () => {
    const d = CLOUD_DECIMA_SETTINGS;
    expect(Object.keys(d).sort()).toEqual(Object.keys(CLOUD_ART_SETTINGS).sort());
    expect([d.edgeDarkening, d.glowBoost, d.deepScatter, d.microShadow, d.detailBias, d.wispyBias]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(d.ambientLaw).toBe(1); expect(d.ambientFloor).toBeGreaterThan(0);   // exp(-tauUp) (N3 s128) bounded by the art floor (round 2: no dark core columns)
    expect(cloudLookSettings('decima', 'ultra').temporalAccumulate).toBe(1);
    expect(cloudLookSettings('decima', 'ultra').temporalBlend).toBe(0.1);   // round 4: the jitter's residual share in the resolve
    expect(cloudLookSettings('decima', 'ultra').stepJitter).toBe(1);   // round 5: the step phase randomised at the cloud entry
    expect(cloudLookSettings('decima', 'ultra').glowDepth).toBe(12);   // round 8: the glow's profile read past the sample (no profile discs)
    expect([cloudLookSettings('decima', 'ultra').microShadow, cloudLookSettings('decima', 'ultra').microShadowMode]).toEqual([2, 1]);   // round 10: the glow occluded by the florets' relief toward the sun
    expect([cloudLookSettings('decima', 'ultra').microDist2, cloudLookSettings('decima', 'ultra').microShadow2]).toEqual([8, 1]);   // round 11: a second tap 4-8 m (two floret scales)
    expect(cloudLookSettings('decima', 'ultra').detailBias).toBe(0.1);   // round 12: the hollows between the domes from the erosion
    expect(d.inScatterProfile).toBe(0.5);   // round 3: the deck's dimensional profile, not P x S, in the lighting; round 9: P sqrt(S), between the two
    // the taps' optical depth per density-metre (densityScale * inlineLightScale) is within a factor 2 of the grid's (densityScale * lightDensityScale)
    const taps = d.densityScale * d.inlineLightScale, grid = d.densityScale * d.lightDensityScale;
    expect(taps / grid).toBeGreaterThan(0.5); expect(taps / grid).toBeLessThan(2);
    // round 6: the grid's sun sum is one density sample per 16 m cell (N3 s113-114), 1/16 per density-metre within 5 percent
    expect(Math.abs(grid * 16 - 1)).toBeLessThan(0.05);
    expect(cloudLookSettings('decima', 'ultra').microDist).toBe(4); expect(cloudLookSettings('decima', 'ultra').microLightScale).toBe(0.25);   // round 9: the floret tap
    // the pre-D1 looks keep the taps at the view extinction (their renders are unchanged)
    expect(CLOUD_ART_SETTINGS.inlineLightScale).toBe(1); expect(CLOUD_DECK_SETTINGS.inlineLightScale).toBe(1);
  });
  it('art restores the tier micro-shadow and keeps the H3 ambient law', () => {
    expect(cloudLookSettings('art', 'high').microDist).toBe(CLOUD_QUALITY_PRESETS.high.microDist);
    expect(cloudLookSettings('art', 'low').microDist).toBe(CLOUD_QUALITY_PRESETS.low.microDist);
    expect(CLOUD_ART_SETTINGS.ambientLaw).toBe(0);
  });
});

describe('quality tiers', () => {
  it('are ordered from the cheapest: resolution, steps and cost levers only rise', () => {
    const p = CLOUD_QUALITY_ORDER.map(q => CLOUD_QUALITY_PRESETS[q]);
    for (let i = 1; i < p.length; i++) {
      expect(p[i].nearScale).toBeGreaterThanOrEqual(p[i - 1].nearScale);
      expect(p[i].farScale).toBeGreaterThan(p[i - 1].farScale);
      expect(p[i].maxSteps).toBeGreaterThan(p[i - 1].maxSteps);
      expect(p[i].outputScale).toBeGreaterThanOrEqual(p[i - 1].outputScale);
      expect(p[i].stepScale).toBeLessThanOrEqual(p[i - 1].stepScale);
      expect(p[i].transmittanceCutoff).toBeLessThanOrEqual(p[i - 1].transmittanceCutoff);
    }
  });
  it('keep a composite scale the shaders can use: 1 or 1/2 (integer scene-to-output ratios)', () => {
    for (const q of CLOUD_QUALITY_ORDER) expect([1, 0.5]).toContain(CLOUD_QUALITY_PRESETS[q].outputScale);
  });
  it('turn the near pass off (split 0, near scale 0) together or not at all', () => {
    for (const q of CLOUD_QUALITY_ORDER) {
      const p = CLOUD_QUALITY_PRESETS[q];
      expect(p.nearScale === 0).toBe(p.splitDistance === 0);
    }
  });
});

describe('estimateCloudMemory', () => {
  it('matches the history and trace bytes the runtime reports at 2560x1440 high (24,531,540) and stays within 25 MB', () => {
    const m = estimateCloudMemory(2560, 1440, 'high');
    expect(m.history + m.trace).toBe(24_531_540);
    expect(m.history + m.trace).toBeLessThanOrEqual(25_000_000);
  });
  it('shrinks with each tier and is far below the P5-B total (63.5 MB) at high', () => {
    const totals = CLOUD_QUALITY_ORDER.map(q => { const m = estimateCloudMemory(2560, 1440, q); return m.history + m.trace; });
    for (let i = 1; i < totals.length - 1; i++) expect(totals[i]).toBeGreaterThan(totals[i - 1]);
    expect(totals[3]).toBeLessThan(63_502_800 * 0.4);
  });
  it('counts the light grid from the volume dims', () => {
    const m = estimateCloudMemory(1920, 1080, 'high', { volumeDims: [256, 256, 32] });
    expect(m.lightGrid).toBe(3 * 128 * 128 * 16 * 8);
    expect(estimateCloudMemory(1920, 1080, 'low', { volumeDims: [256, 256, 32] }).lightGrid).toBeLessThan(m.lightGrid);
  });
});
