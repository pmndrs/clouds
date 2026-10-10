#!/usr/bin/env python3
"""Build the owner's Frog cloud (docs/research/targets/frog.md) with Houdini 21's cloud-shape nodes (task A3, AU1/SD5).

  HYTHON=/Applications/Houdini/Houdini21.0.671/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython
  $HYTHON scripts/vdb/authoring/frog.py                    # build, write VDB, silhouette preview, convert
  $HYTHON scripts/vdb/authoring/frog.py --no-convert       # VDB + preview only (fast loop on the silhouette)
  $HYTHON scripts/vdb/authoring/frog.py --hip              # also save houdini/rigs/frog.hip (network only, no caches)

Outputs (local, not committed): artifacts/scratch/A3/ (frog.vdb, spheres.npz, preview_*.png, report.json) and the runtime files in
assets/clouds/local/frog/ (gitignored), which examples/lab/frog/ renders from the camera that matches the photo.

How the cloud is made (all metres, y up; the camera of the photo sits at the origin looking along -z, pitched up):
  1. layout     Each body is anchored on the photo: its column span (pano_1600 px), its distance from the camera and its base height.
                frog.md section 1-2 + the owner's FrogFace.png: two upper domes with a notch (the eyes), a wide lower body whose
                shaded underside is the long smooth belly (the mouth), a right terrace, lit chin lobes hanging below the left half,
                satellite 1 behind, satellite 2 further behind (not attached), two small fragments.
  2. rung 1     `cloudshapegenerate` per body (species, flat bottom) or `cloudshapefromline` (terrace, ragged satellite) -> a
                `fit_*` wrangle that fits the sphere set into the body's box.  Spheres ~250-300 m radius.
  3. rung 2     `cloudshapereplicate` on the surface of rung 1, radius r2 = r1 / 3.5 (~80 m); children that face down on smooth
                bodies (the belly) or that are buried inside rung 1 are deleted.
  4. rung 3     `cloudshapereplicate` again, r3 = r2 / 3.5 (~23 m), only on up/sun-facing rung-2 lobes (texture on the top fifth
                and lit rims; the lower 60 % stays smooth, frog.md section 1).  Nothing finer: the runtime up-rez adds ~15 m and ~4 m.
  5. volume     `vdbfromparticles` (SDF + fog + per-body attributes) -> `cloudclip` flat base on the main body only (mask), with a
                fade band that becomes the dissolving belly skirt (F6).
  6. fields     detail type and density scale from the surface normal (gradient of the blurred fog) and the sun direction:
                crisp (billowy, scale 1) on up/sun faces, soft (wispy, lower scale) on undersides and the skirt; satellites carry a
                lower per-body density scale (F7).  Written as VDB grids `detail_type` / `density_scale` and passed to
                scripts/vdb/vdb_to_nvdf.py --detail-grid/--scale-grid (no converter change needed).

Edit the RECIPE dict (or, in the saved rig, the CONTROLS null and the per-body nodes) and rerun.
"""
import argparse
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import time
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
CONVERTER = os.path.join(REPO, 'scripts', 'vdb', 'vdb_to_nvdf.py')
MAIN_CHECKOUT = os.path.abspath(os.path.join(REPO, '..', '..', '..')) if '.claude/worktrees' in REPO else REPO
WORK = os.path.join(MAIN_CHECKOUT, 'artifacts', 'scratch', 'A3')
REF_MASK = os.path.join(WORK, 'ref', 'pano_mask.npy')        # B-R < 60 mask of pano_1600.jpg (made once from the local photo)
ASSET_OUT = os.path.join(REPO, 'assets', 'clouds', 'local', 'frog')
RIG = os.path.join(REPO, 'houdini', 'rigs', 'frog.hip')

# ------------------------------------------------------------------------------------------------------------------- recipe
# Camera of the photo (pano_1600.jpg, 1600 x 1392): 0.0304 deg/px (frog.md section 0), pinhole f = 1800 px, bottom edge at ~2 deg
# elevation -> pitch 23.1 deg, vertical FOV 2 atan(696/1800) = 42.3 deg.  The lab page uses exactly these numbers.
CAMERA = dict(width=1600, height=1392, f=1800.0, pitch=23.1)

