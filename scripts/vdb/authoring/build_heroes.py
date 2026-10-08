#!/usr/bin/env python3
"""Author the P4-E hero clouds with Houdini's Cloud + Cloud Noise SOPs, then convert them for the runtime.

  HYTHON=/Applications/Houdini/Houdini21.0.671/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython
  $HYTHON scripts/vdb/authoring/build_heroes.py                       # all three, convert to assets/clouds/heroes/<name>
  $HYTHON scripts/vdb/authoring/build_heroes.py tower --no-convert    # just the VDB (+ preview PNGs)
  $HYTHON scripts/vdb/authoring/build_heroes.py fairweather --hip out.hip   # also save the network for editing in Houdini

Network per cloud (all under /obj/<name>):

  source geometry (sphere SOPs merged = closed polygon model)
    -> cloud            Cloud SOP: polygons -> fog VDB 'density' with a soft shoulder and procedural secondary
                        bumps (Secondary Shapes). Optional Flatten gives a flat base.
    -> cloudnoise (big) Cloud Noise SOP pass 1: element size ~1/4 of the cloud, carves the large billows
    -> cloudnoise (fine) pass 2: element size ~1/12 of the cloud, roughens the surface (cauliflower detail)
    -> vdbsmooth        small mean filter so voxel-scale stair-steps don't survive the resample to 8 m
    -> ROP / saveToFile NAME.vdb  (one fog grid named `density`)

then `scripts/vdb/vdb_to_nvdf.py --mode fog` (default PACK_FIT mapping, 8 m voxels) writes assets/clouds/heroes/NAME.

Everything is in metres (1 Houdini unit = 1 m).  Every knob lives in the RECIPES dict below: edit a number, rerun.
"""
import argparse
import json
import math
import os
import random
import subprocess
import sys
import time
import zlib
import struct

import hou
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
CONVERTER = os.path.join(REPO, 'scripts', 'vdb', 'vdb_to_nvdf.py')
PX_MAX = 8 * 1024 * 1024  # voxel read guard for previews

# ------------------------------------------------------------------------------------------- source geometry
# Each source returns a list of (x, y, z, radius) spheres in metres, y up, base at y = 0.


def tower_spheres(rnd):
    """Towering cumulus / congestus: a wide flat-ish foot, a thick boiling trunk, and a cauliflower head with
    side turrets.  ~900 m wide and ~1.2 km tall as authored (see the README for the runtime size note)."""
    s = [(0, 170, 0, 190), (-190, 150, 60, 150), (200, 160, -50, 150), (40, 130, 200, 140), (-30, 150, -210, 140)]
    # trunk: stacked, shrinking-then-swelling spheres leaning slightly
    for i in range(7):
        y = 260 + i * 110
        r = 190 - 10 * i + (60 if i >= 4 else 0)
        s.append((20 * math.sin(i * 0.9), y, 15 * math.cos(i * 0.7), r))
    # head: ring of turrets around the top
    for i in range(9):
        a = i / 9 * math.tau + rnd.random() * 0.4
        d = 150 + rnd.random() * 120
        s.append((math.cos(a) * d, 800 + rnd.random() * 280, math.sin(a) * d * 0.9, 120 + rnd.random() * 80))
    s += [(0, 1000, 0, 230), (0, 1100, 0, 150)]
    return s


def valley_fog_spheres(rnd):
    """Long low bank (2 km x 400 m x 150 m): a chain of overlapping wide, squashed ellipsoids wandering along x."""
    s = []
    n = 24
    for i in range(n):
        t = i / (n - 1)
        x = -900 + t * 1800
        z = math.sin(t * 5.2) * 60 + (rnd.random() - 0.5) * 50
        w = 0.55 + 0.45 * math.sin(t * math.pi) ** 0.5
        s.append((x, 50 + rnd.random() * 14, z, 160 + 40 * rnd.random(), 48 + 14 * rnd.random(), (100 + 40 * rnd.random()) * w))
    return s


def fairweather_spheres(rnd):
    """Fair-weather cumulus: a lumpy dome ~700 m across, 300 m tall, base flattened by the Cloud SOP."""
    s = [(0, 130, 0, 190)]
    for i in range(10):
        a = i / 10 * math.tau + rnd.random() * 0.5
        d = 130 + rnd.random() * 140
        s.append((math.cos(a) * d, 120 + rnd.random() * 60, math.sin(a) * d * 0.8, 80 + rnd.random() * 60))
    for i in range(5):
        a = rnd.random() * math.tau
        d = rnd.random() * 120
        s.append((math.cos(a) * d, 220 + rnd.random() * 40, math.sin(a) * d, 90 + rnd.random() * 40))
    return s


