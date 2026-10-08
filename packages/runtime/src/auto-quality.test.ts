import { describe, expect, it } from 'vitest';
import { controlledCost, DynamicScale, selectTier } from './auto-quality';

describe('selectTier', () => {
  it('puts discrete desktop GPUs on high and never on ultra', () => {
    expect(selectTier({ vendor: 'nvidia', architecture: 'ada', limits: { maxTextureDimension2D: 32768, maxTextureDimension3D: 2048 }, pixels: 1920 * 1080 }).tier).toBe('high');
    expect(selectTier({ vendor: 'amd', architecture: 'rdna-3', pixels: 1920 * 1080 }).tier).toBe('high');
  });
  it('treats Apple silicon as high on a desktop and low on a phone or tablet', () => {
    expect(selectTier({ vendor: 'apple', architecture: 'metal-3', limits: { maxTextureDimension2D: 16384 }, pixels: 2560 * 1440 }).tier).toBe('high');
    expect(selectTier({ vendor: 'apple', architecture: 'metal-3', mobile: true, pixels: 1170 * 2532 }).tier).toBe('low');
  });
  it('puts mobile GPUs, software adapters and tiny 3D limits on mobile', () => {
    expect(selectTier({ vendor: 'qualcomm', architecture: 'adreno-7xx' }).tier).toBe('mobile');
    expect(selectTier({ vendor: 'arm', architecture: 'valhall' }).tier).toBe('mobile');
    expect(selectTier({ isFallback: true }).tier).toBe('mobile');
    expect(selectTier({ vendor: 'nvidia', limits: { maxTextureDimension3D: 1024 } }).tier).toBe('mobile');
  });
  it('puts integrated and old GPUs on medium and caps small texture limits at low', () => {
    expect(selectTier({ vendor: 'intel', architecture: 'gen-12lp' }).tier).toBe('medium');
    expect(selectTier({ vendor: 'nvidia', architecture: 'pascal' }).tier).toBe('medium');
    expect(selectTier({ vendor: 'nvidia', architecture: 'ampere', limits: { maxTextureDimension2D: 8192 } }).tier).toBe('low');
  });
  it('steps one tier down for very large outputs and reports why', () => {
    const base = selectTier({ vendor: 'nvidia', architecture: 'ada', pixels: 1920 * 1080 });
    const k4 = selectTier({ vendor: 'nvidia', architecture: 'ada', pixels: 3840 * 2160 });
    expect(base.tier).toBe('high');
    expect(k4.tier).toBe('medium');
    expect(k4.reasons.join(' ')).toContain('MP');
  });
  it('knows whether timestamp queries exist', () => {
    expect(selectTier({ features: ['timestamp-query'] }).timestampQuery).toBe(true);
    expect(selectTier({ features: [] }).timestampQuery).toBe(false);
  });
});

describe('controlledCost', () => {
  it('sums the scalable passes and leaves the light grid out', () => {
    expect(controlledCost({ marchNear: 1, marchFar: 0.5, composite: 0.25, lightGrid: 9, lightGridReduce: 9, other: 5 })).toBeCloseTo(1.75);
  });
});

/** Cost model: part per output pixel / fixed, part proportional to the march area, plus noise. */
function simulate(opts: { budget: number; fixed: number; variable: number; frames: number; noise?: number; start?: number; changeAt?: number; changeTo?: number; min?: number }) {
  const ctl = new DynamicScale({ budgetMs: opts.budget, minScale: opts.min ?? 0.5 });
  if (opts.start) ctl.scale = opts.start;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const trace: { scale: number; cost: number }[] = [];
  let fixed = opts.fixed, variable = opts.variable;
  for (let i = 0; i < opts.frames; i++) {
    if (opts.changeAt !== undefined && i === opts.changeAt) { fixed *= opts.changeTo!; variable *= opts.changeTo!; }
    // the readback lags the scale in effect by 2 frames
    const scaleSeen = trace.length >= 2 ? trace[trace.length - 2].scale : ctl.scale;
    const cost = (fixed + variable * scaleSeen * scaleSeen) * (1 + ((rnd() - 0.5) * 2) * (opts.noise ?? 0.05));
    ctl.update(cost);
    trace.push({ scale: ctl.scale, cost });
  }
  return { ctl, trace };
}

describe('DynamicScale', () => {
  it('converges under an over-budget cost within about two seconds (120 frames) and holds', () => {
    const { ctl, trace } = simulate({ budget: 2, fixed: 0.5, variable: 3, frames: 400 });   // full-scale cost 3.5 ms
    const settled = trace.slice(120).map(t => t.scale);
    expect(Math.max(...settled) - Math.min(...settled)).toBeLessThan(0.06);
    const cost = (0.5 + 3 * ctl.scale * ctl.scale);
    expect(cost).toBeLessThanOrEqual(2.1);
    expect(cost).toBeGreaterThan(1.5);
  });
  it('does not oscillate with a steady cost and noise', () => {
    const { ctl, trace } = simulate({ budget: 2, fixed: 0.4, variable: 2.4, frames: 1200, noise: 0.08 });
    const tail = trace.slice(300).map(t => t.scale);
    const changes = tail.filter((s, i) => i > 0 && s !== tail[i - 1]).length;
    expect(changes).toBeLessThanOrEqual(6);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(0.1);
    expect(ctl.scale).toBeGreaterThan(0.5);
  });
  it('stays at the maximum when there is headroom', () => {
    const { ctl } = simulate({ budget: 5, fixed: 0.5, variable: 2, frames: 300 });
    expect(ctl.scale).toBe(1);
  });
  it('grows back when the load falls and shrinks when it rises', () => {
    const { ctl, trace } = simulate({ budget: 2, fixed: 0.4, variable: 3, frames: 700, changeAt: 300, changeTo: 0.4 });
    expect(trace[299].scale).toBeLessThan(0.9);
    expect(ctl.scale).toBeGreaterThan(trace[299].scale);
    const up = simulate({ budget: 2, fixed: 0.2, variable: 1.2, frames: 700, changeAt: 300, changeTo: 3 });
    expect(up.trace[299].scale).toBe(1);
    expect(up.ctl.scale).toBeLessThan(1);
  });
  it('respects the scale floor and ignores missing samples', () => {
    const { ctl } = simulate({ budget: 0.5, fixed: 1, variable: 3, frames: 600 });
    expect(ctl.scale).toBe(0.5);
    const c = new DynamicScale({ budgetMs: 2 });
    for (let i = 0; i < 50; i++) c.update(NaN);
    expect(c.scale).toBe(1);
    expect(c.changes).toBe(0);
  });
  it('is not driven by single spikes or by the bimodal frame times of an idle GPU', () => {
    const c = new DynamicScale({ budgetMs: 2 });
    for (let i = 0; i < 60; i++) c.update(i === 30 ? 12 : 1.6);
    expect(c.scale).toBe(1);
    const d = new DynamicScale({ budgetMs: 2 });
    for (let i = 0; i < 600; i++) d.update(i % 3 === 0 ? 3.4 : 1.3);   // mean 2.0, median 1.3: the typical frame is well inside the budget
    expect(d.scale).toBe(1);
    expect(d.changes).toBe(0);
  });
});
