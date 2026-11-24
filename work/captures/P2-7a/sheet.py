# P2.7a sheet: rows noon / low; columns tower2 (P2.6a) | tower3 (P2.7a, Houdini recipe) | reference column: Houdini stage 4 (P2.6c sheet crop,
# numpy preview, no multiple scattering) on top, the owner's texas-afternoon tower crop (as in the P2.6a sheet) below. Run from the repo root.
import sys
from PIL import Image, ImageDraw
D = 'work/captures/P2-7a/'
PHOTO = sys.argv[1] if len(sys.argv) > 1 else '/Users/dex/Developer/WebGPUClouds/artifacts/research/cloud-photos/_targets/texas-afternoon.jpg'
L, W, H = 18, 640, 360
src = Image.open('work/captures/P2-6c/sheet.jpg').convert('RGB')
sx, sy = src.width / 1286, src.height / 726
hou = src.crop((round(645 * sx), round(395 * sy), src.width, src.height))   # stage 4 panel, below its label
photo = Image.open(PHOTO).convert('RGB').crop((1060, 470, 1920, 1110))
def fit(im):
    w = round(im.width * H / im.height)
    return im.resize((w, H), Image.LANCZOS)
hou, photo = fit(hou), fit(photo)
RW = max(hou.width, photo.width)
sheet = Image.new('RGB', (2 * W + RW, 2 * (L + H)), (17, 17, 17))
d = ImageDraw.Draw(sheet)
for r, view in enumerate(['fit-noon', 'fit-low']):
    for c, cloud in enumerate(['tower2', 'tower3']):
        x, y = c * W, r * (L + H)
        d.text((x + 6, y + 3), f'{cloud}  {view}' + ('  (P2.6a)' if cloud == 'tower2' else '  (P2.7a Houdini recipe)'), fill=(230, 230, 230))
        sheet.paste(Image.open(f'{D}{cloud}/{view}.png').convert('RGB').resize((W, H)), (x, y + L))
d.text((2 * W + 6, 3), 'Houdini P2.6c stage 4 (numpy preview, no MS)', fill=(230, 230, 230))
sheet.paste(hou, (2 * W, L))
d.text((2 * W + 6, L + H + 3), "owner's photo: texas-afternoon, tower crop", fill=(230, 230, 230))
sheet.paste(photo, (2 * W, 2 * L + H))
sheet.save(D + 'sheet.jpg', quality=88)
