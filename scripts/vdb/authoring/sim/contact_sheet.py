"""P9-F: tile the library page's per-cloud captures into one labelled contact sheet (system python3 with Pillow).

  node scripts/gpu/capture.mjs --serve --page library/ --query sheet=1 --size 960x720 --out DIR --shots <names from index.json>
  python3 scripts/vdb/authoring/sim/contact_sheet.py DIR OUT.jpg [--cols 6] [--width 420]
"""
import argparse, json, os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(HERE, '..', '..', '..', '..', 'assets', 'clouds', 'library', 'index.json')

ap = argparse.ArgumentParser()
ap.add_argument('dir'); ap.add_argument('out')
ap.add_argument('--cols', type=int, default=6); ap.add_argument('--width', type=int, default=420)
a = ap.parse_args()
clouds = json.load(open(INDEX))['clouds']
tiles = [(c, os.path.join(a.dir, c['name'] + '.jpg')) for c in clouds if os.path.exists(os.path.join(a.dir, c['name'] + '.jpg'))]
W = a.width; H = W * 3 // 4; L = 30
rows = (len(tiles) + a.cols - 1) // a.cols
sheet = Image.new('RGB', (a.cols * W, rows * (H + L)), (18, 18, 22))
d = ImageDraw.Draw(sheet)
for i, (c, f) in enumerate(tiles):
    x, y = (i % a.cols) * W, (i // a.cols) * (H + L)
    sheet.paste(Image.open(f).convert('RGB').resize((W, H)), (x, y + L))
    sx, sy, sz = c['sizeMeters']
    d.text((x + 6, y + 3), c['name'], fill=(255, 210, 90))
    d.text((x + 6, y + 15), f"{c['species']}  {sx:.0f}x{sy:.0f}x{sz:.0f} m", fill=(200, 200, 200))
sheet.save(a.out, quality=88)
print(a.out, sheet.size)
