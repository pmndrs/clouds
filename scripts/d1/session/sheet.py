#!/usr/bin/env python3
# D1 round 10: a labelled crop sheet. sheet.py <out.jpg> <x,y,w,h> <scale> <zoom> label=path ...  (box in the image's own pixels after
# resizing every image to the first one's size; zoom = output magnification)
import sys
from PIL import Image, ImageDraw
out, box, scale, zoom, *items = sys.argv[1:]
x, y, w, h = map(int, box.split(',')); zoom = float(zoom); size = None
tiles = []
for it in items:
    label, path = it.split('=', 1)
    im = Image.open(path).convert('RGB')
    if size is None: size = im.size
    if im.size != size: im = im.resize(size, Image.LANCZOS)
    c = im.crop((x, y, x + w, y + h))
    if zoom != 1: c = c.resize((int(w * zoom), int(h * zoom)), Image.LANCZOS)
    tiles.append((label, c))
tw, th = tiles[0][1].size; cols = min(len(tiles), 3); rows = (len(tiles) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (tw + 8) + 8, rows * (th + 28) + 8), (24, 24, 24)); d = ImageDraw.Draw(sheet)
for i, (label, c) in enumerate(tiles):
    cx, cy = 8 + (i % cols) * (tw + 8), 8 + (i // cols) * (th + 28)
    sheet.paste(c, (cx, cy + 20)); d.text((cx + 2, cy + 4), label, fill=(240, 240, 240))
sheet.save(out, quality=92); print(out, sheet.size)
