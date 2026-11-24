# P2.8a sheet: rows fit-noon / fit-low / fit-sunward; columns tower3 sigma 0.45 | sigma 0.08 | sigma 0.08 + towerFringe=1 | reference
# (houdini from P2.7b for noon / low, embergen02 from P1.7b for sunward). Run from the repo root.
from PIL import Image, ImageDraw
D = 'work/captures/P2-8a/'
L, W, H = 18, 640, 360
VIEWS = ['fit-noon', 'fit-low', 'fit-sunward']
COLS = [(D + 's045', 'tower3  towerSigma 0.45 (today)'), (D + 's008', 'tower3  towerSigma 0.08'),
        (D + 's008-fringe', 'tower3  towerSigma 0.08 + towerFringe=1')]
REF = {'fit-noon': ('work/captures/P2-7b/houdini', 'ref: houdini (P2.7b)'), 'fit-low': ('work/captures/P2-7b/houdini', 'ref: houdini (P2.7b)'),
       'fit-sunward': ('work/captures/P1-7b/embergen02-off', 'ref: embergen02 (P1.7b)')}
sheet = Image.new('RGB', (4 * W, 3 * (L + H)), (17, 17, 17))
d = ImageDraw.Draw(sheet)
for r, v in enumerate(VIEWS):
    y = r * (L + H)
    for c, (src, lab) in enumerate(COLS + [REF[v]]):
        sheet.paste(Image.open(f'{src}/{v}.png').convert('RGB'), (c * W, y + L))
        d.text((c * W + 6, y + 3), f'{v}  {lab}', fill=(230, 230, 230))
sheet.save(D + 'sheet.jpg', quality=88)
