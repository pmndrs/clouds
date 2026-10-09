"""L1: target cards for the target-driven authoring loop (docs/PLAN-2026-10-next.md, "Authoring loop").

A *card* is a set of dimensionless shape measures of one cloud seen against blue sky: silhouette mask, width:height, the
width profile (taper, pedestal), base flatness, lean, solidity (notch depth), a lobe-size spectrum along the silhouette
(granulometry), edge sharpness, lit:shadow, and connectedness (necks, pieces).  The same code measures the owner's photo
crop (the target) and our renders (the candidates), so the two are comparable.  System python3 with numpy + Pillow only.

  python3 scripts/targets/card.py card PHOTO --box x0,y0,x1,y1 --out CARD.json [--debug DIR]     # target card
  python3 scripts/targets/card.py measure IMAGE [--box ...]                                        # print a card
  python3 scripts/targets/card.py score CARD.json RENDER... --out SCORES.json [--debug DIR]       # score candidates

Segmentation: the sky is modelled per image as a smooth quadratic in (x, y) per channel, fitted to confidently blue pixels
((B - R) / B above a threshold); cloud is where red rises above that sky model (clouds are grey/white, the sky has little red),
then cleaned (small specks dropped, small holes filled) and the main body kept.  Works for photos and for our renders.
Everything is measured on a canvas resampled so the cloud's bounding box is NORM px tall, so pixel counts are scale-free.
"""
import argparse, json, math, os, sys

import numpy as np
from PIL import Image, ImageDraw

NORM = 256          # measurement canvas: cloud bbox height in px
SKY_S = 0.45        # (B - R) / B above this = confidently sky (photo sky 0.55-0.67; thin cirrus ~0.3; shaded cloud 0.1-0.3)
CLOUD_S = 0.38      # (B - R) / B below this can be cloud (shaded cumulus flanks reach 0.29-0.32; cirrus streaks are 0.45+)
CLOUD_DR = 0.06     # red above the sky model by this much = cloud
NEAR = 0.04         # detached pieces within this fraction of the main body's height are part of the cloud (lobes); farther = other clouds

# ------------------------------------------------------------------------------------------------ image helpers

def load_rgb(path, box=None):
    im = Image.open(path).convert('RGB')
    if box:
        im = im.crop(tuple(box))
    return np.asarray(im).astype(np.float32) / 255.0


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def luminance(rgb):
    lin = srgb_to_linear(rgb)
    return 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]


def fit_sky(rgb, sky_mask, step=4):
    """Quadratic sky model per channel, least squares on confident sky pixels (subsampled)."""
    h, w, _ = rgb.shape
    yy, xx = np.mgrid[0:h:step, 0:w:step]
    m = sky_mask[::step, ::step]
    x = xx[m] / w - 0.5
    y = yy[m] / h - 0.5
    A = np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], 1)
    Y, X = np.mgrid[0:h, 0:w]
    X = X / w - 0.5
    Y = Y / h - 0.5
    full = np.stack([np.ones_like(X), X, Y, X * X, X * Y, Y * Y], -1)
    out = np.empty_like(rgb)
    for c in range(3):
        coef, *_ = np.linalg.lstsq(A, rgb[::step, ::step, c][m], rcond=None)
        out[..., c] = full @ coef
    return out


def label(mask):
    """4-connected components (numpy, label propagation with pointer jumping).  Returns labels (0 = background) and sizes by label."""
    h, w = mask.shape
    lab = np.where(mask, np.arange(1, h * w + 1).reshape(h, w), 0)
    for _ in range(4000):
        prev = lab
        m = lab.copy()
        m[1:, :] = np.maximum(m[1:, :], np.where(mask[1:, :], lab[:-1, :], 0))
        m[:-1, :] = np.maximum(m[:-1, :], np.where(mask[:-1, :], lab[1:, :], 0))
        m[:, 1:] = np.maximum(m[:, 1:], np.where(mask[:, 1:], lab[:, :-1], 0))
        m[:, :-1] = np.maximum(m[:, :-1], np.where(mask[:, :-1], lab[:, 1:], 0))
        flat = m.ravel()
        for _ in range(4):
            nz = flat > 0
            flat = np.where(nz, np.maximum(flat, flat[np.maximum(flat - 1, 0)]), 0)
        lab = flat.reshape(h, w)
        if np.array_equal(lab, prev):
            break
    ids, inv = np.unique(lab, return_inverse=True)
    lab = inv.reshape(h, w)          # 0 stays 0 (it is the smallest id)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    return lab, sizes