# Bodies.  u = (left, right) column span on pano_1600; r = horizontal distance of the body centre from the camera (m); base = base
# height (m); height/depth = box size (m).  kind 'generate' -> cloudshapegenerate (species 0 humilis, 1 mediocris, 2 congestus,
# length/width = its proportions, psep = its point separation, i.e. rung-1 sphere size relative to the body);
# kind 'line' -> cloudshapefromline along `line` = [(u, y), ...] at distance r, psep in metres.
# stream: which flat base clips it ('main' = the 1500 m plane).  bscale: per-body density scale (F7).  smooth_under: no rung 2/3 on
# down-facing lobes (the smooth belly).  rung3: allow rung-3 lobes on its up-facing rung-2 lobes.
# Distances: the main body is where the photo puts it at base 1.5 km (far base edge 4.3 km); the satellites are pulled closer along
# their camera rays (forced perspective) so one 8 m volume holds everything: same image, smaller volume.  See the A3 report.
BASE = 1500.0
BODIES = [
    # lower: the wide body. Its spheres hang below the base plane and cloudclip cuts them flat, so the flat underside reaches the near
    # edge (r ~2.9 km): seen from below at 20-27 deg it is the long smooth shaded belly (the mouth).  flatten=0 on purpose.
    dict(name='lower', kind='generate', species=0, length=2.0, width=1.0, psep=0.26, seed=3, flatten=0,
         u=(255, 1120), r=3750, base=1250, height=560, depth=2050, stream='main', bscale=1.0, smooth_under=1, rung3=1),
    dict(name='left_low', kind='generate', species=0, length=1.0, width=1.0, psep=0.35, seed=5,
         u=(250, 700), r=4000, base=1180, height=620, depth=1000, stream='free', bscale=1.0, smooth_under=1, rung3=1),
    dict(name='eye_left', kind='generate', species=1, length=1.4, width=1.0, psep=0.3, seed=11,
         u=(310, 615), r=3450, base=1600, top_v=200, depth=1250, stream='main', bscale=1.0, smooth_under=1, rung3=1),
    dict(name='eye_right', kind='generate', species=0, length=1.0, width=1.0, psep=0.3, seed=7,
         u=(645, 960), r=3550, base=1650, top_v=40, depth=1300, stream='main', bscale=1.0, smooth_under=1, rung3=1),
    # shelf: the right part of the body under the terrace, lower than the head (its near top must stay below row ~470)
    dict(name='shelf', kind='generate', species=0, length=1.3, width=1.0, psep=0.3, seed=41, flatten=0,
         u=(1000, 1270), r=3700, base=1300, height=560, depth=1400, stream='main', bscale=1.0, smooth_under=1, rung3=1),
    dict(name='terrace', kind='line', psep=80.0, seed=2,
         line=[(1080, 1950), (1200, 1920), (1290, 1700)], r=3900, base=BASE, depth=500, stream='main', bscale=1.0, smooth_under=1, rung3=1),
    dict(name='chin', kind='generate', species=0, length=1.4, width=1.0, psep=0.35, seed=13,
         u=(418, 725), r=5000, base=1200, height=520, depth=650, stream='free', bscale=0.95, smooth_under=0, rung3=1),
    dict(name='sat1', kind='generate', species=0, length=1.6, width=1.0, psep=0.32, seed=17,
         u=(840, 1200), r=5600, base=1100, top_v=805, depth=900, stream='free', bscale=0.9, smooth_under=1, rung3=1),
    dict(name='sat1_tail', kind='generate', species=0, length=1.3, width=1.0, psep=0.4, seed=37,
         u=(700, 830), r=5600, base=1320, height=260, depth=400, stream='free', bscale=0.85, smooth_under=1, rung3=1),
    dict(name='sat1_ragged', kind='line', psep=85.0, seed=4,
         line=[(1160, 1820), (1270, 1950), (1400, 1800)], r=5600, base=1380, depth=650, stream='free', bscale=0.72, smooth_under=0, rung3=1),
    dict(name='sat2', kind='generate', species=1, length=1.0, width=1.0, psep=0.35, seed=19,
         u=(1020, 1375), r=6000, base=80, height=1520, depth=1000, stream='free', bscale=0.9, smooth_under=1, rung3=1),
    dict(name='sat2_cap', kind='generate', species=0, length=1.0, width=1.0, psep=0.48, seed=23,
         u=(1150, 1250), r=5900, base=1250, height=220, depth=280, stream='free', bscale=0.75, smooth_under=0, rung3=0),
    dict(name='frag_a', kind='generate', species=0, length=1.0, width=1.0, psep=0.5, seed=29,
         u=(885, 940), r=6000, base=370, height=85, depth=170, stream='free', bscale=0.7, smooth_under=0, rung3=0, noshrink=1),
    dict(name='frag_b', kind='generate', species=0, length=1.0, width=1.0, psep=0.5, seed=31,
         u=(955, 1020), r=6000, base=350, height=80, depth=180, stream='free', bscale=0.7, smooth_under=0, rung3=0, noshrink=1),
]

# CONTROLS (the rig's edit panel). (folder, name, label, value, min, max)
CONTROLS = [
    ('Lobes', 'r2', 'Rung 2 lobe radius (m)', 80.0, 20.0, 300.0),
    ('Lobes', 'r3', 'Rung 3 lobe radius (m)', 23.0, 5.0, 100.0),
    ('Lobes', 'r2_under', 'Rung 2: delete if N.y below (smooth bodies)', -0.25, -1.0, 1.0),
    ('Lobes', 'r3_minup', 'Rung 3: only on lobes with N.y above', 0.05, -1.0, 1.0),
    ('Lobes', 'r3_minsun', '... or facing the sun above', 0.55, -1.0, 1.0),
    ('Lobes', 'bury', 'Delete lobes buried deeper than x radius', 0.55, 0.0, 2.0),
    ('Lobes', 'shrink', 'Fit rung 1 this much inside each body box (m)', 100.0, 0.0, 400.0),
    ('Lobes', 'jitter', 'Child position jitter (x parent radius)', 0.12, 0.0, 1.0),
    ('Lobes', 'expose', 'Seed children only from lobes buried less than x radius', 0.15, 0.0, 2.0),
    ('Lobes', 'sparse', 'Child spacing / child radius (fewer lobes when > 1)', 1.6, 0.5, 3.0),
    ('Lobes', 'r3frac', 'Share of eligible rung-2 lobes that get rung 3', 0.6, 0.0, 1.0),
    ('Lobes', 'dirscale', 'Rung 2: up-facing size boost (dirscalemax)', 1.35, 1.0, 3.0),
    ('Volume', 'voxel', 'Voxel size (m)', 8.0, 2.0, 32.0),
    ('Volume', 'base', 'Main flat base height (m)', BASE, 0.0, 5000.0),
    ('Volume', 'skirt', 'Belly skirt fade above the base (m)', 45.0, 0.0, 300.0),
    ('Fields', 'sunx', 'Sun direction x', 0.0, -1.0, 1.0),
    ('Fields', 'suny', 'Sun direction y', 0.755, -1.0, 1.0),
    ('Fields', 'sunz', 'Sun direction z', 0.656, -1.0, 1.0),
    ('Fields', 'sun_weight', 'Sun-facing weight in the facing term', 0.5, 0.0, 2.0),
    ('Fields', 'type_lo', 'Facing at which type is fully wispy', -0.45, -2.0, 2.0),
    ('Fields', 'type_hi', 'Facing at which type is fully billowy', 0.35, -2.0, 2.0),
    ('Fields', 'type_under', 'Detail type on undersides', 0.12, 0.0, 1.0),
    ('Fields', 'type_top', 'Detail type on up/sun faces', 1.0, 0.0, 1.0),
    ('Fields', 'type_core', 'Detail type deep inside', 0.6, 0.0, 1.0),
    ('Fields', 'scale_under', 'Density scale on undersides', 0.86, 0.0, 1.0),
    ('Fields', 'scale_skirt', 'Density scale at the base plane', 0.5, 0.0, 1.0),
    ('Fields', 'blur', 'Normal blur radius (voxels)', 3, 1, 8),
]


def ctl_defaults():
    return {c[1]: c[3] for c in CONTROLS}


# ------------------------------------------------------------------------------------------------------------------- camera

def cam_basis(cam=CAMERA):
    p = math.radians(cam['pitch'])
    fwd = np.array([0.0, math.sin(p), -math.cos(p)])
    up = np.array([0.0, math.cos(p), math.sin(p)])
    right = np.array([1.0, 0.0, 0.0])
    return right, up, fwd


