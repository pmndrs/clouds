#!/usr/bin/env python3
"""P1.1b sheet: rows = suns, columns = path trace | before (P1.1 realtime) | after; each row at one exposure (the PT's cloud mean).
usage: sheet.py <after dir> <cloud> <out.jpg> [suns...]"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'P1-1'))
import p11  # noqa: E402
sc = p11.sc

after, cloud, out = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
suns = sys.argv[4:] or p11.SUNS
ref = HERE.parent / 'P1-1' / cloud
rows = []
for sun in suns:
    pt, _ = sc.averaged_reference(sc.read_pfm(ref / f'pt-{sun}.pfm'), sc.read_pfm(ref / 'seed2' / f'pt-{sun}.pfm'))
    alpha = sc.as_mask(sc.read_pfm(ref / f'alpha-{sun}.pfm'))
    k = 0.5 / max(float(sc.luminance(pt)[alpha > 0.5].mean()), 1e-9)
    imgs = [pt, sc.read_pfm(ref / f'nubis-{sun}.pfm'), sc.read_pfm(after / f'nubis-{sun}.pfm')]
    tiles = []
    for im in imgs:
        x = np.clip(im[..., :3] * k, 0, None)
        x = x / (1 + x)   # Reinhard, same for all three
        tiles.append((np.clip(x, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8))
    rows.append(np.concatenate(tiles, axis=1))
img = Image.fromarray(np.concatenate(rows, axis=0))
img = img.resize((img.width // 2, img.height // 2))
img.save(out, quality=80)
print(out, img.size)
