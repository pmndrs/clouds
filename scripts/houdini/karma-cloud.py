#!/usr/bin/env python3
"""P2.9a: Karma renders of the Houdini cumulus (cumulus_4_wispy.vdb) as a lighting reference for the realtime clouds.

  HYTHON=/Applications/Houdini/Houdini21.0.792/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython
  $HYTHON scripts/houdini/karma-cloud.py                          # all three frames (sunward, noon, low) + sheet
  $HYTHON scripts/houdini/karma-cloud.py --frames sunward --res 480 270 --spp 16 --cap 60   # quick test

Scene (Solaris, built in hython, exported to USD and rendered with husk):
  - Volume LOP: the VDB as written (metres, y up, base at y = 0, 12 m voxels, fog grid `density` 0..1). No rescale.
  - Material: MaterialX `kma_volume` (Karma Volume) fed by the `density` primvar:
      sigma_t = density x SIGMA (1/m), scattering = ALBEDO x sigma_t, absorption = (1 - ALBEDO) x sigma_t, HG anisotropy G.
    The scene unit is the metre, so the coefficients are per metre.
  - Lights: Karma Physical Sky LOP (KarmaSkyDomeLight + its own distant sun), sun set by altitude / azimuth.
    Azimuth convention (checked on the stage): az 0 puts the sun toward -z, az 90 toward +x, so dir(az) = (sin az, ., -cos az).
  - Render settings: volume limit, volume step rate, spp from the CLI; diffuse / reflect / refract limits 0 (no surfaces).
Output under work/captures/P2-9a/: <frame>.exr (linear), <frame>.png (tone-mapped), sheet.jpg, report.json.
"""
import argparse
import json
import math
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
VDB = os.path.join(REPO, 'assets', 'clouds', 'houdini-stages', 'cumulus_4_wispy.vdb')
OUT = os.path.join(REPO, 'work', 'captures', 'P2-9a')
HIP = os.path.join(REPO, 'houdini', 'rigs', 'karma_cloud.hip')
HB = os.path.dirname(sys.executable)

SIGMA = 0.08        # extinction per metre at density 1
ALBEDO = 0.99
G = 0.8             # HG anisotropy
CAM_H = 150.0       # camera height above the ground (m)
SIDE_DIST = 5500.0  # side-on camera: horizontal distance from the cloud's box centre (m)

# Frames: sun altitude / azimuth (physical sky), camera placement.
FRAMES = {
    # Looking toward the sun (sun toward -z), camera on +z; its distance is solved so the top silhouette sits 3 deg above the sun
    # (P1.7b convention: examples/lab/reference-pt/cards.ts sunwardCamera), view aimed 7 deg below the sun.
    'sunward': {'alt': 32.0, 'az': 0.0, 'camera': 'sunward'},
    # Side-on camera on +z looking -z; sun high, 70 deg round from the camera toward the left (az 250).
    'noon': {'alt': 69.0, 'az': 250.0, 'camera': 'side'},
    # Side-on camera, sun 15 deg up from the camera's left (-x, az 270).
    'low': {'alt': 15.0, 'az': 270.0, 'camera': 'side'},
}


def sun_dir(alt, az):
    a, z = math.radians(alt), math.radians(az)
    return (math.sin(z) * math.cos(a), math.sin(a), -math.cos(z) * math.cos(a))


def load_density():
    import numpy as np
    import hou
    g = hou.Geometry()
    g.loadFromFile(VDB)
    p = [q for q in g.prims() if q.type() == hou.primType.VDB and q.attribValue('name') == 'density'][0]
    bb = p.activeVoxelBoundingBox()
    lo = [int(round(v)) for v in bb.minvec()]
    hi = [int(round(v)) for v in bb.maxvec()]
    n = [hi[k] - lo[k] for k in range(3)]
    arr = np.asarray(p.voxelRangeAsFloat(hou.BoundingBox(*lo, *hi)), dtype=np.float32).reshape(n[2], n[1], n[0])
    vs = float(p.voxelSize()[0])
    o = p.indexToPos(tuple(lo))
    mn = (o[0] - vs / 2, o[1] - vs / 2, o[2] - vs / 2)   # min corner of voxel 0
    return np.clip(arr, 0, None), vs, mn


