#!/usr/bin/env python3
"""V1: render the Karma reference frames headless (hython + husk), tone-map them like the flagship, and log times.

  HYTHON=/Applications/Houdini/Houdini21.0.671/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython
  $HYTHON scripts/vdb/reference/render.py                         # all 5 clouds x 2 views, 1920x1080, rig defaults
  $HYTHON scripts/vdb/reference/render.py --clouds 02 --views photo --scale 0.25 --samples 32 --tag test
  $HYTHON scripts/vdb/reference/render.py --tonemap-only          # re-tone-map existing EXRs (e.g. after changing --exposure)

Per frame: open houdini/rigs/reference_render.hip, set CONTROLS (cloud, view, picture, overrides), export the render-settings
stage to a .usd in the output folder (it references the VDB on disk), run husk on it, then tone-map the linear EXR with the
flagship's display transform (three.js ACESFilmicToneMapping: x exposure / 0.6, ACES fit, sRGB) to a JPEG.
Outputs (third-party-derived, gitignored): artifacts/research/v1-reference/<tag>/{usd,exr,jpg}/, times.json.

Exposure: one fixed value for every frame (the light is the same). It is chosen so the clear sky beside the cloud matches the
sky of our C1 frames (fit_exposure, run with --fit-exposure), so cloud brightness reads relative to the same sky.
"""
import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scene  # noqa: E402

HB = '/Applications/Houdini/Houdini21.0.671/Frameworks/Houdini.framework/Versions/Current/Resources/bin'
RIG = os.path.join(scene.REPO, 'houdini', 'rigs', 'reference_render.hip')
DEFAULT_EXPOSURE = 1.0      # replaced by the --fit-exposure result (see work/reports/V1.md)
SKY_PATCH = (40, 40, 240, 240)   # x0, y0, x1, y1 at 1920x1080: clear sky in every C1 photo/detail frame (upper-left, sun side)

# ------------------------------------------------------------------ display transform (three.js ACESFilmicToneMapping + sRGB)
ACES_IN = [[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]]
ACES_OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]]


def aces_three(rgb, exposure):
    import numpy as np
    c = rgb * (exposure / 0.6)
    c = c @ np.array(ACES_IN).T
    c = (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.4329510) + 0.238081)
    c = c @ np.array(ACES_OUT).T
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def read_exr(path):
    import numpy as np
    import OpenImageIO as oiio
    img = oiio.ImageInput.open(path)
    spec = img.spec()
    px = img.read_image(0, 0, 0, 3, oiio.FLOAT)
    img.close()
    return np.asarray(px, dtype=np.float32).reshape(spec.height, spec.width, 3)


def tonemap(exr, jpg, exposure):
    import numpy as np
    from PIL import Image
    out = aces_three(read_exr(exr), exposure)
    Image.fromarray((out * 255 + 0.5).astype(np.uint8)).save(jpg, quality=92)


def fit_exposure(exr, ours_jpg):
    """Exposure s.t. the tone-mapped Karma sky patch has the same mean luma as the same patch of our C1 frame."""
    import numpy as np
    from PIL import Image
    k = read_exr(exr)
    o = np.asarray(Image.open(ours_jpg).convert('RGB'), dtype=np.float32) / 255
    sx, sy = k.shape[1] / 1920, k.shape[0] / 1080
    x0, y0, x1, y1 = SKY_PATCH
    kp = k[int(y0 * sy):int(y1 * sy), int(x0 * sx):int(x1 * sx)].reshape(-1, 3).mean(0)
    op = o[y0:y1, x0:x1].reshape(-1, 3).mean(0)
    luma = lambda c: 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]
    target = luma(op)
    lo, hi = 1e-4, 1e4
    for _ in range(80):
        mid = (lo * hi) ** 0.5
        if luma(aces_three(kp[None], mid)[0]) < target:
            lo = mid
        else:
            hi = mid
    return (lo * hi) ** 0.5, op.tolist(), aces_three(kp[None], (lo * hi) ** 0.5)[0].tolist(), kp.tolist()


# ------------------------------------------------------------------ render

