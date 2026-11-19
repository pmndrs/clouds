#!/usr/bin/env python3
"""S1 numbers per capture dir: lit-face detail energy (4-16 px band, PT1's measure: std of DoG(sigma 2) - DoG(sigma 8) of luma on lit cloud
pixels), and the shade's darkest-15 % luma and B/R in the view's base crop. Same crops as sheet.py.

  python3 scripts/s1/metrics.py label=dir [label=dir ...] [--shots gp7,ground,sunset]
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

def band(im):
    L = im.convert('L')
    a = np.asarray(L.filter(ImageFilter.GaussianBlur(2)), float) - np.asarray(L.filter(ImageFilter.GaussianBlur(8)), float)
    return a / 255

def main():
    a = sys.argv[1:]
    shots = ['gp7', 'ground', 'sunset']
    if '--shots' in a: i = a.index('--shots'); shots = a[i + 1].split(','); del a[i:i + 2]
    for v in shots:
        (_, lit), (_, base) = CROPS[v][0], CROPS[v][1]
        for c in a:
            label, d = c.split('=', 1)
            im = load(d, v)
            if im is None: continue
            x, y, w, h = lit
            crop = im.crop((x, y, x + w, y + h))
            lum = np.asarray(crop.convert('L'), float) / 255
            rgb = np.asarray(crop, float) / 255
            sat = rgb.max(2) - rgb.min(2)
            mask = (lum > 0.6) & (sat < 0.25)   # lit cloud, not sky
            # away from the silhouette (the sky edge is not surface texture): erode the mask by 12 px
            mask = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(25)), float) > 128
            e = band(crop)[mask].std() if mask.sum() > 500 else float('nan')
            x, y, w, h = base
            b = np.asarray(im.crop((x, y, x + w, y + h)), float).reshape(-1, 3) / 255
            Lb = b @ [0.2126, 0.7152, 0.0722]
            s = b[Lb <= np.quantile(Lb, 0.15)].mean(0)
            print(f'{v:7s} {label:28s} lit detail {e:.4f}  shade luma {s @ [0.2126, 0.7152, 0.0722]:.3f}  B/R {s[2] / s[0]:.2f}')

if __name__ == '__main__':
    main()
