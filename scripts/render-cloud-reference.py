#!/usr/bin/env python3
"""Render the authored OpenVDB cloud as an offline Cycles reference.

This is deliberately a native VDB render: no mesh conversion, procedural
replacement, or browser/runtime volume is involved. Run with Blender's Python:

  Blender --background --python scripts/render-cloud-reference.py -- \
    --vdb fixtures/authored/vdb/houdini-cloudnoise.vdb \
    --output artifacts/realism/native-reference.png
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path

import bpy
from mathutils import Vector


def blender_args():
    # Blender leaves its own arguments before the '--' separator.
    import sys

    argv = sys.argv
    try:
        argv = argv[argv.index("--") + 1 :]
    except ValueError:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--vdb", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--samples", type=int, default=64)
    parser.add_argument("--width", type=int, default=960)
    parser.add_argument("--height", type=int, default=640)
    return parser.parse_args(argv)


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def make_volume(vdb_path: Path):
    volume = bpy.data.volumes.new("Native VDB density")
    volume.filepath = str(vdb_path)
    volume.grids.load()
    volume.name = "houdini-cloudnoise-native"
    obj = bpy.data.objects.new("Native Houdini density VDB", volume)
    bpy.context.collection.objects.link(obj)
    # Keep the grid's OpenVDB transform intact. The preview contract translates
    # only the object to put its world-space center around y=1700.
    obj.rotation_euler = (math.pi / 2, 0.0, 0.0)
    obj.location = (0.0, 0.0, 1676.0)

    mat = bpy.data.materials.new("Pure white volume scatter, density * 0.025")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    volume_shader = nodes.new("ShaderNodeVolumeScatter")
    attribute = nodes.new("ShaderNodeAttribute")
    attribute.attribute_name = "density"
    coefficient = nodes.new("ShaderNodeMath")
    coefficient.operation = "MULTIPLY"
    coefficient.inputs[1].default_value = 0.025
    links.new(attribute.outputs["Fac"], coefficient.inputs[0])
    links.new(coefficient.outputs[0], volume_shader.inputs["Density"])
    volume_shader.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    volume_shader.inputs["Anisotropy"].default_value = 0.65
    links.new(volume_shader.outputs["Volume"], output.inputs["Volume"])
    obj.data.materials.append(mat)
    return obj


def make_world():
    world = bpy.data.worlds.new("Reference sky") if not bpy.data.worlds else bpy.data.worlds[0]
    bpy.context.scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputWorld")
    bg = nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 0.35
    sky = nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_elevation = math.radians(35.0)
    sky.sun_rotation = math.radians(145.0)
    sky.altitude = 1360.0
    sky.air_density = 1.0
    links.new(sky.outputs["Color"], bg.inputs["Color"])
    links.new(bg.outputs["Background"], out.inputs["Surface"])


def make_sun():
    direction = Vector((-0.671, 0.470, 0.574)).normalized()
    data = bpy.data.lights.new("Reference Sun", type="SUN")
    data.energy = 6.0
    data.color = (1.0, 0.95, 0.85)
    light = bpy.data.objects.new("Reference Sun", data)
    bpy.context.collection.objects.link(light)
    light.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return light, tuple(direction)


def make_ground():
    bpy.ops.mesh.primitive_plane_add(size=10000.0, location=(0.0, 0.0, 0.0))
    plane = bpy.context.object
    plane.name = "Dark blue ground"
    mat = bpy.data.materials.new("Dark blue ground material")
    mat.diffuse_color = (0.008, 0.025, 0.07, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.008, 0.025, 0.07, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.86
    plane.data.materials.append(mat)


def render(args):
    args.vdb = args.vdb.resolve()
    args.output = args.output.resolve()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    scene.cycles.max_bounces = 8
    scene.cycles.volume_bounces = 8
    scene.cycles.use_denoising = True
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = str(args.output)
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"

    make_volume(args.vdb)
    make_ground()
    make_world()
    _, sun_direction = make_sun()
    camera_data = bpy.data.cameras.new("Reference camera")
    camera = bpy.data.objects.new("Reference camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera.location = (350.0, -1800.0, 1360.0)
    camera_data.lens = 50.0
    camera_data.clip_start = 1.0
    camera_data.clip_end = 100000.0
    camera_data.sensor_fit = "VERTICAL"
    camera_data.angle_y = math.radians(55.0)
    look_at(camera, (0.0, 0.0, 1700.0))

    scene.render.filepath = str(args.output)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output.with_suffix(".blend")))
    bpy.ops.render.render(write_still=True)

    metadata = {
        "sourceVDB": str(args.vdb),
        "grid": "density",
        "renderer": "Blender Cycles",
        "blenderVersion": bpy.app.version_string,
        "resolution": [args.width, args.height],
        "samples": args.samples,
        "maxBounces": 8,
        "volumeBounces": 8,
        "densityCoefficient": 0.025,
        "volumeColor": [1.0, 1.0, 1.0],
        "anisotropy": 0.65,
        "objectTranslationThreeYUp": [0.0, 1676.0, 0.0],
        "coordinateBasis": "Three/Houdini (x,y,z) -> Blender (x,-z,y)",
        "cameraLocation": [350.0, 1360.0, 1800.0],
        "cameraTarget": [0.0, 1700.0, 0.0],
        "cameraVerticalFovDegrees": 55.0,
        "sunDirectionNormalized": list(sun_direction),
        "sunEnergy": 6.0,
        "sunColor": [1.0, 0.95, 0.85],
        "groundColor": [0.008, 0.025, 0.07],
        "nativeReferenceOnly": True,
        "webGPUEquivalenceClaim": False,
    }
    args.output.with_suffix(".json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    render(blender_args())
