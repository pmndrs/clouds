# P2.5f: the top outline's width, measured as in P2.5e: 100 columns across the central body (frame x 590..940), luminance from sky to the
# lit top, the 10-90 % rise in px (median), the max step per px (8-bit luminance, median), and the outer (10 %) row (median, frame y).
# Run from this directory: python3 measure.py A/gp7.png B/gp7.png ...
import sys
import numpy as np
from PIL import Image

def measure(path):
    a = np.asarray(Image.open(path).convert('RGB'), dtype=np.float32)
    L = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    widths, steps, outer = [], [], []
    for x in np.linspace(590, 940, 100).astype(int):
        col = L[200:420, x]
        peak = col.max(); ip = int(col.argmax())
        sky = np.median(col[:8])
        if peak - sky < 30: continue
        f = (col - sky) / (peak - sky)
        i50 = int(np.argmax(f >= 0.5))
        if i50 < 3 or i50 > ip: continue
        i10 = i50
        while i10 > 0 and f[i10] >= 0.1: i10 -= 1
        i90 = i50
        while i90 < ip and f[i90] < 0.9: i90 += 1
        widths.append(i90 - i10); outer.append(200 + i10)
        steps.append(np.diff(col[i10:i90 + 1]).max() if i90 > i10 else 0)
    return np.median(widths), np.median(steps), np.median(outer), len(widths)

if __name__ == '__main__':
    for p in sys.argv[1:]:
        w, s, o, n = measure(p)
        print(f'{p}: width {w:.1f} px, max step {s:.0f}/px, outer row y {o:.0f}, columns {n}')
