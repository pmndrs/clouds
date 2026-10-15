import { describe, expect, it } from 'vitest';
import { biasColumn, composeColumn, influence, lerpColumn, type NdfColumn } from './blend';
import { WEATHER_BY_NAME, WeatherScheduler, ease } from './states';

const gen: NdfColumn = { coverage: 0.3, topType: 0.6, bottomType: 0.4, minHeight: 0.1, maxHeight: 0.8 };
const painted: NdfColumn = { coverage: 0, topType: 1, bottomType: 0, minHeight: 0, maxHeight: 0.4 };
const gains = { coverage: 1, types: 1, heights: 1 };

describe('influence mask', () => {
  it('0 = generated, 1 = painted, between = lerp', () => {
    expect(influence(0.3, 0.9, 0)).toBe(0.3);
    expect(influence(0.3, 0.9, 1)).toBeCloseTo(0.9);
    expect(influence(0.3, 0.9, 0.5)).toBeCloseTo(0.6);
  });
  it('the gain scales the mask per field and clamps', () => {
    expect(influence(0.3, 0.9, 1, 0)).toBe(0.3);
    expect(influence(0.3, 0.9, 0.5, 2)).toBeCloseTo(0.9);
    expect(influence(0.3, 0.9, 1, 5)).toBeCloseTo(0.9);
  });
  it('influence mode with mask 0 keeps the generated column, mask 1 the painted one', () => {
    expect(composeColumn(gen, painted, 0, 'influence', gains)).toEqual(gen);
    const full = composeColumn(gen, painted, 1, 'influence', gains);
    expect(full.coverage).toBe(0); expect(full.topType).toBe(1); expect(full.maxHeight).toBeCloseTo(0.4);
  });
  it('replace mode ignores the mask (W1 behaviour)', () => {
    expect(composeColumn(gen, painted, 0, 'replace', gains)).toEqual(composeColumn(gen, painted, 1, 'influence', gains));
  });
  it('per-field gains: heights 0 leaves the generated heights, coverage painted', () => {
    const c = composeColumn(gen, painted, 1, 'influence', { coverage: 1, types: 1, heights: 0 });
    expect(c.coverage).toBe(0); expect(c.minHeight).toBe(gen.minHeight); expect(c.maxHeight).toBe(gen.maxHeight);
  });
  it('no painted map: the generated column unchanged; missing height image keeps heights', () => {
    expect(composeColumn(gen, null, 1, 'influence', gains)).toBe(gen);
    expect(composeColumn(gen, painted, 1, 'influence', gains, false).maxHeight).toBe(gen.maxHeight);
  });
  it('the top stays above the base', () => {
    const c = composeColumn(gen, { ...painted, minHeight: 0.9, maxHeight: 0.2 }, 1, 'influence', gains);
    expect(c.maxHeight).toBeGreaterThan(c.minHeight);
  });
});

describe('weather lerp', () => {
  it('biases clamp to 0..1', () => {
    expect(biasColumn(gen, 0.9, 0.9).coverage).toBe(1);
    expect(biasColumn(gen, -0.9, -0.9).topType).toBe(0);
  });
  it('lerpColumn hits both ends and the middle', () => {
    const b = { ...gen, coverage: 0.9 };
    expect(lerpColumn(gen, b, 0).coverage).toBe(0.3);
    expect(lerpColumn(gen, b, 1).coverage).toBeCloseTo(0.9);
    expect(lerpColumn(gen, b, 0.5).coverage).toBeCloseTo(0.6);
  });
  it('ease is monotone with zero slope at the ends', () => {
    let prev = 0;
    for (let i = 1; i <= 100; i++) { const e = ease(i / 100); expect(e).toBeGreaterThanOrEqual(prev); prev = e; }
    expect(ease(0.001)).toBeLessThan(1e-6 * 20);
    expect(ease(1)).toBe(1);
  });
  it('the largest per-step change of a 20 s transition at 60 fps is below one 8-bit step of the bias', () => {
    const s = new WeatherScheduler(WEATHER_BY_NAME.clear);
    s.go(WEATHER_BY_NAME.overcast, 20);
    let prev = s.frame().coverageBias, worst = 0;
    for (let i = 0; i < 20 * 60; i++) { s.update(1 / 60); const v = s.frame().coverageBias; worst = Math.max(worst, Math.abs(v - prev)); prev = v; }
    expect(worst).toBeLessThan(1 / 255);
    expect(prev).toBeCloseTo(WEATHER_BY_NAME.overcast.coverageBias);
  });
});

describe('scheduler', () => {
  it('queues a go during a transition and starts it after', () => {
    const s = new WeatherScheduler(WEATHER_BY_NAME.clear);
    s.go(WEATHER_BY_NAME.cumulus, 10); s.go(WEATHER_BY_NAME.overcast, 10);
    for (let i = 0; i < 10; i++) s.update(1.01);
    expect(s.to).toBe(WEATHER_BY_NAME.overcast); expect(s.from).toBe(WEATHER_BY_NAME.cumulus);
  });
  it('the auto cycle moves on after the hold', () => {
    const s = new WeatherScheduler(WEATHER_BY_NAME.clear); s.auto = true; s.hold = 5; s.duration = 4;
    s.update(5.1);
    expect(s.moving).toBe(true); expect(s.to.name).not.toBe('clear');
  });
});
