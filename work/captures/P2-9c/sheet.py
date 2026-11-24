# P2.9c sheet: the houdini cloud, card sunward camera + sun, in three renderers. Run from the repo root with the system python3
# (numpy + Pillow); needs Houdini's hoiiotool to read the Karma EXR.
#   columns: ours (fit-sunward, linear PFM) | our path tracer (pt-sunward, 1024 spp, linear PFM) | Karma CPU (32 spp, volume limit 512, OIDN)
#   rows: full frame | 3x crop of the rim nearest the sun (~3 deg) | 3x crop of the left lobe's rim (~15-20 deg from the sun)
# Exposure (sheet.jpg): each image is scaled so the clear sky next to the cloud (two patches: above the top edge, left of the left lobe)
# matches ours, then one exposure (the card's 0.35) and the same ACES fit + sRGB for all.
# sheet_sunmatched.jpg: each scaled by its own sun irradiance instead (ours 33.05 lum from the card report; Karma 0.971 from the
# Physical Sky's DistantLight: intensity 1.234, normalize on, colour (1, 0.752, 0.504)), because the two skies differ (see the log).
# Also prints the rim / sky / body measurements quoted in work/logs/P2-9c.md.
import json, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw
D = 'work/captures/P2-9c/'
HB = '/Applications/Houdini/Houdini21.0.792/Frameworks/Houdini.framework/Versions/Current/Resources/bin/'
W, H, LB = 640, 360, 16
LUM = np.array([0.2126, 0.7152, 0.0722])


def pfm(p):
    with open(p, 'rb') as f:
        t = f.readline().strip(); w, h = map(int, f.readline().split()); s = float(f.readline())
        a = np.frombuffer(f.read(), dtype='<f4' if s < 0 else '>f4').reshape(h, w, 3 if t == b'PF' else 1)
    return a[::-1].astype(np.float64)


def exr(p):
    tmp = p[:-4] + '.tmp.pfm'
    subprocess.run([HB + 'hoiiotool', p, '--ch', 'R,G,B', '-o', tmp], check=True)
    a = pfm(tmp)
    subprocess.run(['rm', tmp])
    return a


def tm(x):
    y = np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1)
    return (np.where(y <= 0.0031308, 12.92 * y, 1.055 * np.power(y, 1 / 2.4) - 0.055) * 255 + 0.5).astype(np.uint8)


# angle from the sun per pixel (card camera: three.js lookAt, y up, fovY 30)
rep = json.load(open('work/captures/P2-9b/houdini/capture.json'))['shots'][0]['report']
p, t = np.array(rep['camera']['position']), np.array(rep['camera']['target'])
sd = np.array(rep['sun']['direction']); sd /= np.linalg.norm(sd)
f = (t - p) / np.linalg.norm(t - p); r = np.cross(f, [0, 1, 0]); r /= np.linalg.norm(r); u = np.cross(r, f)
th = np.tan(np.radians(rep['fovY'] / 2))
xs = (2 * (np.arange(W) + 0.5) / W - 1) * th * W / H; ys = (1 - 2 * (np.arange(H) + 0.5) / H) * th
dd = f + xs[None, :, None] * r + ys[:, None, None] * u
dd /= np.linalg.norm(dd, axis=2, keepdims=True)
ang = np.degrees(np.arccos(np.clip(dd @ sd, -1, 1)))

ims = {'ours (fit)': pfm(D + 'fit-sunward.pfm'), 'our path tracer (1024 spp)': pfm(D + 'pt-sunward.pfm'),
       'Karma (32 spp, vol limit 512, OIDN)': exr(D + 'card-sunward_oidn.exr')}
raw = exr(D + 'card-sunward.exr')
E_SUN = {'ours (fit)': float(np.array(rep['sky']['sunIrradiance']) @ LUM), 'our path tracer (1024 spp)': float(np.array(rep['sky']['sunIrradiance']) @ LUM),
         'Karma (32 spp, vol limit 512, OIDN)': 1.2340301 * float(np.array([1, 0.7524896, 0.50439894]) @ LUM)}
SKY = [(20, 28, 305, 335), (235, 255, 110, 118)]   # rows, cols: clear sky next to the cloud
sky = {k: np.mean([(v @ LUM)[a:b, c:d].mean() for a, b, c, d in SKY]) for k, v in ims.items()}
keys = list(ims)
CROPS = [('rim nearest the sun', (213, 0, 426, 120)), ('left-lobe rim, 15-20 deg from the sun', (70, 180, 283, 300))]

