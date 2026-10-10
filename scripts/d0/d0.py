#!/usr/bin/env python3
"""D0 Decima parity tools (numpy + Pillow only).

Reference frames are Guerrilla's deck/pack images (third party): they are read from the local artifacts folder and never
written into the repo. Outputs (masks, sheets, fits) go wherever --out points (normally artifacts/research/d0-parity/).

Subcommands
  mask   <image> --out <png>           sky-subtracted cloud mask of one image (debug view)
  fit    <ref> --cloud parkouring ...  camera search: silhouette of a splatted up-rez proxy vs the reference mask
  stats  <ref> <ours> [--json out]     parity numbers between a reference frame and our render of it
  sheet  <out> <ref> <ours> [...]       side-by-side sheet (pairs), mask outlines drawn

World convention = the runtime's (shaders/volume.wgsl.ts): texture (x, map row, up) -> world (x, z, y), and the flagship /
decima lab pages place the volume centred on x = z = 0 with its base at y = BASE (500 m).
"""
import argparse, json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BASE = 500.0
LUMA = np.array([0.2126, 0.7152, 0.0722])
MATTE_ALPHA = 0.2

# ---------------------------------------------------------------------------------------------------------------- images

def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0), 1 / 2.4) - 0.055)


def load_rgb(path, width=480):
    im = Image.open(path).convert('RGB')
    if width and im.width != width:
        im = im.resize((width, round(im.height * width / im.width)), Image.BOX)
    return np.asarray(im, dtype=np.float64) / 255.0


def _poly(x, y):
    return np.stack([np.ones_like(x), x, y, x * x, x * y, y * y, x * x * y, y ** 3, y ** 4], -1)


def cloud_mask(rgb, thresh=0.07):
    """Robust low-order sky fit (cubic in x, y per channel); the cloud is where the image departs from it.
    Returns (mask bool HxW, residual HxW, sky HxWx3). A near-black background (deck's black-backdrop renders) uses luminance."""
    h, w, _ = rgb.shape
    lum = rgb @ LUMA
    border = np.concatenate([lum[:3].ravel(), lum[-3:].ravel(), lum[:, :3].ravel(), lum[:, -3:].ravel()])
    if np.median(border) < 0.06:
        sky = np.zeros_like(rgb)
        res = lum
        return res > thresh, res, sky
    yy, xx = np.mgrid[0:h, 0:w]
    X = _poly(xx.ravel() / w - 0.5, yy.ravel() / h - 0.5)
    pix = rgb.reshape(-1, 3)
    keep = np.ones(len(pix), bool)
    for it in range(10):
        coef, *_ = np.linalg.lstsq(X[keep], pix[keep], rcond=None)
        r = np.abs(pix - X @ coef).max(1)
        cut = max(0.02, 3.0 * np.median(r[keep]))
        # exclude a dilated band around everything that departs from the fit, so the cloud's soft fringe cannot bend the sky model
        bad = (r >= cut).reshape(h, w)
        keep = ~box_blur(bad.astype(float), 4 if it > 1 else 1).ravel().astype(bool) if it < 9 else r < cut
        keep = keep & (r < cut)
    sky = (X @ coef).reshape(h, w, 3)
    res = np.abs(rgb - sky).max(2)
    m = res > thresh
    return m, res, sky


