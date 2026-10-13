"""N1: side-by-side crops of one shot across arms, at 1:1 (rows = arms). A crop is x,y,w,h in the 1920x1080 frame.
  python3 -I work/captures/N1/tools/crops.py --out sheet.jpg --shot tops --crop 700,300,900,500 label=dir [label=dir ...]"""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
args = sys.argv[1:]
def opt(name, default):
    if f'--{name}' in args:
        i = args.index(f'--{name}'); v = args[i + 1]; del args[i:i + 2]; return v
    return default
out = opt('out', 'crops.jpg'); shot = opt('shot', 'tops'); x, y, w, h = map(int, opt('crop', '0,0,1920,1080').split(','))
cols = int(opt('cols', '2')); title = opt('title', '')
rows = [a.split('=', 1) for a in args]
try: font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 18)
except OSError: font = ImageFont.load_default()
n = len(rows); R = (n + cols - 1) // cols; TOP = 28 if title else 0
sheet = Image.new('RGB', (cols * w, TOP + R * (h + 26)), (24, 24, 24)); d = ImageDraw.Draw(sheet)
if title: d.text((6, 4), title, fill=(255, 255, 255), font=font)
for i, (label, path) in enumerate(rows):
    cx, cy = (i % cols) * w, TOP + (i // cols) * (h + 26)
    p = Path(path) / f'{shot}.jpg'
    if p.exists(): sheet.paste(Image.open(p).convert('RGB').crop((x, y, x + w, y + h)), (cx, cy))
    t = ''
    tj = Path(path).parent / 'timing.json'
    if tj.exists():
        v = [a for a in json.loads(tj.read_text())['skyLayerMs'].get(Path(path).name, {}).get(shot, []) if a is not None]
        if v: t = f'   sky {min(v):.1f}-{max(v):.1f} ms'
    d.text((cx + 6, cy + h + 3), label + t, fill=(255, 220, 120), font=font)
sheet.save(out, quality=90); print(out, sheet.size)
