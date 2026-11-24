#!/usr/bin/env python3
"""P2.6c: one Houdini cumulus tower built with the SOP cloud tools, written as a density VDB after each stage.

  HYTHON=/Applications/Houdini/Houdini21.0.792/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython
  $HYTHON scripts/houdini/cumulus-stages.py                 # build, write 4 VDBs + houdini/rigs/cumulus_stages.hip (~1 min)
  $HYTHON scripts/houdini/cumulus-stages.py --render        # also render the 4 stages with Karma (husk) and write the sheet
  $HYTHON scripts/houdini/cumulus-stages.py --voxel 16      # coarser, faster

The question it answers: what does each stage of the Houdini cloud recipe add?  Houdini makes "sphere clouds" easily; the
noise passes are what make them read as clouds.  Stages (one VDB each, grid `density`, metres, y up, base at y = 0):

  1 lobes      3 x Cloud Shape Generate (congestus core + two mediocris flanks) -> VDB from Particles (fog) -> Cloud Clip (flat base)
  2 replicate  + Cloud Shape Replicate twice on the surface (r ~ 1/2 and ~1/5 of the parents, biased to up-facing parents)
  3 billowy    + Cloud Billowy Noise (SDF displacement of the fog iso-surface, 3 iterations coarse -> fine, Worley erosion,
                 up-vector falloff so tops billow more than flanks)
  4 wispy      + Cloud Wispy Noise (density advected along a curl/flow noise field, scaled by height: full at the base,
                 none at the top) = the finished cloud

Layout is built at Houdini's native cloud-tool scale (about 1 unit = 1 km; the tools' defaults and their scatter counts are tuned
for clouds a few units across, see the note in scripts/vdb/authoring/frog.py) and each stage is scaled by unit_m to metres on export.
Every length below is therefore in units (1 unit = PARAMS['unit_m'] = 750 m).  The PARAMS dict is the recipe; P2-6c's log copies it.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
HIP = os.path.join(REPO, 'houdini', 'rigs', 'cumulus_stages.hip')
VDB_DIR = os.path.join(REPO, 'assets', 'clouds', 'houdini-stages')    # about 12 MB in all at 12 m, committed
CAPTURE = os.path.join(REPO, 'work', 'captures', 'P2-6c')
STAGES = ['1_lobes', '2_replicate', '3_billowy', '4_wispy']

PARAMS = {
    # (species, centre x/z in km, length, width, seed).  Congestus is ~1.6 km wide x 2.3 km tall at the default size.
    'bodies': [
        ('con', (0.0, 0.0, 0.0), 2.0, 0.25, 1),
        ('med', (-0.95, 0.0, 0.15), 1.0, 0.25, 2),
        ('med', (0.95, 0.0, -0.10), 1.0, 0.25, 3),
    ],
    'generate': {'scattersecshapes': 1, 'secniter': 3, 'doflatten': 1},
    # Replicate: children radius = pointsep x (scalemin..scalemax) noise-scaled; surface scatter on the parents' spheres.
    'replicate1': {'surfacescatter': 1, 'pointsep': 0.09, 'scalemin': 0.8, 'scalemax': 1.6, 'elementsize': 0.4,
                   'doupvectorfalloff': 1, 'upvectorbias': 0.35, 'dodirscale': 1, 'dirscalemin': 1.0, 'dirscalemax': 1.6},
    'replicate2_seed_fraction': 0.03, 'replicate2_min_ny': -0.2,
    'replicate2': {'surfacescatter': 1, 'pointsep': 0.035, 'scalemin': 0.8, 'scalemax': 1.5, 'elementsize': 0.15,
                   'doupvectorfalloff': 1, 'upvectorbias': 0.5},
    # VDB from Particles: fog from the union of spheres.
    'voxel_km': 0.016,                 # set from --voxel (metres) / unit_m
    'unit_m': 750.0,                   # metres per Houdini unit: 1 unit = 750 m puts the tower at ~3 km x 2 km
    # Billowy: Houdini converts the fog to an SDF at fogisovalue, displaces it along the normal by a noise and converts back.
    'billowy': {'basis': 'simplex', 'amplitude': 0.10, 'elementsize': 0.45, 'oct': 5, 'rough': 0.5,
                'doiter': 1, 'niters': 3, 'amplitude_atten': 0.45, 'elementsize_atten': 0.38,
                'doworleydetails': 1, 'worleyblend': 0.8, 'worleyerosion': 0.6, 'worleyelementsizescale': 2.0,
                'doupvectorfalloff': 1, 'upvectorbias': 0.6, 'advectnoise': 1, 'advect_ampscale': 0.5, 'advect_elementsizecale': 0.6,
                'densityscale': 1.0, 'fogisovalue': 0.5},
    # Wispy: advects the density through a flow noise (aaflow) velocity; scaled by the bounding box along y.
    'wispy': {'noisetype': 'aaflow', 'amplitude': 0.25, 'elementsize': 0.12, 'oct': 6, 'rough': 0.55,
              'doiter': 1, 'niters': 2, 'substeps': 2,
              'doboundscale': 1, 'boundidx': 1, 'boundmin': 0.0, 'boundmax': 1.0,
              'densityscale': 1.0},
}


RENDER = json.loads(os.environ.get('CUMULUS_RENDER', '{}') or '{}')
RENDER = dict({'sigma_per_m': 0.04, 'sun': 3.0, 'sky': 0.5, 'spp': 8, 'volumelimit': 6, 'steprate': 0.5}, **RENDER)


def hou_mod():
    import hou
    return hou


def setp(node, d):
    for k, v in d.items():
        p = node.parm(k)
        if p is None:
            raise RuntimeError('%s has no parm %s' % (node.type().name(), k))
        if isinstance(v, str):
            p.set(v)
        else:
            p.set(v)


def note(geo, title, text, members):
    hou = hou_mod()
    box = geo.createNetworkBox()
    box.setComment(title)
    for m in members:
        box.addNode(m)
    box.fitAroundContents()
    s = geo.createStickyNote()
    s.setText(title + '\n\n' + text)
    s.setSize(hou.Vector2(5.0, max(2.5, min(8.0, 0.9 + len(text) / 40.0))))
    p = box.position()
    s.setPosition(hou.Vector2(p[0] - 5.6, p[1] + box.size()[1] - s.size()[1]))
    s.setColor(hou.Color((0.95, 0.9, 0.55)))
    s.setTextColor(hou.Color((0.1, 0.1, 0.1)))


def build(prm):
    hou = hou_mod()
    obj = hou.node('/obj')
    if obj.node('cumulus_stages'):
        obj.node('cumulus_stages').destroy()
    geo = obj.createNode('geo', 'cumulus_stages')
    n = {}

    # ---- stage 1: lobes
    gens = []
    for i, (sp, c, length, width, seed) in enumerate(prm['bodies']):
        a = geo.createNode('add', 'pt_%d_%s' % (i, sp))
        a.parm('points').set(1)
        a.parm('usept0').set(1)
        a.parmTuple('pt0').set(c)
        g = geo.createNode('cloudshapegenerate', 'generate_%d_%s' % (i, sp))
        g.setInput(0, a)
        g.parm('cuspecies').set(sp)
        setp(g, {'length': length, 'width': width, 'seed': seed, 'pointsep_seed': seed, 'shapedistort_seed': seed,
                 'length_seed': seed, 'secoffset': seed})
        setp(g, prm['generate'])
        gens += [a, g]
    lobes = geo.createNode('merge', 'LOBES')
    for i, g in enumerate(gens[1::2]):
        lobes.setInput(i, g)

    def to_fog(src, name):
        vp = geo.createNode('vdbfromparticles', 'fog_' + name)
        vp.setInput(0, src)
        setp(vp, {'voxelsize': prm['voxel_km'], 'builddistance': 0, 'buildfog': 1, 'fogname': 'density', 'bandwidthvoxels': 3})
        clip = geo.createNode('cloudclip', 'base_' + name)
        clip.setInput(0, vp)
        setp(clip, {'usemask': 0, 'originy': 0.0, 'diry': 1.0})
        return vp, clip

    vp1, clip1 = to_fog(lobes, 'lobes')

    # ---- stage 2: replicate twice
    rep1 = geo.createNode('cloudshapereplicate', 'replicate_1')
    rep1.setInput(0, lobes)
    setp(rep1, prm['replicate1'])
    # second rung seeds from a thin random subset of the first-rung lobes that do not face down (replicating all ~100k
    # first-rung lobes gives tens of millions of spheres and never finishes)
    thin = geo.createNode('attribwrangle', 'seed_subset_2')
    thin.setInput(0, rep1)
    thin.parm('snippet').set('if (rand(@ptnum * 1.37 + 0.1) > %g || v@N.y < %g) removepoint(0, @ptnum);'
                             % (prm['replicate2_seed_fraction'], prm['replicate2_min_ny']))
    rep2 = geo.createNode('cloudshapereplicate', 'replicate_2')
    rep2.setInput(0, thin)
    setp(rep2, prm['replicate2'])
    allsph = geo.createNode('merge', 'ALL_LOBES')
    for i, s in enumerate((lobes, rep1, rep2)):
        allsph.setInput(i, s)
    # drop spheres entirely below the base (replicate scatters children under the flat bottom too)
    below = geo.createNode('blast', 'drop_below_base')
    below.setInput(0, allsph)
    below.parm('group').set('@P.y<-0.02')
    below.parm('grouptype').set('points')
    vp2, clip2 = to_fog(below, 'replicated')

    # ---- stage 3: billowy noise
    bil = geo.createNode('cloudbillowynoise', 'billowy')
    bil.setInput(0, clip2)
    setp(bil, prm['billowy'])
    clip3 = geo.createNode('cloudclip', 'base_billowy')
    clip3.setInput(0, bil)
    setp(clip3, {'usemask': 0, 'originy': 0.0, 'diry': 1.0})

    # ---- stage 4: wispy noise
    wis = geo.createNode('cloudwispynoise', 'wispy')
    wis.setInput(0, clip3)
    setp(wis, prm['wispy'])

    outs = {}
    for name, src in zip(STAGES, (clip1, clip2, clip3, wis)):
        xf = geo.createNode('xform', 'to_metres_' + name)
        xf.setInput(0, src)
        xf.parm('scale').set(prm['unit_m'])
        o = geo.createNode('null', 'OUT_' + name)
        o.setInput(0, xf)
        o.setColor(hou.Color((0.3, 0.8, 0.3)))
        rop = geo.createNode('rop_geometry', 'export_' + name)
        rop.setInput(0, o)
        rop.parm('sopoutput').set('$HIP/../../assets/clouds/houdini-stages/cumulus_%s.vdb' % name)
        outs[name] = o
        n['xf_' + name] = xf
        n['rop_' + name] = rop
    geo.layoutChildren()
    note(geo, 'Stage 1: lobes (the sphere cloud)',
         'Cloud Shape Generate x3 (congestus core, two mediocris flanks, secondary scatter on) -> VDB from Particles fog '
         '(12 m) -> Cloud Clip flat base at y = 0. 1 unit = 750 m here; to_metres_* scales by 750 on export.',
         gens + [lobes, vp1, clip1])
    note(geo, 'Stage 2: + replicated smaller lobes',
         'Cloud Shape Replicate twice, surface scatter: ~55-125 m then ~20-40 m lobes (second rung seeded from 3 % of the first), up-vector falloff so they sit on '
         'the tops. Spheres under the base are dropped, then fog + flat base as stage 1.', [rep1, thin, rep2, allsph, below, vp2, clip2])
    note(geo, 'Stage 3: + billowy noise',
         'Cloud Billowy Noise: fog -> SDF at iso 0.5, displaced along the normal by advected simplex fBm + Worley erosion, '
         '3 iterations (340 m -> 130 m -> 50 m, amplitude 75 m x0.45 each), up-vector falloff (tops billow most), back to fog.',
         [bil, clip3])
    note(geo, 'Stage 4: + wispy noise (finished)',
         'Cloud Wispy Noise: advects density along an aaflow (curl-like) velocity, 2 iterations; scaled by the bounding box '
         'in y so the base frays and the top keeps the billowy surface.', [wis])
    lobes.setDisplayFlag(False)
    outs['4_wispy'].setDisplayFlag(True)
    outs['4_wispy'].setRenderFlag(True)
    return geo, outs, n


def stats_of(geo_obj):
    hou = hou_mod()
    vols = [p for p in geo_obj.prims() if p.type() == hou.primType.VDB]
    out = []
    for v in vols:
        bb = v.boundingBox()
        out.append({'name': v.attribValue('name'), 'active': int(v.activeVoxelCount()),
                    'max': round(float(v.volumeMax()), 3), 'mean': round(float(v.volumeAverage()), 4),
                    'voxel_m': round(float(v.voxelSize()[0]), 2),
                    'bbox_m': [round(x) for x in list(bb.minvec()) + list(bb.maxvec())]})
    return out


# ------------------------------------------------------------------------------------------------------- render (Karma via husk)

def build_render_stage(vdb):
    """Side-on camera looking along -z, sun from upper left (and a bit from the camera side), soft blue dome."""
    hou = hou_mod()
    st = hou.node('/stage')
    for c in st.children():
        c.destroy()
    vol = st.createNode('volume', 'cloud')
    vol.parm('primpath').set('/cloud')
    vol.parm('filepath1').set(vdb)
    ml = st.createNode('materiallibrary', 'mat')
    ml.setInput(0, vol)
    # same material recipe as scripts/vdb/reference/build_rig.py: sigma_t = density x K, albedo ~1, two-lobe HG
    dens = ml.createNode('mtlxgeompropvalue', 'density_field')
    dens.parm('signature').set('default')
    dens.parm('geomprop').set('density')
    sig = ml.createNode('mtlxmultiply', 'sigma_t')
    sig.setInput(0, dens)
    sig.parm('in2').set(RENDER['sigma_per_m'])
    scat = ml.createNode('mtlxmultiply', 'scattering')
    scat.parm('signature').set('vector3FA')
    for comp in 'xyz':
        p = scat.parm('in1_vector3FA%s' % comp) or scat.parm('in1_vector3%s' % comp)
        p.set(0.99)
    scat.setInput(1, sig)
    absn = ml.createNode('mtlxmultiply', 'absorption')
    absn.parm('signature').set('vector3FA')
    for comp in 'xyz':
        p = absn.parm('in1_vector3FA%s' % comp) or absn.parm('in1_vector3%s' % comp)
        p.set(0.01)
    absn.setInput(1, sig)
    vsh = ml.createNode('kma_volume', 'vapour_volume')
    vsh.setInput(vsh.inputIndex('scattering'), scat)
    vsh.setInput(vsh.inputIndex('absorption'), absn)
    vsh.parm('anisotropy').set(0.8)
    vsh.parm('secondaryanisotropy').set(-0.3)
    vsh.parm('secondarymix').set(0.1)
    mat = ml.createNode('mtlxvolumematerial', 'vapour')
    mat.setInput(0, vsh)
    ml.layoutChildren()
    asg = st.createNode('assignmaterial', 'assign')
    asg.setInput(0, ml)
    asg.parm('primpattern1').set('/cloud')
    asg.parm('matspecpath1').set('/materials/vapour')
    cam = st.createNode('camera', 'cam')
    cam.setInput(0, asg)
    cam.parm('primpath').set('/cameras/side')
    cam.parmTuple('t').set((0.0, 1150.0, 15000.0))
    cam.parmTuple('r').set((0.0, 0.0, 0.0))
    cam.parm('focalLength').set(58.0)
    cam.parm('clippingRange1').set(10.0)
    cam.parm('clippingRange2').set(1e6)
    sun = st.createNode('distantlight::2.0', 'sun')
    sun.setInput(0, cam)
    sun.parmTuple('r').set((-35.0, -55.0, 0.0))     # travels toward +x, down, away from the camera: lit from upper left
    sun.parm('xn__inputsintensity_i0a').set(RENDER['sun'])
    sun.parm('xn__inputsangle_zta').set(0.53)
    dome = st.createNode('domelight::2.0', 'sky')
    dome.setInput(0, sun)
    dome.parm('xn__inputsintensity_i0a').set(RENDER['sky'])
    dome.parmTuple('xn__inputscolor_zta').set((0.55, 0.7, 1.0))
    rs = st.createNode('karmarendersettings', 'rs')
    rs.setInput(0, dome)
    rs.parm('camera').set('/cameras/side')
    rs.parm('res_mode').set('manual')
    rs.parm('resolutiony').lock(False)
    rs.parm('resolutionx').set(640)
    rs.parm('resolutiony').set(360)
    rs.parm('samplesperpixel').set(RENDER['spp'])
    rs.parm('volumelimit').set(RENDER['volumelimit'])
    rs.parm('volumesteprate').set(RENDER['steprate'])
    rs.parm('engine').set('cpu')
    rs.setDisplayFlag(True)
    return rs


def load_density(vdb_path):
    """Dense numpy array [z, y, x] of the density grid plus its voxel size and world-space min corner."""
    import numpy as np
    hou = hou_mod()
    g = hou.Geometry()
    g.loadFromFile(vdb_path)
    p = [q for q in g.prims() if q.type() == hou.primType.VDB and q.attribValue('name') == 'density'][0]
    bb = p.activeVoxelBoundingBox()
    lo = [int(round(v)) for v in bb.minvec()]
    hi = [int(round(v)) for v in bb.maxvec()]
    n = [hi[k] - lo[k] for k in range(3)]
    arr = np.asarray(p.voxelRangeAsFloat(hou.BoundingBox(*lo, *hi)), dtype=np.float32).reshape(n[2], n[1], n[0])
    vs = float(p.voxelSize()[0])
    origin = p.indexToPos(tuple(lo))
    return np.clip(arr, 0.0, None), vs, (origin[0], origin[1], origin[2])


def preview_render(vdb_path, frame_m=(3800.0, 2137.5), centre=(0.0, 1020.0), res=(640, 360), sigma=None):
    """Cheap single-scatter preview (numpy, no Karma): orthographic side view along -z, sun from the upper left
    (direction (+0.8, -0.6, 0) in the image plane), sun transmittance by marching the grid toward the sun, an ambient sky
    term attenuated by the optical depth above each voxel, Henyey-Greenstein-free (isotropic) so surfaces read clearly."""
    import numpy as np
    sigma = RENDER['sigma_per_m'] if sigma is None else sigma
    d, vs, org = load_density(vdb_path)
    # downsample to <= 16 m for speed (preview only)
    f = max(1, int(round(16.0 / vs)))
    if f > 1:
        zz, yy, xx = (s - s % f for s in d.shape)
        d = d[:zz, :yy, :xx].reshape(zz // f, f, yy // f, f, xx // f, f).mean(axis=(1, 3, 5))
        vs *= f
    ext = d * sigma * vs                                   # optical depth per voxel
    nz, ny, nx = ext.shape
    # sun optical depth: march toward the sun (-x, +y in grid terms) with nearest-voxel steps
    sdir = np.array([-0.8, 0.6])                            # toward the sun: x left, y up
    tau = np.zeros_like(ext)
    steps = int(1.5 * max(nx, ny))
    for k in range(1, steps):
        dx = int(round(sdir[0] * k))
        dy = int(round(sdir[1] * k))
        if abs(dx) >= nx or abs(dy) >= ny:
            break
        # voxel (x, y) receives ext at (x + dx, y + dy)
        x0, x1 = max(0, -dx), nx - max(0, dx)
        tau[:, 0:ny - dy, x0:x1] += ext[:, dy:ny, x0 + dx:x1 + dx]
    tau -= 0.5 * ext
    sun_t = np.exp(-tau)
    up_tau = np.cumsum(ext[:, ::-1, :], axis=1)[:, ::-1, :] - 0.5 * ext
    amb_t = np.exp(-0.5 * up_tau)
    sun_col = np.array([1.0, 0.96, 0.9]) * 2.2
    sky_col = np.array([0.45, 0.6, 0.85]) * 0.9
    # view: camera at +z looking -z -> front-to-back is z descending
    trans = np.ones((ny, nx), np.float32)
    rad = np.zeros((ny, nx, 3), np.float32)
    for z in range(nz - 1, -1, -1):
        a = 1.0 - np.exp(-ext[z])
        src = sun_t[z][..., None] * sun_col + amb_t[z][..., None] * sky_col
        rad += (trans * a)[..., None] * src
        trans *= np.exp(-ext[z])
    # sky background + tone map
    h, w = res[1], res[0]
    px = centre[0] - frame_m[0] / 2 + (np.arange(w) + 0.5) * frame_m[0] / w
    py = centre[1] + frame_m[1] / 2 - (np.arange(h) + 0.5) * frame_m[1] / h
    ix = np.floor((px - org[0]) / vs).astype(int)
    iy = np.floor((py - org[1]) / vs).astype(int)
    vx = (ix >= 0) & (ix < nx)
    vy = (iy >= 0) & (iy < ny)
    img = np.zeros((h, w, 3), np.float32)
    tr = np.ones((h, w), np.float32)
    sel = np.ix_(vy, vx)
    img[sel] = rad[np.ix_(iy[vy], ix[vx])]
    tr[sel] = trans[np.ix_(iy[vy], ix[vx])]
    sky = np.linspace(0.32, 0.62, h)[:, None, None] * np.array([0.55, 0.7, 1.0])[None, None, :]
    img = img + tr[..., None] * sky
    img = 1.0 - np.exp(-img * 1.4)
    img = np.clip(img, 0, 1) ** (1 / 2.2)
    return (img * 255 + 0.5).astype(np.uint8)


def write_png(path, rgb):
    import struct
    import zlib
    h, w, _ = rgb.shape
    raw = b''.join(b'\x00' + rgb[y].tobytes() for y in range(h))

    def chunk(t, dat):
        return struct.pack('>I', len(dat)) + t + dat + struct.pack('>I', zlib.crc32(t + dat) & 0xffffffff)
    with open(path, 'wb') as fh:
        fh.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


def render_preview(vdbs, out_dir):
    times = {}
    pngs = []
    for name, vdb in vdbs.items():
        t = time.time()
        png = os.path.join(out_dir, 'stage_%s.png' % name)
        write_png(png, preview_render(vdb))
        times[name] = round(time.time() - t, 1)
        print('preview', name, times[name], 's', flush=True)
        pngs.append(png)
    return pngs, times


def render(vdbs, out_dir, cap_s):
    """Karma (husk) render. Kept behind --karma: in P2-6c it gave a blocky, half-black image (see work/logs/P2-6c.md)."""
    hou = hou_mod()
    husk = os.path.join(os.environ.get('HFS', os.path.dirname(os.path.dirname(sys.executable))), 'bin', 'husk')
    if not os.path.exists(husk):
        husk = os.path.join(os.path.dirname(sys.executable), 'husk')
    times = {}
    pngs = []
    for name, vdb in vdbs.items():
        rs = build_render_stage(vdb)
        usd = os.path.join(out_dir, 'render_%s.usda' % name)
        rs.stage().Export(usd)
        png = os.path.join(out_dir, 'stage_%s.png' % name)
        if os.path.exists(png):
            os.remove(png)
        t = time.time()
        p = subprocess.Popen([husk, '-o', png, '--make-output-path', usd], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            outtxt, _ = p.communicate(timeout=cap_s)
        except subprocess.TimeoutExpired:
            p.kill()
            outtxt = 'KILLED after %d s' % cap_s
        times[name] = round(time.time() - t, 1)
        print('render', name, times[name], 's', 'ok' if os.path.exists(png) else 'FAILED', outtxt[-400:] if not os.path.exists(png) else '', flush=True)
        pngs.append(png)
    return pngs, times


def sheet(pngs):
    """2 x 2 labelled JPEG via the system python3 + Pillow (Houdini's python has no PIL)."""
    code = (
        "import sys\n"
        "from PIL import Image, ImageDraw\n"
        "ims = [Image.open(p).convert('RGB') for p in sys.argv[2:]]\n"
        "labels = ['1 lobes only (sphere cloud)', '2 + replicated smaller lobes', '3 + billowy noise', '4 + wispy noise (finished)']\n"
        "w, h = ims[0].size\n"
        "out = Image.new('RGB', (2 * w + 6, 2 * h + 6), (20, 20, 20))\n"
        "for i, im in enumerate(ims):\n"
        "    x, y = (i % 2) * (w + 6), (i // 2) * (h + 6)\n"
        "    out.paste(im, (x, y))\n"
        "    d = ImageDraw.Draw(out)\n"
        "    d.rectangle([x + 6, y + 6, x + 250, y + 26], fill=(0, 0, 0))\n"
        "    d.text((x + 12, y + 10), labels[i], fill=(255, 255, 255))\n"
        "out.save(sys.argv[1], quality=88)\n")
    py = shutil.which('python3', path='/opt/homebrew/bin:/usr/local/bin:/usr/bin') or 'python3'
    env = {k: v for k, v in os.environ.items() if not k.startswith('PYTHON')}
    r = subprocess.run([py, '-c', code, os.path.join(CAPTURE, 'sheet.jpg')] + pngs, capture_output=True, text=True, env=env)
    print('sheet', os.path.join(CAPTURE, 'sheet.jpg'), r.returncode, r.stderr[-400:])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--voxel', type=float, default=None, help='voxel size in metres (default 12)')
    ap.add_argument('--render', action='store_true', help='render the 4 stages (numpy single-scatter preview) and build the sheet')
    ap.add_argument('--karma', action='store_true', help='render with Karma/husk instead of the numpy preview (gave artefacts in P2-6c)')
    ap.add_argument('--render-only', action='store_true', help='render existing VDBs, do not rebuild')
    ap.add_argument('--cap', type=int, default=60, help='seconds per frame before husk is killed')
    ap.add_argument('--out', default=VDB_DIR)
    args = ap.parse_args()
    hou = hou_mod()
    prm = json.loads(json.dumps(PARAMS))
    prm['voxel_km'] = (args.voxel or 12.0) / prm['unit_m']
    os.makedirs(args.out, exist_ok=True)
    os.makedirs(CAPTURE, exist_ok=True)
    vdbs = {s: os.path.join(args.out, 'cumulus_%s.vdb' % s) for s in STAGES}
    report = {'houdini': hou.applicationVersionString(), 'params': prm}
    if not args.render_only:
        geo, outs, _ = build(prm)
        report['stages'] = {}
        for s in STAGES:
            t = time.time()
            try:
                outs[s].cook(force=True)
            except hou.OperationFailed:
                for c in geo.children():
                    if c.errors():
                        print('ERROR', c.name(), c.errors())
                raise
            g = outs[s].geometry()
            keep = hou.Geometry()
            keep.merge(g)
            # density only (Cloud Clip / noise nodes can leave helper grids)
            for p in [p for p in keep.prims() if p.type() == hou.primType.VDB and p.attribValue('name') != 'density']:
                keep.deletePrims([p])
            keep.saveToFile(vdbs[s])
            st = {'cook_s': round(time.time() - t, 1), 'bytes': os.path.getsize(vdbs[s]), 'grids': stats_of(keep)}
            report['stages'][s] = st
            print(s, json.dumps(st), flush=True)
        os.makedirs(os.path.dirname(HIP), exist_ok=True)
        hou.hipFile.save(HIP)
        report['hip'] = HIP
    if args.render or args.render_only:
        if args.karma:
            pngs, times = render(vdbs, CAPTURE, args.cap)
        else:
            pngs, times = render_preview(vdbs, CAPTURE)
        report['render_s'] = times
        sheet(pngs)
    with open(os.path.join(CAPTURE, 'report.json'), 'w') as f:
        json.dump(report, f, indent=1)
    print('done')


if __name__ == '__main__':
    main()
