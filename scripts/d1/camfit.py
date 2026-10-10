#!/usr/bin/env python3
"""D1 round 6: refine a bookmark's camera against the frame's silhouette with the renderer itself (matte shots), numpy only.

D0 fitted the cameras on a splatted proxy of the profile at extinction 0.3; the decima look renders the same field at densityScale 2, so the
silhouette is fatter and the judges see 30-80 px offsets with extra skirts. This hill-climbs the page's `@cam:ex:ey:ez:tx:ty:tz:vfov` variant
(metres relative to the cloud base) on the IoU of the matte against the frame's mask: coordinate descent over eye position (3), target
position (3) and vfov, step halving per pass, one capture run per pass (every candidate in one run).

  python3 scripts/d1/camfit.py <ref> [--passes 3] [--step 40] [--vfov-step 2] [--out dir]
Prints the best camera per pass and the refs.ts line to paste. Reads refs.ts for the start camera.
"""
import argparse, json, os, re, subprocess, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import d1  # noqa: E402
d0 = d1.d0
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def read_ref(name):
    s = open(os.path.join(ROOT, 'examples/lab/decima/refs.ts')).read()
    m = re.search(rf"\n\s*{name}: \{{ cloud: '(\w+)'.*?eye: \[([^\]]*)\], target: \[([^\]]*)\], vfov: ([\d.]+)", s)
    cloud = m.group(1); eye = [float(v) for v in m.group(2).split(',')]; target = [float(v) for v in m.group(3).split(',')]; vfov = float(m.group(4))
    return cloud, eye, target, vfov


def cam_tag(eye, target, vfov):
    return '@cam:' + ':'.join(f'{v:.1f}' for v in eye + target) + f':{vfov:.2f}'


def capture(cloud, shots, out, width=960, height=540):
    cmd = ['node', 'scripts/gpu/capture.mjs', '--serve', '--page', 'decima/', '--query', f'cloud={cloud}&clean=1&look=decima', '--shots', ','.join(shots), '--size', f'{width}x{height}', '--settle', '60', '--out', out]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if 'OK ->' not in r.stdout: print(r.stdout[-2000:], r.stderr[-2000:]); raise SystemExit('capture failed')


def iou_of(path, ref_mask, width):
    return d0.iou(ref_mask, d1.matte_mask(path, width))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('ref'); ap.add_argument('--passes', type=int, default=3); ap.add_argument('--step', type=float, default=40)
    ap.add_argument('--vfov-step', type=float, default=2); ap.add_argument('--out', default='work/captures/scratch/d1/camfit'); ap.add_argument('--width', type=int, default=960)
    a = ap.parse_args()
    cloud, eye, target, vfov = read_ref(a.ref)
    _, mr, _, _ = d0.ref_mask(d1.ref_of(a.ref), a.width)
    step, vstep = a.step, a.vfov_step
    best = None
    for p in range(a.passes):
        cands = [(eye, target, vfov)]
        for i in range(3):
            for s in (-step, step):
                e = list(eye); e[i] += s; cands.append((e, target, vfov))
                t = list(target); t[i] += s; cands.append((eye, t, vfov))
        for s in (-vstep, vstep): cands.append((eye, target, vfov + s))
        out = os.path.join(a.out, a.ref, f'pass{p}')
        shots = [f'{a.ref}@matte{cam_tag(*c)}' for c in cands]
        capture(cloud, shots, out, a.width, round(a.width * 9 / 16))
        scored = []
        for c, s in zip(cands, shots):
            path = os.path.join(ROOT, out, s + '.jpg')
            scored.append((iou_of(path, mr, a.width), c))
        scored.sort(key=lambda r: -r[0])
        v, (eye, target, vfov) = scored[0]
        print(f'pass {p}: iou {v:.4f} (start {scored[[c for _, c in scored].index(cands[0])][0] if cands[0] in [c for _, c in scored] else float("nan"):.4f}) eye {np.round(eye, 1).tolist()} target {np.round(target, 1).tolist()} vfov {vfov:.2f}')
        best = (v, eye, target, vfov)
        step /= 2; vstep /= 2
    v, eye, target, vfov = best
    print(f'refs.ts: eye: [{", ".join(f"{x:.1f}" for x in eye)}], target: [{", ".join(f"{x:.1f}" for x in target)}], vfov: {vfov:.2f}   # iou {v:.4f}')


if __name__ == '__main__':
    main()
