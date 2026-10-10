#!/usr/bin/env python3
"""Save every authoring builder's Houdini network as an editable .hip rig in houdini/rigs/ (task A1).

  HYTHON=/Applications/Houdini/Houdini21.0.671/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython
  $HYTHON scripts/vdb/authoring/rigs.py                  # regenerate every rig
  $HYTHON scripts/vdb/authoring/rigs.py hero_tower       # just these
  $HYTHON scripts/vdb/authoring/rigs.py --list
  $HYTHON scripts/vdb/authoring/rigs.py --verify         # open each .hip, cook its first stage, print nodes and sizes

The networks come from the builders themselves (build_heroes.build_network, sim_clouds.build) so a rig is exactly what the
agents cooked, but nothing is cooked or simulated here: the files hold nodes, parameters, a CONTROLS null, network boxes and
sticky notes only (a few tens of KB).  Caches and exported VDBs go to houdini/cache/ (gitignored) via the rig's `export` ROP.
houdini/rigs/lens_seed.hip and frog.hip belong to other tasks and are never touched or listed here.

Every rig: a `CONTROLS` null (spare parms, channel-referenced by the real nodes: edit there), one network box + sticky note per
stage, an `export` ROP Geometry Output node, and a "Run converter" button on CONTROLS that runs scripts/vdb/vdb_to_nvdf.py on
the exported VDB.  Nothing flows back into the Python recipe automatically: the rig is a copy to inspect and tune; copy
winning values back into the RECIPES / LIBRARY dicts by hand.
"""
import argparse
import copy
import os
import re
import sys

import hou

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
RIG_DIR = os.path.join(REPO, 'houdini', 'rigs')
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'sim'))
import build_heroes as bh  # noqa: E402
import sim_clouds as sc  # noqa: E402
import library as lb  # noqa: E402
import targets as tg  # noqa: E402

# rigs owned by other tasks: never overwritten
FOREIGN = {'lens_seed', 'frog'}

DOC = 'docs/research/'

# ----------------------------------------------------------------------------------------------- helpers


def set_expr(parm, expr):
    parm.setExpression(expr, hou.exprLanguage.Hscript)


def add_controls(net, rows, title):
    """Create the CONTROLS null.  rows: list of (folder, name, label, value, min, max).  Returns the null."""
    ctl = net.createNode('null', 'CONTROLS')
    ctl.setColor(hou.Color((1.0, 0.75, 0.2)))
    ptg = ctl.parmTemplateGroup()
    folders = {}
    for folder, name, label, value, lo, hi in rows:
        isint = isinstance(value, int) and not isinstance(value, bool)
        if isint:
            t = hou.IntParmTemplate(name, label, 1, default_value=(value,), min=int(lo), max=int(hi))
        else:
            t = hou.FloatParmTemplate(name, label, 1, default_value=(float(value),), min=float(lo), max=float(hi))
        folders.setdefault(folder, []).append(t)
    for folder, tmpls in folders.items():
        ptg.append(hou.FolderParmTemplate('f_' + re.sub(r'\W+', '_', folder.lower()), folder, folder_type=hou.folderType.Tabs,
                                          parm_templates=tmpls))
    ctl.setParmTemplateGroup(ptg)
    ctl.setComment(title)
    ctl.setGenericFlag(hou.nodeFlag.DisplayComment, True)
    return ctl


