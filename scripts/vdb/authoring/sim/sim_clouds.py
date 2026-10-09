"""P4-F: grow hero clouds with a scripted Houdini Pyro simulation (SOP-level Pyro Solver), the way Guerrilla grew
theirs (Nubis3 slides 63-64).  Run with hython:

  HYTHON=/Applications/Houdini/Houdini21.0.671/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython
  $HYTHON scripts/vdb/authoring/sim/sim_clouds.py cumulus               # sim + dump checkpoints + convert
  $HYTHON scripts/vdb/authoring/sim/sim_clouds.py cumulus --frames 80 --no-convert --tag _t   # quick experiment

Network (SOP level, one geo):  volume(density) + volume(temperature) -> merge -> volumewrangle (the SOURCE: a flat
noisy disc) -> pyrosolver -> blast(keep density) -> convertvdb -> volumewrangle (REMAP: density shoulder + flat base)
-> vdbsmooth -> .vdb.   The sim runs at SIM SCALE (1 sim unit = recipe `world_scale` metres, default 100) because the
Pyro defaults are tuned for metre-sized smoke; the converter's --world-scale puts it back to real metres.
Edit RECIPES below; every key under `solver` is a real pyrosolver parm name.
"""
import argparse, json, math, os, subprocess, sys, time

import hou

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
sys.path.insert(0, os.path.join(HERE, '..'))
import build_heroes  # noqa: E402  (preview PNG writer, reused)

CONVERTER = os.path.join(REPO, 'scripts', 'vdb', 'vdb_to_nvdf.py')

# --- recipes -------------------------------------------------------------------------------------------------
# source:  cellfreq (1/size of thermal cells), cell0/cell1 (noise range that becomes a hot spot; higher = fewer, smaller thermals), floor (emission outside hot spots), radius (sim units), height (thickness of emitter slab), rate (density per frame; pyro "Add"s it each frame),
#          temp (source temperature 0..1), noisefreq (breakup size = 1/freq), noiseamp (0 = clean disc, 1 = broken),
#          edge (soft radial falloff as fraction of radius), emit_frames (emission stops after this frame, fade 10)
# solver:  pyrosolver parms.  temperature0/1 = the range buoyancy uses (we use 0..1 smoke-style).
# remap:   lo, hi = density range of the sim mapped to 0..1 (smoothstep: lower lo = fluffier/larger, narrower
#          hi-lo = crisper cauliflower edge); base, basefade = flat cloud base in sim units (0 = off)
#          stretch = vertical stretch factor of the finished density (1 = none)
# smooth:  vdbsmooth mean iterations (voxel radius 1)
# convert: extra vdb_to_nvdf.py args
RECIPES = {
    'cumulus': dict(
        world_scale=100.0, divsize=0.08, frames=180, out_frames=[120, 150, 180],
        source=dict(radius=2.0, height=0.35, rate=1.5, temp=0.85, noisefreq=1.1, noiseamp=0.9, edge=0.5, cellfreq=1.6, cell0=0.45, cell1=0.65, floor=0.0, emit_frames=200),
        solver=dict(temperature0=0.0, temperature1=1.0, buoyancylift=6.0, tempcooling=0.05, dissipation=0.01,
                    enable_turbulence=1, turbulence=0.6, turbulence_swirlsize=0.6,
                    enable_disturbance=1, disturbance=0.5, disturbance_blocksize=0.5),
        remap=dict(lo=0.05, hi=1.0, base=0.05, basefade=1.0, stretch=1.7), smooth=1,
        convert=['--iso', '0.3', '--margin', '1']),
    'congestus': dict(
        world_scale=100.0, divsize=0.08, frames=260, out_frames=[200, 230, 260],
        source=dict(radius=1.0, height=0.4, rate=2.0, temp=1.0, noisefreq=1.0, noiseamp=0.9, edge=0.5, cellfreq=1.4, cell0=0.45, cell1=0.65, floor=0.0, emit_frames=260),
        solver=dict(temperature0=0.0, temperature1=1.0, buoyancylift=12.0, tempcooling=0.03, dissipation=0.005,
                    enable_turbulence=1, turbulence=0.4, turbulence_swirlsize=0.4,
                    enable_disturbance=1, disturbance=0.15, disturbance_blocksize=0.5),
        remap=dict(lo=0.05, hi=1.0, base=0.05, basefade=1.0, stretch=2.8), smooth=1,
        convert=['--iso', '0.3', '--margin', '1']),
}

