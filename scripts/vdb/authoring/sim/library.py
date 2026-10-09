"""P9-F: the authored cloud library.  One unattended hython run grows every cloud below with the P4-F Pyro recipe
(sim_clouds.py), converts the chosen frame to the runtime format and writes a manifest per cloud plus an index.

  HYTHON=/Applications/Houdini/Houdini21.0.671/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython
  $HYTHON scripts/vdb/authoring/sim/library.py                      # whole library -> assets/clouds/library/, log in work/captures/scratch/p9f/
  $HYTHON scripts/vdb/authoring/sim/library.py humilis-a congestus-lean        # just these
  $HYTHON scripts/vdb/authoring/sim/library.py congestus-lean --no-convert --tag _t --set solver.wind_strength=0.8   # experiment
  $HYTHON scripts/vdb/authoring/sim/library.py --list

Each entry is a recipe for sim_clouds.build: `base` names one of the TEMPLATES below and the rest overrides it section by
section.  The variety levers (README.md): emitters (shape, size, count, start frame), buoyancy and temperature, turbulence
and disturbance scale, wind during the sim (lean), sim length (young / mature / decaying), dissipation (wisps), an
inversion lid (`cap`: flat tops, stratocumulus slabs), the post warp (`remap.stretch/shear/flat`) and a pileus.
`stamp` holds hints for the library page (detail type and density-scale overrides, the scale range instances may use, and
a deal `weight`: how many copies of this cloud go into each shuffled round of the layout deck, default 1).
"""
import argparse, copy, datetime, json, os, sys, time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sim_clouds as sc  # noqa: E402

ASSETS = os.path.join(sc.REPO, 'assets', 'clouds', 'library')
WORK = os.path.join(sc.REPO, 'work', 'captures', 'scratch', 'p9f')

_SOLVER = dict(temperature0=0.0, temperature1=1.0, buoyancylift=6.0, tempcooling=0.05, dissipation=0.01,
               enable_turbulence=1, turbulence=0.6, turbulence_swirlsize=0.6,
               enable_disturbance=1, disturbance=0.5, disturbance_blocksize=0.5)
TEMPLATES = {
    # the P4-F recipes with a sharp flat base (a 20 m fade, not 100 m: the soft fade read as a rounded bottom once rendered)
    'cumulus': dict(sc.RECIPES['cumulus'], remap=dict(sc.RECIPES['cumulus']['remap'], basefade=0.2)),
    'congestus': dict(sc.RECIPES['congestus'], remap=dict(sc.RECIPES['congestus']['remap'], basefade=0.2)),
    # wide, low, capped: the starting point of the slabs
    'strato': dict(world_scale=100.0, divsize=0.08, frames=150, out_frames=[],
                   source=dict(radius=3.0, height=0.3, rate=1.2, temp=0.7, noisefreq=0.9, noiseamp=0.6, edge=0.35, cellfreq=3.0, cell0=0.42, cell1=0.6, floor=0.05, emit_frames=200),
                   solver=dict(_SOLVER, buoyancylift=4.0, turbulence=0.5, turbulence_swirlsize=0.4, disturbance=0.4, disturbance_blocksize=0.3),
                   remap=dict(lo=0.05, hi=1.0, base=0.05, basefade=0.2, stretch=1.0), smooth=1,
                   convert=['--iso', '0.3', '--margin', '1']),
}

