/**
 * Metrics for comparing two RGBA optical readbacks. Alpha is transmittance;
 * RGB is intentionally ignored because this audit is about visibility.
 */

export interface OpticalMetricGates {
  readonly maxAbsT: number;
  readonly supportMeanAbsT: number;
  readonly silhouetteMismatchFraction: number;
  readonly opacityRelativeError: number;
  readonly minimumReferenceSupport: number;
}

export const DEFAULT_OPTICAL_GATES: OpticalMetricGates = {
  maxAbsT: 0.02,
  supportMeanAbsT: 0.005,
  silhouetteMismatchFraction: 0.05,
  opacityRelativeError: 0.03,
  minimumReferenceSupport: 16,
} as const;

export const IMAGE_METRIC_TRANSMITTANCE_TOLERANCE = 1e-6;
const SUPPORT_OPACITY_THRESHOLD = 0.01;

export type OpticalImageMetrics = {
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly unionSupportCount: number;
  readonly maxAbsT: number;
  /** Mean absolute transmittance error over every image pixel. */
  readonly meanAbsT: number;
  /** Mean absolute transmittance error over the reference/candidate support union. */
  readonly supportMeanAbsT: number;
  readonly p95AbsT: number;
  readonly referenceSupportCount: number;
  readonly candidateSupportCount: number;
  readonly supportSymmetricDifferenceCount: number;
  readonly silhouetteMismatchFraction: number;
  readonly referenceIntegratedOpacity: number;
  readonly candidateIntegratedOpacity: number;
  readonly opacityRelativeError: number;
  readonly referenceEmpty: boolean;
  readonly candidateEmpty: boolean;
};

export type OpticalMetricEvaluation = {
  readonly passed: boolean;
  readonly inconclusive: boolean;
  readonly reasons: readonly string[];
};

function validateDimensions(width: number, height: number): number {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new RangeError('Image dimensions must be positive safe integers.');
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels)) throw new RangeError('Image dimensions are too large.');
  return pixels;
}

function readTransmittance(image: Float32Array, pixel: number): number {
  const value = image[pixel * 4 + 3];
  if (!Number.isFinite(value)) throw new RangeError(`Transmittance at pixel ${pixel} must be finite.`);
  if (value < -IMAGE_METRIC_TRANSMITTANCE_TOLERANCE || value > 1 + IMAGE_METRIC_TRANSMITTANCE_TOLERANCE) {
    throw new RangeError(`Transmittance at pixel ${pixel} is outside [0, 1].`);
  }
  // Tiny quantization excursions are physical roundoff; larger excursions
  // were rejected above rather than silently hidden.
  return Math.max(0, Math.min(1, value));
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * 0.95;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Compare alpha channels from two RGBA Float32Array optical readbacks. */
export function compareOpticalImages(
  reference: Float32Array,
  candidate: Float32Array,
  width: number,
  height: number,
): OpticalImageMetrics {
  const pixelCount = validateDimensions(width, height);
  if (!(reference instanceof Float32Array) || !(candidate instanceof Float32Array)) {
    throw new TypeError('Optical readbacks must be Float32Array values.');
  }
  const expectedLength = pixelCount * 4;
  if (reference.length !== expectedLength || candidate.length !== expectedLength) {
    throw new RangeError(`Optical readbacks must contain exactly ${expectedLength} RGBA values.`);
  }

  let maxAbsT = 0;
  let sumAllAbsT = 0;
  let sumAbsT = 0;
  let referenceSupportCount = 0;
  let candidateSupportCount = 0;
  let supportSymmetricDifferenceCount = 0;
  let referenceIntegratedOpacity = 0;
  let candidateIntegratedOpacity = 0;
  const unionErrors: number[] = [];

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const referenceT = readTransmittance(reference, pixel);
    const candidateT = readTransmittance(candidate, pixel);
    const referenceOpacity = 1 - referenceT;
    const candidateOpacity = 1 - candidateT;
    const referenceSupport = referenceOpacity > SUPPORT_OPACITY_THRESHOLD;
    const candidateSupport = candidateOpacity > SUPPORT_OPACITY_THRESHOLD;
    const error = Math.abs(candidateT - referenceT);
    sumAllAbsT += error;
    if (error > maxAbsT) maxAbsT = error;
    referenceIntegratedOpacity += referenceOpacity;
    candidateIntegratedOpacity += candidateOpacity;
    if (referenceSupport) referenceSupportCount++;
    if (candidateSupport) candidateSupportCount++;
    if (referenceSupport !== candidateSupport) supportSymmetricDifferenceCount++;
    if (referenceSupport || candidateSupport) {
      unionErrors.push(error);
      sumAbsT += error;
    }
  }

  const unionSupportCount = unionErrors.length;
  const opacityDenominator = Math.abs(referenceIntegratedOpacity);
  const opacityRelativeError = opacityDenominator === 0
    ? (candidateIntegratedOpacity === 0 ? 0 : Infinity)
    : Math.abs(candidateIntegratedOpacity - referenceIntegratedOpacity) / opacityDenominator;
  return {
    width,
    height,
    pixelCount,
    unionSupportCount,
    maxAbsT,
    meanAbsT: sumAllAbsT / pixelCount,
    supportMeanAbsT: unionSupportCount === 0 ? 0 : sumAbsT / unionSupportCount,
    p95AbsT: percentile95(unionErrors),
    referenceSupportCount,
    candidateSupportCount,
    supportSymmetricDifferenceCount,
    silhouetteMismatchFraction: unionSupportCount === 0 ? 0 : supportSymmetricDifferenceCount / unionSupportCount,
    referenceIntegratedOpacity,
    candidateIntegratedOpacity,
    opacityRelativeError,
    referenceEmpty: referenceSupportCount === 0,
    candidateEmpty: candidateSupportCount === 0,
  };
}

