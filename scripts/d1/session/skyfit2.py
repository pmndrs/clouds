#!/usr/bin/env python3
# D1 round 11: a smooth sky ramp. Fits c(s) = top + (hor - top) exp(-(s - s0) / w) per channel (w shared) to the skyfit samples (sin el, linear rgb)
# and emits 8 stops with smooth easing, so neither the sky mesh nor the ambient integral has a kink.
import sys, json, numpy as np
S = '/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad'
AT = (-0.1, 0.02, 0.07, 0.13, 0.2, 0.3, 0.45, 0.8)   # D1 round 12: a stop below the horizon (the frames' band continues below it)
def fit(name, smin=0.0):
    sm = json.load(open(f'{S}/d1/skyfit-{name}.json'))
    xs = np.array([v[0] for v in sm]); cs = np.array([v[1] for v in sm]); keep = xs >= smin; xs, cs = xs[keep], cs[keep]
    best = None
    for w in np.linspace(0.03, 0.4, 75):
        e = np.exp(-xs / w); A = np.stack([np.ones_like(xs), e], 1)
        coef, res, *_ = np.linalg.lstsq(A, cs, rcond=None); err = float(((A @ coef - cs) ** 2).sum())
        if best is None or err < best[0]: best = (err, w, coef)
    err, w, coef = best
    lo = float(xs.min())   # no extrapolation below the lowest sky row the frame shows: hold the fit's value there
    def at(a):
        if a < 0: return list(cs[int(np.argmin(xs))]) if lo < 0 else [float(coef[0][i] + coef[1][i] * np.exp(-max(0.0, lo) / w)) for i in range(3)]   # below the horizon: the frame's lowest row, or the horizon value
        return [float(coef[0][i] + coef[1][i] * np.exp(-max(a, lo) / w)) for i in range(3)]
    stops = [(a, at(a)) for a in AT]
    return w, err, stops
if __name__ == '__main__':
    for name in sys.argv[1:]:
        w, err, stops = fit(name, 0.0)
        print(f'// {name}: w {w:.3f} rss {err:.2f}')
        print('  skyRamp: [' + ', '.join(f'{{ at: {a}, color: [{c[0]:.2f}, {c[1]:.2f}, {c[2]:.2f}] }}' for a, c in stops) + '],')
