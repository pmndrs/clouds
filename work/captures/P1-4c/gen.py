#!/usr/bin/env python3
"""P1.4c: the evals file for one (cloud, sun) page load: every fit term on its own with fitMsTauSmooth 1 (12 configs), each a converged linear frame.

  gen.py > evals.json    names <cfg>; see CONFIGS. Grid cut to P1.4b's winners: fitK {0.2, 0.4} x fitMsPow {1, 2}, fitKUp 0.3, ground atten 0.
"""
import json
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location('gen_p14b', Path(__file__).resolve().parent.parent / 'P1-4b' / 'gen.py')
G = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(G)
KS, POWS = ['0.2', '0.4'], ['1', '2']
BASE = {**G.BASE, 'fitMsTauSmooth': 1, 'fitKUp': 0.3}
CONFIGS = {'zero': {}, 'direct': dict(fitDirect=1)}
for k in KS:
    for p in POWS:
        CONFIGS[f'iso_k{k}_p{p}'] = dict(fitMs=1, fitK=float(k), fitMsPow=float(p))
        CONFIGS[f'fwd_k{k}_p{p}'] = dict(fitMs=1, fitMsFwd=1, fitK=float(k), fitMsPow=float(p))
CONFIGS['up_ku0.3'] = dict(fitAmbient=1, fitKUp=0.3)
CONFIGS['down'] = dict(fitGround=1)

if __name__ == '__main__':
    print(json.dumps([{'name': n, 'expr': G.WAIT % json.dumps({**BASE, **cfg}), 'linear': True} for n, cfg in CONFIGS.items()], indent=1))
