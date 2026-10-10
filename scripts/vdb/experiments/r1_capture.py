#!/usr/bin/env python3
"""R1 A/B capture driver: shoots the C1 calibration framings (flagship `photo` + `detail`) for a list of variants
and builds a labelled sheet (columns = variants; rows = photo crop, detail).

  python3 scripts/vdb/experiments/r1_capture.py --base http://127.0.0.1:5317 --out DIR --sheet SHEET.jpg \
      'label|local/cloudpack-02|s.densityScale=0.6' 'label2|local/r1/c94-fill|' ...

Each variant is `label|cloud|extra query` (extra query optional, `&`-joined). The fixed C1 query is
quality=high&clean=1&base=1300&time=15.9. A variant whose photo.jpg already exists in DIR/label is not re-shot (--force re-shoots).
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
FIXED = 'quality=high&clean=1&base=1300&time=15.9'


def shoot(base: str, out: Path, cloud: str, extra: str, force: bool) -> None:
    if (out / 'photo.jpg').exists() and not force:
        return
    fixed = FIXED if 'quality=' not in extra else '&'.join(k for k in FIXED.split('&') if not k.startswith('quality='))
    q = f'cloud={cloud}&{fixed}' + (f'&{extra}' if extra else '')
    url = f'{base}/flagship/?{q}'
    r = subprocess.run(['node', str(ROOT / 'scripts/gpu/capture.mjs'), '--url', url, '--shots', 'photo,detail', '--out', str(out)],
                       cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stdout + r.stderr)
        raise SystemExit(f'capture failed for {url}')
    (out / 'query.txt').write_text(q + '\n')


def font(size: int):
    for f in ('/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def sheet(rows: list[tuple[str, Path]], path: Path, photo_crop=(360, 0, 1560, 1080), cw=480) -> None:
    """Columns = variants (label on top), row 1 = photo cropped to the central 1200x1080, row 2 = detail (16:9)."""
    ph = int(cw * (photo_crop[3] - photo_crop[1]) / (photo_crop[2] - photo_crop[0]))
    dh = int(cw * 9 / 16)
    lab = 30
    W, H = (cw + 6) * len(rows), lab + ph + 6 + dh
    img = Image.new('RGB', (W, H), (20, 20, 20))
    d = ImageDraw.Draw(img)
    f = font(20)
    for i, (label, src) in enumerate(rows):
        x = i * (cw + 6)
        d.text((x + 4, 4), label, fill=(255, 255, 255), font=f)
        p = Image.open(src / 'photo.jpg').crop(photo_crop).resize((cw, ph), Image.LANCZOS)
        q = Image.open(src / 'detail.jpg').resize((cw, dh), Image.LANCZOS)
        img.paste(p, (x, lab))
        img.paste(q, (x, lab + ph + 6))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, quality=86)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://127.0.0.1:5317')
    ap.add_argument('--out', required=True)
    ap.add_argument('--sheet')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('variants', nargs='+')
    a = ap.parse_args()
    rows = []
    for v in a.variants:
        parts = (v.split('|') + ['', ''])[:3]
        label, cloud, extra = parts
        out = Path(a.out) / label
        shoot(a.base, out, cloud, extra, a.force)
        rows.append((label, out))
        print('ok', label)
    if a.sheet:
        sheet(rows, Path(a.sheet))
        print('sheet', a.sheet)


if __name__ == '__main__':
    main()
