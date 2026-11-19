#!/usr/bin/env python3
"""S2 motion numbers (U2's measures) on consecutive frames f000.png.. of a step-frames dir, gp7 lit ridge at 1280x720 (S1's crop scaled 2/3):
  HF       mean |laplacian| of luma (detail kept; lower = softer)
  flicker  mean over pixels of the temporal std of the high-pass (luma - blur 1.5) across the frames (sparkle / crawl)
  speck%   share of pixels with |laplacian| > 12 (isolated bright/dark dots)
  python3 scripts/s2/motion_metrics.py label=dir [label=dir ...]"""
import glob, sys
import numpy as np
from PIL import Image, ImageFilter

BOX = (667, 220, 667 + 320, 220 + 213)

def lap(a):
    return np.abs(4 * a[1:-1, 1:-1] - a[:-2, 1:-1] - a[2:, 1:-1] - a[1:-1, :-2] - a[1:-1, 2:])

for c in sys.argv[1:]:
    label, d = c.split('=', 1)
    files = sorted(glob.glob(f'{d}/f*.png'))
    if not files: print(f'{label:16s} (no frames)'); continue
    hfs, sp, highs = [], [], []
    for f in files:
        L = Image.open(f).convert('L').crop(BOX)
        a = np.asarray(L, float)
        l = lap(a); hfs.append(l.mean()); sp.append((l > 12).mean() * 100)
        highs.append(a - np.asarray(L.filter(ImageFilter.GaussianBlur(1.5)), float))
    flick = np.std(np.stack(highs), axis=0).mean()
    print(f'{label:16s} frames {len(files)}  HF {np.mean(hfs):.2f}  flicker {flick:.2f}  speck% {np.mean(sp):.1f}')
