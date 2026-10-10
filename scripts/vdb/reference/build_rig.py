#!/usr/bin/env python3
"""V1: build the Karma reference-render rig for the EmberGen CloudPack and save it as houdini/rigs/reference_render.hip.

  HYTHON=/Applications/Houdini/Houdini21.0.671/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython
  $HYTHON scripts/vdb/reference/build_rig.py            # build + save the .hip
  $HYTHON scripts/vdb/reference/build_rig.py --verify   # also check the placement against the converted assets' focus boxes

The rig (all in /stage, Solaris):
  five branches (one per cloud): Volume LOP (the third-party VDB, referenced from disk, not copied) -> Transform LOP
  (Z-up -> Y-up, x4, translate: exactly the converter + flagship placement, scene.py) -> two Camera LOPs (/cameras/photo,
  /cameras/detail: the C1 bookmarks) -> Switch on CONTROLS/cloud -> Material Library (cloud material: density -> extinction,
  albedo, two-lobe HG) -> Assign -> Karma Physical Sky (sun + sky dome at the C1 sun) -> Karma Render Settings.
Every look parameter is channel-referenced from the CONTROLS null. Nothing is cooked or cached in the file.
"""
import argparse
import os
import sys

import hou

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scene  # noqa: E402

RIG = os.path.join(scene.REPO, 'houdini', 'rigs', 'reference_render.hip')

# CONTROLS: (folder, name, label, default, min, max, help)
CONTROL_ROWS = [
    ('Shot', 'cloud', 'Cloud (index into 02 03 08 09 10)', 0, 0, 4, 'Switch input: 0=02 1=03 2=08 3=09 4=10'),
    ('Shot', 'view', 'View (0 photo 48 deg, 1 detail 20 deg)', 0, 0, 1, 'C1 bookmark framing'),
    ('Material', 'density_mult', 'Extinction per unit density (1/m)', 0.6, 0.0, 4.0,
     'sigma_t = density * this. 0.6 puts the interior plateau (density ~0.12) at ~0.075 /m = cumulus (LWC 0.5 g/m3, r_e 10 um): mean free path ~13 m'),
    ('Material', 'albedo', 'Single-scattering albedo', 0.99, 0.0, 1.0, 'water droplets in visible light are ~0.9999; 0.99 per the task'),
    ('Material', 'g_fwd', 'Forward lobe g', 0.88, -1.0, 1.0, 'HG forward lobe (Mie diffraction peak stand-in)'),
    ('Material', 'g_back', 'Back lobe g', -0.3, -1.0, 1.0, 'HG back lobe (glory/backscatter stand-in)'),
    ('Material', 'back_mix', 'Back lobe weight', 0.08, 0.0, 1.0, 'mix weight of the back lobe; mean cosine = (1-w) g_fwd + w g_back'),
    ('Light', 'sun_el', 'Sun elevation (deg)', scene.SUN_EL, 0.0, 90.0, 'C1: time 15.9 at lat 40'),
    ('Light', 'sun_az', 'Sun azimuth (deg, compass, north = -Z)', scene.SUN_AZ, 0.0, 360.0, 'Karma Physical Sky uses the same convention as bookmarks.ts sunVector'),
    ('Light', 'turbidity', 'Sky turbidity', 3.0, 1.0, 10.0, 'Karma Physical Sky default; clear day'),
    ('Light', 'ground_albedo', 'Ground albedo', 0.2, 0.0, 1.0, 'lower hemisphere of the sky dome: lights the cloud base like grass/soil'),
    ('Render', 'engine', 'Engine (0 cpu, 1 xpu)', 0, 0, 1, 'Karma CPU or XPU'),
    ('Render', 'samples', 'Path-traced samples per pixel', 32, 1, 4096, 'max samples (variance oracle stops early in the sky); OIDN denoise on'),
    ('Render', 'volume_limit', 'Volume bounce limit', 128, 0, 1024, 'multiple scattering orders; 16 loses 33% of the body radiance, 64 -> 128 +1.4%, 128 -> 256 +0.4%'),
    ('Render', 'volume_step_rate', 'Volume step rate', 1.0, 0.01, 4.0, 'CPU ray-march step = voxel / rate; 1 = 4 m'),
    ('Render', 'resx', 'Resolution X', scene.RES[0], 16, 8192, ''),
    ('Render', 'resy', 'Resolution Y', scene.RES[1], 16, 8192, ''),
]


