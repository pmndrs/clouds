"""A2 (AU3): lens-seeded Pyro cumulus, the Guerrilla Aero / EmberGen CloudPack way.

One thin, wide, flat lens of heat and smoke at the cloud base, emitted in a single short burst; working buoyancy; heat
diffusion, cooling and heavy smoke stop the plume by themselves (no lid, no stretch, no post warp).  Sources:
docs/research/sources/n3/slides-047-074.md (s64: Aero sims seeded by a flat lens), docs/research/cloudpack-embergen.md
(EmberGen seed + solver), work/reports/L1.md + L2.md (our Pyro history: T0 = 0 bug, lids, chimneys).

  HYTHON=/Applications/Houdini/Houdini21.0.671/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython
  $HYTHON scripts/vdb/authoring/sim/lens_seed.py run base                 # sim + checkpoints + metrics + convert the pick frame
  $HYTHON scripts/vdb/authoring/sim/lens_seed.py run base wide hot cool   # several variants
  $HYTHON scripts/vdb/authoring/sim/lens_seed.py run base --set solver.tempcooling=0.4 --tag _c4 --no-convert
  $HYTHON scripts/vdb/authoring/sim/lens_seed.py rig                      # write houdini/rigs/lens_seed.hip (network only)
  python3 scripts/vdb/authoring/sim/lens_seed.py sheet OUT.png base wide  # side projections (EmberGen-thumbnail style) + metrics

Network (one geo, SOP level; every number is a channel on the CONTROLS null, so the rig is edited from one panel):
  volume(density) + volume(temperature) -> merge -> volumewrangle LENS (the seed + burst window) -> pyrosolver
  -> blast(keep density) -> convertvdb -> volumewrangle SHAPE (density shoulder) -> volumewrangle BASE_CUT (flat floor at the
  seed base) -> OUT (null) -> rop_geometry EXPORT ($HIP/../cache/lens_seed/).
Sim scale: 1 sim unit = `world_scale` metres (100, as in sim_clouds.py); Y is up in Houdini and in the converter (no rotation).
"""
import argparse, json, math, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
CONVERTER = os.path.join(REPO, 'scripts', 'vdb', 'vdb_to_nvdf.py')
# Scratch output lives in the main checkout's artifacts/ (never committed); the converted NVDFs are linked into the lab's
# gitignored assets/clouds/local/a2 so the dev server can serve them.
MAIN = REPO.split('/.claude/worktrees/')[0]
SCRATCH = os.path.join(MAIN, 'artifacts', 'a2-lens-seed')
RIG = os.path.join(REPO, 'houdini', 'rigs', 'lens_seed.hip')

# --- recipe ----------------------------------------------------------------------------------------------------------
# lens:   rx, rz = horizontal radii (sim units; z is the long axis), thick = full thickness, base = y of the lens floor;
#         edge_amp / edge_freq = noise that breaks the ellipse outline (EmberGen: smooth-intersected with noise of scale ~0.6 R);
#         heat = temperature inside the lens, heat_floor / heat_freq = how uneven the heat is inside (cells become turrets);
#         smoke = density emitted; burst = emission window in frames (EmberGen burst 0.5 s = 12 frames at 24 fps)
# solver: real pyrosolver parm names.  T0 = 1, T1 = 2 so buoyancy works (L1).  tempdiffusion / tempcooling / density gravity
#         make the plume self-limiting (EmberGen: temperature diffusion 79, cooling 56, smoke weight 48 vs buoyancy 11).
# shape:  lo, hi = sim density mapped to 0..1 (smoothstep); base_fade = soft floor below the seed base (sim units; 0 = no cut)
BASE = dict(
    world_scale=100.0, divsize=0.08, frames=160, out_frames=[60, 90, 110, 130, 160], pick=110,
    lens=dict(rx=3.0, rz=6.5, thick=1.0, base=0.0, edge_amp=0.35, edge_freq=0.45, heat=1.0, heat_floor=0.7, heat_freq=0.6,
              smoke=1.0, burst=12),
    solver=dict(temperature0=1.0, temperature1=2.0, buoyancylift=1.2, tempcooling=0.2, tempdiffusion=0.1, dissipation=0.01,
                enable_density_gravity=1, density_gravity_scale=0.22,
                enable_disturbance=1, disturbance=0.25, disturbance_blocksize=0.4,
                enable_turbulence=1, turbulence=0.15, turbulence_swirlsize=1.5,
                enable_shredding=0, shredding=0.5, shredding_field='temperature'),
    floor=1,
    shape=dict(lo=0.04, hi=0.5, base_fade=0.12),
    convert=['--iso', '0.1', '--margin', '1', '--rotate-y', '90'], voxel=8,   # rotate: the long side faces the lab's edge/ground bookmarks
)