def largest_blobs(mask, min_frac=0.002):
    """Drop speckles: keep connected components larger than min_frac of the image (4-connectivity, iterative flood)."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    out = np.zeros_like(mask)
    n = 0
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]:
            continue
        n += 1
        stack = [(y0, x0)]; lab[y0, x0] = n; pts = []
        while stack:
            y, x = stack.pop(); pts.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n; stack.append((yy, xx))
        if len(pts) >= min_frac * h * w:
            p = np.array(pts); out[p[:, 0], p[:, 1]] = True
    return out


def border_flood(free):
    """Pixels of `free` connected to the image border (4-connectivity)."""
    h, w = free.shape
    seen = np.zeros_like(free)
    stack = [(y, x) for y in range(h) for x in (0, w - 1) if free[y, x]] + [(y, x) for x in range(w) for y in (0, h - 1) if free[y, x]]
    for y, x in stack:
        seen[y, x] = True
    while stack:
        y, x = stack.pop()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < h and 0 <= xx < w and free[yy, xx] and not seen[yy, xx]:
                seen[yy, xx] = True; stack.append((yy, xx))
    return seen


SHAPE_KEYS = ('look', 's.densityScale', 's.mipDistanceScale', 's.baseMip', 's.typeFromScale', 's.detailBias', 's.wispyBias', 'cam', 's.noiseInvert', 's.detailTypeOverride')


def find_matte(path):
    """The matte shot of a capture (p101@...@matte.jpg) whose shape-affecting variants (density, type, camera) equal this shot's."""
    d, b = os.path.split(path); stem, ext = os.path.splitext(b)
    if stem.endswith('@matte'):
        return None
    toks = stem.split('@'); name = toks[0]
    want = {t for t in toks[1:] if t.split(':')[0] in SHAPE_KEYS}
    try:
        files = os.listdir(d)
    except OSError:
        return None
    for f in files:
        s, e = os.path.splitext(f)
        if e != ext or not s.endswith('@matte'):
            continue
        t = s.split('@')
        if t[0] == name and {x for x in t[1:-1] if x.split(':')[0] in SHAPE_KEYS} == want:
            return os.path.join(d, f)
    return None


def ref_mask(path, width=480, thresh=0.07):
    """Cloud mask: sky residual above thresh, speckles and border-touching blobs dropped, enclosed holes filled."""
    rgb = load_rgb(path, width)
    m, res, sky = cloud_mask(rgb, thresh)
    matte = find_matte(path)
    if matte:
        # Our renders: the decima page's matte shot (opacity, sRGB-encoded) gives the exact silhouette. Opacity above MATTE_ALPHA is where a
        # reference's sky residual reaches the mask threshold (contrast about 0.35 between cloud and sky in the deck frames: 0.07 / 0.35).
        mt = load_rgb(matte, width)[..., 1]
        lin = np.where(mt <= 0.04045, mt / 12.92, ((mt + 0.055) / 1.055) ** 2.4)
        return rgb, lin > MATTE_ALPHA, res, sky
    m = largest_blobs(m)
    m &= ~border_flood(m)          # a component touching the frame edge is a sky-fit artefact (the clouds sit inside the frame)
    m |= ~border_flood(~m)         # fill holes: background not reachable from the border is inside the cloud
    return rgb, m, res, sky

# ---------------------------------------------------------------------------------------------------------------- volume

def load_volume(name):
    d = os.path.join(ROOT, 'assets', 'clouds', name)
    meta = json.load(open(os.path.join(d, 'cloud.json')))
    w, h, z = meta['dims']
    nv = np.fromfile(os.path.join(d, 'nvdf.bin'), np.uint8).reshape(z, h, w, 4).astype(np.float32) / 255.0
    return meta, nv


def load_noise(mip=2):
    d = os.path.join(ROOT, 'assets', 'clouds', 'noise')
    meta = json.load(open(os.path.join(d, 'noise.json')))
    m = meta['mips'][mip]
    n = m['dims'][0]
    raw = np.fromfile(os.path.join(d, 'noise.bin'), np.uint8, count=m['bytes'], offset=m['byteOffset'])
    return raw.reshape(n, n, n, 4).astype(np.float32) / 255.0   # [z][y][x][rgba]


def trilinear(vol, u):
    """vol [Z][Y][X][C] sampled at continuous texel coords u (N,3) = (x, y, z) with clamp; centres at i + 0.5."""
    Z, Y, X = vol.shape[:3]
    f = u - 0.5
    i0 = np.floor(f).astype(np.int64); t = f - i0
    out = 0
    for dz in (0, 1):
        for dy in (0, 1):
            for dx in (0, 1):
                ix = np.clip(i0[:, 0] + dx, 0, X - 1); iy = np.clip(i0[:, 1] + dy, 0, Y - 1); iz = np.clip(i0[:, 2] + dz, 0, Z - 1)
                wgt = (t[:, 0] if dx else 1 - t[:, 0]) * (t[:, 1] if dy else 1 - t[:, 1]) * (t[:, 2] if dz else 1 - t[:, 2])
                out = out + vol[iz, iy, ix] * wgt[:, None]
    return out


