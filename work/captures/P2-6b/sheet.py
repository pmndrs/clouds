# P2.6b sheet: ground P26 off | P26 on (flank bulges) | owner's photo (all with P23 scattered + P24 turrets, fit lighting). Run from the repo root.
import sys
from PIL import Image, ImageDraw
D = 'work/captures/P2-6b/'
PHOTO = sys.argv[1] if len(sys.argv) > 1 else '/Users/dex/Developer/WebGPUClouds/artifacts/research/cloud-photos/_targets/texas-afternoon.jpg'
W = 640
def tile(path):
    im = Image.open(path).convert('RGB')
    return im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
row = [(tile(D + 'off/ground.png'), 'ground  P23 + P24, P26 off'), (tile(D + 'on/ground.png'), 'ground  P23 + P24 + P26 on: flank bulges'), (tile(PHOTO), "owner's photo: texas-afternoon")]
L = 18
h = max(t.height for t, _ in row)
sheet = Image.new('RGB', (3 * W, L + h), (17, 17, 17))
d = ImageDraw.Draw(sheet)
for i, (t, label) in enumerate(row):
    d.text((i * W + 6, 3), label, fill=(230, 230, 230))
    sheet.paste(t, (i * W, L))
sheet.save(D + 'sheet.jpg', quality=82)
