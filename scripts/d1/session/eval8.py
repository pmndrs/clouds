#!/usr/bin/env python3
# D1 round 8: the judges' band measure on the judged 4k crops of p101 / p213 for a set of 4k captures, plus crop sheets.
import sys, os, glob, re, numpy as np
from PIL import Image, ImageDraw
ROOT = '/Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11'
os.chdir(ROOT); sys.path.insert(0, 'scripts/d1'); import d1
d0 = d1.d0
S = '/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad/d1'
# judged regions in 1080p coordinates -> 4k boxes
REG = {'p101': {'tower': (1150, 180, 400, 520), 'towershade': (1200, 300, 200, 200), 'leftmass': (350, 330, 500, 330)},
       'p213': {'tower': (1100, 150, 480, 560), 'crease': (820, 540, 220, 160), 'base': (300, 560, 900, 300)}}
def box4k(b): x, y, w, h = b; return (2 * x, 2 * y, 2 * (x + w), 2 * (y + h))
def lum(p, box):
    im = Image.open(p).convert('L'); im = im.resize((3840, 2160), Image.LANCZOS) if im.width != 3840 else im
    return np.asarray(im.crop(box)).astype(float)
def main(dirs, label_split, sheet_prefix, frames=('p101', 'p213'), regions=None):
    files = []
    for d in dirs: files += sorted(glob.glob(f'{d}/*.jpg'))
    for f in frames:
        regs = regions or REG[f]
        for rname, b in regs.items():
            bx = box4k(b)
            rows = [('frame', d1.bands3_of(lum(d1.ref_of(f), bx)))]
            tiles = []
            for p in files:
                if not os.path.basename(p).startswith(f): continue
                tag = os.path.basename(p).split(label_split)[-1].replace('.jpg', '') or ' (base)'
                rows.append((tag, d1.bands3_of(lum(p, bx))))
                im = Image.open(p).convert('RGB').crop(bx); tiles.append((tag, im))
            print(f'== {f} {rname} (b1-3 / b4-12 / b12-32)')
            for tag, v in rows: print(f'   {tag[:70]:70} {v[0]:5.2f} {v[1]:5.2f} {v[2]:5.2f}')
            if sheet_prefix and tiles:
                ref = Image.open(d1.ref_of(f)).convert('RGB').crop(bx); tiles = [('frame', ref)] + tiles
                w, h = tiles[0][1].size; sc = min(1.0, 600 / max(w, h)); tw, th = int(w * sc), int(h * sc)
                cols = min(4, len(tiles)); rowsn = (len(tiles) + cols - 1) // cols
                sheet = Image.new('RGB', (cols * (tw + 6), rowsn * (th + 6)), (30, 30, 30))
                for i, (tag, im) in enumerate(tiles):
                    t = im.resize((tw, th), Image.LANCZOS); ImageDraw.Draw(t).text((4, 4), tag[:60], fill=(255, 0, 0)); sheet.paste(t, ((i % cols) * (tw + 6), (i // cols) * (th + 6)))
                sheet.save(f'{S}/{sheet_prefix}-{f}-{rname}.png')
if __name__ == '__main__':
    dirs = sys.argv[1].split(','); split = sys.argv[2]; prefix = sys.argv[3] if len(sys.argv) > 3 else ''
    main(dirs, split, prefix)