def proxy_points(name, step=4.0, extinction=0.3, base=BASE):
    """Up-rezzed Nubis density (VoxelCloudSampler.cg, far branch: no HHF, no near fade) at a `step` grid -> world points + sigma."""
    meta, nv = load_volume(name)
    w, h, zd = meta['dims']; v = meta['voxelSizeMeters']
    mn = np.array([-(w * v) / 2, base, -(h * v) / 2])   # world min (x, y, z)
    occ = nv[..., 0] > 0
    zz, yy, xx = np.nonzero(occ)
    lo = np.array([xx.min(), yy.min(), zz.min()]) * v - v; hi = (np.array([xx.max(), yy.max(), zz.max()]) + 1) * v + v
    gx = np.arange(lo[0], hi[0], step) + step / 2; gy = np.arange(lo[1], hi[1], step) + step / 2; gz = np.arange(lo[2], hi[2], step) + step / 2
    Tz, Ty, Tx = np.meshgrid(gz, gy, gx, indexing='ij')
    tex_m = np.stack([Tx.ravel(), Ty.ravel(), Tz.ravel()], 1)   # texture-space metres (x, row, up)
    mod = trilinear(nv, tex_m / v)
    P, T, S = mod[:, 0], mod[:, 1], mod[:, 2]
    keep = P > 0
    tex_m, P, T, S = tex_m[keep], P[keep], T[keep], S[keep]
    world = np.stack([mn[0] + tex_m[:, 0], mn[1] + tex_m[:, 2], mn[2] + tex_m[:, 1]], 1)
    noise = load_noise(2)
    nn = trilinear_wrap(noise, (world * 0.01) % 1.0 * noise.shape[0])
    wispy = nn[:, 0] + (nn[:, 1] - nn[:, 0]) * P
    billow = 0.3 * (nn[:, 2] + (nn[:, 3] - nn[:, 2]) * np.sqrt(np.sqrt(P)))
    comp = wispy + (billow - wispy) * T
    d = np.clip((P - comp) / np.maximum(1 - comp, 1e-6), 0, 1)
    ps = np.clip(S, 0, 1) ** 4
    d = d * ps
    d = np.where(d > 0, d ** (0.3 + 0.3 * np.maximum(1e-4, ps)), 0)
    keep = d > 0
    return world[keep], d[keep] * extinction, mn, meta


def trilinear_wrap(vol, u):
    n = vol.shape[0]
    f = u - 0.5
    i0 = np.floor(f).astype(np.int64); t = f - i0
    out = 0
    for dz in (0, 1):
        for dy in (0, 1):
            for dx in (0, 1):
                ix = (i0[:, 0] + dx) % n; iy = (i0[:, 1] + dy) % n; iz = (i0[:, 2] + dz) % n
                wgt = (t[:, 0] if dx else 1 - t[:, 0]) * (t[:, 1] if dy else 1 - t[:, 1]) * (t[:, 2] if dz else 1 - t[:, 2])
                out = out + vol[iz, iy, ix] * wgt[:, None]
    return out

# ---------------------------------------------------------------------------------------------------------------- camera

def look_basis(eye, target):
    f = np.asarray(target, float) - eye; f /= np.linalg.norm(f)
    r = np.cross(f, [0, 1, 0]); r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return f, r, u