# Variants: what each changes from BASE (lens aspect, burst strength, cooling).
VARIANTS = {
    'base': dict(note='EmberGen-like lens (6 x 13 x 1 units = 600 x 1300 x 100 m), 12-frame burst'),
    'wide': dict(note='wider, rounder lens (9 x 13): broad mediocris', lens=dict(rx=4.5)),
    'hot': dict(note='stronger burst: 1.6x heat, 1.2x smoke, 18 frames', lens=dict(heat=1.6, burst=18, smoke=1.2)),
    'cool': dict(note='faster cooling + more heat diffusion: stalls lower, flatter', solver=dict(tempcooling=0.4, tempdiffusion=0.3)),
}

LENS_VEX = r'''
// The seed: a thin flat ellipsoidal lens with a noisy outline, filled with smoke and uneven heat, emitted only during the burst.
string C = "../CONTROLS/";
float rx = chf(C + "lens_rx"), rz = chf(C + "lens_rz"), th = chf(C + "lens_thick"), y0 = chf(C + "lens_base");
float burst = chf(C + "burst_frames");
float frame = `$FF`;
vector p = @P;
vector q = set(p.x / rx, (p.y - y0 - th * 0.5) / (th * 0.5), p.z / rz);
float n_edge = noise(p * chf(C + "edge_freq") + {3.1, 1.7, 9.2});
float r = length(q) + (n_edge - 0.5) * 2.0 * chf(C + "edge_amp");
float inside = 1 - smooth(0.85, 1.0, r);                                // a lens with a soft rim
float n_heat = noise(p * chf(C + "heat_freq") + {7.3, 2.1, 0.4});
float hf = chf(C + "heat_floor");
float cells = hf + (1 - hf) * smooth(0.4, 0.65, n_heat);                // uneven heat: the hotter cells become the turrets
float on = 1 - smooth(burst - 2.0, burst, frame);                       // one burst, then nothing
@density = inside * on * chf(C + "smoke");
@temperature = inside * on * cells * chf(C + "heat");
'''

SHAPE_VEX = r'''
// density shoulder: sim density lo..hi -> 0..1
@density = smooth(chf("../CONTROLS/shape_lo"), chf("../CONTROLS/shape_hi"), @density);
'''

BASE_CUT_VEX = r'''
// flat floor at the seed base (EmberGen also cuts its floor flat); base_fade = 0 disables it
float f = chf("../CONTROLS/base_fade");
if (f > 0) @density *= smooth(chf("../CONTROLS/lens_base") - f, chf("../CONTROLS/lens_base"), @P.y);
'''

