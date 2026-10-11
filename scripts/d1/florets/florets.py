#!/usr/bin/env python3
"""Floret morphology metric (numpy + Pillow only; read-only on its inputs).

Band energy (d1.py bands3) measures how much luminance variance sits at a scale; it cannot tell one smooth balloon with a few creases
from a crest tiled with domes. This measures the *shape* of the 20-60 px (4k) structure on the lit cloud interior:

  Inputs are luminance 0..255 at 4k-equivalent scale (the r8 crop sheets already are: 1:1 of 4k or 2x of 1080p).
  Mask: cloud (low chroma, not sky) eroded by EDGE px so the silhouette is excluded; 'lit' = the brighter half of that interior.

  Scale-normalised Hessian of the Gaussian-blurred luminance at sigma in SIGMAS (7, 10, 14, 20 px: blob diameters 2*sqrt(2)*sigma ~ 20-57 px).
  Per pixel, eigenvalues mu1 <= mu2 of sigma^2 * H.  A bright dome (a floret cap) has both negative; a ridge or a ledge / step edge has one
  eigenvalue near zero or the two of opposite sign.

  domes / pits = bright / dark blob counts: maxima in (x, y, sigma) of -mu2 (mu2 < 0) / mu1 (mu1 > 0) above tau, then global NMS
           (a blob suppresses weaker ones inside its radius 1.41 sigma). tau = REL (0.25) x the lit face's own RMS sigma^2-Laplacian
           (contrast-normalised: counts shape, not amount). REL was fixed once on Decima's own pair image101 (up-rez) vs image102 (raw).
  blobs  = (domes + pits) per 1e4 lit px: THE floret metric. Pair it with b3lit (bands3 on the lit half: the amount).
  dfrac  = domes / (domes + pits) (frames ~0.5: an egg-crate of domes and hollows), round = median mu2/mu1 at domes, cover = lit fraction
           within 1.5 sigma of a dome.
Also prints bands3 (the judges' band std) for the same pixels so the two can be compared.

Usage
  florets.py sheet <sheet.png> [<sheet.png> ...]        crop sheets frame | r6 | r8 (10 px gaps), one row per panel
  florets.py img <image> --box x,y,w,h [--scale s] [--label name] ...   any image (e.g. a 4k frame or capture) with a box in its own pixels
"""
import argparse, os, sys
import numpy as np
from PIL import Image

LUMA = np.array([0.2126, 0.7152, 0.0722])
SIGMAS = (7.0, 10.0, 14.0, 20.0)
EDGE = 24
TAU = 1.0
REL = float(os.environ.get('FLORET_REL', '0.5'))
MODE = os.environ.get('FLORET_MODE', 'rel')


def gauss(a, s):
    r = int(3 * s + 1)
    p = np.pad(a, r, mode='reflect')
    F = np.fft.rfft2(p)
    fy = np.fft.fftfreq(p.shape[0])[:, None]
    fx = np.fft.rfftfreq(p.shape[1])[None, :]
    g = np.exp(-2 * np.pi ** 2 * s * s * (fx * fx + fy * fy))
    return np.fft.irfft2(F * g, s=p.shape)[r:-r, r:-r]


def box(a, r):
    k = 2 * r + 1
    p = np.pad(a, r, mode='edge')
    c = np.pad(np.cumsum(np.cumsum(p, 0), 1), ((1, 0), (1, 0)))
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def erode(m, r):
    # square erosion via box filter of the mask
    return box(m.astype(float), r) > 0.999


def cloud_mask(rgb):
    """rgb 0..1. Cloud = low chroma against a blue/teal sky. The labels' yellow text (top-left) is dropped by the caller."""
    mx = rgb.max(-1); mn = rgb.min(-1)
    chroma = (mx - mn) / np.maximum(mx, 1e-3)
    bmr = rgb[..., 2] - rgb[..., 0]
    return (chroma < 0.2) & (bmr < 0.16) & (mx > 0.3)


