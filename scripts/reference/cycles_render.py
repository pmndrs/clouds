"""Cycles reference render of one reference-frame manifest (scripts/reference/README.md), in linear radiance.

  Blender -b --factory-startup -P scripts/reference/cycles_render.py -- manifest.json --out frame.exr \
      [--pfm frame.pfm] [--device CPU|GPU] [--spp N] [--passes] [--alpha] [--threads N] [--vol-step M] [--null-scattering]

VOLUME MODE. Default: Cycles' ray-marching volume mode ("biased") with a step of voxel / 4 (world metres). In Blender 5.1 the default
null-scattering mode is NOT energy conserving on dense real grids: a furnace on the EmberGen cloud (albedo 1, uniform sky 1) reads
1.04 mean / 1.13 through the medium at sigma_t 0.6/m density, with negative pixels from an underestimated majorant, and a sunlit
render is 10 % too bright in the thick body. Ray marching passes the same furnace exactly and the transmittance checks within
0.1 %; the step converges (voxel/2 vs voxel/4 differ by < 0.1 %). --null-scattering restores Blender's default for comparison.
The text below describes the rest of the setup.

Builds the scene from the manifest only (empty factory scene): the raw float32 grid becomes a temporary .vdb (openvdb module), a
volume object with Volume Scatter (+ Volume Absorption) so that sigma_s = albedo * sigma_t and sigma_a = (1 - albedo) * sigma_t,
sigma_t = density * extinctionScale (1/m); the manifest's phase function; a sun light (W/m^2 irradiance, angle = 2 * angularRadius);
the equirect or uniform world; an optional Lambertian ground plane; the camera. No
denoiser, no clamping, no adaptive sampling, no light threshold, no fast GI, no Russian roulette, box pixel filter 1 px, Standard
view transform with exposure 0 (irrelevant for the EXR, which is scene-linear Rec.709 anyway).

Our world is Y up; Blender's is Z up. Every object is built in our coordinates and then placed with the single proper rotation
R: (x, y, z)_ours -> (x, -z, y)_blender (a +90 degree rotation about X). The world shader undoes R before its equirect lookup.

Outputs: --out multilayer EXR (Combined RGBA 32-bit float, plus passes); --pfm the Combined RGB as PFM; --alpha writes
<pfm stem>.alpha.pfm (1 - camera-ray transmittance, from a transparent-film render of the same scene); --passes writes
<pfm stem>.<pass>.pfm for the volume direct/indirect passes. A <out stem>.json sidecar records what was run and how long it took.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import tempfile
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import refio  # noqa: E402

# Ours (Y up) -> Blender (Z up): (x, y, z) -> (x, -z, y).
R_OURS_TO_BL = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def args_after_dashes():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("manifest", type=Path)
    p.add_argument("--out", type=Path, required=True, help="multilayer EXR")
    p.add_argument("--pfm", type=Path, help="Combined RGB as PFM (default: next to --out)")
    p.add_argument("--device", default="CPU", choices=["CPU", "GPU"])
    p.add_argument("--spp", type=int, help="override render.spp")
    p.add_argument("--passes", action="store_true", help="also write volume direct / indirect passes as PFM")
    p.add_argument("--alpha", action="store_true", help="also render 1 - transmittance along camera rays (second, cheap render)")
    p.add_argument("--threads", type=int, default=0)
    p.add_argument("--step-rate", type=float, default=1.0, help="Cycles volume_step_rate (diagnostic; sizes the majorant grid)")
    p.add_argument("--vol-step", type=float, default=0.0, help="volume object step_size in metres (diagnostic; 0 = automatic)")
    p.add_argument("--null-scattering", action="store_true", help="use Blender's default null-scattering volumes (fails the furnace on dense grids)")
    p.add_argument("--biased", action="store_true", help=argparse.SUPPRESS)   # old name of the (now default) ray-marching mode
    p.add_argument("--interp", default="LINEAR", choices=["LINEAR", "CUBIC"], help="volume interpolation (diagnostic)")
    p.add_argument("--width", type=int, help="override camera width (and height by the same factor), for quick tests")
    p.add_argument("--keep-blend", action="store_true", help="save the built .blend next to --out (debugging)")
    return p.parse_args(argv)


def ours_matrix(x, y, z, t):
    """4x4 with columns x, y, z (basis vectors in our world) and translation t, then moved into Blender's world."""
    m = Matrix.Identity(4)
    for r in range(3):
        m[r][0], m[r][1], m[r][2], m[r][3] = x[r], y[r], z[r], t[r]
    return R_OURS_TO_BL @ m