def x_at(u, r, y, cam=CAMERA):
    """World x of a point at horizontal distance r (z = -r) and height y that lands on column u."""
    _, _, fwd = cam_basis(cam)
    dcam = y * fwd[1] + r * (-fwd[2])
    return (u - cam['width'] / 2) * dcam / cam['f']


def y_at(v, r, cam=CAMERA):
    """World height of the point at distance r that lands on row v (the elevation of row v)."""
    k = (cam['height'] / 2 - v) / cam['f']
    return r * math.tan(math.radians(cam['pitch']) + math.atan(k))


def project(P, cam=CAMERA):
    """World points (N,3) -> (u, v, depth along the view axis)."""
    right, up, fwd = cam_basis(cam)
    d = P @ fwd
    u = cam['width'] / 2 + cam['f'] * (P @ right) / d
    v = cam['height'] / 2 - cam['f'] * (P @ up) / d
    return u, v, d


def body_box(b):
    """Target box of a 'generate' body: centre x, base y, size (x, y, z), centre z.  `top_v` (a photo row) instead of `height`
    puts the top of the box, at the body's centre distance, on that row."""
    if 'top_v' in b:
        b = dict(b, height=y_at(b['top_v'], b['r']) - b['base'])
    ymid = b['base'] + b['height'] / 2
    x0, x1 = x_at(b['u'][0], b['r'], ymid), x_at(b['u'][1], b['r'], ymid)
    return dict(cx=(x0 + x1) / 2, base=b['base'], sx=x1 - x0, sy=b['height'], sz=b['depth'], cz=-b['r'], noshrink=b.get('noshrink', 0))


# ------------------------------------------------------------------------------------------------------------------- network

FIT_VEX = r'''// Fit the generated sphere set into this body's box (spare parms), keeping the base flat: positions scale per axis,
// radii by the geometric mean.  Tags every sphere with its body name, stream and art flags.
vector lo = {1e9, 1e9, 1e9}, hi = {-1e9, -1e9, -1e9};
for (int i = 0; i < npoints(0); i++) {
    vector p = point(0, "P", i); float r = point(0, "pscale", i);
    lo = min(lo, p - r); hi = max(hi, p + r);
}
vector sz = hi - lo;
// lobes of rungs 2-3 grow the silhouette by about `shrink` metres: fit rung 1 into the box minus that (sides and top, not the base)
float sh = ch("../CONTROLS/shrink") * (1 - chi("noshrink"));
vector want = max(chv("size") - set(2 * sh, sh, 2 * sh), chv("size") * 0.3);
vector s = want / max(sz, {1e-6, 1e-6, 1e-6});
float sr = pow(s.x * s.y * s.z, 1.0 / 3.0);
for (int i = 0; i < npoints(0); i++) {
    vector p = point(0, "P", i);
    float pr = point(0, "pscale", i);
    vector q = (p - set((lo.x + hi.x) / 2, lo.y, (lo.z + hi.z) / 2)) * s + set(chf("cx"), chf("base"), chf("cz"));
    setpointattrib(0, "P", i, q);
    setpointattrib(0, "pscale", i, pr * sr);
}
// the sphere primitives carry their own radius (cloudshapereplicate reads it): make it match pscale
// (writes are deferred, so point() still returns the unscaled radius here)
for (int k = 0; k < nprimitives(0); k++) {
    int pt = primpoint(0, k, 0);
    float rr = point(0, "pscale", pt) * sr;
    matrix3 m = ident();
    m *= rr;
    setprimintrinsic(0, "transform", k, m);
}
'''

TAG_VEX = r'''s@body = chs("body");
s@stream = chs("stream");
f@bscale = chf("bscale");
i@smooth_under = chi("smooth_under");
i@rung3ok = chi("rung3");
i@rung = 1;
f@ismain = s@stream == "main" ? 1.0 : 0.0;
'''

# cloudshapereplicate's surface scatter is not scale-invariant: its point count goes as 1/scale, so at metre scale it makes
# ~1000x too few lobes (measured: 40k points at unit scale, 40 at x1000 with the same relative pointsep). Its interior scatter is
# scale-invariant but buries most points.  At unit scale (parent spheres ~0.5 units) the count matches the parent's surface area /
# pointsep^2, so each replicate runs on a copy scaled so its parents are ~0.5 units (to_unit_* / to_m_* wrangles).
RESCALE_VEX = r'''// scale positions, pscale and the sphere primitives' own radius by k (detail pass)
float k = chf("k");
for (int i = 0; i < npoints(0); i++) {
    vector p = point(0, "P", i);
    float r = point(0, "pscale", i);
    setpointattrib(0, "P", i, p * k);
    setpointattrib(0, "pscale", i, r * k);
}
for (int j = 0; j < nprimitives(0); j++) {
    int pt = primpoint(0, j, 0);
    float r = point(0, "pscale", pt);
    matrix3 m = ident();
    m *= r * k;
    setprimintrinsic(0, "transform", j, m);
}
'''

EXPOSE_VEX = r'''// a lobe only seeds smaller lobes if its sphere reaches the surface of the union (input 1 = SDF of the union): the union's SDF at
// a sphere's centre is -radius when the sphere touches the surface and lower when it is buried
i@exposed = volumesample(1, "surface", @P) > -(1 + ch("../CONTROLS/expose")) * f@pscale;
// a parent must be clearly bigger than its children (fragments and caps get no rung 2)
i@r2src = i@exposed && f@pscale > 1.8 * ch("../CONTROLS/r2");
'''

CULL2_VEX = r'''// Rung 2: drop lobes on down-facing parts of smooth bodies (the belly stays smooth) and lobes buried inside rung 1.
i@rung = 2;
float d = volumesample(1, "surface", @P);
if (d < -ch("../CONTROLS/bury") * f@pscale) removepoint(0, @ptnum);
if (i@smooth_under && v@N.y < ch("../CONTROLS/r2_under")) removepoint(0, @ptnum);
vector sun = normalize(set(ch("../CONTROLS/sunx"), ch("../CONTROLS/suny"), ch("../CONTROLS/sunz")));
i@r3src = i@rung3ok && (v@N.y > ch("../CONTROLS/r3_minup") || dot(v@N, sun) > ch("../CONTROLS/r3_minsun"));
i@r3src = i@r3src && rand(@ptnum * 7.31 + 0.5) < ch("../CONTROLS/r3frac");
'''

