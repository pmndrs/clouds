# P1.2d sheet: rows gp7, ground; columns old (octave) | new (fit). Each cell: the frame at half size, under it 1:1 crops (lit top | shaded base).
# Run from this directory: python3 sheet.py
from PIL import Image, ImageDraw
CROPS = {'gp7': [(560, 220), (420, 420)], 'ground': [(700, 20), (480, 170)]}   # top-left of 320x180 crops, full-res pixels
W, FH, CH, LH = 640, 360, 180, 18
sheet = Image.new('RGB', (2 * W, 2 * (LH + FH + CH)), (20, 20, 20))
d = ImageDraw.Draw(sheet)
for r, v in enumerate(['gp7', 'ground']):
    for c, (s, name) in enumerate([('old', 'old: octave (default)'), ('new', 'new: fit (P12)')]):
        im = Image.open(f'{s}/{v}.png').convert('RGB')
        x0, y0 = c * W, r * (LH + FH + CH)
        d.text((x0 + 6, y0 + 3), f'{v}  {name}   [crops 1:1: lit top (yellow) | shaded base (cyan)]', fill=(230, 230, 230))
        sheet.paste(im.resize((W, FH), Image.LANCZOS), (x0, y0 + LH))
        for k, (cx, cy) in enumerate(CROPS[v]):
            sheet.paste(im.crop((cx, cy, cx + 320, cy + 180)), (x0 + k * 320, y0 + LH + FH))
            d.rectangle((x0 + cx // 2, y0 + LH + cy // 2, x0 + cx // 2 + 160, y0 + LH + cy // 2 + 90), outline=(255, 200, 0) if k == 0 else (0, 200, 255))
sheet.save('sheet.jpg', quality=85)