def add_converter_button(ctl, name, convert_args, kind):
    """Python button on CONTROLS: run scripts/vdb/vdb_to_nvdf.py on houdini/cache/<name>.vdb -> houdini/cache/nvdf/<name>."""
    ptg = ctl.parmTemplateGroup()
    ptg.append(hou.StringParmTemplate('convert_args', 'Converter args', 1, default_value=(' '.join(str(a) for a in convert_args),)))
    code = (
        "import hou, os, subprocess\n"
        "hip = hou.text.expandString('$HIP')\n"
        "repo = os.path.normpath(os.path.join(hip, '..', '..'))\n"
        "src = os.path.join(hip, '..', 'cache', '%(name)s.vdb')\n"
        "out = os.path.join(hip, '..', 'cache', 'nvdf', '%(name)s')\n"
        "if not os.path.exists(src):\n"
        "    raise hou.Error('Render the export ROP first: ' + src)\n"
        "cmd = [hou.text.expandString('$HFS') + '/bin/hython', os.path.join(repo, 'scripts', 'vdb', 'vdb_to_nvdf.py'), '--mode', 'fog',\n"
        "       src, '--out', out, '--name', '%(name)s'] + kwargs['node'].parm('convert_args').eval().split()\n"
        "r = subprocess.run(cmd, capture_output=True, text=True)\n"
        "print(r.stdout[-2000:], r.stderr[-1000:])\n"
        "print('written to', os.path.normpath(out))\n"
    ) % dict(name=name)
    b = hou.ButtonParmTemplate('run_converter', 'Run converter (vdb_to_nvdf.py)')
    b.setScriptCallback(code)
    b.setScriptCallbackLanguage(hou.scriptLanguage.Python)
    b.setHelp('Needs the export ROP rendered first. Output: houdini/cache/nvdf/<rig>/ (gitignored). To ship it, copy to assets/clouds/ and '
              'see the README of the builder. Default args come from the builder recipe (' + kind + ').')
    ptg.append(b)
    ctl.setParmTemplateGroup(ptg)


def add_export(net, last, name, sim_frames=None):
    ex = net.createNode('rop_geometry', 'export')
    ex.setInput(0, last)
    ex.parm('sopoutput').set('$HIP/../cache/%s.vdb' % name)
    if sim_frames:
        ex.parm('trange').set(0)  # current frame only; set a range to write the whole sim
    ex.setColor(hou.Color((0.4, 0.8, 0.4)))
    return ex


def stage(net, title, node_names, note, color=(0.25, 0.3, 0.4), nodes=None):
    """Network box around the named nodes plus a sticky note to its left."""
    members = nodes if nodes is not None else [net.node(n) for n in node_names]
    members = [m for m in members if m is not None]
    box = net.createNetworkBox(re.sub(r'\W+', '_', title.lower()))
    box.setComment(title)
    box.setColor(hou.Color(color))
    for m in members:
        box.addNode(m)
    box.fitAroundContents()
    s = net.createStickyNote()
    s.setText(title + '\n\n' + note)
    s.setSize(hou.Vector2(5.0, max(3.0, min(8.0, 0.9 + len(note) / 38.0))))
    p = box.position()
    s.setPosition(hou.Vector2(p[0] - 5.6, p[1] + box.size()[1] - s.size()[1]))
    s.setColor(hou.Color((0.95, 0.9, 0.55)))
    s.setTextColor(hou.Color((0.1, 0.1, 0.1)))
    return box


def finish(net, name, last, frames=None):
    net.layoutChildren()
    hou.setFrame(1)
    if frames:
        hou.playbar.setFrameRange(1, frames)
        hou.playbar.setPlaybackRange(1, frames)
    last.setDisplayFlag(True)
    last.setRenderFlag(True)


def save(name):
    os.makedirs(RIG_DIR, exist_ok=True)
    path = os.path.join(RIG_DIR, name + '.hip')
    hou.hipFile.save(path)
    return path


# ----------------------------------------------------------------------------------------------- hero rigs (build_heroes)

