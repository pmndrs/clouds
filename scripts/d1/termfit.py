#!/usr/bin/env python3
"""D1 round 6: the balance of the lighting terms against the deck frames, from the frames themselves (numpy only).

The decima page renders each Nubis term alone (`lightDebug` 1 direct, 2 ms, 3 diffuse sun, 4 ambient) in linear (`@post:none@exp:E`) with
the same camera, sun and settings. Each term's image scales linearly with its own strength (msStrength, diffuseSun, ambientStrength; the direct
term with the exposure), so the frame's display-linear luminance is modelled as sum_i w_i * term_i and the weights are solved by non-negative
least squares over the cloud mask at the lobe scale (both images box-blurred, so the lobes line up where the shapes do; the fit is weighted by
our matte opacity). The weights, relative to the current settings, say which term the frames want more or less of; the residual map says where.

  python3 scripts/d1/termfit.py --dir <captures> --exposure 0.04 --mattes work/captures/D1 --frames p101,p213 [--blur 6] [--width 960]
Capture names: <ref>@look:decima@post:none@exp:E@s.lightDebug:K.(png|jpg) for K in 1..4 and the full <ref>@look:decima@post:none@exp:E.
With --sun el:az the names carry @sun:el:az before @post.
"""
import argparse, glob, json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import d1  # noqa: E402
import postfit  # noqa: E402
d0 = d1.d0
TERMS = {1: 'direct', 2: 'ms', 3: 'diffuse', 4: 'ambient'}


def find(dirname, stem):
    for ext in ('png', 'jpg'):
        p = os.path.join(dirname, f'{stem}.{ext}')
        if os.path.exists(p): return p
    raise FileNotFoundError(stem)


def nnls(A, b, iters=5000):
    """Projected gradient NNLS (small problems)."""
    x = np.zeros(A.shape[1]); L = np.linalg.norm(A, 2) ** 2
    for _ in range(iters):
        g = A.T @ (A @ x - b)
        x = np.maximum(x - g / L, 0)
    return x


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', required=True); ap.add_argument('--exposure', default='0.04'); ap.add_argument('--mattes', required=True)
    ap.add_argument('--frames', default='p101,p213'); ap.add_argument('--blur', type=int, default=6); ap.add_argument('--width', type=int, default=960)
    ap.add_argument('--sun', default=''); ap.add_argument('--out')
    a = ap.parse_args()
    E = float(a.exposure); sun = f'@sun:{a.sun}' if a.sun else ''
    report = {}
    for name in a.frames.split(','):
        cloud = 'parkouring' if name.startswith('p') else 'stormbird'
        rr, mr, _, _ = d0.ref_mask(d1.ref_of(name), a.width)
        R = d0.srgb_to_lin(rr) @ d0.LUMA
        matte = d0.load_rgb(os.path.join(a.mattes, cloud, f'{name}@look:decima@matte.png'), a.width)[..., 1]
        opacity = d0.srgb_to_lin(matte)
        mo = opacity > d0.MATTE_ALPHA
        terms = {}
        for k, label in TERMS.items():
            img = d0.load_rgb(find(a.dir, f'{name}@look:decima{sun}@post:none@exp:{a.exposure}@s.lightDebug:{k}'), a.width)
            terms[label] = (d0.srgb_to_lin(img) @ d0.LUMA) / E * postfit.REF_EXPOSURE[name]
        full = d0.load_rgb(find(a.dir, f'{name}@look:decima{sun}@post:none@exp:{a.exposure}'), a.width)
        full = (d0.srgb_to_lin(full) @ d0.LUMA) / E * postfit.REF_EXPOSURE[name]
        both = d1.erode(mr & mo, 4)
        blur = lambda x: d0.box_blur(x, a.blur)
        w = blur(opacity.astype(float))
        A = np.stack([blur(terms[t])[both] * w[both] for t in TERMS.values()], 1)
        b = blur(R)[both] * w[both]
        x = nnls(A, b)
        pred = A @ x
        res_fit = float(np.sqrt(np.mean((pred - b) ** 2)) / np.mean(b))
        cur = np.stack([blur(terms[t])[both] * w[both] for t in TERMS.values()], 1).sum(1)
        res_cur = float(np.sqrt(np.mean((cur - b) ** 2)) / np.mean(b))
        # Per-term shares of the current render's luminance inside the mask, and the sum of terms against the full render (the aerial perspective)
        shares = {t: float(terms[t][both].mean()) for t in TERMS.values()}
        total = sum(shares.values())
        rep = {'weights': {t: round(float(v), 3) for t, v in zip(TERMS.values(), x)}, 'residual_current': round(res_cur, 4), 'residual_fit': round(res_fit, 4),
               'term_share_current': {t: round(v / max(total, 1e-9), 3) for t, v in shares.items()},
               'terms_sum_vs_full': round(float(total / max(full[both].mean(), 1e-9)), 3),
               'our_median': round(float(np.median(full[both])), 3), 'ref_median': round(float(np.median(R[both])), 3),
               'our_p10': round(float(np.percentile(full[both], 10)), 3), 'ref_p10': round(float(np.percentile(R[both], 10)), 3),
               'our_p90': round(float(np.percentile(full[both], 90)), 3), 'ref_p90': round(float(np.percentile(R[both], 90)), 3)}
        # where the fit still fails: the darkest decile of the frame vs ours (shade), the brightest (lit)
        dark = both & (R <= np.percentile(R[both], 20)); lit = both & (R >= np.percentile(R[both], 80))
        rep['shade_ours_over_ref'] = round(float(full[dark].mean() / R[dark].mean()), 3)
        rep['lit_ours_over_ref'] = round(float(full[lit].mean() / R[lit].mean()), 3)
        rep['shade_term_share'] = {t: round(float(terms[t][dark].mean() / max(full[dark].mean(), 1e-9)), 3) for t in TERMS.values()}
        report[name] = rep
    print(json.dumps(report, indent=1))
    if a.out: json.dump(report, open(a.out, 'w'), indent=1)


if __name__ == '__main__':
    main()