def segment(rgb, sky_s=SKY_S, cloud_s=CLOUD_S, cloud_dr=CLOUD_DR, seed=None, min_piece=0.004, near=NEAR):
    """Cloud mask of an RGB image (float 0..1): the component containing seed=(x, y) (else the largest), plus detached pieces
    of at least min_piece x its area lying within near x its height of it (lobes seen apart in projection)."""
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    s = (B - R) / np.maximum(B, 1e-3)
    sky = fit_sky(rgb, s > sky_s)
    dr = R - sky[..., 0]
    mask = (dr > cloud_dr) & (s < cloud_s)
    lab, sizes = label(mask)
    if sizes.max() == 0:
        return mask
    main = int(lab[seed[1], seed[0]]) if seed and lab[seed[1], seed[0]] else int(np.argmax(sizes))
    ys = np.nonzero((lab == main).any(axis=1))[0]
    reach = near * (ys.max() - ys.min() + 1)
    q = 4   # proximity test on a 1/4 grid
    small = (lab == main)[::q, ::q]
    close = edt(~small) <= reach / q
    keep = [main]
    for i in np.nonzero(sizes >= min_piece * sizes[main])[0]:
        if i and i != main and close[(lab == i)[::q, ::q]].any():
            keep.append(int(i))
    mask = np.isin(lab, keep)
    # fill small sky holes (enclosed by cloud); big enclosed gaps are real
    hl, hs = label(~mask)
    border = set(np.unique(np.concatenate([hl[0], hl[-1], hl[:, 0], hl[:, -1]])).tolist())
    holes = [i for i in range(1, len(hs)) if i not in border and hs[i] < 0.01 * mask.sum()]
    if holes:
        mask |= np.isin(hl, holes)
    return mask


def edt(mask):
    """Exact Euclidean distance from each True pixel to the nearest False pixel (0 outside).  Brute force column pass:
    fine for the NORM-sized canvas."""
    h, w = mask.shape
    big = h + w
    g = np.where(mask, big, 0).astype(np.float32)
    for x in range(1, w):
        g[:, x] = np.where(mask[:, x], np.minimum(g[:, x], g[:, x - 1] + 1), 0)
    for x in range(w - 2, -1, -1):
        g[:, x] = np.minimum(g[:, x], g[:, x + 1] + 1)
    g2 = g * g
    ys = np.arange(h, dtype=np.float32)
    dy2 = (ys[:, None] - ys[None, :]) ** 2   # (y, y')
    out = np.empty_like(g2)
    for x0 in range(0, w, 32):
        blk = g2[:, x0:x0 + 32]                                  # (y', k)
        out[:, x0:x0 + 32] = (dy2[:, :, None] + blk[None, :, :]).min(axis=1)
    return np.sqrt(out)


def opening(mask, r):
    """Binary opening by a disc of radius r: erosion = EDT > r, dilation of the eroded set = EDT of its complement <= r."""
    pad = int(math.ceil(r)) + 2
    m = np.pad(mask, pad)
    er = edt(m) > r
    di = edt(~er) <= r
    return di[pad:-pad, pad:-pad]


def convex_hull_mask(mask):
    ys, xs = np.nonzero(mask)
    pts = sorted(set(zip(xs.tolist(), ys.tolist())))
    if len(pts) < 3:
        return mask.copy()

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    im = Image.new('L', (mask.shape[1], mask.shape[0]), 0)
    ImageDraw.Draw(im).polygon(hull, fill=255, outline=255)
    return np.asarray(im) > 0


def blur(a, sigma):
    """Separable Gaussian blur (edge-clamped), numpy only."""
    r = max(1, int(math.ceil(3 * sigma)))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / max(sigma, 1e-3)) ** 2)
    k /= k.sum()
    p = np.pad(a.astype(np.float32), r, mode='edge')
    p = sum(k[i] * p[i:i + p.shape[0] - 2 * r, :] for i in range(2 * r + 1))
    return sum(k[i] * p[:, i:i + p.shape[1] - 2 * r] for i in range(2 * r + 1))