HERO_NOTES = dict(
    sources=("Closed polygon spheres (ellipsoids), metres, y up, base at y = 0. Their union is the silhouette: tower = flat foot + rings of "
             "domed cells + slim core + two crowning turrets, drifting +x with height (shear); fog = a chain of wide squashed ellipsoids; "
             "fair-weather = one lumpy dome. Move/scale a `ball*` node to change the shape; keep the core narrow or the notches between "
             "cells fill in and it becomes a column. Why: a cumulus is a merging line of bodies, not a single sphere (hero notes in " + DOC + "targets/, "
             + DOC + "topics/shape.md)."),
    cloud=("Cloud SOP: polygons -> fog VDB `density` with a soft shoulder (exterior/interior band, metres) and procedural secondary "
           "bumps (cauliflower lobes). The noise below only erodes where density has a gradient, so keep the bands wide (60-200 m). "
           "Keep secondaryiterations = 1 (2 never finished cooking). Controls: band, densitymultiplier, secondary size/points, voxel."),
    noise=("Cloud Noise SOP passes, coarse to fine: ~1/4 of the cloud (big billows), ~1/12 (medium), ~25-30 m (the smallest the 8 m "
           "runtime grid can show). `amount` is erosion depth; `advect` is a domain warp that rolls the lumps. This is the HZD-style "
           "layered erosion (" + DOC + "nubis-sources.md); the 3.5x lobe-ladder idea is in " + DOC + "topics/shape.md."),
    finish=("vdbsmooth removes voxel stair-steps before the resample to 8 m. `flat_base` fades density to zero below `base` (metres) over "
            "`basefade`: the flat cloud floor (Cloud SOP's own Flatten did not give one here). Then the `export` ROP writes density "
            "to houdini/cache/<rig>.vdb."),
    controls=("EDIT HERE. Every value below is channel-referenced by the real nodes (ch(\"../CONTROLS/...\")). Render the `export` ROP, then press "
              "'Run converter' to make runtime files in houdini/cache/nvdf/. These controls start at the recipe in build_heroes.py; to make a "
              "change permanent copy the numbers back into RECIPES there and rerun scripts/vdb/authoring/rigs.py."),
)


def rig_hero(name):
    key = {'hero_tower': 'tower', 'hero_valleyfog': 'valley-fog', 'hero_fairweather': 'fairweather'}[name]
    rcp = copy.deepcopy(bh.RECIPES[key])
    geo, last, rcp = bh.build_network(key, rcp)
    geo.setName(name)
    cl, nz = rcp['cloud'], rcp['noise']
    rows = [('Cloud', 'voxel', 'Authoring voxel (m)', rcp['voxel'], 1, 16),
            ('Cloud', 'band', 'Shoulder band (m)', cl.get('exteriorband', 100.0), 1, 400),
            ('Cloud', 'densitymultiplier', 'Density multiplier', cl.get('densitymultiplier', 2.0), 0.1, 10),
            ('Cloud', 'secondaryshapesize', 'Secondary bump size (m)', cl.get('secondaryshapesize', 40.0), 1, 200),
            ('Cloud', 'scatterpoints', 'Secondary points', int(cl.get('scatterpoints', 100)), 0, 400)]
    for i, p in enumerate(nz):
        f = 'Noise %d' % (i + 1)
        rows += [(f, 'n%d_amount' % i, 'Amount', p['noiseamount'], 0, 3), (f, 'n%d_size' % i, 'Element size (m)', p['noiseelementsize'], 5, 500),
                 (f, 'n%d_rough' % i, 'Roughness', p['noiserough'], 0, 1)]
        if p.get('advectnoise'):
            rows += [(f, 'n%d_advect' % i, 'Advect amount', p['advectamp'], 0, 1)]
    if rcp.get('base') is not None:
        rows += [('Finish', 'base', 'Flat base height (m)', rcp['base'], 0, 200), ('Finish', 'basefade', 'Base fade (m)', rcp.get('basefade', 40.0), 1, 200)]
    ctl = add_controls(geo, rows, 'EDIT ME: key parameters of %s' % name)
    C = '"../CONTROLS/%s"'
    c = geo.node('cloud')
    set_expr(c.parm('divsize'), 'ch(%s)' % (C % 'voxel'))
    set_expr(c.parm('exteriorband'), 'ch(%s)' % (C % 'band'))
    set_expr(c.parm('interiorband'), 'ch(%s)' % (C % 'band'))
    for p in ('densitymultiplier', 'secondaryshapesize', 'scatterpoints'):
        set_expr(c.parm(p), 'ch(%s)' % (C % p))
    for i, p in enumerate(nz):
        n = geo.node('cloud_noise_%d' % (i + 1))
        for parm, ctrl in (('noiseamount', 'amount'), ('noiseelementsize', 'size'), ('noiserough', 'rough')):
            set_expr(n.parm(parm), 'ch(%s)' % (C % ('n%d_%s' % (i, ctrl))))
        if p.get('advectnoise'):
            set_expr(n.parm('advectamp'), 'ch(%s)' % (C % ('n%d_advect' % i)))
    fb = geo.node('flat_base')
    if fb is not None:
        fb.parm('snippet').set('@density *= smooth(ch("../CONTROLS/base"), ch("../CONTROLS/base") + ch("../CONTROLS/basefade"), @P.y);')
    ex = add_export(geo, last, name)
    add_converter_button(ctl, name, ['--voxel-size', 8] + list(rcp.get('convert', [])), 'build_heroes.py convert step')
    balls = [n for n in geo.children() if n.name().startswith('ball')] + [geo.node('source_spheres')]
    stage(geo, '1 Source shapes', None, HERO_NOTES['sources'], nodes=balls)
    stage(geo, '2 Cloud SOP (polygons -> fog VDB)', ['cloud'], HERO_NOTES['cloud'])
    stage(geo, '3 Cloud Noise passes (coarse to fine)', [n.name() for n in geo.children() if n.name().startswith('cloud_noise')], HERO_NOTES['noise'])
    stage(geo, '4 Finish and export', ['smooth', 'flat_base', 'export'], HERO_NOTES['finish'])
    finish(geo, name, last)
    # controls last: place above the sources, left side
    ctl.setPosition(hou.Vector2(-8, 4))
    s = geo.createStickyNote()
    s.setText('CONTROLS\n\n' + HERO_NOTES['controls'])
    s.setSize(hou.Vector2(6, 6))
    s.setPosition(hou.Vector2(-15, 0))
    s.setColor(hou.Color((1.0, 0.8, 0.4)))
    s.setTextColor(hou.Color((0.1, 0.1, 0.1)))
    return geo, 'cloud'