CULL3_VEX = r'''// Rung 3: keep only lobes that reach the surface of the rung 1+2 union.
i@rung = 3;
i@r3src = 0;
float d = volumesample(1, "surface", @P);
if (d < -ch("../CONTROLS/bury") * f@pscale) removepoint(0, @ptnum);
if (i@smooth_under && v@N.y < ch("../CONTROLS/r2_under")) removepoint(0, @ptnum);
'''

FIELDS_VEX = r'''// Detail type and density scale from the surface normal (SD3/SD5).  n = outward normal = -grad(blurred density).
// facing = n.y + w * dot(n, sun): up/sun faces -> billowy, crisp (scale 1); undersides -> wispy, softer; the skirt band above the
// main base fades the scale (dissolving belly, F6); bscale = per-body density scale (satellites fray more, F7).
vector g = volumesamplev(1, "gradient", @P);
float gl = length(g);
vector n = gl > 1e-6 ? -g / gl : set(0, 1, 0);
float conf = smooth(0.0, 0.004, gl);
vector sun = normalize(set(ch("../CONTROLS/sunx"), ch("../CONTROLS/suny"), ch("../CONTROLS/sunz")));
float facing = n.y + ch("../CONTROLS/sun_weight") * dot(n, sun);
float t = smooth(ch("../CONTROLS/type_lo"), ch("../CONTROLS/type_hi"), facing);
float ty = lerp(ch("../CONTROLS/type_under"), ch("../CONTROLS/type_top"), t);
ty = lerp(ch("../CONTROLS/type_core"), ty, conf);
float sc = lerp(ch("../CONTROLS/scale_under"), 1.0, t);
sc = lerp(1.0, sc, conf);
float bs = volumesample(2, "bscale", @P);
if (bs <= 0) bs = 1.0;
float ism = volumesample(2, "ismain", @P);
float h = @P.y - ch("../CONTROLS/base");
float sk = lerp(ch("../CONTROLS/scale_skirt"), 1.0, smooth(0.0, max(ch("../CONTROLS/skirt"), 1e-3), h));
sk = lerp(1.0, sk, clamp(ism, 0, 1));
ty = lerp(ty, min(ty, ch("../CONTROLS/type_under")), (1 - smooth(0.0, max(ch("../CONTROLS/skirt"), 1e-3), h)) * clamp(ism, 0, 1));
@detail_type = clamp(ty, 0, 1);
@density_scale = clamp(sc * sk * bs, 0, 1);
'''

NOTES = dict(
    controls=("EDIT HERE. Lobe ladder (rung 2/3 radii, 3.5x steps), which lobes survive, voxel size, the main flat base, and the "
              "type/scale-from-normal mapping are channel-referenced from here. Body positions and sizes are on each fit_* node "
              "(cx/cz/base/size, metres; the camera of the photo is at the origin looking along -z, pitched up 23.1 deg). "
              "Render `export`, then 'Run converter'. Source of truth: RECIPE in scripts/vdb/authoring/frog.py."),
    layout=("Rung 1 (bodies, ~250-300 m spheres). One cloudshapegenerate per body (species: humilis/mediocris/congestus, flat bottom) or "
            "cloudshapefromline (terrace row of lumps, satellite 1's ragged right mass), fitted into a box placed from the photo: "
            "eye_left + eye_right = the frog's two domes with the notch between them (FrogFace.png), lower = wide flat-based body whose "
            "shaded underside is the smooth belly / mouth, terrace = right shelf at about half height, left_low + chin = lit lobes "
            "hanging below the left half (F10), sat1/sat1_ragged/sat2/sat2_cap/frag_* = the receding satellite trail (frog.md 2). "
            "Satellites are pulled toward the camera along their rays (forced perspective) to keep one 8 m volume."),
    rung2=("Rung 2 (~80 m lobes = rung 1 / 3.5). cloudshapereplicate scatters on the surface of rung 1 with an up-direction size boost "
           "(bigger lobes on top). cull2 deletes lobes buried in rung 1 (sdf_r1) and down-facing lobes on smooth bodies, so the belly "
           "has no structure below ~300 m (frog.md 1: lower 60% smooth)."),
    rung3=("Rung 3 (~23 m lobes = rung 2 / 3.5). Only on up- or sun-facing rung-2 lobes: texture lives on the top fifth and the lit rims "
           "(F1, F3). Nothing finer is baked: the runtime up-rez adds the ~15 m and ~4 m levels (SD5)."),
    volume=("vdbfromparticles -> SDF `surface`, fog `density` and the per-body attributes as grids (bscale, ismain). cloudclip cuts a flat "
            "base at CONTROLS/base (turn on its Noise Displacement for a ragged cut); flat_base_main_only keeps that cut only where "
            "ismain = 1 (cloudclip's own mask did not restrict it). The skirt fade is computed in the fields wrangle."),
    fields=("Detail type (0 wispy..1 billowy) and density scale from the normal of the blurred fog and the sun direction: crisp, billowy "
            "lit tops; wispy, thinner undersides and a fading skirt at the base (F5, F6); satellites carry a lower density scale so "
            "the same erosion frays them (F7). These two grids go to the converter (--detail-grid detail_type --scale-grid density_scale)."),
)