# ---------------------------------------------------------------- scene pieces

def build_vdb(m, tmpdir):
    import openvdb
    g = m["grid"]
    nx, ny, nz = g["dims"]
    dens = refio.read_grid(refio.resolve(m, g["file"]), g["dims"]).astype(np.float32)
    if (dens < 0).any() or not np.isfinite(dens).all():
        raise ValueError("grid has negative or non-finite values")
    arr = np.ascontiguousarray(dens.transpose(2, 1, 0))  # [i, j, k]
    grid = openvdb.FloatGrid(0.0)
    grid.copyFromArray(arr, (0, 0, 0), 0.0)  # tolerance 0: only exact zeros become inactive background
    grid.name = "density"
    grid.gridClass = openvdb.GridClass.FOG_VOLUME
    v = float(g["voxel"])
    o = [float(c) + 0.5 * v for c in g["origin"]]  # OpenVDB voxel centres sit at integer index coordinates
    grid.transform = openvdb.createLinearTransform([[v, 0, 0, 0], [0, v, 0, 0], [0, 0, v, 0], [o[0], o[1], o[2], 1]])
    path = os.path.join(tmpdir, "density.vdb")
    openvdb.write(path, grids=[grid])
    return path, float(dens.max()), int(grid.activeVoxelCount())


def phase_lobes(phase):
    if phase.get("type") == "mix":
        lobes = phase["lobes"]
        tot = sum(l["weight"] for l in lobes)
        return [(l["weight"] / tot, l) for l in lobes]
    return [(1.0, phase)]


def set_phase(node, ph):
    t = ph.get("type", "hg")
    if t in ("hg", "henyey_greenstein"):
        node.phase = "HENYEY_GREENSTEIN"
        node.inputs["Anisotropy"].default_value = float(ph.get("g", 0.0))
    elif t == "draine":
        node.phase = "DRAINE"
        node.inputs["Anisotropy"].default_value = float(ph["g"])
        node.inputs["Alpha"].default_value = float(ph["alpha"])
    elif t == "mie":
        node.phase = "MIE"
        node.inputs["Diameter"].default_value = float(ph["diameter"])
    elif t == "fournier_forand":
        node.phase = "FOURNIER_FORAND"
        node.inputs["IOR"].default_value = float(ph["ior"])
        node.inputs["Backscatter"].default_value = float(ph["backscatter"])
    elif t == "rayleigh":
        node.phase = "RAYLEIGH"
    else:
        raise ValueError(f"unknown phase type {t}")