# ------------------------------------------------------------------------------------------------ the card

def normalise(rgb, mask, cut_left=False):
    """Crop to the mask bbox (+ margin) and resample so the bbox is NORM px tall.  Returns (rgb, mask, lum, bbox info)."""
    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    hpx = y1 - y0
    k = NORM / hpx
    mg = int(math.ceil(0.06 * hpx))
    H, W = mask.shape
    cy0, cy1, cx0, cx1 = max(0, y0 - mg), min(H, y1 + mg), max(0, x0 - mg), min(W, x1 + mg)
    size = (max(1, round((cx1 - cx0) * k)), max(1, round((cy1 - cy0) * k)))
    rgb_n = np.asarray(Image.fromarray((rgb[cy0:cy1, cx0:cx1] * 255).astype(np.uint8)).resize(size, Image.LANCZOS)).astype(np.float32) / 255
    m_n = np.asarray(Image.fromarray(mask[cy0:cy1, cx0:cx1].astype(np.uint8) * 255).resize(size, Image.BILINEAR)) > 127
    return rgb_n, m_n, dict(bbox=[int(x0), int(y0), int(x1), int(y1)], scale=k, heightPx=int(hpx))


def measure(rgb, mask, cut_left=False):
    """The card for one cloud: rgb float image and its cloud mask (any resolution).  cut_left: the left edge of the mask is a
    crop cut (the cloud continues), so measures that see it (aspect, width) use only what is inside."""
    rgb_n, m, info = normalise(rgb, mask)
    ys, xs = np.nonzero(m)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    h = y1 - y0
    w = x1 - x0
    lum = luminance(rgb_n)
    rows = m[y0:y1, x0:x1]
    # width profile from base (index 0) to top: horizontal extent of filled pixels per row, normalised by height
    fill = rows.sum(axis=1)[::-1] / h
    nb = 10
    prof = [float(fill[int(i * h / nb):int((i + 1) * h / nb)].mean()) for i in range(nb)]
    maxw = max(prof)
    # base flatness: bottom edge per column over columns whose bottom edge is in the lowest 25 % (the base deck)
    bottom = np.array([np.nonzero(rows[:, c])[0].max() if rows[:, c].any() else -1 for c in range(w)])
    base_cols = bottom >= 0.75 * h
    if base_cols.sum() >= 4:
        bc = np.nonzero(base_cols)[0]
        lo, hi = bc[int(0.15 * len(bc))], bc[int(0.85 * len(bc)) - 1]
        sel = base_cols.copy(); sel[:lo] = False; sel[hi + 1:] = False
        base_flat = float(bottom[sel].std() / h)
        base_frac = float(base_cols.sum() / w)
    else:
        base_flat, base_frac = 0.25, 0.0
    # lean: row centroid over the top 70 %, as an angle from vertical (deg, positive = top to the right)
    cy, cx = [], []
    for r in range(int(0.0 * h), int(0.7 * h)):
        c = np.nonzero(rows[r])[0]
        if len(c):
            cy.append(h - r); cx.append(c.mean())
    lean = float(math.degrees(math.atan(np.polyfit(cy, cx, 1)[0]))) if len(cy) > 4 else 0.0
    # crown offset: x of the top 10 % centroid relative to the base (bottom 15 %) centroid, in heights
    top_c = np.nonzero(rows[:max(1, int(0.1 * h))].any(axis=0))[0].mean()
    bot_c = np.nonzero(rows[int(0.85 * h):].any(axis=0))[0].mean()
    crown_off = float((top_c - bot_c) / h)
    # solidity (notch depth) and the lobe spectrum (granulometry: area removed by opening with discs of growing radius)
    hull = convex_hull_mask(m)
    area = m.sum()
    solidity = float(area / max(1, hull.sum()))
    radii = [0.01, 0.02, 0.04, 0.08, 0.16]
    removed = [float((area - opening(m, r * h).sum()) / area) for r in radii]
    spectrum = [removed[0]] + [max(0.0, removed[i] - removed[i - 1]) for i in range(1, len(removed))]
    # pieces and necks
    lab, sizes = label(m)
    pieces = int((sizes[1:] >= 0.01 * area).sum())
    necks = 0
    sm = np.convolve(fill, np.ones(9) / 9, mode='same')
    for i in range(6, len(sm) - 6):
        if sm[i] == sm[max(0, i - 6):i + 7].min():
            lmax = sm[:i].max() if i else 0
            rmax = sm[i + 1:].max() if i + 1 < len(sm) else 0
            if sm[i] < 0.8 * min(lmax, rmax) and sm[i] > 0:
                necks += 1
    # edge sharpness: luminance gradient across the silhouette boundary, per unit of cloud-sky contrast, in 1/height
    gy, gx = np.gradient(blur(lum, 0.7))
    g = np.hypot(gx, gy)
    inner = edt(m)
    outer = edt(~m)
    ring = (inner > 0) & (inner <= 2) | (outer > 0) & (outer <= 2)
    cloud_l = float(np.median(lum[inner > 4])) if (inner > 4).any() else float(lum[m].mean())
    sky_l = float(np.median(lum[outer > 6])) if (outer > 6).any() else float(lum[~m].mean())
    edge = float(np.percentile(g[ring], 75) / max(1e-4, abs(cloud_l - sky_l)) * h / NORM)
    # lit:shadow and vertical shading
    core = inner > 3
    L = lum[core] if core.any() else lum[m]
    lit_shadow = float(np.percentile(L, 90) / max(1e-4, np.percentile(L, 10)))
    ys_c = np.nonzero(core)[0]
    tb = float(lum[core][ys_c < y0 + h / 3].mean() / max(1e-4, lum[core][ys_c > y0 + 2 * h / 3].mean())) if core.any() else 1.0
    # self-shadowed notches: lobe-scale luminance contrast inside the body (band-pass 1-4 % of height), relative to the mean
    bp = blur(lum, 0.01 * h) - blur(lum, 0.04 * h)
    notch = float(bp[core].std() / max(1e-4, lum[core].mean())) if core.any() else 0.0
    return dict(
        aspect=float(w / h), widthProfile=prof, maxWidth=float(maxw),
        taper=float(np.mean(prof[7:]) / max(1e-4, np.mean(prof[3:6]))),
        pedestal=float(np.mean(prof[1:3]) / max(1e-4, prof[5])),   # base deck (10-30 % of height) vs the tower at mid height
        baseFlat=base_flat, baseFrac=base_frac, leanDeg=lean, crownOffset=crown_off,
        solidity=solidity, lobeSpectrum=spectrum, pieces=pieces, necks=necks,
        edge=edge, litShadow=lit_shadow, topBottom=tb, notch=notch,
        cutLeft=bool(cut_left), norm=dict(info, canvas=list(m.shape[::-1])),
    ), m, rgb_n