def build(ctl_vals=None, bodies=None):
    """Create /obj/frog and return (geo node, dict of key nodes)."""
    import hou
    vals = ctl_defaults()
    vals.update(ctl_vals or {})
    bodies = bodies or BODIES
    obj = hou.node('/obj')
    old = obj.node('frog')
    if old:
        old.destroy()
    geo = obj.createNode('geo', 'frog')
    ctl = add_controls(geo, vals)
    nodes = dict(controls=ctl)
    layout_nodes, tagged = [], []
    for b in bodies:
        if b['kind'] == 'generate':
            box = body_box(b)
            add = geo.createNode('add', 'pt_' + b['name'])
            add.parm('points').set(1)
            add.parm('usept0').set(1)
            g = geo.createNode('cloudshapegenerate', 'shape_' + b['name'])
            g.setInput(0, add)
            g.parm('cuspecies').set(b['species'])
            g.parm('length').set(b['length'])
            g.parm('width').set(b['width'])
            g.parm('pointsep').set(b['psep'])
            g.parm('pointsep_seed').set(b['seed'])
            g.parm('seed').set(b['seed'])
            g.parm('length_seed').set(b['seed'])
            g.parm('shapedistort_seed').set(b['seed'])
            g.parm('scattersecshapes').set(0)      # rungs 2-3 come from cloudshapereplicate with an explicit 3.5x ladder
            g.parm('doflatten').set(b.get('flatten', 1))
            fit = geo.createNode('attribwrangle', 'fit_' + b['name'])
            fit.setInput(0, g)
            fit.parm('class').set(0)  # detail: one pass over the set
            add_fit_parms(fit, box)
            fit.parm('snippet').set(FIT_VEX)
            first, last = add, fit
            layout_nodes += [add, g, fit]
        else:
            pts = [(x_at(u, b['r'], y), y, -b['r']) for u, y in b['line']]
            ln = geo.createNode('add', 'curve_' + b['name'])
            ln.parm('points').set(len(pts))
            for i, p in enumerate(pts):
                ln.parm('usept%d' % i).set(1)
                ln.parmTuple('pt%d' % i).set(p)
            ln.parm('prims').set(1)
            ln.parm('prim0').set(' '.join(str(i) for i in range(len(pts))))
            ln.parm('closed0').set(0)
            rs = geo.createNode('resample', 'resample_' + b['name'])
            rs.setInput(0, ln)
            rs.parm('length').set(20.0)
            fl = geo.createNode('cloudshapefromline', 'shape_' + b['name'])
            fl.setInput(0, rs)
            fl.parm('pointsep').set(b['psep'])
            fl.parm('seed').set(b['seed'])
            fl.parm('densityscale').set(1.6)
            fl.parm('flatten').set(1)
            fl.parm('flattenoriginy').set(b['base'])
            last = fl
            layout_nodes += [ln, rs, fl]
        tag = geo.createNode('attribwrangle', 'tag_' + b['name'])
        tag.setInput(0, last)
        add_tag_parms(tag, b)
        tag.parm('snippet').set(TAG_VEX)
        layout_nodes.append(tag)
        tagged.append(tag)
    m1 = geo.createNode('merge', 'rung1')
    for i, t in enumerate(tagged):
        m1.setInput(i, t)
    layout_nodes.append(m1)

    # SDF of rung 1 for burial tests (coarse)
    s1 = geo.createNode('vdbfromparticles', 'sdf_r1')
    s1.setInput(0, m1)
    s1.parm('voxelsize').set(16.0)
    s1.parm('bandwidthvoxels').set(40)     # the band must reach the centre of the biggest spheres (exposure test)
    ex1 = geo.createNode('attribwrangle', 'exposed_r1')
    ex1.setInput(0, m1)
    ex1.setInput(1, s1)
    ex1.parm('snippet').set(EXPOSE_VEX)
    seeds2 = keep_points(geo, 'seeds_r2', ex1, '@r2src=1')
    km1 = rescale(geo, 'to_unit_r2', seeds2, '0.5 / (3.5 * ch("../CONTROLS/r2"))')
    rep2 = geo.createNode('cloudshapereplicate', 'rung2_replicate')
    rep2.setInput(0, km1)
    rep2.parm('surfacescatter').set(1)
    expr(rep2.parm('pointsep'), 'ch("../CONTROLS/r2") * ch("../CONTROLS/sparse") * ch("../to_unit_r2/k")')
    expr(rep2.parm('particlescale'), '1 / ch("../CONTROLS/sparse")')
    expr(rep2.parm('pjitterscale'), 'ch("../CONTROLS/jitter")')
    rep2.parm('dodirscale').set(1)
    rep2.parm('dirscalemin').set(1.0)
    expr(rep2.parm('dirscalemax'), 'ch("../CONTROLS/dirscale")')
    rep2.parm('donoisescale').set(1)
    rep2.parm('scalemin').set(0.65)
    rep2.parm('scalemax').set(1.35)
    rep2.parm('elementsize').set(1.0)
    m_r2 = rescale(geo, 'to_m_r2', rep2, '1 / ch("../to_unit_r2/k")')
    c2 = geo.createNode('attribwrangle', 'cull2')
    c2.setInput(0, m_r2)
    c2.setInput(1, s1)
    c2.parm('snippet').set(CULL2_VEX)
    m12 = geo.createNode('merge', 'rung12')
    m12.setInput(0, m1)
    m12.setInput(1, c2)
    s12 = geo.createNode('vdbfromparticles', 'sdf_r12')
    s12.setInput(0, m12)
    expr(s12.parm('voxelsize'), 'ch("../CONTROLS/voxel")')
    s12.parm('bandwidthvoxels').set(18)
    ex2 = geo.createNode('attribwrangle', 'exposed_r2')
    ex2.setInput(0, c2)
    ex2.setInput(1, s12)
    ex2.parm('snippet').set(EXPOSE_VEX + 'i@r3src = i@r3src && i@exposed;\n')
    seeds3 = keep_points(geo, 'seeds_r3', ex2, '@r3src=1')
    km2 = rescale(geo, 'to_unit_r3', seeds3, '0.5 / (3.5 * ch("../CONTROLS/r3"))')
    rep3 = geo.createNode('cloudshapereplicate', 'rung3_replicate')
    rep3.setInput(0, km2)
    rep3.parm('surfacescatter').set(1)
    expr(rep3.parm('pointsep'), 'ch("../CONTROLS/r3") * ch("../CONTROLS/sparse") * ch("../to_unit_r3/k")')
    expr(rep3.parm('particlescale'), '1 / ch("../CONTROLS/sparse")')
    expr(rep3.parm('pjitterscale'), 'ch("../CONTROLS/jitter")')
    rep3.parm('donoisescale').set(1)
    rep3.parm('scalemin').set(0.7)
    rep3.parm('scalemax').set(1.3)
    rep3.parm('elementsize').set(1.0)
    m_r3 = rescale(geo, 'to_m_r3', rep3, '1 / ch("../to_unit_r3/k")')
    c3 = geo.createNode('attribwrangle', 'cull3')
    c3.setInput(0, m_r3)
    c3.setInput(1, s12)
    c3.parm('snippet').set(CULL3_VEX)
    spheres = geo.createNode('merge', 'all_lobes')
    spheres.setInput(0, m12)
    spheres.setInput(1, c3)
    spheres_out = geo.createNode('null', 'SPHERES')
    spheres_out.setInput(0, spheres)

    # volume
    vp = geo.createNode('vdbfromparticles', 'to_vdb')
    vp.setInput(0, spheres_out)
    expr(vp.parm('voxelsize'), 'ch("../CONTROLS/voxel")')
    vp.parm('buildfog').set(1)
    vp.parm('bandwidthvoxels').set(6)
    set_attr_transfer(vp, ['bscale', 'ismain'])
    cut = geo.createNode('cloudclip', 'flat_base')
    cut.setInput(0, vp)
    cut.parm('usemask').set(0)
    expr(cut.parm('originy'), 'ch("../CONTROLS/base")')
    cut.parmTuple('dir').set((0, 1, 0))
    # cloudclip's mask input does not restrict the cut (tested), so the clipped density is blended back by the ismain grid:
    # only the main body gets the flat base; the chin, left lobes and satellites keep their own rounded bottoms.
    clip = geo.createNode('volumewrangle', 'flat_base_main_only')
    clip.setInput(0, vp)
    clip.setInput(1, cut)
    clip.parm('group').set('@name=density')
    clip.parm('snippet').set('float c = volumesample(1, "density", @P);\nfloat m = clamp(volumesample(0, "ismain", @P), 0, 1);\n@density = lerp(@density, c, m);')

    # fields: copy density twice -> detail_type / density_scale; normal from the gradient of a blurred copy
    dens = geo.createNode('blast', 'density_only')
    dens.setInput(0, clip)
    dens.parm('group').set('@name=density')
    dens.parm('negate').set(1)
    trip = geo.createNode('merge', 'three_grids')
    for i in range(3):
        trip.setInput(i, dens)
    ren = geo.createNode('attribwrangle', 'name_grids')
    ren.setInput(0, trip)
    ren.parm('class').set(1)  # primitives
    ren.parm('snippet').set('if (@primnum == 1) s@name = "detail_type";\nif (@primnum == 2) s@name = "density_scale";')
    blur = geo.createNode('vdbsmooth', 'blur')
    blur.setInput(0, dens)
    blur.parm('operation').set('gauss')
    expr(blur.parm('radius'), 'ch("../CONTROLS/blur")')
    blur.parm('iterations').set(2)
    grad = geo.createNode('vdbanalysis', 'gradient')
    grad.setInput(0, blur)
    grad.parm('operator').set(0)
    grad.parm('outputname').set('custom')
    grad.parm('customname').set('gradient')
    attrs = geo.createNode('blast', 'attr_grids')
    attrs.setInput(0, clip)
    attrs.parm('group').set('@name=bscale @name=ismain')
    attrs.parm('negate').set(1)
    fields = geo.createNode('volumewrangle', 'type_scale_from_normal')
    fields.setInput(0, ren)
    fields.setInput(1, grad)
    fields.setInput(2, attrs)
    fields.parm('group').set('@name=detail_type @name=density_scale')
    fields.parm('snippet').set(FIELDS_VEX)
    out = geo.createNode('null', 'OUT')
    out.setInput(0, fields)
    out.setColor(hou.Color((0.3, 0.8, 0.3)))
    ex = geo.createNode('rop_geometry', 'export')
    ex.setInput(0, out)
    ex.parm('sopoutput').set('$HIP/../cache/frog.vdb')
    ex.setColor(hou.Color((0.4, 0.8, 0.4)))

    geo.layoutChildren()
    stage(geo, 'CONTROLS', NOTES['controls'], [ctl])
    stage(geo, '1 Layout + rung 1 (bodies from the photo)', NOTES['layout'], layout_nodes)
    stage(geo, '2 Rung 2 lobes (r1 / 3.5)', NOTES['rung2'], [s1, ex1, seeds2, km1, rep2, m_r2, c2, m12])
    stage(geo, '3 Rung 3 lobes (r2 / 3.5), up/sun faces only', NOTES['rung3'], [s12, ex2, seeds3, km2, rep3, m_r3, c3, spheres, spheres_out])
    stage(geo, '4 Volume + flat base', NOTES['volume'], [vp, cut, clip])
    stage(geo, '5 Detail type + density scale from the normal', NOTES['fields'], [dens, trip, ren, blur, grad, attrs, fields, out, ex])
    out.setDisplayFlag(True)
    out.setRenderFlag(True)
    nodes.update(spheres=spheres_out, out=out, rung1=m1, rung2=c2, rung3=c3, vdb=vp, export=ex, geo=geo)
    return geo, nodes


