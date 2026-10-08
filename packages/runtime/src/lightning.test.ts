import { describe, expect, it } from 'vitest';
import { createLightning, flashEnvelope, strokeProfile } from './lightning';

describe('lightning', () => {
  it('has 2-4 strokes over the flash and an envelope that dies by the end', () => {
    for (let seed = 1; seed < 20; seed++) {
      const s = strokeProfile(0.3, seed);
      expect(s.length).toBeGreaterThanOrEqual(2);
      expect(s.length).toBeLessThanOrEqual(4);
      expect(s[s.length - 1].at).toBeLessThan(0.3);
      expect(flashEnvelope(s, 0.3, 0.31)).toBe(0);
      expect(Math.max(...Array.from({ length: 300 }, (_, i) => flashEnvelope(s, 0.3, i * 0.001)))).toBeGreaterThan(0.5);
    }
  });
  it('reports nothing when idle and expires a flash after its duration', () => {
    const l = createLightning();
    expect(l.update(0)).toBeNull();
    l.flash({ position: [1, 2, 3], duration: 0.3 });
    l.update(1);
    expect(l.update(1.02)).not.toBeNull();
    expect(l.update(1.5)).toBeNull();
    expect(l.active).toBe(0);
  });
  it('generates automatic flashes inside the region at the given rate', () => {
    const l = createLightning();
    l.settings.rate = 5;
    l.settings.region = { center: [0, 100, 0], radius: 50, height: 200 };
    let hits = 0;
    for (let i = 0; i < 600; i++) {
      const f = l.update(i / 60);
      if (f) { hits++; expect(Math.hypot(f.position[0], f.position[2])).toBeLessThanOrEqual(50.001); expect(f.position[1]).toBeGreaterThanOrEqual(100); }
    }
    expect(hits).toBeGreaterThan(30);
  });
});
