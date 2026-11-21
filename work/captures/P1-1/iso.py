#!/usr/bin/env python3
"""P1.1: region ratios (realtime / averaged PT) of every <cloud>/iso-<name>/nubis-<sun>.pfm (and rtalpha vs alpha where captured), next to the
base frame's. usage: iso.py <cloud dir>"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import p11  # noqa: E402
sc = p11.sc

c = Path(sys.argv[1])
print('| variant | sun | cloud | thick | base | fringe |')
print('|---|---|---|---|---|---|')
for sun in p11.SUNS:
    try:
        alpha = sc.as_mask(sc.read_pfm(c / f'alpha-{sun}.pfm'))
        pt, _ = sc.averaged_reference(sc.read_pfm(c / f'pt-{sun}.pfm'), sc.read_pfm(c / 'seed2' / f'pt-{sun}.pfm'))
    except FileNotFoundError:
        continue
    variants = [('base', c / f'nubis-{sun}.pfm'), ('sunAtCentre', c / f'nubis-{sun}-centre.pfm')] + [(d.name[4:], d / f'nubis-{sun}.pfm') for d in sorted(c.glob('iso-*'))]
    for name, f in variants:
        if not f.exists():
            continue
        r = p11.ratios(sc.read_pfm(f), pt, alpha)
        print(f'| {name} | {sun} | ' + ' | '.join('-' if r[k] is None else f'{r[k]:.3f}' for k in p11.REGIONS) + ' |')
    for d in [c] + sorted(c.glob('iso-*')):
        f = d / f'rtalpha-{sun}.pfm'
        if f.exists():
            ra = sc.as_mask(sc.read_pfm(f))
            reg = sc.regions(alpha, sc.luminance(pt))
            # view-ray opacity agreement by region: mean realtime alpha / mean PT alpha, and the optical depth -ln(1 - alpha) ratio in the cloud
            od = lambda a: -np.log(np.clip(1 - a, 1e-6, 1))
            vals = {k: float(ra[reg[k]].mean() / max(alpha[reg[k]].mean(), 1e-9)) for k in p11.REGIONS}
            odr = float(np.median(od(ra[reg['fringe']]) / np.maximum(od(alpha[reg['fringe']]), 1e-6)))
            print(f'| rtalpha/alpha ({d.name}) | {sun} | ' + ' | '.join(f'{vals[k]:.3f}' for k in p11.REGIONS) + f' | fringe OD median {odr:.3f}')
