import sys, numpy as np
sys.path.insert(0, sys.argv[2])
import vdb_to_nvdf as v
grids = v.load_vdbs(sys.argv[1])
print('grids', list(grids))
for name, prim in grids.items():
    bb = prim.activeVoxelBoundingBox(); lo = [int(round(c)) for c in bb.minvec()]; hi = [int(round(c)) for c in bb.maxvec()]
    a = v.read_dense(prim, lo, hi)
    inside = a[a > 0]
    if inside.size == 0: print(name, 'no positive values'); continue
    q = np.round(inside * 255) / 255
    print(f'{name}: box {lo}..{hi} active>0 {inside.size} distinct {np.unique(inside).size} max|v-8bit| {np.abs(inside-q).max():.4f} mean {np.abs(inside-q).mean():.5f} range {inside.min():.4f}..{inside.max():.4f}')