# x, z, rx, rz, weight, start frame (sim units: 1 = 100 m)
LIBRARY = {
    # ---- fair-weather cumulus humilis: small, flat, wider than tall (a low lid keeps them flat)
    'humilis-a': dict(base='cumulus', species='cumulus humilis', seed=11, frames=110,
                      source=dict(radius=1.0, rate=1.2, temp=0.7, cellfreq=2.2),
                      solver=dict(buoyancylift=4.5),
                      cap=dict(height=1.1, thick=0.5, strength=0.08, reach=1.5),
                      remap=dict(stretch=0.6), stamp=dict(scale=[0.6, 1.2]), note='small flat puff'),
    'humilis-b': dict(base='cumulus', species='cumulus humilis (pair)', seed=12, frames=120,
                      source=dict(emitters=[[-0.7, 0.1, 0.75, 0.6, 1.0, 0], [0.9, -0.2, 0.5, 0.45, 0.8, 50]], rate=1.2, temp=0.7, cellfreq=2.0),
                      solver=dict(buoyancylift=4.5, turbulence=0.4, disturbance=0.35),
                      remap=dict(stretch=0.8), stamp=dict(scale=[0.6, 1.2]), note='two puffs joined at the base'),
    # ---- mediocris: about as tall as wide
    'mediocris-a': dict(base='cumulus', species='cumulus mediocris', seed=21, frames=150,
                        source=dict(radius=1.4, cellfreq=1.8),
                        solver=dict(buoyancylift=6.0),
                        remap=dict(stretch=1.4), note='single mound, lobed crown'),
    'mediocris-oblong': dict(base='cumulus', species='cumulus mediocris (oblong)', seed=22, frames=150,
                             source=dict(emitters=[[0, 0, 3.0, 0.7, 1.0, 0]], cellfreq=1.7),
                             solver=dict(buoyancylift=5.5),
                             remap=dict(stretch=1.3), note='long ridge of thermals'),
    'mediocris-cluster': dict(base='cumulus', species='cumulus mediocris (cluster)', seed=23, frames=170,
                              source=dict(emitters=[[-1.6, 0.3, 0.7, 0.7, 1.0, 0], [0.3, -0.5, 0.8, 0.6, 1.0, 40], [1.7, 0.6, 0.5, 0.5, 0.9, 80]], cellfreq=1.9),
                              solver=dict(buoyancylift=6.5),
                              remap=dict(stretch=1.8), note='three cells of different ages'),
    # ---- congestus / towering
    'congestus-a': dict(base='congestus', species='cumulus congestus', seed=31, frames=240,
                        remap=dict(stretch=3.0), stamp=dict(weight=3), note='tall tower, narrow crown'),
    'congestus-turrets': dict(base='congestus', species='cumulus congestus (turrets)', seed=32, frames=250,
                              source=dict(emitters=[[-1.4, 0.3, 0.6, 0.6, 1.0, 0], [1.2, -0.5, 0.55, 0.55, 0.9, 40], [0.0, 1.3, 0.5, 0.5, 0.8, 80]], cellfreq=1.6, cell0=0.5, cell1=0.68),
                              solver=dict(buoyancylift=11.0, turbulence=0.5, disturbance=0.25),
                              remap=dict(stretch=2.4), note='several turrets at different heights'),
    'congestus-broad': dict(base='cumulus', species='cumulus congestus (broad)', seed=33, frames=260,
                            source=dict(emitters=[[0, 0, 2.2, 2.0, 0.6, 0], [0.5, 0.3, 0.7, 0.7, 1.0, 0]], rate=1.8, temp=0.95, cellfreq=1.3, cell0=0.5, cell1=0.66),
                            solver=dict(buoyancylift=9.0, dissipation=0.006, tempcooling=0.03),
                            remap=dict(stretch=1.9), voxel=10, stamp=dict(weight=2), note='mature wide mound with towers'),
    # ---- leaning: wind during the sim bends the plume, the post shear adds the lean of the column
    'congestus-lean': dict(base='congestus', species='cumulus congestus (sheared)', seed=41, frames=240,
                           solver=dict(enable_wind=1, wind_strength=0.5, wind_directionx=1.0, wind_directiony=0.0, wind_directionz=0.0),
                           remap=dict(stretch=2.4, shear=0.7), stamp=dict(weight=2), note='tower leaning downwind'),
    'mediocris-sheared': dict(base='cumulus', species='cumulus mediocris (sheared)', seed=42, frames=170,
                              source=dict(radius=1.2),
                              solver=dict(enable_wind=1, wind_strength=0.5, wind_directionx=1.0, wind_directiony=0.0, wind_directionz=0.0, turbulence=0.7),
                              remap=dict(stretch=1.6, shear=1.0), note='wind-blown, tail downwind'),
    # ---- inversion lid: flat tops
    'cumulus-flattop': dict(base='cumulus', species='cumulus under an inversion (flat top)', seed=51, frames=240,
                            source=dict(radius=1.3, rate=1.8, temp=0.95),
                            solver=dict(buoyancylift=8.0),
                            cap=dict(height=1.6, thick=0.6, strength=0.3, reach=3.0),
                            remap=dict(stretch=1.4, flat=2.6, flatk=5.0),  # turrets that punch the lid are squashed into the shelf
                            note='spreads under a lid into an overhanging flat top'),
    'stratocumulus-slab': dict(base='strato', species='stratocumulus (slab)', seed=61, frames=150,
                               source=dict(emitters=[[0, 0, 4.0, 2.6, 1.0, 0]]),
                               cap=dict(height=0.9, thick=0.5, strength=0.12, reach=1.5),
                               remap=dict(stretch=0.9), voxel=12, stamp=dict(scale=[0.9, 1.2]), note='flat-topped lumpy deck'),
    'stratocumulus-band': dict(base='strato', species='stratocumulus (band)', seed=62, frames=150,
                               source=dict(emitters=[[0, 0, 5.0, 1.1, 1.0, 0]], cellfreq=2.6),
                               cap=dict(height=1.0, thick=0.5, strength=0.12, reach=1.5),
                               remap=dict(stretch=1.0, shear=0.2), voxel=12, stamp=dict(scale=[0.9, 1.2]), note='long roll'),
    # ---- decaying and broken
    'decaying-wisp': dict(base='cumulus', species='decaying cumulus (wispy)', seed=71, frames=200,
                          source=dict(radius=1.3, emit_frames=90),
                          solver=dict(buoyancylift=5.0, dissipation=0.012, tempcooling=0.12, turbulence=1.0, turbulence_swirlsize=0.4, disturbance=0.8, disturbance_blocksize=0.25,
                                      enable_wind=1, wind_strength=0.5, wind_directionx=1.0, wind_directiony=0.0, wind_directionz=0.0),
                          remap=dict(lo=0.02, hi=0.35, stretch=0.9, shear=0.6), stamp=dict(detailType=0.1, densityScale=0.45),
                          convert=['--iso', '0.3', '--margin', '1', '--scale-gain', '0.5'], note='emission stopped at 60, smeared downwind, wisping out'),
    'fractus': dict(base='cumulus', species='cumulus fractus', seed=72, frames=120,
                    source=dict(emitters=[[-1.4, 0.3, 0.45, 0.35, 1.0, 0], [0.2, -0.6, 0.5, 0.3, 0.8, 10], [1.5, 0.5, 0.35, 0.3, 0.9, 20], [0.0, 1.2, 0.3, 0.3, 0.7, 5]], rate=1.0, emit_frames=80, cellfreq=2.5),
                    solver=dict(buoyancylift=4.0, dissipation=0.01, turbulence=1.0, turbulence_swirlsize=0.3, disturbance=0.9, disturbance_blocksize=0.2),
                    cap=dict(height=1.2, thick=0.5, strength=0.06, reach=1.5),
                    remap=dict(lo=0.03, hi=0.3, stretch=0.75), stamp=dict(detailType=0.25, densityScale=0.8, scale=[0.6, 1.2]), prune=0, note='ragged broken pieces'),
    # ---- T6: tower with a pileus cap
    'pileus-tower': dict(base='congestus', species='cumulus congestus with pileus', seed=81, frames=250,
                         source=dict(radius=0.9),
                         solver=dict(buoyancylift=13.0),
                         remap=dict(stretch=2.6), pileus=dict(gap=0.15, rx=2.6, ry=0.7, thick=0.35, density=1.0), note='tower punching a smooth cap'),
    'rising-young': dict(base='congestus', species='young towering cumulus', seed=91, frames=140,
                         source=dict(radius=0.6, rate=2.4),
                         solver=dict(buoyancylift=14.0, turbulence=0.3, disturbance=0.1),
                         remap=dict(stretch=3.0), stamp=dict(weight=2), note='young thermal, bulbous head'),
}


