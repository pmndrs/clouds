# P2.6a sheet: rows noon / low; columns tower (P2.4a) | tower2 (P2.6a variance) | owner's photo (texas-afternoon, the P2.4a tower crop). Run from the repo root.
import sys
from PIL import Image, ImageDraw
D = 'work/captures/P2-6a/'
PHOTO = sys.argv[1] if len(sys.argv) > 1 else '/Users/dex/Developer/WebGPUClouds/artifacts/research/cloud-photos/_targets/texas-afternoon.jpg'
L, W, H = 18, 640, 360
sheet = Image.new('RGB', (2 * W + 8 + 0, 2 * (L + H)), (17, 17, 17))
photo = Image.open(PHOTO).convert('RGB').crop((1060, 470, 1920, 1110))
ph = 2 * (L + H) - L
pw = round(photo.width * ph / photo.height)
sheet = Image.new('RGB', (2 * W + pw, 2 * (L + H)), (17, 17, 17))
d = ImageDraw.Draw(sheet)
for r, view in enumerate(['fit-noon', 'fit-low']):
    for c, cloud in enumerate(['tower', 'tower2']):
        x, y = c * W, r * (L + H)
        d.text((x + 6, y + 3), f'{cloud}  {view}' + ('  (P2.4a lobes only)' if cloud == 'tower' else '  (P2.6a + variance)'), fill=(230, 230, 230))
        sheet.paste(Image.open(f'{D}{cloud}/{view}.png').convert('RGB').resize((W, H)), (x, y + L))
d.text((2 * W + 6, 3), "owner's photo: texas-afternoon, tower crop", fill=(230, 230, 230))
sheet.paste(photo.resize((pw, ph), Image.LANCZOS), (2 * W, L))
sheet.save(D + 'sheet.jpg', quality=88)
