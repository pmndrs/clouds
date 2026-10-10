import { describe, expect, it } from 'vitest';
import { blueNoiseBytes, BLUE_NOISE_SIZE } from './blue-noise';

describe('blue-noise mask (D1 round 5 march jitter)', () => {
  it('is a full 8-bit rank mask: every value equally often', () => {
    const b = blueNoiseBytes();
    expect(b.length).toBe(BLUE_NOISE_SIZE * BLUE_NOISE_SIZE);
    const hist = new Array<number>(256).fill(0);
    for (const v of b) hist[v]++;
    expect(Math.min(...hist)).toBe(BLUE_NOISE_SIZE * BLUE_NOISE_SIZE / 256);
    expect(Math.max(...hist)).toBe(BLUE_NOISE_SIZE * BLUE_NOISE_SIZE / 256);
  });
  it('has little low-frequency energy: 8x8 block means stay within 12 levels of the mean (white noise: std 9, worst of 256 blocks about 28)', () => {
    const b = blueNoiseBytes(), n = BLUE_NOISE_SIZE;
    let worst = 0;
    for (let by = 0; by < n; by += 8) for (let bx = 0; bx < n; bx += 8) {
      let sum = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) sum += b[(by + y) * n + bx + x];
      worst = Math.max(worst, Math.abs(sum / 64 - 127.5));
    }
    expect(worst).toBeLessThan(12);
  });
});
