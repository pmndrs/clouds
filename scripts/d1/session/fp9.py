#!/usr/bin/env python3
# D1 round 7: before/after measures of the named fingerprints on the judged crops (round 6 captures vs round 7 captures vs the frame).
import sys, os, numpy as np
from PIL import Image
ROOT = '/Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11'
os.chdir(ROOT); sys.path.insert(0, 'scripts/d1'); import d1
d0 = d1.d0
R6 = 'work/captures/scratch/d1/r8-final'; R7 = 'work/captures/D1'
def L(p, w=1920):
    im = Image.open(p).convert('L'); im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS) if im.width != w else im
    return np.asarray(im).astype(float) / 255
def slit(a):   # t3 trunk: deepest column dip in the window around (1120, 760) relative to the window mean
    w = a[720:800, 1090:1150]; col = w.mean(0); return round(float(col.min() / w.mean()), 3)
def pits(a):   # t3 lower body: the two elliptical pits at (920, 715) and (1120, 765): local min over a 30 px disc vs the 90 px ring mean
    out = []
    for (x, y) in [(920, 715), (1120, 765)]:
        inner = a[y - 15:y + 15, x - 15:x + 15].mean(); ring = a[y - 45:y + 45, x - 45:x + 45].mean(); out.append(round(float(inner / ring), 3))
    return out
def flecks(a, box):   # bright local maxima in the shade core: count of pixels above the 24 px local mean by > 0.04 inside the box
    x, y, w, h = box; sub = a[y:y + h, x:x + w]; loc = d0.box_blur(sub, 12); return round(float(((sub - loc) > 0.04).mean()), 4)
def crease(a, box):   # 1-2 px energy (sparkle) in the crease box
    x, y, w, h = box; sub = a[y:y + h, x:x + w]; return round(float((sub - d0.box_blur(sub, 1)).std()), 4)
ref = {b: L(d1.ref_of(b)) for b in ['s33t3', 's206', 'p213', 'p101']}
r6 = {b: L(f'{R6}/{"parkouring" if b[0] == "p" else "stormbird"}/{b}@look:decima.png') for b in ref}
r7 = {b: L(f'{R7}/{"parkouring" if b[0] == "p" else "stormbird"}/{b}@look:decima.png') for b in ref}
print('t3 trunk slit (column dip, 1 = none):   ref', slit(ref['s33t3']), 'r8', slit(r6['s33t3']), 'r9', slit(r7['s33t3']))
print('t3 pits (inner/ring, 1 = none):          ref', pits(ref['s33t3']), 'r8', pits(r6['s33t3']), 'r9', pits(r7['s33t3']))
fb = (640, 300, 360, 200)
print('s181 shade-core flecks (fraction > +0.04): ref', flecks(ref['s206'], fb), 'r8', flecks(r6['s206'], fb), 'r9', flecks(r7['s206'], fb))
cb = (860, 580, 120, 80)
print('s191 crease sparkle (1-2 px std):         ref', crease(ref['p213'], cb), 'r8', crease(r6['p213'], cb), 'r9', crease(r7['p213'], cb))