SOURCE_VEX = '''
float H = %(height)g;
vector p = @P;
float frame = `$FF`;
float t = frame * 0.02;
vector so = %(seedvec)s;                                               // seed: shifts every noise lookup
float n1 = noise(p * %(noisefreq)g * 1.7 + {3.1, 1.7, 9.2} + so);          // breaks the disc outline into lobes
float n2 = noise(p * %(cellfreq)g + {7.3, 2.1, 0.4} + so + t * {0.5, 0.2, 0.3});  // thermal cells
// emitters: (x, z, rx, rz, weight, start frame) in sim units; each is a noisy elliptical disc, the source is their max
float E[] = array(%(emitters)s);
float mask = 0;
for (int i = 0; i < len(E); i += 6) {
    float dx = (p.x - E[i]) / E[i + 2], dz = (p.z - E[i + 1]) / E[i + 3];
    float rr = sqrt(dx * dx + dz * dz) + (n1 - 0.5) * 0.9 * %(noiseamp)g;
    float on = smooth(E[i + 5], E[i + 5] + 10.0, frame);
    mask = max(mask, (1 - smooth(1 - %(edge)g, 1.0, rr)) * E[i + 4] * on);
}
mask *= 1 - smooth(0.0, H, p.y);
float emit = 1 - smooth(%(emit_frames)g - 10.0, %(emit_frames)g * 1.0, frame);
float cell = %(floor)g + (1 - %(floor)g) * smooth(%(cell0)g, %(cell1)g, n2);   // hot spots = rising thermals
@density = mask * emit * %(rate)g * cell;
@temperature = mask * emit * %(temp)g * cell;
'''

# Inversion lid: a cold slab added to temperature every step (pyro source 3, operation Add). Thermals that reach it lose
# their buoyancy and spread sideways: flat tops, stratocumulus decks, the shelf a pileus sits on.
CAP_VEX = '''
float y0 = %(height)g, y1 = %(height)g + %(thick)g;
float w = smooth(y0 - %(soft)g, y0, @P.y) * (1 - smooth(y1, y1 + %(soft)g, @P.y));
@cap = -%(strength)g * w;
'''

REMAP_VEX = '''
@density = smooth(%(lo)g, %(hi)g, @density);
if (%(basefade)g > 0) @density *= smooth(%(base)g, %(base)g + %(basefade)g, @P.y);
'''

# Post warp of the finished density: vertical stretch k (a free plume is a cone about as tall as wide), a lean (x shifts by
# `shear` per unit of height, along +x; the library page yaws instances so the direction varies) and an optional flattening of
# everything above `flat` (squashed by `flatk`).  Output point P samples the remapped cloud at the inverse map.
WARP_VEX = '''
float k = %(stretch)g, sh = %(shear)g, fy = %(flat)g, fk = %(flatk)g;
float y = @P.y;
if (fy > 0 && y > fy) y = fy + (y - fy) * fk;
vector q = set(@P.x - sh * max(y, 0.0), y / k, @P.z);
@density = volumesample(1, "density", q);
'''

# Pileus: a thin smooth cap (an ellipsoidal shell, upper half) hovering above the tower top.  Centre and size are set per checkpoint.
PILEUS_VEX = '''
vector c = %(centre)s;
vector d = (@P - c) / set(%(rx)g, %(ry)g, %(rx)g);
float r = length(d);
float shell = 1 - smooth(0.0, %(thick)g, abs(r - 1.0) * %(ry)g);
float up = smooth(-0.15, 0.25, d.y);
float n = noise(@P * 2.3 + {4.2, 1.1, 7.7});
float edge = 1 - smooth(0.55, 0.95, length(set(d.x, 0, d.z)) + (n - 0.5) * 0.3);
@density = max(@density, %(density)g * shell * up * edge);
'''


def source_params(rcp):
    """The SOURCE_VEX substitutions: the recipe's source block plus the emitter list and the seed offset."""
    src = dict(rcp['source'])
    ems = src.get('emitters') or [[0.0, 0.0, src['radius'], src['radius'], 1.0, 0.0]]
    ems = [list(e) + [1.0, 0.0][len(e) - 4:] if len(e) < 6 else list(e) for e in ems]
    src['emitters'] = ', '.join('%g' % v for e in ems for v in e)
    seed = int(rcp.get('seed', 0))
    src['seedvec'] = '{%g, %g, %g}' % ((seed * 17.31) % 97.0, (seed * 7.77) % 89.0, (seed * 3.13) % 83.0) if seed else '{0, 0, 0}'
    return src, ems