def build_volume(m, vdb_path, scene, a=None):
    vol = bpy.data.volumes.new("density")
    vol.filepath = vdb_path
    vol.grids.load()
    vol.render.precision = "FULL"   # default HALF quantises the density
    vol.render.clipping = 0.0       # default 0.001 drops thin material
    vol.render.space = "WORLD"
    # Step of the ray-marching mode (metres, world space): --vol-step, else voxel / 4. Null scattering ignores it.
    g = m["grid"]
    step = float(getattr(a, "vol_step", 0.0) or 0.0) or float(g["voxel"]) / 4.0
    diag = math.sqrt(sum((d * float(g["voxel"])) ** 2 for d in g["dims"]))
    if diag / step > 65536:   # volume_max_steps' hard maximum: a longer march would be cut short
        raise ValueError(f"grid diagonal {diag:.0f} m / step {step} m exceeds 65536 steps; pass a larger --vol-step")
    vol.render.step_size = step
    obj = bpy.data.objects.new("density", vol)
    scene.collection.objects.link(obj)
    obj.matrix_world = R_OURS_TO_BL.copy()

    med = m["medium"]
    alb = med.get("albedo", 1.0)
    alb = [float(alb)] * 3 if not isinstance(alb, list) else [float(a) for a in alb]
    mat = bpy.data.materials.new("medium")
    mat.use_nodes = True
    mat.cycles.volume_interpolation = getattr(a, "interp", "LINEAR")   # trilinear, as the pathtracer
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_type = "GEOMETRY"
    attr.attribute_name = "density"
    sig = nt.nodes.new("ShaderNodeMath")
    sig.operation = "MULTIPLY"
    sig.inputs[1].default_value = float(m["grid"]["extinctionScale"])
    nt.links.new(attr.outputs["Fac"], sig.inputs[0])   # sigma_t (1/m) = grid value * extinctionScale
    shaders = []
    # Volume Scatter: sigma_s = Density * Color; it also adds sigma_s to the extinction.
    for w, ph in phase_lobes(med["phase"]):
        sc = nt.nodes.new("ShaderNodeVolumeScatter")
        sc.inputs["Color"].default_value = (*alb, 1.0)
        set_phase(sc, ph)
        if w == 1.0:
            nt.links.new(sig.outputs[0], sc.inputs["Density"])
        else:
            wm = nt.nodes.new("ShaderNodeMath")
            wm.operation = "MULTIPLY"
            wm.inputs[1].default_value = w
            nt.links.new(sig.outputs[0], wm.inputs[0])
            nt.links.new(wm.outputs[0], sc.inputs["Density"])
        shaders.append(sc)
    # Volume Absorption: sigma_a = Density * (1 - Color).
    if min(alb) < 1.0:
        ab = nt.nodes.new("ShaderNodeVolumeAbsorption")
        ab.inputs["Color"].default_value = (*alb, 1.0)
        nt.links.new(sig.outputs[0], ab.inputs["Density"])
        shaders.append(ab)
    acc = shaders[0].outputs[0]
    for s in shaders[1:]:
        add = nt.nodes.new("ShaderNodeAddShader")
        nt.links.new(acc, add.inputs[0])
        nt.links.new(s.outputs[0], add.inputs[1])
        acc = add.outputs[0]
    nt.links.new(acc, out.inputs["Volume"])
    vol.materials.append(mat)
    return obj


