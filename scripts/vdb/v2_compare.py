#!/usr/bin/env python3
"""V2: sheets and image metrics for the direct VDB renders against the C1 (NVDF chain) renders and the V1 Karma frames.

  python3 scripts/vdb/v2_compare.py --karma artifacts/research/v1-reference/<tag>/jpg [--clouds 02,09]

Reads <root>/<variant>-<cloud>/<view>.jpg (capture.mjs output; root default artifacts/research/v2-direct in the main checkout) for the
variants below and <karma>/cloudpack-<cloud>-<view>.jpg. Writes <root>/sheets/v2-<cloud>.jpg (rows photo/detail, columns = variants then
Karma) and <root>/metrics.json. Everything it writes contains third-party-derived pixels: keep it local (artifacts/ is gitignored).

Cloud mask: our frames differ from the cloudless plate <root>/sky-<cloud>/<view>.jpg (the direct asset at directDensity 0) by more than
3/255 in luma or colour; the Karma frame from a quadratic sky fitted (per channel) to its pixels outside our dilated mask.
Metrics (all relative to the clear sky of the same frame, so a different sky model or exposure cancels to first order):
  cover    share of pixels that are cloud
  iou      silhouette overlap with the Karma frame
  lit      95th percentile cloud luma / sky luma;  shade  10th percentile / sky;  mean  mean / sky
  shadeBR  blue / red of the darkest 10% of cloud pixels (1 = neutral grey, > 1 = blue shade)
  edge     mean |gradient| of luma on the silhouette band / (lit - shade): crispness of the outline
  luma50   M1: median cloud luma, absolute (display sRGB 0..1, as V1's "median 0.90 vs Karma 0.64-0.76")
  midBR    M1: blue / red of the cloud pixels between the 10th and 50th luma percentile (the shaded body, not only the darkest creases)

M1: --variants picks the columns (`id` or `id:label`, comma separated; default the V2 set) and --tag names the sheets
(<root>/sheets/<tag>-<cloud>.jpg) and the metrics file (<root>/metrics-<tag>.json; the V2 defaults keep v2 / metrics.json).
"""
import argparse
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
MAIN = os.path.abspath(os.path.join(REPO, '..', '..', '..')) if '.claude/worktrees' in REPO else REPO
VARIANTS = [('c1', 'C1 NVDF chain'), ('dn', 'direct, nubis light'), ('dk', 'direct, nubis, Karma HG'), ('du', 'direct, ultra, Karma HG'), ('do', 'direct, octave light')]
SKY = (40, 40, 240, 240)   # clear-sky patch at 1920x1080 (upper left, sun side), as V1's exposure fit
SIZE = (1920, 1080)


def load(path):
    return np.asarray(Image.open(path).convert('RGB').resize(SIZE, Image.LANCZOS), dtype=np.float32) / 255.0


def plate_mask(img, plate):
    return np.abs(img - plate).max(-1) > 3.0 / 255


def fit_sky(img, outside):
    """Quadratic in (x, y) per channel, least squares over the pixels in `outside`, evaluated everywhere."""
    h, w = img.shape[:2]
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    x, y = x / w - 0.5, y / h - 0.5
    basis = np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], -1)
    sel = outside[::4, ::4]
    A = basis[::4, ::4][sel]
    out = np.empty_like(img)
    for ch in range(3):
        coef = np.linalg.lstsq(A, img[::4, ::4, ch][sel], rcond=None)[0]
        out[..., ch] = basis @ coef
    return out


def dilate(mask, r):
    m = mask.copy()
    for _ in range(r):
        m = m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)
    return m


def metrics(img, mask, ref_mask=None):
    luma = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    x0, y0, x1, y1 = SKY
    sky_l = float(luma[y0:y1, x0:x1].mean())
    m = {'cover': float(mask.mean())}
    if mask.sum() < 100:
        return m, mask
    v = luma[mask]
    lo = np.percentile(v, 10)
    dark = mask & (luma <= lo)
    lit, shade = float(np.percentile(v, 95) / sky_l), float(lo / sky_l)
    gy, gx = np.gradient(luma)
    band = (mask ^ np.roll(mask, 1, 0)) | (mask ^ np.roll(mask, 1, 1))
    band[0, :] = band[:, 0] = False
    mid = mask & (luma > lo) & (luma <= np.percentile(v, 50))
    m.update({'lit': lit, 'shade': shade, 'mean': float(v.mean() / sky_l), 'luma50': float(np.median(v)),
              'midBR': float(img[mid][:, 2].mean() / max(img[mid][:, 0].mean(), 1e-4)) if mid.any() else 0.0,
              'shadeBR': float(img[dark][:, 2].mean() / max(img[dark][:, 0].mean(), 1e-4)),
              'edge': float(np.hypot(gx, gy)[band].mean() * 100 / max((lit - shade) * sky_l, 1e-3))})
    if ref_mask is not None:
        m['iou'] = float((mask & ref_mask).sum() / max((mask | ref_mask).sum(), 1))
    return m, mask


