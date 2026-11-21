#!/usr/bin/env python3
"""P1.1b: region ratios (realtime / averaged PT, P1.1's references and masks) of realtime frames captured elsewhere.
usage: score.py <frames dir> <cloud> [suns...]   reads <frames dir>/nubis-<sun>.pfm; prints one row per sun (cloud thick base fringe)."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'P1-1'))
import p11  # noqa: E402
sc = p11.sc

d, cloud = Path(sys.argv[1]), sys.argv[2]
suns = sys.argv[3:] or p11.SUNS
ref = HERE.parent / 'P1-1' / cloud
for sun in suns:
    f = d / f'nubis-{sun}.pfm'
    if not f.exists():
        continue
    alpha = sc.as_mask(sc.read_pfm(ref / f'alpha-{sun}.pfm'))
    pt, _ = sc.averaged_reference(sc.read_pfm(ref / f'pt-{sun}.pfm'), sc.read_pfm(ref / 'seed2' / f'pt-{sun}.pfm'))
    r = p11.ratios(sc.read_pfm(f), pt, alpha)
    print(f'| {cloud}-{sun} | ' + ' | '.join('-' if r[k] is None else (f'**{r[k]:.3f}**' if abs(r[k] - 1) > 0.05 else f'{r[k]:.3f}') for k in p11.REGIONS) + ' |')
