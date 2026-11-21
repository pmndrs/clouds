#!/usr/bin/env python3
"""P1.2c sheet: path traced (2 seeds, /2) | fit (P1.2c defaults: <cloud>/final) | nubis (P1.2a's frames, unchanged), the P1.2a layout."""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location('fit_p12b', HERE.parent / 'P1-2b' / 'fit.py')
F = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(F)
sc = F.sc
NUBIS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/Users/dex/Developer/WebGPUClouds/.claude/worktrees/agent-ab50b258c64ef6215/work/captures/P1-2a')

rows, tile_h = [], 200
for cloud, sun in F.FRAMES:
    reg, pt = F.reference(cloud, sun)
    fit = sc.read_pfm(HERE / cloud / 'final' / f'fit-{sun}.pfm')[..., :3]
    nub = sc.read_pfm(NUBIS / cloud / f'nubis-{sun}.pfm')[..., :3]
    a = F.half(sc.as_mask(sc.read_pfm(F.REF / cloud / f'alpha-{sun}.pfm'))[..., None])
    rf, rn = F.means(fit, reg) / F.means(pt, reg), F.means(nub, reg) / F.means(pt, reg)
    ys, xs = np.nonzero(a > 0.02)
    h, w = a.shape
    mg = 10
    y0, y1, x0, x1 = max(0, ys.min() - mg), min(h, ys.max() + mg), max(0, xs.min() - mg), min(w, xs.max() + mg)
    tiles = []
    for img in [pt, fit, nub]:
        t = Image.fromarray((np.clip(sc.aces_srgb(img[y0:y1, x0:x1], 0.35), 0, 1) * 255).astype(np.uint8))
        tiles.append(t.resize((max(1, int(t.size[0] * tile_h / t.size[1])), tile_h), Image.LANCZOS))
    rows.append((f'{cloud} {sun}', tiles, rf, rn))
pad, lh = 6, 16
W = max(sum(t.size[0] for t in ts) + pad * 4 for _, ts, _, _ in rows)
H = 20 + len(rows) * (tile_h + lh + pad) + pad
out = Image.new('RGB', (W, H), (18, 18, 20))
dr = ImageDraw.Draw(out)
dr.text((pad, 4), 'P1.2c: path traced (2 seeds, /2) | fit (RGB fit: ms 2.58 fwd 0.2, K 0.4, ambient 0.33 kUp 0.05, ground 0.31) | nubis; linear 640x360 through the page ACES at 0.35;'
        ' ratios cloud thick base dark20 bright20', fill=(230, 230, 230))
for i, (lab, ts, rf, rn) in enumerate(rows):
    y, x = 20 + i * (tile_h + lh + pad), pad
    labels = [f'{lab}: pt', 'fit x' + ' '.join(f'{v:.2f}' for v in rf), 'nubis x' + ' '.join(f'{v:.2f}' for v in rn)]
    for lab_, t in zip(labels, ts):
        dr.text((x, y), lab_, fill=(210, 210, 210))
        out.paste(t, (x, y + lh))
        x += t.size[0] + pad
if out.size[0] > 1400:
    out = out.resize((1400, int(out.size[1] * 1400 / out.size[0])), Image.LANCZOS)
out.save(HERE / 'sheet.jpg', quality=82)
print(HERE / 'sheet.jpg', (HERE / 'sheet.jpg').stat().st_size // 1024, 'KB')