def keep_points(geo, name, src, group):
    """Blast everything but the points in `group` (cloudshapereplicate's own group field does not restrict the scatter here)."""
    b = geo.createNode('blast', name)
    b.setInput(0, src)
    b.parm('group').set(group)
    b.parm('grouptype').set('points')
    b.parm('negate').set(1)
    return b


def rescale(geo, name, src, k_expr):
    import hou
    w = geo.createNode('attribwrangle', name)
    w.setInput(0, src)
    w.parm('class').set(0)
    ptg = w.parmTemplateGroup()
    ptg.append(hou.FloatParmTemplate('k', 'Scale', 1, default_value=(1.0,)))
    w.setParmTemplateGroup(ptg)
    expr(w.parm('k'), k_expr)
    w.parm('snippet').set(RESCALE_VEX)
    return w


def expr(parm, e):
    import hou
    parm.setExpression(e, hou.exprLanguage.Hscript)


def set_attr_transfer(vp, names):
    """vdbfromparticles: rasterise point attributes into VDB grids of the same name (closest particle)."""
    vp.parm('numattrib').set(len(names))
    for i, n in enumerate(names, 1):
        vp.parm('attribute%d' % i).set(n)
        vp.parm('attributevdbname%d' % i).set(n)


def add_controls(geo, vals):
    import hou
    ctl = geo.createNode('null', 'CONTROLS')
    ctl.setColor(hou.Color((1.0, 0.75, 0.2)))
    ptg = ctl.parmTemplateGroup()
    folders = {}
    for folder, name, label, value, lo, hi in CONTROLS:
        v = vals.get(name, value)
        if isinstance(value, int) and not isinstance(value, bool):
            t = hou.IntParmTemplate(name, label, 1, default_value=(int(v),), min=int(lo), max=int(hi))
        else:
            t = hou.FloatParmTemplate(name, label, 1, default_value=(float(v),), min=float(lo), max=float(hi))
        folders.setdefault(folder, []).append(t)
    for folder, tmpls in folders.items():
        ptg.append(hou.FolderParmTemplate('f_' + folder.lower(), folder, folder_type=hou.folderType.Tabs, parm_templates=tmpls))
    conv = hou.StringParmTemplate('convert_args', 'Converter args', 1, default_value=(' '.join(CONVERT_ARGS),))
    ptg.append(conv)
    b = hou.ButtonParmTemplate('run_converter', 'Run converter (vdb_to_nvdf.py)')
    b.setScriptCallback(CONVERT_BUTTON)
    b.setScriptCallbackLanguage(hou.scriptLanguage.Python)
    ptg.append(b)
    ctl.setParmTemplateGroup(ptg)
    ctl.setComment('Frog cloud (A3): edit here')
    ctl.setGenericFlag(hou.nodeFlag.DisplayComment, True)
    return ctl


