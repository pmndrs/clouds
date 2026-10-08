import { describe, expect, it } from 'vitest';
import { createFlightClock } from './playback';

describe('cloudscape playback', () => {
  it.each([60, 120, 144, 240])('keeps real-time speed with a quantized slider at %i Hz', hz => {
    const clock = createFlightClock();
    let displayedTime = 0;
    for (let frame = 0; frame < hz * 5; frame++) {
      const time = clock.advance(1000 / hz);
      displayedTime = Math.round(time / 0.02) * 0.02;
    }
    expect(clock.time).toBeCloseTo(5, 9);
    expect(displayedTime).toBe(5);
  });

  it('seeks, limits background jumps and stops at the end', () => {
    const clock = createFlightClock();
    clock.seek(12);
    expect(clock.advance(60_000)).toBeCloseTo(12.1);
    clock.seek(39.99);
    expect(clock.advance(20)).toBe(40);
    expect(clock.advance(20)).toBe(40);
    clock.seek(0);
    expect(clock.advance(1000 / 144)).toBeGreaterThan(0);
  });
});
