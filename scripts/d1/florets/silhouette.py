"""Silhouette bumpiness (geometry only): mean depth (px) of the outline's bumps between two smoothing scales, per unit outline length.
mask = cloud vs sky (florets.cloud_mask, or a matte image's alpha > 0.5 with --matte). D(s1, s2) = |{M_s1 > .5} xor {M_s2 > .5}| / perimeter(M_s1).
With s1 = 3 (pixel noise / soft fringe removed) and s2 = 8, 16, 32: the outline relief at ~<20, <45, <90 px."""
import sys, os, importlib.util, numpy as np
from PIL import Image
spec = importlib.util.spec_from_file_location('fl', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'florets.py'))
fl = importlib.util.module_from_spec(spec); spec.loader.exec_module(fl)
box = [int(v) for v in sys.argv[1].split(',')]
for p in sys.argv[2:]:
    matte = '@matte' in p
    im = Image.open(p).convert('RGB').crop((box[0], box[1], box[0] + box[2], box[1] + box[3]))
    a = np.asarray(im).astype(np.float32) / 255
    M = (a.mean(-1) > 0.5).astype(float) if matte else fl.cloud_mask(a).astype(float)
    base = fl.gauss(M, 3) > 0.5
    per = (base ^ np.roll(base, 1, 0)).sum() + (base ^ np.roll(base, 1, 1)).sum()
    out = []
    for s2 in (8, 16, 32):
        sm = fl.gauss(M, s2) > 0.5
        out.append(((base ^ sm).sum() / max(per, 1)))
    print(f'{os.path.basename(p)[:60]:60} perim {per:6d}  bump depth <~20px {out[0]:.2f}  <~45px {out[1]:.2f}  <~90px {out[2]:.2f}')
