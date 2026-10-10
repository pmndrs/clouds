#!/usr/bin/env python3
"""V1: paired side-by-side sheets, Karma reference | our C1 render, per cloud and view, plus one overview sheet per view.

  python3 scripts/vdb/reference/sheets.py [--tag final]

Inputs: artifacts/research/v1-reference/<tag>/jpg/cloudpack-NN-<view>.jpg (render.py) and
work/captures/C1/calibration/<view>/cloudpack-NN.jpg (our C1 renders). Output: artifacts/research/v1-reference/<tag>/sheets/
(local only: every sheet contains pixels derived from the third-party VDBs).
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scene  # noqa: E402

FONT = '/System/Library/Fonts/Helvetica.ttc'
BAR = 36


def font(size):
    try:
        return ImageFont.truetype(FONT, size)
    except OSError:
        return ImageFont.load_default()


def labelled(img, text, w):
    img = img.convert('RGB').resize((w, round(img.height * w / img.width)), Image.LANCZOS)
    out = Image.new('RGB', (img.width, img.height + BAR), 'black')
    out.paste(img, (0, BAR))
    ImageDraw.Draw(out).text((8, 6), text, fill='white', font=font(24))
    return out


def pair(c, view, root, w=1280):
    k = Image.open(os.path.join(root, 'jpg', f'cloudpack-{c}-{view}.jpg'))
    o = Image.open(os.path.join(scene.C1_DIR, view, f'cloudpack-{c}.jpg'))
    a = labelled(k, f'Karma reference  CloudPack {c}  {view} ({scene.VIEWS[view]:.0f} deg)', w)
    b = labelled(o, f'Ours (C1 flagship, high)  CloudPack {c}  {view}', w)
    out = Image.new('RGB', (a.width + b.width + 8, max(a.height, b.height)), 'black')
    out.paste(a, (0, 0))
    out.paste(b, (a.width + 8, 0))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tag', default='final')
    args = ap.parse_args()
    root = os.path.join(scene.OUT_DIR, args.tag)
    out_dir = os.path.join(root, 'sheets')
    os.makedirs(out_dir, exist_ok=True)
    for view in scene.VIEWS:
        rows = []
        for c in scene.CLOUDS:
            if not os.path.exists(os.path.join(root, 'jpg', f'cloudpack-{c}-{view}.jpg')):
                continue
            p = pair(c, view, root)
            p.save(os.path.join(out_dir, f'pair-{c}-{view}.jpg'), quality=90)
            rows.append(pair(c, view, root, w=960))
        if rows:
            sheet = Image.new('RGB', (rows[0].width, sum(r.height for r in rows) + 8 * (len(rows) - 1)), 'black')
            y = 0
            for r in rows:
                sheet.paste(r, (0, y))
                y += r.height + 8
            path = os.path.join(out_dir, f'sheet-{view}.jpg')
            sheet.save(path, quality=88)
            print(path)


if __name__ == '__main__':
    main()
