#!/usr/bin/env python3
"""P1.6a: refit of the 'fit' model with two ranges of scattered light (fitMsForm 1) on 10 frames: sky, embergen02 x 4 suns, tower noon, low.

frame = direct + a niso_KN + b nfwd_KN + c fiso_KF + d ffwd_KF + e up + g down (each X = X - zero), a..g >= 0 (P1.4b's solver, log error on
5 regions x RGB means, every frame equal). fitMsNear = a + b, fitMsNearFwd = b / (a + b), fitMsFar = c + d, fitMsFarFwd = d / (c + d),
fitAmbient = e, fitGround = g; fitKUp 0.3, ground attenuation off. Captures: <cloud>/<sun>/<cfg>.pfm (cap.sh, gen.py); <cloud>/<sun>/fit-<sun>.pfm
is the P1.4c defaults (before). tower: alpha from P2.4b's fit pass, regions on a 2 px blur of its path trace (P2.4b's sheet.py).

  fit.py           before table, the grid, the best weights, predicted ratios
  fit.py --check   ratios of <cloud>/final/fit-<sun>.pfm to the path trace
"""
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location('fit_p12c', HERE.parent / 'P1-2c' / 'fit.py')
C = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(C)
F, sc = C.F, C.F.sc
F.FRAMES[:] = [(c, s) for c in ['sky', 'embergen02'] for s in ['noon', 'low', 'backlit', 'sunset']] + [('tower', 'noon'), ('tower', 'low')]
TOWER_PT = HERE.parent / 'P2-4b'
TOWER_ALPHA = Path('/Users/dex/Developer/WebGPUClouds/.claude/worktrees/agent-a3439c95054c9deaf/work/captures/P2-4b/fit')
KNS, KFS = ['0.3', '1.0'], ['0.03', '0.1']


def reference(c, s):
    if c != 'tower':
        return F.reference(c, s)
    pt = sc.read_pfm(TOWER_PT / f'pt-{s}' / f'pt-{s}.pfm')[..., :3]
    a = sc.as_mask(sc.read_pfm(TOWER_ALPHA / f'alpha-{s}.pfm'))
    ls = sc.gauss_blur(sc.luminance(pt), 2.0)
    reg = sc.regions(a, ls)
    reg['bright20'] = reg['cloud'] & (ls >= np.percentile(ls[reg['cloud']], 80))
    return {k: reg[k] for k in C.REGIONS}, pt


REFS = {}


def ref(c, s):
    if (c, s) not in REFS:
        REFS[(c, s)] = reference(c, s)
    return REFS[(c, s)]


def load(c, s, name):
    return sc.read_pfm(HERE / c / s / f'{name}.pfm')[..., :3]


def solve(base, cols, target):
    n = cols.shape[1]
    best = None
    for start in [np.full(n, 0.5), np.full(n, 0.1), np.linspace(2, 0.1, n), np.linspace(0.1, 2, n)]:
        x, lam = start.copy(), 1e-2
        for _ in range(600):
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


def ratios(get):
    rows, br = [], []
    for c, s in F.FRAMES:
        reg, pt = ref(c, s)
        mf, mp = C.rgb_means(get(c, s), reg), C.rgb_means(pt, reg)
        rows.append(C.lum(mf) / C.lum(mp)); br.append((C.br20(mf), C.br20(mp)))
    return rows, br


def main():
    if sys.argv[1:2] == ['--check']:
        rows, br = ratios(lambda c, s: sc.read_pfm(HERE / c / 'final' / f'fit-{s}.pfm')[..., :3])
        C.table(rows, 'final (P1.6a defaults): luminance ratios fit / path trace', br)
        return
    rows, br = ratios(lambda c, s: load(c, s, f'fit-{s}'))
    C.table(rows, 'before (P1.4c defaults): luminance ratios fit / path trace', br)
    tgt, base, terms = [], [], {}
    names = [f'{t}_kn{k}' for t in ['niso', 'nfwd'] for k in KNS] + [f'{t}_kf{k}' for t in ['fiso', 'ffwd'] for k in KFS] + ['up', 'down']
    for c, s in F.FRAMES:
        reg, pt = ref(c, s)
        m = lambda n: C.rgb_means(load(c, s, n), reg)  # noqa: E731
        zz = m('zero')
        tgt.append(C.rgb_means(pt, reg)); base.append(m('direct'))
        for n in names:
            terms.setdefault(n, []).append(m(n) - zz)
    flat = lambda a: np.concatenate([x.reshape(-1) for x in a])  # noqa: E731
    T, B = flat(tgt), flat(base)
    terms = {k: flat(v) for k, v in terms.items()}
    res = {}
    print('\n| fitKNear | fitKFar | fitMsNear | nearFwd | fitMsFar | farFwd | fitAmbient | fitGround | rms log (150 RGB means) |\n|---|---|---|---|---|---|---|---|---|')
    for kn in KNS:
        for kf in KFS:
            cols = np.stack([terms[f'niso_kn{kn}'], terms[f'nfwd_kn{kn}'], terms[f'fiso_kf{kf}'], terms[f'ffwd_kf{kf}'], terms['up'], terms['down']], 1)
            x, e = solve(B, cols, T)
            res[(kn, kf)] = (x, e, cols)
            n_, f_ = x[0] + x[1], x[2] + x[3]
            print(f'| {kn} | {kf} | {n_:.3f} | {x[1] / max(n_, 1e-9):.3f} | {f_:.3f} | {x[3] / max(f_, 1e-9):.3f} | {x[4]:.3f} | {x[5]:.3f} | {np.sqrt(e / len(T)):.3f} |')
    (kn, kf), (x, e, cols) = min(res.items(), key=lambda kv: kv[1][1])
    n_, f_ = x[0] + x[1], x[2] + x[3]
    print(f'\nbest: fitKNear {kn} fitKFar {kf} fitMsNear {n_:.3f} fitMsNearFwd {x[1] / max(n_, 1e-9):.3f} fitMsFar {f_:.3f} fitMsFarFwd {x[3] / max(f_, 1e-9):.3f}'
          f' fitAmbient {x[4]:.3f} fitGround {x[5]:.3f}  rms log {np.sqrt(e / len(T)):.3f}')
    model = (B + cols @ x).reshape(len(F.FRAMES), len(C.REGIONS), 3)
    tg = T.reshape(len(F.FRAMES), len(C.REGIONS), 3)
    C.table([C.lum(m) / C.lum(t) for m, t in zip(model, tg)], 'predicted luminance ratios', [(C.br20(m), C.br20(t)) for m, t in zip(model, tg)])


if __name__ == '__main__':
    main()