def build(name, rcp, hip=None):
    obj = hou.node('/obj')
    geo = obj.node(name) or obj.createNode('geo', name)
    for c in geo.children():
        c.destroy()
    src, ems = source_params(rcp)
    ds = rcp['divsize']
    # source volume: the bounding box of all emitters, 1.6x their radii (the edge noise wobbles the outline outward)
    x0 = min(e[0] - 1.6 * e[2] for e in ems); x1 = max(e[0] + 1.6 * e[2] for e in ems)
    z0 = min(e[1] - 1.6 * e[3] for e in ems); z1 = max(e[1] + 1.6 * e[3] for e in ems)
    H = src['height']
    vols = []
    for nm in ('density', 'temperature'):
        v = geo.createNode('volume', 'src_' + nm)
        v.parm('name').set(nm)
        v.parm('uniformsamples').set(5)  # By Size (menu index; the labels are Non Square, X, Y, Z, Max Axis, By Size)
        v.parm('divsize').set(ds)
        v.parmTuple('size').set((x1 - x0, H * 2.5, z1 - z0))
        v.parmTuple('t').set(((x0 + x1) / 2, H * 1.25 - ds, (z0 + z1) / 2))
        vols.append(v)
    mg = geo.createNode('merge', 'src_merge')
    for i, v in enumerate(vols):
        mg.setInput(i, v)
    sw = geo.createNode('volumewrangle', 'source_noise')
    sw.setInput(0, mg)
    sw.parm('snippet').set(SOURCE_VEX % src)
    last_src = sw
    cap = rcp.get('cap')
    if cap:
        # the lid volume spans the emitters plus `reach` sideways (where the plume may spread), y in the cold slab
        reach, soft = cap.get('reach', 2.0), cap.get('soft', 0.1)
        cv = geo.createNode('volume', 'src_cap')
        cv.parm('name').set('cap')
        cv.parm('uniformsamples').set(5)
        cv.parm('divsize').set(ds)
        hy = cap['thick'] + 2 * soft
        cv.parmTuple('size').set((x1 - x0 + 2 * reach, hy, z1 - z0 + 2 * reach))
        cv.parmTuple('t').set(((x0 + x1) / 2, cap['height'] - soft + hy / 2, (z0 + z1) / 2))
        cw = geo.createNode('volumewrangle', 'cap_lid')
        cw.setInput(0, cv)
        cw.parm('snippet').set(CAP_VEX % dict(cap, soft=soft))
        m2 = geo.createNode('merge', 'src_merge_cap')
        m2.setInput(0, sw)
        m2.setInput(1, cw)
        last_src = m2
    ps = geo.createNode('pyrosolver', 'pyro')
    ps.setInput(0, last_src)
    ps.parm('divsize').set(ds)
    ps.parm('solver').set(0)  # sparse
    if cap:
        # source 3 (default flame <- burn) becomes temperature <- cap, operation Add, negatives allowed
        ps.parm('source_volume3').set('cap')
        ps.parm('source_vfield3').set('temperature')
        ps.parm('source_voperator3').set(1)
        ps.parm('source_nonneg3').set(0)
    if rcp.get('seed') and ps.parm('turbulence_seed'):
        ps.parm('turbulence_seed').set(int(rcp['seed']))
    for k, v in rcp['solver'].items():
        ps.parm(k).set(v)
    kp = geo.createNode('blast', 'keep_density')
    kp.setInput(0, ps)
    kp.parm('group').set('@name=density')
    kp.parm('negate').set(1)
    cv = geo.createNode('convertvdb', 'to_vdb')
    cv.setInput(0, kp)
    cv.parm('conversion').set('vdb')
    cv.parm('vdbclass').set('fog') if cv.parm('vdbclass') else None
    rm = geo.createNode('volumewrangle', 'remap')
    rm.setInput(0, cv)
    rm.parm('snippet').set(REMAP_VEX % rcp['remap'])
    prev = rm
    if needs_warp(rcp):
        # Grow the active region (bounds set per checkpoint by grow_region), then resample the remapped cloud through WARP_VEX.
        act = geo.createNode('vdbactivate', 'grow_region')
        act.setInput(0, rm)
        act.parm('operation').set(0)
        act.parm('setvalue').set(1)
        act.parm('value').set(0.0)
        st = geo.createNode('volumewrangle', 'stretch_y')
        st.setInput(0, act)
        st.setInput(1, rm)
        st.parm('snippet').set(WARP_VEX % warp_params(rcp))
        prev = st
        if rcp.get('pileus'):
            pw = geo.createNode('volumewrangle', 'pileus')
            pw.setInput(0, st)
            prev = pw
    if rcp.get('smooth'):
        sm = geo.createNode('vdbsmooth', 'smooth')
        sm.setInput(0, prev)
        sm.parm('operation').set('mean')
        sm.parm('iterations').set(rcp['smooth'])
        sm.parm('radius').set(1)
        prev = sm
    prev.setDisplayFlag(True)
    geo.layoutChildren()
    return geo, ps, prev


