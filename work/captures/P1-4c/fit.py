#!/usr/bin/env python3
"""P1.4c: refit of the 'fit' model with fitMsTauSmooth 1 (the ms term's tau from the light grid alone) on the same 8 frames as P1.4b.

frame = direct + a (iso_{K,p} - zero) + b (fwd_{K,p} - zero) + c (up_ku0.3 - zero) + d (down - zero), a..d >= 0 (P1.4b's method and solver;
grid cut to fitK {0.2, 0.4} x fitMsPow {1, 2}, fitKUp 0.3, ground atten 0). Captures: <cloud>/<sun>/<cfg>.pfm (cap.sh, gen.py).
Extra measure: the scorecard's 16-64 px band energy of log-luminance over the thick body (band_16-64: thick region, read on its eroded core),
fit / path trace (the reference's own grain is in its band energy, alike for both fits).

  fit.py            grid table, best weights, predicted ratios, predicted band ratio; band ratio of P1.4b's final frames
  fit.py --check    luminance ratios and band ratios of <cloud>/final/fit-<sun>.pfm (the new defaults) and of P1.4b's final frames
"""
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location('fit_p14b', HERE.parent / 'P1-4b' / 'fit.py')
P = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(P)
F, C, sc = P.F, P.C, P.sc
KS, POWS = ['0.2', '0.4'], ['1', '2']
# P1.4b's final frames (git-ignored pfm) live in its worktree; override with P14B=<dir>.
import os  # noqa: E402
P14B = Path(os.environ.get('P14B', '/Users/dex/Developer/WebGPUClouds/.claude/worktrees/agent-acaf89eab9adced99/work/captures/P1-4b'))


def load(c, s, name):
    return sc.read_pfm(HERE / c / s / f'{name}.pfm')[..., :3]


def alpha(c, s):
    return F.half(sc.as_mask(sc.read_pfm(F.REF / c / f'alpha-{s}.pfm'))[..., None])


def band(c, s, img):
    _, pt = F.reference(c, s)
    return sc.score(pt, img, alpha(c, s))['measures']['band_16-64']['ratio']


def report(get, title):
    rows, br, bands = [], [], []
    for c, s in F.FRAMES:
        reg, pt = F.reference(c, s)
        img = get(c, s)
        mf, mp = C.rgb_means(img, reg), C.rgb_means(pt, reg)
        rows.append(C.lum(mf) / C.lum(mp)); br.append((C.br20(mf), C.br20(mp))); bands.append(band(c, s, img))
    C.table(rows, title, br)
    return bands


def band_table(cols):
    names = list(cols)
    print('\n16-64 px band energy over the thick body, fit / path trace\n| frame | ' + ' | '.join(names) + ' |\n|---|' + '---|' * len(names))
    for i, (c, s) in enumerate(F.FRAMES):
        print(f'| {c} {s} | ' + ' | '.join(f'{cols[n][i]:.2f}' for n in names) + ' |')


def main():
    old = report(lambda c, s: sc.read_pfm(P14B / c / 'final' / f'fit-{s}.pfm')[..., :3], 'P1.4b defaults (its final frames): luminance ratios fit / path trace')
    if sys.argv[1:2] == ['--check']:
        new = report(lambda c, s: sc.read_pfm(HERE / c / 'final' / f'fit-{s}.pfm')[..., :3], 'P1.4c final (new defaults): luminance ratios fit / path trace')
        band_table({'P1.4b': old, 'P1.4c': new})
        return
    tgt, base, terms, imgs = [], [], {}, {}
    names = [f'{t}_k{k}_p{p}' for t in ['iso', 'fwd'] for k in KS for p in POWS] + ['up_ku0.3', 'down']
    for c, s in F.FRAMES:
        reg, pt = F.reference(c, s)
        zz = load(c, s, 'zero')
        tgt.append(C.rgb_means(pt, reg)); base.append(C.rgb_means(load(c, s, 'direct'), reg))
        imgs[(c, s)] = {'direct': load(c, s, 'direct'), **{n: load(c, s, n) - zz for n in names}}
        for n in names:
            terms.setdefault(n, []).append(C.rgb_means(imgs[(c, s)][n], reg))
    flat = lambda a: np.concatenate([x.reshape(-1) for x in a])  # noqa: E731
    T, B = flat(tgt), flat(base)
    terms = {k: flat(v) for k, v in terms.items()}
    res = {}
    print('\n| fitK | fitMsPow | fitMs | fitMsFwd | fitAmbient | fitGround | rms log (120 RGB means) |\n|---|---|---|---|---|---|---|')
    for k in KS:
        for p in POWS:
            cols = np.stack([terms[f'iso_k{k}_p{p}'], terms[f'fwd_k{k}_p{p}'], terms['up_ku0.3'], terms['down']], 1)
            x, e = C.solve(B, cols, T)
            res[(k, p)] = (x, e, cols)
            ms = x[0] + x[1]
            print(f'| {k} | {p} | {ms:.3f} | {x[1] / max(ms, 1e-9):.3f} | {x[2]:.3f} | {x[3]:.3f} | {np.sqrt(e / len(T)):.3f} |')
    (k, p), (x, e, cols) = min(res.items(), key=lambda kv: kv[1][1])
    ms = x[0] + x[1]
    print(f'\nbest: fitK {k} fitMsPow {p} fitKUp 0.3 fitGroundAtten 0 fitMsTauSmooth 1 fitMs {ms:.3f} fitMsFwd {x[1] / ms:.3f} fitAmbient {x[2]:.3f}'
          f' fitGround {x[3]:.3f}  rms log {np.sqrt(e / len(T)):.3f}')
    model = (B + cols @ x).reshape(len(F.FRAMES), len(F.REGIONS), 3)
    tg = T.reshape(len(F.FRAMES), len(F.REGIONS), 3)
    C.table([C.lum(m) / C.lum(t) for m, t in zip(model, tg)], 'predicted luminance ratios', [(C.br20(m), C.br20(t)) for m, t in zip(model, tg)])
    pred = []
    for c, s in F.FRAMES:
        im = imgs[(c, s)]
        img = im['direct'] + x[0] * im[f'iso_k{k}_p{p}'] + x[1] * im[f'fwd_k{k}_p{p}'] + x[2] * im['up_ku0.3'] + x[3] * im['down']
        pred.append(band(c, s, img))
    band_table({'P1.4b': old, 'P1.4c predicted': pred})


if __name__ == '__main__':
    main()
