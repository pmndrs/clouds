# P1.7b sheet: rows tower2 / embergen02 (fit-sunward), columns fitMiePhase off | on | |on - off| x4; last row the owner's backlit cumulus photo
# (and the fitMsFwd probes if present). Prints the mean luminance change on core and bright-rim pixels. Run from the repo root.
import os
from PIL import Image, ImageDraw, ImageChops
D = 'work/captures/P1-7b/'
L, W, H = 18, 640, 360
PHOTO = os.path.expanduser('~/Developer/WebGPUClouds/artifacts/research/cloud-photos/cumulus-mediocris/a_20220702-153940_dsc00195.jpg')
def split(off, other):
    """Mean luminance change by pixel class of the off frame: core (L < 190) and bright rim (L >= 230)."""
    o, m = list(off.convert('L').getdata()), list(other.convert('L').getdata())
    out = {}
    for lab, f in [('core L<190', lambda v: v < 190), ('rim L>=230', lambda v: v >= 230)]:
        ch = [i for i, v in enumerate(o) if f(v) and m[i] != v]
        out[lab] = round(sum(m[i] - o[i] for i in ch) / max(1, len(ch)), 1)
    return out

rows = ['tower2', 'embergen02']
extra = [n for n in ['embergen02-msfwd07', 'tower2-msfwd07'] if os.path.exists(f'{D}{n}/fit-sunward.png')]
sheet = Image.new('RGB', (3 * W, (len(rows) + 1) * (L + H)), (17, 17, 17))
d = ImageDraw.Draw(sheet)
for r, cloud in enumerate(rows):
    y = r * (L + H)
    a = Image.open(f'{D}{cloud}-off/fit-sunward.png').convert('RGB')
    b = Image.open(f'{D}{cloud}-on/fit-sunward.png').convert('RGB')
    diff = ImageChops.difference(a, b).point(lambda v: min(255, v * 4))
    for c, (img, lab) in enumerate([(a, 'fitMiePhase 0 (HG g 0.8)'), (b, 'fitMiePhase 1 (Mie d 10 um)'), (diff, '|on - off| x4')]):
        d.text((c * W + 6, y + 3), f'{cloud}  fit-sunward  {lab}', fill=(230, 230, 230))
        sheet.paste(img, (c * W, y + L))
    print(cloud, 'Mie on - off by class:', split(a, b))
y = len(rows) * (L + H)
ph = Image.open(PHOTO).convert('RGB')
ph = ph.resize((W, round(ph.height * W / ph.width)))
top = (ph.height - H) // 2
sheet.paste(ph.crop((0, top, W, top + H)), (0, y + L))
d.text((6, y + 3), 'owner photo dsc00195 (cumulus-mediocris, sun behind the top edge)', fill=(230, 230, 230))
for i, n in enumerate(extra[:2]):
    img = Image.open(f'{D}{n}/fit-sunward.png').convert('RGB')
    sheet.paste(img, ((i + 1) * W, y + L))
    d.text(((i + 1) * W + 6, y + 3), f'{n}: fitMsFwd 0.7, fitMiePhase 0', fill=(230, 230, 230))
    print(n, '- off by class:', split(Image.open(f"{D}{n.split('-')[0]}-off/fit-sunward.png").convert('RGB'), img))
sheet.save(D + 'sheet.jpg', quality=88)
