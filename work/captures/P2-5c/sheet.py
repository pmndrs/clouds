# P2.5c sheet: gp7 (fit lighting, edge character on) c view (proc.debug 5) edgeLead +1 | -1, exaggerated (cut 0.35, gain 8, softPow 3,
# softErosion 2.5, lobes 1.5) edgeLead +1 | -1; under each a 1:1 crop (cyan box) of the central body's right top, where c > 0 shows.
# c view: heat 0 blue .. 1 red at the first sample the edge character reached; magenta = only the veil (below the threshold) was hit.
# Run from this directory: python3 sheet.py
from PIL import Image, ImageDraw
CX, CY = 560, 180   # top-left of the 640x360 1:1 crop, full-res px
W, H, LH, G = 640, 360, 18, 8
cols = [('cview-pos', 'c view, edgeLead +1'), ('cview-neg', 'c view, edgeLead -1'),
        ('exag-pos', 'exaggerated, edgeLead +1'), ('exag-neg', 'exaggerated, edgeLead -1')]
sheet = Image.new('RGB', (4 * W + 3 * G, 2 * (LH + H)), (20, 20, 20))
d = ImageDraw.Draw(sheet)
for c, (s, name) in enumerate(cols):
    im = Image.open(f'{s}/gp7.png').convert('RGB'); x0 = c * (W + G)
    d.text((x0 + 6, 3), name, fill=(230, 230, 230))
    sheet.paste(im.resize((W, H), Image.LANCZOS), (x0, LH))
    d.rectangle((x0 + CX // 2, LH + CY // 2, x0 + CX // 2 + W // 2, LH + CY // 2 + H // 2), outline=(0, 200, 255))
    d.text((x0 + 6, LH + H + 3), '1:1 crop (cyan box)', fill=(230, 230, 230))
    sheet.paste(im.crop((CX, CY, CX + W, CY + H)), (x0, 2 * LH + H))
sheet.save('sheet.jpg', quality=80)
