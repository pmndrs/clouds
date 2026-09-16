export interface FrameMetrics {
  readonly frameIndex: number;
  readonly timeSeconds: number;
  /** CPU time spent submitting the frame. This is never GPU time. */
  readonly cpuSubmitMs: number;
  /** GPU timestamp duration, when supported by the runtime. */
  readonly gpuMs?: number;
  readonly cpuFrameMs?: number;
}

export interface MetricSummary {
  readonly sampleCount: number;
  readonly warmupFrames: number;
  readonly cpuSubmitMs: { readonly p50: number; readonly p95: number };
  readonly gpuMs?: { readonly p50: number; readonly p95: number };
  readonly cpuFrameMs?: { readonly p50: number; readonly p95: number };
}

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and nonnegative`);
}

function percentile(values: readonly number[], p: number): number {
  if (!values.length) throw new Error('Cannot summarize an empty measurement set');
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export class MeasurementCollector {
  private readonly samples: FrameMetrics[] = [];
  constructor(readonly warmupFrames = 0) {
    if (!Number.isSafeInteger(warmupFrames) || warmupFrames < 0) throw new Error('Warmup frames must be a nonnegative integer');
  }
  add(frame: FrameMetrics): void {
    if (!Number.isSafeInteger(frame.frameIndex) || frame.frameIndex < 0) throw new Error('Frame index must be a nonnegative integer');
    requireFinite(frame.timeSeconds, 'Frame time');
    requireFinite(frame.cpuSubmitMs, 'CPU submission time');
    if (frame.gpuMs !== undefined) requireFinite(frame.gpuMs, 'GPU time');
    if (frame.cpuFrameMs !== undefined) requireFinite(frame.cpuFrameMs, 'CPU frame time');
    this.samples.push({ ...frame });
  }
  get count(): number { return this.samples.length; }
  summarize(): MetricSummary {
    const measured = this.samples.slice(this.warmupFrames);
    if (!measured.length) throw new Error('No measurements remain after warmup');
    const result: MetricSummary = { sampleCount: measured.length, warmupFrames: Math.min(this.warmupFrames, this.samples.length), cpuSubmitMs: { p50: percentile(measured.map(x => x.cpuSubmitMs), .5), p95: percentile(measured.map(x => x.cpuSubmitMs), .95) } };
    const optional = (key: 'gpuMs' | 'cpuFrameMs') => measured.every(x => x[key] !== undefined) ? { p50: percentile(measured.map(x => x[key] as number), .5), p95: percentile(measured.map(x => x[key] as number), .95) } : undefined;
    return { ...result, gpuMs: optional('gpuMs'), cpuFrameMs: optional('cpuFrameMs') };
  }
  frames(): readonly FrameMetrics[] { return this.samples; }
}
