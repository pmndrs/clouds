# P2.5a sheet: gp7 off | on (edgeLead +1) | on flipped (edgeLead -1), fit lighting; under each a 1:1 crop (cyan box) of the central
# body's top and upper flanks; below, ground off | on. Run from this directory: python3 sheet.py
from PIL import Image, ImageDraw
CX, CY = 420, 200   # top-left of the 640x360 1:1 crop, full-res px
W, H, LH, G = 640, 360, 18, 8
cols = [('off', 'gp7 edge character OFF (main)'), ('on', 'gp7 ON, edgeLead +1 (leading crisp)'), ('flip', 'gp7 ON, edgeLead -1 (flipped)')]
sheet = Image.new('RGB', (3 * W + 2 * G, 2 * (LH + H) + LH + H), (20, 20, 20))
d = ImageDraw.Draw(sheet)
for c, (s, name) in enumerate(cols):
    im = Image.open(f'{s}/gp7.png').convert('RGB'); x0 = c * (W + G)
    d.text((x0 + 6, 3), name, fill=(230, 230, 230))
    sheet.paste(im.resize((W, H), Image.LANCZOS), (x0, LH))
    d.rectangle((x0 + CX // 2, LH + CY // 2, x0 + CX // 2 + W // 2, LH + CY // 2 + H // 2), outline=(0, 200, 255))
    d.text((x0 + 6, LH + H + 3), '1:1 crop (cyan box)', fill=(230, 230, 230))
    sheet.paste(im.crop((CX, CY, CX + W, CY + H)), (x0, 2 * LH + H))
y = 2 * (LH + H)
for c, (s, name) in enumerate([('off', 'ground OFF'), ('on', 'ground ON, edgeLead +1')]):
    im = Image.open(f'{s}/ground.png').convert('RGB'); x0 = c * (W + G)
    d.text((x0 + 6, y + 3), name, fill=(230, 230, 230))
    sheet.paste(im.resize((W, H), Image.LANCZOS), (x0, y + LH))
sheet.save('sheet.jpg', quality=80)