def ray_tau(grid, o, d, cap):
    """Optical depth along a ray (nearest voxel, half-voxel steps), stops at cap."""
    arr, vs, mn = grid
    nz, ny, nx = arr.shape
    mx = (mn[0] + nx * vs, mn[1] + ny * vs, mn[2] + nz * vs)
    t0, t1 = 0.0, 1e30
    for a in range(3):
        if abs(d[a]) < 1e-9:
            if o[a] < mn[a] or o[a] > mx[a]:
                return 0.0
            continue
        ta, tb = (mn[a] - o[a]) / d[a], (mx[a] - o[a]) / d[a]
        t0, t1 = max(t0, min(ta, tb)), min(t1, max(ta, tb))
    if t1 <= t0:
        return 0.0
    step, tau, t = vs * 0.5, 0.0, t0 + vs * 0.25
    while t < t1:
        i = int((o[0] + d[0] * t - mn[0]) / vs); j = int((o[1] + d[1] * t - mn[1]) / vs); k = int((o[2] + d[2] * t - mn[2]) / vs)
        if 0 <= i < nx and 0 <= j < ny and 0 <= k < nz:
            tau += float(arr[k, j, i]) * SIGMA * step
            if tau > cap:
                break
        t += step
    return tau


def box_centre(grid):
    arr, vs, mn = grid
    nz, ny, nx = arr.shape
    return (mn[0] + nx * vs / 2, mn[1] + ny * vs / 2, mn[2] + nz * vs / 2)


def sunward_camera(grid, sd, inside_deg=3.0, sil_tau=0.1, aim_below=7.0):
    """Port of cards.ts sunwardCamera: camera on the far side from the sun at CAM_H, distance solved by bisection."""
    c = box_centre(grid)
    hl = math.hypot(sd[0], sd[2]); h = (sd[0] / hl, sd[2] / hl)
    el_sun = math.degrees(math.asin(sd[1]))
    cam_at = lambda D: (c[0] - h[0] * D, CAM_H, c[2] - h[1] * D)
    dir_at = lambda e: (h[0] * math.cos(math.radians(e)), math.sin(math.radians(e)), h[1] * math.cos(math.radians(e)))

    def top_edge(D):
        cam = cam_at(D)
        e = 85.0
        while e > el_sun - 20:
            if ray_tau(grid, cam, dir_at(e), sil_tau * 2) >= sil_tau:
                return e
            e -= 0.1
        return -90.0
    want = el_sun + inside_deg
    lo, hi = 500.0, 20000.0
    for _ in range(16):
        mid = (lo + hi) / 2
        if top_edge(mid) > want:
            lo = mid
        else:
            hi = mid
    D = (lo + hi) / 2
    pos = cam_at(D)
    aim = dir_at(el_sun - aim_below)
    info = {'distance_m': round(D, 1), 'sun_elevation_deg': round(el_sun, 2), 'edge_elevation_deg': round(top_edge(D), 2),
            'tau_along_sun': round(ray_tau(grid, pos, dir_at(el_sun), 1e9), 1)}
    return pos, aim, info


def yaw_pitch(d):
    """Rotations (deg, order xyz: pitch about x then yaw about y) that turn local -z into direction d."""
    n = math.sqrt(sum(v * v for v in d))
    d = [v / n for v in d]
    return math.degrees(math.asin(d[1])), math.degrees(math.atan2(-d[0], -d[2]))


