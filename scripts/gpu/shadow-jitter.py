#!/usr/bin/env python3
"""Frame-to-frame change of a ground region across consecutive captures (scripts/gpu/step-frames.mjs), per run, against a reference run.

  python3 -I scripts/gpu/shadow-jitter.py work/captures/SH1/s1 old new ref [--skip 30] [--roi 0,0,1,1] [--ref ref]

Each run is a directory of f000.png ... Metrics over frames >= skip, on the luminance of the region of interest (fractions x0,y0,x1,y1):
  d1    mean |f[i+1] - f[i]|            how much the picture changes per frame (steady motion = steady d1)
  d1sd  std of d1 over the frames       how uneven the change is (steps = high)
  d2    mean |f[i+1] - 2 f[i] + f[i-1]| how much the change itself changes (jitter; a smooth slide is low)
  err   mean |f[i] - ref[i]|            distance to the reference run at the same frame (same wind offset)
"""
import sys, glob, os
import numpy as np
from PIL import Image

args = sys.argv[1:]
def opt(name, default):
    if name in args:
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return default
skip = int(opt('--skip', 30)); roi = [float(x) for x in opt('--roi', '0,0,1,1').split(',')]; refname = opt('--ref', 'ref')
root, runs = args[0], args[1:]

def load(name):
    files = sorted(glob.glob(os.path.join(root, name, 'f*.png')))
    out = []
    for f in files:
        im = np.asarray(Image.open(f).convert('L'), dtype=np.float64)
        h, w = im.shape
        out.append(im[int(roi[1] * h):int(roi[3] * h), int(roi[0] * w):int(roi[2] * w)])
    return np.stack(out)

data = {r: load(r)[skip:] for r in runs}
ref = data.get(refname)
print('%-8s %8s %8s %8s %8s %8s' % ('run', 'd1', 'd1sd', 'd2', 'd2/d1', 'err'))
for r in runs:
    a = data[r]
    d1 = np.abs(np.diff(a, axis=0)).mean(axis=(1, 2))
    d2 = np.abs(a[2:] - 2 * a[1:-1] + a[:-2]).mean(axis=(1, 2))
    err = float('nan') if ref is None or r == refname else np.abs(a - ref).mean()
    print('%-8s %8.4f %8.4f %8.4f %8.3f %8.4f' % (r, d1.mean(), d1.std(), d2.mean(), d2.mean() / max(d1.mean(), 1e-9), err))
