#!/usr/bin/env python3
"""P1.1: the capture.mjs --evals list run after each cloud's shots: the realtime direct term with the sun at the volume centre (sunAtCentre)
and the light probes (lightProbe = view optical depth, modes 0 and 1), per sun. Writes evals.json next to this file."""
import json
from pathlib import Path

DEPTHS = [0.05, 0.3, 1, 3, 10]
ev = []


def e(name, settings, view):
    s = json.dumps(settings)
    ev.append({'name': name, 'linear': True,
               'expr': f"(async () => {{ const c = window.__clouds; c.setSettings({s}); await c.bookmark('{view}'); await c.settle(4); return await c.readLinear(); }})()"})


for sun in ['noon', 'low', 'backlit', 'sunset']:
    e(f'nubis-{sun}-centre', {'sunAtCentre': 1, 'lightProbe': 0, 'convergedSamples': 16}, f'nubis-{sun}')
    for D in DEPTHS:
        for m in [0, 1]:
            e(f'probe-{sun}-d{D}-m{m}', {'sunAtCentre': 0, 'lightProbe': D, 'lightProbeMode': m, 'convergedSamples': 1}, f'nubis-{sun}')
ev.append({'name': 'reset', 'expr': "window.__clouds.setSettings({lightProbe: 0, sunAtCentre: 0, convergedSamples: 16})"})
(Path(__file__).parent / 'evals.json').write_text(json.dumps(ev, indent=1))
print(len(ev), 'evals')