def build_stage(frame, res, spp, engine, volumelimit, steprate, grid, hfov):
    import hou
    st = hou.node('/stage')
    for ch in st.children():
        ch.destroy()
    vol = st.createNode('volume', 'cloud')
    vol.parm('primpath').set('/cloud')
    vol.parm('filepath1').set(VDB)

    ml = st.createNode('materiallibrary', 'mat')
    ml.setInput(0, vol)
    dens = ml.createNode('mtlxgeompropvalue', 'density_field')
    dens.parm('signature').set('default')
    dens.parm('geomprop').set('density')
    sig = ml.createNode('mtlxmultiply', 'sigma_t')
    sig.setInput(0, dens)
    sig.parm('in2').set(SIGMA)
    nodes = {}
    for nm, k in (('scattering', ALBEDO), ('absorption', 1.0 - ALBEDO)):
        m = ml.createNode('mtlxmultiply', nm)
        m.parm('signature').set('vector3FA')
        for comp in 'xyz':
            p = m.parm('in1_vector3FA%s' % comp) or m.parm('in1_vector3%s' % comp)
            p.set(k)
        m.setInput(1, sig)
        nodes[nm] = m
    vsh = ml.createNode('kma_volume', 'vapour_volume')
    vsh.setInput(vsh.inputIndex('scattering'), nodes['scattering'])
    vsh.setInput(vsh.inputIndex('absorption'), nodes['absorption'])
    vsh.parm('anisotropy').set(G)
    mat = ml.createNode('mtlxvolumematerial', 'vapour')
    mat.setInput(0, vsh)
    ml.layoutChildren()
    asg = st.createNode('assignmaterial', 'assign')
    asg.setInput(0, ml)
    asg.parm('primpattern1').set('/cloud')
    asg.parm('matspecpath1').set('/materials/vapour')

    f = FRAMES[frame]
    sd = sun_dir(f['alt'], f['az'])
    info = {}
    if f['camera'] == 'sunward':
        pos, aim, info = sunward_camera(grid, sd)
    else:
        c = box_centre(grid)
        pos = (c[0], CAM_H, c[2] + SIDE_DIST)
        aim = (0.0, 1000.0 - CAM_H, -SIDE_DIST)   # at the box centre, 1 km up
    pitch, yaw = yaw_pitch(aim)
    cam = st.createNode('camera', 'cam')
    cam.setInput(0, asg)
    cam.parm('primpath').set('/cameras/view')
    cam.parm('xOrd').set('srt') if cam.parm('xOrd') else None
    cam.parm('rOrd').set('xyz') if cam.parm('rOrd') else None
    cam.parmTuple('t').set(pos)
    cam.parmTuple('r').set((pitch, yaw, 0.0))
    ap = cam.parm('horizontalAperture').eval()
    cam.parm('focalLength').set(ap / 2 / math.tan(math.radians(hfov / 2)))
    cam.parm('clippingRange1').set(1.0)
    cam.parm('clippingRange2').set(1e7)

    sky = st.createNode('karmaphysicalsky', 'sky')
    sky.setInput(0, cam)
    sky.parm('solar_altitude').set(f['alt'])
    sky.parm('solar_azimuth').set(f['az'])

    rs = st.createNode('karmarendersettings', 'rs')
    rs.setInput(0, sky)
    rs.parm('camera').set('/cameras/view')
    rs.parm('res_mode').set('manual')
    rs.parm('resolutiony').lock(False)
    rs.parm('resolutionx').set(res[0])
    rs.parm('resolutiony').set(res[1])
    rs.parm('engine').set(engine)
    rs.parm('convergence_mode').set('Path Traced')   # uniform spp; the default variance oracle took ~38 rays/px at spp 1
    rs.parm('samplesperpixel').set(spp)
    rs.parm('pathtracedsamples').set(spp)
    rs.parm('volumelimit').set(volumelimit)
    rs.parm('volumesteprate').set(steprate)
    for nm in ('diffuselimit', 'reflectionlimit', 'refractionlimit'):
        rs.parm(nm).set(0)
    rs.setDisplayFlag(True)
    st.layoutChildren()
    info.update({'camera_pos': [round(v, 1) for v in pos], 'aim': [round(v, 4) for v in aim], 'pitch_deg': round(pitch, 2),
                 'yaw_deg': round(yaw, 2), 'sun_dir': [round(v, 4) for v in sd], 'sun_alt': f['alt'], 'sun_az': f['az'], 'hfov_deg': hfov})
    return rs, info