def hessian_eigs(L, s):
    g = gauss(L, s)
    gy, gx = np.gradient(g)
    gyy, gyx = np.gradient(gy)
    gxy, gxx = np.gradient(gx)
    xy = 0.5 * (gxy + gyx)
    tr = (gxx + gyy) * s * s
    det_term = np.sqrt(((gxx - gyy) * s * s) ** 2 + 4 * (xy * s * s) ** 2)
    mu1 = 0.5 * (tr - det_term)   # most negative
    mu2 = 0.5 * (tr + det_term)
    return mu1, mu2, g


def maxfilter(a, r):
    out = a.copy()
    for ax in (0, 1):
        acc = out.copy()
        for k in range(1, r + 1):
            for sg in (1, -1):
                acc = np.maximum(acc, np.roll(out, sg * k, ax))
        out = acc
    return out


def bands3(L, m):
    b1 = L - box(L, 1); b2 = box(L, 2) - box(L, 6); b3 = box(L, 6) - box(L, 16)
    return [float(b[m].std()) for b in (b1, b2, b3)]


def detect(R, eig, mask, tau, sign):
    """Scale-space maxima of R (stack over SIGMAS) inside mask above tau, then global NMS (a blob suppresses weaker ones within its radius)."""
    peaks = []
    for i, s in enumerate(SIGMAS):
        r = R[i]
        loc = (r >= maxfilter(r, int(round(s)))) & (r > tau) & mask
        if i > 0: loc &= r >= R[i - 1]
        if i < len(SIGMAS) - 1: loc &= r >= R[i + 1]
        mu1, mu2 = eig[i]
        for y, x in zip(*np.nonzero(loc)):
            a, b = (mu2[y, x], mu1[y, x]) if sign < 0 else (mu1[y, x], mu2[y, x])
            peaks.append((int(y), int(x), s, float(r[y, x]), float(a / b) if b != 0 else 0.0))
    peaks.sort(key=lambda p: -p[3])
    kept = []
    for p in peaks:
        if all((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 > (1.41 * max(p[2], q[2])) ** 2 for q in kept):
            kept.append(p)
    return kept


def coverage(peaks, mask):
    cov = np.zeros(mask.shape, bool)
    H, W = mask.shape
    for (y, x, s, rv, ro) in peaks:
        rr = int(1.5 * s)
        y0, y1, x0, x1 = max(0, y - rr), min(H, y + rr + 1), max(0, x - rr), min(W, x + rr + 1)
        yy, xx = np.mgrid[y0:y1, x0:x1]
        cov[y0:y1, x0:x1] |= (yy - y) ** 2 + (xx - x) ** 2 <= rr * rr
    return float((cov & mask).sum() / max(mask.sum(), 1))


def measure(rgb, top=16, tau=None):
    """rgb float 0..1 (H, W, 3) at 4k-equivalent scale. Returns the metric dict."""
    tau = TAU if tau is None else tau
    L = (rgb @ LUMA) * 255.0
    cm = cloud_mask(rgb)
    cm[:top] = False
    inner = erode(cm, EDGE)
    inner[:EDGE] = inner[-EDGE:] = False; inner[:, :EDGE] = inner[:, -EDGE:] = False
    if inner.sum() < 2000:
        return None
    g10 = gauss(L, 10)
    lit = inner & (g10 >= np.median(g10[inner]))
    eig = [hessian_eigs(L, s)[:2] for s in SIGMAS]
    Rd = np.stack([np.where(e[1] < 0, -e[1], 0.0) for e in eig])   # bright domes: both eigenvalues negative, response = the weaker curvature
    Rp = np.stack([np.where(e[0] > 0, e[0], 0.0) for e in eig])    # dark pits: both positive
    # contrast-normalised threshold (REL): tau = REL x the lit face's own RMS scale-normalised Laplacian over SIGMAS, so the count measures the
    # shape of the structure (how many distinct blobs share the face's own contrast), not its amount. ABS mode uses the fixed 8-bit tau.
    lap_rms = float(np.sqrt(np.mean([((e[0] + e[1])[lit] ** 2).mean() for e in eig])))
    t = REL * lap_rms if MODE == 'rel' else tau
    domes = detect(Rd, eig, lit, t, -1)
    pits = detect(Rp, eig, lit, t, +1)
    n = lit.sum() / 1e4
    nd, npit = len(domes) / n, len(pits) / n
    out = {
        'lit_px': int(lit.sum()), 'lap_rms': lap_rms,
        'domes': nd, 'pits': npit,
        'floret': nd - npit,                    # florets tile the face with domes separated by creases (dark ridges, not dark round pits)
        'dfrac': nd / max(nd + npit, 1e-9),
        'round': float(np.median([p[4] for p in domes])) if domes else 0.0,
        'cover': coverage(domes, lit),
        'resp': float(np.median([p[3] for p in domes])) if domes else 0.0,
        'domeE': [float(Rd[i][lit].mean()) for i in range(len(SIGMAS))],
        'b3': bands3(L, inner), 'b3lit': bands3(L, lit),
        '_peaks': domes, '_pits': pits, '_lit': lit,
    }
    return out


def load(path):
    return np.asarray(Image.open(path).convert('RGB')).astype(np.float32) / 255.0


def panels(sheet):
    """Split a crop sheet at its dark 10 px gap columns."""
    a = load(sheet)
    col_std = a.reshape(a.shape[0], a.shape[1], 3).std(axis=(0, 2))
    col_mean = a.mean(axis=(0, 2))
    gap = (col_std < 0.02) & (col_mean < 0.25)
    cuts = []; x = 0; W = a.shape[1]
    start = 0
    while x < W:
        if gap[x]:
            e = x
            while e < W and gap[e]: e += 1
            if x - start > 50: cuts.append((start, x))
            start = e; x = e
        else:
            x += 1
    if W - start > 50: cuts.append((start, W))
    return [a[:, x0:x1] for x0, x1 in cuts]


def debug_png(im, m, out):
    from PIL import ImageDraw
    a = np.asarray(im).copy()
    lit = m['_lit']
    a[~lit] = (a[~lit] * 0.5).astype(a.dtype)
    im2 = Image.fromarray(a); d = ImageDraw.Draw(im2)
    for (y, x, s, rv, ro) in m['_peaks']:
        r = 1.41 * s
        d.ellipse((x - r, y - r, x + r, y + r), outline=(255, 0, 0))
    for (y, x, s, rv, ro) in m['_pits']:
        r = 1.41 * s
        d.ellipse((x - r, y - r, x + r, y + r), outline=(0, 160, 255))
    im2.save(out)


def fmt(name, m):
    if m is None:
        return f'{name:34} (too little cloud)'
    b = m['b3lit']
    return (f'{name:30} floret={m["floret"]:5.2f} domes={m["domes"]:4.2f} pits={m["pits"]:4.2f} dfrac={m["dfrac"]:.2f} round={m["round"]:.2f} '
            f'blobs={m["domes"]+m["pits"]:4.2f} cover={m["cover"]:.2f} lap={m["lap_rms"]:.2f} resp={m["resp"]:.2f} dE14={m["domeE"][2]:.2f} | b3lit={b[0]:.2f}/{b[1]:.2f}/{b[2]:.2f} lit={m["lit_px"]}')


def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('sheet'); s.add_argument('sheets', nargs='+'); s.add_argument('--names', default='frame,r6,r8')
    s = sub.add_parser('img'); s.add_argument('imgs', nargs='+'); s.add_argument('--box', required=True); s.add_argument('--scale', type=float, default=1.0); s.add_argument('--debug')
    a = ap.parse_args()
    if a.cmd == 'sheet':
        names = a.names.split(',')
        for sh in a.sheets:
            ps = panels(sh)
            tag = os.path.basename(sh).replace('D1h-crop-', '').replace('.png', '')
            for i, p in enumerate(ps):
                print(fmt(f'{tag}:{names[i] if i < len(names) else i}', measure(p)))
    else:
        x, y, w, h = [int(v) for v in a.box.split(',')]
        for p in a.imgs:
            im = Image.open(p).convert('RGB').crop((x, y, x + w, y + h))
            if a.scale != 1.0:
                im = im.resize((int(im.width * a.scale), int(im.height * a.scale)), Image.BICUBIC)
            m = measure(np.asarray(im).astype(np.float32) / 255.0, top=0)
            print(fmt(os.path.basename(p)[:34], m))
            if a.debug and m:
                debug_png(im, m, os.path.join(a.debug, os.path.basename(p).replace(':', '_')[:60] + '.png'))


if __name__ == '__main__':
    main()
