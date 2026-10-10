#!/usr/bin/env python3
"""D1 round 5: fit a display transform from our linear render to Guerrilla's frames (their tonemap + grading), numpy only.

The frames and our renders never line up pixel for pixel (the lobes differ), so the fit matches distributions inside the cloud masks:
  1. tone curve: the luminance quantiles (1..99) of our exposed linear render against the frame's display-linear quantiles, pooled over the
     frames (a shared fit) and per frame; the curve is y = c * x^a / (x^a + b) + d per channel (a: toe/contrast, b: shoulder position,
     c: white level, d: black lift), fitted by Nelder-Mead on the relative error;
  2. colour matrix: pixels of both populations are binned by luminance rank (deciles); the bin means of our exposed linear RGB against the
     curve-inverse of the frame's display-linear bin means give a 3x3 matrix by least squares (applied before the curve);
  3. one more pass of 1 with the matrix applied.
Also reports the same residuals for three's ACES filmic (what the page used) and writes the TS constants for POST_FIT (examples/lab/decima/bridge.ts).

  python3 scripts/d1/postfit.py --lin <dir of @post:none@exp:E captures> --lin-exposure E --mattes work/captures/D1 [--out fit.json]
The linear capture of bookmark B is <dir>/B@look:decima@post:none@exp:E.jpg, its matte <mattes>/<cloud>/B@look:decima@matte.jpg; the frame's
ACES exposure comes from refs.ts (REF_EXPOSURE below mirrors it).
"""
import argparse, json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import d1  # noqa: E402
d0 = d1.d0

ERODE = 0   # set by --erode
REF_EXPOSURE = {'p101': 0.17, 'p125': 0.135, 'p161': 0.19, 'p213': 0.2, 's206': 0.09, 's33t3': 0.09, 's33t6': 0.09, 's33t9': 0.09, 's214': 0.18}   # mirrors refs.ts (D1 round 11: refreshed)
Q = np.arange(1, 100)


def curve(x, p):
    a, b, c, d = p
    xa = np.power(np.maximum(x, 0), a)
    return c * xa / (xa + b) + d


def curve_inv(y, p):
    a, b, c, d = p
    yp = np.clip((y - d) / c, 1e-6, 1 - 1e-6)
    return np.power(b * yp / (1 - yp), 1 / a)


def aces(x):
    """three's ACESFilmicToneMapping (Stephen Hill's fit): RRT/ODT on the sRGB -> AP1 transformed colour, x already exposed (x 1/0.6 inside)."""
    m_in = np.array([[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]])
    m_out = np.array([[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]])
    v = (x / 0.6) @ m_in.T
    a = v * (v + 0.0245786) - 0.000090537
    b = v * (0.983729 * v + 0.4329510) + 0.238081
    return np.clip((a / b) @ m_out.T, 0, 1)


def nelder_mead(f, x0, steps, iters=4000, tol=1e-9):
    n = len(x0)
    pts = [np.array(x0, float)]
    for i in range(n):
        p = np.array(x0, float); p[i] += steps[i]; pts.append(p)
    vals = [f(p) for p in pts]
    for _ in range(iters):
        order = np.argsort(vals); pts = [pts[i] for i in order]; vals = [vals[i] for i in order]
        if abs(vals[-1] - vals[0]) < tol * (abs(vals[0]) + 1e-12): break
        cen = np.mean(pts[:-1], 0)
        xr = cen + (cen - pts[-1]); fr = f(xr)
        if fr < vals[0]:
            xe = cen + 2 * (cen - pts[-1]); fe = f(xe)
            if fe < fr: pts[-1], vals[-1] = xe, fe
            else: pts[-1], vals[-1] = xr, fr
        elif fr < vals[-2]:
            pts[-1], vals[-1] = xr, fr
        else:
            xc = cen + 0.5 * (pts[-1] - cen); fc = f(xc)
            if fc < vals[-1]: pts[-1], vals[-1] = xc, fc
            else:
                for i in range(1, n + 1):
                    pts[i] = pts[0] + 0.5 * (pts[i] - pts[0]); vals[i] = f(pts[i])
    i = int(np.argmin(vals))
    return pts[i], vals[i]


