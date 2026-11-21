# P2.5b sheet (from P2.5a's): gp7 off | on, no lobes | on, lobes | on, lobes, edgeLead -1, fit lighting; under each a 1:1 crop (cyan box) of
# the central body's top and upper flanks; below, ground off | on with lobes. Run from this directory: python3 sheet.py
from PIL import Image, ImageDraw
CX, CY = 420, 200   # top-left of the 640x360 1:1 crop, full-res px
W, H, LH, G = 640, 360, 18, 8
cols = [('off', 'gp7 edge character OFF (main)'), ('nolobes', 'gp7 ON, edgeLobes 0'), ('lobes', 'gp7 ON, edgeLobes 0.6'),
        ('flip', 'gp7 ON, lobes 0.6, edgeLead -1 (flipped)')]
sheet = Image.new('RGB', (4 * W + 3 * G, 2 * (LH + H) + LH + H), (20, 20, 20))
d = ImageDraw.Draw(sheet)
for c, (s, name) in enumerate(cols):
    im = Image.open(f'{s}/gp7.png').convert('RGB'); x0 = c * (W + G)
    d.text((x0 + 6, 3), name, fill=(230, 230, 230))
    sheet.paste(im.resize((W, H), Image.LANCZOS), (x0, LH))
    d.rectangle((x0 + CX // 2, LH + CY // 2, x0 + CX // 2 + W // 2, LH + CY // 2 + H // 2), outline=(0, 200, 255))
    d.text((x0 + 6, LH + H + 3), '1:1 crop (cyan box)', fill=(230, 230, 230))
    sheet.paste(im.crop((CX, CY, CX + W, CY + H)), (x0, 2 * LH + H))
y = 2 * (LH + H)
for c, (s, name) in enumerate([('off', 'ground OFF'), ('lobes', 'ground ON, edgeLobes 0.6')]):
    im = Image.open(f'{s}/ground.png').convert('RGB'); x0 = c * (W + G)
    d.text((x0 + 6, y + 3), name, fill=(230, 230, 230))
    sheet.paste(im.resize((W, H), Image.LANCZOS), (x0, y + LH))
sheet.save('sheet.jpg', quality=80)