def splat(world, sigma, eye, target, vfov_deg, W, H, step=4.0, mirror=False):
    """Optical depth image of the point cloud seen from eye toward target (perspective, y-up, no roll)."""
    f, r, u = look_basis(np.asarray(eye, float), target)
    q = world - eye
    z = q @ f
    ok = z > 1.0
    q, z, s = q[ok], z[ok], sigma[ok]
    th = math.tan(math.radians(vfov_deg) / 2); tw = th * W / H
    x = (q @ r) / z / tw; y = (q @ u) / z / th
    if mirror:
        x = -x
    px = ((x + 1) * 0.5 * W).astype(np.int64); py = ((1 - y) * 0.5 * H).astype(np.int64)
    inb = (px >= 0) & (px < W) & (py >= 0) & (py < H)
    pixel_m = 2 * z[inb] * th / H   # metres per pixel at that depth
    tau = np.bincount(py[inb] * W + px[inb], weights=s[inb] * step ** 3 / pixel_m ** 2, minlength=W * H).reshape(H, W)
    # points coarser than the pixels leave holes: blur by about one point footprint
    if not inb.any():
        return tau
    rad = max(1, int(round(step / float(np.median(pixel_m)))))
    return box_blur(tau, rad)


def box_blur(a, r):
    if r <= 0:
        return a
    k = 2 * r + 1
    p = np.pad(a, r, mode='edge')
    c = np.cumsum(np.cumsum(p, 0), 1)
    c = np.pad(c, ((1, 0), (1, 0)))
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def iou(a, b):
    u = (a | b).sum()
    return float((a & b).sum() / u) if u else 0.0


def fit_similarity(prox, ref):
    """Scale + translate the proxy mask onto the reference mask (moments, then a local search). Returns (iou, s, dx, dy, warped)."""
    H, W = ref.shape
    ys, xs = np.nonzero(ref); yp, xp = np.nonzero(prox)
    if len(yp) < 10:
        return 0.0, 1, 0, 0, prox
    s0 = math.sqrt(len(ys) / len(yp))
    cy, cx = ys.mean(), xs.mean(); py0, px0 = yp.mean(), xp.mean()
    best = (-1, 1, 0, 0, prox)
    for s in s0 * np.array([0.9, 0.95, 1.0, 1.05, 1.1]):
        for dy in (-3, 0, 3):
            for dx in (-3, 0, 3):
                X = (xp - px0) * s + cx + dx; Y = (yp - py0) * s + cy + dy
                img = Image.new('L', (W, H), 0)
                pts = np.stack([X, Y], 1)
                # rasterise by splatting each proxy pixel as an s x s square
                warped = np.zeros((H, W), bool)
                r = max(0, int(math.ceil(s / 2)))
                Xi = np.round(X).astype(int); Yi = np.round(Y).astype(int)
                for oy in range(-r, r + 1):
                    for ox in range(-r, r + 1):
                        xx = Xi + ox; yy = Yi + oy
                        ok = (xx >= 0) & (xx < W) & (yy >= 0) & (yy < H)
                        warped[yy[ok], xx[ok]] = True
                v = iou(warped, ref)
                if v > best[0]:
                    best = (v, s, (cx + dx) - px0 * s, (cy + dy) - py0 * s, warped)
    return best

# ---------------------------------------------------------------------------------------------------------------- commands

def cmd_mask(a):
    rgb, m, res, sky = ref_mask(a.image, a.width, a.thresh)
    vis = (rgb * 255).astype(np.uint8).copy()
    edge = m ^ np.roll(m, 1, 0) | m ^ np.roll(m, 1, 1)
    vis[edge] = [255, 0, 0]
    Image.fromarray(vis).save(a.out)
    print(json.dumps({'coverage': float(m.mean())}))