def add_fit_parms(node, box):
    import hou
    ptg = node.parmTemplateGroup()
    ptg.append(hou.FloatParmTemplate('cx', 'Centre x (m)', 1, default_value=(box['cx'],)))
    ptg.append(hou.FloatParmTemplate('cz', 'Centre z (m, -distance)', 1, default_value=(box['cz'],)))
    ptg.append(hou.FloatParmTemplate('base', 'Base height (m)', 1, default_value=(box['base'],)))
    ptg.append(hou.FloatParmTemplate('size', 'Box size x/y/z (m)', 3, default_value=(box['sx'], box['sy'], box['sz'])))
    ptg.append(hou.IntParmTemplate('noshrink', 'Do not shrink for lobes (small bodies)', 1, default_value=(box.get('noshrink', 0),)))
    node.setParmTemplateGroup(ptg)


def add_tag_parms(node, b):
    import hou
    ptg = node.parmTemplateGroup()
    ptg.append(hou.StringParmTemplate('body', 'Body', 1, default_value=(b['name'],)))
    ptg.append(hou.StringParmTemplate('stream', 'Base stream (main = clipped flat)', 1, default_value=(b['stream'],)))
    ptg.append(hou.FloatParmTemplate('bscale', 'Body density scale', 1, default_value=(b['bscale'],), min=0.0, max=1.0))
    ptg.append(hou.IntParmTemplate('smooth_under', 'Smooth underside (no lobes facing down)', 1, default_value=(b['smooth_under'],)))
    ptg.append(hou.IntParmTemplate('rung3', 'Allow rung 3', 1, default_value=(b['rung3'],)))
    node.setParmTemplateGroup(ptg)


def stage(geo, title, note, members):
    import hou
    import re
    box = geo.createNetworkBox(re.sub(r'\W+', '_', title.lower()))
    box.setComment(title)
    for m in members:
        box.addNode(m)
    box.fitAroundContents()
    s = geo.createStickyNote()
    s.setText(title + '\n\n' + note)
    s.setSize(hou.Vector2(5.0, max(3.0, min(9.0, 0.9 + len(note) / 38.0))))
    p = box.position()
    s.setPosition(hou.Vector2(p[0] - 5.6, p[1] + box.size()[1] - s.size()[1]))
    s.setColor(hou.Color((0.95, 0.9, 0.55)))
    s.setTextColor(hou.Color((0.1, 0.1, 0.1)))
    return box


CONVERT_ARGS = ['--detail-grid', 'detail_type', '--scale-grid', 'density_scale', '--voxel-size', '8', '--iso', '0.05']
CONVERT_BUTTON = (
    "import hou, os, subprocess\n"
    "hip = hou.text.expandString('$HIP')\n"
    "repo = os.path.normpath(os.path.join(hip, '..', '..'))\n"
    "src = os.path.join(hip, '..', 'cache', 'frog.vdb')\n"
    "out = os.path.join(hip, '..', 'cache', 'nvdf', 'frog')\n"
    "if not os.path.exists(src):\n"
    "    raise hou.Error('Render the export ROP first: ' + src)\n"
    "cmd = [hou.text.expandString('$HFS') + '/bin/hython', os.path.join(repo, 'scripts', 'vdb', 'vdb_to_nvdf.py'), '--mode', 'fog',\n"
    "       src, '--out', out, '--name', 'frog'] + kwargs['node'].parm('convert_args').eval().split()\n"
    "r = subprocess.run(cmd, capture_output=True, text=True)\n"
    "print(r.stdout[-2000:], r.stderr[-1000:])\n"
    "print('written to', os.path.normpath(out), '- copy it to assets/clouds/local/frog/ to see it in examples/lab/frog/')\n"
)


# ------------------------------------------------------------------------------------------------------------------- preview

