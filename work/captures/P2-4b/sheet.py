#!/usr/bin/env python3
"""P2.4b: tower, path traced (1 seed) | fit (converged), noon and low, 640x360 linear; fit / pt mean luminance over cloud (alpha > 0.5),
thick (alpha > 0.995), bright20, dark20 (percentiles of the pt luminance in the cloud), plus where on the cloud the error sits (top / side /
base thirds of the mask's height). Sheet: page ACES at 0.35 (scorecard.aces_srgb), as the earlier card sheets. Run from the repo root."""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / 'scripts' / 'gpu'))
import scorecard as sc  # noqa: E402

tile_h, pad, lh = 300, 6, 16
rows = []
for sun in ['noon', 'low']:
    pt = sc.read_pfm(HERE / f'pt-{sun}' / f'pt-{sun}.pfm')[..., :3]
    fit = sc.read_pfm(HERE / 'fit' / f'fit-{sun}.pfm')[..., :3]
    a = sc.as_mask(sc.read_pfm(HERE / 'fit' / f'alpha-{sun}.pfm'))
    lp, lf = sc.luminance(pt), sc.luminance(fit)
    cloud = a > 0.5
    ls = sc.gauss_blur(lp, 2.0)   # percentiles on a 2 px blur of the pt luminance, so its grain does not pick the bright / dark pixels
    reg = {'cloud': cloud, 'thick': a > 0.995,
           'bright20': cloud & (ls >= np.percentile(ls[cloud], 80)), 'dark20': cloud & (ls <= np.percentile(ls[cloud], 20))}
    ys = np.nonzero(cloud)[0]
    y0, y1 = ys.min(), ys.max()
    r = np.arange(a.shape[0])[:, None]
    reg['top3'] = cloud & (r < y0 + (y1 - y0) / 3)
    reg['mid3'] = cloud & (r >= y0 + (y1 - y0) / 3) & (r <= y1 - (y1 - y0) / 3)
    reg['base3'] = cloud & (r > y1 - (y1 - y0) / 3)
    xs = np.nonzero(cloud)[1]
    xm = (xs.min() + xs.max()) / 2
    c = np.arange(a.shape[1])[None, :]
    reg['left'] = cloud & (c < xm)
    reg['right'] = cloud & (c >= xm)
    rat = {k: lf[m].mean() / lp[m].mean() for k, m in reg.items()}
    absl = {k: (lp[m].mean(), lf[m].mean()) for k, m in reg.items()}
    br = lambda img, m: img[..., 2][m].mean() / img[..., 0][m].mean()
    print(sun, f'B/R cloud pt {br(pt, cloud):.2f} fit {br(fit, cloud):.2f}  dark20 pt {br(pt, reg["dark20"]):.2f} fit {br(fit, reg["dark20"]):.2f}  bright20 pt {br(pt, reg["bright20"]):.2f} fit {br(fit, reg["bright20"]):.2f}')
    print(sun, ' '.join(f'{k} {v:.2f}' for k, v in rat.items()))
    print('   pt/fit mean lum', ' '.join(f'{k} {p:.2f}/{f:.2f}' for k, (p, f) in absl.items()))
    # per-pixel ratio map stats: where is fit/pt lowest (in the thick body)
    yy, xx = np.nonzero(cloud)
    pad_ = 12
    Y0, Y1, X0, X1 = max(0, yy.min() - pad_), min(a.shape[0], yy.max() + pad_), max(0, xx.min() - pad_), min(a.shape[1], xx.max() + pad_)
    tiles = []
    for img in [pt, fit]:
        t = Image.fromarray((np.clip(sc.aces_srgb(img[Y0:Y1, X0:X1], 0.35), 0, 1) * 255).astype(np.uint8))
        tiles.append(t.resize((max(1, int(t.size[0] * tile_h / t.size[1])), tile_h), Image.LANCZOS))
    rows.append((sun, tiles, rat))

W = pad + max(sum(t.size[0] + pad for t in ts) for _, ts, _ in rows) + pad
W = max(W, 760)
H = 22 + len(rows) * (tile_h + lh + pad) + pad
out = Image.new('RGB', (W, H), (18, 18, 20))
dr = ImageDraw.Draw(out)
dr.text((pad, 4), 'P2.4b tower: path traced (1024 spp, 1 seed) | fit (converged); linear 640x360, page ACES at 0.35', fill=(230, 230, 230))
for i, (sun, tiles, rat) in enumerate(rows):
    y, x = 22 + i * (tile_h + lh + pad), pad
    dr.text((x, y), f'{sun}: pt | fit   fit/pt lum: cloud {rat["cloud"]:.2f} thick {rat["thick"]:.2f} bright20 {rat["bright20"]:.2f} dark20 {rat["dark20"]:.2f}'
            f'   top {rat["top3"]:.2f} mid {rat["mid3"]:.2f} base {rat["base3"]:.2f}', fill=(210, 210, 210))
    for t in tiles:
        out.paste(t, (x, y + lh))
        x += t.size[0] + pad
out.save(HERE / 'sheet.jpg', quality=84)
print(HERE / 'sheet.jpg', (HERE / 'sheet.jpg').stat().st_size // 1024, 'KB')
