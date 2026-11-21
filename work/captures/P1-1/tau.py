#!/usr/bin/env python3
"""P1.1 shadow optical depth check: the realtime march's sun optical depth (CloudSettings.lightProbe, read back as probe-<sun>-d<D>-m<0|1>.pfm)
against the true one, marched finely on the CPU through the path tracer's own grid (the manifest's density.f32, trilinear between voxel
centres, zero outside the box, quarter-voxel midpoint steps) from the same point toward the sun to the box exit.

  tau.py <cloud dir> <manifest dir> [--suns noon,low,...] [--per 120]

Mode 0 gives (tau, floor(t / 8), t - 8 floor(t / 8)) at the first lit sample whose view optical depth reaches D; mode 1 (in-line + micro part,
light-grid part, view optical depth there). The point is camera + t * (pixel-centre ray). Writes <cloud dir>/tau.json (every point) and prints
the table: realtime / true by bins of true tau, and the split of the error between the first 48 m (in-line taps) and the rest (grid).
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts' / 'gpu'))
import scorecard as sc  # noqa: E402

BINS = [(0, 1), (1, 3), (3, 10), (10, 30), (30, 1e9)]
INLINE_FAR = 48.0


def load_grid(mdir):
    m = json.loads((Path(mdir) / 'manifest.json').read_text())
    g = m['grid']
    nx, ny, nz = g['dims']
    dens = np.fromfile(Path(mdir) / g['file'], dtype='<f4').reshape(nz, ny, nx)   # [k, j, i], x fastest
    return m, dens, np.array(g['origin'], dtype=np.float64), float(g['voxel']), float(g['extinctionScale'])


def trilinear(dens, origin, voxel, p):
    """Density at world points p (N, 3): trilinear between voxel centres, zero outside (the PT's lookup)."""
    nz, ny, nx = dens.shape
    gx = (p - origin) / voxel - 0.5
    i0 = np.floor(gx).astype(np.int64)
    f = gx - i0
    out = np.zeros(len(p))
    for c in range(8):
        o = np.array([c & 1, (c >> 1) & 1, (c >> 2) & 1])
        ii = i0 + o
        ok = (ii[:, 0] >= 0) & (ii[:, 0] < nx) & (ii[:, 1] >= 0) & (ii[:, 1] < ny) & (ii[:, 2] >= 0) & (ii[:, 2] < nz)
        w = np.prod(np.where(o == 1, f, 1 - f), axis=1)
        v = np.zeros(len(p))
        v[ok] = dens[ii[ok, 2], ii[ok, 1], ii[ok, 0]]
        out += w * v
    return out


def box_exit(p, d, lo, hi):
    with np.errstate(divide='ignore', invalid='ignore'):
        t1 = np.where(d > 0, (hi - p) / d, np.where(d < 0, (lo - p) / d, np.inf))
    return np.maximum(t1.min(axis=1), 0.0)


def march(dens, origin, voxel, ext, p, d, t_end, t_start=None, chunk=4000):
    """Optical depth along rays p + s d, s in [t_start, t_end] (per ray), quarter-voxel midpoint rule."""
    dt = voxel * 0.25
    t_start = np.zeros(len(p)) if t_start is None else t_start
    out = np.zeros(len(p))
    for a in range(0, len(p), chunk):
        sl = slice(a, a + chunk)
        n = int(np.ceil((t_end[sl] - t_start[sl]).max() / dt)) if len(p[sl]) else 0
        acc = np.zeros(len(p[sl]))
        for k in range(n):
            s = t_start[sl] + (k + 0.5) * dt
            live = s < t_end[sl]
            if not live.any():
                break
            pts = p[sl][live] + d[sl][live] * s[live, None]
            seg = np.minimum(dt, t_end[sl][live] - (s[live] - 0.5 * dt))
            acc[live] += trilinear(dens, origin, voxel, pts) * seg
        out[sl] = acc * ext
    return out


def camera_rays(cam, fovy, w, h, xs, ys):
    pos, tgt = (np.array(cam[k], dtype=np.float64) for k in ('position', 'target'))
    up = np.array(cam.get('up', [0, 1, 0]), dtype=np.float64)
    f = tgt - pos; f /= np.linalg.norm(f)
    r = np.cross(f, up); r /= np.linalg.norm(r)
    u = np.cross(r, f)
    th = np.tan(np.radians(fovy) / 2)
    nx = (xs + 0.5) / w * 2 - 1
    ny = 1 - (ys + 0.5) / h * 2
    d = f[None] + r[None] * (nx * th * w / h)[:, None] + u[None] * (ny * th)[:, None]
    return pos, d / np.linalg.norm(d, axis=1, keepdims=True)


def main():
    cdir, mdir = Path(sys.argv[1]), Path(sys.argv[2])
    suns = ['noon', 'low', 'backlit', 'sunset']
    per = 120
    if '--suns' in sys.argv: suns = sys.argv[sys.argv.index('--suns') + 1].split(',')
    if '--per' in sys.argv: per = int(sys.argv[sys.argv.index('--per') + 1])
    m, dens, origin, voxel, ext = load_grid(mdir)
    # Direct-route clouds: the light grid's input is the NVDF R channel, max(1, round(255 x texel)) / 255 clamped to 1 wherever the texel is above
    # 1e-4 of the grid's max (vdb-direct.ts packDirectVolume). q8 is that field, on the same lattice, for the attribution column.
    direct = '--direct' in sys.argv
    q8 = None
    if direct:
        vmax = float(dens.max())
        q8 = np.where(dens > vmax * 1e-4, np.clip(np.round(dens * 255.0), 1, 255) / 255.0, 0.0).astype(np.float32)
    lo = origin; hi = origin + voxel * np.array(m['grid']['dims'][:3], dtype=np.float64)
    cap = json.loads((cdir / 'capture.json').read_text())
    reports = {s['name']: s.get('report') for s in cap['shots'] if s.get('report')}
    rng = np.random.default_rng(7)
    rows = []
    for sun in suns:
        rep = reports[f'nubis-{sun}']
        sd = np.array(rep['sun']['direction'], dtype=np.float64); sd /= np.linalg.norm(sd)
        if m['source']['view'].endswith(sun):
            sm = np.array(m['sun']['direction']); sd_check = float(np.degrees(np.arccos(min(1, abs(np.dot(sm / np.linalg.norm(sm), sd))))))
        else:
            sd_check = None
        w, h = rep['viewport']
        for D in [0.05, 0.3, 1, 3, 10]:
            try:
                a = sc.read_pfm(cdir / f'probe-{sun}-d{D}-m0.pfm').astype(np.float64)
                b = sc.read_pfm(cdir / f'probe-{sun}-d{D}-m1.pfm').astype(np.float64)
            except FileNotFoundError:
                continue
            t = a[..., 1] * 8 + a[..., 2]
            hit = (t > 0) & (b[..., 2] >= D * 0.999)
            ys, xs = np.nonzero(hit)
            if len(ys) == 0:
                continue
            pick = rng.choice(len(ys), size=min(per, len(ys)), replace=False)
            ys, xs = ys[pick], xs[pick]
            pos, dirs = camera_rays(rep['camera'], rep['fovY'], w, h, xs.astype(np.float64), ys.astype(np.float64))
            tt = t[ys, xs]
            pts = pos[None] + dirs * tt[:, None]
            sdir = np.repeat(sd[None], len(pts), axis=0)
            texit = box_exit(pts, sdir, lo, hi)
            tau_true = march(dens, origin, voxel, ext, pts, sdir, texit)
            tau_near = march(dens, origin, voxel, ext, pts, sdir, np.minimum(texit, INLINE_FAR))
            tau_q8_far = march(q8, origin, voxel, ext, pts, sdir, texit, np.minimum(texit, INLINE_FAR)) if q8 is not None else np.full(len(pts), np.nan)
            # the view optical depth from the camera to the point (checks the geometry against the probe's own count)
            od_view = march(dens, origin, voxel, ext, np.repeat(pos[None], len(pts), 0), dirs, tt)
            for k in range(len(pts)):
                rows.append({'sun': sun, 'D': D, 'x': int(xs[k]), 'y': int(ys[k]), 't': float(tt[k]), 'tauRt': float(a[ys[k], xs[k], 0]),
                             'tauRtInline': float(b[ys[k], xs[k], 0]), 'tauRtGrid': float(b[ys[k], xs[k], 1]), 'odRt': float(b[ys[k], xs[k], 2]),
                             'tauTrue': float(tau_true[k]), 'tauTrueNear': float(tau_near[k]), 'tauQ8Far': float(tau_q8_far[k]), 'odTrue': float(od_view[k]), 'sunCheckDeg': sd_check})
    (cdir / 'tau.json').write_text(json.dumps(rows))
    report(rows, cdir.name)


def report(rows, label):
    tr = np.array([r['tauTrue'] for r in rows]); rt = np.array([r['tauRt'] for r in rows])
    tn = np.array([r['tauTrueNear'] for r in rows]); ti = np.array([r['tauRtInline'] for r in rows]); tg = np.array([r['tauRtGrid'] for r in rows])
    odr = np.array([r['odRt'] for r in rows]); odt = np.array([r['odTrue'] for r in rows])
    print(f'{label}: {len(rows)} points; view OD at the point, probe / CPU: median {np.median(odr / np.maximum(odt, 1e-9)):.3f}, p10-p90 '
          f'{np.percentile(odr / np.maximum(odt, 1e-9), 10):.3f}-{np.percentile(odr / np.maximum(odt, 1e-9), 90):.3f}')
    q8f = np.array([r.get('tauQ8Far', np.nan) for r in rows])
    print('| true tau | n | rt/true median | p10-p90 | median rt - true | near 48 m: rt/true median | beyond: rt/true median | beyond: 8-bit field / true | beyond: rt grid / 8-bit field | tolerance (5 %) |')
    print('|---|---|---|---|---|---|---|---|---|---|')
    for a, b in BINS:
        s = (tr >= a) & (tr < b)
        if s.sum() < 3:
            print(f'| {a}-{b if b < 1e8 else "+"} | {int(s.sum())} | - | - | - | - | - | - | - | ±0.05 |'); continue
        q = rt[s] / np.maximum(tr[s], 1e-9)
        qn = ti[s] / np.maximum(tn[s], 1e-9)
        far_true = tr[s] - tn[s]
        qf = np.where(far_true > 1e-3, tg[s] / np.maximum(far_true, 1e-9), np.nan)
        qf_med = np.nanmedian(qf) if np.isfinite(qf).any() else float('nan')
        q8t = np.where(far_true > 1e-3, q8f[s] / np.maximum(far_true, 1e-9), np.nan)
        gq8 = np.where(q8f[s] > 1e-3, tg[s] / np.maximum(q8f[s], 1e-9), np.nan)
        med = lambda x: np.nanmedian(x) if np.isfinite(x).any() else float('nan')
        print(f'| {a}-{b if b < 1e8 else "+"} | {int(s.sum())} | {np.median(q):.3f} | {np.percentile(q, 10):.3f}-{np.percentile(q, 90):.3f} | '
              f'{np.median(rt[s] - tr[s]):+.3f} | {np.median(qn):.3f} | {qf_med:.3f} | {med(q8t):.3f} | {med(gq8):.3f} | ±0.05 abs (±{0.05 / max((a + min(b, 60)) / 2, 1e-3) * 100:.1f} % at mid) |')


if __name__ == '__main__':
    if sys.argv[1] == '--report':
        rows = json.loads(Path(sys.argv[2]).read_text()); report(rows, sys.argv[2])
    else:
        main()