for mode, scale in (('sheet.jpg', {k: sky[keys[0]] / sky[k] for k in keys}), ('sheet_sunmatched.jpg', {k: E_SUN[keys[0]] / E_SUN[k] for k in keys})):
    sheet = Image.new('RGB', (3 * W, 3 * (H + LB)), (17, 17, 17))
    dr = ImageDraw.Draw(sheet)
    for i, k in enumerate(keys):
        im = Image.fromarray(tm(ims[k] * scale[k] * 0.35))
        x = i * W
        sheet.paste(im, (x, LB))
        dr.text((x + 6, 2), f'{k}  x{scale[k]:.3g} ({"sky" if mode == "sheet.jpg" else "sun"}-matched)', fill=(230, 230, 230))
        for j, (lab, box) in enumerate(CROPS):
            dr.rectangle((x + box[0], LB + box[1], x + box[2], LB + box[3]), outline=(255, 80, 80))
            y = (j + 1) * (H + LB)
            sheet.paste(im.crop(box).resize((W, H), Image.LANCZOS), (x, y + LB))
            a0 = ang[(box[1] + box[3]) // 2, (box[0] + box[2]) // 2]
            dr.text((x + 6, y + 2), f'{k}: 3x crop, {lab} ({box[0]},{box[1]})-({box[2]},{box[3]}), centre {a0:.0f} deg from sun', fill=(230, 230, 230))
    sheet.save(D + mode, quality=90)

# measurements: profiles from the sky into the cloud, band-averaged; peak / sky just outside / body further in
P = [('A  top edge, nearest the sun', 'v', (305, 335), range(20, 140)), ('A2 top lobe, left edge', 'h', (90, 110), range(220, 320)),
     ('C  top lobe, right edge', 'h', (140, 160), range(520, 400, -1)), ('B  left lobe, left edge', 'h', (235, 255), range(110, 260))]
ims['Karma raw (no OIDN)'] = raw
E_SUN['Karma raw (no OIDN)'] = E_SUN[keys[2]]
for name, ax, (a, b), run in P:
    run = list(run)
    print('\n==', name)
    for k, im in ims.items():
        L = im @ LUM
        prof = np.array([L[a:b, i].mean() for i in run]) if ax == 'h' else np.array([L[i, a:b].mean() for i in run])
        sm = np.convolve(prof, np.ones(3) / 3, mode='same')
        s0, body = prof[:8].mean(), prof[-12:].mean()
        ip = int(np.argmax(sm[2:-2])) + 2
        half = next((i for i in range(ip, len(prof)) if sm[i] < (sm[ip] + body) / 2), -1)
        quarter = next((i for i in range(ip, len(prof)) if sm[i] < body + (sm[ip] - body) / 4), -1)
        ap = ang[(a + b) // 2, run[ip]] if ax == 'h' else ang[run[ip], (a + b) // 2]
        print(f'  {k:38s} peak/sky {sm[ip] / s0:5.2f}  body/sky {body / s0:4.2f}  peak/body {sm[ip] / body:5.1f}  peak/E_sun {sm[ip] / E_SUN[k]:.3f}'
              f'  at {ap:4.1f} deg  peak->half {half - ip} px, ->quarter {quarter - ip} px')
print('\nE_sun / sky (lum):', {k: round(E_SUN[k] / sky[k], 1) for k in keys})
print('sky-match scale:', {k: round(sky[keys[0]] / sky[k], 3) for k in keys})
# body colour: mean RGB over the lower body and the top-lobe core, divided by the matched-sky RGB
for nm, (y0, y1, x0, x1) in {'top-lobe core': (110, 180, 280, 400), 'lower body': (280, 350, 240, 520)}.items():
    for k in keys:
        rgb = ims[k][y0:y1, x0:x1].reshape(-1, 3).mean(0)
        skyrgb = np.mean([ims[k][a:b, c:d].reshape(-1, 3).mean(0) for a, b, c, d in SKY], axis=0)
        print(f'  {nm:14s} {k:38s} body/sky lum {rgb @ LUM / (skyrgb @ LUM):.2f}  body rgb/lum {np.round(rgb / (rgb @ LUM), 2)}  sky rgb/lum {np.round(skyrgb / (skyrgb @ LUM), 2)}')
