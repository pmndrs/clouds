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
float R = %(radius)g, H = %(height)g;
vector p = @P;
float frame = `$FF`;
float t = frame * 0.02;
float r = length(set(p.x, 0, p.z));
float n1 = noise(p * %(noisefreq)g * 1.7 + {3.1, 1.7, 9.2});          // breaks the disc outline into lobes
float n2 = noise(p * %(cellfreq)g + {7.3, 2.1, 0.4} + t * {0.5, 0.2, 0.3});  // thermal cells
float rr = r + (n1 - 0.5) * R * 0.9 * %(noiseamp)g;
float mask = (1 - smooth(R * (1 - %(edge)g), R, rr)) * (1 - smooth(0.0, H, p.y));
float emit = 1 - smooth(%(emit_frames)g - 10.0, %(emit_frames)g * 1.0, frame);
float cell = %(floor)g + (1 - %(floor)g) * smooth(%(cell0)g, %(cell1)g, n2);   // hot spots = rising thermals
@density = mask * emit * %(rate)g * cell;
@temperature = mask * emit * %(temp)g * cell;
'''

REMAP_VEX = '''
@density = smooth(%(lo)g, %(hi)g, @density);
if (%(basefade)g > 0) @density *= smooth(%(base)g, %(base)g + %(basefade)g, @P.y);
'''


def build(name, rcp, hip=None):
    obj = hou.node('/obj')
    geo = obj.node(name) or obj.createNode('geo', name)
    for c in geo.children():
        c.destroy()
    src, ds = rcp['source'], rcp['divsize']
    ext = src['radius'] * 1.6
    vols = []
    for nm in ('density', 'temperature'):
        v = geo.createNode('volume', 'src_' + nm)
        v.parm('name').set(nm)
        v.parm('uniformsamples').set(5)  # By Size (menu index; the labels are Non Square, X, Y, Z, Max Axis, By Size)
        v.parm('divsize').set(ds)
        v.parmTuple('size').set((2 * ext, src['height'] * 2.5, 2 * ext))
        v.parmTuple('t').set((0, src['height'] * 1.25 - ds, 0))
        vols.append(v)
    mg = geo.createNode('merge', 'src_merge')
    for i, v in enumerate(vols):
        mg.setInput(i, v)
    sw = geo.createNode('volumewrangle', 'source_noise')
    sw.setInput(0, mg)
    sw.parm('snippet').set(SOURCE_VEX % src)
    ps = geo.createNode('pyrosolver', 'pyro')
    ps.setInput(0, sw)
    ps.parm('divsize').set(ds)
    ps.parm('solver').set(0)  # sparse
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
    if rcp['remap'].get('stretch', 1.0) != 1.0:
        # vertical stretch k: the sim plume is about as tall as it is wide (plumes are self-similar cones); real towering
        # cumulus is taller than wide.  Grow the active region upward, then resample the density at (x, y / k, z).
        act = geo.createNode('vdbactivate', 'grow_region')
        act.setInput(0, rm)
        act.parm('operation').set(0)
        act.parm('setvalue').set(1)
        act.parm('value').set(0.0)
        st = geo.createNode('volumewrangle', 'stretch_y')
        st.setInput(0, act)
        st.setInput(1, rm)
        st.parm('snippet').set('@density = volumesample(1, "density", @P / set(1, %g, 1));' % rcp['remap']['stretch'])
        prev = st
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


def grow_region(geo, k):
    """Point the vdbactivate box at the remapped cloud's bounds with the top raised by factor k (call per checkpoint)."""
    pr = next(p for p in geo.node('remap').geometry().prims() if isinstance(p, hou.VDB))
    bb = pr.activeVoxelBoundingBox()
    c0, c1 = pr.indexToPos(tuple(int(math.floor(v)) for v in bb.minvec())), pr.indexToPos(tuple(int(math.ceil(v)) for v in bb.maxvec()))
    mn = [min(c0[i], c1[i]) for i in range(3)]
    mx = [max(c0[i], c1[i]) for i in range(3)]
    mx[1] = max(mx[1], 0.0) * k + (mx[1] - max(mx[1], 0.0))
    a = geo.node('grow_region')
    a.parmTuple('min').set(mn)
    a.parmTuple('max').set(mx)
    a.parmTuple('center').set([(mn[i] + mx[i]) / 2 for i in range(3)])
    a.parmTuple('size').set([mx[i] - mn[i] for i in range(3)])


def convert(name, vdb_path, rcp, assets_dir):
    out = os.path.join(assets_dir, name)
    hython = os.path.join(hou.text.expandString('$HFS'), 'bin', 'hython')
    cmd = [hython, CONVERTER, '--mode', 'fog', vdb_path, '--out', out, '--voxel-size', '8', '--name', name,
           '--world-scale', str(rcp['world_scale'])] + rcp.get('convert', [])
    print('[convert]', ' '.join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(r.stdout[-1500:])
    if r.returncode:
        sys.stderr.write(r.stderr)
        raise SystemExit('converter failed')
    size = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out))
    print(f'[{name}] {out}: {size / 1048576:.2f} MiB')


def apply_overrides(rcp, sets):
    for item in sets:
        key, val = item.split('=')
        sec, parm = key.split('.')
        rcp[sec][parm] = float(val) if '.' in val or 'e' in val else int(val)


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
    ap.add_argument('--hip')
    ap.add_argument('--convert-only', metavar='VDB', help='skip the sim: just convert this cached VDB into assets/clouds/heroes/sim-NAME')
    a = ap.parse_args()
    rcp = json.loads(json.dumps(RECIPES[a.name]))
    apply_overrides(rcp, a.set)
    if a.divsize:
        rcp['divsize'] = a.divsize
    if a.convert_only:
        convert('sim-' + a.name, a.convert_only, rcp, a.assets_dir)
        return
    last = a.frames or rcp['frames']
    outs = [int(x) for x in a.out_frames.split(',')] if a.out_frames else [f for f in rcp['out_frames'] if f <= last] or [last]
    outs = sorted(set(outs) | {last}) if not a.out_frames else outs
    os.makedirs(a.work_dir, exist_ok=True)
    geo, ps, post = build(a.name + a.tag, rcp, a.hip)
    t0 = time.time()
    path = None
    for f in range(1, last + 1):
        hou.setFrame(f)
        tf = time.time()
        g = ps.geometry()
        if g is None:
            raise SystemExit(("pyro errors: " + str([(n.name(), n.errors()[0][:300]) for n in geo.children() if n.errors()]))[:1500])
        if f % 10 == 0 or f == 1:
            d = next(p for p in g.prims() if p.attribValue('name') == 'density')
            print(f'frame {f}: {time.time() - tf:.1f}s  grid {d.resolution()}  total {time.time() - t0:.0f}s', flush=True)
        if f in outs:
            if rcp['remap'].get('stretch', 1.0) != 1.0:
                grow_region(geo, rcp['remap']['stretch'])
            pg = post.geometry()
            path = os.path.join(a.work_dir, f'{a.name}{a.tag}_f{f:03d}.vdb')
            pg.saveToFile(path)
            build_heroes.preview(path, path[:-4] + '.png')
    print(f'[sim] {last} frames in {time.time() - t0:.0f}s')
    if a.hip:
        hou.hipFile.save(a.hip)
    if not a.no_convert:
        cf = a.convert_frame or last
        convert('sim-' + a.name, os.path.join(a.work_dir, f'{a.name}{a.tag}_f{cf:03d}.vdb'), rcp, a.assets_dir)


if __name__ == '__main__':
    main()
