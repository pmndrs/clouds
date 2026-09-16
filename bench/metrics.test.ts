import { describe, expect, it } from 'vitest';
import { MeasurementCollector } from './metrics';

describe('measurement collector', () => {
  it('discards warmup and reports interpolated p50/p95', () => {
    const collector = new MeasurementCollector(1);
    [1, 2, 3, 4, 5].forEach((cpuSubmitMs, frameIndex) => collector.add({ frameIndex, timeSeconds: frameIndex, cpuSubmitMs, gpuMs: cpuSubmitMs * 2 }));
    expect(collector.summarize()).toEqual({ sampleCount: 4, warmupFrames: 1, cpuSubmitMs: { p50: 3.5, p95: 4.85 }, gpuMs: { p50: 7, p95: 9.7 }, cpuFrameMs: undefined });
  });
  it('rejects nonfinite measurements', () => {
    const collector = new MeasurementCollector();
    expect(() => collector.add({ frameIndex: 0, timeSeconds: 0, cpuSubmitMs: Number.NaN })).toThrow(/CPU submission/);
  });
});