# CONTROLS channels: (name, label, recipe path).  Pyro parms bind to these by expression.
CONTROLS = [
    ('Lens (the seed)', [
        ('lens_rx', 'Lens radius X', 'lens.rx'), ('lens_rz', 'Lens radius Z (long)', 'lens.rz'), ('lens_thick', 'Lens thickness', 'lens.thick'),
        ('lens_base', 'Lens base height (cloud base)', 'lens.base'), ('edge_amp', 'Outline noise amount', 'lens.edge_amp'),
        ('edge_freq', 'Outline noise frequency', 'lens.edge_freq'), ('heat', 'Heat', 'lens.heat'), ('heat_floor', 'Heat floor (0 = only hot cells)', 'lens.heat_floor'),
        ('heat_freq', 'Heat cell frequency', 'lens.heat_freq'), ('smoke', 'Smoke', 'lens.smoke'), ('burst_frames', 'Burst length (frames)', 'lens.burst')]),
    ('Solver', [
        ('divsize', 'Voxel size (sim units)', 'divsize'), ('buoyancylift', 'Buoyancy', 'solver.buoyancylift'), ('tempcooling', 'Cooling rate', 'solver.tempcooling'),
        ('tempdiffusion', 'Heat diffusion', 'solver.tempdiffusion'), ('dissipation', 'Smoke dissipation', 'solver.dissipation'),
        ('density_gravity_scale', 'Smoke weight (density gravity)', 'solver.density_gravity_scale'),
        ('disturbance', 'Disturbance', 'solver.disturbance'), ('disturbance_blocksize', 'Disturbance block size', 'solver.disturbance_blocksize'),
        ('turbulence', 'Turbulence', 'solver.turbulence'), ('turbulence_swirlsize', 'Turbulence swirl size', 'solver.turbulence_swirlsize'),
        ('shredding', 'Shredding (if enabled)', 'solver.shredding'),
        ('floor', 'Closed floor at the lens base (1 = on)', 'floor')]),
    ('Shape (post)', [
        ('shape_lo', 'Density low', 'shape.lo'), ('shape_hi', 'Density high', 'shape.hi'), ('base_fade', 'Base cut fade (0 = off)', 'shape.base_fade')]),
]

NOTES = {
    'CONTROLS': 'CONTROLS\nEvery number of the rig lives here. Lens = the seed (Aero / EmberGen: a thin flat lens at the cloud base, '
                'one burst). Solver = buoyancy vs heat diffusion, cooling and smoke weight: the plume must stop itself (no lid). '
                'Shape = post density shoulder and the flat floor cut.\n1 sim unit = 100 m.',
    'lens': 'SEED\nA flat ellipsoid lens (thickness ~1/10 of its length, like EmberGen 5 : 11.5 : 1) with a noisy outline. '
            'Smoke fills it; heat is uneven (hot cells -> turrets). Emitted only for the first burst_frames (12 = 0.5 s), then off.\n'
            'Sources: N3 s64 (Aero sims grow from a lens), docs/research/cloudpack-embergen.md.',
    'pyro': 'PYRO\nT0 = 1, T1 = 2 so buoyancy actually works (T0 = 0 divides by zero: L1). Heat diffusion + cooling kill the lift, '
            'density gravity (heavy smoke) holds the base down, disturbance breaks the top into turrets. No lid, no wind, no stretch.',
    'post': 'POST\nKeep density, convert to VDB, smoothstep shoulder, flat floor at the seed base, OUT. EXPORT writes VDBs to '
            '$HIP/../cache/lens_seed/; convert with scripts/vdb/vdb_to_nvdf.py --mode fog --world-scale 100 --voxel-size 8 (Y-up, no rotation).',
}


def merged(name, sets=()):
    r = json.loads(json.dumps(BASE))
    for k, v in VARIANTS[name].items():
        if isinstance(v, dict):
            r[k].update(v)
        else:
            r[k] = v
    for item in sets:
        key, val = item.split('=', 1)
        try:
            v = json.loads(val)
        except ValueError:
            v = val
        if '.' in key:
            sec, parm = key.split('.')
            r[sec][parm] = v
        else:
            r[key] = v
    return r


def get(rcp, path):
    v = rcp
    for k in path.split('.'):
        v = v[k]
    return v


