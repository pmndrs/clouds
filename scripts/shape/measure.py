#!/usr/bin/env python3
"""Silhouette shape measures for cloud masks (P2-1).

Input: a mask PNG (255 = cloud, 0 = sky, 128 = invalid: ground, haze, unknown),
as written by segment.py, or with --alpha any greyscale alpha image (cloud where
alpha > --alpha-threshold; no invalid zone). Photos and renders share everything
after this point, so an exact alpha mask from the renderer can replace the
colour segmentation without changing any measure.

Per body (8-connected, sqrt(area) >= --min-size * image width):
  aspect_bbox   height / width of the bounding box
  aspect_mom    sqrt(var_y / var_x) of the body's pixels (robust to thin wisps)
  lobe spectrum E[r], r = D/sigma in 4, 8, ..., 128. D is the body's
                thickness, 4*sqrt(minor eigenvalue of its pixel covariance)
                (the diameter for a disc; 1.15x the height for a long slab),
                so a slab's length is not read as outline structure.
                The body is smoothed with a Gaussian of sigma = D/2, D/4, ...
                and thresholded to keep its area (so a circle does not shrink).
                E[r] = area between the outlines at sigma = 2D/r and D/r,
                divided by (perimeter at D/r) * (D/r). It is roughly the mean
                outline displacement removed by that octave of smoothing, in
                units of the scale itself: about 0 for a circle, high for
                lobes. Calibrated on the synthetic shapes, band r holds round
                lobes of radius about 5 D / r (r=16: D/3, r=32: D/6, r=64: D/13,
                r=128: D/26). r=4 and 8 are body scale: they respond to corners
                and to the ends of elongated bodies, not to lobes. Every quantity is relative to D, so a body
                at half resolution gives the same E[r] for the octaves both
                resolve; an octave is reported only if sigma >= 2 px.
  E_top[r], E_base[r]  the same, counting only outline whose outward normal
                points up (top) or down (base), within 60 degrees.
  base_rms      RMS deviation of the lowest outline row per column from a fitted
                line, over the central 80 % of the width, divided by width.
  base_frac     fraction of the outline (smoothed at D/32) whose outward normal
                is within 30 degrees of straight down.
Bodies touching the image border or the invalid zone are "truncated": they
count in area and gap statistics and in the lobe spectrum (the cut side is
edge-replicated at the image border, or continued column-wise into the invalid
zone, and excluded from the counts); aspect and base measures use complete
bodies only.

Per image: body areas / image area, clear-sky gaps and cloud chords along
every 4th row (runs bounded by cloud/sky on both sides), divided by width.

Usage: measure.py MASK [MASK ...] --out DIR [--alpha] [--names ...]
       measure.py --selftest
"""
import argparse
import json
import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shapelib as sl  # noqa: E402

BANDS = [4, 8, 16, 32, 64, 128]
CORE = [4, 8, 16, 32, 64]  # bands required for the derived spectrum numbers
MIN_SIGMA_PX = 2.0
D_PROC_MAX = 384.0  # bodies larger than this are box-downsampled for the spectrum
SPEC_MIN_D = 128.0  # thickness (px) needed to resolve r=64 at sigma 2 px


