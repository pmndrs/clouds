"""W1 contact sheet: rows of images with labels.  python3 -I sheet.py out.jpg --w 480 "row label=img1,img2,..." ...
A cell may be 'path' or 'path@x0,y0,x1,y1' (a crop in source pixels) or '-' (blank). Missing files show as grey."""
import sys
from PIL import Image, ImageDraw, ImageFont

args = sys.argv[1:]
out = args.pop(0)
w = 480
if args and args[0] == '--w':
    args.pop(0); w = int(args.pop(0))
h = w * 9 // 16
lab = 220
rows = []
for a in args:
    label, cells = a.split('=', 1)
    rows.append((label, cells.split(',') if cells else []))
cols = max(len(c) for _, c in rows)
sheet = Image.new('RGB', (lab + cols * (w + 4), len(rows) * (h + 4)), (24, 24, 24))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 15)
except Exception:
    font = ImageFont.load_default()
for r, (label, cells) in enumerate(rows):
    y = r * (h + 4)
    for i, line in enumerate(label.split('|')):
        d.text((8, y + 8 + i * 19), line, fill=(230, 230, 230), font=font)
    for c, cell in enumerate(cells):
        x = lab + c * (w + 4)
        if cell == '-':
            continue
        path, crop = (cell.split('@') + [None])[:2]
        try:
            im = Image.open(path).convert('RGB')
            if crop:
                im = im.crop(tuple(int(v) for v in crop.split(':')))
            im.thumbnail((w, h))
            sheet.paste(im, (x + (w - im.width) // 2, y + (h - im.height) // 2))
        except Exception:
            d.rectangle([x, y, x + w, y + h], fill=(80, 80, 80))
sheet.save(out, quality=88)
print(out, sheet.size)
