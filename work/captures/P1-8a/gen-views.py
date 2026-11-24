#!/usr/bin/env python3
"""P1.8a: evals for one page load: fit-sunward / fit-noon / fit-low with fitSkySide off (defaults) and on, each a converged linear frame.

  gen-views.py > evals.json     names: <view>-off, <view>-on, <view>-side (fitSkySide 1 alone; sunward only)
'on' = fitSkySide 1 with fitGroundAtten 1 (the ground light through the same depth); 'side' = fitSkySide 1, ground unattenuated.
"""
import json

OFF = dict(fitSkySide=0, fitGroundAtten=0)
ON = dict(fitSkySide=1, fitGroundAtten=1)
SIDE = dict(fitSkySide=1, fitGroundAtten=0)
EXPR = """(async () => { const c = window.__clouds; c.setSettings(%s); await c.bookmark(%s); await c.settle(400); return c.readLinear(); })()"""
evals = []
for view in ['fit-sunward', 'fit-noon', 'fit-low']:
    for name, cfg in [('off', OFF), ('on', ON)] + ([('side', SIDE)] if view == 'fit-sunward' else []):
        evals.append({'name': f'{view}-{name}', 'expr': EXPR % (json.dumps(cfg), json.dumps(view)), 'linear': True})
print(json.dumps(evals, indent=1))
