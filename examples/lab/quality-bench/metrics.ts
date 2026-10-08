export interface FrameMetrics {
  mae: number;
  p95: number;
  max: number;
  cloudPixels: number;
}

export interface MotionMetrics extends FrameMetrics {
  frames: number;
  temporalMae: number;
  temporalP95: number;
  worstFrameMae: number;
  elapsedMs: number;
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))];
}

/** Compares display-space RGB only where either image contains cloud opacity. */
export function compareFrames(candidate: Float32Array, reference: Float32Array): FrameMetrics {
  const errors: number[] = [];
  let sum = 0;
  for (let i = 0; i < candidate.length; i += 4) {
    if (candidate[i + 3] < 1e-3 && reference[i + 3] < 1e-3) continue;
    const error = Math.max(
      Math.abs(candidate[i] - reference[i]),
      Math.abs(candidate[i + 1] - reference[i + 1]),
      Math.abs(candidate[i + 2] - reference[i + 2]),
    );
    sum += error;
    errors.push(error);
  }
  return {
    mae: errors.length ? sum / errors.length : 0,
    p95: percentile(errors, 0.95),
    max: percentile(errors, 1),
    cloudPixels: errors.length,
  };
}

/**
 * Measures excess frame-to-frame change against the moving reference. This is
 * intentionally motion-aware: ordinary camera motion present in both images
 * cancels, while sample-lattice popping and shimmer remain in the residual.
 */
export function compareTemporalResidual(
  candidate: Float32Array,
  previousCandidate: Float32Array,
  reference: Float32Array,
  previousReference: Float32Array,
) {
  const errors: number[] = [];
  let sum = 0;
  for (let i = 0; i < candidate.length; i += 4) {
    if (candidate[i + 3] < 1e-3 && reference[i + 3] < 1e-3 && previousCandidate[i + 3] < 1e-3 && previousReference[i + 3] < 1e-3) continue;
    let error = 0;
    for (let channel = 0; channel < 3; channel++) {
      const candidateDelta = candidate[i + channel] - previousCandidate[i + channel];
      const referenceDelta = reference[i + channel] - previousReference[i + channel];
      error = Math.max(error, Math.abs(candidateDelta - referenceDelta));
    }
    sum += error;
    errors.push(error);
  }
  return { mean: errors.length ? sum / errors.length : 0, p95: percentile(errors, 0.95) };
}

export function summarizeMotion(
  frames: FrameMetrics[],
  temporal: { mean: number; p95: number }[],
  elapsedMs: number,
): MotionMetrics {
  const weightedPixels = frames.reduce((sum, frame) => sum + frame.cloudPixels, 0);
  const temporalP95 = temporal.map(value => value.p95);
  return {
    frames: frames.length,
    mae: weightedPixels ? frames.reduce((sum, frame) => sum + frame.mae * frame.cloudPixels, 0) / weightedPixels : 0,
    p95: percentile(frames.map(frame => frame.p95), 0.95),
    max: Math.max(0, ...frames.map(frame => frame.max)),
    cloudPixels: Math.round(weightedPixels / Math.max(1, frames.length)),
    temporalMae: temporal.length ? temporal.reduce((sum, value) => sum + value.mean, 0) / temporal.length : 0,
    temporalP95: percentile(temporalP95, 0.95),
    worstFrameMae: Math.max(0, ...frames.map(frame => frame.mae)),
    elapsedMs,
  };
}
