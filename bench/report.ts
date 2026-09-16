import type { MetricSummary } from './metrics';

export interface BenchmarkReport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly runtime: { readonly browser?: string; readonly browserVersion?: string; readonly os?: string; readonly appVersion?: string; readonly contractVersion?: number };
  readonly device: { readonly vendor?: string; readonly architecture?: string; readonly description?: string; readonly backend?: string; readonly limits?: Record<string, number> };
  readonly resolutions: { readonly render: readonly [number, number]; readonly output: readonly [number, number] };
  readonly errors: readonly string[];
  readonly tests: readonly { readonly name: string; readonly passed: boolean; readonly details?: string }[];
  readonly metrics: MetricSummary;
}

export function exportBenchmarkReport(report: BenchmarkReport): string {
  if (report.schemaVersion !== 1) throw new Error('Unsupported benchmark report schema');
  if (!report.generatedAt || !report.metrics || report.errors.some(error => typeof error !== 'string')) throw new Error('Invalid benchmark report');
  return JSON.stringify(report, null, 2);
}