# ------------------------------------------------------------------------------------------- recipes
# voxel       authoring voxel size in metres.  4 m authored then area-averaged to the runtime's 8 m keeps the fine
#             noise from aliasing.  Use 8 for a fast preview.
# cloud       Cloud SOP parms (name -> value).  See README for what each one does.
# noise       list of Cloud Noise SOP parm dicts, one node per pass.
# smooth      (iterations, voxel radius) for the VDB Smooth SOP, or None.
# convert     extra vdb_to_nvdf.py arguments.

RECIPES = {
    'tower': dict(
        seed=11, spheres=tower_spheres, voxel=4.0, scale=0.77,
        cloud=dict(
            densitymultiplier=2.0, exteriorband=200.0, interiorband=200.0, smoothiterations=1,
            addsecondary=1, secondaryiterations=1, scatterpoints=140, secondaryshapesize=55.0,
            secondaryscalemultiplier=1.0, secondarynoisemin=0.0, secondarynoisemax=1.0,
            billow=0.0, offset=0.12, flatten=0,
        ),
        noise=[
            dict(noiseamount=1.5, noiseelementsize=210.0, noiseoctaves=3, noiserough=0.5, upvectorfalloff=0,
                 advectnoise=1, advectamp=0.25, advectelemsize=160.0),
            dict(noiseamount=0.8, noiseelementsize=70.0, noiseoctaves=4, noiserough=0.55, upvectorfalloff=0,
                 advectnoise=1, advectamp=0.12, advectelemsize=50.0),
            dict(noiseamount=0.6, noiseelementsize=28.0, noiseoctaves=3, noiserough=0.6, upvectorfalloff=0, advectnoise=0),
        ],
        smooth=(1, 1),
        convert=['--margin', '1', '--iso', '0.3'],
    ),
    'valley-fog': dict(
        seed=5, spheres=valley_fog_spheres, voxel=4.0, base=0.0, basefade=30.0,
        cloud=dict(
            densitymultiplier=2.0, exteriorband=60.0, interiorband=60.0, smoothiterations=2,
            addsecondary=1, secondaryiterations=1, scatterpoints=160, secondaryshapesize=28.0,
            billow=0.0, offset=0.08,
        ),
        noise=[
            dict(noiseamount=0.7, noiseelementsize=180.0, noiseoctaves=3, noiserough=0.45, upvectorfalloff=0,
                 advectnoise=1, advectamp=0.18, advectelemsize=140.0),
            dict(noiseamount=0.45, noiseelementsize=45.0, noiseoctaves=3, noiserough=0.5, upvectorfalloff=0,
                 advectnoise=0),
        ],
        smooth=(1, 1),
        convert=['--margin', '1', '--iso', '0.15'],
    ),
    'fairweather': dict(
        seed=3, spheres=fairweather_spheres, voxel=4.0, base=40.0, basefade=45.0,
        cloud=dict(
            densitymultiplier=2.0, exteriorband=140.0, interiorband=140.0, smoothiterations=1,
            addsecondary=1, secondaryiterations=1, scatterpoints=110, secondaryshapesize=40.0,
            billow=0.0, offset=0.1,
        ),
        noise=[
            dict(noiseamount=1.3, noiseelementsize=140.0, noiseoctaves=3, noiserough=0.5, upvectorfalloff=0,
                 advectnoise=1, advectamp=0.2, advectelemsize=100.0),
            dict(noiseamount=0.8, noiseelementsize=45.0, noiseoctaves=4, noiserough=0.55, upvectorfalloff=0,
                 advectnoise=0),
            dict(noiseamount=0.6, noiseelementsize=28.0, noiseoctaves=3, noiserough=0.6, upvectorfalloff=0, advectnoise=0),
        ],
        smooth=(1, 1),
        convert=['--margin', '1', '--iso', '0.3'],
    ),
}


# ------------------------------------------------------------------------------------------- network building

def set_parms(node, values):
    for k, v in values.items():
        p = node.parm(k)
        if p is not None:
            p.set(v)
            continue
        t = node.parmTuple(k)
        if t is None:
            raise SystemExit(f'{node.type().name()} has no parm {k!r}')
        t.set(v)