# ---------------------------------------------------------------- spectrum
def _box_down(a, q):
    if q <= 1:
        return a.astype(np.float64)
    H, W = a.shape
    H2, W2 = (H + q - 1) // q * q, (W + q - 1) // q * q
    b = np.pad(a.astype(np.float64), ((0, H2 - H), (0, W2 - W)), mode="edge")
    return b.reshape(H2 // q, q, W2 // q, q).mean((1, 3))


def _grad(v):
    gy = np.zeros_like(v)
    gx = np.zeros_like(v)
    gy[1:-1] = (v[2:] - v[:-2]) * 0.5
    gx[:, 1:-1] = (v[:, 2:] - v[:, :-2]) * 0.5
    return gx, gy


def _coverage(v, area):
    """Sub-pixel coverage of the level set {v > t}, with t chosen so the
    coverage sums to `area` (area-preserving smoothing). The signed distance to
    the level set is (v - t) / |grad v|; coverage = clip(distance + 0.5, 0, 1).
    This removes the ~0.2/sigma floor that comparing binary outlines adds."""
    gx, gy = _grad(v)
    g = np.maximum(np.hypot(gx, gy), 1e-9)
    band = (v > 1e-3) & (v < 1 - 1e-3)
    vb, gb = v[band], g[band]
    n_in = float((v >= 1 - 1e-3).sum())
    lo, hi = 1e-3, 1 - 1e-3
    for _ in range(30):
        t = 0.5 * (lo + hi)
        s = n_in + np.clip((vb - t) / gb + 0.5, 0, 1).sum()
        if s > area:
            lo = t
        else:
            hi = t
    cov = (v >= 1 - 1e-3).astype(np.float64)
    cov[band] = np.clip((vb - t) / gb + 0.5, 0, 1)
    ny = -gy / g  # outward normal y component: > 0 faces down (image y grows down)
    return cov, ny


def lobe_spectrum(body, inside, D):
    """body: bool crop already padded (outside-image parts edge-replicated);
    inside: bool, True where the crop is inside the image. D in px."""
    q = max(1, int(math.ceil(D / D_PROC_MAX)))
    m = _box_down(body, q)
    ins = _box_down(inside.astype(float), q) > 0.999
    Dp = D / q
    area = m.sum()
    out = dict(E={}, E_top={}, E_base={})
    lv = {}
    for k in range(1, len(BANDS) + 2):
        r = 2 ** k  # sigma = D / r
        if D / r < MIN_SIGMA_PX:
            break
        v = sl.gauss(m, Dp / r, mode="edge")
        cov, ny = _coverage(v, area)
        cgx, cgy = _grad(cov)
        dl = np.hypot(cgx, cgy) * ins  # outline length density
        lv[r] = (cov, ny, dl)
    for r in BANDS:
        if r not in lv or r // 2 not in lv:
            continue
        cc = lv[r // 2][0]
        cf, ny, dl = lv[r]
        sig_p = Dp / r
        diff = np.abs(cc - cf) * ins
        P = dl.sum()
        if P <= 1:
            continue
        up, dn = ny < -0.5, ny > 0.5
        Pt, Pb = dl[up].sum(), dl[dn].sum()
        out["E"][r] = float(diff.sum() / (P * sig_p))
        out["E_top"][r] = float(diff[up].sum() / (Pt * sig_p)) if Pt > 0.02 * P else None
        out["E_base"][r] = float(diff[dn].sum() / (Pb * sig_p)) if Pb > 0.02 * P else None
    # base fraction: share of the outline (smoothed at D/32, or the finest
    # level available) whose outward normal is within 30 degrees of down
    rr = max([r for r in lv if r <= 32], default=None)
    if rr is not None:
        _, ny, dl = lv[rr]
        out["base_frac"] = float(dl[ny > 0.866].sum() / max(dl.sum(), 1e-9))
    return out


def _fill_invalid_columns(body, valid):
    """Continue a body into the invalid zone (ground, haze, obstacles) by copying,
    per column, the nearest valid pixel above (else below). Like the edge
    replication at the image border, this keeps the cut from reading as outline;
    the invalid zone itself is excluded from every count."""
    H, W = body.shape
    rows = np.arange(H)[:, None]
    idx_above = np.where(valid, rows, -1)
    idx_above = np.maximum.accumulate(idx_above, axis=0)
    idx_below = np.where(valid, rows, H)
    idx_below = np.minimum.accumulate(idx_below[::-1], axis=0)[::-1]
    src = np.where(idx_above >= 0, idx_above, idx_below)
    has = src < H
    src = np.clip(src, 0, H - 1)
    filled = body[src, np.arange(W)[None, :]] & has
    return np.where(valid, body, filled)


def base_rms(body):
    """body: bool crop tightly around a complete body."""
    H, W = body.shape
    cols = np.flatnonzero(body.any(0))
    if len(cols) < 10:
        return None
    x0, x1 = cols[0], cols[-1]
    w = x1 - x0 + 1
    xs = np.arange(int(x0 + 0.1 * w), int(x1 - 0.1 * w) + 1)
    xs = xs[body[:, xs].any(0)]
    if len(xs) < 5:
        return None
    yb = H - 1 - np.argmax(body[::-1, xs], 0)
    A = np.stack([xs, np.ones_like(xs)], 1).astype(float)
    c, *_ = np.linalg.lstsq(A, yb.astype(float), rcond=None)
    res = yb - A @ c
    return float(np.sqrt(np.mean(res ** 2)) / w)


# ---------------------------------------------------------------- image
def load_mask(path, alpha=False, thr=0.5):
    a = np.asarray(Image.open(path).convert("L"))
    if alpha:
        cloud = a > thr * 255
        valid = np.ones_like(cloud)
    else:
        cloud = a > 200
        valid = (a < 64) | cloud
    return cloud, valid


def measure_mask(cloud, valid, min_size=0.02, spectrum=True):
    H, W = cloud.shape
    lab, n = sl.label(cloud)
    areas = np.bincount(lab.ravel(), minlength=n + 1)
    invalid = ~valid
    inv_d = sl.gauss(invalid.astype(float), 1.5, mode="edge") > 0.02  # ~3 px dilation
    touch_inv = np.zeros(n + 1, bool)
    touch_inv[np.unique(lab[inv_d & (lab > 0)])] = True
    border = np.unique(np.concatenate([lab[:2].ravel(), lab[-2:].ravel(), lab[:, :2].ravel(), lab[:, -2:].ravel()]))
    touch_b = np.zeros(n + 1, bool)
    touch_b[border] = True
    min_area = (min_size * W) ** 2
    bodies = []
    # bounding boxes via run over labels
    ys, xs = np.nonzero(lab)
    ls = lab[ys, xs]
    order = np.argsort(ls, kind="stable")
    ys, xs, ls = ys[order], xs[order], ls[order]
    starts = np.searchsorted(ls, np.arange(1, n + 2))
    for k in range(1, n + 1):
        if areas[k] < min_area:
            continue
        yk = ys[starts[k - 1]:starts[k]]
        xk = xs[starts[k - 1]:starts[k]]
        y0, y1, x0, x1 = yk.min(), yk.max(), xk.min(), xk.max()
        h, w = y1 - y0 + 1, x1 - x0 + 1
        cov = np.cov(np.stack([xk, yk]).astype(float))
        lmin = max(float(np.linalg.eigvalsh(cov)[0]), 0.25)
        D = 4.0 * math.sqrt(lmin)  # thickness: equals the diameter for a disc
        b = dict(id=int(k), area_frac=float(areas[k] / (H * W)), D_px=D, sqrt_area_px=math.sqrt(areas[k]),
                 cx=float(xk.mean() / W), cy=float(yk.mean() / H),
                 truncated_border=bool(touch_b[k]), truncated_invalid=bool(touch_inv[k]))
        complete = not touch_b[k] and not touch_inv[k]
        b["complete"] = complete
        if complete:
            b["aspect_bbox"] = float(h / w)
            vy, vx = yk.var(), xk.var()
            b["aspect_mom"] = float(math.sqrt(vy / max(vx, 1e-9)))
            crop = lab[y0:y1 + 1, x0:x1 + 1] == k
            b["base_rms"] = base_rms(crop)
        if spectrum and D >= SPEC_MIN_D:
            P = int(math.ceil(1.5 * D)) + 4
            Y0, Y1, X0, X1 = y0 - P, y1 + P + 1, x0 - P, x1 + P + 1
            cy0, cy1, cx0, cx1 = max(Y0, 0), min(Y1, H), max(X0, 0), min(X1, W)
            crop = lab[cy0:cy1, cx0:cx1] == k
            vcrop = valid[cy0:cy1, cx0:cx1]
            if touch_inv[k]:
                crop = _fill_invalid_columns(crop, vcrop)
            pads = ((cy0 - Y0, Y1 - cy1), (cx0 - X0, X1 - cx1))
            ins = np.pad(vcrop, pads, mode="constant", constant_values=False)
            crop = np.pad(crop, pads, mode="edge")
            sp = lobe_spectrum(crop, ins, D)
            b.update(sp)
        bodies.append(b)
    # gaps and chords along every 4th row, only inside valid runs
    gaps, chords = [], []
    for y in range(0, H, 4):
        v = valid[y]
        c = cloud[y]
        # segments: 0 sky, 1 cloud, 2 invalid
        s = np.where(~v, 2, c.astype(int))
        ch = np.flatnonzero(np.diff(s)) + 1
        bounds = np.concatenate(([0], ch, [W]))
        vals = s[bounds[:-1]]
        for i in range(1, len(vals) - 1):
            ln = (bounds[i + 1] - bounds[i]) / W
            if vals[i - 1] == 2 or vals[i + 1] == 2:
                continue
            if vals[i] == 0 and vals[i - 1] == 1 and vals[i + 1] == 1:
                gaps.append(ln)
            elif vals[i] == 1 and vals[i - 1] == 0 and vals[i + 1] == 0:
                chords.append(ln)
    return dict(size=[W, H], n_bodies=len(bodies), cloud_fraction=float(cloud[valid].mean()) if valid.any() else None,
                bodies=bodies, gaps=gaps, chords=chords)


# ---------------------------------------------------------------- summary
def _med(a):
    a = [x for x in a if x is not None and np.isfinite(x)]
    return float(np.median(a)) if a else None


def summarise(res):
    bs = res["bodies"]
    comp = [b for b in bs if b["complete"]]
    spec = [b for b in bs if "E" in b and all(r in b["E"] for r in CORE)]
    s = dict(n_bodies=len(bs), n_complete=len(comp), n_spectrum=len(spec))
    asp = [b["aspect_mom"] for b in comp]
    s["aspect_mom_med"] = _med(asp)
    s["aspect_bbox_med"] = _med([b["aspect_bbox"] for b in comp])
    if len(asp) >= 3:
        la = np.log2(asp)
        s["aspect_log2_iqr"] = float(np.percentile(la, 75) - np.percentile(la, 25))
        s["aspect_p90_over_p10"] = float(2 ** (np.percentile(la, 90) - np.percentile(la, 10)))
    else:
        s["aspect_log2_iqr"] = None
        s["aspect_p90_over_p10"] = None
    s["aspect_max"] = float(max(asp)) if asp else None
    s["base_rms_med"] = _med([b.get("base_rms") for b in comp])
    s["base_frac_med"] = _med([b.get("base_frac") for b in spec])
    for key in ("E", "E_top", "E_base"):
        for r in BANDS:
            s[f"{key}{r}_med"] = _med([b[key].get(r) for b in spec])
    # derived spectrum shape numbers, per body then median.
    #   mid = lobes of radius ~D/3..D/6 (r=16, 32); fine = ~D/13 (r=64);
    #   body scale (r=4, 8) is left out of the ratios (corners, elongation).
    mids, mf, tf = [], [], []
    for b in spec:
        E, T = b["E"], b["E_top"]
        tot = E[8] + E[16] + E[32] + E[64]
        if tot > 0:
            mids.append((E[16] + E[32]) / tot)
        if E[64] > 0:
            mf.append(0.5 * (E[16] + E[32]) / E[64])
        if all(T.get(r) is not None for r in (8, 16, 32, 64)) and T[64] > 0:
            tf.append((T[8] + T[16] + T[32]) / 3.0 / T[64])
    s["mid_share_med"] = _med(mids)
    s["mid_over_fine_med"] = _med(mf)
    s["top_round_over_fuzz_med"] = _med(tf)
    ar = [b["area_frac"] for b in bs]
    s["area_med"] = _med(ar)
    s["area_log10_p90_p10"] = float(np.log10(np.percentile(ar, 90) / np.percentile(ar, 10))) if len(ar) >= 3 else None
    g = res["gaps"]
    s["gap_med"] = _med(g)
    s["gap_p90"] = float(np.percentile(g, 90)) if len(g) >= 5 else None
    s["chord_med"] = _med(res["chords"])
    s["cloud_fraction"] = res["cloud_fraction"]
    return s


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    raise TypeError(type(o))


# ---------------------------------------------------------------- self-test
def _raster(fn, W, H, ss=3):
    """Supersampled rasterisation of an implicit inside-test fn(x, y) -> bool (shape units = px of W)."""
    yy, xx = np.mgrid[0:H * ss, 0:W * ss]
    x = (xx + 0.5) / ss
    y = (yy + 0.5) / ss
    inside = fn(x, y).astype(np.float32)
    return inside.reshape(H, ss, W, ss).mean((1, 3)) > 0.5


def _shapes(scale):
    """Synthetic shapes in a 1000x1000 frame at `scale` (1 = full, 0.5 = half res).
    Returns {name: (inside_fn, [lobe radii in full-res px])}."""
    c = 500 * scale
    rng = np.random.default_rng(1)

    def disc_union(discs):
        def f(x, y):
            out = np.zeros_like(x, bool)
            for (cx, cy, r) in discs:
                out |= (x - cx) ** 2 + (y - cy) ** 2 < r * r
            return out
        return f

    circle = disc_union([(c, c, 220 * scale)])
    # one scale: core + 16 rim discs of radius 40
    R0, r1 = 190 * scale, 40 * scale
    one = [(c, c, R0)] + [(c + R0 * math.cos(t), c + R0 * math.sin(t), r1)
                          for t in np.linspace(0, 2 * math.pi, 16, endpoint=False)]
    # nested, ratio 3: core 110, 7 lobes of 100, each with 7 of 33, each with 6 of 11 (outer arcs)
    R0n, r1n, r2n, r3n = 110 * scale, 100 * scale, 33 * scale, 11 * scale
    nest = [(c, c, R0n)]
    for t in np.linspace(0, 2 * math.pi, 7, endpoint=False):
        x1, y1 = c + R0n * math.cos(t), c + R0n * math.sin(t)
        nest.append((x1, y1, r1n))
        for u in np.linspace(-1.5, 1.5, 7):
            x2, y2 = x1 + r1n * math.cos(t + u), y1 + r1n * math.sin(t + u)
            nest.append((x2, y2, r2n))
            for w in np.linspace(-1.4, 1.4, 6):
                nest.append((x2 + r2n * math.cos(t + u + w), y2 + r2n * math.sin(t + u + w), r3n))
    # rectangle 800 x 300 with fine boundary noise only (wavelengths ~20-35 px, amplitude ~5 px)
    ph = rng.uniform(0, 2 * math.pi, 6)
    fr = 2 * math.pi / (np.array([20, 23, 26, 29, 32, 35.0]) * scale)

    def noise(t):
        return sum(np.sin(fr[i] * t + ph[i]) for i in range(6)) / 3.0 * 5 * scale

    def rect(x, y):
        hw, hh = 400 * scale, 150 * scale
        return (np.abs(x - c) < hw + noise(y * 1.3 + 7)) & (np.abs(y - c) < hh + noise(x))

    def rect_plain(x, y):
        return (np.abs(x - c) < 400 * scale) & (np.abs(y - c) < 150 * scale)
    return dict(circle=(circle, []), lobes_one=(disc_union(one), [40]),
                lobes_nested=(disc_union(nest), [100, 33, 11]), rect_fine_noise=(rect, []),
                rect_plain=(rect_plain, []))


def _band_for(D, rho):
    """Band expected to hold a round lobe of radius rho on a body of thickness D."""
    r = 5.0 * D / rho
    return min(BANDS, key=lambda b: abs(math.log2(b) - math.log2(r)))


def selftest():
    ok = True
    results = {}
    for scale in (1.0, 0.5):
        N = int(1000 * scale)
        for name, (fn, _) in _shapes(scale).items():
            m = _raster(fn, N, N)
            res = measure_mask(m, np.ones_like(m), min_size=0.02)
            big = max(res["bodies"], key=lambda b: b["D_px"])
            results[(name, scale)] = big
    lobes = {k: v[1] for k, v in _shapes(1.0).items()}

    def E(name, scale):
        return results[(name, scale)].get("E", {})
    lines = []

    def check(cond, msg):
        nonlocal ok
        lines.append(("PASS " if cond else "FAIL ") + msg)
        ok &= bool(cond)
    for scale in (1.0, 0.5):
        tag = "full" if scale == 1 else "half"
        ec = E("circle", scale)
        check(max(ec.values()) < 0.02, f"[{tag}] circle: all bands < 0.02 ({fmt(ec)})")
        e1 = E("lobes_one", scale)
        D1 = results[("lobes_one", 1.0)]["D_px"]
        want = _band_for(D1, lobes["lobes_one"][0])
        pk = max(e1, key=e1.get)
        check(abs(math.log2(pk) - math.log2(want)) <= 1 and e1[pk] > 0.1,
              f"[{tag}] one-scale lobes (rho=40, D={D1:.0f}): peak r={pk}, expected r~{want} ({fmt(e1)})")
        low = [r for r in e1 if r <= want // 4]
        check(all(e1[r] < 0.25 * e1[pk] for r in low),
              f"[{tag}] one-scale lobes: bands r<={want // 4} carry < 1/4 of the peak")
        en = E("lobes_nested", scale)
        Dn = results[("lobes_nested", 1.0)]["D_px"]
        bands = sorted({_band_for(Dn, rho) for rho in lobes["lobes_nested"]})
        hit = [b for b in bands if b in en and en[b] > 0.08]
        need = len([b for b in bands if b in en])
        check(need >= 2 and len(hit) == need,
              f"[{tag}] nested lobes (rho 100/33/11, D={Dn:.0f}): expected bands {bands}, "
              f"resolved {need}, >0.08 at {hit} ({fmt(en)})")
        er, ep = E("rect_fine_noise", scale), E("rect_plain", scale)
        dlt = {r: er[r] - ep[r] for r in er if r in ep}
        fine = max(dlt.get(64, 0), dlt.get(128, 0))
        check(fine > 0.1 and all(abs(dlt[r]) < 0.03 for r in (4, 8, 16)),
              f"[{tag}] rect + fine noise minus plain rect: adds > 0.1 at r>=64, < 0.03 at r<=16 ({fmt(dlt)}); "
              f"plain rect corners alone: {fmt(ep)}")
    # resolution independence: bands resolved at both scales (>= 3 px at half res)
    for name in ("circle", "lobes_one", "lobes_nested", "rect_fine_noise", "rect_plain"):
        a, b = E(name, 1.0), E(name, 0.5)
        Dh = results[(name, 0.5)]["D_px"]
        for r in BANDS:
            if r in a and r in b and Dh / r >= 3.0:
                tol = 0.2 * max(a[r], 0.05) + 0.01
                check(abs(a[r] - b[r]) <= tol, f"half-res {name} r={r}: {a[r]:.3f} vs {b[r]:.3f} (tol {tol:.3f})")
    rb = results[("rect_fine_noise", 1.0)]
    check(abs(rb["aspect_bbox"] - 310 / 810) < 0.03, f"rect aspect_bbox {rb['aspect_bbox']:.3f} ~ 0.38")
    check(rb["base_rms"] < 0.01, f"rect base_rms {rb['base_rms']:.4f} < 0.01")
    cb = results[("circle", 1.0)]
    check(abs(cb["aspect_mom"] - 1) < 0.02, f"circle aspect_mom {cb['aspect_mom']:.3f} ~ 1")
    check(abs(cb["D_px"] / 440 - 1) < 0.02, f"circle thickness D {cb['D_px']:.1f} ~ diameter 440")
    check(0.10 < cb["base_frac"] < 0.24, f"circle base_frac {cb['base_frac']:.3f} ~ 0.17")
    check(rb["base_frac"] > 0.3, f"rect base_frac {rb['base_frac']:.3f} > 0.3")
    print("\n".join(lines))
    print("SELFTEST", "OK" if ok else "FAILED")
    return ok


def fmt(e):
    return " ".join(f"{r}:{v:.3f}" for r, v in sorted(e.items()))


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("masks", nargs="*")
    ap.add_argument("--out")
    ap.add_argument("--names", nargs="*")
    ap.add_argument("--alpha", action="store_true", help="inputs are alpha images, not segment.py masks")
    ap.add_argument("--alpha-threshold", type=float, default=0.5)
    ap.add_argument("--min-size", type=float, default=0.02, help="min sqrt(area) as a fraction of width")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        sys.exit(0 if selftest() else 1)
    os.makedirs(a.out, exist_ok=True)
    summary = {}
    for i, p in enumerate(a.masks):
        name = a.names[i] if a.names else os.path.basename(p).replace("_mask.png", "").rsplit(".", 1)[0]
        cloud, valid = load_mask(p, a.alpha, a.alpha_threshold)
        res = measure_mask(cloud, valid, a.min_size)
        res["summary"] = summarise(res)
        res["source"] = p
        with open(os.path.join(a.out, name + ".json"), "w") as f:
            json.dump(res, f, default=_json_default)
        summary[name] = res["summary"]
        s = res["summary"]
        print(f"{name}: bodies {s['n_bodies']} complete {s['n_complete']} spec {s['n_spectrum']} "
              f"aspect {s['aspect_mom_med']} mid_share {s['mid_share_med']}")
    with open(os.path.join(a.out, "summary.json"), "w") as f:
        json.dump(summary, f, indent=1, default=_json_default)


if __name__ == "__main__":
    main()
