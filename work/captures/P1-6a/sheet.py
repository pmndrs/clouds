#!/usr/bin/env python3
"""P1.6a sheet: path trace | fit (two-range ms, refitted defaults) for sky, embergen02 x 4 suns and tower noon, low; page ACES at 0.35 (as P1.4b, P2.4b)."""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location('fit_p16a', HERE / 'fit.py')
P = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(P)
F, C, sc = P.F, P.C, P.sc
SUNS = {'sky': ['noon', 'low', 'backlit', 'sunset'], 'embergen02': ['noon', 'low', 'backlit', 'sunset'], 'tower': ['noon', 'low']}
tile_h, pad, lh = 190, 6, 16
cells = {}
for cloud, suns in SUNS.items():
    for sun in suns:
        reg, pt = P.ref(cloud, sun)
        fit = sc.read_pfm(HERE / cloud / 'final' / f'fit-{sun}.pfm')[..., :3]
        mf, mp = C.rgb_means(fit, reg), C.rgb_means(pt, reg)
        rf = C.lum(mf) / C.lum(mp)
        ys, xs = np.nonzero(reg['cloud'])
        h, w = pt.shape[:2]
        y0, y1, x0, x1 = max(0, ys.min() - 12), min(h, ys.max() + 12), max(0, xs.min() - 12), min(w, xs.max() + 12)
        tiles = []
        for img in [pt, fit]:
            t = Image.fromarray((np.clip(sc.aces_srgb(img[y0:y1, x0:x1], 0.35), 0, 1) * 255).astype(np.uint8))
            tiles.append(t.resize((max(1, int(t.size[0] * tile_h / t.size[1])), tile_h), Image.LANCZOS))
        cells[(cloud, sun)] = (tiles, rf, (C.br20(mp), C.br20(mf)))
colw = {c: max(max(sum(t.size[0] for t in cells[(c, s)][0]) + pad for s in suns), 330) for c, suns in SUNS.items()}
W = pad + sum(colw.values()) + pad * 3 * (len(SUNS) - 1) + pad
H = 36 + 4 * (tile_h + 2 * lh + pad) + pad
out = Image.new('RGB', (W, H), (18, 18, 20))
dr = ImageDraw.Draw(out)
dr.text((pad, 4), 'P1.6a: path trace | fit (two-range ms: near 3.22 / (1 + 0.3 tau)^2, far fitted to 0; refitted on these 10 frames); linear 640x360, page ACES at 0.35',
        fill=(230, 230, 230))
dr.text((pad, 18), 'labels: fit/pt luminance  cloud thick base dark20 bright20;  B/R dark20 pt / fit', fill=(200, 200, 200))
x0 = pad
for cloud, suns in SUNS.items():
    for i, sun in enumerate(suns):
        tiles, rf, b = cells[(cloud, sun)]
        y, x = 36 + i * (tile_h + 2 * lh + pad), x0
        dr.text((x, y), f'{cloud} {sun}: pt | fit  x ' + ' '.join(f'{v:.2f}' for v in rf), fill=(210, 210, 210))
        dr.text((x, y + lh + tile_h + 1), f'B/R dark20 {b[0]:.2f} / {b[1]:.2f}', fill=(170, 170, 170))
        for t in tiles:
            out.paste(t, (x, y + lh))
            x += t.size[0] + pad
    x0 += colw[cloud] + pad * 3
if out.size[0] > 1800:
    out = out.resize((1800, int(out.size[1] * 1800 / out.size[0])), Image.LANCZOS)
out.save(HERE / 'sheet.jpg', quality=84)
print(HERE / 'sheet.jpg', (HERE / 'sheet.jpg').stat().st_size // 1024, 'KB')
