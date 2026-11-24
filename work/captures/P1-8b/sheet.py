# P1.8b sheet + numbers. python3 work/captures/P1-8b/sheet.py <dir tower4> <dir houdini>   (dirs hold pt-low.pfm, fit-low-{off,on,alt}.pfm; PFMs left out of the repo)
# Rows tower4, houdini; columns path trace | off | on (fitSkySide 1, fitGroundAtten 1) | alt (fitSkySide 1, fitGroundAtten 0, fitGround 0.36).
# Exposure 0.35 + ACES fit + sRGB, as the card page. Numbers from the linear frames: cloud mask = PT luminance well above the
# frame's sky (top-left corner mean); lit = cloud pixels above the PT's cloud-luminance 75th percentile, shaded = below its 25th
# (same pixel sets for all four columns, chosen from the PT). Prints shaded/lit mean ratio, shade B/R and the form measure
# (std of log-luminance inside the shaded set, after removing the set's mean: how much billow structure survives in shade).
import sys
import numpy as np
from PIL import Image, ImageDraw
W, H, LB = 640, 360, 16
LUM = np.array([0.2126, 0.7152, 0.0722])


def pfm(p):
    with open(p, 'rb') as f:
        t = f.readline().strip(); w, h = map(int, f.readline().split()); s = float(f.readline())
        a = np.frombuffer(f.read(), dtype='<f4' if s < 0 else '>f4').reshape(h, w, 3)
    return a[::-1].astype(np.float64)


def tm(x):
    x = x * 0.35
    y = np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1)
    return Image.fromarray((np.where(y <= 0.0031308, 12.92 * y, 1.055 * np.power(y, 1 / 2.4) - 0.055) * 255 + 0.5).astype(np.uint8))


cols = [('path trace (1024 spp)', 'pt-low'), ('off', 'fit-low-off'), ('on (side 1, atten 1)', 'fit-low-on'), ('alt (side 1, atten 0, ground 0.36)', 'fit-low-alt')]
sheet = Image.new('RGB', (4 * W, 2 * (H + LB)), (17, 17, 17))
dr = ImageDraw.Draw(sheet)
for r, (name, d) in enumerate(zip(('tower4', 'houdini'), sys.argv[1:3])):
    fr = {k: pfm(f'{d}/{k}.pfm') for _, k in cols}
    pt = fr['pt-low']
    for c, (lab, k) in enumerate(cols):
        sheet.paste(tm(fr[k]), (c * W, r * (H + LB) + LB))
        dr.text((c * W + 6, r * (H + LB) + 2), f'{name}: {lab}', fill=(230, 230, 230))
    # mask: use the off frame vs PT sky? simplest: pixels whose PT luminance exceeds sky luminance at that row by 25 %
    sky = pt[:, :8].mean(axis=1) @ LUM    # left-edge column strip per row (cloud sits away from the left edge)
    Lp = pt @ LUM
    mask = (Lp > 1.25 * sky[:, None]) & (Lp > 0.3)
    cl = Lp[mask]
    lo, hi = np.percentile(cl, 25), np.percentile(cl, 75)
    shaded, lit = mask & (Lp < lo), mask & (Lp > hi)
    print(f'{name}: cloud px {mask.sum()}, PT lum p25 {lo:.3f} p75 {hi:.3f}')
    for lab, k in cols:
        a = fr[k]; L = a @ LUM
        ms, ml = a[shaded].mean(axis=0), a[lit].mean(axis=0)
        lg = np.log(np.maximum(L[shaded], 1e-4))
        print(f'  {lab:38s} shaded/lit {ms @ LUM / (ml @ LUM):.3f}  shade B/R {ms[2] / ms[0]:.2f}  lit B/R {ml[2] / ml[0]:.2f}  shade lum {ms @ LUM:.3f} lit lum {ml @ LUM:.3f}  logstd {lg.std():.3f}')
    # shaded/lit by the same sets but defined per-column quartiles (own shade ranking)
    for lab, k in cols:
        L = fr[k] @ LUM
        m = mask
        q1, q3 = np.percentile(L[m], 25), np.percentile(L[m], 75)
        print(f'  own-quartile {lab:30s} p25/p75 {q1 / q3:.3f}')
sheet.save('work/captures/P1-8b/sheet.jpg', quality=92)