def warp_params(rcp):
    r = rcp['remap']
    return dict(stretch=r.get('stretch', 1.0), shear=r.get('shear', 0.0), flat=r.get('flat', 0.0), flatk=r.get('flatk', 1.0))


def needs_warp(rcp):
    w = warp_params(rcp)
    return w['stretch'] != 1.0 or w['shear'] != 0.0 or w['flat'] > 0 or bool(rcp.get('pileus'))


def grow_region(geo, rcp):
    """Point the vdbactivate box at the warped cloud's bounds (top raised by the stretch, x widened by the lean, room for a
    pileus), and place the pileus over the tower top.  Called per checkpoint."""
    pr = next(p for p in geo.node('remap').geometry().prims() if isinstance(p, hou.VDB))
    bb = pr.activeVoxelBoundingBox()
    c0, c1 = pr.indexToPos(tuple(int(math.floor(v)) for v in bb.minvec())), pr.indexToPos(tuple(int(math.ceil(v)) for v in bb.maxvec()))
    mn = [min(c0[i], c1[i]) for i in range(3)]
    mx = [max(c0[i], c1[i]) for i in range(3)]
    w = warp_params(rcp)
    k = w['stretch']
    top = max(mx[1], 0.0) * k
    if w['flat'] > 0 and top > w['flat']:
        top = w['flat'] + (top - w['flat']) / max(w['flatk'], 1e-3)
    mx[1] = top + (mx[1] - max(mx[1], 0.0))
    lean = w['shear'] * top
    if lean > 0:
        mx[0] += lean
    else:
        mn[0] += lean
    pil = rcp.get('pileus')
    if pil:
        # top centre of the remapped cloud's body: density-weighted centroid of the layers just below its top, mapped through the warp
        import numpy as np
        lo = [int(math.floor(v)) for v in bb.minvec()]
        hi = [int(math.ceil(v)) for v in bb.maxvec()]
        n = [hi[i] - lo[i] for i in range(3)]
        d = np.asarray(pr.voxelRangeAsFloat(hou.BoundingBox(*lo, *hi)), dtype=np.float32).reshape(n[2], n[1], n[0])
        area = (d > 0.5).sum(axis=(0, 2))           # per y layer; the top is where the body (not a stray wisp) ends
        ytop = int(np.nonzero(area >= 0.1 * area.max())[0].max())
        band = d[:, max(0, ytop - max(2, int(0.12 * n[1]))):ytop + 1, :].sum(axis=1)
        zz, xx = np.nonzero(band > 0.3)
        wgt = band[zz, xx]
        ci = [float((xx * wgt).sum() / wgt.sum()) + lo[0], ytop + lo[1], float((zz * wgt).sum() / wgt.sum()) + lo[2]]
        cw = pr.indexToPos(tuple(int(round(v)) for v in ci))
        ys = max(cw[1], 0.0)
        cx, cy, cz = cw[0] + w['shear'] * ys * k, ys * k, cw[2]
        if w['flat'] > 0 and cy > w['flat']:
            cy = w['flat'] + (cy - w['flat']) / max(w['flatk'], 1e-3)
        # the shell's centre sits below the dome apex: apex = top + gap
        rx, ry = pil['rx'], pil['ry']
        centre = (cx, cy + pil['gap'] - ry, cz)
        geo.node('pileus').parm('snippet').set(PILEUS_VEX % dict(centre='{%g, %g, %g}' % centre, rx=rx, ry=ry, thick=pil['thick'], density=pil.get('density', 0.8)))
        mn[0] = min(mn[0], cx - rx * 1.1); mx[0] = max(mx[0], cx + rx * 1.1)
        mn[2] = min(mn[2], cz - rx * 1.1); mx[2] = max(mx[2], cz + rx * 1.1)
        mx[1] = max(mx[1], cy + pil['gap'] + pil['thick'] + 0.1)
    a = geo.node('grow_region')
    a.parmTuple('min').set(mn)
    a.parmTuple('max').set(mx)
    a.parmTuple('center').set([(mn[i] + mx[i]) / 2 for i in range(3)])
    a.parmTuple('size').set([mx[i] - mn[i] for i in range(3)])


