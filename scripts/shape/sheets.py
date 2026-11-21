#!/usr/bin/env python3
"""P2-1 sheets: mask overlays (6 photos + 2 renders) and the lobe-spectrum plot.

Usage: sheets.py --work SCRATCH_DIR --summary work/captures/P2-1/summary.json --out work/captures/P2-1
"""
import argparse
import json
import math
import os

from PIL import Image, ImageDraw

OVERLAYS = ["texas-afternoon", "med-DSC00200", "con-DSC00669", "hum-050524", "med-3F491003", "med-DSC00809",
            "ours-horizon-ground", "ours-horizon-gp7"]
COL = dict(photo=(70, 130, 220), photo_lt=(200, 218, 245), ground=(220, 80, 40), gp7=(240, 160, 30),
           park=(60, 160, 90), grid=(225, 225, 225), text=(30, 30, 30))


def save_small(im, path, limit=300_000):
    for qual in (85, 78, 70, 62, 55):
        im.save(path, quality=qual, optimize=True)
        if os.path.getsize(path) < limit:
            return qual
    return qual


def overlay_sheet(work, out):
    tw, th, lab = 480, 320, 16
    sheet = Image.new("RGB", (4 * tw, 2 * (th + lab)), "white")
    d = ImageDraw.Draw(sheet)
    for i, n in enumerate(OVERLAYS):
        im = Image.open(os.path.join(work, n + "_overlay.jpg")).convert("RGB")
        im.thumbnail((tw, th), Image.LANCZOS)
        x, y = (i % 4) * tw, (i // 4) * (th + lab)
        sheet.paste(im, (x + (tw - im.size[0]) // 2, y + lab))
        d.text((x + 4, y + 2), n + ("  (our render)" if n.startswith("ours") else "  (photo)"), fill=COL["text"])
    p = os.path.join(out, "overlays.jpg")
    q = save_small(sheet, p)
    return p, q


def spectrum_plot(summary, out):
    S = json.load(open(summary))
    sp = S["spectrum"]
    bands = [4, 8, 16, 32, 64]
    W, H = 1100, 620
    L, R, T, B = 90, 300, 40, 80
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    ymax = 0.8

    def X(r):
        return L + (math.log2(r) - 2) / 4 * (W - L - R)

    def Y(v):
        return T + (1 - v / ymax) * (H - T - B)
    for v in [0, 0.2, 0.4, 0.6, 0.8]:
        d.line([(L, Y(v)), (W - R, Y(v))], fill=COL["grid"])
        d.text((L - 40, Y(v) - 6), f"{v:.1f}", fill=COL["text"])
    for r in bands:
        d.line([(X(r), T), (X(r), H - B)], fill=COL["grid"])
        d.text((X(r) - 22, H - B + 8), f"D/{r}", fill=COL["text"])
        lab = "body scale" if r <= 8 else f"lobe r~D/{r / 5:.0f}"
        d.text((X(r) - 34, H - B + 24), lab, fill=(120, 120, 120))
    ph = sp["photos"]

    def band(lo, hi, col):
        pts = [(X(r), Y(ph[str(r)][lo])) for r in bands] + [(X(r), Y(ph[str(r)][hi])) for r in bands[::-1]]
        d.polygon(pts, fill=col)
    band(0, 4, COL["photo_lt"])
    band(1, 3, (160, 190, 238))
    d.line([(X(r), Y(ph[str(r)][2])) for r in bands], fill=COL["photo"], width=3)
    for n, e in sp["per_render"].items():
        col = COL["gp7"] if n.endswith("gp7") else COL["ground"]
        pts = [(X(r), Y(e[str(r)])) for r in bands if e.get(str(r)) is not None]
        d.line(pts, fill=col, width=2)
        for p in pts:
            d.ellipse([p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3], fill=col)
    pk = sp["parkouring"]
    pts = [(X(r), Y(pk[str(r)])) for r in bands]
    for a, b in zip(pts[:-1], pts[1:]):
        for t in range(0, 10, 2):
            d.line([(a[0] + (b[0] - a[0]) * t / 10, a[1] + (b[1] - a[1]) * t / 10),
                    (a[0] + (b[0] - a[0]) * (t + 1) / 10, a[1] + (b[1] - a[1]) * (t + 1) / 10)], fill=COL["park"], width=2)
    d.text((L, 10), "Silhouette lobe spectrum E(r): outline displacement removed per octave of smoothing, "
           "in units of the scale (sigma = D/r, D = body thickness)", fill=COL["text"])
    d.text((L, H - 30), "coarse (body scale)  <-  sigma  ->  fine. Bodies thicker than 128 px; truncated bodies included "
           "with the cut excluded.", fill=COL["text"])
    lx, ly = W - R + 20, T + 10
    items = [(COL["photo_lt"], f"photos p10-p90 (n={ph['n']} bodies)"), ((160, 190, 238), "photos p25-p75"),
             (COL["photo"], "photos median"), (COL["ground"], "ours, ground view (3 styles)"),
             (COL["gp7"], "ours, gp7 view (3 styles)"), (COL["park"], "Parkouring, exact alpha (dashed)")]
    for i, (c, t) in enumerate(items):
        d.rectangle([lx, ly + i * 24, lx + 18, ly + i * 24 + 12], fill=c)
        d.text((lx + 26, ly + i * 24), t, fill=COL["text"])
    d.text((lx, ly + 170), "Renders: 1 body each\n(the deck is one connected\nsilhouette); 3 styles share\nthe same density, so 2\nindependent shapes.",
           fill=COL["text"])
    p = os.path.join(out, "lobe-spectrum.jpg")
    q = save_small(im, p)
    return p, q


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--summary", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    for p, q in (overlay_sheet(a.work, a.out), spectrum_plot(a.summary, a.out)):
        print(p, os.path.getsize(p), "bytes, quality", q)


if __name__ == "__main__":
    main()
