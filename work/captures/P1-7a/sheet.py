# P1.7a sheet: rows tower2 / embergen02 x fit-backlit / fit-noon; columns fitMiePhase off | on | |on - off| x4. Run from the repo root.
from PIL import Image, ImageDraw, ImageChops
D = 'work/captures/P1-7a/'
L, W, H = 18, 640, 360
rows = [(c, v) for c in ['tower2', 'embergen02'] for v in ['fit-backlit', 'fit-noon']]
sheet = Image.new('RGB', (3 * W, len(rows) * (L + H)), (17, 17, 17))
d = ImageDraw.Draw(sheet)
for r, (cloud, view) in enumerate(rows):
    y = r * (L + H)
    a = Image.open(f'{D}{cloud}-off/{view}.png').convert('RGB')
    b = Image.open(f'{D}{cloud}-on/{view}.png').convert('RGB')
    diff = ImageChops.difference(a, b).point(lambda v: min(255, v * 4))
    for c, (img, lab) in enumerate([(a, 'fitMiePhase 0 (HG g 0.8)'), (b, 'fitMiePhase 1 (Mie d 10 um)'), (diff, '|on - off| x4')]):
        d.text((c * W + 6, y + 3), f'{cloud}  {view}  {lab}', fill=(230, 230, 230))
        sheet.paste(img, (c * W, y + L))
    la, lb = a.convert('L'), b.convert('L')
    import statistics
    pa, pb = list(la.getdata()), list(lb.getdata())
    n = len(pa)
    print(cloud, view, 'mean off %.1f on %.1f' % (sum(pa) / n, sum(pb) / n), 'sat255 off %d on %d' % (sum(p >= 254 for p in pa), sum(p >= 254 for p in pb)),
          'brighter>20: %d darker>20: %d' % (sum(q - p > 20 for p, q in zip(pa, pb)), sum(p - q > 20 for p, q in zip(pa, pb))))
sheet.save(D + 'sheet.jpg', quality=88)