def convert(name, vdb_path, rcp, assets_dir, extra=()):
    out = os.path.join(assets_dir, name)
    hython = os.path.join(hou.text.expandString('$HFS'), 'bin', 'hython')
    cmd = [hython, CONVERTER, '--mode', 'fog', vdb_path, '--out', out, '--voxel-size', str(rcp.get('voxel', 8)), '--name', name,
           '--world-scale', str(rcp['world_scale'])] + [str(a) for a in rcp.get('convert', [])] + [str(a) for a in extra]
    print('[convert]', ' '.join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(r.stdout[-1500:])
    if r.returncode:
        sys.stderr.write(r.stderr)
        raise SystemExit('converter failed')
    size = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out))
    print(f'[{name}] {out}: {size / 1048576:.2f} MiB')
    return out, size


def apply_overrides(rcp, sets):
    for item in sets:
        key, val = item.split('=', 1)
        if '.' not in key:
            rcp[key] = json.loads(val)
            continue
        sec, parm = key.split('.')
        rcp[sec][parm] = json.loads(val) if val[:1] in '[{' else float(val) if '.' in val or 'e' in val else int(val)


def prune_islands(path, iso=0.3, keep=0.04, log=print):
    """Zero the detached blobs: 6-connected components of density >= iso smaller than `keep` x the largest one.  Pure numpy
    (label propagation with pointer jumping; hython has no scipy), on a dense copy via Houdini volume <-> VDB verbs."""
    import numpy as np
    geo = hou.Geometry()
    geo.loadFromFile(path)
    cv = hou.sopNodeTypeCategory().nodeVerb('convertvdb')
    vol = hou.Geometry()
    cv.setParms({'conversion': 0})
    cv.execute(vol, [geo])
    prim = next(p for p in vol.prims() if isinstance(p, hou.Volume))
    rx, ry, rz = prim.resolution()
    d = np.asarray(prim.allVoxels(), dtype=np.float32).reshape(rz, ry, rx)
    mask = d >= iso
    n = mask.size
    lab = np.where(mask, np.arange(1, n + 1, dtype=np.int64).reshape(mask.shape), 0)
    for it in range(2000):
        prev = lab
        m = lab.copy()
        for ax in range(3):
            for sh in (1, -1):
                r = np.roll(lab, sh, axis=ax)
                edge = [slice(None)] * 3
                edge[ax] = 0 if sh == 1 else -1
                r[tuple(edge)] = 0
                np.maximum(m, np.where(mask, r, 0), out=m)
        flat = m.ravel()
        for _ in range(4):  # pointer jumping: adopt the label of the voxel your label names
            nz = flat > 0
            flat = np.where(nz, np.maximum(flat, flat[np.maximum(flat - 1, 0)]), 0)
        lab = flat.reshape(mask.shape)
        if np.array_equal(lab, prev):
            break
    ids, counts = np.unique(lab[mask], return_counts=True)
    if len(ids) <= 1:
        return 0
    small = ids[counts < keep * counts.max()]
    drop = np.isin(lab, small)
    removed = int(drop.sum())
    # also clear the sub-iso halo around each dropped blob (one dilation), so no faint ghost remains
    halo = drop.copy()
    for ax in range(3):
        for sh in (1, -1):
            halo |= np.roll(drop, sh, axis=ax)
    keep_mask = np.zeros_like(mask)
    keep_mask[mask & ~drop] = True
    d[halo & ~keep_mask] = 0.0
    prim.setAllVoxels(d.ravel().tolist())
    back = hou.Geometry()
    cv.setParms({'conversion': 1, 'vdbclass': 2})
    cv.execute(back, [vol])
    back.saveToFile(path)
    log(f'  [prune] {len(small)} of {len(ids)} pieces removed ({removed} voxels), {it + 1} sweeps')
    return removed