# --- the network -----------------------------------------------------------------------------------------------------
def build(rcp, name='lens_seed'):
    import hou
    obj = hou.node('/obj')
    old = obj.node(name)
    if old:
        old.destroy()
    geo = obj.createNode('geo', name)
    ctl = geo.createNode('null', 'CONTROLS')
    ctl.setColor(hou.Color(0.9, 0.75, 0.2))
    tg = ctl.parmTemplateGroup()
    for folder, items in CONTROLS:
        f = hou.FolderParmTemplate(folder.split()[0].lower(), folder)
        for pn, label, path in items:
            f.addParmTemplate(hou.FloatParmTemplate(pn, label, 1, default_value=(float(get(rcp, path)),)))
        tg.append(f)
    ctl.setParmTemplateGroup(tg)
    C = '../CONTROLS/'
    ch = lambda pn: 'ch("%s%s")' % (C, pn)

    # source volumes: the lens box (1.5x the radii: the outline noise reaches out), y over the lens thickness
    vols = []
    for nm in ('density', 'temperature'):
        v = geo.createNode('volume', 'src_' + nm)
        v.parm('name').set(nm)
        v.parm('uniformsamples').set(5)   # By Size
        v.parm('divsize').setExpression(ch('divsize'))
        v.parm('sizex').setExpression('3.0 * ' + ch('lens_rx'))
        v.parm('sizey').setExpression(ch('lens_thick') + ' + 2 * ' + ch('divsize'))
        v.parm('sizez').setExpression('3.0 * ' + ch('lens_rz'))
        v.parm('ty').setExpression(ch('lens_base') + ' + 0.5 * ' + ch('lens_thick'))
        vols.append(v)
    mg = geo.createNode('merge', 'src_merge')
    for i, v in enumerate(vols):
        mg.setInput(i, v)
    lens = geo.createNode('volumewrangle', 'LENS')
    lens.setInput(0, mg)
    lens.parm('snippet').set(LENS_VEX)

    ps = geo.createNode('pyrosolver', 'pyro')
    ps.setInput(0, lens)
    ps.parm('solver').set(0)   # sparse
    ps.parm('divsize').setExpression(ch('divsize'))
    # sources: density Add (the burst adds smoke), temperature Maximum (the lens is held at its heat during the burst; after
    # it the source is zero, so it changes nothing; Pull, the default, would keep cooling the lens region toward 0)
    ps.parm('source_voperator1').set(1)
    ps.parm('source_voperator2').set(5)
    for k, v in rcp['solver'].items():
        p = ps.parm(k)
        if p is None:
            raise SystemExit('no pyrosolver parm ' + k)
        if any(pn == k for _, items in CONTROLS for pn, _, _ in items):
            p.setExpression(ch(k))
        else:
            p.set(v)

    # the condensation level: a closed ground plane at the lens base.  Heavy (density-gravity) smoke that has lost its heat
    # settles on it and spreads into the flat base instead of falling out of the cloud (EmberGen's base sits on its domain floor).
    ps.parm('closeystatus').setExpression('if(%s > 0.5, 1, 0)' % ch('floor'))
    ps.parm('closeyat').setExpression(ch('lens_base'))

    kp = geo.createNode('blast', 'keep_density')
    kp.setInput(0, ps)
    kp.parm('group').set('@name=density')
    kp.parm('negate').set(1)
    cv = geo.createNode('convertvdb', 'to_vdb')
    cv.setInput(0, kp)
    cv.parm('conversion').set('vdb')
    sh = geo.createNode('volumewrangle', 'SHAPE')
    sh.setInput(0, cv)
    sh.parm('snippet').set(SHAPE_VEX)
    bc = geo.createNode('volumewrangle', 'BASE_CUT')
    bc.setInput(0, sh)
    bc.parm('snippet').set(BASE_CUT_VEX)
    out = geo.createNode('null', 'OUT')
    out.setInput(0, bc)
    out.setDisplayFlag(True)
    out.setRenderFlag(True)
    rop = geo.createNode('rop_geometry', 'EXPORT')
    rop.setInput(0, out)
    rop.parm('sopoutput').set('$HIP/../cache/lens_seed/lens_seed.$F4.vdb')

    # layout: CONTROLS on the left, the chain in a column, a sticky note beside each stage
    col = [mg, lens, ps, kp, cv, sh, bc, out, rop]
    vols[0].setPosition(hou.Vector2(-1.5, 2)); vols[1].setPosition(hou.Vector2(1.5, 2))
    for i, n in enumerate(col):
        n.setPosition(hou.Vector2(0, 1 - 1.3 * i))
    ctl.setPosition(hou.Vector2(-6, 2))
    for key, at, size in (('CONTROLS', (-10, -1.5), (6, 3.2)), ('lens', (3, 0.5), (7, 2.6)), ('pyro', (3, -2.6), (7, 2.2)), ('post', (3, -7.5), (7, 2.6))):
        st = geo.createStickyNote(key + '_note')
        st.setText(NOTES[key])
        st.setPosition(hou.Vector2(*at))
        st.setSize(hou.Vector2(*size))
    hou.playbar.setFrameRange(1, rcp['frames'])
    hou.playbar.setPlaybackRange(1, rcp['frames'])
    return geo, ps, sh, out


