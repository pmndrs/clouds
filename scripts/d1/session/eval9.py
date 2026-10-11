#!/usr/bin/env python3
# D1 round 9: Stormbird fingerprint isolation: per-variant crops of the named regions (3x) and the judges' measure on the trunk / chip regions.
import sys, os, glob, numpy as np
from PIL import Image, ImageDraw
ROOT = '/Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11'; os.chdir(ROOT); sys.path.insert(0, 'scripts/d1'); import d1
d0 = d1.d0
S = '/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad/d1'
REG = {'s33t3': {'trunk': (960, 620, 300, 300), 'ring': (1020, 670, 140, 100), 'bulge': (1180, 570, 150, 190), 'top': (500, 100, 700, 450)},
       's206': {'chip': (1120, 520, 120, 90), 'core': (920, 460, 140, 100), 'shade': (700, 300, 400, 260), 'leg': (40, 520, 560, 340)}}
def lum2x(p, b):
    x, y, w, h = b; im = Image.open(p).convert('L'); im = im.resize((1920, 1080), Image.LANCZOS) if im.width != 1920 else im
    return np.asarray(im.crop((x, y, x + w, y + h)).resize((2 * w, 2 * h), Image.LANCZOS)).astype(float)
def tile(p, b, z, lab):
    x, y, w, h = b; im = Image.open(p).convert('RGB'); im = im.resize((1920, 1080), Image.LANCZOS) if im.width != 1920 else im
    c = im.crop((x, y, x + w, y + h)).resize((w * z, h * z), Image.LANCZOS); ImageDraw.Draw(c).text((4, 4), lab[:48], fill=(255, 0, 0)); return c
def main(d, prefix):
    for f, regs in REG.items():
        files = [p for p in sorted(glob.glob(f'{d}/{f}*.png'), key=len) if 'matte' not in p]
        for r, b in regs.items():
            print(f'== {f} {r}: frame {d1.bands3_of(lum2x(d1.ref_of(f), b))}  r8 {d1.bands3_of(lum2x(f"work/captures/D1/stormbird/{f}@look:decima.png", b))}')
            z = 3 if b[2] <= 300 else 1
            tiles = [tile(d1.ref_of(f), b, z, 'frame')]
            for p in files:
                tag = os.path.basename(p).split('decima')[-1].replace('.png', '') or ' (base)'
                print(f'   {tag[:60]:60} {d1.bands3_of(lum2x(p, b))}')
                tiles.append(tile(p, b, z, tag))
            cols = min(5, len(tiles)); rows = (len(tiles) + cols - 1) // cols; tw, th = tiles[0].size
            sheet = Image.new('RGB', (cols * (tw + 6), rows * (th + 6)), (30, 30, 30))
            for i, t in enumerate(tiles): sheet.paste(t, ((i % cols) * (tw + 6), (i // cols) * (th + 6)))
            sheet.save(f'{S}/{prefix}-{f}-{r}.png')
if __name__ == '__main__': main(sys.argv[1], sys.argv[2])
