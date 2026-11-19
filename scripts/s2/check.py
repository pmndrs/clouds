#!/usr/bin/env python3
"""S2: is a capture dir usable? Prints what is wrong (empty = fine): a lost device, a missing shot, or a shot after the first with no sky-layer timing.
  python3 scripts/s2/check.py DIR SHOTS(comma list)"""
import json, sys
d, shots = sys.argv[1], sys.argv[2].split(',')
try:
    cap = json.load(open(f'{d}/capture.json'))
except Exception:
    print('no capture.json'); sys.exit()
if any('is lost' in c or 'Device Lost' in c for c in cap.get('console', [])):
    print('device lost'); sys.exit()
got = cap.get('shots', [])
if len(got) < len(shots):
    print(f'{len(got)}/{len(shots)} shots'); sys.exit()
bad = [s['name'] for s in got[1:] if not (s.get('report') or {}).get('gpuMs', {}).get('skyLayer')]
if bad: print('no sky in ' + ' '.join(bad))