def build_world(m, scene):
    world = bpy.data.worlds.new("sky")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 1.0
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    sky = m.get("sky") or {"uniform": [0, 0, 0]}
    info = {}
    if "uniform" in sky:
        c = [float(x) for x in sky["uniform"]]
        bg.inputs["Color"].default_value = (*c, 1.0)
        world.cycles.sampling_method = "NONE" if max(c) <= 0 else "AUTOMATIC"
        info = {"kind": "uniform", "radiance": c}
    else:
        img = refio.read_pfm(refio.resolve(m, sky["file"]))   # row 0 = +Y
        if img.ndim == 2:
            img = np.repeat(img[:, :, None], 3, axis=2)
        h, w = img.shape[:2]
        scale = float(sky.get("scale", 1.0))
        rgba = np.ones((h, w, 4), np.float32)
        rgba[:, :, :3] = img[::-1] * scale                    # Blender images: row 0 = bottom
        im = bpy.data.images.new("sky", w, h, alpha=False, float_buffer=True)
        im.colorspace_settings.name = "Non-Color"            # values are already scene-linear Rec.709; no transform
        im.pixels.foreach_set(rgba.ravel())
        im.pack()
        # Blender world direction (X, Y, Z) is ours (X, Z, -Y): u = atan2(x, -z) / 2pi = atan2(X, Y) / 2pi; v = acos(y) / pi = acos(Z) / pi.
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nrm = nt.nodes.new("ShaderNodeVectorMath"); nrm.operation = "NORMALIZE"
        nt.links.new(tc.outputs["Generated"], nrm.inputs[0])
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(nrm.outputs[0], sep.inputs[0])
        at = nt.nodes.new("ShaderNodeMath"); at.operation = "ARCTAN2"          # atan(A / B), signed
        nt.links.new(sep.outputs["X"], at.inputs[0]); nt.links.new(sep.outputs["Y"], at.inputs[1])
        um = nt.nodes.new("ShaderNodeMath"); um.operation = "MULTIPLY"; um.inputs[1].default_value = 1 / (2 * math.pi)
        nt.links.new(at.outputs[0], um.inputs[0])
        ac = nt.nodes.new("ShaderNodeMath"); ac.operation = "ARCCOSINE"
        nt.links.new(sep.outputs["Z"], ac.inputs[0])
        vm = nt.nodes.new("ShaderNodeMath"); vm.operation = "MULTIPLY_ADD"     # 1 - acos / pi (Blender v runs upward)
        vm.inputs[1].default_value = -1 / math.pi; vm.inputs[2].default_value = 1.0
        nt.links.new(ac.outputs[0], vm.inputs[0])
        lo = nt.nodes.new("ShaderNodeMath"); lo.operation = "MAXIMUM"; lo.inputs[1].default_value = 0.5 / h   # v clamps
        hi = nt.nodes.new("ShaderNodeMath"); hi.operation = "MINIMUM"; hi.inputs[1].default_value = 1 - 0.5 / h
        nt.links.new(vm.outputs[0], lo.inputs[0]); nt.links.new(lo.outputs[0], hi.inputs[0])
        cmb = nt.nodes.new("ShaderNodeCombineXYZ")
        nt.links.new(um.outputs[0], cmb.inputs["X"]); nt.links.new(hi.outputs[0], cmb.inputs["Y"])
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = im
        tex.interpolation = "Linear"     # bilinear between texel centres
        tex.extension = "REPEAT"         # u wraps (v is clamped above)
        nt.links.new(cmb.outputs[0], tex.inputs["Vector"])
        nt.links.new(tex.outputs["Color"], bg.inputs["Color"])
        world.cycles.sampling_method = "MANUAL"
        world.cycles.sample_map_resolution = max(512, w)
        info = {"kind": "equirect", "size": [w, h], "scale": scale}
    world.cycles.max_bounces = 1024
    return info


def build_sun(m, scene):
    sun = m.get("sun")
    if not sun:
        return None
    irr = [float(x) for x in sun["irradiance"]]
    e = max(irr)
    if e <= 0:
        return None
    d = Vector(sun["direction"]).normalized()       # toward the sun, our world
    a = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    x = a.cross(d).normalized()
    y = d.cross(x)
    data = bpy.data.lights.new("sun", type="SUN")
    data.energy = e                                  # W/m^2 on a plane facing the sun
    data.color = tuple(c / e for c in irr)
    data.angle = 2.0 * float(sun.get("angularRadius", 0.0))   # Blender's angle is the angular DIAMETER
    data.use_shadow = True
    data.cycles.max_bounces = 1024
    obj = bpy.data.objects.new("sun", data)
    scene.collection.objects.link(obj)
    obj.matrix_world = ours_matrix(x, y, d, (0, 0, 0))   # a sun light shines along its local -Z
    return {"energy": e, "color": list(data.color), "angle": data.angle}


def build_ground(m, scene):
    gr = m.get("ground")
    if not gr:
        return None
    y = float(gr.get("y", 0.0))
    s = float(gr.get("halfSize", 1.0e5))
    me = bpy.data.meshes.new("ground")
    me.from_pydata([(-s, y, -s), (-s, y, s), (s, y, s), (s, y, -s)], [], [(0, 1, 2, 3)])   # normal +Y (ours)
    me.update()
    obj = bpy.data.objects.new("ground", me)
    scene.collection.objects.link(obj)
    obj.matrix_world = R_OURS_TO_BL.copy()
    mat = bpy.data.materials.new("ground")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfDiffuse")
    bs.inputs["Color"].default_value = (*[float(c) for c in gr["albedo"]], 1.0)
    bs.inputs["Roughness"].default_value = 0.0          # Lambert
    nt.links.new(bs.outputs[0], out.inputs["Surface"])
    me.materials.append(mat)
    return {"y": y, "halfSize": s}