# ------------------------------------------------------------------------------------------------ scoring

# per-measure tolerance: |candidate - target| = tol gives similarity exp(-1)
TOL = dict(aspect=0.25, taper=0.2, pedestal=0.35, baseFlat=0.02, leanDeg=8.0, crownOffset=0.12, solidity=0.08, edge=0.6,
           litShadow=0.6, topBottom=0.25, notch=0.05, necks=1.5, pieces=1.5)
WEIGHT = dict(aspect=1.0, taper=1.5, pedestal=1.5, baseFlat=1.0, leanDeg=0.5, crownOffset=1.0, solidity=1.5, edge=0.5,
              litShadow=0.75, topBottom=0.5, notch=1.0, necks=0.5, pieces=0.5, widthProfile=2.0, lobeSpectrum=1.5)


def silhouette_iou(mt, mc, cut_left=False):
    """Best IoU of two NORM-height masks, bottoms aligned, over horizontal shifts.  With cut_left, candidate pixels left of the
    target's left edge do not count against it (the target's left side is a crop cut)."""
    def tight(m):
        ys, xs = np.nonzero(m)
        return m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    a, b = tight(mt), tight(mc)
    H = max(a.shape[0], b.shape[0])
    best, best_dx = 0.0, 0
    for dx in range(-int(0.5 * NORM), int(0.5 * NORM) + 1, 2):
        x0 = min(0, dx)
        W = max(a.shape[1], dx + b.shape[1]) - x0
        A = np.zeros((H, W), bool); Bm = np.zeros((H, W), bool)
        A[H - a.shape[0]:, -x0:-x0 + a.shape[1]] = a
        Bm[H - b.shape[0]:, dx - x0:dx - x0 + b.shape[1]] = b
        if cut_left:
            Bm[:, :-x0] = False
        inter = (A & Bm).sum(); uni = (A | Bm).sum()
        iou = inter / max(1, uni)
        if iou > best:
            best, best_dx = float(iou), dx
    return best, best_dx