def load_frame(name, lin_dir, lin_exposure, matte_dir, width):
    ref = d1.ref_of(name)
    rr, mr, _, _ = d0.ref_mask(ref, width)
    ours = d0.load_rgb(os.path.join(lin_dir, f'{name}@look:decima@post:none@exp:{lin_exposure}.jpg'), width)
    E = d0.srgb_to_lin(ours) / float(lin_exposure) * REF_EXPOSURE[name]   # exposed linear (what the ACES path tone maps)
    cloud = 'parkouring' if name.startswith('p') else 'stormbird'
    mo = d1.matte_mask(os.path.join(matte_dir, cloud, f'{name}@look:decima@matte.jpg'), width)
    # D1 round 11 (--erode): both populations inside our matte eroded by N px (at `width`): the sky fit's mask of the frame leaks its haze band
    # and thin edges into the 'cloud' population and tinted the earlier fits; our matte's core is cloud in both images (IoU 0.85-0.92).
    inner_r = d1.erode(mo if ERODE else mr, ERODE or 3); inner_o = d1.erode(mo, ERODE or 3)
    sky_r = ~mr; sky_o = ~mo
    top = np.zeros_like(mr); top[: mr.shape[0] // 3] = True
    return {'name': name, 'E': E, 'R': d0.srgb_to_lin(rr), 'mask_o': inner_o, 'mask_r': inner_r, 'sky_o': sky_o & top, 'sky_r': sky_r & top, 'clip': float((ours >= 0.99).mean())}


def quantiles(rgb, mask):
    return np.percentile(rgb[mask] @ d0.LUMA, Q)


def bin_means(rgb, mask, bins=10):
    L = rgb[mask] @ d0.LUMA
    order = np.argsort(L); v = rgb[mask][order]
    return np.array([v[i * len(v) // bins:(i + 1) * len(v) // bins].mean(0) for i in range(bins)])


def fit_curve(pairs, p0=(1.0, 1.0, 1.0, 0.0)):
    """pairs: list of (x quantiles of ours, y quantiles of the frame, weight)."""
    def loss(p):
        if p[0] <= 0.2 or p[0] > 4 or p[1] <= 1e-3 or p[1] > 50 or p[2] <= 0.1 or p[2] > 50 or p[3] < -0.2 or p[3] > 0.3: return 1e9
        return sum(w * np.mean(((curve(x, p) - y) / (y + 0.05)) ** 2) for x, y, w in pairs)
    p, v = nelder_mead(loss, p0, [0.2, 0.3, 0.2, 0.03])
    p, v = nelder_mead(loss, p, [0.05, 0.1, 0.05, 0.01])
    return p, v


def residual(pairs, fn):
    return float(np.sqrt(sum(w * np.mean(((fn(x) - y) / (y + 0.05)) ** 2) for x, y, w in pairs) / sum(w for _, _, w in pairs)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lin', required=True); ap.add_argument('--lin-exposure', default='0.04'); ap.add_argument('--mattes', required=True)
    ap.add_argument('--frames', default='p101,p125,p161,p213,s206,s33t3,s33t6,s33t9,s214'); ap.add_argument('--width', type=int, default=960)
    ap.add_argument('--out'); ap.add_argument('--sky-weight', type=float, default=1.0); ap.add_argument('--ridge', type=float, default=0.05)
    ap.add_argument('--erode', type=int, default=0, help='D1 round 11: both populations inside our matte eroded by this many px (at --width); 0 = the sky-fit masks')
    a = ap.parse_args()
    global ERODE; ERODE = a.erode
    frames = [load_frame(n, a.lin, a.lin_exposure, a.mattes, a.width) for n in a.frames.split(',')]
    M = np.eye(3)
    report = {'frames': {}}
    # The sky (top third, off the cloud) anchors the toe of the curve, which the cloud quantiles alone leave free (weight a.sky_weight).
    def make_pairs(M):
        out = []
        for f in frames:
            Em = f['E'] @ M.T
            out.append((quantiles(Em, f['mask_o']), quantiles(f['R'], f['mask_r']), 1.0))
            if a.sky_weight > 0: out.append((quantiles(Em, f['sky_o']), quantiles(f['R'], f['sky_r']), a.sky_weight))
        return out
    for it in range(2):
        p, _ = fit_curve(make_pairs(M))
        # Colour matrix from the decile means (ours exposed linear vs the curve-inverse of the frame's display-linear means), ridge-regularised
        # toward the identity: the cloud is near grey, so the three channels are almost collinear and a free least squares is ill-conditioned.
        X = []; Y = []
        for f in frames:
            bo = bin_means(f['E'], f['mask_o']); br = bin_means(f['R'], f['mask_r'])
            X.append(bo); Y.append(curve_inv(br, p))
            if a.sky_weight > 0:
                X.append(bin_means(f['E'], f['sky_o'], 3)); Y.append(curve_inv(bin_means(f['R'], f['sky_r'], 3), p))
        X = np.concatenate(X); Y = np.concatenate(Y)
        lam = a.ridge * np.trace(X.T @ X) / 3
        M = np.linalg.solve(X.T @ X + lam * np.eye(3), X.T @ Y + lam * np.eye(3)).T
    pairs_id = [pr for pr in make_pairs(np.eye(3)) if pr[2] == 1.0]
    pairs_M = [pr for pr in make_pairs(M) if pr[2] == 1.0]
    report['curve'] = [round(float(v), 5) for v in p]
    report['matrix_rows'] = [[round(float(v), 5) for v in row] for row in M]
    aces_lum = lambda x: np.array([aces(np.full(3, v)) @ d0.LUMA for v in x])
    report['residual_aces'] = residual(pairs_id, aces_lum)
    report['residual_fit_shared'] = residual(pairs_M, lambda x: curve(x, p))
    sky_id = [(quantiles(f['E'], f['sky_o']), quantiles(f['R'], f['sky_r']), 1.0) for f in frames]
    sky_M = [(quantiles(f['E'] @ M.T, f['sky_o']), quantiles(f['R'], f['sky_r']), 1.0) for f in frames]
    report['sky_residual_aces'] = residual(sky_id, aces_lum); report['sky_residual_fit'] = residual(sky_M, lambda x: curve(x, p))
    for f, pr in zip(frames, pairs_M):
        pf, _ = fit_curve([pr], p)
        chroma_o = bin_means(f['E'] @ M.T, f['mask_o']); chroma_r = bin_means(f['R'], f['mask_r'])
        rep = {'clip': f['clip'], 'residual_aces': residual([pairs_id[frames.index(f)]], aces_lum),
               'residual_shared': residual([pr], lambda x: curve(x, p)), 'residual_own': residual([pr], lambda x: curve(x, pf)), 'curve_own': [round(float(v), 4) for v in pf],
               'sky_quantiles_ours_fit': [round(float(v), 3) for v in curve(np.percentile((f['E'] @ M.T)[f['sky_o']] @ d0.LUMA, [10, 50, 90]), p)],
               'sky_quantiles_ref': [round(float(v), 3) for v in np.percentile(f['R'][f['sky_r']] @ d0.LUMA, [10, 50, 90])],
               'deciles_ours_fit_rgb': [[round(float(v), 3) for v in curve(r, p)] for r in chroma_o[[1, 5, 8]]],
               'deciles_ref_rgb': [[round(float(v), 3) for v in r] for r in chroma_r[[1, 5, 8]]]}
        report['frames'][f['name']] = rep
    report['ts'] = 'curve: [%s], matrix: [%s]' % (', '.join(f'{v:.5f}' for v in p), ', '.join(f'{M[r][c]:.5f}' for c in range(3) for r in range(3)))   # column-major for three's mat3
    print(json.dumps(report, indent=1))
    if a.out: json.dump(report, open(a.out, 'w'), indent=1)


if __name__ == '__main__':
    main()
