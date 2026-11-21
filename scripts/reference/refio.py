"""Shared helpers for the reference-frame manifest (scripts/reference/README.md).

Plain python3 + numpy. Imported by cycles_render.py (inside Blender's Python) and by the test/validation scripts.
Everything here follows the manifest conventions:
  - world: metres, right-handed, +Y up (three.js / the pathtracer's world);
  - grid: raw little-endian float32, x fastest then y then z (flat index i + nx*(j + ny*k)); voxel (i,j,k) has its centre at
    origin + (i + 0.5, j + 0.5, k + 0.5) * voxel; trilinear between voxel centres, zero outside the grid;
  - images in memory: numpy (H, W, C), row 0 = TOP. PFM files store the bottom row first (the PFM spec); the readers and
    writers here flip, so callers never see the file order;
  - equirect: row 0 = +Y, u = atan2(x, -z) / 2pi (u = 0 at -Z, 0.25 at +X), v = acos(y) / pi, texel (i, j) covers
    [i/W, (i+1)/W] x [j/H, (j+1)/H], bilinear between texel centres, u wraps, v clamps (Mitsuba's envmap, the pathtracer's map).
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path

import numpy as np


# ---------------------------------------------------------------- PFM

def write_pfm(path, img):
    """img: (H, W) or (H, W, 3) float, row 0 = top. Written little-endian (scale -1), bottom row first, per the PFM spec."""
    a = np.asarray(img, dtype=np.float32)
    if a.ndim == 3 and a.shape[2] == 1:
        a = a[:, :, 0]
    if a.ndim == 3 and a.shape[2] == 4:
        a = a[:, :, :3]
    color = a.ndim == 3
    h, w = a.shape[:2]
    with open(path, "wb") as f:
        f.write(b"PF\n" if color else b"Pf\n")
        f.write(f"{w} {h}\n".encode())
        f.write(b"-1.0\n")
        f.write(np.ascontiguousarray(a[::-1]).astype("<f4").tobytes())


def read_pfm(path):
    """Returns (H, W, 3) or (H, W) float32, row 0 = top."""
    with open(path, "rb") as f:
        kind = f.readline().strip()
        dims = f.readline().split()
        while len(dims) < 2:
            dims += f.readline().split()
        w, h = int(dims[0]), int(dims[1])
        scale = float(f.readline())
        data = f.read()
    c = 3 if kind == b"PF" else 1
    dt = "<f4" if scale < 0 else ">f4"
    a = np.frombuffer(data, dtype=dt, count=w * h * c).astype(np.float32)
    a = a.reshape(h, w, c) if c == 3 else a.reshape(h, w)
    return np.ascontiguousarray(a[::-1])


# ---------------------------------------------------------------- grid

def write_grid(path, density_zyx):
    """density_zyx: numpy array indexed [k, j, i] (shape (nz, ny, nx)); C order makes x fastest in the file."""
    np.ascontiguousarray(density_zyx, dtype="<f4").tofile(path)


def read_grid(path, dims):
    nx, ny, nz = dims
    a = np.fromfile(path, dtype="<f4")
    if a.size != nx * ny * nz:
        raise ValueError(f"{path}: {a.size} floats, dims {dims} need {nx * ny * nz}")
    return a.reshape(nz, ny, nx)


def load_manifest(path):
    path = Path(path)
    m = json.loads(path.read_text())
    m["_dir"] = str(path.parent.resolve())
    return m


def resolve(m, rel):
    p = Path(rel)
    return p if p.is_absolute() else Path(m["_dir"]) / p


# ---------------------------------------------------------------- camera

def camera_basis(cam):
    pos = np.array(cam["position"], float)
    f = np.array(cam["target"], float) - pos
    f /= np.linalg.norm(f)
    up = np.array(cam.get("up", [0, 1, 0]), float)
    r = np.cross(f, up)
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return pos, f, r, u


def camera_rays(cam, ss=1):
    """Ray directions (H, W, ss*ss, 3) for an ss x ss stratified sub-pixel grid (box filter); row 0 = top."""
    w, h = int(cam["width"]), int(cam["height"])
    pos, f, r, u = camera_basis(cam)
    th = math.tan(math.radians(cam["fovY"]) / 2)
    asp = w / h
    o = (np.arange(ss) + 0.5) / ss
    px = (np.arange(w)[:, None] + o[None, :]).reshape(-1)          # (w*ss)
    py = (np.arange(h)[:, None] + o[None, :]).reshape(-1)
    ndx = (px / w) * 2 - 1
    ndy = 1 - (py / h) * 2
    d = f[None, None, :] + r[None, None, :] * (ndx[None, :, None] * th * asp) + u[None, None, :] * (ndy[:, None, None] * th)
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    d = d.reshape(h, ss, w, ss, 3).transpose(0, 2, 1, 3, 4).reshape(h, w, ss * ss, 3)
    return pos, d


def project(cam, p):
    """World point -> (x, y) pixel coordinates (continuous, row 0 at the top edge)."""
    w, h = int(cam["width"]), int(cam["height"])
    pos, f, r, u = camera_basis(cam)
    d = np.asarray(p, float) - pos
    z = d @ f
    th = math.tan(math.radians(cam["fovY"]) / 2)
    ndx = (d @ r) / z / (th * w / h)
    ndy = (d @ u) / z / th
    return (ndx + 1) / 2 * w, (1 - ndy) / 2 * h


# ---------------------------------------------------------------- lookups (the pathtracer's conventions)

def equirect_uv(d):
    u = np.arctan2(d[..., 0], -d[..., 2]) / (2 * np.pi)
    u -= np.floor(u)
    v = np.arccos(np.clip(d[..., 1], -1, 1)) / np.pi
    return u, v


def equirect_dir(u, v):
    u, v = np.broadcast_arrays(np.asarray(u, float), np.asarray(v, float))
    phi, th = 2 * np.pi * u, np.pi * v
    return np.stack([np.sin(th) * np.sin(phi), np.cos(th), -np.sin(th) * np.cos(phi)], -1)


def equirect_lookup(img, d):
    """Bilinear between texel centres, u wraps, v clamps. img (H, W, 3) row 0 = +Y."""
    h, w = img.shape[:2]
    u, v = equirect_uv(d)
    x = u * w - 0.5
    y = np.clip(v * h - 0.5, 0, h - 1)
    x0 = np.floor(x).astype(int)
    y0 = np.clip(np.floor(y).astype(int), 0, h - 1)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    x0w, x1w = x0 % w, (x0 + 1) % w
    y1 = np.minimum(y0 + 1, h - 1)
    a = img[y0, x0w] * (1 - fx) + img[y0, x1w] * fx
    b = img[y1, x0w] * (1 - fx) + img[y1, x1w] * fx
    return a * (1 - fy) + b * fy


def grid_trilinear(dens_zyx, origin, voxel, p):
    """Trilinear density at world points p (..., 3): voxel centres at origin + (i + 0.5) * voxel, zero outside."""
    nz, ny, nx = dens_zyx.shape
    g = (p - np.asarray(origin, float)) / voxel - 0.5
    i0 = np.floor(g).astype(int)
    fr = g - i0
    acc = np.zeros(p.shape[:-1])
    for c in range(8):
        o = np.array([c & 1, (c >> 1) & 1, (c >> 2) & 1])
        ii = i0 + o
        inside = (ii[..., 0] >= 0) & (ii[..., 0] < nx) & (ii[..., 1] >= 0) & (ii[..., 1] < ny) & (ii[..., 2] >= 0) & (ii[..., 2] < nz)
        iic = np.clip(ii, 0, [nx - 1, ny - 1, nz - 1])
        v = np.where(inside, dens_zyx[iic[..., 2], iic[..., 1], iic[..., 0]], 0.0)
        wgt = np.prod(np.where(o == 1, fr, 1 - fr), axis=-1)
        acc += v * wgt
    return acc


def optical_depth(m, pos, dirs, step_frac=0.125):
    """Optical depth along rays (pos + t d) through the manifest's grid (trilinear, sigma_t = density * extinctionScale)."""
    gm = m["grid"]
    dens = read_grid(resolve(m, gm["file"]), gm["dims"])
    v = gm["voxel"]
    lo = np.asarray(gm["origin"], float) - 0.5 * v              # trilinear support extends half a voxel past the box
    hi = np.asarray(gm["origin"], float) + (np.asarray(gm["dims"], float) + 0.5) * v
    inv = 1.0 / np.where(np.abs(dirs) < 1e-12, 1e-12, dirs)
    t0 = (lo - pos) * inv
    t1 = (hi - pos) * inv
    tn = np.maximum(np.max(np.minimum(t0, t1), -1), 0)
    tf = np.min(np.maximum(t0, t1), -1)
    dt = v * step_frac
    tau = np.zeros(dirs.shape[:-1])
    n = int(np.ceil(np.max(np.where(tf > tn, tf - tn, 0)) / dt)) + 1
    for s in range(n):
        t = tn + (s + 0.5) * dt
        ok = t < tf
        if not ok.any():
            break
        p = pos + dirs * t[..., None]
        tau += np.where(ok, grid_trilinear(dens, gm["origin"], v, p), 0.0) * dt
    return tau * gm["extinctionScale"]


def tonemap_preview(img, exposure=1.0):
    """Simple preview only (Reinhard on luminance-free per-channel, then sRGB); not a look."""
    x = np.clip(img * exposure, 0, None)
    x = x / (1 + x)
    x = np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    return np.clip(x * 255 + 0.5, 0, 255).astype(np.uint8)
