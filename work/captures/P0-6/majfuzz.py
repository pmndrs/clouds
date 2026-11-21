"""Check the pathtracer's brickMajorants (ported 1:1 from packages/pathtracer/src/volume/volume.ts at ad9c01e) against the trilinear density
of a real grid: sample random index-space points in every non-empty brick (and points right at brick borders), and report the largest
ratio density / majorant. A ratio above 1 means an under-estimated majorant."""
import sys, json, numpy as np
d = sys.argv[1]
m = json.load(open(f'{d}/manifest.json'))
nx, ny, nz = m['grid']['dims']
g = np.fromfile(f'{d}/density.f32', dtype='<f4').reshape(nz, ny, nx)  # [k, j, i]
B = 8
dims = [(n + B) // B for n in (nx, ny, nz)]
# brickMajorants: cell c covers voxels [8c - 1, 8c + 7] (clamped)
pad = np.zeros((nz + 2 + 16, ny + 2 + 16, nx + 2 + 16), np.float32)
pad[1:nz + 1, 1:ny + 1, 1:nx + 1] = g        # pad[k + 1] = g[k]; index -1 -> pad 0
maj = np.zeros((dims[2], dims[1], dims[0]), np.float32)
for ck in range(dims[2]):
    sk = pad[ck * B: ck * B + B + 1]          # voxels 8c-1 .. 8c+7 -> pad 8c .. 8c+8
    for cj in range(dims[1]):
        sj = sk[:, cj * B: cj * B + B + 1]
        mx = sj.reshape(sj.shape[0] * sj.shape[1], -1)
        for ci in range(dims[0]):
            maj[ck, cj, ci] = mx[:, ci * B: ci * B + B + 1].max()
def tri(p):  # p: (N, 3) index space (i, j, k), centres at integers, zero outside
    p0 = np.floor(p).astype(np.int64); f = p - p0
    acc = np.zeros(len(p))
    for c in range(8):
        o = np.array([c & 1, (c >> 1) & 1, (c >> 2) & 1])
        ii = p0 + o
        ok = np.all((ii >= 0) & (ii < [nx, ny, nz]), axis=1)
        v = np.zeros(len(p)); v[ok] = g[ii[ok, 2], ii[ok, 1], ii[ok, 0]]
        w = np.prod(np.where(o == 1, f, 1 - f), axis=1)
        acc += v * w
    return acc
rng = np.random.default_rng(1)
N = 4_000_000
# random points in the support box [-1, n), plus points within 1e-3 of brick borders
p = rng.uniform([-1, -1, -1], [nx, ny, nz], size=(N, 3))
q = rng.uniform([-1, -1, -1], [nx, ny, nz], size=(N, 3)); ax = rng.integers(0, 3, N)
q[np.arange(N), ax] = (np.round((q[np.arange(N), ax] + 1) / B) * B - 1) + rng.uniform(-1e-3, 1e-3, N)
worst = 0
for pts in (p, q):
    pts = pts[np.all((pts >= -1) & (pts < [nx, ny, nz]), axis=1)]
    dens = tri(pts)
    cell = np.clip(np.floor((pts + 1) / B).astype(np.int64), 0, np.array(dims) - 1)
    mj = maj[cell[:, 2], cell[:, 1], cell[:, 0]]
    nz_ = dens > 0
    r = np.max(dens[nz_] / mj[nz_]); worst = max(worst, r)
    print(f'points {len(pts)}  nonzero {nz_.sum()}  max density/majorant {r:.6f}  violations {(dens > mj * (1 + 1e-6)).sum()}')
print('densityMax', float(g.max()), 'global majorant ok' if float(g.max()) >= tri(p).max() else 'GLOBAL VIOLATION', 'worst', worst)