def simulate(name, rcp, work_dir, last=None, outs=None, tag='', hip=None, previews=True, log=print):
    """Run the sim, cache the post-processed density at the `outs` frames as <name><tag>_fNNN.vdb (+ PNG preview).
    Returns (paths by frame, sim seconds)."""
    last = last or rcp['frames']
    outs = sorted(set(outs or [f for f in rcp['out_frames'] if f <= last]) | {last})
    os.makedirs(work_dir, exist_ok=True)
    geo, ps, post = build(name + tag, rcp, hip)
    t0 = time.time()
    paths = {}
    for f in range(1, last + 1):
        hou.setFrame(f)
        tf = time.time()
        g = ps.geometry()
        if g is None:
            raise SystemExit(("pyro errors: " + str([(n.name(), n.errors()[0][:300]) for n in geo.children() if n.errors()]))[:1500])
        if f % 20 == 0 or f == 1:
            d = next(p for p in g.prims() if p.attribValue('name') == 'density')
            log(f'  frame {f}: {time.time() - tf:.1f}s  grid {d.resolution()}  total {time.time() - t0:.0f}s')
        if f in outs:
            if needs_warp(rcp):
                grow_region(geo, rcp)
            pg = post.geometry()
            if pg is None:
                raise SystemExit(("post errors: " + str([(n.name(), n.errors()[0][:300]) for n in geo.children() if n.errors()]))[:1500])
            path = os.path.join(work_dir, f'{name}{tag}_f{f:03d}.vdb')
            pg.saveToFile(path)
            if rcp.get('prune'):
                prune_islands(path, rcp.get('prune_iso', 0.3), rcp['prune'], log)
            if previews:
                build_heroes.preview(path, path[:-4] + '.png')
            paths[f] = path
    secs = time.time() - t0
    log(f'[sim] {name}{tag}: {last} frames in {secs:.0f}s')
    if hip:
        hou.hipFile.save(hip)
    return paths, secs


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('name', choices=list(RECIPES))
    ap.add_argument('--work-dir', default=os.path.join(REPO, 'work', 'captures', 'scratch', 'p4f'))
    ap.add_argument('--assets-dir', default=os.path.join(REPO, 'assets', 'clouds', 'heroes'))
    ap.add_argument('--frames', type=int, help='stop the sim here (default: recipe)')
    ap.add_argument('--out-frames', help='comma list of frames to cache as VDB+PNG (default: recipe)')
    ap.add_argument('--divsize', type=float)
    ap.add_argument('--set', action='append', default=[], metavar='SECTION.PARM=VALUE',
                    help='override, e.g. solver.turbulence=1.0 source.rate=0.4 remap.lo=0.2')
    ap.add_argument('--tag', default='', help='suffix on cache file names (experiments)')
    ap.add_argument('--convert-frame', type=int, help='after the sim, convert this cached frame into assets (default: last)')
    ap.add_argument('--no-convert', action='store_true')
    ap.add_argument('--fine-voxel-size', type=float, help='hero: also write fine.vdb/fine.nvdb at this voxel size (4 = default hero tier) and derive the coarse field from it')
    ap.add_argument('--fine-shell', type=float, help='hero: keep fine voxels only this many metres inside the surface')
    ap.add_argument('--drop-fine-vdb', action='store_true', help='hero: delete fine.vdb after fine.nvdb is verified')
    ap.add_argument('--hip')
    ap.add_argument('--convert-only', metavar='VDB', help='skip the sim: just convert this cached VDB into assets/clouds/heroes/sim-NAME')
    a = ap.parse_args()
    extra = (['--fine-voxel-size', a.fine_voxel_size] if a.fine_voxel_size else []) + (['--fine-shell', a.fine_shell] if a.fine_shell else []) + (['--drop-fine-vdb'] if a.drop_fine_vdb else [])
    rcp = json.loads(json.dumps(RECIPES[a.name]))
    apply_overrides(rcp, a.set)
    if a.divsize:
        rcp['divsize'] = a.divsize
    if a.convert_only:
        convert('sim-' + a.name, a.convert_only, rcp, a.assets_dir, extra)
        return
    outs = [int(x) for x in a.out_frames.split(',')] if a.out_frames else None
    paths, _ = simulate(a.name, rcp, a.work_dir, a.frames, outs, a.tag, a.hip)
    if not a.no_convert:
        cf = a.convert_frame or max(paths)
        convert('sim-' + a.name, paths[cf], rcp, a.assets_dir, extra)


if __name__ == '__main__':
    main()