# --- reading results -------------------------------------------------------------------------------------------------
def vdb_array(geo_or_node):
    """Dense [z, y, x] float32 array of the density VDB, plus the world position of index (lo) and the voxel size (sim units)."""
    import hou, numpy as np
    g = geo_or_node.geometry() if hasattr(geo_or_node, 'geometry') else geo_or_node
    pr = next(p for p in g.prims() if isinstance(p, hou.VDB))
    bb = pr.activeVoxelBoundingBox()
    lo = [int(math.floor(v)) for v in bb.minvec()]
    hi = [int(math.ceil(v)) + 1 for v in bb.maxvec()]
    n = [hi[i] - lo[i] for i in range(3)]
    a = np.asarray(pr.voxelRangeAsFloat(hou.BoundingBox(*lo, *hi)), dtype=np.float32).reshape(n[2], n[1], n[0])
    org = pr.indexToPos(tuple(lo))
    return a, (org[0], org[1], org[2]), pr.voxelSize()[0]


def _blur(h, s):
    import numpy as np
    r = max(1, int(3 * s)); k = np.exp(-0.5 * (np.arange(-r, r + 1) / max(s, 1e-3)) ** 2); k /= k.sum()
    for ax in (0, 1):
        h = np.apply_along_axis(lambda v: np.convolve(v, k, mode='same'), ax, h)
    return h


def _localmax(h, r):
    import numpy as np
    p = np.pad(h, r, constant_values=-1); out = np.ones(h.shape, bool)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out &= h >= p[r + dy:r + dy + h.shape[0], r + dx:r + dx + h.shape[1]]
    return out


def metrics(a, org, vs, rcp, iso=0.25):
    """Shape numbers in metres, comparable with docs/research/cloudpack-embergen.md (same definitions, voxel radii scaled to metres:
    EmberGen at 4 m/voxel used blur 3 and window 7 voxels = 12 m and 28 m).  a is [z, y, x] with y up."""
    import numpy as np
    ws = rcp['world_scale']
    m = a > iso
    if not m.any():
        return dict(empty=True)
    vm = vs * ws
    yc = m.sum(axis=(0, 2))                                   # footprint area per y layer (voxels)
    ys = np.nonzero(yc)[0]
    first, last = int(ys[0]), int(ys[-1])
    base = int(np.nonzero(yc >= 0.25 * yc.max())[0][0])      # flat base: first layer with 25 % of the widest footprint
    wid = int(np.argmax(yc))
    y_of = lambda i: org[1] + i * vs                          # sim units
    lens = rcp['lens']
    H = (last + 1 - base) * vm
    foot = m.any(axis=1)                                      # [z, x]
    fz, fx = np.nonzero(foot)
    ext_x = (fx.max() - fx.min() + 1) * vm; ext_z = (fz.max() - fz.min() + 1) * vm
    # footprint extents at the base layer band (base .. base + 5 % H)
    band = m[:, base:base + max(1, int(0.05 * (last - base + 1))) + 1, :].any(axis=1)
    bz, bx = np.nonzero(band)
    hm = np.where(foot, m.shape[1] - np.argmax(m[:, ::-1, :], axis=1), 0).astype(np.float32)   # top height map (index, [z, x])
    hs = _blur(hm, 12.0 / vm)
    half = base + 0.5 * (last + 1 - base)
    mx = _localmax(hs, max(1, int(round(28.0 / vm)))) & (hs > half) & foot
    k = int(mx.sum())
    prof = [round(float(yc[min(last, base + int(q * (last - base)))]) / yc.max(), 2) for q in (0.02, 0.1, 0.25, 0.5, 0.75, 0.9)]
    return dict(
        seedBase=round(lens['base'] * ws, 1), seedSize=[round(2 * lens['rx'] * ws), round(2 * lens['rz'] * ws), round(lens['thick'] * ws)],
        lowest=round(y_of(first) * ws, 1), base=round(y_of(base) * ws, 1), top=round(y_of(last + 1) * ws, 1), height=round(H, 1),
        widestAt=round((y_of(wid) - y_of(base)) * ws / max(H, 1), 2),
        extentXZ=[round(ext_x), round(ext_z)], baseExtentXZ=[round((bx.max() - bx.min() + 1) * vm), round((bz.max() - bz.min() + 1) * vm)],
        widthOverSeed=[round(ext_x / (2 * lens['rx'] * ws), 2), round(ext_z / (2 * lens['rz'] * ws), 2)],
        topOverThickness=round(H / (lens['thick'] * ws), 2), lenOverH=round(max(ext_x, ext_z) / max(H, 1), 2),
        areaProfile=prof, turrets=k, turretSpacing=round(float(np.sqrt(foot.sum() / max(k, 1))) * vm, 1),
        massBelowSeed=round(float(a[:, :max(0, int(round((lens['base'] - org[1]) / vs))), :].sum() / max(a.sum(), 1e-9)), 3),
        voxels=int(m.sum()))