def add_controls(parent):
    ctl = parent.createNode('null', 'CONTROLS')
    ctl.setColor(hou.Color((1.0, 0.75, 0.2)))
    ptg = ctl.parmTemplateGroup()
    folders = {}
    for folder, name, label, value, lo, hi, helptext in CONTROL_ROWS:
        if isinstance(value, int):
            t = hou.IntParmTemplate(name, label, 1, default_value=(value,), min=int(lo), max=int(hi))
        else:
            t = hou.FloatParmTemplate(name, label, 1, default_value=(value,), min=lo, max=hi)
        if helptext:
            t.setHelp(helptext)
        folders.setdefault(folder, []).append(t)
    for folder, temps in folders.items():
        f = hou.FolderParmTemplate(folder.lower(), folder)
        for t in temps:
            f.addParmTemplate(t)
        ptg.append(f)
    out = hou.StringParmTemplate('picture', 'Output image', 1, default_value=(os.path.join(scene.OUT_DIR, 'exr', 'frame.exr'),),
                                 string_type=hou.stringParmType.FileReference)
    ptg.append(out)
    ctl.setParmTemplateGroup(ptg)
    return ctl


def ch(name):
    return f'ch("../CONTROLS/{name}")'


def chm(name):
    """channel reference from inside the material library (one level deeper)."""
    return f'ch("../../CONTROLS/{name}")'


def set_expr(parm, expr):
    parm.setExpression(expr, hou.exprLanguage.Hscript)


def note(parent, text, pos, size=(6, 2.2)):
    s = parent.createStickyNote()
    s.setText(text)
    s.setPosition(hou.Vector2(*pos))
    s.setSize(hou.Vector2(*size))
    return s


def read_vdb(c):
    """indexToPos(0), active bbox (hou index), and the world bbox of density >= iso after our transform (for --verify)."""
    g = hou.node('/obj').createNode('geo', f'probe_{c}')
    f = g.createNode('file')
    f.parm('file').set(scene.vdb_path(c))
    p = f.geometry().prims()[0]
    bb = p.activeVoxelBoundingBox()
    info = (list(p.indexToPos((0, 0, 0))), [int(round(v)) for v in bb.minvec()], [int(round(v)) for v in bb.maxvec()], p)
    return g, info


