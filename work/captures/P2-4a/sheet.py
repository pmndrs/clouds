# P2.4a sheet: sphere-hierarchy tower, fit lighting, noon | low | backlit (second camera angle) | owner's photo, tower crop. Run from the repo root.
import sys
from PIL import Image, ImageDraw
D = 'work/captures/P2-4a/'
PHOTO = sys.argv[1] if len(sys.argv) > 1 else '/Users/dex/Developer/WebGPUClouds/artifacts/research/cloud-photos/_targets/texas-afternoon.jpg'
H = 405
def tile(im):
    im = im.convert('RGB')
    return im.resize((round(im.width * H / im.height), H), Image.LANCZOS)
photo = Image.open(PHOTO)
crop = photo.crop((1060, 470, 1920, 1110))   # the tower and its right foot (2000 x 1336 frame)
tiles = [(tile(Image.open(D + 'fit-noon.png')), 'tower  fit-noon'), (tile(Image.open(D + 'fit-low.png')), 'tower  fit-low'),
         (tile(Image.open(D + 'fit-backlit.png')), 'tower  fit-backlit (2nd angle)'), (tile(crop), "owner's photo: texas-afternoon, tower crop")]
L = 18
W = sum(t.width for t, _ in tiles)
sheet = Image.new('RGB', (W, L + H), (17, 17, 17))
d = ImageDraw.Draw(sheet)
x = 0
for t, label in tiles:
    d.text((x + 6, 3), label, fill=(230, 230, 230))
    sheet.paste(t, (x, L))
    x += t.width
sheet.save(D + 'sheet.jpg', quality=84)