# ----------------------------------------------------------------------------------------------- sim rigs (sim_clouds)

SIM_NOTES = dict(
    source=("Emitter, as an artist would set it up: two empty volumes (density, temperature) -> `source_noise` volume wrangler. Flat noisy "
            "disc(s) at y = 0 (the cloud base); noise breaks the outline, and a thresholded cell noise (cellfreq, cell0, cell1, floor) "
            "leaves only a few hot spots, which become the separate thermals that make turrets. Sim units: 1 unit = world_scale m (100). "
            "Guerrilla grew their clouds this way (" + DOC + "sources/n3/, slides 63-64); the flat-lens variant is the A2 task. "
            "Emitters: edit the array in the VEX (x z rx rz weight start heat end)."),
    cap=("Inversion lid: a cold slab ADDED to temperature every frame, so thermals that reach it lose buoyancy and spread sideways "
         "(flat tops, stratocumulus, the shelf for a pileus). It settles near -strength / tempcooling, so strengths are small (0.005-0.025)."),
    solver=("Pyro Solver SOP (sparse). IMPORTANT (L1 finding, sim/README.md): lift = -buoyancylift * (T1 - T0) / T0 * g, so temperature0 "
            "MUST be > 0. T0 = 0 divides by zero and buoyancy silently does nothing (the old P4-F/P9-F plumes rose by turbulence alone). "
            "Working values: T0 = 1, T1 = 2, buoyancylift 0.3-0.8. Cooling and dissipation low (0.005-0.05) or the plume dies as a pancake. "
            "turbulence / disturbance: ragged and wide when high, tight and tall when low. This rig does not cook the sim on save: scrub the "
            "timeline (frame 1 to `frames`) to run it."),
    post=("`keep_density` keeps only the density volume, `to_vdb` makes a fog VDB, `remap` smoothsteps sim density lo..hi to 0..1 (soft "
          "shoulder) and fades in above `base` for the flat cloud floor. `stretch_y` (only when the recipe warps) resamples with a vertical "
          "stretch, lean (shear), taper and flattening. The vdbactivate box (`grow_region`) is set by the builder per checkpoint from the "
          "cooked bounds; in this rig it is a generous estimate, widen it if the cloud is clipped. Then `smooth` and the `export` ROP."),
    controls=("EDIT HERE. Values are channel-referenced by the solver, the wrangler VEX (ch(\"../CONTROLS/...\")) and the remap. Scrub from frame 1 "
              "after any change (the solver restarts). Render `export` at the frame you like, then 'Run converter'. These start at the builder "
              "recipe (sim_clouds.py / library.py / targets.py); copy winning numbers back there and rerun rigs.py. Output scale: "
              "converter --world-scale is already in the converter args."),
)

