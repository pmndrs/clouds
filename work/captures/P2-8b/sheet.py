# P2.8b sheet: rows fit-noon / fit-low / fit-sunward; columns tower3 (towerSigma 0.08, fringe off) | tower4 (defaults: 0.08, fringe on) | reference
# (the owner's texas-afternoon tower crop, as on the P2.7a sheet, for noon / low; embergen02 from P1.7b for sunward). Run from the repo root.
import sys
from PIL import Image, ImageDraw
D = 'work/captures/P2-8b/'
PHOTO = sys.argv[1] if len(sys.argv) > 1 else '/Users/dex/Developer/WebGPUClouds/artifacts/research/cloud-photos/_targets/texas-afternoon.jpg'
L, W, H = 18, 640, 360
VIEWS = ['fit-noon', 'fit-low', 'fit-sunward']
COLS = [(D + 'tower3-s008', 'tower3  towerSigma 0.08, fringe off (P2.8a)'), (D + 'tower4', 'tower4  (P2.8b: taper, shoulder, big billows; 0.08 + fringe)')]
photo = Image.open(PHOTO).convert('RGB').crop((1060, 470, 1920, 1110))
photo = photo.resize((round(photo.width * H / photo.height), H), Image.LANCZOS)
RW = max(W, photo.width)
sheet = Image.new('RGB', (2 * W + RW, 3 * (L + H)), (17, 17, 17))
d = ImageDraw.Draw(sheet)
for r, v in enumerate(VIEWS):
    y = r * (L + H)
    for c, (src, lab) in enumerate(COLS):
        sheet.paste(Image.open(f'{src}/{v}.png').convert('RGB'), (c * W, y + L))
        d.text((c * W + 6, y + 3), f'{v}  {lab}', fill=(230, 230, 230))
    if v == 'fit-sunward':
        sheet.paste(Image.open('work/captures/P1-7b/embergen02-off/fit-sunward.png').convert('RGB'), (2 * W, y + L))
        d.text((2 * W + 6, y + 3), 'ref: embergen02 fit-sunward (P1.7b)', fill=(230, 230, 230))
    else:
        sheet.paste(photo, (2 * W, y + L))
        d.text((2 * W + 6, y + 3), "ref: owner's photo, texas-afternoon tower crop", fill=(230, 230, 230))
sheet.save(D + 'sheet.jpg', quality=88)
