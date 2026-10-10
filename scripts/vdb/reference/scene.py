"""V1 reference scene: placement, cameras and sun for the EmberGen CloudPack frames, matching the C1 calibration renders 1:1.

Pure Python (no hou), shared by build_rig.py (hython) and render.py.

Placement reproduces `vdb_to_nvdf.py --mode fog --up z --world-scale 4` (8 m target lattice, margin 8, iso 0.05) followed by the
flagship's `placeCloud(asset, 1300)`: the converter's crop box is centred at x = z = 0 with its floor at y = 1300 m. World metres,
Y up. A source VDB position P (EmberGen units, Z up) maps to

    X =  4 Px + tx,   Y = 4 Pz + ty,   Z = -4 Py + tz

i.e. scale 4, rotate -90 deg about X (new up = old z, new row = -old y: a rotation, not a mirror, exactly like the converter),
then translate. tx, ty, tz follow from the converter's resample anchor and crop (derived in `placement`).

Cameras reproduce `resolveBookmark('photo' | 'detail')` in examples/lab/flagship/bookmarks.ts with the C1 sun (time 15.9,
elevation 38.80 deg, azimuth 269.54 deg) and the focus box (occupied 8 m voxels, profile > 0) of each converted asset.
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
MAIN = os.path.abspath(os.path.join(REPO, '..', '..', '..')) if '.claude/worktrees' in REPO else REPO
VDB_DIR = os.path.join(MAIN, 'artifacts', 'research', 'vdbs', 'CloudPack', 'CloudPackVDB')
OUT_DIR = os.path.join(MAIN, 'artifacts', 'research', 'v1-reference')     # gitignored: renders of third-party data
ASSET_DIR = os.path.join(REPO, 'assets', 'clouds', 'local')
C1_DIR = os.path.join(REPO, 'work', 'captures', 'C1', 'calibration')

CLOUDS = ['02', '03', '08', '09', '10']
VIEWS = {'photo': 48.0, 'detail': 20.0}           # horizontal FOV, degrees (40 mm / 105 mm on full frame)
BASE = 1300.0                                     # flagship ?base=1300: floor of the converter's crop box
WORLD_SCALE, SV, TV, MARGIN = 4.0, 4.0, 8.0, 8    # converter defaults used in C1
SUN_EL, SUN_AZ = 38.79809624658686, 269.54333297645786   # C1 report (time 15.9, lat 40): compass az, north = -Z, east = +X
RES = (1920, 1080)
APERTURE_MM = 36.0


def vdb_path(c):
    return os.path.join(VDB_DIR, f'cloud_{c}_variant_0000.vdb')


def asset_meta(c):
    with open(os.path.join(ASSET_DIR, f'cloudpack-{c}', 'cloud.json')) as f:
        return json.load(f)


def placement(c, index0, alo, ahi):
    """(tx, ty, tz) for cloud c. index0 = VDB indexToPos(0,0,0); alo/ahi = activeVoxelBoundingBox min/max (hou x, y, z)."""
    m = asset_meta(c)
    w, h, _ = m['dims']                       # texture (x, row, up)
    cx, cr, cu = m['cropOffset']              # crop min in texture order (t0 is reset to 0 for --up z)
    pad = int(math.ceil(MARGIN * TV / SV)) + 2
    lo = [alo[i] - pad for i in range(3)]
    hi = [ahi[i] + pad for i in range(3)]
    a_x = math.floor(lo[0] * SV / TV)
    a_z = math.floor(lo[2] * SV / TV)
    b_y = math.ceil(hi[1] * SV / TV)
    # u = metres from the corner of source voxel 0 = 4 P - (4 O - sv/2)
    k = [-WORLD_SCALE * index0[i] + 0.5 * SV for i in range(3)]
    min_x, min_z = -(w * TV) / 2, -(h * TV) / 2
    tx = k[0] + min_x - (a_x + cx) * TV
    ty = k[2] + BASE - (a_z + cu) * TV
    tz = min_z + (b_y - cr) * TV - k[1]
    return tx, ty, tz


def focus_box(c):
    """Occupied box (profile > 0, 8 m voxels) in world metres, as placeCloud computes it."""
    m = asset_meta(c)
    w, h, _ = m['dims']
    mn = [-(w * TV) / 2, BASE, -(h * TV) / 2]
    cro, omin, omax = m['cropOffset'], m['occupiedMin'], m['occupiedMax']
    lo = [omin[i] - cro[i] for i in range(3)]          # texture (x, row, up)
    hi = [omax[i] - cro[i] + 1 for i in range(3)]
    return ([mn[0] + lo[0] * TV, mn[1] + lo[2] * TV, mn[2] + lo[1] * TV],
            [mn[0] + hi[0] * TV, mn[1] + hi[2] * TV, mn[2] + hi[1] * TV])


def sun_vector(az=SUN_AZ, el=SUN_EL):
    a, e = math.radians(az), math.radians(el)
    return [math.sin(a) * math.cos(e), math.sin(e), -math.cos(a) * math.cos(e)]


def camera(c, view):
    """(position, target, hfov) of the C1 bookmark for cloud c (bookmarks.ts resolveBookmark)."""
    fmin, fmax = focus_box(c)
    centre = [(fmin[i] + fmax[i]) / 2 for i in range(3)]
    s = sun_vector()
    hl = math.hypot(s[0], s[2]) or 1
    sh = (s[0] / hl, s[2] / hl)
    hfov = math.radians(VIEWS[view])
    a = math.radians(20)
    v90 = (-sh[1], sh[0])
    vx = math.cos(a) * v90[0] + math.sin(a) * sh[0]
    vz = math.cos(a) * v90[1] + math.sin(a) * sh[1]
    vl = math.hypot(vx, vz)
    v = (vx / vl, vz / vl)
    px, pz = -v[1], v[0]
    ts = [x * px + z * pz for x in (fmin[0], fmax[0]) for z in (fmin[2], fmax[2])]
    width, tan_h = max(ts) - min(ts), math.tan(hfov / 2)
    dist = 0.62 * width / (2 * 0.5 * tan_h) if view == 'photo' else (0.6 * width) / (2 * tan_h)
    tgt = centre if view == 'photo' else [centre[0], fmin[1] + 0.8 * (fmax[1] - fmin[1]), centre[2]]
    return [tgt[0] - v[0] * dist, 2.0, tgt[2] - v[1] * dist], tgt, VIEWS[view]


def camera_euler(pos, tgt):
    """Houdini rx, ry (degrees, rotate order xyz) for a camera at pos looking at tgt with Y up (camera looks down -Z)."""
    d = [tgt[i] - pos[i] for i in range(3)]
    ry = math.degrees(math.atan2(-d[0], -d[2]))
    rx = math.degrees(math.atan2(d[1], math.hypot(d[0], d[2])))
    return rx, ry


def focal_mm(hfov_deg):
    return (APERTURE_MM / 2) / math.tan(math.radians(hfov_deg) / 2)


if __name__ == '__main__':
    for c in CLOUDS:
        for v in VIEWS:
            p, t, f = camera(c, v)
            print(c, v, [round(x, 1) for x in p], [round(x, 1) for x in t], f, round(focal_mm(f), 2), [round(x, 2) for x in camera_euler(p, t)])
        print('  focus', focus_box(c))
