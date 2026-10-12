"""F2 contact sheet: rows = capture folders (arms), columns = shots. A row label and, when the folder's parent has runs.mjs's timing.json,
the skyLayer range per shot under each tile. Extra rows can be reference images (`ref:<label>=<path>`; local sheets only).
  python3 -I work/captures/F2/tools/sheet.py --out sheet.jpg --shots ground,gp7,horizon,above --width 480 label=dir [label=dir ...]"""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

args = sys.argv[1:]
def opt(name, default):
    if f'--{name}' in args:
        i = args.index(f'--{name}'); v = args[i + 1]; del args[i:i + 2]; return v
    return default
out = opt('out', 'sheet.jpg')
shots = opt('shots', 'ground,gp7,horizon,above').split(',')
W = int(opt('width', '480'))
title = opt('title', '')
H = W * 9 // 16
rows = [a.split('=', 1) for a in args]
try:
    font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 15)
    big = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 18)
except OSError:
    font = big = ImageFont.load_default()
LBL = 150
TOP = 30 if title else 0
sheet = Image.new('RGB', (LBL + W * len(shots), TOP + (H + 20) * len(rows)), (24, 24, 24))
d = ImageDraw.Draw(sheet)
if title:
    d.text((8, 6), title, fill=(255, 255, 255), font=big)
for r, (label, path) in enumerate(rows):
    y = TOP + r * (H + 20)
    d.text((8, y + 8), label, fill=(255, 220, 120), font=font)
    if label.startswith('ref:'):
        im = Image.open(path).convert('RGB'); im.thumbnail((W * len(shots), H)); sheet.paste(im, (LBL, y)); continue
    p = Path(path)
    timing = {}
    tj = p.parent / 'timing.json'
    if tj.exists():
        timing = json.loads(tj.read_text())['skyLayerMs'].get(p.name, {})
    for c, s in enumerate(shots):
        f = p / f'{s}.jpg'
        if f.exists():
            im = Image.open(f).convert('RGB').resize((W, H), Image.LANCZOS)
            sheet.paste(im, (LBL + c * W, y))
        t = [v for v in timing.get(s, []) if v is not None]
        cap = s + (f'   sky {min(t):.1f}-{max(t):.1f} ms' if t else '')
        d.text((LBL + c * W + 4, y + H + 2), cap, fill=(200, 200, 200), font=font)
sheet.save(out, quality=88)
print(out, sheet.size)
