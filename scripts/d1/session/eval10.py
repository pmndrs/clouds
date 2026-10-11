#!/usr/bin/env python3
# D1 round 10: one-shot evaluation of a capture directory: the floret metric + lit-half bands on the judged crops (floreteval), d1.py stats
# (corr, lit p90, shade p10, pit) per bookmark, the s191 crease p5, cloud-only colour ratios, and the sky rows against the frame.
import sys, os, glob, subprocess, numpy as np
from PIL import Image
ROOT = '/Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11'; os.chdir(ROOT); sys.path.insert(0, 'scripts/d1'); import d1
S = '/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad'
W = np.array([0.2126, 0.7152, 0.0722])
def cloud(f): return 'parkouring' if f[0] == 'p' else 'stormbird'
def rgb(p):
    im = Image.open(p).convert('RGB')
    if im.width != 1920: im = im.resize((1920, 1080), Image.LANCZOS)
    return np.asarray(im).astype(float) / 255
def erode(m, r):
    out = m.copy()
    for dy in range(-r, r + 1, r):
        for dx in range(-r, r + 1, r): out &= np.roll(np.roll(m, dy, 0), dx, 1)
    return out
def colour(a, m):
    c = a[m]; l = c @ W; out = []
    for nm, sel in (('lit', l > 0.78), ('mid', (l > 0.6) & (l < 0.72)), ('shade', (l > 0.35) & (l < 0.55))):
        m3 = c[sel].mean(0) if sel.sum() > 200 else np.array([1, 1, 1.0]); out.append(f'{nm} {m3[0] / m3[1]:.3f}/{m3[2] / m3[1]:.3f}')
    return ' | '.join(out)
def skyrows(a, m):
    l = a @ W; out = []
    for y0, y1 in ((0, 60), (600, 660), (900, 960), (1020, 1080)):
        mm = m[y0:y1]; out.append(f'{l[y0:y1][mm].mean():.2f}' if mm.sum() > 400 else '-')
    return '/'.join(out)
def main(d, frames, florets=True):
    files = {f: [p for p in sorted(glob.glob(f'{d}/{f}@*'), key=len) if 'matte' not in p and 'lightDebug' not in p] for f in frames}
    if florets:
        fl = [f for f in frames if f in ('p101', 'p213', 's206', 's33t3') and files[f]]
        if fl: print(subprocess.run(['python3', '-I', f'{S}/d1/floreteval.py', d, ','.join(fl)], capture_output=True, text=True).stdout.replace('floret=', '').split('\n')[0] if False else subprocess.run(['python3', '-I', f'{S}/d1/floreteval.py', d, ','.join(fl)], capture_output=True, text=True).stdout)
    for f in frames:
        if not files[f]: continue
        print(f'== {f} stats'); r = subprocess.run(['python3', '-I', 'scripts/d1/d1.py', 'stats', d1.ref_of(f)] + files[f], capture_output=True, text=True)
        for line in r.stdout.splitlines(): print('  ' + line[:230])
        mpath = f'work/captures/D1/{cloud(f)}/{f}@look:decima@matte.png'
        if os.path.exists(mpath):
            mt = np.asarray(Image.open(mpath).convert('L')); mc = erode(mt > 200, 12); ms = mt < 8
            fa = rgb(d1.ref_of(f)); print(f'  colour  {"frame":48s} {colour(fa, mc)}   sky rows {skyrows(fa, ms)}')
            for p in files[f]:
                a = rgb(p); print(f'  colour  {os.path.basename(p).split("decima")[-1].rsplit(".", 1)[0] or " base":48s} {colour(a, mc)}   sky rows {skyrows(a, ms)}')
        if f == 'p213':
            def crease(p):
                im = Image.open(p).convert('RGB'); im = im if im.width == 3840 else im.resize((3840, 2160), Image.LANCZOS)
                l = (np.asarray(im).astype(float) / 255 @ W)[1000:1420, 1560:2160]; return f'p5 {np.percentile(l, 5):.3f} p25 {np.percentile(l, 25):.3f}'
            print(f'  crease  frame {crease(d1.ref_of(f))}')
            for p in files[f]: print(f'  crease  {os.path.basename(p).split("decima")[-1].rsplit(".", 1)[0] or " base":48s} {crease(p)}')
if __name__ == '__main__': main(sys.argv[1], sys.argv[2].split(','), '--no-florets' not in sys.argv)
