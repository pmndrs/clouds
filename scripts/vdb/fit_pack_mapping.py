#!/usr/bin/env python3
"""Fit and plot the profile / detail / density-scale mapping against the Nubis pack (P4-B). Plain python + numpy + PIL.

  python3 -I scripts/vdb/fit_pack_mapping.py plot  --out work/captures/P4-B      # plots + table of the CURRENT nvdf_math.PACK_FIT
  python3 -I scripts/vdb/fit_pack_mapping.py fit                                  # random search, prints a PACK_FIT dict
  python3 -I scripts/vdb/fit_pack_mapping.py stats --out work/captures/P4-B       # pack statistics only (no model)

Data: assets/clouds/{parkouring,stormbird}: R profile, G detail type, B density scale, and the SDF (exact EDT of
profile > 0, negative inside). Depth = -sdf in metres; height fraction = (z - zmin) / (zmax - zmin) over the occupied slices.
"""
import argparse, copy, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nvdf_math as nm  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
CLOUDS = ['parkouring', 'stormbird']
DB = np.arange(0, 60, 4.0)       # depth bin lower edges, 4 m


def load(name):
    root = os.path.join(REPO, 'assets', 'clouds', name)
    meta = json.load(open(os.path.join(root, 'cloud.json')))
    d = meta['dims']
    nv = np.fromfile(os.path.join(root, 'nvdf.bin'), np.uint8).reshape(d[2], d[1], d[0], 4)
    sd = np.fromfile(os.path.join(root, 'sdf.bin'), '<u2').reshape(d[2], d[1], d[0]).astype(np.float32) / 65535 * 4352 - 256
    P, T, S = (nv[..., i].astype(np.float32) / 255 for i in range(3))
    m = P > 0
    return dict(P=P, T=T, S=S, d=-sd, h=nm.height_fraction(m), m=m, name=name)


def pct(v, q=(10, 50, 90)):
    return np.percentile(v, q)


def curves(D, P):
    """percentile-by-depth-bin curves of P (array like D['P']) -> (centres, [n,3] array, counts)"""
    out, cnt = [], []
    for a in DB:
        sel = D['m'] & (D['d'] >= a) & (D['d'] < a + 4)
        cnt.append(int(sel.sum()))
        out.append(pct(P[sel]) if sel.sum() >= 25 else [np.nan] * 3)
    return DB + 2, np.array(out), np.array(cnt)


def model_all(D, prm, seed=1):
    noise = nm.smooth_noise(D['m'].shape, prm['profile']['corrVox'], seed)
    d = np.where(D['m'], D['d'], 0.0)
    P = nm.pack_profile(d, D['h'], noise, prm)
    P = np.where(D['m'], np.maximum(P, 1 / 255), 0)
    T = nm.pack_detail(d, D['h'], prm)
    S = nm.pack_scale(D['h'], prm)
    return P, T, S


def loss_profile(datasets, prm):
    tot, n = 0.0, 0
    for D in datasets:
        P, _, _ = model_all(D, prm)
        _, cm, cnt = curves(D, P)
        _, cd, _ = curves(D, D['P'])
        ok = ~np.isnan(cd[:, 0]) & ~np.isnan(cm[:, 0])
        w = np.minimum(cnt[ok], 1500) ** 0.5
        tot += float((np.abs(cm[ok] - cd[ok]).mean(axis=1) * w).sum() / w.sum())
        # height: p50 of P for depth 12..28 per fifth of height
        for i in range(5):
            sel = D['m'] & (D['h'] >= i / 5) & (D['h'] < (i + 1) / 5 + 1e-6 * (i == 4)) & (D['d'] >= 12) & (D['d'] < 28)
            if sel.sum() > 40:
                tot += 0.5 * abs(np.median(P[sel]) - np.median(D['P'][sel])) / 5
        n += 1
    return tot / n


