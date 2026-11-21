# P2.5e sheet: gp7 (fit lighting), edge character factors one at a time, soft branch disabled (low c as feature off).
# Each panel is the 1:1 crop of P2.5d (central body's upper outline and right flank; x 440..1080, y 200..560 of the 1280x720 frame).
# Run from this directory: python3 sheet.py
from PIL import Image, ImageDraw, ImageChops
import numpy as np
CX, CY, W, H, LH, G = 440, 200, 640, 360, 18, 8
cols = [('A', 'A: feature off (reference)'), ('B', 'B: hardness only (cut 0.12, gain 3)'), ('C', 'C: hardness only (cut 0.25, gain 6)'),
        ('D', 'D: noise kind only (billowy by c)'), ('E', 'E: lobes only (0.6 x c)')]
ims = {s: Image.open(f'{s}/gp7.png').convert('RGB') for s, _ in cols}
# 3 + 2 grid
sheet = Image.new('RGB', (3 * W + 2 * G, 2 * (LH + H) + G), (20, 20, 20))
d = ImageDraw.Draw(sheet)
ref = np.asarray(ims['A'], dtype=np.int16)
for i, (s, name) in enumerate(cols):
    x0 = (i % 3) * (W + G); y0 = (i // 3) * (LH + H + G)
    diff = np.abs(np.asarray(ims[s], dtype=np.int16) - ref).max(axis=2)
    print(s, 'mean abs diff vs A /255 %.2f, px > 20: %d' % (diff.mean(), int((diff > 20).sum())))
    d.text((x0 + 6, y0 + 3), name, fill=(230, 230, 230))
    sheet.paste(ims[s].crop((CX, CY, CX + W, CY + H)), (x0, y0 + LH))
sheet.save('sheet.jpg', quality=85)
