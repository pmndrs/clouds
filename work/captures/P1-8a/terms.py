#!/usr/bin/env python3
"""P1.8a: per-term split of the fit model's body radiance on houdini, against the path trace (P2-9c pt-sunward.pfm).

  terms.py <dir with zero/direct/ms/sky/ground/sky_k0/full .pfm> [pt.pfm]
Each term = its eval frame minus the 'zero' frame (the sky behind the cloud times its transmittance).
"""
import sys
import numpy as np

LUM = np.array([0.2126, 0.7152, 0.0722])
REG = {'top-lobe core': (110, 180, 280, 400), 'lower body': (280, 350, 240, 520)}   # rows, cols (as P2-9c/sheet.py)
SKY = [(20, 28, 305, 335), (235, 255, 110, 118)]


def pfm(p):
    with open(p, 'rb') as f:
        kind = f.readline().strip(); w, h = map(int, f.readline().split()); s = float(f.readline())
        a = np.frombuffer(f.read(), '<f4' if s < 0 else '>f4').reshape(h, w, 3 if kind == b'PF' else 1)
    return a[::-1].astype(np.float64)


def m(im, r):
    y0, y1, x0, x1 = r
    return im[y0:y1, x0:x1].reshape(-1, 3).mean(0)


def fmt(rgb):
    l = rgb @ LUM
    return f'lum {l:6.3f}  B/R {rgb[2] / max(rgb[0], 1e-9):4.2f}  rgb/lum {np.round(rgb / max(l, 1e-9), 2)}'


d = sys.argv[1]
im = {k: pfm(f'{d}/{k}.pfm') for k in ['zero', 'direct', 'ms', 'sky', 'ground', 'sky_k0', 'full']}
pt = pfm(sys.argv[2]) if len(sys.argv) > 2 else None
for nm, r in REG.items():
    full = m(im['full'], r)
    print(f'== {nm}')
    print(f'  ours full      {fmt(full)}')
    if pt is not None:
        print(f'  path trace     {fmt(m(pt, r))}   ours/pt lum {full @ LUM / (m(pt, r) @ LUM):.2f}')
    print(f'  behind (T*sky) {fmt(m(im["zero"], r))}  share {m(im["zero"], r) @ LUM / (full @ LUM):.2f}')
    for k in ['direct', 'ms', 'sky', 'ground', 'sky_k0']:
        t = m(im[k], r) - m(im['zero'], r)
        print(f'  {k:14s} {fmt(t)}  share {t @ LUM / (full @ LUM):.2f}')
sky = np.mean([m(im['full'], s) for s in SKY], axis=0)
print(f'sky next to the cloud: {fmt(sky)}')
if pt is not None:
    print(f'pt sky next to cloud:  {fmt(np.mean([m(pt, s) for s in SKY], axis=0))}')
