#!/usr/bin/env python3
"""S2 numbers per capture dir, on lit cloud away from the silhouette in the view's lit crop (S1's crops and mask):
  fine    std of luma minus its Gaussian blur (sigma 1.2): 1-3 px grain and hatch (the sampling noise; lower = calmer)
  detail  PT1's 4-16 px band (DoG sigma 2 - sigma 8): the surface texture (S1's measure)
  edge    mean gradient magnitude on the silhouette band (lit cloud against sky): how crisp the lit ridge is (higher = crisper)

  python3 scripts/s2/metrics.py label=dir [label=dir ...] [--shots gp7,above]
"""
import sys
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from sheet import CROPS

def load(d, v):
    for e in ('png', 'jpg'):
        try: return Image.open(f'{d}/{v}.{e}').convert('RGB')
        except OSError: pass

def blur(L, s): return np.asarray(L.filter(ImageFilter.GaussianBlur(s)), float)

def main():
    a = sys.argv[1:]
    shots = ['gp7', 'above']
    if '--shots' in a: i = a.index('--shots'); shots = a[i + 1].split(','); del a[i:i + 2]
    for v in shots:
        x, y, w, h = CROPS[v][0][1]
        for c in a:
            label, d = c.split('=', 1)
            im = load(d, v)
            if im is None: print(f'{v:7s} {label:28s} (missing)'); continue
            crop = im.crop((x, y, x + w, y + h))
            L = crop.convert('L')
            lum = np.asarray(L, float) / 255
            rgb = np.asarray(crop, float) / 255
            sat = rgb.max(2) - rgb.min(2)
            cloud = (lum > 0.55) & (sat < 0.25)
            inner = np.asarray(Image.fromarray((cloud * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(25)), float) > 128
            Lf = np.asarray(L, float)
            fine = ((Lf - blur(L, 1.2)) / 255)[inner].std() if inner.sum() > 500 else float('nan')
            det = ((blur(L, 2) - blur(L, 8)) / 255)[inner].std() if inner.sum() > 500 else float('nan')
            # silhouette band: cloud pixels within 3 px of sky
            sky = (sat > 0.3)
            near_sky = np.asarray(Image.fromarray((sky * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7)), float) > 128
            band = near_sky & ~sky
            gy, gx = np.gradient(Lf / 255)
            edge = np.hypot(gx, gy)[band].mean() if band.sum() > 50 else float('nan')
            print(f'{v:7s} {label:28s} fine {fine:.4f}  detail {det:.4f}  edge {edge:.4f}')

if __name__ == '__main__':
    main()
