#!/usr/bin/env python3
"""D1 round 6: which sun direction best explains a deck frame's shading (not only the lobe-pattern correlation).

For every `<ref>@look:decima@sun:el:az` capture in a directory: inside the frame's cloud mask (our matte, resized), the luminance of the render
and of the frame are box-blurred (lobe scale) and compared by
  corr   Pearson correlation (the lobe pattern: where light and dark fall),
  litIoU IoU of the lit halves (pixels above each image's own median: the lit/shade map),
  shade  our shade p10 / median against the frame's (the depth of the shadow side),
and ranked by corr + litIoU. Prints the top rows and the current bookmark's row.

  python3 scripts/d1/sunsweep.py <dir> <ref> [--matte path] [--width 960] [--blur 6] [--top 12]
"""
import argparse, glob, os, re, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import d1  # noqa: E402
d0 = d1.d0


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('dir'); ap.add_argument('ref'); ap.add_argument('--matte'); ap.add_argument('--width', type=int, default=960)
    ap.add_argument('--blur', type=int, default=6); ap.add_argument('--top', type=int, default=12); ap.add_argument('--current', default='')
    a = ap.parse_args()
    rr, mr, _, _ = d0.ref_mask(d1.ref_of(a.ref), a.width)
    R = d0.box_blur(rr @ d0.LUMA, a.blur)
    mask = mr
    if a.matte: mask = mr & d1.matte_mask(a.matte, a.width)
    mask = d1.erode(mask, 3)
    rows = []
    for p in sorted(glob.glob(os.path.join(a.dir, f'{a.ref}@look:decima@sun:*'))):
        m = re.search(r'@sun:(-?\d+):(-?\d+)', p)
        if not m: continue
        el, az = int(m.group(1)), int(m.group(2))
        L = d0.box_blur(d0.load_rgb(p, a.width) @ d0.LUMA, a.blur)
        x, y = L[mask], R[mask]
        corr = float(np.corrcoef(x, y)[0, 1])
        lx, ly = x > np.median(x), y > np.median(y)
        iou = float((lx & ly).sum() / max((lx | ly).sum(), 1))
        shade = float(np.percentile(x, 10) / np.median(x)); shade_ref = float(np.percentile(y, 10) / np.median(y))
        rows.append((corr + iou, el, az, corr, iou, shade, shade_ref))
    rows.sort(key=lambda r: -r[0])
    print(f'{a.ref}: frame shade p10/median {rows[0][6]:.3f}; {len(rows)} suns')
    print(' score   el   az   corr  litIoU  shade')
    for r in rows[:a.top]: print(f' {r[0]:.3f}  {r[1]:3d}  {r[2]:3d}  {r[3]:.3f}  {r[4]:.3f}  {r[5]:.3f}')
    if a.current:
        el, az = [int(v) for v in a.current.split(':')]
        for r in rows:
            if r[1] == el and r[2] == az: print(f' current {el}:{az}: score {r[0]:.3f} corr {r[3]:.3f} litIoU {r[4]:.3f} shade {r[5]:.3f} (rank {rows.index(r) + 1})')


if __name__ == '__main__':
    main()
