#!/usr/bin/env python3
"""P0.3 scorecard: a realtime frame against a path-traced reference, in LINEAR scene radiance (before exposure and tone mapping).

Inputs are PFM frames written by `capture.mjs --linear` on the reference-pt page (radiance: RGB; masks: one channel). Regions come from
an alpha mask (the PT side's bake opacity, `alpha-<sun>.pfm`; the runtime's own `rtalpha-<sun>.pfm` is optional and only checked).
Luminance is Rec.709 (0.2126, 0.7152, 0.0722) of linear RGB. B/R is mean(B) / mean(R) over a region.

  one comparison:  scorecard.py --ref pt-noon.pfm --test nubis-noon.pfm --alpha alpha-noon.pfm [--test-alpha rtalpha-noon.pfm] --out s.json
  noise floor:     scorecard.py --noise --ref pt-noon.pfm --ref2 seed2/pt-noon.pfm --alpha alpha-noon.pfm --out n.json
  gate run:        scorecard.py --gate work/captures/P0-3b [--seed2 work/captures/P0-3b/seed2]   (all suns x nubis, octave; table + checks)
  self-checks:     scorecard.py --selftest

Measures (ratios are test / reference; B/R is reported for both and as test - reference):
  cloud     alpha > 0.5                         mean luminance
  thick     alpha > 0.995                       mean luminance
  fringe    0.05 < alpha < 0.6                  mean luminance, B/R
  base      bottom third of the cloud's rows    mean luminance, B/R
  dark20    reference's darkest 20 % of cloud   mean luminance, B/R
  band_*    detail energy at 4-16, 16-64, 64-256 px: RMS of a difference of Gaussians (sigma = wavelength / 4) of log-luminance, with
            normalised (masked) convolution over the thick body so pixels outside it never enter, read on the thick body eroded by 3 px.
            Log-luminance makes it exposure-independent (a frame times 2 has the same band energy). `band_lit_*`: the same on the lit half
            of the thick body (reference luminance above its median), the "lit faces" of PT1.
  sky       alpha < 0.001 (and test alpha < 0.001): per-channel mean ratio. Both sides see the same sky, so this is the units check.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float64)
BANDS = [(4, 16), (16, 64), (64, 256)]
SUNS = ['noon', 'low', 'backlit']
MODELS = ['nubis', 'octave']


# ---------------------------------------------------------------- io
def read_pfm(path):
    """PFM -> float32 array (h, w, 3) or (h, w), row 0 = top."""
    with open(path, 'rb') as f:
        tag = f.readline().strip()
        if tag not in (b'PF', b'Pf'):
            raise ValueError(f'{path}: not a PFM ({tag!r})')
        dims = f.readline().split()
        while len(dims) < 2:
            dims += f.readline().split()
        w, h = int(dims[0]), int(dims[1])
        scale = float(f.readline().strip())
        ch = 3 if tag == b'PF' else 1
        data = np.frombuffer(f.read(w * h * ch * 4), dtype='<f4' if scale < 0 else '>f4')
    img = data.reshape(h, w, ch) if ch == 3 else data.reshape(h, w)
    return np.ascontiguousarray(img[::-1]).astype(np.float32)


def write_pfm(path, img):
    img = np.asarray(img, dtype='<f4')
    ch = 3 if img.ndim == 3 else 1
    h, w = img.shape[:2]
    with open(path, 'wb') as f:
        f.write(f"{'PF' if ch == 3 else 'Pf'}\n{w} {h}\n-1.0\n".encode('ascii'))
        f.write(np.ascontiguousarray(img[::-1]).tobytes())


def as_mask(a):
    return a if a.ndim == 2 else a[..., 0]


# ---------------------------------------------------------------- image ops (numpy only: no scipy here)
def gauss_blur(img, sigma):
    """Separable Gaussian by FFT with zero padding (3 sigma), so normalised convolution can divide the padding out."""
    if sigma <= 0:
        return img.astype(np.float64)
    pad = int(np.ceil(3 * sigma))
    out = img.astype(np.float64)
    for axis in (0, 1):
        n = out.shape[axis]
        m = n + 2 * pad
        size = 1 << int(np.ceil(np.log2(m)))
        x = np.arange(size)
        x = np.minimum(x, size - x).astype(np.float64)
        k = np.exp(-0.5 * (x / sigma) ** 2)
        k /= k.sum()
        K = np.fft.rfft(k)
        shape = [1, 1]; shape[axis] = -1
        spec = np.fft.rfft(out, n=size, axis=axis)
        out = np.fft.irfft(spec * K.reshape(shape), n=size, axis=axis)
        out = np.take(out, np.arange(n), axis=axis)
    return out


def masked_blur(f, m, sigma):
    num = gauss_blur(f * m, sigma)
    den = gauss_blur(m.astype(np.float64), sigma)
    return num / np.maximum(den, 1e-9)


def erode(mask, r):
    """Binary erosion by a (2r+1)^2 square, via an integral image."""
    if r <= 0:
        return mask.copy()
    m = mask.astype(np.int64)
    p = np.pad(m, r + 1)
    s = p.cumsum(0).cumsum(1)
    n = 2 * r + 1
    h, w = mask.shape
    box = s[n:n + h, n:n + w] - s[:h, n:n + w] - s[n:n + h, :w] + s[:h, :w]
    return mask & (box == n * n)


def luminance(rgb):
    return rgb.astype(np.float64) @ LUMA


# ---------------------------------------------------------------- regions and measures
def regions(alpha, ref_lum, test_alpha=None):
    cloud = alpha > 0.5
    rows = np.arange(alpha.shape[0])[:, None]
    reg = {
        'cloud': cloud,
        'thick': alpha > 0.995,
        'fringe': (alpha > 0.05) & (alpha < 0.6),
    }
    if cloud.any():
        ys = np.nonzero(cloud)[0]
        cy0, cy1 = ys.min(), ys.max()
        reg['base'] = cloud & (rows > cy1 - (cy1 - cy0) / 3)
        lo = np.percentile(ref_lum[cloud], 20)
        reg['dark20'] = cloud & (ref_lum <= lo)
    else:
        reg['base'] = reg['dark20'] = cloud
    sky = alpha < 0.001
    if test_alpha is not None:
        sky &= test_alpha < 0.001
    reg['sky'] = sky
    thick_core = erode(reg['thick'], 3)
    reg['thick_core'] = thick_core
    if thick_core.any():
        med = np.median(ref_lum[thick_core])
        reg['thick_lit'] = thick_core & (ref_lum >= med)
    else:
        reg['thick_lit'] = thick_core
    return reg


def band_energies(lum, region_mask, eval_mask):
    """RMS of the DoG bands of log-luminance inside region_mask (normalised convolution), read on eval_mask."""
    out = {}
    if eval_mask.sum() < 50:
        return {f'{a}-{b}': None for a, b in BANDS}
    logl = np.log(np.maximum(lum, 1e-8))
    m = region_mask.astype(np.float64)
    cache = {}
    def g(s):
        if s not in cache:
            cache[s] = masked_blur(logl, m, s)
        return cache[s]
    for a, b in BANDS:
        d = g(a / 4) - g(b / 4)
        out[f'{a}-{b}'] = float(np.sqrt(np.mean(d[eval_mask] ** 2)))
    return out


def region_values(rgb, lum, mask):
    if mask.sum() < 50:
        return None
    mean = rgb[mask].astype(np.float64).mean(0)
    return {'pixels': int(mask.sum()), 'lum': float(lum[mask].mean()), 'rgb': [float(v) for v in mean], 'b_over_r': float(mean[2] / max(mean[0], 1e-12))}


def ratio(t, r):
    return None if t is None or r is None or r == 0 else t / r


def score(ref, test, alpha, test_alpha=None):
    """The scorecard of `test` against `ref` (both (h, w, 3) linear radiance) in the regions of `alpha`."""
    if ref.shape != test.shape:
        raise ValueError(f'ref {ref.shape} vs test {test.shape}')
    alpha = as_mask(alpha)
    if alpha.shape != ref.shape[:2]:
        raise ValueError(f'alpha {alpha.shape} vs frame {ref.shape[:2]}')
    test_alpha = None if test_alpha is None else as_mask(test_alpha)
    lr, lt = luminance(ref), luminance(test)
    reg = regions(alpha, lr, test_alpha)
    card = {'size': [int(ref.shape[1]), int(ref.shape[0])], 'measures': {}, 'regions': {k: int(v.sum()) for k, v in reg.items()}}
    M = card['measures']
    vals = {}
    for name in ['cloud', 'thick', 'fringe', 'base', 'dark20']:
        r, t = region_values(ref, lr, reg[name]), region_values(test, lt, reg[name])
        vals[name] = (r, t)
        M[f'{name}_lum'] = {'ref': r and r['lum'], 'test': t and t['lum'], 'ratio': ratio(t and t['lum'], r and r['lum'])}
        if name in ('fringe', 'base', 'dark20'):
            rb, tb = r and r['b_over_r'], t and t['b_over_r']
            M[f'{name}_br'] = {'ref': rb, 'test': tb, 'diff': None if rb is None or tb is None else tb - rb}
    for key, ev in [('band', reg['thick_core']), ('band_lit', reg['thick_lit'])]:
        er, et = band_energies(lr, reg['thick'], ev), band_energies(lt, reg['thick'], ev)
        for b in er:
            M[f'{key}_{b}'] = {'ref': er[b], 'test': et[b], 'ratio': ratio(et[b], er[b])}
    sky = reg['sky']
    if sky.sum() >= 50:
        sr, st = ref[sky].astype(np.float64).mean(0), test[sky].astype(np.float64).mean(0)
        M['sky_rgb'] = {'ref': sr.tolist(), 'test': st.tolist(), 'ratio': (st / np.maximum(sr, 1e-12)).tolist()}
        # per-pixel agreement too (a constant factor shows as ratio != 1 with a small spread)
        q = luminance(test[sky]) / np.maximum(luminance(ref[sky]), 1e-12)
        M['sky_lum_ratio_p5_p50_p95'] = [float(v) for v in np.percentile(q, [5, 50, 95])]
    if test_alpha is not None:
        both = (alpha > 0.02) | (test_alpha > 0.02)
        card['alpha_agreement'] = {'mean_abs_diff_over_cloud': float(np.abs(alpha - test_alpha)[both].mean()) if both.any() else None,
                                   'fringe_mean_ref': float(alpha[reg['fringe']].mean()) if reg['fringe'].any() else None,
                                   'fringe_mean_test': float(test_alpha[reg['fringe']].mean()) if reg['fringe'].any() else None}
    return card


def deviation(m):
    """How far one measure is from 'same': |ratio - 1| for ratios, |diff| for B/R differences."""
    if 'ratio' in m:
        r = m['ratio']
        if isinstance(r, list):
            return max(abs(v - 1) for v in r)
        return None if r is None else abs(r - 1)
    if 'diff' in m:
        return None if m['diff'] is None else abs(m['diff'])
    return None


def noise_floor(ref, ref2, alpha):
    card = score(ref, ref2, alpha)
    return {k: deviation(v) for k, v in card['measures'].items() if deviation(v) is not None}, card


# ---------------------------------------------------------------- reporting
COLS = [('cloud_lum', 'cloud L', 'ratio'), ('thick_lum', 'thick L', 'ratio'), ('fringe_lum', 'fringe L', 'ratio'), ('fringe_br', 'fringe B/R', 'br'),
        ('base_lum', 'base L', 'ratio'), ('base_br', 'base B/R', 'br'), ('dark20_lum', 'dark20 L', 'ratio'), ('dark20_br', 'dark20 B/R', 'br'),
        ('band_4-16', 'band 4-16', 'ratio'), ('band_16-64', '16-64', 'ratio'), ('band_64-256', '64-256', 'ratio'), ('band_lit_4-16', 'lit 4-16', 'ratio'),
        ('sky_rgb', 'sky R,G,B', 'rgb')]


def fmt(m, kind):
    if m is None:
        return '-'
    if kind == 'ratio':
        return '-' if m.get('ratio') is None else f"{m['ratio']:.2f}"
    if kind == 'br':
        return '-' if m.get('test') is None else f"{m['test']:.2f} / {m['ref']:.2f}"
    if kind == 'rgb':
        return ','.join(f'{v:.2f}' for v in m['ratio'])
    return str(m)


def table_header():
    return '| view | ' + ' | '.join(c[1] for c in COLS) + ' |\n|' + '---|' * (len(COLS) + 1)


def table_row(label, card):
    return f'| {label} | ' + ' | '.join(fmt(card['measures'].get(k), kind) for k, _, kind in COLS) + ' |'


def noise_row(label, noise):
    def f(k, kind):
        v = noise.get(k)
        return '-' if v is None else (f'±{v:.3f}' if kind != 'ratio' else f'±{v:.3f}')
    return f'| {label} | ' + ' | '.join(f(k, kind) for k, _, kind in COLS) + ' |'


# ---------------------------------------------------------------- gate run
def gate(d, seed2):
    d = Path(d)
    seed2 = Path(seed2) if seed2 else d / 'seed2'
    out = {'dir': str(d), 'comparisons': {}, 'noise': {}, 'checks': {}}
    lines = [table_header()]
    for sun in SUNS:
        need = [d / f'pt-{sun}.pfm', d / f'alpha-{sun}.pfm']
        if not all(p.exists() for p in need):
            print('skip', sun, [str(p) for p in need if not p.exists()])
            continue
        ref, alpha = read_pfm(need[0]), read_pfm(need[1])
        for model in MODELS:
            tp = d / f'{model}-{sun}.pfm'
            if not tp.exists():
                continue
            ta = d / f'rtalpha-{sun}.pfm'
            card = score(ref, read_pfm(tp), alpha, read_pfm(ta) if ta.exists() else None)
            out['comparisons'][f'{model}-{sun}'] = card
            lines.append(table_row(f'{model} {sun}', card))
        r2 = seed2 / f'pt-{sun}.pfm'
        if r2.exists():
            nf, card = noise_floor(ref, read_pfm(r2), alpha)
            out['noise'][sun] = nf
            out['noise_cards'] = out.get('noise_cards', {}); out['noise_cards'][sun] = card
    if out['noise']:
        lines.append('')
        lines.append('Noise floor (seed 1 vs seed 2 of the path trace: |ratio - 1|, or |B/R diff|):')
        lines.append('')
        lines.append(table_header())
        for sun, nf in out['noise'].items():
            lines.append(noise_row(f'PT seed noise {sun}', nf))
    out['checks'] = checks(out)
    lines.append('')
    for k, v in out['checks'].items():
        lines.append(f"- {'PASS' if v['pass'] else 'FAIL'} {k}: {v['detail']}")
    (d / 'scorecard.json').write_text(json.dumps(out, indent=1))
    (d / 'scorecard.md').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))
    print('wrote', d / 'scorecard.json', d / 'scorecard.md')
    return out


def checks(out):
    C, N = out['comparisons'], out['noise']
    def m(view, key, field):
        c = C.get(view)
        return None if c is None or key not in c['measures'] else c['measures'][key].get(field)
    def nz(sun, key):
        return (N.get(sun) or {}).get(key, 0.0)
    res = {}
    # (a1) lit-face fine detail: Nubis above the reference by more than 3x the seed noise, at the lit suns.
    det = []
    ok = True
    for sun in ['noon', 'low']:
        r = m(f'nubis-{sun}', 'band_lit_4-16', 'ratio')
        n = nz(sun, 'band_lit_4-16')
        det.append(f'nubis {sun} lit 4-16 x{r:.2f} (noise ±{n:.3f})' if r is not None else f'{sun} missing')
        ok &= r is not None and r - 1 > max(3 * n, 0.1)
    res['a1 lit-face fine band above reference (nubis)'] = {'pass': bool(ok), 'detail': '; '.join(det)}
    # (a2) backlit thick body darker than reference, octave more so.
    rn, ro = m('nubis-backlit', 'thick_lum', 'ratio'), m('octave-backlit', 'thick_lum', 'ratio')
    n = nz('backlit', 'thick_lum')
    ok = rn is not None and ro is not None and rn < 1 - 3 * n and ro < rn
    res['a2 backlit thick body darker, octave more so'] = {'pass': bool(ok), 'detail': f'nubis x{rn}, octave x{ro} (noise ±{n:.3f})' if rn is not None else 'missing'}
    # (a3) fringe B/R lower than reference (noon, low; both models).
    det, ok = [], True
    for sun in ['noon', 'low']:
        for model in MODELS:
            dv = m(f'{model}-{sun}', 'fringe_br', 'diff')
            n = nz(sun, 'fringe_br')
            det.append(f'{model} {sun} {dv:+.2f}' if dv is not None else f'{model} {sun} missing')
            ok &= dv is not None and dv < -3 * n
    res['a3 fringe B/R below reference'] = {'pass': bool(ok), 'detail': '; '.join(det)}
    # (a4) low sun shade B/R: Nubis too high, octave too low.
    dn, do = m('nubis-low', 'dark20_br', 'diff'), m('octave-low', 'dark20_br', 'diff')
    n = nz('low', 'dark20_br')
    ok = dn is not None and do is not None and dn > 3 * n and do < -3 * n
    res['a4 low-sun shade B/R: nubis high, octave low'] = {'pass': bool(ok), 'detail': f'nubis {dn:+.2f}, octave {do:+.2f} (noise ±{n:.3f})' if dn is not None and do is not None else 'missing'}
    # (b) the noise floor exists for every measure of every sun.
    keys = set(k for c in C.values() for k in c['measures'])
    have = all(sun in N and all(k in N[sun] for k in keys if not k.startswith('sky_lum')) for sun in SUNS)
    res['b noise floor for every measure'] = {'pass': bool(have), 'detail': f"suns with a noise floor: {sorted(N)}"}
    return res


# ---------------------------------------------------------------- self-checks
def selftest():
    rng = np.random.default_rng(7)
    h, w = 360, 640
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    # a blob cloud: alpha falls off from a centre ellipse; radiance with structure at large and medium scales.
    rr = np.sqrt(((xx - 320) / 220) ** 2 + ((yy - 180) / 130) ** 2)
    alpha = np.clip(1.6 - 1.6 * rr, 0, 1).astype(np.float32)
    alpha[alpha > 0.99] = 1.0
    base = 1.0 + 0.3 * np.sin(xx / 30) * np.cos(yy / 25) + 0.15 * np.sin(xx / 6.0 + yy / 7.0) + 0.2 * np.sin(xx / 90)
    sky = np.array([0.4, 0.6, 1.0])
    ref = (alpha[..., None] * base[..., None] * np.array([1.0, 0.95, 0.9]) + (1 - alpha[..., None]) * sky).astype(np.float32)
    ok = True

    def check(name, cond, info=''):
        nonlocal ok
        ok &= bool(cond)
        print(('ok   ' if cond else 'FAIL ') + name + (f'  {info}' if info else ''))

    c = score(ref, ref.copy(), alpha)
    ratios = [v['ratio'] for v in c['measures'].values() if 'ratio' in v and not isinstance(v['ratio'], list) and v['ratio'] is not None]
    diffs = [v['diff'] for v in c['measures'].values() if 'diff' in v and v['diff'] is not None]
    check('identical frames: every ratio is 1', all(abs(r - 1) < 1e-9 for r in ratios), f'{len(ratios)} ratios')
    check('identical frames: every B/R diff is 0', all(abs(d) < 1e-9 for d in diffs), f'{len(diffs)} diffs')

    c2 = score(ref, ref * 2, alpha)
    M = c2['measures']
    check('x2 frame: luminance ratios are 2', all(abs(M[k]['ratio'] - 2) < 1e-6 for k in ['cloud_lum', 'thick_lum', 'fringe_lum', 'base_lum', 'dark20_lum']))
    check('x2 frame: B/R unchanged', all(abs(M[k]['diff']) < 1e-6 for k in ['fringe_br', 'base_br', 'dark20_br']))
    bands = [M[f'band_{a}-{b}']['ratio'] for a, b in BANDS]
    check('x2 frame: band energy ratios are 1', all(abs(r - 1) < 1e-6 for r in bands), str([round(b, 6) for b in bands]))

    noisy = ref * (1 + 0.2 * rng.standard_normal((h, w, 1))).astype(np.float32)
    M = score(ref, noisy, alpha)['measures']
    bands = [M[f'band_{a}-{b}']['ratio'] for a, b in BANDS]
    check('pixel noise: fine band up by > 1.3x', bands[0] > 1.3, f'{bands[0]:.3f}')
    check('pixel noise: 16-64 and 64-256 within 5 %', abs(bands[1] - 1) < 0.05 and abs(bands[2] - 1) < 0.05, f'{bands[1]:.3f}, {bands[2]:.3f}')
    check('pixel noise: mean luminance within 1 %', abs(M['thick_lum']['ratio'] - 1) < 0.01, f"{M['thick_lum']['ratio']:.4f}")

    # a silhouette must not dominate the bands: a frame whose only change is outside the thick body leaves them unchanged.
    out = ref.copy(); out[alpha < 0.9] *= 3
    M = score(ref, out, alpha)['measures']
    bands = [M[f'band_{a}-{b}']['ratio'] for a, b in BANDS]
    check('change outside the thick body: bands unchanged', all(abs(r - 1) < 1e-6 for r in bands), str([round(b, 6) for b in bands]))

    # PFM round trip
    import tempfile, os
    with tempfile.TemporaryDirectory() as t:
        p = os.path.join(t, 'x.pfm'); write_pfm(p, ref); back = read_pfm(p)
        q = os.path.join(t, 'a.pfm'); write_pfm(q, alpha); aback = read_pfm(q)
    check('PFM round trip (RGB and one channel)', np.array_equal(back, ref) and np.array_equal(aback, alpha))

    # the noise-floor mode on two noisy realisations reports a floor for every measure
    a1 = ref * (1 + 0.03 * rng.standard_normal((h, w, 1))).astype(np.float32)
    a2 = ref * (1 + 0.03 * rng.standard_normal((h, w, 1))).astype(np.float32)
    nf, _ = noise_floor(a1, a2, alpha)
    check('noise floor: one value per measure, all small', len(nf) >= 15 and all(v < 0.2 for v in nf.values()), f'{len(nf)} measures, max {max(nf.values()):.3f}')
    print('selftest', 'PASSED' if ok else 'FAILED')
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--selftest', action='store_true')
    ap.add_argument('--gate', metavar='DIR')
    ap.add_argument('--seed2', metavar='DIR', help='gate: the second-seed path traces (default DIR/seed2)')
    ap.add_argument('--ref'); ap.add_argument('--test'); ap.add_argument('--alpha'); ap.add_argument('--test-alpha')
    ap.add_argument('--noise', action='store_true', help='noise-floor mode: --ref and --ref2 are two seeds of the same view')
    ap.add_argument('--ref2')
    ap.add_argument('--label', default=None)
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    if a.selftest:
        sys.exit(0 if selftest() else 1)
    if a.gate:
        gate(a.gate, a.seed2)
        return
    if not (a.ref and a.alpha and (a.test or (a.noise and a.ref2))):
        ap.error('need --ref, --alpha and --test (or --noise with --ref2)')
    ref, alpha = read_pfm(a.ref), read_pfm(a.alpha)
    if a.noise:
        nf, card = noise_floor(ref, read_pfm(a.ref2), alpha)
        res = {'noise_floor': nf, 'card': card}
        row = noise_row(a.label or 'noise', nf)
    else:
        card = score(ref, read_pfm(a.test), alpha, read_pfm(a.test_alpha) if a.test_alpha else None)
        res = card
        row = table_row(a.label or Path(a.test).stem, card)
    if a.out:
        Path(a.out).write_text(json.dumps(res, indent=1))
    print(table_header())
    print(row)


if __name__ == '__main__':
    main()