def build(name, rcp, out_dir, hip=None):
    rnd = random.Random(rcp['seed'])
    obj = hou.node('/obj')
    geo = obj.node(name) or obj.createNode('geo', name)
    for c in geo.children():
        c.destroy()
    k = rcp.get('scale', 1.0)  # uniform size factor: sphere layout and every length-like parm scale together
    spheres = []
    for sp_ in rcp['spheres'](rnd):
        x, y, z, *r = sp_
        r = (r * 3) if len(r) == 1 else r  # (r) or (rx, ry, rz)
        spheres.append((x * k, y * k, z * k, *(c * k for c in r)))
    rcp = dict(rcp, cloud=dict(rcp['cloud']), noise=[dict(n) for n in rcp['noise']])
    for key in ('exteriorband', 'interiorband', 'secondaryshapesize', 'sourceshapesize'):
        if key in rcp['cloud']:
            rcp['cloud'][key] *= k
    for nz in rcp['noise']:
        for key in ('noiseelementsize', 'advectelemsize'):
            if key in nz:
                nz[key] *= k
    merge = geo.createNode('merge', 'source_spheres')
    for i, (x, y, z, rx, ry, rz) in enumerate(spheres):
        s = geo.createNode('sphere', f'ball{i}')
        s.parm('type').set(2)  # polygon mesh
        s.parm('rows').set(24)
        s.parm('cols').set(24)
        s.parmTuple('rad').set((rx, ry, rz))
        s.parmTuple('t').set((x, y, z))
        merge.setInput(i, s)
    cloud = geo.createNode('cloud', 'cloud')
    cloud.setInput(0, merge)
    cloud.parm('input').set(0)  # polygon model
    cloud.parm('uniformsamples').set(1)  # By Size: voxel size in metres
    cloud.parm('divsize').set(rcp['voxel'])
    cloud.parm('useworldspaceunits').set(1)
    set_parms(cloud, rcp['cloud'])
    prev = cloud
    for i, nz in enumerate(rcp['noise']):
        cn = geo.createNode('cloudnoise', f'cloud_noise_{i + 1}')
        cn.setInput(0, prev)
        set_parms(cn, nz)
        prev = cn
    if rcp.get('smooth'):
        sm = geo.createNode('vdbsmooth', 'smooth')
        sm.setInput(0, prev)
        sm.parm('operation').set('mean')
        sm.parm('iterations').set(rcp['smooth'][0])
        sm.parm('radius').set(rcp['smooth'][1])
        prev = sm
    if rcp.get('base') is not None:
        # flat base: fade density to zero below y = base (metres) over `basefade` metres (Cloud SOP's own Flatten
        # did not give a flat floor on this model, so the artist-style fix is a one-line volume wrangle)
        wr = geo.createNode('volumewrangle', 'flat_base')
        wr.setInput(0, prev)
        wr.parm('snippet').set('@density *= smooth(%g, %g, @P.y);' % (rcp['base'] * k, (rcp['base'] + rcp.get('basefade', 40.0)) * k))
        prev = wr
    prev.setDisplayFlag(True)
    geo.layoutChildren()
    t = time.time()
    prev.cook(force=True)
    for n in geo.children():
        if n.errors():
            raise SystemExit(f'{n.path()} errors: {n.errors()}')
    g = prev.geometry()
    grids = [p for p in g.prims() if isinstance(p, hou.VDB)]
    if not grids:
        raise SystemExit('no VDB produced')
    path = os.path.join(out_dir, f'{name}.vdb')
    g.saveToFile(path)
    if hip:
        hou.hipFile.save(hip)
    print(f'[{name}] cooked in {time.time() - t:.1f}s -> {path}; grids '
          + ', '.join(f"{p.stringAttribValue('name')} vs={p.voxelSize()[0]} active={p.activeVoxelCount()}" for p in grids))
    return path


# ------------------------------------------------------------------------------------------- previews

def write_png(path, rgb):
    h, w, _ = rgb.shape
    raw = b''.join(b'\x00' + rgb[y].tobytes() for y in range(h))

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                           + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


