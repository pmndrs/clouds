import { describe, expect, it } from 'vitest';

import { resetKeyChanged, resolveDeltaTime } from './adapter';

describe('reconstruction adapter frame helpers', () => {
  it('resets only when an established reset key changes', () => {
    expect(resetKeyChanged(undefined, 'main-camera')).toBe(false);
    expect(resetKeyChanged('main-camera', 'main-camera')).toBe(false);
    expect(resetKeyChanged('main-camera', 'capture-camera')).toBe(true);
    expect(resetKeyChanged(1, 2)).toBe(true);
  });

  it('uses an explicit bounded delta and derives one from simulation time', () => {
    expect(resolveDeltaTime(undefined, undefined, undefined)).toBeCloseTo(1 / 60);
    expect(resolveDeltaTime(10, 10.25, undefined)).toBe(0.1);
    expect(resolveDeltaTime(10, 9, undefined)).toBe(0);
    expect(resolveDeltaTime(10, 12, 0.016)).toBe(0.016);
    expect(resolveDeltaTime(10, 12, 1)).toBe(0.1);
  });
});