def cmd_fit(a):
    rgb, ref, _, _ = ref_mask(a.ref, a.width, a.thresh)
    H, W = ref.shape
    world, sigma, mn, meta = proxy_points(a.cloud, a.step, a.extinction)
    c = world.mean(0)   # density centroid
    lo, hi = world.min(0), world.max(0)
    radius = float(np.max(hi - lo) / 2)
    vfov = a.vfov
    results = []
    yaws = np.arange(0, 360, a.yaw_step)
    elevs = np.arange(a.elev_min, a.elev_max + 1e-6, a.elev_step)
    dists = [radius * k for k in a.dist]
    for mirror in ([False, True] if a.mirror else [False]):
        for D in dists:
            for el in elevs:
                for yw in yaws:
                    e = np.radians(el); y = np.radians(yw)
                    eye = c + D * np.array([math.sin(y) * math.cos(e), math.sin(e), math.cos(y) * math.cos(e)])
                    tau = splat(world, sigma, eye, c, vfov, W // 2, H // 2, a.step, mirror)
                    prox = (1 - np.exp(-tau)) > 0.5
                    prox = np.kron(prox, np.ones((2, 2), bool))[:H, :W]
                    v, s, dx, dy, _ = fit_similarity(prox, ref)
                    results.append((v, float(yw), float(el), float(D), mirror, s, dx, dy))
    results.sort(key=lambda r: -r[0])
    top = results[:a.top]
    # refine the best few on a finer grid
    refined = []
    for (v0, yw0, el0, D0, mir, *_r) in top[:3]:
        for yw in yw0 + np.arange(-a.yaw_step, a.yaw_step + 0.1, a.yaw_step / 3):
            for el in el0 + np.arange(-a.elev_step, a.elev_step + 0.1, a.elev_step / 2):
                e = np.radians(el); y = np.radians(yw)
                eye = c + D0 * np.array([math.sin(y) * math.cos(e), math.sin(e), math.cos(y) * math.cos(e)])
                tau = splat(world, sigma, eye, c, vfov, W, H, a.step, mir)
                prox = (1 - np.exp(-tau)) > 0.5
                v, s, dx, dy, warped = fit_similarity(prox, ref)
                refined.append((v, float(yw % 360), float(el), float(D0), mir, s, dx, dy, eye.tolist()))
    refined.sort(key=lambda r: -r[0])
    v, yw, el, D, mir, s, dx, dy, eye = refined[0]
    # Similarity -> camera: the proxy was rendered with vfov looking at c; scaling by s narrows the lens, and the shift moves c on screen.
    th = math.tan(math.radians(vfov) / 2) / s
    vfov_fit = math.degrees(2 * math.atan(th))
    # where c lands in the reference (pixel), proxy centre = (W/2, H/2)
    cxp, cyp = W / 2 * s + dx, H / 2 * s + dy
    ndc_x = (cxp / W) * 2 - 1; ndc_y = 1 - (cyp / H) * 2
    tw = th * W / H
    eye = np.array(eye)
    f, r, u = look_basis(eye, c)
    # desired: c appears at (ndc_x, ndc_y) -> forward = direction whose camera frame puts c there (small-angle yaw/pitch)
    ax = math.atan(ndc_x * tw); ay = math.atan(ndc_y * th)
    if mir:
        ax = -ax
    dir_c = (c - eye) / np.linalg.norm(c - eye)
    yaw_c = math.atan2(dir_c[0], -dir_c[2]); pitch_c = math.asin(dir_c[1])
    yaw_f = yaw_c - ax; pitch_f = pitch_c - ay
    fwd = np.array([math.sin(yaw_f) * math.cos(pitch_f), math.sin(pitch_f), -math.cos(yaw_f) * math.cos(pitch_f)])
    target = eye + fwd * np.linalg.norm(c - eye)
    rel = lambda p: ((np.asarray(p) - np.array([0, BASE, 0])) * np.array([-1 if mir else 1, 1, 1])).round(1).tolist()   # mirror: the x-flipped world
    out = {'ref': os.path.basename(a.ref), 'cloud': a.cloud, 'iou_proxy': round(v, 3), 'yawDeg': yw, 'elevDeg': el, 'distance': round(D, 1),
           'mirror': mir, 'vfovDeg': round(vfov_fit, 2), 'eyeRelBase': rel(eye), 'targetRelBase': rel(target), 'aspect': W / H,
           'top': [[round(t[0], 3), t[1], t[2], round(t[3]), t[4]] for t in results[:8]]}
    print(json.dumps(out))
    if a.json:
        json.dump(out, open(a.json, 'w'), indent=1)
    if a.vis:
        # re-render at the fitted camera to check the conversion
        tau = splat(world, sigma, eye, target, vfov_fit, W, H, a.step, mir)
        prox = (1 - np.exp(-tau)) > 0.5
        vis = (rgb * 255).astype(np.uint8).copy()
        e1 = ref ^ np.roll(ref, 1, 0) | ref ^ np.roll(ref, 1, 1)
        e2 = prox ^ np.roll(prox, 1, 0) | prox ^ np.roll(prox, 1, 1)
        vis[e1] = [255, 0, 0]; vis[e2] = [0, 255, 0]
        Image.fromarray(vis).save(a.vis)
        print('camera-iou', round(iou(prox, ref), 3))


def edge_sharpness(res, mask):
    """Mean residual gradient on the mask boundary over the cloud's contrast (90th percentile residual inside): how abruptly it meets the sky."""
    gy, gx = np.gradient(res)
    g = np.hypot(gx, gy)
    edge = mask & ~(np.roll(mask, 1, 0) & np.roll(mask, -1, 0) & np.roll(mask, 1, 1) & np.roll(mask, -1, 1))
    inner = np.percentile(res[mask], 90) if mask.any() else 1   # the cloud's contrast against the sky (its lit crust)
    return float(g[edge].mean() / max(inner, 1e-6)) if edge.any() else 0.0


def frame_stats(rgb, mask, res, sky):
    lum = rgb @ LUMA
    l = lum[mask]
    if not len(l):
        return {}
    lit = float(np.percentile(l, 90)); shade = float(np.percentile(l, 10)); med = float(np.median(l))
    dark = mask & (lum <= np.percentile(l, 20))
    sc = rgb[dark].mean(0)
    bright = mask & (lum >= np.percentile(l, 80))
    lc = rgb[bright].mean(0)
    skyl = float((sky @ LUMA)[~mask].mean()) if (~mask).any() and sky.any() else 0.0
    top = np.zeros_like(mask); top[: mask.shape[0] // 3] = True   # sky colour from the top third, off the cloud (the deck frames have no ground)
    skc = rgb[top & ~mask].mean(0) if (top & ~mask).any() else np.ones(3)
    return {'coverage': round(float(mask.mean()), 4), 'lit_p90': round(lit, 3), 'median': round(med, 3), 'shade_p10': round(shade, 3),
            'contrast': round(lit - shade, 3), 'shade_rgb': [round(float(x), 3) for x in sc], 'shade_BR': round(float(sc[2] / max(sc[0], 1e-6)), 3),
            'lit_rgb': [round(float(x), 3) for x in lc], 'lit_BR': round(float(lc[2] / max(lc[0], 1e-6)), 3), 'sky_mean': round(skyl, 3), 'sky_BR': round(float(skc[2] / max(skc[0], 1e-6)), 3),
            'cloud_sky': round(float(np.median(srgb_to_lin(rgb[mask]) @ LUMA) / max(float(srgb_to_lin(skc) @ LUMA), 1e-6)), 3),
            'edge': round(edge_sharpness(res, mask), 3)}


def cmd_stats(a):
    out = {}
    m = {}; L = {}
    for key, p in (('ref', a.ref), ('ours', a.ours)):
        rgb, mask, res, sky = ref_mask(p, a.width, a.thresh)
        out[key] = frame_stats(rgb, mask, res, sky)
        m[key] = mask; L[key] = box_blur(rgb @ LUMA, 2)
    out['iou'] = round(iou(m['ref'], m['ours']), 3)
    # Sky-balanced: our frame scaled per channel (in linear light) so its sky (top third, off the cloud) has the reference's colour and level.
    # What remains in the cloud after this is the cloud's own lighting, not the sky model, white balance or exposure.
    def sky_lin(rgb, mask):
        top = np.zeros_like(mask); top[: mask.shape[0] // 3] = True
        return srgb_to_lin(rgb[top & ~mask]).mean(0)
    rr, mr, _, _ = ref_mask(a.ref, a.width, a.thresh); ro, mo, reso, skyo = ref_mask(a.ours, a.width, a.thresh)
    gain = sky_lin(rr, mr) / np.maximum(sky_lin(ro, mo), 1e-6)
    bal = lin_to_srgb(np.clip(srgb_to_lin(ro) * gain, 0, 1))
    out['ours_skybal'] = frame_stats(bal, mo, reso, skyo)
    both = m['ref'] & m['ours']
    if both.sum() > 50:
        # shading-pattern agreement inside the shared silhouette (exposure-free): where the lit and shaded regions are
        x = L['ref'][both]; y = L['ours'][both]
        out['corr'] = round(float(np.corrcoef(x, y)[0, 1]), 3)
    print(json.dumps(out))
    if a.json:
        json.dump(out, open(a.json, 'w'), indent=1)


def cmd_sheet(a):
    pairs = list(zip(a.images[0::2], a.images[1::2]))
    W = a.width; tiles = []
    for ref, ours in pairs:
        row = []
        for p, col in ((ref, (255, 60, 60)), (ours, (60, 255, 60))):
            rgb, mask, res, sky = ref_mask(p, W, a.thresh)
            vis = Image.fromarray((rgb * 255).astype(np.uint8))
            if a.outline:
                other = ref_mask(ours if p == ref else ref, W, a.thresh)[1]
                arr = np.asarray(vis).copy()
                for mm, c in ((mask, col), (other, (255, 255, 0))):
                    if mm.shape != mask.shape:
                        continue
                    e = mm ^ np.roll(mm, 1, 0) | mm ^ np.roll(mm, 1, 1)
                    arr[e] = c
                vis = Image.fromarray(arr)
            d = ImageDraw.Draw(vis); d.rectangle([0, 0, W, 14], fill=(0, 0, 0)); d.text((3, 1), os.path.basename(p)[:70], fill=(255, 255, 0))
            row.append(vis)
        tiles.append(row)
    h = max(t[0].height for t in tiles)
    sheet = Image.new('RGB', (2 * W, h * len(tiles)), (30, 30, 30))
    for i, (l, r) in enumerate(tiles):
        sheet.paste(l, (0, i * h)); sheet.paste(r, (W, i * h))
    sheet.save(a.out, quality=88)


def main():
    p = argparse.ArgumentParser(); sub = p.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('mask'); s.add_argument('image'); s.add_argument('--out', required=True); s.add_argument('--width', type=int, default=480); s.add_argument('--thresh', type=float, default=0.07)
    s = sub.add_parser('fit'); s.add_argument('ref'); s.add_argument('--cloud', default='parkouring'); s.add_argument('--width', type=int, default=320)
    s.add_argument('--thresh', type=float, default=0.07); s.add_argument('--step', type=float, default=6.0); s.add_argument('--extinction', type=float, default=0.3)
    s.add_argument('--vfov', type=float, default=40.0); s.add_argument('--yaw-step', type=float, default=10.0); s.add_argument('--elev-min', type=float, default=-20)
    s.add_argument('--elev-max', type=float, default=30); s.add_argument('--elev-step', type=float, default=5); s.add_argument('--dist', type=float, nargs='+', default=[2.0, 4.0])
    s.add_argument('--mirror', action='store_true'); s.add_argument('--top', type=int, default=8); s.add_argument('--fine', action='store_true')
    s.add_argument('--json'); s.add_argument('--vis')
    s = sub.add_parser('stats'); s.add_argument('ref'); s.add_argument('ours'); s.add_argument('--width', type=int, default=480); s.add_argument('--thresh', type=float, default=0.07); s.add_argument('--json')
    s = sub.add_parser('sheet'); s.add_argument('out'); s.add_argument('images', nargs='+'); s.add_argument('--width', type=int, default=640); s.add_argument('--thresh', type=float, default=0.07); s.add_argument('--outline', action='store_true')
    a = p.parse_args()
    {'mask': cmd_mask, 'fit': cmd_fit, 'stats': cmd_stats, 'sheet': cmd_sheet}[a.cmd](a)


if __name__ == '__main__':
    main()