def render_frame(c, view, args, dirs):
    import hou
    hou.hipFile.load(RIG, suppress_save_prompt=True, ignore_load_warnings=True)
    ctl = hou.node('/stage/CONTROLS')
    name = f'cloudpack-{c}-{view}'
    exr = os.path.join(dirs['exr'], name + '.exr')
    ctl.parm('cloud').set(scene.CLOUDS.index(c))
    ctl.parm('view').set(list(scene.VIEWS).index(view))
    ctl.parm('picture').set(exr)
    ctl.parm('resx').set(int(round(scene.RES[0] * args.scale)))
    ctl.parm('resy').set(int(round(scene.RES[1] * args.scale)))
    for key in ('samples', 'volume_limit', 'engine', 'density_mult', 'albedo', 'volume_step_rate'):
        v = getattr(args, key)
        if v is not None:
            ctl.parm(key).set(v)
    rs = hou.node('/stage/render_settings')
    for kv in args.rs or []:
        k, v = kv.split('=', 1)
        parm = rs.parm(k)
        parm.deleteAllKeyframes()
        parm.set(type(parm.eval())(v))
    usd = os.path.join(dirs['usd'], name + '.usd')
    rs.stage().Export(usd)
    settings = {k: ctl.parm(k).eval() for k in ('density_mult', 'albedo', 'g_fwd', 'g_back', 'back_mix', 'samples', 'secondary_max', 'oracle_variance', 'volume_limit',
                                                  'volume_step_rate', 'engine', 'resx', 'resy', 'sun_el', 'sun_az', 'turbidity', 'ground_albedo')}
    cmd = [os.path.join(HB, 'husk'), '--verbose', '1', '-o', exr]
    if args.threads:
        cmd += ['--threads', str(args.threads)]
    cmd.append(usd)
    t0 = time.time()
    p = subprocess.run(cmd, capture_output=True, text=True)
    dt = time.time() - t0
    if p.returncode != 0 or not os.path.exists(exr):
        print(p.stdout[-3000:], p.stderr[-3000:])
        raise SystemExit(f'husk failed for {name}')
    return name, exr, dt, settings, (p.stdout + p.stderr)[-1500:]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--clouds', nargs='*', default=scene.CLOUDS)
    ap.add_argument('--views', nargs='*', default=list(scene.VIEWS))
    ap.add_argument('--scale', type=float, default=1.0, help='resolution scale of 1920x1080')
    ap.add_argument('--samples', type=int)
    ap.add_argument('--volume-limit', dest='volume_limit', type=int)
    ap.add_argument('--volume-step-rate', dest='volume_step_rate', type=float)
    ap.add_argument('--engine', type=int, choices=[0, 1], help='0 cpu, 1 xpu')
    ap.add_argument('--density-mult', dest='density_mult', type=float)
    ap.add_argument('--albedo', type=float)
    ap.add_argument('--threads', type=int, default=0)
    ap.add_argument('--rs', nargs='*', help='render_settings parm overrides, e.g. denoiser=oidn volumequality=0.5')
    ap.add_argument('--tag', default='final')
    ap.add_argument('--exposure', type=float, default=None)
    ap.add_argument('--fit-exposure', action='store_true', help='fit exposure on cloud 02 photo against our C1 frame, then tone-map all')
    ap.add_argument('--tonemap-only', action='store_true')
    args = ap.parse_args()

    root = os.path.join(scene.OUT_DIR, args.tag)
    dirs = {k: os.path.join(root, k) for k in ('usd', 'exr', 'jpg')}
    for d in dirs.values():
        os.makedirs(d, exist_ok=True)
    log_path = os.path.join(root, 'times.json')
    log = json.load(open(log_path)) if os.path.exists(log_path) else {}

    if not args.tonemap_only:
        for c in args.clouds:
            for v in args.views:
                name, exr, dt, settings, tail = render_frame(c, v, args, dirs)
                cpu = next((ln.split('Time:')[1].strip() for ln in tail.splitlines() if 'Total CPU Time' in ln), '')
                log[name] = {'seconds': round(dt, 1), 'cpu': cpu, 'settings': settings, 'overrides': args.rs or [], 'husk_tail': tail}
                print(f'{name}: {dt:.1f} s (cpu {cpu})', flush=True)
                json.dump(log, open(log_path, 'w'), indent=1)

    exposure = args.exposure if args.exposure is not None else log.get('_exposure', {}).get('value', DEFAULT_EXPOSURE)
    if args.fit_exposure:
        ref = os.path.join(dirs['exr'], 'cloudpack-02-photo.exr')
        e, ours, karma_tm, karma_lin = fit_exposure(ref, os.path.join(scene.C1_DIR, 'photo', 'cloudpack-02.jpg'))
        exposure = e
        log['_exposure'] = {'value': e, 'patch': SKY_PATCH, 'ours_srgb': ours, 'karma_tonemapped': karma_tm, 'karma_linear': karma_lin}
        print('fitted exposure', e, 'ours', ours, 'karma', karma_tm, 'linear', karma_lin)
        json.dump(log, open(log_path, 'w'), indent=1)
    for f in sorted(os.listdir(dirs['exr'])):
        if f.endswith('.exr'):
            tonemap(os.path.join(dirs['exr'], f), os.path.join(dirs['jpg'], f[:-4] + '.jpg'), exposure)
    print('exposure', exposure, '->', dirs['jpg'])


if __name__ == '__main__':
    main()
