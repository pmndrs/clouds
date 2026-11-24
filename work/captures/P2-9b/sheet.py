# P2.9b sheet: rows tower4 / houdini; columns fit-sunward | pt-sunward (spp 1024) | 3x crop fit | 3x crop pt. Run from the repo root.
# Also prints cloud-body luminance (grey pixels, 2 px blur) for fit vs pt.
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
D = 'work/captures/P2-9b/'
W, H, L = 640, 360, 18
CROP = {'tower4': (250, 230, 463, 350), 'houdini': (300, 50, 513, 170)}
sheet = Image.new('RGB', (4 * W, 2 * (L + H)), (17, 17, 17))
d = ImageDraw.Draw(sheet)
for r, c in enumerate(['tower4', 'houdini']):
    y = r * (L + H)
    x0, y0, x1, y1 = CROP[c]
    for i, v in enumerate(['fit-sunward', 'pt-sunward']):
        im = Image.open(f'{D}{c}/{v}.png').convert('RGB')
        sheet.paste(im, (i * W, y + L))
        d.text((i * W + 6, y + 3), f'{c} {v}' + (' (spp 1024)' if v[0] == 'p' else ''), fill=(230, 230, 230))
        d.rectangle((i * W + x0, y + L + y0, i * W + x1, y + L + y1), outline=(255, 80, 80))
        sheet.paste(im.crop(CROP[c]).resize((W, H), Image.LANCZOS), ((2 + i) * W, y + L))
        d.text(((2 + i) * W + 6, y + 3), f'{c} {v} 3x crop ({x0},{y0})-({x1},{y1})', fill=(230, 230, 230))
        g = np.asarray(im.convert('L').filter(ImageFilter.GaussianBlur(2)), float)
        a = np.asarray(im, float)
        m = (a[..., 2] - a[..., 0]) < 28
        print(c, v, 'cloud px', int(m.sum()), 'mean lum', round(g[m].mean(), 1), 'p95', round(float(np.percentile(g[m], 95)), 1))
sheet.save(D + 'sheet.jpg', quality=88)