def write_png(path, rgb):
    h, w, _ = rgb.shape
    raw = b''.join(b'\x00' + rgb[y].astype(np.uint8).tobytes() for y in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


def silhouette(P, R, clip=None, base=BASE, cam=CAMERA):
    """Rasterise the spheres' projected discs (radius f R / depth).  Spheres flagged in `clip` are cut by the plane y = base (the
    flat base): a pixel counts only if its ray leaves the sphere above the plane."""
    W, H = cam['width'], cam['height']
    right, up, fwd = cam_basis(cam)
    u, v, d = project(P, cam)
    rad = cam['f'] * R / d
    m = np.zeros((H, W), bool)
    yy, xx = np.mgrid[0:H, 0:W]
    for i in np.argsort(-rad):
        if d[i] <= 0:
            continue
        x0, x1 = int(max(0, u[i] - rad[i])), int(min(W, u[i] + rad[i] + 1))
        y0, y1 = int(max(0, v[i] - rad[i])), int(min(H, v[i] + rad[i] + 1))
        if x0 >= x1 or y0 >= y1:
            continue
        sub = (xx[y0:y1, x0:x1] - u[i]) ** 2 + (yy[y0:y1, x0:x1] - v[i]) ** 2 <= rad[i] ** 2
        if clip is not None and clip[i] and P[i, 1] - R[i] < base:
            # ray directions of the pixels, then the far intersection with the sphere
            dx = (xx[y0:y1, x0:x1] - cam['width'] / 2) / cam['f']
            dy = (cam['height'] / 2 - yy[y0:y1, x0:x1]) / cam['f']
            D = dx[..., None] * right + dy[..., None] * up + fwd
            D /= np.linalg.norm(D, axis=-1, keepdims=True)
            b = D @ P[i]
            disc = b * b - (P[i] @ P[i] - R[i] ** 2)
            t1 = b + np.sqrt(np.maximum(disc, 0))
            sub &= (t1 * D[..., 1]) >= base
        m[y0:y1, x0:x1] |= sub
    return m


def compare(model, ref):
    inter = (model & ref).sum()
    union = (model | ref).sum()
    out = {'iou': round(float(inter / max(union, 1)), 4), 'modelOnly': int((model & ~ref).sum()), 'photoOnly': int((ref & ~model).sum())}
    # top profile of the main body (columns 260..1380, rows < 700) and the base row on the right half (cols 900..1250)
    def tops(m):
        t = []
        for x in range(275, 1385, 25):
            ys = np.flatnonzero(m[:700, x])
            t.append(int(ys[0]) if len(ys) else None)
        return t
    out['topModel'] = tops(model)
    out['topPhoto'] = tops(ref)
    return out


def preview(spheres_geo, tag, base=BASE):
    P = np.array(spheres_geo.pointFloatAttribValues('P'), np.float64).reshape(-1, 3)
    R = np.array(spheres_geo.pointFloatAttribValues('pscale'), np.float64)
    rung = np.array(spheres_geo.pointIntAttribValues('rung'))
    ismain = np.array(spheres_geo.pointFloatAttribValues('ismain')) > 0.5
    np.savez_compressed(os.path.join(WORK, 'spheres.npz'), P=P, R=R, rung=rung, ismain=ismain)
    m = silhouette(P, R, ismain, base)
    rep = {'spheres': {str(k): int((rung == k).sum()) for k in (1, 2, 3)},
           'radius_median_m': {str(k): round(float(np.median(R[rung == k])), 1) for k in (1, 2, 3) if (rung == k).any()}}
    if os.path.exists(REF_MASK):
        ref = np.load(REF_MASK)
        rep.update(compare(m, ref))
        rgb = np.zeros(m.shape + (3,), np.uint8)
        rgb[..., 0] = ref * 200          # photo only: red
        rgb[..., 1] = m * 200            # model only: green, both: yellow
        rgb[..., 2] = (m & ref) * 60
        write_png(os.path.join(WORK, 'preview_%s.png' % tag), rgb)
    return rep


# ------------------------------------------------------------------------------------------------------------------- main

def cook(node):
    import hou
    try:
        node.cook(force=True)
    except hou.OperationFailed:
        for n in node.parent().children():
            if n.errors():
                print('ERROR', n.name(), n.errors())
        raise

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--no-convert', action='store_true')
    ap.add_argument('--no-vdb', action='store_true', help='stop after the sphere preview')
    ap.add_argument('--hip', action='store_true', help='also save houdini/rigs/frog.hip')
    ap.add_argument('--tag', default='v')
    ap.add_argument('--convert-voxel', type=float, default=8.0, help='converter voxel size (16 for a quick look; the EDT at 8 m takes ~6 min)')
    ap.add_argument('--set', action='append', default=[], help='CONTROLS override name=value')
    args = ap.parse_args()
    import hou
    os.makedirs(WORK, exist_ok=True)
    vals = {}
    for s in args.set:
        k, v = s.split('=')
        vals[k] = float(v)
    t0 = time.time()
    geo, nodes = build(vals)
    timings = {}
    t = time.time()
    cook(nodes['spheres'])
    timings['spheres'] = round(time.time() - t, 2)
    rep = {'tag': args.tag}
    rep['preview'] = preview(nodes['spheres'].geometry(), args.tag)
    print(json.dumps(rep['preview']))
    if args.hip:
        os.makedirs(os.path.dirname(RIG), exist_ok=True)
        hou.hipFile.save(RIG)
        rep['hip'] = {'path': RIG, 'bytes': os.path.getsize(RIG)}
    if args.no_vdb:
        return
    t = time.time()
    out = nodes['out']
    cook(out)
    g = out.geometry()
    vdb_path = os.path.join(WORK, 'frog.vdb')
    keep = hou.Geometry()
    keep.merge(g)
    keep.saveToFile(vdb_path)
    timings['vdb'] = round(time.time() - t, 2)
    rep['grids'] = {p.attribValue('name'): {'active': p.activeVoxelCount(), 'bbox': [round(c) for c in list(p.boundingBox().minvec()) + list(p.boundingBox().maxvec())]}
                    for p in g.prims()}
    rep['vdbBytes'] = os.path.getsize(vdb_path)
    print(json.dumps(rep['grids']))
    if not args.no_convert:
        t = time.time()
        conv_out = os.path.join(WORK, 'nvdf')
        hython = os.path.join(os.path.dirname(sys.executable), 'hython') if 'hython' not in sys.executable else sys.executable
        hython = shutil.which('hython') or '/Applications/Houdini/Houdini21.0.671/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython'
        cargs = list(CONVERT_ARGS)
        cargs[cargs.index('--voxel-size') + 1] = '%g' % args.convert_voxel
        cmd = [hython, CONVERTER, '--mode', 'fog', vdb_path, '--out', conv_out, '--name', 'frog'] + cargs
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-3000:], r.stderr[-3000:])
            raise SystemExit('converter failed')
        rep['convert'] = json.loads(r.stdout[r.stdout.index('{'):])
        timings['convert'] = round(time.time() - t, 2)
        os.makedirs(ASSET_OUT, exist_ok=True)
        for f in ('cloud.json', 'nvdf.bin', 'sdf.bin'):
            shutil.copy2(os.path.join(conv_out, f), os.path.join(ASSET_OUT, f))
        cj = json.load(open(os.path.join(conv_out, 'cloud.json')))
        rep['placement'] = {'cropMinWorld': cj['houdini']['cropMinWorld'], 'dims': cj['dims'], 'voxel': cj['voxelSizeMeters']}
        print(json.dumps(rep['placement']))
    rep['timings'] = timings
    rep['seconds'] = round(time.time() - t0, 1)
    with open(os.path.join(WORK, 'report_%s.json' % args.tag), 'w') as f:
        json.dump(rep, f, indent=1)
    print('done in', rep['seconds'], 's')


if __name__ == '__main__':
    main()
