"""Pure numpy helpers for the VDB -> NVDF converter (no Houdini import, unit-testable with plain python).

Array convention ("texture order"): every field is a float32 array shaped (nz, ny, nx), i.e. C order
with x fastest, then y (map row), then z (slice / height). This is exactly the memory layout of
nvdf.bin / sdf.bin, so `arr.tobytes()` of the encoded volume is the file.
"""

from __future__ import annotations

import numpy as np

SDF_MIN = -256.0  # metres, maps to 0
SDF_MAX = 4096.0  # metres, maps to 65535
_INF = 1e12  # squared-metres "no feature" value; big enough to never win, small enough to keep float64 exact


# ---------------------------------------------------------------- distance transform

def _dt_lines(f: np.ndarray, h: float) -> np.ndarray:
    """Felzenszwalb-Huttenlocher squared-distance transform of many 1D lines at once.

    f: (L, n) squared distances (0 at features, _INF elsewhere); h: spacing. Vectorised over L: the
    sequential lower-envelope loop runs over n, each step handling all lines with masked pops.
    """
    L, n = f.shape
    f = f.astype(np.float64, copy=False)
    rows = np.arange(L)
    g = f + (np.arange(n, dtype=np.float64) * h) ** 2
    v = np.zeros((L, n), dtype=np.int64)
    z = np.empty((L, n + 1), dtype=np.float64)
    z[:, 0] = -np.inf
    z[:, 1] = np.inf
    k = np.zeros(L, dtype=np.int64)
    for q in range(1, n):
        while True:
            p = v[rows, k]
            s = (g[:, q] - g[rows, p]) / (2.0 * h * (q - p))
            pop = s <= z[rows, k]
            if not pop.any():
                break
            k = k - pop
        k = k + 1
        v[rows, k] = q
        z[rows, k] = s
        z[rows, k + 1] = np.inf
    out = np.empty((L, n), dtype=np.float64)
    k = np.zeros(L, dtype=np.int64)
    for q in range(n):
        qh = q * h
        while True:
            adv = z[rows, k + 1] < qh
            if not adv.any():
                break
            k = k + adv
        vk = v[rows, k]
        d = (q - vk) * h
        out[:, q] = d * d + f[rows, vk]
    return out


def squared_distance_to_mask(mask: np.ndarray, voxel: float, target: bool = True) -> np.ndarray:
    """Squared metres from each voxel centre to the nearest voxel whose mask == target."""
    g = np.where(mask.astype(bool) == target, 0.0, _INF)
    for axis in range(3):
        moved = np.moveaxis(g, axis, -1)
        shape = moved.shape
        res = _dt_lines(np.ascontiguousarray(moved).reshape(-1, shape[-1]), voxel).reshape(shape)
        g = np.moveaxis(res, -1, axis)
    return np.ascontiguousarray(g)


def signed_distance(mask: np.ndarray, voxel: float, max_dist: float = SDF_MAX) -> np.ndarray:
    """Signed distance in metres, negative inside (mask true).

    Same convention as scripts/nubis/edt.mjs: centre-to-centre distance to the nearest opposite-state
    voxel minus half a voxel (the surface lies between the two centres). No opposite voxel at all
    gives +/- max_dist.
    """
    mask = mask.astype(bool)
    half = 0.5 * voxel
    d_out = np.sqrt(squared_distance_to_mask(mask, voxel, True))   # to nearest inside voxel
    d_in = np.sqrt(squared_distance_to_mask(mask, voxel, False))   # to nearest outside voxel
    out = np.where(mask, -np.minimum(max_dist, np.maximum(0.0, d_in - half)), np.minimum(max_dist, np.maximum(0.0, d_out - half)))
    return out.astype(np.float32)


# ---------------------------------------------------------------- encoding

def encode_sdf_r16(sdf: np.ndarray) -> np.ndarray:
    """metres -> uint16 over [SDF_MIN, SDF_MAX], rounded DOWN (decoded value never overshoots)."""
    k = 65535.0 / (SDF_MAX - SDF_MIN)
    v = np.floor((sdf.astype(np.float64) - SDF_MIN) * k + 1e-6)
    return np.clip(v, 0, 65535).astype('<u2')


def decode_sdf_r16(u16: np.ndarray) -> np.ndarray:
    return (SDF_MIN + u16.astype(np.float64) / 65535.0 * (SDF_MAX - SDF_MIN)).astype(np.float32)


