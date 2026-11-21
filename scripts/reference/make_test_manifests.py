#!/usr/bin/env python3
"""Synthetic validation scenes for the reference-frame manifest (scripts/reference/README.md). Plain python3 + numpy.

  python3 scripts/reference/make_test_manifests.py [--out work/captures/P0-2b/tests]

Writes one directory per test: manifest.json, density.f32 (if any), sky.pfm (if any), and expect.json describing the closed-form
check that scripts/reference/validate.py applies to the Cycles render. Each test isolates one convention.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

import refio


def sun_dir(elev_deg, azim_deg):
    """Unit vector toward the sun; azimuth measured from +X toward +Z (our Y-up world)."""
    e, a = math.radians(elev_deg), math.radians(azim_deg)
    return [math.cos(e) * math.cos(a), math.sin(e), math.cos(e) * math.sin(a)]


def write(root, name, manifest, expect, grid=None, sky=None):
    d = root / name
    d.mkdir(parents=True, exist_ok=True)
    if grid is not None:
        refio.write_grid(d / "density.f32", grid)
    if sky is not None:
        refio.write_pfm(d / "sky.pfm", sky)
    (d / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (d / "expect.json").write_text(json.dumps(expect, indent=2) + "\n")
    return d


def grid_block(dims, origin, voxel, scale, dens):
    return {"file": "density.f32", "dims": list(dims), "order": "x-fastest", "voxel": voxel, "origin": list(origin), "extinctionScale": scale}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path("work/captures/P0-2b/tests"))
    a = ap.parse_args()
    root = a.out
    root.mkdir(parents=True, exist_ok=True)
    cam_small = {"width": 160, "height": 90}

    # 1. Furnace: dense sphere, albedo 1, uniform coloured sky, no sun. Every pixel = sky radiance.
    v, n = 2.0, 48
    c = (np.arange(n) + 0.5) * v - n * v / 2
    z, y, x = np.meshgrid(c, c, c, indexing="ij")
    sphere = (np.sqrt(x * x + y * y + z * z) < 40.0).astype(np.float32)
    L = [0.6, 0.8, 1.0]
    for g, tag in ((0.8, "hg08"), (0.0, "iso")):
        write(root, f"furnace-{tag}", {
            "grid": grid_block((n, n, n), (-n * v / 2,) * 3, v, 0.25, sphere),
            "medium": {"albedo": 1.0, "phase": {"type": "hg", "g": g}},
            "sun": None, "sky": {"uniform": L}, "ground": None,
            "camera": {"position": [0, 0, 150], "target": [0, 0, 0], "up": [0, 1, 0], "fovY": 40, **cam_small},
            "render": {"spp": 256, "maxBounces": 512, "seed": 0},
        }, {"kind": "furnace", "radiance": L, "note": "sphere r 40 m, sigma_t 0.25/m (optical radius 10)"}, grid=sphere)

    # 2. Absorber slab (albedo 0) in front of a uniform sky: exp(-tau) * L along the normal. Slab normal +Z, 10 m thick.
    v = 2.0
    dims = (64, 64, 9)
    slab = np.zeros(dims[::-1], np.float32)
    slab[2:7, 2:62, 2:62] = 1.0          # k 2..6: 5 voxels = 10 m of density 1 (trilinear keeps the integral)
    origin = (-64.0, -64.0, -9.0)
    L = [0.5, 1.0, 2.0]
    for alb, tag, sky in ((0.0, "absorber", L), (0.5, "absorber-a05", [0, 0, 0])):
        write(root, tag, {
            "grid": grid_block(dims, origin, v, 0.1, slab),
            "medium": {"albedo": alb, "phase": {"type": "hg", "g": 0.8}},
            "sun": None, "sky": {"uniform": sky}, "ground": None,
            "camera": {"position": [0, 0, 100], "target": [0, 0, 0], "up": [0, 1, 0], "fovY": 20, **cam_small},
            "render": {"spp": 1024, "maxBounces": 512, "seed": 0},
        }, {"kind": "absorber", "tauNormal": 1.0, "sky": sky, "albedo": alb}, grid=slab)

    # 3. Sun irradiance on a white-ish Lambertian ground, black sky, no medium: L = albedo * E * cos(zenith) / pi.
    E = [3.0, 2.0, 1.0]
    alb = [0.8, 0.5, 0.25]
    for elev in (30.0, 70.0):
        write(root, f"sun-e{int(elev)}", {
            "grid": None, "medium": None,
            "sun": {"direction": sun_dir(elev, 35.0), "irradiance": E, "angularRadius": 0.0},
            "sky": {"uniform": [0, 0, 0]}, "ground": {"y": 0.0, "albedo": alb},
            "camera": {"position": [0, 60, 80], "target": [0, 0, 0], "up": [0, 1, 0], "fovY": 30, **cam_small},
            "render": {"spp": 16, "maxBounces": 512, "seed": 0},
        }, {"kind": "sun", "irradiance": E, "albedo": alb, "elevationDeg": elev})

    # 4. Single scattering: horizontal slab, tau 0.05 normal, sun only, black sky, camera below looking up.
    v = 2.0
    dims = (152, 4, 152)
    slab = np.zeros(dims[::-1], np.float32)
    slab[1:-1, 1:3, 1:-1] = 1.0          # j 1..2: 4 m (trilinear profile from y0 + 1 m to y0 + 7 m, integral 4 m)
    origin = (-152.0, 50.0, -152.0)
    sig = 0.05 / 4.0
    E = [3.0, 2.0, 1.0]
    cases = [
        ("ss-hg08-fwd", {"type": "hg", "g": 0.8}, 1.0, sun_dir(60, 0), [0, 0, 0], [math.cos(math.radians(50)), math.sin(math.radians(50)), 0]),
        ("ss-iso-fwd", {"type": "hg", "g": 0.0}, 1.0, sun_dir(60, 0), [0, 0, 0], [math.cos(math.radians(50)), math.sin(math.radians(50)), 0]),
        ("ss-hg08-side", {"type": "hg", "g": 0.8}, 0.5, sun_dir(40, 180), [0, 0, 0], [math.cos(math.radians(50)), math.sin(math.radians(50)), 0]),
    ]
    look50 = [math.cos(math.radians(50)), math.sin(math.radians(50)), 0]
    one = [  # other phase functions, single scatter only, scattering angles about 15 to 35 degrees across the frame
        ("ss-mix-25", {"type": "mix", "lobes": [{"weight": 0.6, "type": "hg", "g": 0.2}, {"weight": 0.4, "type": "hg", "g": 0.85}]}, 1.0, sun_dir(75, 0), [0, 0, 0], look50),
        ("ss-draine-25", {"type": "draine", "g": 0.7, "alpha": 1.0}, 1.0, sun_dir(75, 0), [0, 0, 0], look50),
        ("ss-mie-25", {"type": "mie", "diameter": 20.0}, 1.0, sun_dir(75, 0), [0, 0, 0], look50),
    ]
    for name, phase, albedo, s, pos, look in cases + one:
        for mb in ((1, 512) if (name, phase, albedo, s, pos, look) in cases else (1,)):
            write(root, f"{name}-b{mb}", {
                "grid": grid_block(dims, origin, v, sig, slab),
                "medium": {"albedo": albedo, "phase": phase},
                "sun": {"direction": s, "irradiance": E, "angularRadius": 0.0},
                "sky": {"uniform": [0, 0, 0]}, "ground": None,
                "camera": {"position": pos, "target": [pos[i] + look[i] for i in range(3)], "up": [0, 1, 0], "fovY": 20, **cam_small},
                "render": {"spp": 256, "maxBounces": mb, "seed": 0},
            }, {"kind": "single", "sigmaT": sig, "albedo": albedo, "phase": phase, "irradiance": E, "slabY": [origin[1] + 2.0, origin[1] + 6.0],
                "maxBounces": mb}, grid=slab)

    # 5. Equirect orientation: black sky with coloured blobs at +X (red), +Z (green), +Y (blue), -Z (yellow, on the u seam) and
    #    a white blob at +X raised 20 degrees (tests which way v runs). No medium.
    W, H = 512, 256
    u = (np.arange(W) + 0.5) / W
    vv = (np.arange(H) + 0.5) / H
    dirs = refio.equirect_dir(u[None, :], vv[:, None])
    sky = np.zeros((H, W, 3), np.float32)
    blobs = [([1, 0, 0], [1, 0, 0]), ([0, 0, 1], [0, 1, 0]), ([0, 1, 0], [0, 0, 1]), ([0, 0, -1], [1, 1, 0]),
             ([math.cos(math.radians(20)), math.sin(math.radians(20)), 0], [1, 1, 1])]
    for d0, col in blobs:
        cosang = dirs @ np.array(d0, float)
        w = np.exp(-(np.arccos(np.clip(cosang, -1, 1)) / math.radians(4.0)) ** 2)
        sky += w[..., None].astype(np.float32) * np.array(col, np.float32)
    looks = {"px": ([1, 0, 0], [0, 1, 0]), "pz": ([0, 0, 1], [0, 1, 0]), "nz": ([0, 0, -1], [0, 1, 0]), "py": ([0, 1, 0], [0, 0, -1])}
    for tag, (fw, up) in looks.items():
        write(root, f"sky-{tag}", {
            "grid": None, "medium": None, "sun": None,
            "sky": {"file": "sky.pfm", "mapping": "equirect-rowtop+Y-u=atan2(x,-z)/2pi"}, "ground": None,
            "camera": {"position": [0, 0, 0], "target": fw, "up": up, "fovY": 60, **cam_small},
            "render": {"spp": 16, "maxBounces": 1, "seed": 0},
        }, {"kind": "skymap", "blobs": blobs}, sky=sky)

    # 6. Grid axis order and origin: an asymmetric absorber (corner block with arms along +X 10 voxels, +Y 6, +Z 4) in a non-cubic
    #    grid at an odd origin, seen from +Z, +X and +Y; compared per pixel with a numpy trilinear optical-depth render.
    v = 5.0
    dims = (14, 10, 8)
    gridL = np.zeros(dims[::-1], np.float32)
    gridL[1:3, 1:3, 1:12] = 1.0     # arm along +X (i 1..11)
    gridL[1:3, 1:8, 1:3] = 1.0      # arm along +Y (j 1..7)
    gridL[1:6, 1:3, 1:3] = 1.0      # arm along +Z (k 1..5)
    origin = (20.0, -10.0, -60.0)
    centre = [origin[i] + dims[i] * v / 2 for i in range(3)]
    views = {"fromz": ([0, 0, 1], [0, 1, 0]), "fromx": ([1, 0, 0], [0, 1, 0]), "fromy": ([0, 1, 0], [0, 0, -1])}
    for tag, (off, up) in views.items():
        write(root, f"axes-{tag}", {
            "grid": grid_block(dims, origin, v, 0.1, gridL),
            "medium": {"albedo": 0.0, "phase": {"type": "hg", "g": 0.0}},
            "sun": None, "sky": {"uniform": [1, 1, 1]}, "ground": None,
            "camera": {"position": [centre[i] + 250 * off[i] for i in range(3)], "target": centre, "up": up, "fovY": 25, "width": 192, "height": 144},
            "render": {"spp": 1024, "maxBounces": 512, "seed": 0},
        }, {"kind": "axes"}, grid=gridL)
    # 7. The real cloud (smoke grid from vdb_to_grid.py, if present) as a heterogeneous furnace and absorber.
    smoke = root.parent / "smoke"
    if (smoke / "density.f32").exists():
        sm = json.loads((smoke / "manifest.json").read_text())
        rel_grid = str(Path("..") / ".." / "smoke" / "density.f32")
        cam = dict(sm["camera"], width=160, height=90)
        for ext in (0.06, 0.2, 0.6):
            write(root, f"hetero-furnace-e{ext}", {
                "grid": dict(sm["grid"], file=rel_grid, extinctionScale=ext), "medium": {"albedo": 1.0, "phase": {"type": "hg", "g": 0.8}},
                "sun": None, "sky": {"uniform": [1, 1, 1]}, "ground": None, "camera": cam, "render": {"spp": 128, "maxBounces": 512, "seed": 0},
            }, {"kind": "furnace", "radiance": [1, 1, 1], "note": "EmberGen cloud_02, 4 m voxels"})
        write(root, "hetero-absorber-e0.1", {
            "grid": dict(sm["grid"], file=rel_grid, extinctionScale=0.1), "medium": {"albedo": 0.0, "phase": {"type": "hg", "g": 0.8}},
            "sun": None, "sky": {"uniform": [1, 1, 1]}, "ground": None, "camera": cam, "render": {"spp": 256, "maxBounces": 512, "seed": 0},
        }, {"kind": "hetero-absorber"})
    print(f"wrote tests under {root}")


if __name__ == "__main__":
    main()
