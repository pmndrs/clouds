# P2.5f sheet: gp7 (fit lighting), the crisp hardness as pure gain (no cut), every other edge-character factor off (edgeFactors 4).
# Each panel is the P2.5d/e 1:1 crop (x 440..1080, y 200..560 of the 1280x720 frame), labelled with the top outline's 10-90 % width (measure.py).
# Run from this directory: python3 sheet.py
from PIL import Image, ImageDraw
from measure import measure
CX, CY, W, H, LH, G = 440, 200, 640, 360, 18, 8
cols = [('A', 'A: feature off'), ('B', 'B: pure gain, edgeSteepGain 4'), ('C', 'C: pure gain, edgeSteepGain 12')]
sheet = Image.new('RGB', (3 * W + 2 * G, LH + H), (20, 20, 20))
d = ImageDraw.Draw(sheet)
for i, (s, name) in enumerate(cols):
    w, st, o, n = measure(f'{s}/gp7.png')
    x0 = i * (W + G)
    d.text((x0 + 6, 3), f'{name}  |  top edge 10-90 %: {w:.1f} px (max step {st:.0f}/px)', fill=(230, 230, 230))
    sheet.paste(Image.open(f'{s}/gp7.png').convert('RGB').crop((CX, CY, CX + W, CY + H)), (x0, LH))
sheet.save('sheet.jpg', quality=85)
