#!/usr/bin/env python3
# D1 round 8: fill PARITY8_TABLE from final8-stats.txt (rows: REF, decima r8, decima r6 (same masks), art, deck) and the judges' measure on the blind-set crops.
import re, json, os, sys, numpy as np
from PIL import Image
ROOT = '/Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11'; os.chdir(ROOT); sys.path.insert(0, 'scripts/d1'); import d1
S = '/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad'
F = f'{S}/d1/final8-stats.txt'
rows = {}; cur = None
for line in open(F):
    line = line.rstrip()
    if line.startswith('== '): cur = line[3:]; rows[cur] = []; continue
    if not cur or not line.strip(): continue
    nums = re.findall(r'-?\d+\.\d+', line.split('shade(')[0]); sh = re.search(r'shade\(([^)]*)\)', line).group(1).split(','); li = re.search(r'lit\(([^)]*)\)', line).group(1).split(',')
    rows[cur].append((line.split()[0], nums, sh, li))
f2 = lambda v: f'{float(v):.2f}'; rgb = lambda v: '/'.join(f'.{round(float(x) * 100):02d}' for x in v)
out = ['| Frame | corr r8 / r6 / art | median | lit p90 | shade p10 | cloud:sky | shade RGB (ref) | lit RGB (ref) | edge | pit | shadow grain | relief |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |']
for fr, r in rows.items():
    R = r[0][1]; d8 = r[1]; d6 = r[2]; art = r[3]; D = d8[1][2:]
    out.append(f"| {fr} | {d8[1][1]} / {d6[1][1]} / {art[1][1]} | {f2(D[0])} ({f2(R[0])}) | {f2(D[1])} ({f2(R[1])}) | {f2(D[2])} ({f2(R[2])}) | {f2(D[4])} ({f2(R[4])}) | {rgb(d8[2])} ({rgb(r[0][2])}) | {rgb(d8[3])} ({rgb(r[0][3])}) | {f2(D[8])} ({f2(R[8])}) | {D[9]} ({R[9]}) | {D[12]} ({R[12]}) | {D[13]} ({R[13]}) |")
# the judges' measure on the blind-set crops (frame / r6 / r8)
key = json.load(open(f'{S}/blind-d1h-key/key.json'))
bands = {}
for f, v in key.items():
    if v['kind'] != 'crop': continue
    a = np.asarray(Image.open(f'{S}/blind-d1h/{f}').convert('L')).astype(float)
    bands.setdefault((v['frame'], v['region']), {})[v['source']] = d1.bands3_of(a)
tab = ['| Crop | frame | round 6 | round 8 |', '| --- | --- | --- | --- |']
for k in sorted(bands):
    b = bands[k]; g = lambda s_: ' / '.join(f'{x:.2f}' for x in b[s_]) if s_ in b else ''
    tab.append(f"| {k[0]} {k[1]} | {g('decima-reference')} | {g('decima-r6')} | {g('decima-r8')} |")
table = '\n'.join(out) + '\nRound 6 is the round-6 render in the round-8 masks (same cameras).\n\nThe judges\' measure on the blind-set crops (1-3 / 4-12 / 12-32 px band std, 8-bit units; the crops the judges see):\n' + '\n'.join(tab)
p = 'work/reports/D1.md'; s = open(p).read(); s = s.replace('PARITY8_TABLE', table).replace('STAB8_LINE\n', ''); open(p, 'w').write(s); print('table ok', s.count('PARITY8_TABLE'))