def husk_render(usd, exr, cap_s):
    husk = os.path.join(HB, 'husk')
    if os.path.exists(exr):
        os.remove(exr)
    log = exr[:-4] + '.husk.log'
    t = time.time()
    with open(log, 'w') as lf:
        p = subprocess.Popen([husk, '-V', '3', '--make-output-path', '-o', exr, usd], stdout=lf, stderr=subprocess.STDOUT, text=True)
        try:
            p.wait(timeout=cap_s)
        except subprocess.TimeoutExpired:
            p.kill()
            lf.write('\nKILLED after %d s\n' % cap_s)
    with open(log) as lf:
        txt = lf.read()
    return round(time.time() - t, 1), txt, os.path.exists(exr)


def tonemap(exr, png, ev):
    """EXR -> PFM via hoiiotool, then exposure + ACES (Narkowicz fit) + sRGB in numpy, PNG via the system python3 + Pillow."""
    import numpy as np
    pfm = exr[:-4] + '.pfm'
    subprocess.run([os.path.join(HB, 'hoiiotool'), exr, '--ch', 'R,G,B', '-o', pfm], check=True, capture_output=True)
    with open(pfm, 'rb') as fh:
        assert fh.readline().strip() == b'PF'
        w, h = map(int, fh.readline().split())
        scale = float(fh.readline())
        a = np.frombuffer(fh.read(), dtype='<f4' if scale < 0 else '>f4').reshape(h, w, 3)[::-1]
    x = np.nan_to_num(a) * (2.0 ** ev)
    y = np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1)
    s = np.where(y <= 0.0031308, 12.92 * y, 1.055 * np.power(y, 1 / 2.4) - 0.055)
    raw = png[:-4] + '.rgb8'
    (s * 255 + 0.5).astype(np.uint8).tofile(raw)
    subprocess.run(['python3', '-c', "import sys\nfrom PIL import Image\nw,h=int(sys.argv[3]),int(sys.argv[4])\n"
                    "Image.frombytes('RGB',(w,h),open(sys.argv[1],'rb').read()).save(sys.argv[2])", raw, png, str(w), str(h)], check=True)
    os.remove(raw)
    os.remove(pfm)
    lum = a @ np.array([0.2126, 0.7152, 0.0722])
    return {'p50': float(np.percentile(lum, 50)), 'p99': float(np.percentile(lum, 99)), 'max': float(lum.max())}