def quantize_unorm8(x: np.ndarray) -> np.ndarray:
    return np.clip(np.floor(x.astype(np.float64) * 255.0 + 0.5), 0, 255).astype(np.uint8)


def pack_rgba8(r: np.ndarray, g: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Three uint8 (nz,ny,nx) channels -> (nz,ny,nx,4) with alpha 0."""
    out = np.zeros(r.shape + (4,), dtype=np.uint8)
    out[..., 0], out[..., 1], out[..., 2] = r, g, b
    return out


# ---------------------------------------------------------------- crop

def occupied_bounds(profile_u8: np.ndarray, margin: int):
    """Bounds (x,y,z order) of profile > 0 grown by `margin`, clamped to the array. Inclusive max."""
    occ = profile_u8 > 0
    if not occ.any():
        raise ValueError('empty volume: no voxel has profile > 0')
    zs, ys, xs = (np.flatnonzero(occ.any(axis=tuple(a for a in range(3) if a != ax))) for ax in range(3))
    lo = [int(xs[0]), int(ys[0]), int(zs[0])]
    hi = [int(xs[-1]), int(ys[-1]), int(zs[-1])]
    dims_xyz = [profile_u8.shape[2], profile_u8.shape[1], profile_u8.shape[0]]
    cmin = [max(0, lo[i] - margin) for i in range(3)]
    cmax = [min(dims_xyz[i] - 1, hi[i] + margin) for i in range(3)]
    return {'occupiedMin': lo, 'occupiedMax': hi, 'cropMin': cmin, 'cropMax': cmax, 'cropDims': [cmax[i] - cmin[i] + 1 for i in range(3)]}


def crop(a: np.ndarray, cmin, cdims) -> np.ndarray:
    return np.ascontiguousarray(a[cmin[2]:cmin[2] + cdims[2], cmin[1]:cmin[1] + cdims[1], cmin[0]:cmin[0] + cdims[0]])


# ---------------------------------------------------------------- resampling / filtering

def resample_matrix(n_in: int, in_offset: int, in_size: float, out_range: tuple[int, int], out_size: float) -> np.ndarray:
    """(n_out, n_in) weights resampling voxel data of size `in_size` (indices in_offset..in_offset+n_in-1,
    on a lattice anchored at 0) onto a lattice of size `out_size` over global indices [out_range). Tent
    filter whose radius is max(1, ratio) source voxels, so downsampling area-averages and upsampling is
    linear. Rows are normalised."""
    j = np.arange(out_range[0], out_range[1])
    ratio = out_size / in_size
    centre = (j + 0.5) * ratio                      # target centre in source-voxel units
    src = (np.arange(n_in) + in_offset) + 0.5
    r = max(1.0, ratio)
    w = np.maximum(0.0, 1.0 - np.abs(centre[:, None] - src[None, :]) / r)
    s = w.sum(axis=1, keepdims=True)
    return (w / np.where(s > 0, s, 1.0)).astype(np.float32)


def apply_axis(a: np.ndarray, axis: int, w: np.ndarray) -> np.ndarray:
    moved = np.moveaxis(a, axis, -1)
    return np.moveaxis(moved @ w.T, -1, axis)


def gaussian_matrix(n: int, sigma: float) -> np.ndarray:
    idx = np.arange(n)
    w = np.exp(-0.5 * ((idx[:, None] - idx[None, :]) / sigma) ** 2)
    return (w / w.sum(axis=1, keepdims=True)).astype(np.float32)


def gaussian_blur(a: np.ndarray, sigma: float) -> np.ndarray:
    if sigma <= 0:
        return a
    for axis in range(3):
        a = apply_axis(a, axis, gaussian_matrix(a.shape[axis], sigma))
    return a.astype(np.float32)


# ---------------------------------------------------------------- Nubis-style field derivation

def profile_from_sdf(sdf_m: np.ndarray, mask: np.ndarray, depth_m: float, gamma: float) -> np.ndarray:
    """Dimensional profile: 0 outside; inside, saturate(-sdf / depth) ** gamma, rising from the surface to the core.

    Inside voxels are floored at 1/255 so profile > 0 stays exactly the occupancy mask after 8-bit quantisation.
    """
    p = np.power(np.clip(-sdf_m / depth_m, 0.0, 1.0), gamma)
    p = np.where(mask, np.maximum(p, 1.0 / 255.0), 0.0)
    return p.astype(np.float32)


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / max(e1 - e0, 1e-9), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def detail_from_height(mask: np.ndarray, bottom: float, top: float) -> np.ndarray:
    """Height heuristic: wispy (low value) at the cloud base rising to billowy (high value) at the top.

    Height fraction is measured over the occupied z-range of the whole cloud.
    """
    nz = mask.shape[0]
    zs = np.flatnonzero(mask.any(axis=(1, 2)))
    z0, z1 = (int(zs[0]), int(zs[-1])) if len(zs) else (0, nz - 1)
    frac = np.clip((np.arange(nz) - z0) / max(z1 - z0, 1), 0.0, 1.0)
    t = smoothstep(0.0, 1.0, frac)
    col = bottom + (top - bottom) * t
    return np.broadcast_to(col[:, None, None], mask.shape).astype(np.float32)


def scale_from_density(density: np.ndarray, ref: float | None) -> tuple[np.ndarray, float]:
    """Density scale = density / ref clamped to 0..1. ref defaults to the 99th percentile of positive density."""
    if ref is None:
        pos = density[density > 0]
        ref = float(np.percentile(pos, 99)) if pos.size else 1.0
    ref = max(ref, 1e-9)
    return np.clip(density / ref, 0.0, 1.0).astype(np.float32), ref


# ---------------------------------------------------------------- pack-fitted mapping (P4-B)
# Parameters fitted by scripts/vdb/fit_pack_mapping.py against assets/clouds/{parkouring,stormbird}
# (profile / detail type / density scale versus SDF depth and height fraction). See work/reports/P4-B.md.

PACK_FIT = {
    'profile': {'d0': 1.4, 'D': 66.0, 'g': 1.05, 'base': 0.1, 'baseH': 0.22, 'sigma': 0.64, 'corrVox': 3.0},
    'detail': {'lo': 0.1, 'hi': 0.75, 'depthShift': 0.25, 'depthRef': 32.0},
    'scale': {'s0': 0.04, 's1': 0.75, 'h1': 0.6},
}


def height_fraction(mask: np.ndarray) -> np.ndarray:
    """Per-slice height fraction 0..1 over the occupied z range of the cloud (axis 0 of texture order), broadcast to mask shape."""
    nz = mask.shape[0]
    zs = np.flatnonzero(mask.any(axis=(1, 2)))
    z0, z1 = (int(zs[0]), int(zs[-1])) if len(zs) else (0, nz - 1)
    col = np.clip((np.arange(nz) - z0) / max(z1 - z0, 1), 0.0, 1.0)
    return np.broadcast_to(col[:, None, None], mask.shape).astype(np.float32)


def smooth_noise(shape, corr_vox: float, seed: int = 1) -> np.ndarray:
    """Deterministic zero-mean unit-variance low-frequency noise (gaussian-blurred white noise)."""
    rng = np.random.default_rng(seed)
    n = gaussian_blur(rng.standard_normal(shape).astype(np.float32), corr_vox)
    n = n - n.mean()
    return (n / max(float(n.std()), 1e-9)).astype(np.float32)


def pack_profile(depth_m, hfrac, noise, prm=None):
    """Fitted Nubis profile: sat((d_eff - d0) / D)^g * baseLift(h). d_eff = depth * exp(sigma * noise) reproduces the
    pack's wide spread (p10..p90) at a given depth; the base lift thins the cloud floor like the pack's flat bases."""
    q = (prm or PACK_FIT)['profile']
    d_eff = np.maximum(depth_m, 0.0) * np.exp(q['sigma'] * noise)
    core = np.power(np.clip((d_eff - q['d0']) / q['D'], 0.0, 1.0), q['g'])
    lift = q['base'] + (1.0 - q['base']) * smoothstep(0.0, q['baseH'], hfrac)
    return (core * lift).astype(np.float32)


def pack_detail(depth_m, hfrac, prm=None):
    """Detail type: wispy at the cloud base, billowy at the top; deeper voxels read a little more wispy."""
    q = (prm or PACK_FIT)['detail']
    h = hfrac - q['depthShift'] * np.clip(depth_m / q['depthRef'], 0.0, 1.0)
    return smoothstep(q['lo'], q['hi'], h).astype(np.float32)


def pack_scale(hfrac, prm=None):
    """Density scale rising with height: thin sheets at the base, dense towers at the top."""
    q = (prm or PACK_FIT)['scale']
    return (q['s0'] + (q['s1'] - q['s0']) * smoothstep(0.0, q['h1'], hfrac)).astype(np.float32)