/** Apply the provisional engineering gates to a previously computed metric set. */
export function evaluateOpticalMetrics(
  metrics: OpticalImageMetrics,
  gates: OpticalMetricGates = DEFAULT_OPTICAL_GATES,
): OpticalMetricEvaluation {
  const reasons: string[] = [];
  if (metrics.referenceEmpty && metrics.candidateEmpty) {
    return { passed: false, inconclusive: true, reasons: ['Reference and candidate contain no cloud support; visibility quality is inconclusive.'] };
  }
  // A candidate-only cloud is a definite mismatch even though reference support
  // is too small to support the other quality claims.
  if (metrics.referenceEmpty && !metrics.candidateEmpty) {
    return { passed: false, inconclusive: false, reasons: ['Candidate contains cloud support where the reference is empty.'] };
  }
  if (metrics.referenceSupportCount < gates.minimumReferenceSupport) {
    return { passed: false, inconclusive: true, reasons: [`Reference support (${metrics.referenceSupportCount}) is below the minimum of ${gates.minimumReferenceSupport}.`] };
  }
  if (metrics.maxAbsT > gates.maxAbsT) reasons.push(`maxAbsT ${metrics.maxAbsT} exceeds ${gates.maxAbsT}.`);
  if (metrics.supportMeanAbsT > gates.supportMeanAbsT) reasons.push(`supportMeanAbsT ${metrics.supportMeanAbsT} exceeds ${gates.supportMeanAbsT}.`);
  if (metrics.silhouetteMismatchFraction > gates.silhouetteMismatchFraction) reasons.push(`silhouetteMismatchFraction ${metrics.silhouetteMismatchFraction} exceeds ${gates.silhouetteMismatchFraction}.`);
  if (metrics.opacityRelativeError > gates.opacityRelativeError) reasons.push(`opacityRelativeError ${metrics.opacityRelativeError} exceeds ${gates.opacityRelativeError}.`);
  return { passed: reasons.length === 0, inconclusive: false, reasons };
}