SRC_KEYS = ['height', 'rate', 'temp', 'noisefreq', 'noiseamp', 'edge', 'cellfreq', 'cell0', 'cell1', 'floor', 'emit_frames']
REMAP_KEYS = ['lo', 'hi', 'base', 'basefade']
WARP_KEYS = ['stretch', 'stretch_from', 'shear', 'taper']
SOLVER_KEYS = [('buoyancylift', 'Buoyancy lift', 0, 20), ('temperature0', 'Temperature 0 (must be > 0)', 0.01, 10),
               ('temperature1', 'Temperature 1', 0.01, 10), ('tempcooling', 'Temp cooling', 0, 1), ('dissipation', 'Dissipation', 0, 1),
               ('turbulence', 'Turbulence', 0, 3), ('turbulence_swirlsize', 'Swirl size', 0.01, 3), ('disturbance', 'Disturbance', 0, 3),
               ('disturbance_blocksize', 'Disturbance block size', 0.01, 3)]


def sentinel_render(template, params, keys, prefix):
    """Fill a VEX template with `params`, but write channel references for `keys` (using unique sentinel numbers)."""
    sent, p = {}, dict(params)
    for i, k in enumerate(keys):
        if k in p:
            sent[k] = '%g' % (90000.5 + i * 10)
            p[k] = 90000.5 + i * 10
    txt = template % p
    for k, sv in sent.items():
        txt = re.sub(r'(?<![\d.])' + re.escape(sv) + r'(?![\d])', 'ch("../CONTROLS/%s%s")' % (prefix, k), txt)
    return txt


