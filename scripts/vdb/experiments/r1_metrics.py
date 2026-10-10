#!/usr/bin/env python3
"""R1 image measures on detail.jpg (20 deg framing), rough proxies for the owner's material / cohesion axes.

  python3 scripts/vdb/experiments/r1_metrics.py label=DIR [label=DIR ...]

- cover: share of the frame that is cloud (B - R < 55 on 0..255; the clear sky here is B - R ~ 100).
- edge: silhouette crispness, mean |grad L| on the mask boundary / (cloud p50 L - sky L); higher = crisper.
- mid/low: band-pass luminance energy inside the cloud at lobe scale (sigma 3..12 px) over body scale (12..48 px);
  higher = more separate small lobes ('blobs of blobs').
- belly B/R: blue/red ratio of the darkest 20 % of cloud pixels (shade colour; ~1.2 = grey, sky ~2).
- lit:belly: luminance p95 / p20 inside the cloud.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def _box(a, r, axis):
    c = np.cumsum(np.pad(a, [(r + 1, r) if i == axis else (0, 0) for i in range(a.ndim)], mode='edge'), axis=axis)
    n = a.shape[axis]
    return (np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis) - np.take(c, np.arange(0, n), axis=axis)) / (2 * r + 1)


def blur(a, s):
    """Gaussian approximated by three box passes per axis."""
    r = max(1, int(round((np.sqrt(4 * s * s + 1) - 1) / 2)))
    a = a.astype(np.float32)
    for axis in (0, 1):
        for _ in range(3):
            a = _box(a, r, axis)
    return a


def measure(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    L = 0.2126 * R + 0.7152 * G + 0.0722 * B
    m = (B - R) < 55
    sky = ~m
    skyL = float(np.median(L[sky])) if sky.any() else 0
    cl = float(np.median(L[m]))
    gy, gx = np.gradient(L)
    g = np.hypot(gx, gy)
    mi = m.astype(np.uint8)
    bnd = (mi != np.roll(mi, 1, 0)) | (mi != np.roll(mi, 1, 1))
    bnd[:2, :] = bnd[:, :2] = bnd[-2:, :] = bnd[:, -2:] = False
    edge = float(g[bnd].mean() / max(cl - skyL, 1))
    inner = blur(mi.astype(np.float32), 6) > 0.999
    b3, b12, b48 = blur(L, 3), blur(L, 12), blur(L, 48)
    mid = float(((b3 - b12)[inner] ** 2).mean())
    low = float(((b12 - b48)[inner] ** 2).mean())
    Lc = L[m]
    dark = m & (L <= np.percentile(Lc, 20))
    belly = float(B[dark].mean() / max(R[dark].mean(), 1))
    return {'cover': round(float(m.mean()), 3), 'edge': round(edge, 3), 'mid/low': round(mid / max(low, 1e-6), 3),
            'belly B/R': round(belly, 2), 'lit:belly': round(float(np.percentile(Lc, 95) / max(np.percentile(Lc, 20), 1)), 2)}


if __name__ == '__main__':
    for arg in sys.argv[1:]:
        label, _, d = arg.partition('=')
        p = Path(d)
        print(f'{label:24s}', measure(p / 'detail.jpg' if p.is_dir() else p))
