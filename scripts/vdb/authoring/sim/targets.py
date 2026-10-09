"""L1: target-driven sim recipes.  One target = a base recipe built from its card (scripts/targets/card.py) plus a seeded sweep of
variants around it; every variant is simmed with sim_clouds.py (Houdini Pyro) and converted into a candidate the target page
renders and scores (examples/lab/target/, scripts/targets/match.mjs).

  HYTHON=/Applications/Houdini/Houdini21.0.671/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython
  $HYTHON scripts/vdb/authoring/sim/targets.py texas-tower                  # all variants -> assets/clouds/local/texas-tower/<v>/
  $HYTHON scripts/vdb/authoring/sim/targets.py texas-tower --only v00,v03   # some
  $HYTHON scripts/vdb/authoring/sim/targets.py texas-tower --list           # print the sweep
  $HYTHON scripts/vdb/authoring/sim/targets.py texas-tower --refine v05,v11 --n 10 --round r2   # round 2: children of the best
  $HYTHON scripts/vdb/authoring/sim/targets.py texas-tower --only v00 --set remap.taper=0.3 --tag _t   # experiment

Candidates go to the gitignored assets/clouds/local/<target>/ (served at /clouds/local/...) with a candidates.json index; the
picked ones are copied to assets/clouds/targets/<target>/ by scripts/targets/promote.py.

Recipe of the Texas-afternoon hero tower (card: work/captures/scratch/targets/texas-tower.card.json; photo-species-specs.md sec. 3):
  * a HOT, narrow core emitter = the tower; a WARM, wide pedestal emitter offset to the right (heat < 1: it rises lazily and
    spreads under a weak lid) = the flat grey base deck 1.5x wider than the tower; attached mediocris lobes to the LEFT that start
    later (younger cells); a small hot "finger" thermal at the left that rises on its own;
  * a WEAK inversion lid at pedestal height: the warm pedestal stalls and spreads under it, the hot core punches through;
  * post warp: stretch only above the pedestal (`stretch_from`), a taper toward the crown, a slight lean.
"""
import argparse, copy, datetime, json, os, random, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sim_clouds as sc  # noqa: E402
import library as lb  # noqa: E402

LOCAL = os.path.join(sc.REPO, 'assets', 'clouds', 'local')
WORK = os.path.join(sc.REPO, 'work', 'captures', 'scratch', 'targets', 'sims')

# NB temperature0 must be > 0: inside the Pyro Solver the buoyancy lift is -buoyancylift * (T1 - T0) / T0 * g, so the T0 = 0 of
# the P4-F / P9-F recipes divides by zero and buoyancy is silently OFF there (their plumes rise only by turbulence; the towers come
# from the vertical stretch).  With T0 = 1, T1 = 2 the lift is buoyancylift * 9.8 sim units/s^2 per unit of source temperature;
# 0.2-0.4 gives a rising tower at sim scale.
_SOLVER = dict(temperature0=1.0, temperature1=2.0, buoyancylift=0.6, tempcooling=0.03, dissipation=0.006,
               enable_turbulence=1, turbulence=0.3, turbulence_swirlsize=0.4,
               enable_disturbance=1, disturbance=0.15, disturbance_blocksize=0.4)

# emitters: x, z, rx, rz, weight, start frame, heat  (sim units, 1 = 100 m at sim scale; +x = right on the target page, camera looks -z)
TEXAS_TOWER = dict(
    world_scale=100.0, divsize=0.08, frames=180, out_frames=[],
    source=dict(radius=1.0, height=0.4, rate=2.0, temp=1.0, noisefreq=1.0, noiseamp=0.8, edge=0.5, cellfreq=1.5, cell0=0.45, cell1=0.65,
                floor=0.15, emit_frames=260,
                emitters=[[0.2, 0.0, 1.2, 1.14, 1.0, 0, 1.0],      # core tower (hot)
                          [1.0, 0.1, 2.4, 1.6, 0.8, 0, 0.45],        # pedestal (warm, wide, to the right): stalls under the lid
                          [-2.0, 0.2, 1.3, 0.9, 0.9, 20, 0.5],       # attached left lobe
                          [-3.4, -0.1, 0.9, 0.7, 0.7, 40, 0.45],     # outer left lobe (youngest)
                          [-1.7, -0.6, 0.45, 0.45, 0.8, 30, 0.85]]),  # the finger: a small hot thermal on the left
    solver=_SOLVER,
    cap=dict(height=3.0, thick=0.6, strength=0.012, reach=3.5),   # NB the lid is ADDED every frame: it settles near -strength/tempcooling (0.4 here)
    remap=dict(lo=0.05, hi=1.0, base=0.05, basefade=0.2, stretch=1.0, stretch_from=1.0, taper=0.25, taper_y0=3.0, taper_y1=10.0,
               taper_x=0.2, taper_z=0.0, shear=0.0),
    smooth=1, prune=0.02,
    convert=['--iso', '0.3', '--margin', '1'],
    # output scale: the converter's world scale and voxel (sim divsize x scale / 100 metres): 2.5-3 km tall, under 4 MB at 36 m
    out=dict(world_scale=300.0, voxel=36),
)