def loss_channel(datasets, prm, which):
    tot = 0.0
    for D in datasets:
        _, T, S = model_all(D, prm)
        M, key = (T, 'T') if which == 'detail' else (S, 'S')
        for i in range(10):
            sel = D['m'] & (D['h'] >= i / 10) & (D['h'] < (i + 1) / 10 + 1e-6 * (i == 9))
            if sel.sum() > 30:
                if which == 'detail':
                    # compare the median; the pack is near-binary so also compare mean
                    tot += abs(np.median(M[sel]) - np.median(D[key][sel])) + abs(M[sel].mean() - D[key][sel].mean())
                else:
                    tot += abs(M[sel].mean() - D[key][sel].mean()) + abs(np.median(M[sel]) - np.median(D[key][sel]))
    return tot / (len(datasets) * 10)


SPACE = {
    'profile': {'d0': (0, 14), 'D': (20, 90), 'g': (0.7, 2.5), 'base': (0.1, 1.0), 'baseH': (0.05, 0.5), 'sigma': (0.0, 0.8)},
    'detail': {'lo': (0.0, 0.6), 'hi': (0.5, 1.0), 'depthShift': (0.0, 0.4)},
    'scale': {'s0': (0.0, 0.3), 's1': (0.4, 1.0), 'h1': (0.3, 1.0)},
}


def search(datasets, group, lossfn, iters, seed=0):
    rng = np.random.default_rng(seed)
    best = copy.deepcopy(nm.PACK_FIT)
    bl = lossfn(best)
    keys = list(SPACE[group])
    for it in range(iters):
        cand = copy.deepcopy(best)
        scale = 0.4 * (1 - it / iters) + 0.03
        for k in rng.choice(keys, size=rng.integers(1, 3), replace=False):
            lo, hi = SPACE[group][k]
            cand[group][k] = float(np.clip(cand[group][k] + rng.normal() * scale * (hi - lo), lo, hi))
        l = lossfn(cand)
        if l < bl:
            best, bl = cand, l
    return best, bl


def do_fit(args):
    ds = [load(n) for n in CLOUDS]
    best = copy.deepcopy(nm.PACK_FIT)
    best, l1 = search(ds, 'profile', lambda p: loss_profile(ds, p), args.iters, 1)
    print('profile loss', round(l1, 4), best['profile'])
    p2 = best
    p2, l2 = search(ds, 'detail', lambda p: loss_channel(ds, p, 'detail') if True else 0, args.iters, 2) if False else (None, None)
    # detail / scale searches start from the profile result
    nm.PACK_FIT.update(best)
    b2, l2 = search(ds, 'detail', lambda p: loss_channel(ds, p, 'detail'), args.iters, 2)
    print('detail loss', round(l2, 4), b2['detail'])
    nm.PACK_FIT.update(b2)
    b3, l3 = search(ds, 'scale', lambda p: loss_channel(ds, p, 'scale'), args.iters, 3)
    print('scale loss', round(l3, 4), b3['scale'])
    print(json.dumps({k: {kk: round(v, 3) for kk, v in b3[k].items()} for k in b3}, indent=4))


# ---------------------------------------------------------------- plots (PIL)

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

FONT = ImageFont.load_default(size=13)
FONTS = ImageFont.load_default(size=11)
COL = {'pack': (30, 90, 200), 'fit': (220, 80, 20), 'old': (120, 120, 120)}


