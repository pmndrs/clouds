#!/usr/bin/env python3
"""P1.2c: the 'fit' model's linear weights on RGB region means, for each (fitK, fitKUp) pair.

frame = direct + a (iso_K - zero) + b (fwd_K - zero) + c (up_KUp - zero) + d (down - zero), all a..d >= 0, where
  iso_K: fitMs 1, isotropic;  fwd_K: fitMs 1, fitMsFwd 1 (HG g 0.5);  up_KUp: fitAmbientForm 1, fitAmbient 1;  down: fitAmbientForm 1, fitGround 1
so fitMs = a + b, fitMsFwd = b / (a + b), fitAmbient = c, fitGround = d. Captures: <cloud>/<name>/fit-<sun>.pfm (cap.sh); zero, direct,
ms0.18, ms0.4 are P1.2b's (same shader terms). Error: sum over 4 frames x 5 regions x 3 channels of log(model / path trace)^2.

  fit.py                 the table per (K, KUp), the best pair's weights and its ratios (luminance), and dark20 B/R
  fit.py --check DIR     ratios of frames DIR/<cloud>/final/fit-<sun>.pfm to the path trace (luminance, plus dark20 B/R)
"""
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location('fit_p12b', HERE.parent / 'P1-2b' / 'fit.py')
F = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(F)  # P1.2b: reference(), regions, FRAMES, half
sc = F.sc
KS = {'0.1': 'ms0.1', '0.18': 'ms0.18', '0.4': 'ms0.4'}
KUPS = ['0.05', '0.15', '0.5']
REGIONS = F.REGIONS


def rgb_means(img, reg):
    return np.array([[img[..., ch][reg[k]].mean() for ch in range(3)] for k in REGIONS])  # (5, 3)


def load(cloud, name, sun):
    return sc.read_pfm(HERE / cloud / name / f'fit-{sun}.pfm')[..., :3]


def lum(m):
    return m @ np.array([0.2126, 0.7152, 0.0722])


def solve(base, cols, target):
    """Non-negative x minimising sum log((base + cols x) / target)^2: projected Gauss-Newton (LM) from several starts."""
    n = cols.shape[1]
    best = None
    for start in [np.full(n, 0.5), np.full(n, 0.1), np.array([2.0, 0.0, 0.1, 0.1][:n]), np.array([0.5, 2.0, 1.0, 0.5][:n])]:
        x, lam = start.copy(), 1e-2
        for _ in range(400):
            m = base + cols @ x
            r = np.log(np.maximum(m, 1e-9) / target)
            J = cols / np.maximum(m, 1e-9)[:, None]
            g, H = J.T @ r, J.T @ J
            xn = np.maximum(0, x - np.linalg.solve(H + lam * np.diag(np.diag(H) + 1e-12), g))
            rn = np.log(np.maximum(base + cols @ xn, 1e-9) / target)
            if (rn ** 2).sum() < (r ** 2).sum():
                x, lam = xn, lam * 0.5
            else:
                lam *= 4
            if lam > 1e8:
                break
        e = float((np.log(np.maximum(base + cols @ x, 1e-9) / target) ** 2).sum())
        if best is None or e < best[1]:
            best = (x, e)
    return best


def table(rows, title, br=None):
    print(f'\n{title}\n| frame | ' + ' | '.join(REGIONS) + (' | dark20 B/R fit / pt |' if br else ' |') + '\n|---|' + '---|' * (len(REGIONS) + bool(br)))
    for i, ((c, s), r) in enumerate(zip(F.FRAMES, rows)):
        cells = [f'**{v:.2f}**' if abs(v - 1) > 0.25 else f'{v:.2f}' for v in r]
        if br:
            cells.append(f'{br[i][0]:.2f} / {br[i][1]:.2f}')
        print(f'| {c} {s} | ' + ' | '.join(cells) + ' |')


def br20(m):
    d = REGIONS.index('dark20')
    return m[d, 2] / m[d, 0]


def main():
    if sys.argv[1:2] == ['--check']:
        d = Path(sys.argv[2])
        rows, br = [], []
        for c, s in F.FRAMES:
            reg, pt = F.reference(c, s)
            mf, mp = rgb_means(sc.read_pfm(d / c / 'final' / f'fit-{s}.pfm')[..., :3], reg), rgb_means(pt, reg)
            rows.append(lum(mf) / lum(mp)); br.append((br20(mf), br20(mp)))
        table(rows, f'luminance ratios fit / path trace: {d}', br)
        return
    tgt, base, z, iso, fwd, up, down = [], [], [], {k: [] for k in KS}, {k: [] for k in KS}, {k: [] for k in KUPS}, []
    for c, s in F.FRAMES:
        reg, pt = F.reference(c, s)
        zz = rgb_means(load(c, 'zero', s), reg)
        tgt.append(rgb_means(pt, reg)); base.append(rgb_means(load(c, 'direct', s), reg)); down.append(rgb_means(load(c, 'down', s), reg) - zz)
        for k, name in KS.items():
            iso[k].append(rgb_means(load(c, name, s), reg) - zz); fwd[k].append(rgb_means(load(c, f'fwd{k}', s), reg) - zz)
        for k in KUPS:
            up[k].append(rgb_means(load(c, f'up{k}', s), reg) - zz)
    flat = lambda a: np.concatenate([m.reshape(-1) for m in a])  # noqa: E731
    T, B, D = flat(tgt), flat(base), flat(down)
    res = {}
    print('| fitK | fitKUp | fitMs | fitMsFwd | fitAmbient | fitGround | rms log (60 RGB means) |\n|---|---|---|---|---|---|---|')
    for k in KS:
        for ku in KUPS:
            cols = np.stack([flat(iso[k]), flat(fwd[k]), flat(up[ku]), D], 1)
            x, e = solve(B, cols, T)
            res[(k, ku)] = (x, e, cols)
            ms = x[0] + x[1]
            print(f'| {k} | {ku} | {ms:.3f} | {x[1] / max(ms, 1e-9):.3f} | {x[2]:.3f} | {x[3]:.3f} | {np.sqrt(e / len(T)):.3f} |')
    (k, ku), (x, e, cols) = min(res.items(), key=lambda kv: kv[1][1])
    ms = x[0] + x[1]
    print(f'\nbest: fitK {k} fitKUp {ku} fitMs {ms:.3f} fitMsFwd {x[1] / ms:.3f} fitAmbient {x[2]:.3f} fitGround {x[3]:.3f}')
    model = (B + cols @ x).reshape(len(F.FRAMES), len(REGIONS), 3)
    tg = T.reshape(len(F.FRAMES), len(REGIONS), 3)
    table([lum(m) / lum(t) for m, t in zip(model, tg)], 'predicted luminance ratios', [(br20(m), br20(t)) for m, t in zip(model, tg)])


if __name__ == '__main__':
    main()