def rig_sim(name, rcp, title):
    rcp = copy.deepcopy(rcp)
    geo, ps, last = sc.build(name, rcp)
    src, ems = sc.source_params(rcp)
    rows = []
    for k in SRC_KEYS:
        if k in src:
            rows.append(('Source', 'src_' + k, 'src ' + k, src[k], -10, 400 if k == 'emit_frames' else 10))
    rows.append(('Source', 'frames', 'Sim frames (playbar)', int(rcp['frames']), 10, 1000))
    for k, lab, lo, hi in SOLVER_KEYS:
        if k in rcp['solver']:
            rows.append(('Solver', k, lab, rcp['solver'][k], lo, hi))
    cap = rcp.get('cap')
    if cap:
        rows.append(('Source', 'cap_strength', 'Lid strength', cap['strength'], 0, 0.2))
    rm = rcp['remap']
    for k in REMAP_KEYS:
        rows.append(('Remap', 'remap_' + k, 'remap ' + k, rm[k], 0, 5))
    warp = sc.warp_params(rcp) if sc.needs_warp(rcp) else None
    if warp:
        for k in WARP_KEYS:
            rows.append(('Remap', 'warp_' + k, 'warp ' + k, warp[k], -5, 10))
    ctl = add_controls(geo, rows, 'EDIT ME: key parameters of %s' % name)
    # channel links: solver parms
    for k, lab, lo, hi in SOLVER_KEYS:
        if k in rcp['solver']:
            set_expr(geo.node('pyro').parm(k), 'ch("../CONTROLS/%s")' % k)
    geo.node('source_noise').parm('snippet').set(sentinel_render(sc.SOURCE_VEX, src, SRC_KEYS, 'src_'))
    geo.node('remap').parm('snippet').set(sentinel_render(sc.REMAP_VEX, rm, REMAP_KEYS, 'remap_'))
    if cap:
        capsrc = dict(cap, soft=cap.get('soft', 0.1))
        geo.node('cap_lid').parm('snippet').set(sentinel_render(sc.CAP_VEX, capsrc, ['strength'], 'cap_'))
    if warp:
        geo.node('stretch_y').parm('snippet').set(sentinel_render(sc.WARP_VEX, warp, WARP_KEYS, 'warp_'))
        # generous estimate of the grow region (the builder sets it per checkpoint from cooked bounds)
        xs = [e[0] - 1.6 * e[2] for e in ems] + [e[0] + 1.6 * e[2] for e in ems]
        zs = [e[1] - 1.6 * e[3] for e in ems] + [e[1] + 1.6 * e[3] for e in ems]
        top = 12.0 * max(1.0, warp['stretch'])
        mn, mx = [min(xs) - 1, 0.0, min(zs) - 1], [max(xs) + 1 + abs(warp['shear']) * top, top, max(zs) + 1]
        a = geo.node('grow_region')
        a.parmTuple('min').set(mn)
        a.parmTuple('max').set(mx)
        a.parmTuple('center').set([(mn[i] + mx[i]) / 2 for i in range(3)])
        a.parmTuple('size').set([mx[i] - mn[i] for i in range(3)])
        if rcp.get('pileus'):
            p = rcp['pileus']
            geo.node('pileus').parm('snippet').set(sc.PILEUS_VEX % dict(centre='{0, %g, 0}' % (top * 0.5), rx=p['rx'], ry=p['ry'],
                                                                         thick=p['thick'], density=p.get('density', 0.8)))
    ex = add_export(geo, last, name, sim_frames=True)
    conv = ['--voxel-size', rcp.get('voxel', 8), '--world-scale', rcp['world_scale']] + list(rcp.get('convert', []))
    add_converter_button(ctl, name, conv, title)
    stage(geo, '1 Source (emitter volumes)', ['src_density', 'src_temperature', 'src_merge', 'source_noise'], SIM_NOTES['source'])
    if cap:
        stage(geo, '1b Inversion lid', ['src_cap', 'cap_lid', 'src_merge_cap'], SIM_NOTES['cap'])
    warn = ''
    if rcp['solver'].get('temperature0', 300.0) <= 0:
        warn = ('\n\nWARNING: this recipe has temperature0 = 0, so buoyancy is OFF (plume moves by turbulence only; see above). Set temperature0 = 1 and '
                'temperature1 = 2 on CONTROLS, with buoyancylift ~0.5, to see the real thermal behaviour. Kept as the builder has it.')
    stage(geo, '2 Pyro solver', ['pyro'], SIM_NOTES['solver'] + warn)
    post = ['keep_density', 'to_vdb', 'remap', 'grow_region', 'stretch_y', 'pileus', 'smooth', 'export']
    stage(geo, '3 Post: remap, warp, smooth, export', post, SIM_NOTES['post'])
    finish(geo, name, last, frames=int(rcp['frames']))
    ctl.setPosition(hou.Vector2(-8, 4))
    s = geo.createStickyNote()
    s.setText('CONTROLS\n\n' + SIM_NOTES['controls'])
    s.setSize(hou.Vector2(6, 7))
    s.setPosition(hou.Vector2(-15, 0))
    s.setColor(hou.Color((1.0, 0.8, 0.4)))
    s.setTextColor(hou.Color((0.1, 0.1, 0.1)))
    return geo, 'source_noise'


