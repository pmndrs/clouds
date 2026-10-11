#!/usr/bin/env python3
# D1 round 10: the frames' sky as a ramp over sin(elevation) in linear pre-exposure radiance (inverse sRGB OETF + inverse three ACES filmic
# at the ref's exposure), from the sky rows our matte exposes. Prints samples and a 5-stop ramp; also our own capture through the same inverse.
import sys, json, math, re, numpy as np
from PIL import Image
sys.path.insert(0, '/Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11/scripts/d1'); import d1
ROOT = '/Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11'
def load_refs():
    src = open(f'{ROOT}/examples/lab/decima/refs.ts').read(); out = {}
    for m in re.finditer(r"\n  (\w+): \{ cloud: '(\w+)'.*?eye: \[([^\]]+)\], target: \[([^\]]+)\], vfov: ([\d.]+).*?exposure: ([\d.]+)", src):
        out[m.group(1)] = (m.group(2), [float(x) for x in m.group(3).split(',')], [float(x) for x in m.group(4).split(',')], float(m.group(5)), float(m.group(6)))
    return out
REFS = load_refs()
IN = np.array([[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]])
OUT = np.array([[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]])
def srgb_to_linear(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def aces_inverse(y, exposure):
    v = np.clip(y, 0, 0.995) @ np.linalg.inv(OUT).T
    a = 1 - 0.983729 * v; b = 0.0245786 - 0.432951 * v; c = -0.000090537 - 0.238081 * v
    r = (-b + np.sqrt(np.maximum(b * b - 4 * a * c, 0))) / (2 * a)
    return (r @ np.linalg.inv(IN).T) * 0.6 / exposure
def aces_forward(x, exposure):
    v = (x * exposure / 0.6) @ IN.T
    v = (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081)
    return np.clip(v @ OUT.T, 0, 1)
def main(name, ours=None):
    cloud, eye, target, vfov, exposure = REFS[name]
    ref = np.asarray(Image.open(d1.ref_of(name)).convert('RGB').resize((1920, 1080), Image.LANCZOS)).astype(float) / 255
    matte = np.asarray(Image.open(f'{ROOT}/work/captures/D1/{cloud}/{name}@look:decima@matte.png').convert('L')) < 8
    pitch = math.degrees(math.atan2(target[1] - eye[1], math.hypot(target[0] - eye[0], target[2] - eye[2]))) if eye else 0
    f = 540 / math.tan(math.radians(vfov / 2))
    imgs = [('frame', ref)] + ([('ours', np.asarray(Image.open(ours).convert('RGB')).astype(float) / 255)] if ours else [])
    for lab, im in imgs:
        print(f'== {name} {lab}: exposure {exposure}, pitch {pitch:.1f} deg')
        samples = []
        for y in range(15, 1080, 30):
            m = matte[y - 15:y + 15]
            if m.sum() < 400: continue
            el = pitch + math.degrees(math.atan((540 - y) / f))
            c = np.median(im[y - 15:y + 15][m], axis=0)
            lin = aces_inverse(srgb_to_linear(c)[None, :], exposure)[0]
            samples.append((round(math.sin(math.radians(el)), 4), [round(float(v), 4) for v in lin], round(el, 1), [round(float(v), 3) for v in c]))
        for s in samples: print(f'  sin {s[0]:7.4f} el {s[2]:5.1f}  8bit {s[3]}  linear {s[1]}')
        if lab == 'frame':
            xs = np.array([x[0] for x in samples]); cs = np.array([x[1] for x in samples]); order = np.argsort(xs); xs, cs = xs[order], cs[order]
            stops = []
            for at in (0.03, 0.15, 0.3, 0.6):
                c = [float(np.interp(at, xs, cs[:, i])) for i in range(3)]
                stops.append(f"{{ at: {at}, color: [{c[0]:.2f}, {c[1]:.2f}, {c[2]:.2f}] }}")
            print(f"  skyRamp: [{', '.join(stops)}],")
        if lab == 'frame': json.dump(samples, open(f'/private/tmp/claude-502/-Users-dex-Developer-WebGPUClouds--claude-worktrees-cloud-research-setup-10bf11/a381824f-b944-467f-94ec-8988ae178608/scratchpad/d1/skyfit-{name}.json', 'w'))
if __name__ == '__main__': main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