def make_sheet(items, path):
    code = ("import sys, json\nfrom PIL import Image, ImageDraw\nitems = json.loads(sys.argv[2])\n"
            "ims = [Image.open(p).convert('RGB') for p, _ in items]\nw, h = ims[0].size\n"
            "out = Image.new('RGB', (w, len(ims) * (h + 6) - 6), (20, 20, 20))\n"
            "for i, (im, (_, lab)) in enumerate(zip(ims, items)):\n"
            "    y = i * (h + 6)\n    out.paste(im, (0, y))\n    d = ImageDraw.Draw(out)\n"
            "    d.rectangle([6, y + 6, 12 + 6 * len(lab), y + 26], fill=(0, 0, 0))\n    d.text((12, y + 10), lab, fill=(255, 255, 255))\n"
            "out.save(sys.argv[1], quality=90)\n")
    subprocess.run(['python3', '-c', code, path, json.dumps(items)], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frames', nargs='+', default=['sunward', 'noon', 'low'])
    ap.add_argument('--res', nargs=2, type=int, default=[960, 540])
    ap.add_argument('--spp', type=int, default=32)
    ap.add_argument('--engine', default='cpu', choices=['cpu', 'xpu'])
    ap.add_argument('--volumelimit', type=int, default=32)
    ap.add_argument('--steprate', type=float, default=1.0)
    ap.add_argument('--hfov', type=float, default=50.0)
    ap.add_argument('--ev', type=float, default=None, help='exposure (stops); default per frame from the 99th percentile')
    ap.add_argument('--cap', type=int, default=180, help='seconds per frame before husk is killed')
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--tag', default='')
    ap.add_argument('--no-sheet', action='store_true')
    ap.add_argument('--no-denoise', action='store_true', help='skip the OIDN companion images')
    ap.add_argument('--reuse', action='store_true', help='skip husk when <frame>.exr exists (re-tonemap / re-sheet only)')
    args = ap.parse_args()
    args.reuse_times = None
    rpt = os.path.join(args.out, 'report%s.json' % args.tag)
    if args.reuse and os.path.exists(rpt):
        with open(rpt) as fh:
            args.reuse_times = {k: (v.get('render_s', -1), v.get('spp', args.spp)) for k, v in json.load(fh)['frames'].items()}
    dn_items = []
    import hou
    os.makedirs(args.out, exist_ok=True)
    grid = load_density()
    report = {'vdb': os.path.relpath(VDB, REPO), 'sigma_per_m': SIGMA, 'albedo': ALBEDO, 'g': G, 'engine': args.engine, 'spp': args.spp,
              'volumelimit': args.volumelimit, 'volumesteprate': args.steprate, 'res': args.res, 'frames': {}}
    items = []
    for fr in args.frames:
        rs, info = build_stage(fr, args.res, args.spp, args.engine, args.volumelimit, args.steprate, grid, args.hfov)
        name = fr + args.tag
        usd = os.path.join(args.out, name + '.usda')
        rs.stage().Export(usd)
        exr = os.path.join(args.out, name + '.exr')
        spp = args.spp
        if args.reuse and os.path.exists(exr):   # spp / time of the earlier render come from the old report.json
            (secs, spp), ok = (args.reuse_times or {}).get(fr, (-1, args.spp)), True
        else:
            secs, txt, ok = husk_render(usd, exr, args.cap)
        info['spp'] = spp
        print(fr, 'render', secs, 's', 'ok' if ok else 'FAILED', flush=True)
        if not ok:
            print(txt[-1500:])   # full log: <frame>.husk.log
            info.update({'render_s': secs, 'ok': False})
            report['frames'][fr] = info
            continue
        if args.ev is None:
            st = tonemap(exr, exr[:-4] + '.png', 0.0)
            ev = math.log2(3.0 / max(st['p99'], 1e-6))   # p99 luminance -> 3.0 before the curve
        else:
            ev = args.ev
        stats = tonemap(exr, exr[:-4] + '.png', ev)
        info.update({'render_s': secs, 'ok': True, 'ev': round(ev, 2), 'lum': {k: round(v, 4) for k, v in stats.items()}})
        report['frames'][fr] = info
        items.append([exr[:-4] + '.png', '%s  (Karma %s, %d spp, sun %g deg up, %.1f s)' % (fr, args.engine.upper(), spp, FRAMES[fr]['alt'], secs)])
        if not args.no_denoise:   # OIDN on the beauty only (no albedo / normal AOVs), same exposure: a readability aid, not the reference
            dn = exr[:-4] + '_oidn.exr'
            subprocess.run([os.path.join(HB, 'idenoise'), exr, dn], check=True, capture_output=True)
            tonemap(dn, dn[:-4] + '.png', ev)
            os.remove(dn)
            dn_items.append([dn[:-4] + '.png', '%s  denoised (OIDN, beauty only)' % fr])
        os.remove(usd) if not args.tag else None
    with open(os.path.join(args.out, 'report%s.json' % args.tag), 'w') as fh:
        json.dump(report, fh, indent=1)
    print(json.dumps(report, indent=1))
    if items and not args.no_sheet:
        make_sheet(items, os.path.join(args.out, 'sheet%s.jpg' % args.tag))
        if dn_items:
            make_sheet(dn_items, os.path.join(args.out, 'sheet_denoised%s.jpg' % args.tag))
    os.makedirs(os.path.dirname(HIP), exist_ok=True)
    hou.hipFile.save(HIP)


if __name__ == '__main__':
    main()