def lib_rig(entry):
    def f(name):
        # L2_RETUNED only guards writes into assets/clouds/library/; a rig never writes there, so any entry may be saved.
        return rig_sim(name, lb.recipe(entry), 'library.py entry %s (%s)' % (entry, lb.LIBRARY[entry]['species']))
    return f


def targets_rig(name):
    return rig_sim(name, tg.recipe('texas-tower', {}), 'targets.py texas-tower base recipe v00')


RIGS = {
    'hero_tower': (rig_hero, 'build_heroes.py tower'),
    'hero_fairweather': (rig_hero, 'build_heroes.py fairweather'),
    'hero_valleyfog': (rig_hero, 'build_heroes.py valley-fog'),
    'sim_cumulus': (lambda n: rig_sim(n, sc.RECIPES['cumulus'], 'sim_clouds.py cumulus'), 'sim_clouds.py cumulus'),
    'sim_congestus': (lambda n: rig_sim(n, sc.RECIPES['congestus'], 'sim_clouds.py congestus'), 'sim_clouds.py congestus'),
    'library_congestus-a': (lib_rig('congestus-a'), 'library.py congestus-a (L2 template)'),
    'library_mediocris-a': (lib_rig('mediocris-a'), 'library.py mediocris-a (L2 template)'),
    'texas_tower': (targets_rig, 'targets.py texas-tower (L1 base recipe)'),
}


def make(name):
    hou.hipFile.clear(suppress_save_prompt=True)
    fn, _ = RIGS[name]
    geo, first = fn(name)
    # sanity: the first stage must cook without errors
    geo.node(first).cook(force=True)
    bad = [(n.name(), n.errors()) for n in geo.children() if n.errors()]
    if bad:
        raise SystemExit('%s: cook errors in first stage: %s' % (name, bad))
    path = save(name)
    print('[rig] %-22s %6.1f KB  %d nodes  %s' % (name, os.path.getsize(path) / 1024, len(geo.children()), os.path.relpath(path, REPO)))
    return path


def verify(names):
    for name in names:
        path = os.path.join(RIG_DIR, name + '.hip')
        hou.hipFile.load(path, suppress_save_prompt=True, ignore_load_warnings=True)
        geo = hou.node('/obj/' + name)
        first = 'cloud' if name.startswith('hero_') else 'source_noise'
        n = geo.node(first)
        n.cook(force=True)
        g = n.geometry()
        kind = 'prims=%d' % len(g.prims()) if g is not None else 'no geometry'
        ctl = geo.node('CONTROLS')
        linked = 0
        for nn in geo.children():
            for p in nn.parms():
                try:
                    linked += 'CONTROLS' in p.expression()
                except hou.OperationFailed:
                    pass
                if nn.type().name() == 'volumewrangler' or 'wrangle' in nn.type().name():
                    pass
        wr = sum(nn.parm('snippet').eval().count('CONTROLS') for nn in geo.children() if nn.parm('snippet') is not None)
        linked += wr
        print('[verify] %-22s %6.1f KB  nodes=%d  boxes=%d  notes=%d  controls=%d  linked parms=%d  first stage %s: %s, errors=%s'
              % (name, os.path.getsize(path) / 1024, len(geo.children()), len(geo.networkBoxes()), len(geo.stickyNotes()),
                 len(ctl.spareParms()), linked, first, kind, n.errors() or 'none'))
        print('         nodes: ' + ', '.join(c.name() for c in geo.children() if not c.name().startswith('ball')))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('names', nargs='*', help='rigs to write (default all)')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--verify', action='store_true', help='open each saved .hip, cook the first stage, print nodes and sizes')
    a = ap.parse_args()
    if a.list:
        for n, (_, src) in RIGS.items():
            print('%-22s from %s' % (n, src))
        return
    names = a.names or list(RIGS)
    for n in names:
        if n in FOREIGN or n not in RIGS:
            raise SystemExit('unknown or foreign rig %r (see --list)' % n)
    if a.verify:
        verify(names)
        return
    for n in names:
        make(n)


if __name__ == '__main__':
    main()
