#!/usr/bin/env python3
"""P1.4b: refit of the 'fit' model on all four suns (8 frames), with fitMsPow and fitGroundAtten in the grid.

frame = direct + a (iso_{K,p} - zero) + b (fwd_{K,p} - zero) + c (up_{KUp} - zero) + d (ground - zero), a..d >= 0, ground = down (atten 0)
or downatt_{KUp} (atten 1); fitMs = a + b, fitMsFwd = b / (a + b), fitAmbient = c, fitGround = d. Captures: <cloud>/<sun>/<cfg>.pfm (cap.sh,
gen.py). Error: sum over 8 frames x 5 regions x 3 channels of log(model / path trace)^2 (every frame weighs the same). Solver: P1.2c's.

  fit.py               the grid table, the best weights, predicted ratios; and the P1.2c defaults (shot fit-<sun>) for comparison
  fit.py --check       ratios of <cloud>/final/fit-<sun>.pfm to the path trace
"""
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location('fit_p12c', HERE.parent / 'P1-2c' / 'fit.py')
C = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(C)
F = C.F
F.FRAMES[:] = [(c, s) for c in ['sky', 'embergen02'] for s in ['noon', 'low', 'backlit', 'sunset']]
sc = F.sc
KS, POWS, KUPS = ['0.2', '0.4', '0.8'], ['1', '2'], ['0.05', '0.3']


def load(c, s, name):
    return sc.read_pfm(HERE / c / s / f'{name}.pfm')[..., :3]


def ratios(get):
    rows, br = [], []
    for c, s in F.FRAMES:
        reg, pt = F.reference(c, s)
        mf, mp = C.rgb_means(get(c, s), reg), C.rgb_means(pt, reg)
        rows.append(C.lum(mf) / C.lum(mp)); br.append((C.br20(mf), C.br20(mp)))
    return rows, br


def main():
    if sys.argv[1:2] == ['--check']:
        rows, br = ratios(lambda c, s: sc.read_pfm(HERE / c / 'final' / f'fit-{s}.pfm')[..., :3])
        C.table(rows, 'final (new defaults): luminance ratios fit / path trace', br)
        return
    rows, br = ratios(lambda c, s: load(c, s, f'fit-{s}'))
    C.table(rows, 'P1.2c defaults: luminance ratios fit / path trace', br)
    tgt, base, D = [], [], {}
    terms = {}
    for c, s in F.FRAMES:
        reg, pt = F.reference(c, s)
        m = lambda n: C.rgb_means(load(c, s, n), reg)  # noqa: E731
        zz = m('zero')
        tgt.append(C.rgb_means(pt, reg)); base.append(m('direct'))
        names = [f'{t}_k{k}_p{p}' for t in ['iso', 'fwd'] for k in KS for p in POWS] + [f'up_ku{u}' for u in KUPS] + [f'downatt_ku{u}' for u in KUPS] + ['down']
        for n in names:
            terms.setdefault(n, []).append(m(n) - zz)
    flat = lambda a: np.concatenate([x.reshape(-1) for x in a])  # noqa: E731
    T, B = flat(tgt), flat(base)
    terms = {k: flat(v) for k, v in terms.items()}
    res = {}
    print('\n| fitK | fitMsPow | fitKUp | groundAtten | fitMs | fitMsFwd | fitAmbient | fitGround | rms log (120 RGB means) |\n|---|---|---|---|---|---|---|---|---|')
    for k in KS:
        for p in POWS:
            for ku in KUPS:
                for ga in [0, 1]:
                    cols = np.stack([terms[f'iso_k{k}_p{p}'], terms[f'fwd_k{k}_p{p}'], terms[f'up_ku{ku}'], terms[f'downatt_ku{ku}'] if ga else terms['down']], 1)
                    x, e = C.solve(B, cols, T)
                    res[(k, p, ku, ga)] = (x, e, cols)
                    ms = x[0] + x[1]
                    print(f'| {k} | {p} | {ku} | {ga} | {ms:.3f} | {x[1] / max(ms, 1e-9):.3f} | {x[2]:.3f} | {x[3]:.3f} | {np.sqrt(e / len(T)):.3f} |')
    (k, p, ku, ga), (x, e, cols) = min(res.items(), key=lambda kv: kv[1][1])
    ms = x[0] + x[1]
    print(f'\nbest: fitK {k} fitMsPow {p} fitKUp {ku} fitGroundAtten {ga} fitMs {ms:.3f} fitMsFwd {x[1] / ms:.3f} fitAmbient {x[2]:.3f} fitGround {x[3]:.3f}'
          f'  rms log {np.sqrt(e / len(T)):.3f}')
    model = (B + cols @ x).reshape(len(F.FRAMES), len(F.REGIONS), 3)
    tg = T.reshape(len(F.FRAMES), len(F.REGIONS), 3)
    C.table([C.lum(m) / C.lum(t) for m, t in zip(model, tg)], 'predicted luminance ratios', [(C.br20(m), C.br20(t)) for m, t in zip(model, tg)])


if __name__ == '__main__':
    main()
