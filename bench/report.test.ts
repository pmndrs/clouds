import { describe, expect, it } from 'vitest';
import { exportBenchmarkReport } from './report';

describe('benchmark report export', () => {
  it('serializes the schema and preserves explicit CPU submission labeling', () => {
    const json = exportBenchmarkReport({ schemaVersion: 1, generatedAt: '2026-09-16T00:00:00.000Z', runtime: { browser: 'test' }, device: { backend: 'webgpu' }, resolutions: { render: [640, 360], output: [1280, 720] }, errors: [], tests: [{ name: 'smoke', passed: true }], metrics: { sampleCount: 1, warmupFrames: 0, cpuSubmitMs: { p50: 1, p95: 1 } } });
    expect(JSON.parse(json)).toMatchObject({ schemaVersion: 1, metrics: { cpuSubmitMs: { p50: 1 } } });
    expect(json).toContain('cpuSubmitMs');
  });
});
