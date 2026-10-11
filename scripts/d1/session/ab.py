#!/usr/bin/env python3
# D1 round 11: an A/B crop sheet for one change: frame | anchor | change, on the judged regions of a framing, with the band measure per crop.
# ab.py <out.jpg> <frame> <anchor.png> <change.png> [regions: name=x,y,w,h ...]  (1080p coordinates; crops at 2x; a 4k image is used at 1:1 x2 box)
import sys, os, numpy as np
from PIL import Image, ImageDraw
ROOT = '/Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11'; os.chdir(ROOT); sys.path.insert(0, 'scripts/d1'); import d1
REG = {'p101': [('tower', (1150, 180, 400, 520)), ('leftmass', (350, 330, 500, 330)), ('towershade', (1200, 300, 200, 200))],
       'p213': [('tower', (1100, 150, 480, 560)), ('base', (300, 560, 900, 300)), ('crease', (820, 540, 220, 160))],
       's206': [('leg', (40, 520, 560, 340)), ('body', (560, 180, 700, 500)), ('chip', (1100, 500, 160, 120))],
       's33t3': [('upper', (500, 100, 700, 450)), ('trunk', (960, 620, 300, 300)), ('base', (650, 600, 700, 300))]}
def crop(p, b):
    x, y, w, h = b; im = Image.open(p).convert('RGB')
    if im.width >= 3000: return im.crop((2 * x, 2 * y, 2 * (x + w), 2 * (y + h)))
    im = im if im.width == 1920 else im.resize((1920, 1080), Image.LANCZOS)
    return im.crop((x, y, x + w, y + h)).resize((2 * w, 2 * h), Image.LANCZOS)
def main(out, frame, a, b, regions=None):
    regs = [(r.split('=')[0], tuple(int(v) for v in r.split('=')[1].split(','))) for r in regions] if regions else REG[frame]
    rows = []
    for name, box in regs:
        tiles = [(lab, crop(p, box)) for lab, p in (('frame', d1.ref_of(frame)), ('A ' + os.path.basename(a).split('decima')[-1][:-4], a), ('B ' + os.path.basename(b).split('decima')[-1][:-4], b))]
        meas = [d1.bands3_of(np.asarray(t.convert('L')).astype(float)) for _, t in tiles]
        rows.append((name, tiles, meas))
    W = max(sum(t.width for _, t in r[1]) + 24 for r in rows); H = sum(r[1][0][1].height + 30 for r in rows) + 10
    sheet = Image.new('RGB', (W, H), (24, 24, 24)); d = ImageDraw.Draw(sheet); y = 6
    for name, tiles, meas in rows:
        x = 6
        for (lab, t), m in zip(tiles, meas):
            sheet.paste(t, (x, y + 22)); d.text((x + 2, y + 4), f'{frame} {name} {lab[:60]}  {m[0]:.2f} / {m[1]:.2f} / {m[2]:.2f}', fill=(255, 255, 0)); x += t.width + 8
        y += tiles[0][1].height + 30
    sheet.save(out, quality=90); print(out, sheet.size, [(r[0], [tuple(round(v, 2) for v in m) for m in r[2]]) for r in rows])
if __name__ == '__main__': main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5:] or None)
