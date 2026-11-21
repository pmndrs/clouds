#!/usr/bin/env python3
"""P1.1: the compact shadow optical depth table of all four card clouds from <cloud>/tau.json (tau.py) -> tau-tables.md."""
import json
from pathlib import Path

import numpy as np

D = Path(__file__).parent
BINS = [(0, 1), (1, 3), (3, 10), (10, 30), (30, 1e9)]
CLOUDS = ['parkouring', 'embergen02', 'sky', 'stratus']
TOL = ['|dtau| < 0.049: ±10 % at 0.5', '±2.5 % at 2', '±0.75 % at 6.5', '±0.25 % at 20 (weight e^-10)', 'none (e^-30)']
R = {c: json.loads((D / c / 'tau.json').read_text()) for c in CLOUDS}
out = ['realtime tau / true tau: median [p10-p90] over the four suns, and the part beyond 48 m (light grid / true) median',
       '| true tau | ' + ' | '.join(CLOUDS) + ' | 5 % radiance needs |', '|---|' + '---|' * len(CLOUDS) + '---|']
for i, (a, b) in enumerate(BINS):
    cells = []
    for c in CLOUDS:
        rows = R[c]
        tr, rt = np.array([r['tauTrue'] for r in rows]), np.array([r['tauRt'] for r in rows])
        tn, tg = np.array([r['tauTrueNear'] for r in rows]), np.array([r['tauRtGrid'] for r in rows])
        s = (tr >= a) & (tr < b)
        if s.sum() < 3:
            cells.append('-'); continue
        q = rt[s] / tr[s]
        far = tr[s] - tn[s]
        g = np.where(far > 1e-3, tg[s] / np.maximum(far, 1e-9), np.nan)
        cells.append(f'{np.median(q):.2f} [{np.percentile(q, 10):.2f}-{np.percentile(q, 90):.2f}]; grid {np.nanmedian(g):.2f}')
    out.append(f'| {a}-{b if b < 1e8 else "+"} | ' + ' | '.join(cells) + f' | {TOL[i]} |')
(D / 'tau-tables.md').write_text('\n'.join(out) + '\n')
print('\n'.join(out))
