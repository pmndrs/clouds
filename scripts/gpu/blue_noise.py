#!/usr/bin/env python3
"""Blue-noise mask for the march jitter (D1 round 5): void-and-cluster (Ulichney 1993) with a wrapped Gaussian energy, FFT-based.

Writes packages/runtime/src/blue-noise.ts: a base64 string of N*N bytes (rank / (N*N), 8-bit, toroidal). The march reads texel (px mod N)
and adds the golden-ratio sequence per frame, so each pixel's jitter over frames is a 1D low-discrepancy sequence whose per-pixel offset
is blue noise: the exponential temporal resolve's residual is then a high-frequency pattern (invisible) instead of the interleaved-gradient
noise's diagonal whorls (the "fingerprint" contours of rounds 3-4).

  python3 scripts/gpu/blue_noise.py [--size 128] [--sigma 1.9] [--out packages/runtime/src/blue-noise.ts]
"""
import argparse, base64, os
import numpy as np


def energy_kernel(n, sigma):
    y, x = np.mgrid[0:n, 0:n]
    dx = np.minimum(x, n - x); dy = np.minimum(y, n - y)
    return np.exp(-(dx * dx + dy * dy) / (2.0 * sigma * sigma))


def void_and_cluster(n, sigma, seed=7):
    rng = np.random.default_rng(seed)
    kf = np.fft.rfft2(energy_kernel(n, sigma))
    energy = lambda m: np.fft.irfft2(np.fft.rfft2(m.astype(np.float64)) * kf, s=(n, n))
    # Initial binary pattern: 1/10 of the texels, then relax by moving the tightest cluster to the largest void until stable.
    count = n * n // 10
    m = np.zeros((n, n), bool)
    idx = rng.choice(n * n, count, replace=False); m.flat[idx] = True
    for _ in range(10000):
        e = energy(m)
        c = np.argmax(np.where(m, e, -np.inf)); m.flat[c] = False
        e = energy(m)
        v = np.argmin(np.where(m, np.inf, e))
        m.flat[v] = True
        if v == c: break
    rank = np.zeros((n, n), np.int64)
    # Phase 1: remove the tightest cluster, ranks count - 1 .. 0.
    p1 = m.copy(); r = count
    while p1.any():
        e = energy(p1); c = np.argmax(np.where(p1, e, -np.inf)); p1.flat[c] = False; r -= 1; rank.flat[c] = r
    # Phase 2: fill the largest void, ranks count .. n*n - 1 (the second half is done on the inverse, as Ulichney does).
    p2 = m.copy(); r = count
    half = n * n // 2
    while r < half:
        e = energy(p2); v = np.argmin(np.where(p2, np.inf, e)); p2.flat[v] = True; rank.flat[v] = r; r += 1
    inv = ~p2
    while r < n * n:
        e = energy(inv); c = np.argmax(np.where(inv, e, -np.inf)); inv.flat[c] = False; rank.flat[c] = r; r += 1
    return rank


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--size', type=int, default=128); ap.add_argument('--sigma', type=float, default=1.9)
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', '..', 'packages', 'runtime', 'src', 'blue-noise.ts'))
    a = ap.parse_args()
    n = a.size
    rank = void_and_cluster(n, a.sigma)
    assert sorted(rank.ravel().tolist()) == list(range(n * n))
    data = (rank * 256 // (n * n)).astype(np.uint8)
    # Spectrum check: the radial power should be low at low frequencies.
    f = np.abs(np.fft.fftshift(np.fft.fft2(data / 255.0 - (data / 255.0).mean()))) ** 2
    y, x = np.mgrid[0:n, 0:n]; rr = np.hypot(x - n // 2, y - n // 2)
    low = f[rr < n / 16].mean(); high = f[(rr > n / 4) & (rr < n / 2)].mean()
    b64 = base64.b64encode(data.tobytes()).decode()
    with open(a.out, 'w') as fh:
        fh.write(f'''/** D1 round 5: a {n}x{n} blue-noise mask (void-and-cluster, scripts/gpu/blue_noise.py; toroidal, 8-bit ranks) for the march jitter. */
export const BLUE_NOISE_SIZE = {n};
const BLUE_NOISE_B64 = '{b64}';
let cached: Uint8Array<ArrayBuffer> | null = null;
/** The mask as {n}*{n} bytes, row-major. */
export function blueNoiseBytes(): Uint8Array<ArrayBuffer> {{
  if (cached) return cached;
  const s = atob(BLUE_NOISE_B64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return (cached = out);
}}
''')
    print(f'{n}x{n} sigma {a.sigma}: low/high radial power {low / high:.4f} -> {a.out}')


if __name__ == '__main__':
    main()