def build(verify=False):
    hou.hipFile.clear(suppress_save_prompt=True)
    stage = hou.node('/stage')
    ctl = add_controls(stage)
    ctl.setPosition(hou.Vector2(-8, 4))

    switch = stage.createNode('switch', 'cloud_switch')
    set_expr(switch.parm('input'), ch('cloud'))
    report = []
    branches = []
    for i, c in enumerate(scene.CLOUDS):
        g, (index0, alo, ahi, prim) = read_vdb(c)
        tx, ty, tz = scene.placement(c, index0, alo, ahi)
        vol = stage.createNode('volume', f'vdb_{c}')
        vol.parm('primpath').set('/clouds/cloud')
        vol.parm('filepath1').set(scene.vdb_path(c))
        xf = stage.createNode('xform', f'place_{c}')
        xf.setInput(0, vol)
        xf.parm('primpattern').set('/clouds/cloud')
        xf.parm('xOrd').set('srt')
        xf.parm('rOrd').set('xyz')
        xf.parmTuple('s').set((scene.WORLD_SCALE,) * 3)
        xf.parmTuple('r').set((-90.0, 0.0, 0.0))
        xf.parmTuple('t').set((tx, ty, tz))
        prev = xf
        for view in scene.VIEWS:
            pos, tgt, hfov = scene.camera(c, view)
            rx, ry = scene.camera_euler(pos, tgt)
            cam = stage.createNode('camera', f'cam_{view}_{c}')
            cam.setInput(0, prev)
            cam.parm('primpath').set(f'/cameras/{view}')
            cam.parm('rOrd').set('xyz')
            cam.parmTuple('t').set(tuple(pos))
            cam.parmTuple('r').set((rx, ry, 0.0))
            cam.parm('focalLength').set(scene.focal_mm(hfov))
            cam.parm('horizontalAperture').set(scene.APERTURE_MM)
            cam.parm('clippingRange1').set(1.0)
            cam.parm('clippingRange2').set(1e6)
            prev = cam
        switch.setInput(i, prev)
        for j, n in enumerate([vol, xf] + [stage.node(f'cam_{v}_{c}') for v in scene.VIEWS]):
            n.setPosition(hou.Vector2(i * 3.5, -j * 1.2))
        box = stage.createNetworkBox(f'box_{c}')
        box.setComment(f'CloudPack {c}')
        for n in [vol, xf] + [stage.node(f'cam_{v}_{c}') for v in scene.VIEWS]:
            box.addItem(n)
        box.fitAroundContents()
        if verify:
            import numpy as np
            n = [ahi[k] - alo[k] for k in range(3)]
            flat = prim.voxelRangeAsFloat(hou.BoundingBox(*alo, *ahi))
            arr = np.asarray(flat, dtype=np.float32).reshape(n[2], n[1], n[0])   # [z, y, x]
            zs, ys, xs = (np.flatnonzero((arr >= 0.05).any(axis=tuple(a for a in range(3) if a != ax))) for ax in range(3))
            # voxel-index bounds -> hou positions (voxel corners) -> our world
            o = [index0[k] + alo[k] for k in range(3)]
            P_lo = [o[0] + xs[0] - 0.5, o[1] + ys[0] - 0.5, o[2] + zs[0] - 0.5]
            P_hi = [o[0] + xs[-1] + 0.5, o[1] + ys[-1] + 0.5, o[2] + zs[-1] + 0.5]
            wmin = [4 * P_lo[0] + tx, 4 * P_lo[2] + ty, -4 * P_hi[1] + tz]
            wmax = [4 * P_hi[0] + tx, 4 * P_hi[2] + ty, -4 * P_lo[1] + tz]
            fmin, fmax = scene.focus_box(c)
            report.append(f'{c}: t=({tx:.1f}, {ty:.1f}, {tz:.1f}) density>=0.05 world box {[round(v) for v in wmin]}..{[round(v) for v in wmax]}'
                          f'  vs asset focus box {fmin}..{fmax}')
        g.destroy()
    switch.setPosition(hou.Vector2(7, -6))
    branches_note = note(stage, 'Per-cloud branches. Volume LOP references the EmberGen VDB on disk (third-party, never copied). '
                         'place_NN = converter + flagship placement: scale 4 (1 EmberGen unit = 4 m), rotate -90 about X (Z-up -> Y-up, '
                         'a rotation like vdb_to_nvdf.py --up z, not a mirror), translate so the converter crop box is centred on x=z=0 '
                         'with its floor at 1300 m (visible base ~1364 m: the bottom 10 voxels fade in). Cameras = C1 bookmarks photo '
                         '(48 deg hfov, 40.4 mm) and detail (20 deg, 102 mm) from scripts/vdb/reference/scene.py.', (-1, 1.6), (17, 1.4))

    # --- material: density -> sigma_t; scattering = albedo sigma_t; absorption = (1 - albedo) sigma_t; two-lobe HG
    matlib = stage.createNode('materiallibrary', 'cloud_material')
    matlib.setInput(0, switch)
    matlib.setPosition(hou.Vector2(7, -7.5))
    dens = matlib.createNode('mtlxgeompropvalue', 'density_field')
    dens.parm('signature').set('default')
    dens.parm('geomprop').set('density')
    sig = matlib.createNode('mtlxmultiply', 'sigma_t')
    sig.setInput(0, dens)
    set_expr(sig.parm('in2'), chm('density_mult'))
    scat = matlib.createNode('mtlxmultiply', 'scattering')
    scat.parm('signature').set('vector3FA')
    for comp in 'xyz':
        set_expr(scat.parm(f'in1_vector3FA{comp}' if scat.parm(f'in1_vector3FA{comp}') else f'in1_vector3{comp}'), chm('albedo'))
    scat.setInput(1, sig)
    absn = matlib.createNode('mtlxmultiply', 'absorption')
    absn.parm('signature').set('vector3FA')
    for comp in 'xyz':
        set_expr(absn.parm(f'in1_vector3FA{comp}' if absn.parm(f'in1_vector3FA{comp}') else f'in1_vector3{comp}'), f'1 - {chm("albedo")}')
    absn.setInput(1, sig)
    vol_sh = matlib.createNode('kma_volume', 'vapour_volume')
    vol_sh.setInput(vol_sh.inputIndex('scattering'), scat)
    vol_sh.setInput(vol_sh.inputIndex('absorption'), absn)
    set_expr(vol_sh.parm('anisotropy'), chm('g_fwd'))
    set_expr(vol_sh.parm('secondaryanisotropy'), chm('g_back'))
    set_expr(vol_sh.parm('secondarymix'), chm('back_mix'))
    vol_sh.parm('extinctionmodifier').set(0.0)      # no multiple-scattering approximation: brute-force bounces only
    vol_sh.parm('contributionmodifier').set(1.0)
    mat = matlib.createNode('mtlxvolumematerial', 'vapour')
    mat.setInput(0, vol_sh)
    matlib.layoutChildren()

    assign = stage.createNode('assignmaterial', 'assign_vapour')
    assign.setInput(0, matlib)
    assign.parm('primpattern1').set('/clouds/cloud')
    assign.parm('matspecpath1').set('/materials/vapour')
    assign.setPosition(hou.Vector2(7, -8.7))

    sky = stage.createNode('karmaphysicalsky', 'sun_and_sky')
    sky.setInput(0, assign)
    set_expr(sky.parm('solar_altitude'), ch('sun_el'))
    set_expr(sky.parm('solar_azimuth'), ch('sun_az'))
    set_expr(sky.parm('turbidity'), ch('turbidity'))
    for comp in 'rgb':
        set_expr(sky.parm(f'ground_albedo{comp}'), ch('ground_albedo'))
    sky.parm('renderlightgeo').set(1)
    sky.setPosition(hou.Vector2(7, -9.9))

    rs = stage.createNode('karmarendersettings', 'render_settings')
    rs.setInput(0, sky)
    rs.parm('engine').setExpression('ifs(ch("../CONTROLS/engine") == 1, "xpu", "cpu")', hou.exprLanguage.Hscript)
    rs.parm('camera').setExpression('ifs(ch("../CONTROLS/view") == 1, "/cameras/detail", "/cameras/photo")', hou.exprLanguage.Hscript)
    rs.parm('res_mode').set('manual')
    rs.parm('resolutiony').lock(False)      # locked by the default autoheight mode
    set_expr(rs.parm('resolutionx'), ch('resx'))
    set_expr(rs.parm('resolutiony'), ch('resy'))
    set_expr(rs.parm('pathtracedsamples'), ch('samples'))
    set_expr(rs.parm('volumelimit'), ch('volume_limit'))
    set_expr(rs.parm('volumesteprate'), ch('volume_step_rate'))
    rs.parm('colorlimit').set(1000.0)          # default 20 clamps the forward-scattered sun: biases a reference
    rs.parm('colorlimitindirect').set(1000.0)
    rs.parm('denoiser').set('oidn')              # Intel Open Image Denoise with albedo + N guides
    rs.parm('picture').setExpression('chs("../CONTROLS/picture")', hou.exprLanguage.Hscript)
    rs.setPosition(hou.Vector2(7, -11.1))
    rs.setDisplayFlag(True)

    rop = stage.createNode('usdrender_rop', 'render')
    rop.setInput(0, rs)
    rop.setPosition(hou.Vector2(7, -12.3))
    rop.parm('renderer').set('BRAY_HdKarma')

    note(stage, 'cloud_material: sigma_t = density x CONTROLS/density_mult (1/m). EmberGen density: plateau ~0.12 inside, max 0.6-0.8, '
         'surface 0.05. 0.6/m puts the plateau at ~0.075 /m (cumulus: LWC 0.5 g/m3, r_e 10 um -> 3 LWC / (2 rho r_e) = 0.075 /m), '
         'optical depth ~40 through the body. Scattering = albedo sigma_t, absorption = (1 - albedo) sigma_t. Phase: kma_volume '
         'two-lobe Henyey-Greenstein, forward g 0.88, back g -0.3 at weight 0.08 (mean cosine 0.79). No extinction modifier: '
         'multiple scattering is brute force up to the volume limit.', (11, -8.0), (8, 1.6))
    note(stage, 'sun_and_sky: Karma Physical Sky = Hosek-Wilkie sky dome + sun disc, physically consistent with each other. '
         'C1 sun: elevation 38.8, azimuth 269.5 (west; compass, north = -Z, same as bookmarks.ts). Ground albedo 0.2 on the '
         'lower hemisphere stands in for the bounce off the ground under the cloud. Exposure and tone map are applied after '
         'the render (render.py): linear EXR out.', (11, -10.1), (8, 1.2))
    note(stage, 'Render: CONTROLS/engine, samples (32 + OIDN), volume_limit (>= 16; 128 default), step rate 1 (4 m steps). Colour limit raised '
         'to 1000 so the clamp does not eat the forward-scattered sun. Run scripts/vdb/reference/render.py to render all 5 x 2 '
         'frames headless with husk; it sets CONTROLS/cloud, view and picture per frame.', (11, -12.0), (8, 1.0))
    ctl_note = note(stage, 'CONTROLS: shot (cloud, view), material, light and render settings. Every node reads its look parameters '
                    'from here.', (-8, 5.4), (5, 0.6))
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--verify', action='store_true')
    ap.add_argument('--out', default=RIG)
    args = ap.parse_args()
    report = build(args.verify)
    for line in report:
        print(line)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    hou.hipFile.save(args.out)
    print('saved', args.out, os.path.getsize(args.out), 'bytes')


if __name__ == '__main__':
    main()
