#!/usr/bin/env python3
"""P0.5 converged-march gate: differences between two tone-mapped captures (8-bit PNG), and an amplified diff sheet.

  python3 scripts/gpu/converged-diff.py A.png B.png [--sheet out.jpg] [--amp 8] [--label "A|B"] [--crop x,y,w,h]

Prints mean |B - A| (0..255 over RGB), its 99th percentile, the mean signed difference per channel (a global shift shows there), and the same
difference after a 16 px box filter (a brightness or colour shift survives it; sampling noise and edge softness mostly do not).
The sheet is A | B | (B - A) x amp around grey (grey = no change), full size or a crop, scaled for a small JPEG.
"""
import argparse
import numpy as np
from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument('a'); ap.add_argument('b')
ap.add_argument('--sheet'); ap.add_argument('--amp', type=float, default=8.0)
ap.add_argument('--label', default='A|B'); ap.add_argument('--crop')
ap.add_argument('--scale', type=float, default=0.5, help='sheet scale (JPEG size)')
args = ap.parse_args()

A = np.asarray(Image.open(args.a).convert('RGB')).astype(np.float64)
B = np.asarray(Image.open(args.b).convert('RGB')).astype(np.float64)
d = B - A
ad = np.abs(d)
lumA = A @ [0.2126, 0.7152, 0.0722]
lumB = B @ [0.2126, 0.7152, 0.0722]
print(f'mean|d| {ad.mean():.3f}  p99|d| {np.percentile(ad, 99):.1f}  max {ad.max():.0f}  mean d (B-A) RGB {d[..., 0].mean():+.3f} {d[..., 1].mean():+.3f} {d[..., 2].mean():+.3f}  mean luma A {lumA.mean():.2f} B {lumB.mean():.2f}')
# Low-pass difference (16 px box): a global or regional brightness / colour shift survives it, sampling noise and edge softness mostly do not.
k = 16
h, w = (A.shape[0] // k) * k, (A.shape[1] // k) * k
lp = d[:h, :w].reshape(h // k, k, w // k, k, 3).mean(axis=(1, 3))
print(f'16px-block mean d: |.| mean {np.abs(lp).mean():.3f}  p99 {np.percentile(np.abs(lp), 99):.2f}  signed luma mean {(lp @ [0.2126, 0.7152, 0.0722]).mean():+.3f}')
if args.sheet:
    imgs = [A, B, np.clip(128 + d * args.amp, 0, 255)]
    if args.crop:
        x, y, cw, ch = map(int, args.crop.split(','))
        imgs = [i[y:y + ch, x:x + cw] for i in imgs]
    hh, ww = imgs[0].shape[:2]
    sheet = Image.new('RGB', (ww * 3, hh + 18), (20, 20, 20))
    labels = args.label.split('|') + [f'B - A x{args.amp:g} (grey = same)']
    for i, im in enumerate(imgs):
        sheet.paste(Image.fromarray(im.astype(np.uint8)), (i * ww, 18))
        ImageDraw.Draw(sheet).text((i * ww + 4, 3), labels[i], fill=(230, 230, 230))
    if args.scale != 1:
        sheet = sheet.resize((int(sheet.width * args.scale), int(sheet.height * args.scale)), Image.LANCZOS)
    sheet.save(args.sheet, quality=85)
