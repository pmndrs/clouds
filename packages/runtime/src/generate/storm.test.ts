import { describe, expect, it } from 'vitest';
import { stormCellState } from './weather';

// The TS mirror of the generator's storm life cycle (shaders.ts stormField); the storm demo places lightning with it.
describe('stormCellState', () => {
  it('grows from a small cumulus to a mature tower with an anvil, then the tower dies before the anvil', () => {
    const young = stormCellState(0.05);
    expect(young.radiusScale).toBeGreaterThan(0.4);
    expect(young.radiusScale).toBeLessThan(0.5);
    expect(young.anvilEnvelope).toBe(0);
    const mature = stormCellState(1);
    expect(mature.heightScale).toBeCloseTo(1, 5);
    expect(mature.radiusScale).toBeCloseTo(1, 5);
    expect(mature.anvilEnvelope).toBe(1);
    expect(mature.anvilSpread).toBeGreaterThan(0.9);
    const old = stormCellState(3);
    expect(old.towerEnvelope).toBe(0);
    expect(old.heightScale).toBe(0);
    expect(old.anvilEnvelope).toBeGreaterThan(0);
    expect(stormCellState(3.7).anvilEnvelope).toBe(0);
  });
  it('has no jumps', () => {
    let prev = stormCellState(0);
    for (let ph = 0.01; ph <= 4; ph += 0.01) {
      const s = stormCellState(ph);
      for (const k of Object.keys(s) as (keyof typeof s)[]) expect(Math.abs(s[k] - prev[k])).toBeLessThan(0.3);   // the steepest designed ramp (tower onset over 6 percent of grow) is 0.25 per step
      prev = s;
    }
  });
});
