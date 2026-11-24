#!/usr/bin/env python3
"""P1.8a: the evals file for one page load: the fit model's terms one at a time (converged linear frames), after P1-4b/gen.py.

  gen.py ['{"fitSkySide": 1}'] > evals.json     names: zero, direct, ms, sky, ground, sky_k0 (sky with fitKUp 0: not attenuated), full
Every config sets all four gains, so the order does not matter; the defaults come back with the last one ('full').
The optional JSON is merged into every config (e.g. a new setting under test).
"""
import json
import sys

D = dict(fitDirect=1, fitMs=2.47, fitAmbient=0.62, fitGround=0.61, fitKUp=0.3)
OFF = dict(fitDirect=0, fitMs=0, fitAmbient=0, fitGround=0, fitKUp=0.3)
CONFIGS = {
    'zero': OFF,
    'direct': {**OFF, 'fitDirect': 1},
    'ms': {**OFF, 'fitMs': D['fitMs']},
    'sky': {**OFF, 'fitAmbient': D['fitAmbient']},
    'ground': {**OFF, 'fitGround': D['fitGround']},
    'sky_k0': {**OFF, 'fitAmbient': D['fitAmbient'], 'fitKUp': 0},
    'full': D,
}
WAIT = """(async () => { const c = window.__clouds; const cv = () => c.report().p11.convergedInfo; const raf = () => new Promise(r => requestAnimationFrame(r));
  const r0 = cv().restarts; c.setSettings(%s); const t = performance.now();
  while (cv().restarts === r0) { await raf(); if (performance.now() - t > 5000) throw new Error('no restart'); }
  while (!cv().done) { await raf(); if (performance.now() - t > 30000) throw new Error('not converged'); }
  for (let i = 0; i < 2; i++) await raf();
  return c.readLinear(); })()"""

if __name__ == '__main__':
    extra = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    print(json.dumps([{'name': n, 'expr': WAIT % json.dumps({**cfg, **{k: v for k, v in extra.items() if not (n == 'sky_k0' and k == 'fitKUp')}}), 'linear': True}
                      for n, cfg in CONFIGS.items()], indent=1))
