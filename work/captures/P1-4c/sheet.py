#!/usr/bin/env python3
"""P1.4c sheet: path traced (2 seeds, /2) | P1.4b fit | P1.4c fit (ms tau from the light grid, refitted) for 2 clouds x 4 suns; page ACES at 0.35."""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location('fit_p14c', HERE / 'fit.py')
M = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(M)
F, C, sc = M.F, M.C, M.sc
SUNS = ['noon', 'low', 'backlit', 'sunset']
CLOUDS = ['sky', 'embergen02']
tile_h, pad, lh = 170, 6, 16
rows = []
for cloud in CLOUDS:
    for sun in SUNS:
        reg, pt = F.reference(cloud, sun)
        old = sc.read_pfm(M.P14B / cloud / 'final' / f'fit-{sun}.pfm')[..., :3]
        new = sc.read_pfm(HERE / cloud / 'final' / f'fit-{sun}.pfm')[..., :3]
        a = M.alpha(cloud, sun)
        ys, xs = np.nonzero(a > 0.02)
        h, w = a.shape
        y0, y1, x0, x1 = max(0, ys.min() - 10), min(h, ys.max() + 10), max(0, xs.min() - 10), min(w, xs.max() + 10)
        tiles = []
        for img in [pt, old, new]:
            t = Image.fromarray((np.clip(sc.aces_srgb(img[y0:y1, x0:x1], 0.35), 0, 1) * 255).astype(np.uint8))
            tiles.append(t.resize((max(1, int(t.size[0] * tile_h / t.size[1])), tile_h), Image.LANCZOS))
        lab = []
        for img in [old, new]:
            mf, mp = C.rgb_means(img, reg), C.rgb_means(pt, reg)
            lab.append((C.lum(mf)[1] / C.lum(mp)[1], C.lum(mf)[3] / C.lum(mp)[3], M.band(cloud, sun, img)))
        rows.append((cloud, sun, tiles, lab))
W = pad + max(sum(t.size[0] + pad for t in r[2]) for r in rows)
H = 22 + len(rows) * (tile_h + lh + pad) + pad
out = Image.new('RGB', (W, H), (18, 18, 20))
dr = ImageDraw.Draw(out)
dr.text((pad, 4), 'P1.4c: path traced | P1.4b fit | P1.4c fit (ms tau = light grid alone, refitted); 640x360 linear, ACES 0.35. Labels: thick lum, dark20 lum, 16-64 px band (fit/pt)',
        fill=(230, 230, 230))
for i, (cloud, sun, tiles, lab) in enumerate(rows):
    y, x = 22 + i * (tile_h + lh + pad), pad
    txt = '   '.join(f'{n}: x{a:.2f} d{b:.2f} band {c:.2f}' for n, (a, b, c) in zip(['P1.4b', 'P1.4c'], lab))
    dr.text((x, y), f'{cloud} {sun}:  path trace | P1.4b | P1.4c      {txt}', fill=(210, 210, 210))
    for t in tiles:
        out.paste(t, (x, y + lh))
        x += t.size[0] + pad
if out.size[0] > 1500:
    out = out.resize((1500, int(out.size[1] * 1500 / out.size[0])), Image.LANCZOS)
out.save(HERE / 'sheet.jpg', quality=82)
print(HERE / 'sheet.jpg', out.size, (HERE / 'sheet.jpg').stat().st_size // 1024, 'KB')
