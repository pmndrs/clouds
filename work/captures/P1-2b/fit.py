#!/usr/bin/env python3
"""P1.2b: fitMs, fitAmbient (for each fitK of the ms term) by least squares of log(model / path trace) over region means.

The fit view is affine in its terms: frame = zero + direct' + fitMs * ms_K' + fitAmbient * amb', where X' = X - zero (zero: every term off,
i.e. the sky through the cloud and the aerial perspective). Captures: <cloud>/{zero,direct,amb,ms<K>}/fit-<sun>.pfm (cap.sh).
Regions (scripts/gpu/scorecard.py, alpha = the card's PT bake opacity box-halved to 640x360): cloud, thick, base, dark20, and bright20
(the reference's brightest 20 % of the cloud, the mirror of dark20).

  fit.py [REF_CARD_DIR]          the fit table per K (and a quadratic-in-log-K estimate of the best K)
  fit.py --check DIR [REF]       ratios of frames DIR/<cloud>/fit-<sun>.pfm to the path trace (the 4 x 5 table)
"""
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / 'scripts' / 'gpu'))
import scorecard as sc  # noqa: E402

REF = Path('/Users/dex/Developer/WebGPUClouds/.claude/worktrees/agent-aa708b160547fc3f4/work/captures/card')
FRAMES = [(c, s) for c in ['sky', 'embergen02'] for s in ['noon', 'backlit']]
REGIONS = ['cloud', 'thick', 'base', 'dark20', 'bright20']
KS = ['0.15', '0.18', '0.4', '1.0']


def half(img):
    h, w = img.shape[:2]
    return img[:h // 2 * 2, :w // 2 * 2].reshape(h // 2, 2, w // 2, 2, -1).mean(axis=(1, 3)).squeeze()


def reference(cloud, sun, ref=REF):
    pt, _ = sc.averaged_reference(sc.read_pfm(ref / cloud / f'pt-{sun}.pfm'), sc.read_pfm(ref / cloud / 'seed2' / f'pt-{sun}.pfm'))
    alpha = half(sc.as_mask(sc.read_pfm(ref / cloud / f'alpha-{sun}.pfm'))[..., None])
    pt = half(pt)[..., :3]
    lum = sc.luminance(pt)
    reg = sc.regions(alpha, lum)
    cloud_m = reg['cloud']
    reg['bright20'] = cloud_m & (lum >= np.percentile(lum[cloud_m], 80))
    return {k: reg[k] for k in REGIONS}, pt


def means(img, reg):
    lum = sc.luminance(img[..., :3])
    return np.array([lum[reg[k]].mean() for k in REGIONS])


def load(cloud, name, sun):
    return sc.read_pfm(HERE / cloud / name / f'fit-{sun}.pfm')


def solve(base, dms, damb, target):
    """Non-negative (ms, amb) minimising sum log(model / target)^2; a coarse grid then a fine one around the best."""
    best = None
    for lo_ms, hi_ms, lo_a, hi_a, n in [(0, 20, 0, 4, 201)]:
        ms, am = np.meshgrid(np.linspace(lo_ms, hi_ms, n), np.linspace(lo_a, hi_a, n), indexing='ij')
        model = base[None, None] + ms[..., None] * dms[None, None] + am[..., None] * damb[None, None]
        err = (np.log(np.maximum(model, 1e-9) / target) ** 2).sum(-1)
        i = np.unravel_index(err.argmin(), err.shape)
        best = (ms[i], am[i], err[i])
    m0, a0 = best[0], best[1]
    ms, am = np.meshgrid(np.linspace(max(0, m0 - 0.2), m0 + 0.2, 201), np.linspace(max(0, a0 - 0.04), a0 + 0.04, 201), indexing='ij')
    model = base[None, None] + ms[..., None] * dms[None, None] + am[..., None] * damb[None, None]
    err = (np.log(np.maximum(model, 1e-9) / target) ** 2).sum(-1)
    i = np.unravel_index(err.argmin(), err.shape)
    return float(ms[i]), float(am[i]), float(err[i]), model[i]


def table(rows, title):
    print(f'\n{title}\n| frame | ' + ' | '.join(REGIONS) + ' |\n|---|' + '---|' * len(REGIONS))
    for (c, s), r in zip(FRAMES, rows):
        print(f'| {c} {s} | ' + ' | '.join(f'**{v:.2f}**' if abs(v - 1) > 0.25 else f'{v:.2f}' for v in r) + ' |')


def main():
    if sys.argv[1:2] == ['--check']:
        d = Path(sys.argv[2])
        rows = []
        for c, s in FRAMES:
            reg, pt = reference(c, s)
            rows.append(means(sc.read_pfm(d / c / f'fit-{s}.pfm'), reg) / means(pt, reg))
        table(rows, f'ratios fit / path trace: {d}')
        return
    target, base, damb, dms = [], [], [], {k: [] for k in KS}
    for c, s in FRAMES:
        reg, pt = reference(c, s)
        z = means(load(c, 'zero', s), reg)
        target.append(means(pt, reg)); base.append(means(load(c, 'direct', s), reg)); damb.append(means(load(c, 'amb', s), reg) - z)
        for k in KS:
            dms[k].append(means(load(c, f'ms{k}', s), reg) - z)
    target, base, damb = np.concatenate(target), np.concatenate(base), np.concatenate(damb)
    res = {}
    for k in KS:
        ms, amb, err, model = solve(base, np.concatenate(dms[k]), damb, target)
        res[k] = (ms, amb, err)
        print(f'fitK {k}: fitMs {ms:.3f} fitAmbient {amb:.3f}  sum log^2 {err:.4f}  rms log {np.sqrt(err / len(target)):.3f}')
        table((model / target).reshape(len(FRAMES), len(REGIONS)), f'fitK {k}: ratios')
    lk = np.log([float(k) for k in KS]); e = np.array([res[k][2] for k in KS])
    a, b, _ = np.polyfit(lk, e, 2)
    if a > 0:
        kb = float(np.exp(-b / (2 * a)))
        print(f'\nquadratic in log K: best K ~ {kb:.3f} (inside [0.15, 1.0]: {0.15 <= kb <= 1.0})')
        # the ms term's region means at kb, interpolated per region in log K (quadratic through the three), for a predicted fit
        dk = np.stack([np.concatenate(dms[k]) for k in KS])
        dkb = np.array([np.polyval(np.polyfit(lk, dk[:, j], 2), np.log(kb)) for j in range(dk.shape[1])])
        ms, amb, err, model = solve(base, dkb, damb, target)
        print(f'predicted at K {kb:.3f}: fitMs {ms:.3f} fitAmbient {amb:.3f}  sum log^2 {err:.4f}')
    else:
        print('\nerror not convex in log K over the three samples: pick the best sample')


if __name__ == '__main__':
    main()