# --- run ---------------------------------------------------------------------------------------------------------------
def measure_nvdf(out_dir):
    """Manifest numbers for the lab's target page (copied from library.measure: base/top above the asset box floor)."""
    import numpy as np
    cj = json.load(open(os.path.join(out_dir, 'cloud.json')))
    w, h, d = cj['dims']
    vs = cj['voxelSizeMeters']
    r = np.fromfile(os.path.join(out_dir, 'nvdf.bin'), np.uint8).reshape(d, h, w, 4)[..., 0]
    occ = (r > 0).reshape(d, -1)
    layers = np.nonzero(occ.any(axis=1))[0]
    cover = occ.sum(axis=1)
    base_z = int(np.nonzero(cover >= 0.25 * cover.max())[0][0])
    return dict(dims=cj['dims'], voxelSizeMeters=vs, sizeMeters=[w * vs, h * vs, d * vs],
                baseMeters=round(base_z * vs, 1), lowestMeters=round(int(layers[0]) * vs, 1), topMeters=round((int(layers[-1]) + 1) * vs, 1))


def convert(name, vdb, rcp, log):
    import hou
    out = os.path.join(SCRATCH, 'nvdf', name)
    hython = os.path.join(hou.text.expandString('$HFS'), 'bin', 'hython')
    cmd = [hython, CONVERTER, '--mode', 'fog', vdb, '--out', out, '--voxel-size', str(rcp['voxel']), '--name', name,
           '--world-scale', str(rcp['world_scale'])] + [str(x) for x in rcp['convert']]
    log('[convert] ' + ' '.join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        sys.stderr.write(r.stdout[-2000:] + r.stderr[-3000:])
        raise SystemExit('converter failed')
    m = measure_nvdf(out)
    json.dump(dict(name=name, recipe=rcp, **m), open(os.path.join(out, 'manifest.json'), 'w'), indent=2)
    link = os.path.join(REPO, 'assets', 'clouds', 'local', 'a2')
    if not os.path.exists(link):
        os.makedirs(os.path.dirname(link), exist_ok=True)
        os.symlink(os.path.join(SCRATCH, 'nvdf'), link)
    log(f'[{name}] {out}: dims {m["dims"]}, base {m["baseMeters"]} top {m["topMeters"]} m')
    return out


def run(name, rcp, tag='', do_convert=True, log=print):
    import hou, numpy as np
    hou.hipFile.clear(suppress_save_prompt=True)
    hou.setFps(24)
    geo, ps, sh, out = build(rcp)
    vdir = os.path.join(SCRATCH, 'vdb'); os.makedirs(vdir, exist_ok=True)
    ndir = os.path.join(SCRATCH, 'npy'); os.makedirs(ndir, exist_ok=True)
    outs = sorted(set(rcp['out_frames']) | {rcp['frames']})
    res = dict(name=name + tag, recipe=rcp, frames={})
    t0 = time.time()
    for f in range(1, rcp['frames'] + 1):
        hou.setFrame(f)
        g = ps.geometry()
        if g is None or ps.errors():
            raise SystemExit('pyro errors: ' + str([(n.name(), n.errors()) for n in geo.children() if n.errors()])[:1500])
        if f % 25 == 0:
            log(f'  {name}{tag} frame {f}  {time.time() - t0:.0f}s')
        if f in outs:
            path = os.path.join(vdir, f'{name}{tag}_f{f:03d}.vdb')
            out.geometry().saveToFile(path)
            a, org, vs = vdb_array(out)
            raw, rorg, _ = vdb_array(sh)           # before the base cut: does the plume keep its base by itself?
            mm = metrics(a, org, vs, rcp)
            mr = metrics(raw, rorg, vs, rcp)
            mm['raw'] = {k: mr.get(k) for k in ('lowest', 'base', 'massBelowSeed')}
            res['frames'][f] = mm
            np.save(os.path.join(ndir, f'{name}{tag}_f{f:03d}.npy'), a.astype(np.float16))
            log(f'  f{f}: ' + json.dumps({k: mm.get(k) for k in ('base', 'top', 'height', 'extentXZ', 'widthOverSeed', 'topOverThickness', 'turrets', 'areaProfile', 'raw')}))
    res['simSeconds'] = round(time.time() - t0, 1)
    log(f'[sim] {name}{tag}: {rcp["frames"]} frames in {res["simSeconds"]}s')
    if do_convert:
        pick = rcp['pick'] if rcp['pick'] in outs else outs[-1]
        convert(name + tag, os.path.join(vdir, f'{name}{tag}_f{pick:03d}.vdb'), rcp, log)
        res['converted'] = pick
    os.makedirs(os.path.join(SCRATCH, 'metrics'), exist_ok=True)   # one file per run: parallel runs don't race
    json.dump(res, open(os.path.join(SCRATCH, 'metrics', name + tag + '.json'), 'w'), indent=1)
    return res


def save_rig(rcp):
    import hou
    hou.hipFile.clear(suppress_save_prompt=True)
    hou.setFps(24)
    build(rcp)
    hou.setFrame(1)
    os.makedirs(os.path.dirname(RIG), exist_ok=True)
    hou.hipFile.save(RIG)
    print('[rig]', RIG, os.path.getsize(RIG), 'bytes')


# --- side-projection sheet (system python3: numpy + Pillow) -------------------------------------------------------------
def project(a, vm, ax):
    """EmberGen-thumbnail-style lit projection (artifacts/research/extracted/cloudpack/scripts/thumbs.py) of b[up, depth, across]."""
    import numpy as np
    pos = a[a > 0.05]
    K = 0.3 * vm / max(float(np.median(pos)) if pos.size else 1.0, 1e-3)   # same extinction per metre as the pack thumbnails
    above = np.cumsum(a[::-1], axis=0)[::-1] - a
    src = a * (0.2 + 0.8 * np.exp(-K * 0.6 * above))
    cum = np.cumsum(a, axis=ax) - a
    tv = np.exp(-K * cum)
    alpha = 1 - np.exp(-K * a.sum(axis=ax))
    sh = (src * tv).sum(axis=ax) / np.maximum((a * tv).sum(axis=ax), 1e-9)
    sky = np.array([95, 140, 200.]) / 255
    rgb = sky * (1 - alpha[..., None]) + (0.15 + 0.85 * np.clip(sh * 1.1, 0, 1))[..., None] * np.array([1, .98, .95]) * alpha[..., None]
    return (np.clip(rgb, 0, 1) * 255).astype(np.uint8)[::-1]


def sheet(out, names, mpp=8.0):
    import numpy as np
    from PIL import Image, ImageDraw
    rows = []
    for nm in names:
        stem, _, fr = nm.partition('@')
        res = json.load(open(os.path.join(SCRATCH, 'metrics', stem + '.json')))
        frames = [int(fr)] if fr else sorted(int(k) for k in res['frames'])
        tiles = []
        if not any(res['frames'][str(f)].get('height') for f in frames):
            continue
        for f in frames:
            a = np.load(os.path.join(SCRATCH, 'npy', f'{stem}_f{f:03d}.npy')).astype(np.float32)   # [z, y, x], y up
            vm = res['recipe']['divsize'] * res['recipe']['world_scale']
            b = a.transpose(1, 0, 2)                                     # [up, z (long), x]
            side = project(b, vm, 2)                                     # look along x: the long side
            end = project(b, vm, 1)                                      # look along z: the end
            s = vm / mpp
            ims = [Image.fromarray(i).resize((max(1, int(i.shape[1] * s)), max(1, int(i.shape[0] * s))), Image.LANCZOS) for i in (side, end)]
            w = ims[0].width + ims[1].width + 6; h = max(i.height for i in ims) + 30
            t = Image.new('RGB', (w, h), (30, 30, 30))
            t.paste(ims[0], (0, h - ims[0].height)); t.paste(ims[1], (ims[0].width + 6, h - ims[1].height))
            m = res['frames'][str(f)]
            if m.get('empty') or m.get('height') is None:
                continue
            ImageDraw.Draw(t).text((4, 2), f'{stem} f{f}  H {m["height"]:.0f} m  {m["extentXZ"][1]}x{m["extentXZ"][0]} m  base {m["base"]:.0f} (seed {m["seedBase"]:.0f})', fill=(255, 255, 0))
            ImageDraw.Draw(t).text((4, 14), f'w/seed {m["widthOverSeed"][1]:.2f}  top/thick {m["topOverThickness"]:.1f}  turrets {m["turrets"]}  area {m["areaProfile"]}', fill=(200, 200, 200))
            tiles.append(t)
        W = sum(t.width for t in tiles) + 8 * len(tiles); H = max(t.height for t in tiles)
        row = Image.new('RGB', (W, H), (20, 20, 20)); x = 0
        for t in tiles:
            row.paste(t, (x, H - t.height)); x += t.width + 8
        rows.append(row)
    W = max(r.width for r in rows); H = sum(r.height for r in rows) + 8 * len(rows)
    img = Image.new('RGB', (W, H), (20, 20, 20)); y = 0
    for r in rows:
        img.paste(r, (0, y)); y += r.height + 8
    img.save(out)
    print('[sheet]', out, img.size)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('run'); r.add_argument('names', nargs='+', choices=list(VARIANTS))
    r.add_argument('--set', action='append', default=[], metavar='SECTION.PARM=VALUE'); r.add_argument('--tag', default='')
    r.add_argument('--no-convert', action='store_true')
    g = sub.add_parser('rig'); g.add_argument('name', nargs='?', default='base', choices=list(VARIANTS))
    c = sub.add_parser('convert', help='re-convert the pick frame of an earlier run (no sim)')
    c.add_argument('names', nargs='+'); c.add_argument('--frame', type=int)
    s = sub.add_parser('sheet'); s.add_argument('out'); s.add_argument('names', nargs='+', help='variant[tag][@frame]')
    s.add_argument('--mpp', type=float, default=8.0)
    a = ap.parse_args()
    os.makedirs(SCRATCH, exist_ok=True)
    if a.cmd == 'sheet':
        return sheet(a.out, a.names, a.mpp)
    if a.cmd == 'convert':
        for n in a.names:
            rcp = json.load(open(os.path.join(SCRATCH, 'metrics', n + '.json')))['recipe']
            f = a.frame or rcp['pick']
            convert(n, os.path.join(SCRATCH, 'vdb', f'{n}_f{f:03d}.vdb'), dict(rcp, convert=BASE['convert']), print)
        return
    if a.cmd == 'rig':
        return save_rig(merged(a.name))
    logf = open(os.path.join(SCRATCH, 'run.log'), 'a')

    def log(s):
        print(s, flush=True); logf.write(s + '\n'); logf.flush()
    for n in a.names:
        rcp = merged(n, a.set)
        log(f'=== {n}{a.tag} {time.strftime("%H:%M:%S")} ' + json.dumps({k: rcp[k] for k in ('lens', 'solver', 'shape')}))
        run(n, rcp, a.tag, not a.no_convert, log)


if __name__ == '__main__':
    main()
