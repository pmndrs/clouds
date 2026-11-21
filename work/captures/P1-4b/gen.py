#!/usr/bin/env python3
"""P1.4b: the evals file for one (cloud, sun) page load: every fit term on its own (19 configs), each a converged linear frame.

  gen.py > evals.json    names <cfg>; see CONFIGS
"""
import json

KS, POWS, KUPS = ['0.2', '0.4', '0.8'], ['1', '2'], ['0.05', '0.3']
BASE = dict(fitDirect=0, fitMs=0, fitMsFwd=0, fitMsG=0.5, fitAmbient=0, fitGround=0, fitGroundAtten=0, fitMsPow=1, fitK=0.4, fitKUp=0.05, fitAmbientForm=1)
CONFIGS = {'zero': {}, 'direct': dict(fitDirect=1)}
for k in KS:
    for p in POWS:
        CONFIGS[f'iso_k{k}_p{p}'] = dict(fitMs=1, fitK=float(k), fitMsPow=float(p))
        CONFIGS[f'fwd_k{k}_p{p}'] = dict(fitMs=1, fitMsFwd=1, fitK=float(k), fitMsPow=float(p))
for ku in KUPS:
    CONFIGS[f'up_ku{ku}'] = dict(fitAmbient=1, fitKUp=float(ku))
    CONFIGS[f'downatt_ku{ku}'] = dict(fitGround=1, fitGroundAtten=1, fitKUp=float(ku))
CONFIGS['down'] = dict(fitGround=1)

# After a settings change the converged sum restarts on the next frame: wait for the restart count to move, then for done (no grid wait:
# the fit constants do not touch the light grid; the shot before the evals did the full settle at this sun).
WAIT = """(async () => { const c = window.__clouds; const cv = () => c.report().p11.convergedInfo; const raf = () => new Promise(r => requestAnimationFrame(r));
  const r0 = cv().restarts; c.setSettings(%s); const t = performance.now();
  while (cv().restarts === r0) { await raf(); if (performance.now() - t > 5000) throw new Error('no restart'); }
  while (!cv().done) { await raf(); if (performance.now() - t > 30000) throw new Error('not converged'); }
  for (let i = 0; i < 2; i++) await raf();
  return c.readLinear(); })()"""

if __name__ == '__main__':
    print(json.dumps([{'name': n, 'expr': WAIT % json.dumps({**BASE, **cfg}), 'linear': True} for n, cfg in CONFIGS.items()], indent=1))