def preview(vdb_path, png_path):
    """Dense density read; left: side view (max over z), middle: centre slice, right: top-down (max over y)."""
    geo = hou.Geometry()
    geo.loadFromFile(vdb_path)
    prim = next(p for p in geo.prims() if isinstance(p, hou.VDB) and p.stringAttribValue('name') == 'density')
    bb = prim.activeVoxelBoundingBox()
    lo = [int(math.floor(c)) for c in bb.minvec()]
    hi = [int(math.ceil(c)) for c in bb.maxvec()]
    n = [hi[i] - lo[i] for i in range(3)]
    flat = np.asarray(prim.voxelRangeAsFloat(hou.BoundingBox(*lo, *hi)), dtype=np.float32).reshape(n[2], n[1], n[0])
    d = np.clip(flat, 0, 1)  # [z, y, x]
    side = d.max(axis=0)[::-1]                 # y down->up flip, x across
    mid = d[n[2] // 2][::-1]
    top = d.max(axis=1)
    panels = [side, mid, top]
    H = max(p.shape[0] for p in panels)
    H *= 2
    out = np.zeros((H, 2 * sum(p.shape[1] for p in panels) + 8, 3), np.uint8)
    x = 0
    for p in panels:
        g = np.kron((255 * p).astype(np.uint8), np.ones((2, 2), np.uint8))
        out[:g.shape[0], x:x + g.shape[1]] = g[..., None]
        x += g.shape[1] + 4
    write_png(png_path, out)
    vs = prim.voxelSize()[0]
    stats = dict(extentMetres=[round(n[0] * vs), round(n[1] * vs), round(n[2] * vs)], activeVoxels=int(prim.activeVoxelCount()),
                 densityMax=float(d.max()), density_p50_nonzero=float(np.percentile(d[d > 0.01], 50)) if (d > 0.01).any() else 0)
    print('[preview]', png_path, json.dumps(stats))
    return stats


# ------------------------------------------------------------------------------------------- conversion

def convert(name, vdb_path, rcp, assets_dir):
    out = os.path.join(assets_dir, name)
    hython = os.path.join(os.environ.get('HFS', hou.text.expandString('$HFS')), 'bin', 'hython')
    cmd = [hython, CONVERTER, '--mode', 'fog', vdb_path, '--out', out, '--voxel-size', '8', '--name', name] + rcp.get('convert', [])
    print('[convert]', ' '.join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(r.stdout[-1500:])
    if r.returncode:
        sys.stderr.write(r.stderr)
        raise SystemExit(f'converter failed for {name}')
    size = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out))
    print(f'[{name}] {out}: {size / 1048576:.2f} MiB')
    return size


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('names', nargs='*', default=list(RECIPES), help='tower valley-fog fairweather (default all)')
    ap.add_argument('--work-dir', default=os.path.join(REPO, 'work', 'captures', 'scratch', 'p4e'), help='where VDBs and previews go')
    ap.add_argument('--assets-dir', default=os.path.join(REPO, 'assets', 'clouds', 'heroes'))
    ap.add_argument('--voxel', type=float, help='override the authoring voxel size (m); 8 = fast preview')
    ap.add_argument('--set', action='append', default=[], metavar='SECTION.PARM=VALUE',
                    help='override a recipe value, e.g. cloud.densitymultiplier=6 or noise0.noiseamount=0.8 (noise0 = first pass)')
    ap.add_argument('--tag', default='', help='suffix for the output file names (experiments)')
    ap.add_argument('--no-convert', action='store_true')
    ap.add_argument('--hip', help='save the Houdini network of the last cloud to this .hip')
    a = ap.parse_args()
    os.makedirs(a.work_dir, exist_ok=True)
    for nm_ in a.names:
        rcp = dict(RECIPES[nm_])
        if a.voxel:
            rcp['voxel'] = a.voxel
        rcp['cloud'] = dict(rcp['cloud'])
        rcp['noise'] = [dict(n) for n in rcp['noise']]
        for item in a.set:
            key, val = item.split('=')
            sec, parm = key.split('.')
            val = float(val)
            if sec == 'cloud':
                rcp['cloud'][parm] = val
            elif sec.startswith('noise'):
                rcp['noise'][int(sec[5:])][parm] = val
        vdb = build(nm_ + a.tag, rcp, a.work_dir, a.hip)
        preview(vdb, os.path.join(a.work_dir, f'{nm_}{a.tag}.png'))
        if not a.no_convert:
            convert(nm_, vdb, rcp, a.assets_dir)  # --tag is for experiments with --no-convert


if __name__ == '__main__':
    main()
