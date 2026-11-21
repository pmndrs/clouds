#!/usr/bin/env python3
"""Cloud-versus-sky segmentation for daytime cumulus photos and JPEG renders.

Model (per image):
  1. Ground: pixels that are not sky-coloured (greenish/brownish, or much darker
     than the sky) and connected to the bottom edge. A per-column horizon line is
     the top of that region; everything below it is excluded ("invalid").
  2. Sky model: warmth f = R/G, fitted as a smooth field (robust least squares,
     cubic polynomial in x, y). Seeds come from each row's lower envelope of f,
     so haze toward the horizon and the zenith gradient are both in the model.
     The fit is iterated on the pixels it classifies as sky.
  3. Cloud score = (f - f_sky) / (k * (1 - f_sky)): how far a pixel has moved
     from the local sky colour toward neutral grey. Score > 1 is cloud.
     Blueness (B-R) and luminance were tried first and fail on shaded bases,
     which keep the sky's blueness and brightness (in our renders they are
     nearly sky-coloured) but are clearly more neutral in R/G. Where the local
     sky itself is near neutral (horizon haze) the zone is marked invalid.
     A second term flags pixels darker than the local sky luminance model by
     more than `dark_drop`: our renders' shaded bases are close to the sky in
     R/G too, but about 25 % darker than the sky beside them.
  4. Clean-up: blur sigma 1 px and re-threshold, remove specks, fill small holes.

Outputs <out>/<name>_mask.png (255 = cloud, 0 = sky, 128 = invalid/ground) and
<out>/<name>_overlay.jpg. The measure script accepts any mask with that
encoding, so an exact alpha mask from the renderer can bypass this file.

Usage: segment.py IMAGE [IMAGE ...] --out DIR [--long 1600]
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageOps

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shapelib as sl  # noqa: E402

PARAMS = dict(
    neutral_frac=0.40,  # cloud if R/G has moved this fraction of the way from local sky to neutral
    dark_drop=0.20,     # or if luminance is this fraction below the local sky
    max_sky_rg=0.86,    # local sky R/G above this (near-white haze): zone is invalid
    min_area_frac=2e-5,  # specks smaller than this fraction of the image are dropped
    hole_frac=2e-5,     # sky holes smaller than this inside cloud are filled
)


def load(path, long_side=1600):
    im = Image.open(path)
    im.draft("RGB", (long_side, long_side))
    im = ImageOps.exif_transpose(im).convert("RGB")
    if max(im.size) > long_side:
        im.thumbnail((long_side, long_side), Image.LANCZOS)
    return np.asarray(im, np.float64) / 255.0


def poly_design(xn, yn, deg=3):
    cols = []
    for i in range(deg + 1):
        for j in range(deg + 1 - i):
            cols.append((xn ** i) * (yn ** j))
    return np.stack(cols, -1)


def robust_fit(X, v, iters=4):
    w = np.ones(len(v))
    coef = None
    for _ in range(iters):
        sw = np.sqrt(w)
        coef, *_ = np.linalg.lstsq(X * sw[:, None], v * sw, rcond=None)
        r = v - X @ coef
        s = 1.4826 * np.median(np.abs(r)) + 1e-6
        w = 1.0 / (1.0 + (r / (2.5 * s)) ** 2)
    return coef


def detect_ground(img, b, L):
    """Bottom-connected non-sky region; returns (ground mask, horizon y per column or -1)."""
    H, W, _ = img.shape
    R, G, B = img[..., 0], img[..., 1], img[..., 2]
    skyL = np.percentile(L[b > np.percentile(b, 70)], 50) if np.any(b > 0) else L.mean()
    cand = ((G > B * 1.03) | (R > B * 1.03) | (L < 0.35 * skyL)) & (b < 0.15)
    cand = sl.gauss(cand.astype(float), 1.5) > 0.5
    lab, n = sl.label(cand)
    if n == 0:
        return np.zeros((H, W), bool), np.full(W, -1)
    bottom = np.unique(lab[-1])
    bottom = bottom[bottom > 0]
    areas = np.bincount(lab.ravel(), minlength=n + 1)
    keep = np.zeros(n + 1, bool)
    for k in bottom:
        if areas[k] > 0.002 * H * W:
            keep[k] = True
    g = keep[lab]
    # per-column horizon: top-most ground pixel; fill everything below it
    has = g.any(0)
    top = np.where(has, np.argmax(g, 0), H)
    # columns without ground but between ground columns: interpolate
    if has.sum() > 0.5 * W:
        xs = np.arange(W)
        top = np.interp(xs, xs[has], top[has]).astype(int)
        hz = top.copy()
    else:
        hz = np.where(has, top, H)
    rows = np.arange(H)[:, None]
    ground = rows >= hz[None, :]
    hz = np.where(hz >= H, -1, hz)
    return ground, hz


def segment(img, params=PARAMS):
    H, W, _ = img.shape
    R, G, B = img[..., 0], img[..., 1], img[..., 2]
    L = 0.2126 * R + 0.7152 * G + 0.0722 * B
    b = (B - R) / (B + R + 0.02)
    ground, hz = detect_ground(img, b, L)
    valid = ~ground
    # Feature: warmth f = R/G. Clear sky has f well below 1 (Rayleigh); cloud,
    # lit or shaded, is near-neutral (f -> 1). Shaded bases lit by skylight keep
    # the sky's blueness and luminance (seen in our renders and in photos) but
    # still move toward neutral in R/G, which is why R/G is used, not B-R or L.
    f = R / (G + 0.02)

    yy, xx = np.mgrid[0:H, 0:W]
    xn = xx / W * 2 - 1
    yn = yy / H * 2 - 1
    rng = np.random.default_rng(0)
    # Pass 0: clouds only ever raise f, so the sky in each row sits near the
    # row's lower envelope of f. Fit a smooth e(y) to row-wise 5th percentiles
    # (rows that are all cloud are rejected), take seeds near that envelope.
    # This keeps horizon haze in the sky model instead of extrapolating into it.
    rows_f = np.full(H, np.nan)
    rows_w = np.zeros(H)
    for y in range(H):
        v = valid[y]
        if v.sum() > 0.1 * W:
            rows_f[y] = np.percentile(f[y][v], 5)
            rows_w[y] = v.sum()
    ok = np.isfinite(rows_f)
    ycoef = np.polyfit(yn[ok, 0], rows_f[ok], 3, w=np.sqrt(rows_w[ok]))
    for _ in range(3):
        fit = np.polyval(ycoef, yn[:, 0])
        good = ok & (rows_f < fit + 0.05)
        ycoef = np.polyfit(yn[good, 0], rows_f[good], 3, w=np.sqrt(rows_w[good]))
    env = np.polyval(ycoef, yn)
    sky = valid & (f < env + 0.25 * np.clip(1 - env, 0.05, 1))
    Xall = poly_design(xn, yn)
    for it in range(4):
        idx = np.flatnonzero(sky.ravel())
        if len(idx) > 40000:
            idx = rng.choice(idx, 40000, replace=False)
        X = poly_design(xn.ravel()[idx], yn.ravel()[idx])
        cf = robust_fit(X, f.ravel()[idx])
        cl = robust_fit(X, L.ravel()[idx])
        f_sky = np.minimum(Xall @ cf, 0.98)
        L_sky = np.maximum(Xall @ cl, 0.03)
        # fraction of the way from the local sky colour to neutral, or a
        # darkening against the local sky (shaded bases that stay sky-coloured)
        score = np.maximum((f - f_sky) / (params["neutral_frac"] * (1.0 - f_sky)),
                           (L_sky - L) / (params["dark_drop"] * L_sky))
        sky = valid & (score < 0.5)
    # Where the local sky is nearly neutral (haze at the horizon), cloud and sky
    # have the same colour; mark that zone invalid instead of guessing.
    lowc = f_sky > params["max_sky_rg"]
    lowc = sl.gauss(lowc.astype(float), 3.0) > 0.5
    valid = valid & ~lowc
    cloud = (sl.gauss(np.where(valid, (score > 1.0).astype(float), 0.0), 1.0) > 0.5) & valid
    cloud = sl.remove_small(cloud, max(9, int(params["min_area_frac"] * H * W)))
    cloud = sl.fill_holes(cloud, int(params["hole_frac"] * H * W)) & valid
    info = dict(horizon_detected=bool((hz >= 0).any()),
                horizon_median_y=float(np.median(hz[hz >= 0])) / H if (hz >= 0).any() else None,
                cloud_fraction=float(cloud.sum() / max(1, valid.sum())),
                valid_fraction=float(valid.mean()))
    return cloud, valid, score, info


def encode_mask(cloud, valid):
    m = np.zeros(cloud.shape, np.uint8)
    m[cloud] = 255
    m[~valid] = 128
    return m


def overlay(img, cloud, valid):
    o = img.copy()
    edge = sl.boundary(cloud)
    edge = sl.gauss(edge.astype(float), 0.7) > 0.15
    o[cloud] = o[cloud] * 0.65 + np.array([1.0, 0.25, 0.1]) * 0.35
    o[~valid] = o[~valid] * 0.4
    o[edge] = [1.0, 1.0, 0.0]
    return Image.fromarray((np.clip(o, 0, 1) * 255).astype(np.uint8))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--long", type=int, default=1600)
    ap.add_argument("--names", nargs="*", help="output names (default: file stem)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    infos = {}
    for i, p in enumerate(a.images):
        name = a.names[i] if a.names else os.path.splitext(os.path.basename(p))[0]
        img = load(p, a.long)
        cloud, valid, _, info = segment(img)
        Image.fromarray(encode_mask(cloud, valid)).save(os.path.join(a.out, name + "_mask.png"))
        overlay(img, cloud, valid).save(os.path.join(a.out, name + "_overlay.jpg"), quality=82)
        info["source"] = p
        infos[name] = info
        print(name, json.dumps(info))
    with open(os.path.join(a.out, "segment_info.json"), "w") as f:
        json.dump(dict(params=PARAMS, images=infos), f, indent=1)


if __name__ == "__main__":
    main()
