# P2.5d sheet: gp7 (fit lighting) edge character off | c view (proc.debug 5, edgeLead +1) | on (edgeLead +1, lobes 0.6) | on flipped (-1),
# under each a 1:1 crop (cyan box) of the central body's upper outline and right flank; then ground off | on (half size).
# c view: heat 0 blue .. 1 red at the first sample the edge character reached; magenta = only the veil was hit.
# Run from this directory: python3 sheet.py
from PIL import Image, ImageDraw
CX, CY = 440, 200   # top-left of the 640x360 1:1 crop, full-res px
W, H, LH, G = 640, 360, 18, 8
cols = [('off', 'off'), ('cview', 'c view (edgeLead +1)'), ('on', 'on: edgeLead +1, lobes 0.6'), ('flip', 'on flipped: edgeLead -1')]
sheet = Image.new('RGB', (4 * W + 3 * G, 3 * (LH + H)), (20, 20, 20))
d = ImageDraw.Draw(sheet)
for c, (s, name) in enumerate(cols):
    im = Image.open(f'{s}/gp7.png').convert('RGB'); x0 = c * (W + G)
    d.text((x0 + 6, 3), 'gp7 ' + name, fill=(230, 230, 230))
    sheet.paste(im.resize((W, H), Image.LANCZOS), (x0, LH))
    d.rectangle((x0 + CX // 2, LH + CY // 2, x0 + CX // 2 + W // 2, LH + CY // 2 + H // 2), outline=(0, 200, 255))
    d.text((x0 + 6, LH + H + 3), '1:1 crop (cyan box)', fill=(230, 230, 230))
    sheet.paste(im.crop((CX, CY, CX + W, CY + H)), (x0, 2 * LH + H))
for c, s in enumerate(['off', 'on']):
    im = Image.open(f'{s}/ground.png').convert('RGB'); x0 = c * (W + G); y0 = 2 * (LH + H)
    d.text((x0 + 6, y0 + 3), 'ground ' + s, fill=(230, 230, 230))
    sheet.paste(im.resize((W, H), Image.LANCZOS), (x0, y0 + LH))
sheet.save('sheet.jpg', quality=82)
