#!/usr/bin/env python3
"""P1.8a step 2: can the linear gains (fitMs, fitAmbient, fitGround) alone, at fitKUp k, make houdini's sunward body match the path trace?

  resolve.py <terms dir> [<terms dir> ...] <pt.pfm>        (terms dirs from gen.py evals, one per fitKUp)
Per dir: non-negative least squares on the two body regions x RGB (each equation relative to the pt value), all three gains free, then with
fitMs held at its default (it carries the rim). Prints the per-region luminance ratio and B/R (ours vs pt) before -> after, and the rim
(every pixel where the direct term is > 40 % of the frame).
"""
import sys
from itertools import combinations
import numpy as np

LUM = np.array([0.2126, 0.7152, 0.0722])
REG = {'top-lobe core': (110, 180, 280, 400), 'lower body': (280, 350, 240, 520)}
D = dict(fitMs=2.47, fitAmbient=0.62, fitGround=0.61)
TERMS = [('ms', 'fitMs'), ('sky', 'fitAmbient'), ('ground', 'fitGround')]


def nnls(A, b):   # few unknowns: best non-negative solution over every subset of free columns
    best = (np.zeros(A.shape[1]), float(np.linalg.norm(b)))
    for n in range(1, A.shape[1] + 1):
        for s in combinations(range(A.shape[1]), n):
            xs = np.linalg.lstsq(A[:, s], b, rcond=None)[0]
            if (xs < 0).any(): continue
            x = np.zeros(A.shape[1]); x[list(s)] = xs
            r = float(np.linalg.norm(A @ x - b))
            if r < best[1]: best = (x, r)
    return best


def pfm(p):
    with open(p, 'rb') as f:
        kind = f.readline().strip(); w, h = map(int, f.readline().split()); s = float(f.readline())
        a = np.frombuffer(f.read(), '<f4' if s < 0 else '>f4').reshape(h, w, 3 if kind == b'PF' else 1)
    return a[::-1].astype(np.float64)


def m(im, r):
    y0, y1, x0, x1 = r
    return im[y0:y1, x0:x1].reshape(-1, 3).mean(0)


pt = pfm(sys.argv[-1])


def report(d, im, x, rim, label):
    print(f'{d.rstrip("/").split("/")[-1]:24s} {label:16s} fitMs {x[0]:.2f}  fitAmbient {x[1]:.2f}  fitGround {x[2]:.2f}')
    for nm, r in list(REG.items()) + [('rim (mask)', None)]:
        mm = (lambda a: a[rim].mean(0)) if r is None else (lambda a: m(a, r))
        z = mm(im['zero'])
        ours = mm(im['direct']) + sum(x[i] * (mm(im[n]) - z) / D[g] for i, (n, g) in enumerate(TERMS))
        here = z + sum(mm(im[n]) - z for n in ['direct', 'ms', 'sky', 'ground'])
        t = mm(pt)
        print(f'   {nm:14s} lum ours/pt {here @ LUM / (t @ LUM):.2f} -> {ours @ LUM / (t @ LUM):.2f}   B/R pt {t[2] / t[0]:.2f}  ours {here[2] / here[0]:.2f} -> {ours[2] / ours[0]:.2f}')


for d in sys.argv[1:-1]:
    im = {n: pfm(f'{d}/{n}.pfm') for n in ['zero', 'direct', 'ms', 'sky', 'ground']}
    A, b = [], []
    for r in REG.values():
        z, dr = m(im['zero'], r), m(im['direct'], r) - m(im['zero'], r)
        cols = [(m(im[n], r) - z) / D[g] for n, g in TERMS]
        t = m(pt, r)
        for c in range(3):
            A.append([col[c] / t[c] for col in cols]); b.append((t[c] - z[c] - dr[c]) / t[c])
    A, b = np.array(A), np.array(b)
    full0 = im['zero'] + sum(im[n] - im['zero'] for n in ['direct', 'ms', 'sky', 'ground'])
    rim = ((im['direct'] - im['zero']) @ LUM) > 0.4 * (full0 @ LUM)
    x, _ = nnls(A, b)
    report(d, im, x, rim, 'all three free')
    x2, _ = nnls(A[:, 1:], b - A[:, 0] * D['fitMs'])
    report(d, im, np.array([D['fitMs'], *x2]), rim, 'fitMs held')
