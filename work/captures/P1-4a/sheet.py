#!/usr/bin/env python3
"""P1.4a sheet: path traced (2 seeds, /2) | fit (defaults) at sun low and sunset; region luminance ratios and B/R (P1.2c regions)."""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location('fit_p12b', HERE.parent / 'P1-2b' / 'fit.py')
F = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(F)
sc = F.sc
FRAMES = [(c, s) for c in ['sky', 'embergen02'] for s in ['low', 'sunset']]


def br(img, m):
    return img[..., 2][m].mean() / img[..., 0][m].mean()


rows, tile_h = [], 220
print('| frame | ' + ' | '.join(F.REGIONS) + ' | B/R cloud pt / fit | B/R dark20 pt / fit |\n|---|' + '---|' * (len(F.REGIONS) + 2))
for cloud, sun in FRAMES:
    reg, pt = F.reference(cloud, sun)
    fit = sc.read_pfm(HERE / cloud / f'fit-{sun}.pfm')[..., :3]
    a = F.half(sc.as_mask(sc.read_pfm(F.REF / cloud / f'alpha-{sun}.pfm'))[..., None])
    rf = F.means(fit, reg) / F.means(pt, reg)
    brs = [(br(pt, reg[k]), br(fit, reg[k])) for k in ['cloud', 'dark20']]
    print(f'| {cloud} {sun} | ' + ' | '.join(f'**{v:.2f}**' if abs(v - 1) > 0.2 else f'{v:.2f}' for v in rf) + ' | '
          + ' | '.join(f'{p:.2f} / {f:.2f}' for p, f in brs) + ' |')
    ys, xs = np.nonzero(a > 0.02)
    h, w = a.shape
    mg = 10
    y0, y1, x0, x1 = max(0, ys.min() - mg), min(h, ys.max() + mg), max(0, xs.min() - mg), min(w, xs.max() + mg)
    tiles = []
    for img in [pt, fit]:
        t = Image.fromarray((np.clip(sc.aces_srgb(img[y0:y1, x0:x1], 0.35), 0, 1) * 255).astype(np.uint8))
        tiles.append(t.resize((max(1, int(t.size[0] * tile_h / t.size[1])), tile_h), Image.LANCZOS))
    rows.append((f'{cloud} {sun}', tiles, rf, brs))
pad, lh = 6, 16
W = max(sum(t.size[0] for t in ts) + pad * 3 for _, ts, _, _ in rows)
H = 20 + len(rows) * (tile_h + lh + pad) + pad
out = Image.new('RGB', (W, H), (18, 18, 20))
dr = ImageDraw.Draw(out)
dr.text((pad, 4), 'P1.4a: path traced (2 seeds, /2) | fit (P1.2c defaults) at sun low / sunset; linear 640x360, page ACES at 0.35; ratios cloud thick base dark20 bright20; B/R cloud, dark20',
        fill=(230, 230, 230))
for i, (lab, ts, rf, brs) in enumerate(rows):
    y, x = 20 + i * (tile_h + lh + pad), pad
    labels = [f'{lab}: pt  B/R {brs[0][0]:.2f} {brs[1][0]:.2f}',
              'fit x' + ' '.join(f'{v:.2f}' for v in rf) + f'  B/R {brs[0][1]:.2f} {brs[1][1]:.2f}']
    for lab_, t in zip(labels, ts):
        dr.text((x, y), lab_, fill=(210, 210, 210))
        out.paste(t, (x, y + lh))
        x += t.size[0] + pad
if out.size[0] > 1400:
    out = out.resize((1400, int(out.size[1] * 1400 / out.size[0])), Image.LANCZOS)
out.save(HERE / 'sheet.jpg', quality=82)
print(HERE / 'sheet.jpg', (HERE / 'sheet.jpg').stat().st_size // 1024, 'KB')