TARGETS = {'texas-tower': TEXAS_TOWER}

# sweep: each variant draws every lever from its range (seeded), so 20 variants span the space around the base recipe
SWEEP = {
    'texas-tower': dict(
        n=20,
        levers={
            'seed': ('int', 1, 999),
            'frames': ('int', 150, 210),
            'solver.buoyancylift': ('uni', 0.45, 0.8),
            'solver.turbulence': ('uni', 0.15, 0.45),
            'solver.disturbance': ('uni', 0.05, 0.25),
            'cap.strength': ('uni', 0.0, 0.025),
            'cap.height': ('uni', 2.2, 3.8),
            'remap.stretch': ('uni', 1.0, 1.3),
            'remap.taper': ('uni', 0.0, 0.4),
            'remap.shear': ('uni', -0.1, 0.1),
            'remap.lo': ('uni', 0.03, 0.09),
            'emit.0.rx': ('uni', 0.9, 1.5),          # core width
            'emit.1.heat': ('uni', 0.3, 0.6),        # pedestal heat
            'emit.1.rx': ('uni', 2.0, 3.0),          # pedestal width
            'emit.2.heat': ('uni', 0.35, 0.65),      # left lobe heat
            'emit.2.weight': ('uni', 0.6, 1.0),      # left lobe
            'emit.4.weight': ('uni', 0.0, 1.0),      # finger
        }),
}
# levers only the refinement rounds explore (added after round 1 so the round-1 variants stay reproducible)
REFINE_EXTRA = {'texas-tower': {'remap.hi': ('uni', 0.35, 1.0), 'emit.2.x': ('uni', -2.8, -1.6), 'emit.3.weight': ('uni', 0.4, 1.0)}}
EMIT_FIELDS = dict(x=0, z=1, rx=2, rz=3, weight=4, start=5, heat=6, end=7)


def variants(target):
    sw = SWEEP[target]
    out = {'v00': {}}                     # v00 = the base recipe as written
    rnd = random.Random(f'{target}-sweep')
    for i in range(1, sw['n']):
        v = {}
        for k, (kind, a, b) in sw['levers'].items():
            v[k] = rnd.randint(a, b) if kind == 'int' else round(rnd.uniform(a, b), 3)
        out[f'v{i:02d}'] = v
    return out


def refine(target, parents, n, tag, out_dir, spread=0.15):
    """Round-2+ variants: children of the best candidates (the auto-match ranking), every lever jittered by `spread` x its range
    (Gaussian, clamped), a new seed, plus the REFINE_EXTRA levers drawn fresh.  Names <tag>_<i> (e.g. r2_00)."""
    levers = dict(SWEEP[target]['levers'], **REFINE_EXTRA.get(target, {}))
    rnd = random.Random(f'{target}-{tag}-{",".join(parents)}')
    base = {p: json.load(open(os.path.join(out_dir, p, 'manifest.json')))['variant'] for p in parents}
    out = {}
    for i in range(n):
        par = parents[i % len(parents)]
        v = {'parent': par}
        for k, (kind, a, b) in levers.items():
            if k == 'seed':
                v[k] = rnd.randint(a, b)
                continue
            mid = base[par].get(k, recipe_value(target, k))
            x = mid + rnd.gauss(0, spread * (b - a)) if k in base[par] or k not in REFINE_EXTRA.get(target, {}) else rnd.uniform(a, b)
            x = min(b, max(a, x))
            v[k] = int(round(x)) if kind == 'int' else round(x, 3)
        out[f'{tag}_{i:02d}'] = v
    return out


def recipe_value(target, k):
    """The base recipe's value of a lever key (for parents that never drew it)."""
    r = TARGETS[target]
    if k in ('seed', 'frames'):
        return r.get(k, 0)
    if k.startswith('emit.'):
        _, i, f = k.split('.')
        return r['source']['emitters'][int(i)][EMIT_FIELDS[f]]
    sec, parm = k.split('.')
    return r[sec][parm]


