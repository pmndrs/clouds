import sys, json, numpy as np
sys.path.insert(0, '/Users/dex/Developer/WebGPUClouds/.claude/worktrees/agent-acfd6dc3f04e0532b/scripts/reference')
from refio import read_pfm
def stats(d, ref=None):
    L = read_pfm(f'{d}/pt-noon.pfm'); L = L.mean(axis=2) if L.ndim == 3 else L
    a = read_pfm(f'{d}/alpha-noon.pfm'); a = a[..., 0] if a.ndim == 3 else a
    out = {}
    for name, m in (('a>0.5', a > 0.5), ('a>0.995', a > 0.995), ('frame', np.ones_like(a, bool))):
        v = L[m]
        out[name] = (float(v.mean()), float(np.percentile(v, 1)), float(np.percentile(v, 99)), int(m.sum()))
    if ref is not None:  # absorber: compare with 1 - alpha
        T = 1 - a; m = a > 0.02
        out['absorber'] = (float(L[m].mean()), float(T[m].mean()), float((L[m] - T[m]).mean()), float(np.abs(L[m]-T[m]).mean()), int(m.sum()))
    return out
for d in sys.argv[1:]:
    ab = 'absorb' in d
    s = stats(d, ab)
    print(d.split('/')[-1], ' '.join(f"{k}: {v[0]:.4f} [{v[1]:.3f},{v[2]:.3f}] n={v[3]}" for k, v in s.items() if k != 'absorber'), ('ABS L %.4f T %.4f diff %.5f |diff| %.5f n=%d' % s['absorber']) if ab else '')