def build_camera(m, scene):
    cam = m["camera"]
    pos, f, r, u = refio.camera_basis(cam)
    data = bpy.data.cameras.new("camera")
    data.type = "PERSP"
    data.sensor_fit = "VERTICAL"
    data.angle_y = math.radians(float(cam["fovY"]))
    data.shift_x = data.shift_y = 0.0
    data.clip_start = float(cam.get("near", 0.01))
    data.clip_end = 1.0e8
    obj = bpy.data.objects.new("camera", data)
    scene.collection.objects.link(obj)
    obj.matrix_world = ours_matrix(r, u, -f, pos)   # Blender cameras look down local -Z with +Y up, as three.js
    scene.camera = obj
    scene.render.resolution_x = int(cam["width"])
    scene.render.resolution_y = int(cam["height"])
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1.0


def configure(m, scene, a, transparent=False, max_scatter=None):
    rnd = m.get("render", {})
    c = scene.cycles
    scene.render.engine = "CYCLES"
    c.device = a.device
    c.samples = int(a.spp or rnd.get("spp", 256))
    c.seed = int(rnd.get("seed", 0))
    c.use_animated_seed = False
    c.use_adaptive_sampling = False
    c.use_denoising = False
    c.use_guiding = False
    c.scrambling_distance = 1.0
    c.auto_scrambling_distance = False
    c.light_sampling_threshold = 0.0
    c.sample_clamp_direct = 0.0
    c.sample_clamp_indirect = 0.0
    c.blur_glossy = 0.0
    c.use_fast_gi = False
    c.ao_bounces = 0
    c.ao_bounces_render = 0
    c.caustics_reflective = True
    c.caustics_refractive = True
    c.volume_biased = not a.null_scattering   # ray marching at the volume's step_size (see the module docstring for why)
    c.volume_step_rate = float(a.step_rate)
    c.volume_max_steps = 65536
    # Manifest maxBounces = scattering/reflection vertices per path (pbrt's maxDepth; 1 = single scattering).
    # Cycles counts bounces AFTER the first vertex: 0 = direct lighting only. So Cycles = maxBounces - 1.
    n = int(max_scatter if max_scatter is not None else rnd.get("maxBounces", 512)) - 1
    n = max(n, 0)
    c.max_bounces = n
    c.volume_bounces = n
    c.diffuse_bounces = n
    c.glossy_bounces = 0
    c.transmission_bounces = 0
    c.transparent_max_bounces = 1024
    c.min_light_bounces = n if rnd.get("russianRoulette", False) is False else 0   # n = no Russian roulette before the cap
    c.min_transparent_bounces = 1024
    c.pixel_filter_type = "BOX"
    c.filter_width = 1.0
    c.film_exposure = 1.0            # Cycles' film exposure is a linear multiplier; 1 = none
    scene.render.film_transparent = transparent
    scene.render.threads_mode = "FIXED" if a.threads else "AUTO"
    if a.threads:
        scene.render.threads = a.threads
    vs = scene.view_settings
    vs.view_transform = "Standard"
    vs.look = "None"
    vs.exposure = 0.0
    vs.gamma = 1.0
    vs.use_curve_mapping = False
    ims = scene.render.image_settings
    ims.media_type = "MULTI_LAYER_IMAGE"   # Blender 5.x: multilayer EXR is a media type
    ims.file_format = "OPEN_EXR_MULTILAYER"
    ims.color_depth = "32"
    ims.exr_codec = "ZIP"
    ims.color_mode = "RGBA"
    if a.device == "GPU":
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type != "CPU"


def read_exr_layers(path):
    import OpenImageIO as oiio
    inp = oiio.ImageInput.open(str(path))
    if inp is None:
        raise RuntimeError(f"cannot open {path}: {oiio.geterror()}")
    out = {}
    sub = 0
    while inp.seek_subimage(sub, 0):   # Blender 5 writes one EXR part per pass
        spec = inp.spec()
        names = list(spec.channelnames)
        data = inp.read_image(sub, 0, 0, len(names), "float")
        data = np.asarray(data).reshape(spec.height, spec.width, len(names))   # EXR row 0 = top
        out.update({n: data[:, :, i] for i, n in enumerate(names)})
        sub += 1
    inp.close()
    return out


