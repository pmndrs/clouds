#!/usr/bin/env python3
"""P1.6a: the evals file for one (cloud, sun) page load: every term of the two-range fit (fitMsForm 1) on its own, 12 configs, converged linear.

  gen.py > evals.json    names: zero, direct, niso_kn<K>, nfwd_kn<K>, fiso_kf<K>, ffwd_kf<K>, up, down
"""
import json
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location('gen_p14b', Path(__file__).resolve().parent.parent / 'P1-4b' / 'gen.py')
G = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(G)

KNS, KFS = ['0.3', '1.0'], ['0.03', '0.1']
BASE = dict(fitDirect=0, fitMs=0, fitMsFwd=0, fitMsG=0.5, fitAmbient=0, fitGround=0, fitGroundAtten=0, fitMsPow=2, fitK=0.2, fitKUp=0.3,
            fitAmbientForm=1, fitMsForm=1, fitMsNear=0, fitMsNearFwd=0, fitKNear=1, fitMsFar=0, fitMsFarFwd=0, fitKFar=0.1)
CONFIGS = {'zero': {}, 'direct': dict(fitDirect=1)}
for k in KNS:
    CONFIGS[f'niso_kn{k}'] = dict(fitMsNear=1, fitKNear=float(k))
    CONFIGS[f'nfwd_kn{k}'] = dict(fitMsNear=1, fitMsNearFwd=1, fitKNear=float(k))
for k in KFS:
    CONFIGS[f'fiso_kf{k}'] = dict(fitMsFar=1, fitKFar=float(k))
    CONFIGS[f'ffwd_kf{k}'] = dict(fitMsFar=1, fitMsFarFwd=1, fitKFar=float(k))
CONFIGS['up'] = dict(fitAmbient=1)
CONFIGS['down'] = dict(fitGround=1)

if __name__ == '__main__':
    print(json.dumps([{'name': n, 'expr': G.WAIT % json.dumps({**BASE, **cfg}), 'linear': True} for n, cfg in CONFIGS.items()], indent=1))
