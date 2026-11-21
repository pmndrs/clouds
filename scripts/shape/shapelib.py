"""Shared numpy-only helpers for the P2-1 shape measures (no scipy/OpenCV).

Gaussian blur (FFT), connected components (run-length union-find), hole
filling, perimeter and outline-normal estimates.
"""
import numpy as np


# ---------------------------------------------------------------- blur
def gauss_kernel_ft(shape, sigma):
    """Fourier transfer function of a Gaussian of std `sigma` px for an rfft2 grid."""
    fy = np.fft.fftfreq(shape[0])[:, None]
    fx = np.fft.rfftfreq(shape[1])[None, :]
    return np.exp(-2.0 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))


def gauss(a, sigma, mode="reflect"):
    """Gaussian blur with padding of 3 sigma (reflect or edge or constant 0)."""
    if sigma <= 0:
        return a.astype(np.float64)
    p = int(np.ceil(3 * sigma)) + 1
    if mode == "zero":
        ap = np.pad(a.astype(np.float64), p, mode="constant")
    else:
        ap = np.pad(a.astype(np.float64), p, mode=mode)
    F = np.fft.rfft2(ap)
    out = np.fft.irfft2(F * gauss_kernel_ft(ap.shape, sigma), s=ap.shape)
    return out[p:-p, p:-p]


# ---------------------------------------------------------------- labels
def label(mask):
    """8-connected components. Returns (labels int32, n). 0 = background."""
    mask = np.asarray(mask, bool)
    H, W = mask.shape
    parent = [0]
    runs_prev = []  # (start, end_exclusive, id)
    run_rows = []
    for y in range(H):
        row = mask[y]
        d = np.diff(np.concatenate(([0], row.view(np.int8), [0])))
        starts = np.flatnonzero(d == 1)
        ends = np.flatnonzero(d == -1)
        runs = []
        j = 0
        np_ = len(runs_prev)
        for s, e in zip(starts.tolist(), ends.tolist()):
            rid = None
            # advance pointer over previous runs ending before s-1
            while j < np_ and runs_prev[j][1] < s:  # prev end_excl < s  -> no 8-overlap
                j += 1
            k = j
            while k < np_ and runs_prev[k][0] <= e:  # prev start <= e (8-conn)
                pid = runs_prev[k][2]
                # find root
                r = pid
                while parent[r] != r:
                    parent[r] = parent[parent[r]]
                    r = parent[r]
                if rid is None:
                    rid = r
                elif r != rid:
                    if r < rid:
                        parent[rid] = r
                        rid = r
                    else:
                        parent[r] = rid
                k += 1
            if rid is None:
                rid = len(parent)
                parent.append(rid)
            runs.append((s, e, rid))
        run_rows.append(runs)
        runs_prev = runs
    # flatten
    par = np.array(parent, dtype=np.int64)
    for _ in range(64):
        nxt = par[par]
        if np.array_equal(nxt, par):
            break
        par = nxt
    roots = np.unique(par[1:]) if len(par) > 1 else np.array([], np.int64)
    remap = np.zeros(len(par), np.int32)
    remap[roots] = np.arange(1, len(roots) + 1, dtype=np.int32)
    lab = np.zeros((H, W), np.int32)
    for y, runs in enumerate(run_rows):
        for s, e, rid in runs:
            lab[y, s:e] = remap[par[rid]]
    return lab, len(roots)


def remove_small(mask, min_area):
    lab, n = label(mask)
    if n == 0:
        return mask.copy()
    areas = np.bincount(lab.ravel(), minlength=n + 1)
    keep = areas >= min_area
    keep[0] = False
    return keep[lab]


def fill_holes(mask, max_hole_area=None):
    """Fill background components not touching the border (optionally only small ones)."""
    bg = ~mask
    lab, n = label(bg)
    if n == 0:
        return mask.copy()
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    areas = np.bincount(lab.ravel(), minlength=n + 1)
    fill = np.ones(n + 1, bool)
    fill[0] = False
    fill[border] = False
    if max_hole_area is not None:
        fill &= areas <= max_hole_area
    return mask | fill[lab]


# ---------------------------------------------------------------- outline
def boundary(mask):
    """Inner boundary pixels (4-neighbour test), zero-padded outside."""
    m = np.pad(mask, 1)
    inner = m[1:-1, 1:-1] & m[:-2, 1:-1] & m[2:, 1:-1] & m[1:-1, :-2] & m[1:-1, 2:]
    return mask & ~inner


def perimeter(mask, valid=None):
    """Crofton-style perimeter: 4-direction edge-crossing counts * pi/4 corrected.

    Counts transitions along horizontal, vertical and both diagonals and uses the
    Cauchy-Crofton formula P = pi/4 * (N0 + N90 + (N45 + N135)/sqrt2) / 2 * 2.
    If `valid` is given, only transitions where both pixels are valid count.
    """
    m = np.pad(mask.astype(np.int8), 1)
    v = None if valid is None else np.pad(valid, 1, constant_values=False)

    def cnt(a, b, va=None, vb=None):
        t = a != b
        if va is not None:
            t &= va & vb
        return int(t.sum())

    if v is None:
        n0 = cnt(m[:, 1:], m[:, :-1])
        n90 = cnt(m[1:, :], m[:-1, :])
        n45 = cnt(m[1:, 1:], m[:-1, :-1])
        n135 = cnt(m[1:, :-1], m[:-1, 1:])
    else:
        n0 = cnt(m[:, 1:], m[:, :-1], v[:, 1:], v[:, :-1])
        n90 = cnt(m[1:, :], m[:-1, :], v[1:, :], v[:-1, :])
        n45 = cnt(m[1:, 1:], m[:-1, :-1], v[1:, 1:], v[:-1, :-1])
        n135 = cnt(m[1:, :-1], m[:-1, 1:], v[1:, :-1], v[:-1, 1:])
    # Crofton with 4 directions, unit spacing (diagonals spacing 1/sqrt2)
    return np.pi / 4.0 * (n0 + n90 + (n45 + n135) / np.sqrt(2.0))


def outward_normal_y(mask_f, sigma=2.0):
    """y-component of outward unit normal (image y grows downward). >0 means facing down."""
    g = gauss(mask_f, sigma, mode="edge")
    gy = np.zeros_like(g)
    gx = np.zeros_like(g)
    gy[1:-1] = (g[2:] - g[:-2]) * 0.5
    gx[:, 1:-1] = (g[:, 2:] - g[:, :-2]) * 0.5
    n = np.hypot(gx, gy) + 1e-12
    return -gy / n  # mask decreases outward -> outward normal is -grad


def pct(a, q):
    a = np.asarray([x for x in a if x is not None and np.isfinite(x)], float)
    if len(a) == 0:
        return float("nan")
    return float(np.percentile(a, q))
