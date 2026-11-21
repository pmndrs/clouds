#!/usr/bin/env python3
"""P1.4b sheet: path traced (2 seeds, /2) | fit (refitted defaults) for 2 clouds x 4 suns, as a 4 x 2 grid of pairs; page ACES at 0.35."""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location('fit_p14b', HERE / 'fit.py')
P = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(P)
F, C, sc = P.F, P.C, P.sc
SUNS = ['noon', 'low', 'backlit', 'sunset']
tile_h, pad, lh = 200, 6, 16
cells = {}
for cloud in ['sky', 'embergen02']:
    for sun in SUNS:
        reg, pt = F.reference(cloud, sun)
        fit = sc.read_pfm(HERE / cloud / 'final' / f'fit-{sun}.pfm')[..., :3]
        a = F.half(sc.as_mask(sc.read_pfm(F.REF / cloud / f'alpha-{sun}.pfm'))[..., None])
        mf, mp = C.rgb_means(fit, reg), C.rgb_means(pt, reg)
        rf = C.lum(mf) / C.lum(mp)
        ys, xs = np.nonzero(a > 0.02)
        h, w = a.shape
        y0, y1, x0, x1 = max(0, ys.min() - 10), min(h, ys.max() + 10), max(0, xs.min() - 10), min(w, xs.max() + 10)
        tiles = []
        for img in [pt, fit]:
            t = Image.fromarray((np.clip(sc.aces_srgb(img[y0:y1, x0:x1], 0.35), 0, 1) * 255).astype(np.uint8))
            tiles.append(t.resize((max(1, int(t.size[0] * tile_h / t.size[1])), tile_h), Image.LANCZOS))
        cells[(cloud, sun)] = (tiles, rf, (C.br20(mp), C.br20(mf)))
colw = {c: max(sum(t.size[0] for t in cells[(c, s)][0]) + pad for s in SUNS) for c in ['sky', 'embergen02']}
W = pad + colw['sky'] + pad * 3 + colw['embergen02'] + pad
H = 22 + len(SUNS) * (tile_h + 2 * lh + pad) + pad
out = Image.new('RGB', (W, H), (18, 18, 20))
dr = ImageDraw.Draw(out)
dr.text((pad, 4), 'P1.4b: path traced (2 seeds, /2) | fit (refitted on 4 suns); linear 640x360, page ACES at 0.35; fit/pt lum: cloud thick base dark20 bright20; B/R dark20 pt / fit',
        fill=(230, 230, 230))
for j, cloud in enumerate(['sky', 'embergen02']):
    x0 = pad if j == 0 else pad + colw['sky'] + pad * 3
    for i, sun in enumerate(SUNS):
        tiles, rf, b = cells[(cloud, sun)]
        y, x = 22 + i * (tile_h + 2 * lh + pad), x0
        dr.text((x, y), f'{cloud} {sun}: pt | fit   x ' + ' '.join(f'{v:.2f}' for v in rf) + f'   B/R dark20 {b[0]:.2f} / {b[1]:.2f}', fill=(210, 210, 210))
        for t in tiles:
            out.paste(t, (x, y + lh))
            x += t.size[0] + pad
if out.size[0] > 1600:
    out = out.resize((1600, int(out.size[1] * 1600 / out.size[0])), Image.LANCZOS)
out.save(HERE / 'sheet.jpg', quality=82)
print(HERE / 'sheet.jpg', (HERE / 'sheet.jpg').stat().st_size // 1024, 'KB')
