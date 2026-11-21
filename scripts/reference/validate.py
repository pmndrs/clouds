#!/usr/bin/env python3
"""Runs the synthetic scenes from make_test_manifests.py through cycles_render.py and checks each against its closed form.

  python3 scripts/reference/validate.py [--tests work/captures/P0-2b/tests] [--only name,...] [--device CPU|GPU] [--no-render]

Prints a table (expected vs measured, relative error, noise) and writes <tests>/results.json and <tests>/results.md.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

import refio

BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
HERE = Path(__file__).resolve().parent


def render(d, device, extra=(), tag="out"):
    out = d / tag / "frame.exr"
    cmd = [BLENDER, "-b", "--factory-startup", "-P", str(HERE / "cycles_render.py"), "--", str(d / "manifest.json"), "--out", str(out), "--device", device, *extra]
    t0 = time.time()
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or "CYCLES_REF" not in r.stdout:
        sys.stderr.write(r.stdout[-3000:] + r.stderr[-3000:])
        raise RuntimeError(f"render failed: {d.name}")
    side = json.loads(out.with_suffix(".json").read_text())
    side["wall"] = time.time() - t0
    return out.with_suffix(".pfm"), side


def rel(meas, exp):
    meas, exp = np.asarray(meas, float), np.asarray(exp, float)
    return np.where(np.abs(exp) > 1e-12, meas / np.where(exp == 0, 1, exp) - 1, meas - exp)


def region_mean(img, mask=None):
    if mask is None:
        mask = np.ones(img.shape[:2], bool)
    v = img[mask]
    return v.mean(0), v.std(0) / math.sqrt(max(1, len(v)))


def hg(g, c):
    return (1 - g * g) / (4 * math.pi * np.power(1 + g * g - 2 * g * c, 1.5))


def draine(g, a, c):
    return hg(g, c) * (1 + a * c * c) / (1 + a * (1 + 2 * g * g) / 3)


def phase_eval(ph, c):
    """Phase function value (1/sr) at cos(theta) between the light's and the scattered ray's propagation directions."""
    t = ph.get("type", "hg")
    if t == "hg":
        return hg(ph.get("g", 0.0), c)
    if t == "draine":
        return draine(ph["g"], ph["alpha"], c)
    if t == "mix":
        tot = sum(l["weight"] for l in ph["lobes"])
        return sum(l["weight"] / tot * phase_eval(l, c) for l in ph["lobes"])
    if t == "mie":
        # Jendersie & d'Eon 2023 fit for water droplets, 5 um <= d <= 50 um (what Blender's MIE phase implements).
        d = ph["diameter"]
        g_hg = math.exp(-0.0990567 / (d - 1.67154))
        g_d = math.exp(-2.20679 / (d + 3.91029) - 0.428934)
        alpha = math.exp(3.62489 - 8.29288 / (d + 5.52825))
        w_d = math.exp(-0.599085 / (d - 0.641583) - 0.665888)
        return (1 - w_d) * hg(g_hg, c) + w_d * draine(g_d, alpha, c)
    raise ValueError(t)


def single_scatter_expected(m, e):
    """Closed form for a laterally infinite slab [y0, y1] of constant sigma_t, camera below, sun above, black sky."""
    cam = m["camera"]
    pos, dirs = refio.camera_rays(cam, ss=2)
    s = np.array(m["sun"]["direction"], float)
    s /= np.linalg.norm(s)
    E = np.array(e["irradiance"], float)
    st = e["sigmaT"]
    ss_ = st * e["albedo"]
    y0, y1 = e["slabY"]
    h = y1 - y0
    mv = dirs[..., 1]
    ms = s[1]
    a = st * (1 / mv - 1 / ms)
    # L = E p sigma_s / mu_v * exp(-sigma_t h / mu_s) * int_0^h exp(-a z) dz
    integ = np.where(np.abs(a) > 1e-9, (1 - np.exp(-a * h)) / np.where(np.abs(a) > 1e-9, a, 1), h)
    p = phase_eval(e["phase"], dirs @ s)
    L = (p * ss_ / mv * np.exp(-st * h / ms) * integ)[..., None] * E
    return L.mean(2)


def check(name, d, args):
    m = refio.load_manifest(d / "manifest.json")
    e = json.loads((d / "expect.json").read_text())
    kind = e["kind"]
    rows = []
    extra = []
    if kind == "single" and e["maxBounces"] > 1:
        extra.append("--passes")
    if kind == "absorber":
        extra.append("--alpha")
    pfm = d / "out" / "frame.pfm"
    side = json.loads((d / "out" / "frame.json").read_text()) if args.no_render else None
    if not args.no_render:
        pfm, side = render(d, args.device, extra)
    img = refio.read_pfm(pfm)
    secs = side.get("seconds", 0) + side.get("alphaSeconds", 0)

    def row(what, exp, meas, err, noise=None):
        exp, meas, err = np.atleast_1d(exp), np.atleast_1d(meas), np.atleast_1d(err)
        rows.append({"test": name, "check": what, "expected": [round(float(x), 5) for x in exp], "measured": [round(float(x), 5) for x in meas],
                     "maxRelErr": float(np.max(np.abs(err))), "noise": None if noise is None else float(np.max(noise)), "seconds": round(secs, 2)})

    if kind == "furnace":
        L = np.array(e["radiance"])
        mask_med = refio.optical_depth(m, *refio.camera_rays(m["camera"], 1))[..., 0] > 1.0
        mu, se = region_mean(img)
        row("all pixels", L, mu, rel(mu, L), se / L)
        mu, se = region_mean(img, mask_med)
        row(f"through medium ({mask_med.sum()} px)", L, mu, rel(mu, L), se / L)
    elif kind == "absorber":
        pos, dirs = refio.camera_rays(m["camera"], 3)
        tau = refio.optical_depth(m, pos, dirs)
        sky = np.array(e["sky"], float)
        exp_img = np.exp(-tau).mean(2)[..., None] * sky
        h, w = img.shape[:2]
        c = (slice(h // 2 - 3, h // 2 + 3), slice(w // 2 - 3, w // 2 + 3))
        if max(sky) > 0:
            exp_c = math.exp(-e["tauNormal"]) * sky
            mu, se = region_mean(img[c])
            row("centre 6x6 vs exp(-tau) L", exp_c, mu, rel(mu, exp_c), se / exp_c)
            err = img - exp_img
            row("whole image RMS / L (vs numpy trilinear march)", [0, 0, 0], np.sqrt((err ** 2).mean((0, 1))) / sky, np.sqrt((err ** 2).mean((0, 1))) / sky)
        else:
            row("combined (black sky, no sun) = 0", [0, 0, 0], img.mean((0, 1)), img.mean((0, 1)))
        al = refio.read_pfm(d / "out" / "frame.alpha.pfm")[..., 0]
        exp_a = 1 - np.exp(-tau).mean(2)
        mu, se = region_mean(al[c][..., None])
        ea = 1 - math.exp(-e["tauNormal"])
        row("alpha AOV centre vs 1 - exp(-tau)", ea, mu, rel(mu, ea), se / ea)
        row("alpha AOV whole image RMS", 0, np.sqrt(((al - exp_a) ** 2).mean()), np.sqrt(((al - exp_a) ** 2).mean()))
    elif kind == "sun":
        E, alb = np.array(e["irradiance"]), np.array(e["albedo"])
        cz = math.sin(math.radians(e["elevationDeg"]))
        L = alb * E * cz / math.pi
        mu, se = region_mean(img)
        row("ground radiance a E cos(z) / pi", L, mu, rel(mu, L), se / L)
    elif kind == "single":
        exp_img = single_scatter_expected(m, e)
        h, w = img.shape[:2]
        c = (slice(h // 4, 3 * h // 4), slice(w // 4, 3 * w // 4))
        ex, _ = region_mean(exp_img[c])
        mu, se = region_mean(img[c])
        lab = "combined" if e["maxBounces"] == 1 else "combined (all orders)"
        row(f"{lab}, central half", ex, mu, rel(mu, ex), se / ex)
        if e["maxBounces"] > 1:
            vd = refio.read_pfm(d / "out" / "frame.volume_direct.pfm")
            mu, se = region_mean(vd[c])
            row("Volume Direct pass, central half", ex, mu, rel(mu, ex), se / ex)
    elif kind == "skymap":
        sky = refio.read_pfm(d / "sky.pfm")
        pos, dirs = refio.camera_rays(m["camera"], 4)
        exp_img = refio.equirect_lookup(sky, dirs).mean(2)
        err = img - exp_img
        peak = max(float(exp_img.max()), 1e-6)
        row("RMS / peak (vs numpy bilinear lookup)", 0, np.sqrt((err ** 2).mean()) / peak, np.sqrt((err ** 2).mean()) / peak)
        # Centroid of each visible blob: expected (projection of its direction) vs measured (luma-weighted, per colour).
        cam = m["camera"]
        for d0, col in e["blobs"]:
            dd = np.array(d0, float)
            _, f, _, _ = refio.camera_basis(cam)
            if dd @ f < 0.75:
                continue
            x, y = refio.project(cam, refio.camera_basis(cam)[0] + dd)
            colv = np.array(col, float)
            # Isolate this blob: pixels whose colour is mostly this blob's colour in the reference.
            wgt = (exp_img @ colv) / (colv @ colv)
            other = np.linalg.norm(exp_img - wgt[..., None] * colv, axis=-1)
            sel = (wgt > 0.05) & (other < 0.2 * np.maximum(wgt, 1e-6))
            wm = np.where(sel, (img @ colv) / (colv @ colv), 0)
            yy, xx = np.mgrid[0:img.shape[0], 0:img.shape[1]] + 0.5
            if wm.sum() <= 0:
                row(f"blob {col} centroid px", [x, y], [float("nan")] * 2, [1e9])
                continue
            mx, my = (wm * xx).sum() / wm.sum(), (wm * yy).sum() / wm.sum()
            row(f"blob {col} centroid px (x, y)", [x, y], [mx, my], [(mx - x) / img.shape[1], (my - y) / img.shape[0]])
    elif kind == "axes":
        pos, dirs = refio.camera_rays(m["camera"], 3)
        tau = refio.optical_depth(m, pos, dirs)
        exp_img = np.exp(-tau).mean(2)
        meas = img.mean(-1)
        err = meas - exp_img
        row("RMS (vs numpy trilinear march)", 0, np.sqrt((err ** 2).mean()), np.sqrt((err ** 2).mean()))
        yy, xx = np.mgrid[0:img.shape[0], 0:img.shape[1]] + 0.5
        a_e, a_m = 1 - exp_img, 1 - meas
        ce = [(a_e * xx).sum() / a_e.sum(), (a_e * yy).sum() / a_e.sum()]
        cm = [(a_m * xx).sum() / a_m.sum(), (a_m * yy).sum() / a_m.sum()]
        row("absorbance centroid px (x, y)", ce, cm, [(cm[0] - ce[0]) / img.shape[1], (cm[1] - ce[1]) / img.shape[0]])
        # Mirror test: the same comparison against the grid flipped along each axis must be clearly worse.
        gm = m["grid"]
        dens = refio.read_grid(refio.resolve(m, gm["file"]), gm["dims"])
        worst = []
        for ax, lab in ((2, "x"), (1, "y"), (0, "z")):
            alt = np.flip(dens, ax).copy()
            tmp = d / f"_flip{lab}.f32"
            refio.write_grid(tmp, alt)
            m2 = dict(m); m2["grid"] = dict(gm, file=tmp.name)
            e2 = np.exp(-refio.optical_depth(m2, pos, dirs)).mean(2)
            tmp.unlink()
            worst.append((lab, float(np.sqrt(((meas - e2) ** 2).mean()))))
        rows.append({"test": name, "check": "RMS vs grid mirrored in " + ", ".join(f"{l}: {v:.4f}" for l, v in worst), "expected": [], "measured": [],
                     "maxRelErr": 0.0, "noise": None, "seconds": round(secs, 2)})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tests", type=Path, default=Path("work/captures/P0-2b/tests"))
    ap.add_argument("--only", default="")
    ap.add_argument("--device", default="CPU")
    ap.add_argument("--no-render", action="store_true")
    args = ap.parse_args()
    names = sorted(p.name for p in args.tests.iterdir() if (p / "manifest.json").exists())
    if args.only:
        keep = args.only.split(",")
        names = [n for n in names if any(n.startswith(k) for k in keep)]
    all_rows = []
    for n in names:
        rows = check(n, args.tests / n, args)
        for r in rows:
            print(f"{r['test']:22s} {r['check'][:58]:58s} exp {r['expected']}  meas {r['measured']}  err {r['maxRelErr']:.4f}" + (f"  noise {r['noise']:.4f}" if r["noise"] is not None else "") + f"  {r['seconds']}s")
        all_rows += rows
    suffix = ("" if args.device == "CPU" else "-" + args.device.lower()) + ("-subset" if args.only else "")
    if True:
        (args.tests / f"results{suffix}.json").write_text(json.dumps(all_rows, indent=1) + "\n")
        with open(args.tests / f"results{suffix}.md", "w") as f:
            f.write("| test | check | expected | measured | max rel err | noise (1 s.e.) | s |\n|---|---|---|---|---|---|---|\n")
            for r in all_rows:
                noise = "" if r["noise"] is None else f"{r['noise']:.4f}"
                f.write(f"| {r['test']} | {r['check']} | {r['expected']} | {r['measured']} | {r['maxRelErr']:.4f} | {noise} | {r['seconds']} |\n")


if __name__ == "__main__":
    main()
