#!/usr/bin/env python3
# D1 round 6: sheets (sheets-r11) and blind set f: Decima frame, decima round 5, decima round 6, same four frames and eight crop regions, PNG.
import os, json, random, sys, shutil
from PIL import Image, ImageDraw
ROOT = '/Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11'
os.chdir(ROOT); sys.path.insert(0, 'scripts/d1'); import d1
S = '/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad'
SH = '/Users/dex/Developer/WebGPUClouds/artifacts/research/d1-parity/sheets-r11'; os.makedirs(SH, exist_ok=True)
K6 = 'work/captures/scratch/d1/final11-4k'; K5 = 'work/captures/scratch/d1/r9-final/4k'; R5 = "work/captures/scratch/d1/r9-final"
def load(p, w):
    im = Image.open(p).convert('RGB'); return im if im.width == w else im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
REGIONS = {'p101': [('tower', (1150, 180, 400, 520)), ('leftmass', (350, 330, 500, 330)), ('towershade', (1200, 300, 200, 200))], 'p213': [('tower', (1100, 150, 480, 560)), ('base', (300, 560, 900, 300)), ('crease', (820, 540, 220, 160))],
           's206': [('leg', (40, 520, 560, 340)), ('body', (560, 180, 700, 500)), ('chip', (1100, 500, 160, 120))], 's33t3': [('base', (650, 600, 700, 300)), ('upper', (500, 100, 700, 450)), ('trunk', (960, 620, 300, 300))]}
def cloud(f): return 'parkouring' if f[0] == 'p' else 'stormbird'
def src(f):
    if f in ('p101', 'p213'): return {'decima-reference': d1.ref_of(f), 'decima-r9': f'{K5}/{f}@look:decima.jpg', 'decima-r11': f'{K6}/{f}@look:decima.jpg'}
    return {'decima-reference': d1.ref_of(f), 'decima-r9': f'{R5}/{cloud(f)}/{f}@look:decima.png', 'decima-r11': f'work/captures/D1/{cloud(f)}/{f}@look:decima.png'}
# full-frame sheets for all nine bookmarks: ref | r6 | r5 | art
for b in ['p101', 'p125', 'p161', 'p213', 's206', 's33t3', 's33t6', 's33t9', 's214']:
    tiles = [(d1.ref_of(b), 'reference'), (f'work/captures/D1/{cloud(b)}/{b}@look:decima.png', 'decima r11'), (f'{R5}/{cloud(b)}/{b}@look:decima.png', 'decima r9'), (f'work/captures/D1/{cloud(b)}/{b}@look:art.png', 'art r11')]
    ims = []
    for p, lab in tiles:
        im = load(p, 1920); ImageDraw.Draw(im).text((6, 6), lab, fill=(255, 255, 0)); ims.append(im)
    sheet = Image.new('RGB', (2 * 1930, 2 * 1090), (30, 30, 30))
    for i, im in enumerate(ims): sheet.paste(im, ((i % 2) * 1930, (i // 2) * 1090))
    sheet.save(f'{SH}/D1k-{b}.jpg', quality=92)
crops = []
for f, regs in REGIONS.items():
    n4 = f in ('p101', 'p213'); ims = {k: load(p, 3840 if n4 else 1920) for k, p in src(f).items()}
    for rname, (x, y, w, h) in regs:
        row = []
        for k in ['decima-reference', 'decima-r9', 'decima-r11']:
            im = ims[k]; c = im.crop((2 * x, 2 * y, 2 * (x + w), 2 * (y + h))) if n4 else im.crop((x, y, x + w, y + h)).resize((2 * w, 2 * h), Image.LANCZOS)
            crops.append((f, rname, k, c)); row.append((k, c))
        sheet = Image.new('RGB', (sum(c.width for _, c in row) + 20, row[0][1].height), (30, 30, 30)); xx = 0
        for k, c in row: sheet.paste(c, (xx, 0)); ImageDraw.Draw(sheet).text((xx + 4, 4), f'{f} {rname} {k}', fill=(255, 255, 0)); xx += c.width + 10
        sheet.save(f'{SH}/D1k-crop-{f}-{rname}.png')
out = os.path.join(S, 'blind-d1k'); key = os.path.join(S, 'blind-d1k-key')
for d in (out, key): shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
random.seed(20261021); k = {}
full = []
for f in ['p101', 'p213', 's206', 's33t3']:
    full += [(f, 'decima-reference', d1.ref_of(f)), (f, 'decima-r9', f'{R5}/{cloud(f)}/{f}@look:decima.png'), (f, 'decima-r11', f'work/captures/D1/{cloud(f)}/{f}@look:decima.png')]
ids = list(range(1, len(full) + 1)); random.shuffle(ids)
def rt(im):
    import io; b = io.BytesIO(); im.save(b, 'JPEG', quality=90); b.seek(0); return Image.open(b).convert('RGB')
for (f, s_, p), i in zip(full, ids): rt(load(p, 1920)).save(os.path.join(out, f'd{i:02d}.png')); k[f'd{i:02d}.png'] = {'frame': f, 'source': s_, 'kind': 'full', 'treatment': 'JPEG q90 round-trip (all sources)'}
ids = list(range(1, len(crops) + 1)); random.shuffle(ids)
for (f, r, s_, c), i in zip(crops, ids): rt(c).save(os.path.join(out, f'c{i:02d}.png')); k[f'c{i:02d}.png'] = {'frame': f, 'region': r, 'source': s_, 'kind': 'crop', 'scale': 'native 4k' if f in ('p101', 'p213') else '2x of 1080p', 'treatment': 'JPEG q90 round-trip (all sources)'}
k['_note'] = 'Every image (Decima frame, round 9, round 11; full frames and crops) went through the same JPEG q90 round-trip before saving as PNG, so the judges compare looks rather than encoders (the renders dither, the frames carry 8x8 blocking).'
json.dump(k, open(os.path.join(key, 'key.json'), 'w'), indent=1); print(len(full), len(crops))