class Plot:
    def __init__(self, w, h, title, xr, yr, xl, yl):
        self.im = Image.new('RGB', (w, h), 'white')
        self.d = ImageDraw.Draw(self.im)
        self.l, self.t, self.r, self.b = 52, 28, w - 12, h - 38
        self.xr, self.yr = xr, yr
        self.d.text((self.l, 6), title, fill='black', font=FONT)
        self.d.rectangle([self.l, self.t, self.r, self.b], outline=(150, 150, 150))
        for v in np.linspace(yr[0], yr[1], 5):
            y = self.py(v)
            self.d.line([self.l, y, self.r, y], fill=(228, 228, 228))
            self.d.text((6, y - 6), f'{v:.2f}', fill=(80, 80, 80), font=FONTS)
        for v in np.linspace(xr[0], xr[1], 6):
            x = self.px(v)
            self.d.line([x, self.t, x, self.b], fill=(228, 228, 228))
            self.d.text((x - 8, self.b + 4), f'{v:g}', fill=(80, 80, 80), font=FONTS)
        self.d.text((self.l + 4, self.b + 20), xl, fill='black', font=FONTS)
        self.d.text((6, self.t - 14), yl, fill='black', font=FONTS)

    def px(self, x):
        return self.l + (x - self.xr[0]) / (self.xr[1] - self.xr[0]) * (self.r - self.l)

    def py(self, y):
        return self.b - (y - self.yr[0]) / (self.yr[1] - self.yr[0]) * (self.b - self.t)

    def line(self, xs, ys, col, width=2):
        pts = [(self.px(x), self.py(y)) for x, y in zip(xs, ys) if not np.isnan(y)]
        if len(pts) > 1:
            self.d.line(pts, fill=col, width=width)

    def band(self, xs, lo, hi, col):
        ov = Image.new('RGBA', self.im.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        ok = [i for i in range(len(xs)) if not (np.isnan(lo[i]) or np.isnan(hi[i]))]
        poly = [(self.px(xs[i]), self.py(hi[i])) for i in ok] + [(self.px(xs[i]), self.py(lo[i])) for i in reversed(ok)]
        if len(poly) > 2:
            od.polygon(poly, fill=col + (60,))
        self.im = Image.alpha_composite(self.im.convert('RGBA'), ov).convert('RGB')
        self.d = ImageDraw.Draw(self.im)

    def legend(self, items):
        x = self.l + 8
        for text, col in items:
            self.d.line([x, self.t + 12, x + 18, self.t + 12], fill=col, width=3)
            self.d.text((x + 22, self.t + 5), text, fill='black', font=FONTS)
            x += 30 + 7 * len(text)


def old_profile(d, depth=96.0, gamma=1.0):
    return np.power(np.clip(d / depth, 0, 1), gamma)


def height_curves(D, V, nb=10):
    xs, out = [], []
    for i in range(nb):
        sel = D['m'] & (D['h'] >= i / nb) & (D['h'] < (i + 1) / nb + 1e-6 * (i == nb - 1))
        xs.append((i + 0.5) / nb)
        out.append(pct(V[sel]) if sel.sum() > 30 else [np.nan] * 3)
    return np.array(xs), np.array(out)


def do_plot(args, with_model=True):
    os.makedirs(args.out, exist_ok=True)
    ds = [load(n) for n in CLOUDS]
    prm = nm.PACK_FIT
    panels = []
    table = ['# P4-B fitted mapping vs pack (p10 / p50 / p90)', '', f'PACK_FIT = {json.dumps(prm)}', '']
    for D in ds:
        P, T, S = model_all(D, prm)
        # profile vs depth
        pl = Plot(560, 380, f'{D["name"]}: profile vs SDF depth (band p10-p90, line p50)', (0, 56), (0, 1), 'depth below surface (m)', 'profile')
        x, cd, cnt = curves(D, D['P'])
        _, cm, _ = curves(D, P)
        pl.band(x, cd[:, 0], cd[:, 2], COL['pack'])
        pl.line(x, cd[:, 1], COL['pack'])
        pl.band(x, cm[:, 0], cm[:, 2], COL['fit'])
        pl.line(x, cm[:, 1], COL['fit'])
        pl.line(x, old_profile(x), COL['old'], 2)
        pl.legend([('pack', COL['pack']), ('fit', COL['fit']), ('old: d/96', COL['old'])])
        panels.append(pl.im)
        table.append(f'## {D["name"]} profile by depth (m): pack p10/p50/p90 | fit p10/p50/p90 | n')
        for i in range(len(x)):
            if cnt[i] >= 25:
                table.append(f'{x[i]:5.0f}  {cd[i,0]:.3f} {cd[i,1]:.3f} {cd[i,2]:.3f} | {cm[i,0]:.3f} {cm[i,1]:.3f} {cm[i,2]:.3f} | {cnt[i]}')
        # profile vs height at depth 12-28
        pl = Plot(560, 380, f'{D["name"]}: profile p50 vs height, depth 12-28 m', (0, 1), (0, 1), 'height fraction', 'profile')
        for V, col in ((D['P'], COL['pack']), (P, COL['fit'])):
            xs, ys = [], []
            for i in range(10):
                sel = D['m'] & (D['h'] >= i / 10) & (D['h'] < (i + 1) / 10 + 1e-6 * (i == 9)) & (D['d'] >= 12) & (D['d'] < 28)
                xs.append((i + .5) / 10)
                ys.append(np.median(V[sel]) if sel.sum() > 30 else np.nan)
            pl.line(xs, ys, col)
        pl.legend([('pack', COL['pack']), ('fit', COL['fit'])])
        panels.append(pl.im)
        # detail type & density scale vs height
        for V, M, key, label in ((D['T'], T, 'T', 'detail type'), (D['S'], S, 'S', 'density scale')):
            pl = Plot(560, 380, f'{D["name"]}: {label} vs height (band p10-p90, line p50)', (0, 1), (0, 1), 'height fraction', label)
            xs, cd2 = height_curves(D, V)
            _, cm2 = height_curves(D, M)
            pl.band(xs, cd2[:, 0], cd2[:, 2], COL['pack']); pl.line(xs, cd2[:, 1], COL['pack'])
            pl.band(xs, cm2[:, 0], cm2[:, 2], COL['fit']); pl.line(xs, cm2[:, 1], COL['fit'])
            pl.legend([('pack', COL['pack']), ('fit', COL['fit'])])
            panels.append(pl.im)
            table.append(f'## {D["name"]} {label} by height: pack p10/p50/p90 | fit p10/p50/p90')
            for i in range(len(xs)):
                table.append(f'{xs[i]:.2f}  {cd2[i,0]:.2f} {cd2[i,1]:.2f} {cd2[i,2]:.2f} | {cm2[i,0]:.2f} {cm2[i,1]:.2f} {cm2[i,2]:.2f}')
        # detail type vs depth (pack only: shows depth shift)
        pl = Plot(560, 380, f'{D["name"]}: detail type p50 vs depth, h 0.3-0.7', (0, 56), (0, 1), 'depth (m)', 'detail type')
        for V, col in ((D['T'], COL['pack']), (T, COL['fit'])):
            xs, ys = [], []
            for a in DB:
                sel = D['m'] & (D['d'] >= a) & (D['d'] < a + 4) & (D['h'] > .3) & (D['h'] < .7)
                xs.append(a + 2); ys.append(np.median(V[sel]) if sel.sum() > 30 else np.nan)
            pl.line(xs, ys, col)
        pl.legend([('pack', COL['pack']), ('fit', COL['fit'])])
        panels.append(pl.im)
        table.append('')
    cols = 4
    rows = (len(panels) + cols - 1) // cols
    W, H = panels[0].size
    sheet = Image.new('RGB', (cols * W, rows * H), 'white')
    for i, p in enumerate(panels):
        sheet.paste(p, ((i % cols) * W, (i // cols) * H))
    sheet.save(os.path.join(args.out, 'fit-vs-pack.png'))
    open(os.path.join(args.out, 'fit-vs-pack.txt'), 'w').write('\n'.join(table) + '\n')
    print('wrote', os.path.join(args.out, 'fit-vs-pack.png'), sheet.size)
    print('loss profile %.4f detail %.4f scale %.4f' % (loss_profile(ds, prm), loss_channel(ds, prm, 'detail'), loss_channel(ds, prm, 'scale')))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['fit', 'plot'])
    ap.add_argument('--out', default=os.path.join(REPO, 'work', 'captures', 'P4-B'))
    ap.add_argument('--iters', type=int, default=300)
    a = ap.parse_args()
    do_fit(a) if a.cmd == 'fit' else do_plot(a)
