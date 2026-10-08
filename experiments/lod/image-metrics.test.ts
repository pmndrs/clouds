import { describe, expect, it } from 'vitest';
import { compareOpticalImages, evaluateOpticalMetrics } from './image-metrics';

function rgba(alpha: readonly number[], width = alpha.length, height = 1): Float32Array {
  const data = new Float32Array(width * height * 4);
  alpha.forEach((value, pixel) => { data[pixel * 4 + 3] = value; });
  return data;
}

describe('bounded optical image metrics', () => {
  it('classifies all-empty images as explicitly inconclusive', () => {
    const metrics = compareOpticalImages(rgba([1, 1, 1, 1]), rgba([1, 1, 1, 1]), 2, 2);
    expect(metrics.unionSupportCount).toBe(0);
    expect(evaluateOpticalMetrics(metrics)).toEqual({
      passed: false,
      inconclusive: true,
      reasons: ['Reference and candidate contain no cloud support; visibility quality is inconclusive.'],
    });
  });

  it('retains tiny below-support differences in full-image metrics', () => {
    const reference = rgba([1, 1, 1, 1]);
    const candidate = rgba([0.995, 1, 1, 1]);
    const metrics = compareOpticalImages(reference, candidate, 2, 2);
    expect(metrics.maxAbsT).toBeCloseTo(0.005);
    expect(metrics.meanAbsT).toBeCloseTo(0.00125);
    expect(metrics.unionSupportCount).toBe(0);
    expect(metrics.supportMeanAbsT).toBe(0);
    expect(evaluateOpticalMetrics(metrics).inconclusive).toBe(true);
  });

  it('passes an exact supported cloud match and counts support', () => {
    const image = rgba([1, 0.8, 0.5, 1], 2, 2);
    const metrics = compareOpticalImages(image, image, 2, 2);
    expect(metrics.referenceSupportCount).toBe(2);
    expect(metrics.candidateSupportCount).toBe(2);
    expect(metrics.supportSymmetricDifferenceCount).toBe(0);
    expect(metrics.maxAbsT).toBe(0);
    // Small fixtures are intentionally inconclusive under the provisional gate.
    expect(evaluateOpticalMetrics(metrics).inconclusive).toBe(true);
  });

  it('reports a single outlier over the union and computes p95', () => {
    const reference = rgba(Array(20).fill(0.8));
    const candidate = rgba(Array.from({ length: 20 }, (_, i) => i === 0 ? 0.7 : 0.8));
    const metrics = compareOpticalImages(reference, candidate, 4, 5);
    expect(metrics.unionSupportCount).toBe(20);
    expect(metrics.maxAbsT).toBeCloseTo(0.1);
    expect(metrics.meanAbsT).toBeCloseTo(0.005);
    expect(metrics.p95AbsT).toBeCloseTo(0.005);
  });

  it('keeps full-image mean distinct from support mean', () => {
    const reference = rgba([0.8, 1, 1, 1]);
    const candidate = rgba([0.7, 0.999, 0.999, 0.999]);
    const metrics = compareOpticalImages(reference, candidate, 2, 2);
    expect(metrics.meanAbsT).toBeCloseTo(0.02575);
    expect(metrics.supportMeanAbsT).toBeCloseTo(0.1);
    expect(metrics.maxAbsT).toBeCloseTo(0.1);
  });

  it('fails a missing cloud through silhouette mismatch', () => {
    const reference = rgba(Array(20).fill(0.8));
    const candidate = rgba(Array(20).fill(1));
    const metrics = compareOpticalImages(reference, candidate, 4, 5);
    expect(metrics.referenceSupportCount).toBe(20);
    expect(metrics.candidateSupportCount).toBe(0);
    expect(metrics.silhouetteMismatchFraction).toBe(1);
    const evaluation = evaluateOpticalMetrics(metrics);
    expect(evaluation).toMatchObject({ passed: false, inconclusive: false });
    expect(evaluation.reasons.some((reason) => reason.includes('silhouetteMismatchFraction'))).toBe(true);
  });

  it('treats a candidate-only cloud as a definite cloud-match failure', () => {
    const metrics = compareOpticalImages(rgba([1, 1, 1, 1]), rgba([0.8, 1, 1, 1]), 2, 2);
    expect(metrics.referenceSupportCount).toBe(0);
    expect(metrics.candidateSupportCount).toBe(1);
    expect(evaluateOpticalMetrics(metrics)).toEqual({
      passed: false,
      inconclusive: false,
      reasons: ['Candidate contains cloud support where the reference is empty.'],
    });
  });

  it('reports brightness and integrated-opacity differences', () => {
    const reference = rgba(Array(20).fill(0.5));
    const candidate = rgba(Array(20).fill(0.55));
    const metrics = compareOpticalImages(reference, candidate, 4, 5);
    expect(metrics.maxAbsT).toBeCloseTo(0.05);
    expect(metrics.referenceIntegratedOpacity).toBeCloseTo(10);
    expect(metrics.candidateIntegratedOpacity).toBeCloseTo(9);
    expect(metrics.opacityRelativeError).toBeCloseTo(0.1);
    expect(evaluateOpticalMetrics(metrics).passed).toBe(false);
  });

  it('rejects malformed shape and nonphysical alpha values', () => {
    expect(() => compareOpticalImages(rgba([1]), rgba([1]), 2, 1)).toThrow(/exactly 8/);
    const nan = rgba([1]); nan[3] = Number.NaN;
    expect(() => compareOpticalImages(nan, rgba([1]), 1, 1)).toThrow(/finite/);
    const outside = rgba([1.1]);
    expect(() => compareOpticalImages(outside, rgba([1]), 1, 1)).toThrow(/outside/);
  });
});
