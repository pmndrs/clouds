# P1.8a sheet: fitSkySide (sky light from the sides) off vs on. Run from the repo root with the system python3 (numpy + Pillow):
#   python3 work/captures/P1-8a/sheet.py <views dir houdini> <views dir tower4>     (gen-views.py evals; PFMs left out of the repo)
# Row 1 (houdini sunward, full frames): ours today | fitSkySide 1 (ground unattenuated) | fitSkySide 1 + fitGroundAtten 1 ('on') | our path tracer
#   (P2-9c pt-sunward.pfm, 1024 spp). Row 2 (half size): houdini noon off/on, houdini low off/on, tower4 noon off/on, tower4 low off/on.
# Row 3: tower4 sunward off | on, then houdini 2x crops of the body, off | on. Same exposure (the card's 0.35), ACES fit + sRGB everywhere;
# the skies are identical in ours and the path trace, so no matching. Prints on/off numbers for every pair.
import sys
import numpy as np
from PIL import Image, ImageDraw

W, H, LB = 640, 360, 16
LUM = np.array([0.2126, 0.7152, 0.0722])
OUT = 'work/captures/P1-8a/'


def pfm(p):
    with open(p, 'rb') as f:
        t = f.readline().strip(); w, h = map(int, f.readline().split()); s = float(f.readline())
        a = np.frombuffer(f.read(), dtype='<f4' if s < 0 else '>f4').reshape(h, w, 3 if t == b'PF' else 1)
    return a[::-1].astype(np.float64)


def tm(x):
    x = x * 0.35
    y = np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1)
    return Image.fromarray((np.where(y <= 0.0031308, 12.92 * y, 1.055 * np.power(y, 1 / 2.4) - 0.055) * 255 + 0.5).astype(np.uint8))


hd, tw = sys.argv[1], sys.argv[2]
im = {f'{c}/{v}-{s}': pfm(f'{d}/fit-{v}-{s}.pfm') for c, d in (('houdini', hd), ('tower4', tw)) for v in ('sunward', 'noon', 'low')
      for s in (('off', 'on', 'side') if v == 'sunward' else ('off', 'on'))}
pt = pfm('work/captures/P2-9c/pt-sunward.pfm')

sheet = Image.new('RGB', (4 * W, 2 * (H + LB) + (H // 2 + LB)), (17, 17, 17))
dr = ImageDraw.Draw(sheet)
row1 = [('houdini sunward: ours today (fitSkySide 0)', im['houdini/sunward-off']), ('fitSkySide 1 (ground unattenuated)', im['houdini/sunward-side']),
        ('fitSkySide 1 + fitGroundAtten 1 (on)', im['houdini/sunward-on']), ('our path tracer (P2-9c, 1024 spp)', pt)]
for i, (lab, a) in enumerate(row1):
    sheet.paste(tm(a), (i * W, LB)); dr.text((i * W + 6, 2), lab, fill=(230, 230, 230))
y = H + LB
for i, key in enumerate(['houdini/noon', 'houdini/low', 'tower4/noon', 'tower4/low']):
    for j, s in enumerate(('off', 'on')):
        x = (2 * i + j) * (W // 2)
        sheet.paste(tm(im[f'{key}-{s}']).resize((W // 2, H // 2), Image.LANCZOS), (x, y + LB))
        dr.text((x + 6, y + 2), f'{key} {s}', fill=(230, 230, 230))
y += H // 2 + LB
BOX = (240, 100, 560, 280)   # houdini body (top-lobe core and the lower body)
for i, (lab, a) in enumerate([('tower4 sunward off', im['tower4/sunward-off']), ('tower4 sunward on', im['tower4/sunward-on']),
                              ('houdini body 2x, off', im['houdini/sunward-off']), ('houdini body 2x, on', im['houdini/sunward-on'])]):
    t = tm(a)
    if i >= 2: t = t.crop(BOX).resize((W, H), Image.LANCZOS)
    sheet.paste(t, (i * W, y + LB)); dr.text((i * W + 6, y + 2), lab, fill=(230, 230, 230))
sheet.save(OUT + 'sheet.jpg', quality=88)

# numbers: on / off over the pixels the setting changes (> 1 %), median luminance ratio and B/R before -> after
for k in sorted({k.rsplit('-', 1)[0] for k in im}):
    off, on = im[f'{k}-off'], im[f'{k}-on']
    lo, ln = off @ LUM, on @ LUM
    m = np.abs(ln / np.maximum(lo, 1e-6) - 1) > 0.01
    r = (ln / np.maximum(lo, 1e-6))[m]
    bo, bn = off[m].mean(0), on[m].mean(0)
    print(f'{k:16s} changed px {m.mean() * 100:4.1f} %  lum on/off median {np.median(r):.2f} (p10 {np.percentile(r, 10):.2f}, p90 {np.percentile(r, 90):.2f})'
          f'  B/R {bo[2] / bo[0]:.2f} -> {bn[2] / bn[0]:.2f}')