def sheet(rows, out, w=640):
    h = w * 9 // 16
    ncol = max(len(r) for r in rows)
    s = Image.new('RGB', (w * ncol, h * len(rows)), (20, 20, 20))
    d = ImageDraw.Draw(s)
    try:
        f = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 20)
    except OSError:
        f = None
    for j, r in enumerate(rows):
        for i, (label, path) in enumerate(r):
            if path and os.path.exists(path):
                s.paste(Image.open(path).convert('RGB').resize((w, h), Image.LANCZOS), (i * w, j * h))
            else:
                d.text((i * w + 10, j * h + h // 2), 'missing', fill=(220, 90, 90), font=f)
            d.rectangle([i * w, j * h, i * w + 11 * len(label) + 12, j * h + 28], fill=(0, 0, 0))
            d.text((i * w + 6, j * h + 4), label, fill=(255, 255, 255), font=f)
    s.save(out, quality=90)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--root', default=os.path.join(MAIN, 'artifacts', 'research', 'v2-direct'))
    p.add_argument('--karma', help='folder of V1 tone-mapped Karma frames (cloudpack-<cloud>-<view>.jpg)')
    p.add_argument('--clouds', default='02,09')
    p.add_argument('--variants', help='M1: columns, `id` or `id:label`, comma separated (default: the V2 set)')
    p.add_argument('--tag', default='v2', help='M1: sheet / metrics name (default v2)')
    a = p.parse_args()
    variants = [tuple((x.split(':', 1) + [x])[:2]) for x in a.variants.split(',')] if a.variants else VARIANTS
    os.makedirs(os.path.join(a.root, 'sheets'), exist_ok=True)
    allm = {}
    for c in a.clouds.split(','):
        rows = []
        for view in ('photo', 'detail'):
            plate = load(os.path.join(a.root, f'sky-{c}', f'{view}.jpg'))
            ours = {}
            row = []
            for v, label in variants:
                path = os.path.join(a.root, f'{v}-{c}', f'{view}.jpg')
                row.append((label, path))
                if os.path.exists(path):
                    img = load(path)
                    ours[v] = (img, plate_mask(img, plate))
            kp = os.path.join(a.karma, f'cloudpack-{c}-{view}.jpg') if a.karma else None
            kmask = None
            if kp and os.path.exists(kp):
                kimg = load(kp)
                union = np.zeros(kimg.shape[:2], bool)
                for _, m in ours.values():
                    union |= m
                sky = fit_sky(kimg, ~dilate(union, 24))
                kmask = np.abs(kimg - sky).max(-1) > 6.0 / 255
                allm[f'{c}/{view}/karma'] = metrics(kimg, kmask)[0]
            for v, (img, m) in ours.items():
                allm[f'{c}/{view}/{v}'] = metrics(img, m, kmask)[0]
            row.append(('Karma (V1)', kp))
            rows.append(row)
        sheet(rows, os.path.join(a.root, 'sheets', f'{a.tag}-{c}.jpg'))
    with open(os.path.join(a.root, 'metrics.json' if a.tag == 'v2' else f'metrics-{a.tag}.json'), 'w') as f:
        json.dump(allm, f, indent=1)
    keys = ['cover', 'iou', 'lit', 'shade', 'mean', 'luma50', 'shadeBR', 'midBR', 'edge']
    print('frame'.ljust(22) + ''.join(k.rjust(9) for k in keys))
    for k, m in allm.items():
        print(k.ljust(22) + ''.join((f'{m[x]:9.3f}' if x in m else ' ' * 9) for x in keys))


if __name__ == '__main__':
    main()