def pick(layers, pass_name):
    """RGB of a pass from Blender's multilayer channel names '<ViewLayer>.<Pass>.<R|G|B|A>'."""
    out = []
    for ch in "RGB":
        key = next((k for k in layers if k.endswith(f".{pass_name}.{ch}")), None)
        if key is None:
            return None
        out.append(layers[key])
    return np.stack(out, -1)


def render_once(scene, path):
    scene.render.filepath = str(path)
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    return time.time() - t0


def main():
    a = args_after_dashes()
    m = refio.load_manifest(a.manifest)
    if a.width:
        cam = m["camera"]
        cam["height"] = max(1, round(cam["height"] * a.width / cam["width"]))
        cam["width"] = a.width
    a.out = a.out.resolve()
    a.out.parent.mkdir(parents=True, exist_ok=True)
    pfm = (a.pfm or a.out.with_suffix(".pfm")).resolve()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    side = {"manifest": str(a.manifest.resolve()), "blender": bpy.app.version_string, "device": a.device}
    with tempfile.TemporaryDirectory(prefix="cycles-ref-") as tmp:
        vdb, dmax, active = build_vdb(m, tmp) if m.get("grid") else (None, 0.0, 0)
        if vdb:
            build_volume(m, vdb, scene, a)
        side["grid"] = {"densityMax": dmax, "activeVoxels": active}
        side["sky"] = build_world(m, scene)
        side["sun"] = build_sun(m, scene)
        side["ground"] = build_ground(m, scene)
        build_camera(m, scene)
        configure(m, scene, a)
        vl = scene.view_layers[0]
        if a.passes:
            vl.cycles.use_pass_volume_direct = True
            vl.cycles.use_pass_volume_indirect = True
            vl.use_pass_environment = True
            vl.use_pass_diffuse_direct = True
            vl.use_pass_diffuse_indirect = True
        if a.keep_blend:
            bpy.ops.wm.save_as_mainfile(filepath=str(a.out.with_suffix(".blend")))
        side["seconds"] = render_once(scene, a.out)
        side["spp"] = scene.cycles.samples
        side["cyclesBounces"] = scene.cycles.max_bounces
        layers = read_exr_layers(a.out)
        side["channels"] = sorted(layers)
        img = pick(layers, "Combined")
        refio.write_pfm(pfm, img)
        if a.passes:
            for name, key in (("volume_direct", "Volume Direct"), ("volume_indirect", "Volume Indirect"), ("environment", "Environment"),
                              ("diffuse_direct", "Diffuse Direct"), ("diffuse_indirect", "Diffuse Indirect")):
                p = pick(layers, key)
                if p is not None:
                    refio.write_pfm(pfm.with_suffix(f".{name}.pfm"), p)
        if a.alpha:
            # 1 - transmittance along camera rays: transparent film, no lights needed, the path ends at the first scatter.
            for o in list(scene.objects):
                if o.type == "LIGHT":
                    o.hide_render = True
            if scene.world:
                scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
            configure(m, scene, a, transparent=True, max_scatter=1)
            # The ray march costs the same per camera ray with or without light, so cap the alpha pass's samples.
            scene.cycles.samples = min(scene.cycles.samples, 128)
            side["alphaSpp"] = scene.cycles.samples
            alpha_exr = a.out.with_name(a.out.stem + ".alpha.exr")
            side["alphaSeconds"] = render_once(scene, alpha_exr)
            la = read_exr_layers(alpha_exr)
            key = next(k for k in la if k.endswith(".Combined.A"))
            refio.write_pfm(pfm.with_suffix(".alpha.pfm"), np.repeat(la[key][:, :, None], 3, axis=2))
    side["pfm"] = str(pfm)
    a.out.with_suffix(".json").write_text(json.dumps(side, indent=2) + "\n")
    print("CYCLES_REF", json.dumps(side))


if __name__ == "__main__":
    main()