def recipe(target, overrides):
    r = copy.deepcopy(TARGETS[target])
    ems = r['source']['emitters']
    for k, val in overrides.items():
        if k == 'parent':
            continue
        if k in ('seed', 'frames'):
            r[k] = val
        elif k.startswith('emit.'):
            _, i, f = k.split('.')
            ems[int(i)][EMIT_FIELDS[f]] = val
            if f == 'rx' and int(i) == 0:   # the core stays round
                ems[0][3] = val * 0.95
        else:
            sec, parm = k.split('.')
            r[sec][parm] = val
    if r['cap']['strength'] <= 0.002:
        r.pop('cap')
    return r


def write_index(out_dir, target):
    """candidates.json from every candidate manifest on disk (safe when two sweeps run in parallel)."""
    cands = {}
    for n in sorted(os.listdir(out_dir)):
        mp = os.path.join(out_dir, n, 'manifest.json')
        if os.path.exists(mp):
            m = json.load(open(mp))
            cands[n] = {k: m[k] for k in ('sizeMeters', 'baseMeters', 'topMeters', 'voxelSizeMeters', 'bytes', 'variant')}
    json.dump({'target': target, 'candidates': cands}, open(os.path.join(out_dir, 'candidates.json'), 'w'), indent=1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('target', choices=list(TARGETS))
    ap.add_argument('--only', help='comma list of variants (default: all)')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--set', action='append', default=[], metavar='SECTION.PARM=VALUE')
    ap.add_argument('--tag', default='')
    ap.add_argument('--no-previews', action='store_true')
    ap.add_argument('--out-dir', default=None, help='default assets/clouds/local/<target>')
    ap.add_argument('--refine', metavar='PARENTS', help='comma list of ranked candidates: grow children of these instead of the sweep')
    ap.add_argument('--n', type=int, default=10, help='--refine: number of children')
    ap.add_argument('--round', default='r2', help='--refine: name prefix of the children')
    a = ap.parse_args()
    out_dir = a.out_dir or os.path.join(LOCAL, a.target)
    vs = refine(a.target, a.refine.split(','), a.n, a.round, out_dir) if a.refine else variants(a.target)
    if a.list:
        for n, v in vs.items():
            print(n, json.dumps(v))
        return
    names = a.only.split(',') if a.only else list(vs)
    work = os.path.join(WORK, a.target)
    os.makedirs(work, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)
    logf = open(os.path.join(work, 'sims.log'), 'a')

    def log(msg):
        print(msg, flush=True)
        logf.write(msg + '\n'); logf.flush()

    log(f'=== {a.target} {datetime.datetime.now().isoformat(timespec="seconds")}: {",".join(names)}')
    for n in names:
        # --set emit.I.FIELD=V edits emitter I (fields: x z rx rz weight start heat); other keys go to sim_clouds.apply_overrides
        emit = {k: float(v) for k, v in (x.split('=', 1) for x in a.set if x.startswith('emit.'))}
        rcp = recipe(a.target, dict(vs[n], **emit))
        sc.apply_overrides(rcp, [x for x in a.set if not x.startswith('emit.')])
        name = n + a.tag
        t0 = time.time()
        try:
            paths, secs = sc.simulate(name, rcp, work, previews=not a.no_previews, log=log)
            vdb = paths[max(paths)]
            conv = dict(rcp, world_scale=rcp['out']['world_scale'], voxel=rcp['out']['voxel'])
            out, size = sc.convert(name, vdb, conv, out_dir)
            m = lb.measure(out)
            manifest = dict(name=name, target=a.target, variant=vs[n], frame=max(paths), simSeconds=round(secs, 1), bytes=size, **m, recipe=rcp,
                            generator='scripts/vdb/authoring/sim/targets.py (Houdini Pyro Solver SOP) -> scripts/vdb/vdb_to_nvdf.py --mode fog')
            json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w'), indent=2)
            write_index(out_dir, a.target)
            log(f'[{name}] {m["sizeMeters"]} m, base {m["baseMeters"]} top {m["topMeters"]}, {size / 1048576:.2f} MiB, {time.time() - t0:.0f}s')
        except BaseException as e:
            if isinstance(e, KeyboardInterrupt):
                raise
            log(f'[{name}] FAILED: {e}')


if __name__ == '__main__':
    main()
