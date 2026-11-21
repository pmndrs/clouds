# P1.3a sheet: gp7@look:0:50 with fit lighting; columns before (main) | after (lightTauCap auto); under each a 1:1 crop of the patchy base.
# Run from this directory: python3 sheet.py
from PIL import Image, ImageDraw
CX, CY = 0, 40   # top-left of the 640x360 1:1 crop, full-res pixels (cyan box)
W, FH, CH, LH = 640, 360, 360, 18
sheet = Image.new('RGB', (2 * W + 8, LH + FH + CH), (20, 20, 20))
d = ImageDraw.Draw(sheet)
for c, (s, name) in enumerate([('before', 'before: fit, sun taps stop at tau 32'), ('after', 'after: fit, lightTauCap auto (no cap for fit)')]):
    im = Image.open(f'{s}/gp7@look:0:50.png').convert('RGB')
    x0 = c * (W + 8)
    d.text((x0 + 6, 3), f'gp7 pitch 50  {name}   [below: 1:1 crop, cyan box]', fill=(230, 230, 230))
    sheet.paste(im.resize((W, FH), Image.LANCZOS), (x0, LH))
    sheet.paste(im.crop((CX, CY, CX + W, CY + CH)), (x0, LH + FH))
    d.rectangle((x0 + CX // 2, LH + CY // 2, x0 + CX // 2 + W // 2, LH + CY // 2 + CH // 2), outline=(0, 200, 255))
sheet.save('sheet.jpg', quality=82)
