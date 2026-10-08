#!/usr/bin/env python3
"""Build a cloud-like fog VDB in Houdini (hython) for exercising `vdb_to_nvdf.py --mode fog`.

  hython scripts/vdb/make_test_cloud.py OUT.vdb [--seed 7] [--voxel 4] [--width 1500]

SOP network built by this script (all nodes live under /obj/make_test_cloud):
  python (sphere cluster points, pscale)  ->  vdbfromparticles (fog volume 'density', soft shoulder)
  ->  volumewrangle (fbm noise displaces the iso-surface, flat-ish base, height-varying density)
  ->  rop_geometry-equivalent saveToFile (.vdb)
The cluster is about `width` metres wide and 400-500 m tall, voxel size 4 m, 1 Houdini unit = 1 m.
"""
import argparse
import math
import random
import sys

import hou

PY_SOP = '''
import hou, math, random
geo = hou.pwd().geometry()
rnd = random.Random({seed})
geo.addAttrib(hou.attribType.Point, "pscale", 1.0)
W = {width}
spheres = []
# a big anvil-ish core plus satellites; y is up, base near y = 0
for i in range({count}):
    r = rnd.random()
    ang = rnd.random() * math.tau
    dist = (r ** 0.7) * W * 0.5
    x, z = math.cos(ang) * dist, math.sin(ang) * dist * 0.7
    falloff = 1.0 - dist / (W * 0.5)
    rad = 60 + 150 * falloff * (0.5 + rnd.random())
    y = 40 + rad * 0.6 + rnd.random() * 90 * falloff
    spheres.append((x, y, z, rad))
for x, y, z, rad in spheres:
    pt = geo.createPoint()
    pt.setPosition((x, y, z))
    pt.setAttribValue("pscale", rad)
'''

VEX = '''
vector p = @P;
float f = @FREQ@;
float n = 0, a = 0.5;
vector q = p * f + @SEED@ * 13.37;
for (int i = 0; i < 5; i++) { n += a * (noise(q) - 0.5); q = q * 2.03 + 11.1; a *= 0.5; }
float h = clamp((p.y - 0) / 450.0, 0, 1);
float base = smooth(-20.0, 90.0, p.y);                 // flatter, denser base, soft cut below
float d = @density;
d = d + n * @AMP@ * (0.35 + 0.65 * smooth(0.0, 0.4, d));  // noise moves the iso-surface (billows + wisps)
d *= base;
float core = smooth(0.35, 1.0, d);
@density = clamp(fit(d, 0.0, 1.0, 0.0, 1.0) * (0.65 + 0.35 * core), 0, 1);
'''


def build(out, seed, voxel, width, count, amp, freq, sdf_out=None):
    obj = hou.node('/obj')
    geo = obj.createNode('geo', 'make_test_cloud')
    for c in geo.children():
        c.destroy()
    py = geo.createNode('python', 'sphere_cluster')
    py.parm('python').set(PY_SOP.format(seed=seed, width=width, count=count))
    vfp = geo.createNode('vdbfromparticles', 'to_fog')
    vfp.setInput(0, py)
    vfp.parm('voxelsize').set(voxel)
    vfp.parm('builddistance').set(0)
    vfp.parm('buildfog').set(1)
    vfp.parm('fogname').set('density')
    vfp.parm('radiusscale').set(1.0)
    vfp.parm('useworldspaceunits').set(1)
    vfp.parm('bandwidth').set(110.0)          # world units: soft shoulder so noise has a gradient to bite into
    vw = geo.createNode('volumewrangle', 'noise_displace')
    vw.setInput(0, vfp)
    vw.parm('snippet').set(VEX.replace('@FREQ@', repr(float(freq))).replace('@SEED@', repr(float(seed))).replace('@AMP@', repr(float(amp))))
    vw.setDisplayFlag(True)
    vw.cook(force=True)
    g = vw.geometry()
    n = sum(1 for p in g.prims() if isinstance(p, hou.VDB))
    if n == 0:
        raise SystemExit('network produced no VDB')
    g.saveToFile(out)
    if sdf_out:
        # mode-3 fixture: the same sphere cluster as a level set (what an artist gets from a mesh -> VDB from Polygons)
        sd = geo.createNode('vdbfromparticles', 'to_sdf')
        sd.setInput(0, py)
        sd.parm('voxelsize').set(voxel)
        sd.parm('builddistance').set(1)
        sd.parm('buildfog').set(0)
        sd.parm('distancename').set('surface')
        sd.parm('useworldspaceunits').set(1)
        sd.parm('bandwidth').set(160.0)
        sd.cook(force=True)
        sd.geometry().saveToFile(sdf_out)
        print('wrote level set', sdf_out)
    for p in g.prims():
        if isinstance(p, hou.VDB):
            print('wrote grid', p.stringAttribValue('name'), 'voxel', p.voxelSize(), 'active', p.activeVoxelCount(), 'bbox', p.activeVoxelBoundingBox())
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--voxel', type=float, default=4.0, help='VDB voxel size (m)')
    ap.add_argument('--width', type=float, default=1500.0)
    ap.add_argument('--count', type=int, default=34, help='sphere count')
    ap.add_argument('--amp', type=float, default=1.1, help='noise amplitude')
    ap.add_argument('--freq', type=float, default=1 / 140.0, help='base noise frequency (1/m)')
    ap.add_argument('--sdf-out', help='also write the sphere cluster as a level-set VDB (mode 3 fixture)')
    a = ap.parse_args()
    build(a.out, a.seed, a.voxel, a.width, a.count, a.amp, a.freq, a.sdf_out)