def recipe(name):
    e = copy.deepcopy(LIBRARY[name])
    r = copy.deepcopy(TEMPLATES[e.pop('base')])
    for k, v in e.items():
        if isinstance(v, dict) and isinstance(r.get(k), dict):
            r[k].update(v)
        else:
            r[k] = v
    r['out_frames'] = []
    r.setdefault('prune', 0.04)
    return r


def measure(out_dir):
    """Base and top of the converted cloud (metres above the asset box floor), from its NVDF profile."""
    cj = json.load(open(os.path.join(out_dir, 'cloud.json')))
    w, h, d = cj['dims']
    vs = cj['voxelSizeMeters']
    r = np.fromfile(os.path.join(out_dir, 'nvdf.bin'), np.uint8).reshape(d, h, w, 4)[..., 0]
    occ = (r > 0).reshape(d, -1)
    layers = np.nonzero(occ.any(axis=1))[0]
    cover = occ.sum(axis=1)
    # the flat base: the lowest layer holding at least 25 % of the widest layer's footprint
    base_z = int(np.nonzero(cover >= 0.25 * cover.max())[0][0])
    return dict(dims=cj['dims'], voxelSizeMeters=vs, sizeMeters=[w * vs, h * vs, d * vs],
                baseMeters=round(base_z * vs, 1), lowestMeters=round(int(layers[0]) * vs, 1), topMeters=round((int(layers[-1]) + 1) * vs, 1),
                footprintMeters=[round(float(v), 1) for v in (np.array([w, h]) * vs)], occupiedVoxels=int((r > 0).sum()))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('names', nargs='*', help='library entries (default: all)')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--reindex', action='store_true', help='no sims: refresh the manifests\' stamp hints and notes from LIBRARY and rewrite index.json')
    ap.add_argument('--set', action='append', default=[], metavar='SECTION.PARM=VALUE')
    ap.add_argument('--tag', default='')
    ap.add_argument('--no-convert', action='store_true')
    ap.add_argument('--no-previews', action='store_true')
    ap.add_argument('--assets-dir', default=ASSETS)
    ap.add_argument('--work-dir', default=WORK)
    ap.add_argument('--log', default=None, help='log file (default <work-dir>/library.log)')
    a = ap.parse_args()
    if a.list:
        for n, e in LIBRARY.items():
            print(f'{n:22s} {e["species"]:40s} {e.get("note", "")}')
        return
    if a.reindex:
        for n, e in LIBRARY.items():
            mp = os.path.join(a.assets_dir, n, 'manifest.json')
            if os.path.exists(mp):
                m = json.load(open(mp))
                m.update(stamp=e.get('stamp', {}), species=e['species'], note=e.get('note', ''))
                with open(mp, 'w') as f:
                    json.dump(m, f, indent=2)
        write_index(a.assets_dir)
        return
    names = a.names or list(LIBRARY)
    for n in names:
        if n not in LIBRARY:
            raise SystemExit(f'unknown library entry {n!r} (see --list)')
    os.makedirs(a.work_dir, exist_ok=True)
    logf = open(a.log or os.path.join(a.work_dir, 'library.log'), 'a')

    def log(msg):
        print(msg, flush=True)
        logf.write(msg + '\n')
        logf.flush()

    log(f'=== library run {datetime.datetime.now().isoformat(timespec="seconds")}: {", ".join(names)}')
    t_all = time.time()
    failures = []
    for n in names:
        rcp = recipe(n)
        sc.apply_overrides(rcp, a.set)
        try:
            paths, secs = sc.simulate(n, rcp, a.work_dir, tag=a.tag, previews=not a.no_previews, log=log)
            if a.no_convert:
                continue
            vdb = paths[max(paths)]
            out, size = sc.convert(n, vdb, rcp, a.assets_dir)
            m = measure(out)
            entry = LIBRARY[n]
            manifest = dict(name=n, species=entry['species'], note=entry.get('note', ''), seed=rcp.get('seed', 0),
                            frame=max(paths), simSeconds=round(secs, 1), bytes=size, **m,
                            stamp=entry.get('stamp', {}), recipe=rcp,
                            generator='scripts/vdb/authoring/sim/library.py (Houdini Pyro Solver SOP) -> scripts/vdb/vdb_to_nvdf.py --mode fog')
            with open(os.path.join(out, 'manifest.json'), 'w') as f:
                json.dump(manifest, f, indent=2)
            log(f'[{n}] {m["sizeMeters"]} m, base {m["baseMeters"]} top {m["topMeters"]} m, {size / 1048576:.2f} MiB, sim {secs:.0f}s')
            if size >= 4 * 1024 * 1024:
                log(f'[{n}] WARNING: {size / 1048576:.2f} MiB is over the 4 MB budget (raise `voxel`)')
        except BaseException as e:  # keep going: an unattended batch reports every failure at the end
            if isinstance(e, KeyboardInterrupt):
                raise
            failures.append(n)
            log(f'[{n}] FAILED: {e}')
    if not a.no_convert:
        write_index(a.assets_dir, log)
    log(f'=== done in {time.time() - t_all:.0f}s, {len(names) - len(failures)}/{len(names)} ok' + (f', failed: {failures}' if failures else ''))
    if failures:
        raise SystemExit(1)


def write_index(assets_dir, log=print):
    clouds = []
    for n in LIBRARY:
        mp = os.path.join(assets_dir, n, 'manifest.json')
        if not os.path.exists(mp):
            continue
        m = json.load(open(mp))
        clouds.append({k: m[k] for k in ('name', 'species', 'sizeMeters', 'baseMeters', 'topMeters', 'voxelSizeMeters', 'bytes', 'stamp')})
    with open(os.path.join(assets_dir, 'index.json'), 'w') as f:
        json.dump(dict(note='P9-F authored cloud library; regenerate with scripts/vdb/authoring/sim/library.py', clouds=clouds), f, indent=2)
    log(f'[index] {len(clouds)} clouds, {sum(c["bytes"] for c in clouds) / 1048576:.1f} MiB total')


if __name__ == '__main__':
    main()
