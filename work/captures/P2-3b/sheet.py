# P2.3b sheet: ground P24 off | P24 on | owner's photo (texas-afternoon), then gp7 old | new. Run from the repo root.
import sys
from PIL import Image, ImageDraw
D = 'work/captures/P2-3b/'
PHOTO = sys.argv[1] if len(sys.argv) > 1 else '/Users/dex/Developer/WebGPUClouds/artifacts/research/cloud-photos/_targets/texas-afternoon.jpg'
W = 640
def tile(path):
    im = Image.open(path).convert('RGB')
    return im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
row1 = [(tile(D + 'off/ground.png'), 'ground  P23, P24 off (cone tops)'), (tile(D + 'on/ground.png'), 'ground  P23 + P24 on: domed turrets'), (tile(PHOTO), "owner's photo: texas-afternoon")]
row2 = [(tile(D + 'off/gp7.png'), 'gp7  P23, P24 off'), (tile(D + 'on/gp7.png'), 'gp7  P23 + P24 on')]
L = 18
h1 = max(t.height for t, _ in row1); h2 = max(t.height for t, _ in row2)
sheet = Image.new('RGB', (3 * W, 2 * L + h1 + h2), (17, 17, 17))
d = ImageDraw.Draw(sheet)
for r, (row, y) in enumerate([(row1, 0), (row2, L + h1)]):
    for i, (t, label) in enumerate(row):
        d.text((i * W + 6, y + 3), label, fill=(230, 230, 230))
        sheet.paste(t, (i * W, y + L))
sheet.save(D + 'sheet.jpg', quality=82)