def similarity(t, c):
    parts = {}
    for k, tol in TOL.items():
        parts[k] = math.exp(-((c[k] - t[k]) / tol) ** 2)
    wp = np.array(c['widthProfile']) - np.array(t['widthProfile'])
    parts['widthProfile'] = math.exp(-(np.sqrt((wp ** 2).mean()) / 0.12) ** 2)
    ls = np.array(c['lobeSpectrum']) - np.array(t['lobeSpectrum'])
    parts['lobeSpectrum'] = math.exp(-(np.sqrt((ls ** 2).sum()) / 0.04) ** 2)
    total = sum(WEIGHT[k] * v for k, v in parts.items()) / sum(WEIGHT[k] for k in parts)
    return total, parts


def score(target, tmask, rgb, mask):
    card, m, _ = measure(rgb, mask)
    iou, dx = silhouette_iou(tmask, m, target.get('cutLeft', False))
    feat, parts = similarity(target, card)
    return dict(total=round(0.5 * iou + 0.5 * feat, 4), iou=round(iou, 4), features=round(feat, 4), dx=dx,
                parts={k: round(v, 3) for k, v in parts.items()}, card=card), m


def save_mask(m, path):
    Image.fromarray(m.astype(np.uint8) * 255).save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('card'); c.add_argument('photo'); c.add_argument('--box', required=True); c.add_argument('--out', required=True)
    c.add_argument('--seed', help='x,y inside the cloud (photo px)'); c.add_argument('--cut-left', action='store_true'); c.add_argument('--debug')
    c.add_argument('--name', default='target')
    m = sub.add_parser('measure'); m.add_argument('image'); m.add_argument('--box')
    s = sub.add_parser('score'); s.add_argument('card'); s.add_argument('renders', nargs='+'); s.add_argument('--out', required=True); s.add_argument('--debug')
    a = ap.parse_args()
    if a.cmd == 'card':
        box = [int(v) for v in a.box.split(',')]
        rgb = load_rgb(a.photo, box)
        seed = [int(v) - box[i] for i, v in enumerate(a.seed.split(','))] if a.seed else None
        mask = segment(rgb, seed=seed)
        card, mn, rgb_n = measure(rgb, mask, a.cut_left)
        card.update(name=a.name, source=os.path.basename(a.photo), box=box)
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        json.dump(card, open(a.out, 'w'), indent=1)
        np.save(a.out[:-5] + '.mask.npy', mn)
        if a.debug:
            os.makedirs(a.debug, exist_ok=True)
            save_mask(mn, os.path.join(a.debug, a.name + '-mask.png'))
            Image.fromarray((rgb_n * 255).astype(np.uint8)).save(os.path.join(a.debug, a.name + '-norm.jpg'))
        print(json.dumps({k: v for k, v in card.items() if k != 'norm'}, indent=1))
    elif a.cmd == 'measure':
        rgb = load_rgb(a.image, [int(v) for v in a.box.split(',')] if a.box else None)
        card, _, _ = measure(rgb, segment(rgb))
        print(json.dumps(card, indent=1))
    else:
        target = json.load(open(a.card))
        tmask = np.load(a.card[:-5] + '.mask.npy')
        out = {}
        for r in a.renders:
            name = os.path.splitext(os.path.basename(r))[0]
            rgb = load_rgb(r)
            try:
                res, mk = score(target, tmask, rgb, segment(rgb))
            except Exception as e:  # an empty or broken render scores 0
                res, mk = dict(total=0.0, iou=0.0, features=0.0, error=str(e)), None
            out[name] = res
            if a.debug and mk is not None:
                os.makedirs(a.debug, exist_ok=True)
                save_mask(mk, os.path.join(a.debug, name + '-mask.png'))
            print(f'{name:40s} total {res["total"]:.3f}  iou {res["iou"]:.3f}  feat {res["features"]:.3f}', flush=True)
        json.dump(out, open(a.out, 'w'), indent=1)


if __name__ == '__main__':
    main()
