"""Blender 5.1 authoring recipe for the redistributable fixture.

Run from Blender's Python console or with Blender's background Python mode:
  blender --background --python blender-authoring.py
"""
import bpy
import json
import math
import struct
from pathlib import Path

root = Path(__file__).resolve().parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.5, 0.5, 0.5))
cube = bpy.context.object
cube.name = "author_owned_cube"
cube["asset_provenance"] = "Author-owned redistributable P6 mesh fixture"
bpy.context.view_layer.objects.active = cube
cube.select_set(True)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bpy.ops.wm.obj_export(filepath=str(root / "cube.obj"), export_materials=False, export_normals=False)
bpy.ops.wm.save_as_mainfile(filepath=str(root / "cube.blend"))

# A small static authored density source. This is a Blender Python bake, not a
# VDB read/write path: the raw values are deliberately simple and portable.
size = 32
bounds_min = (-1.0, 0.0, -1.0)
bounds_max = (1.0, 1.0, 1.0)
spacing = tuple((bounds_max[i] - bounds_min[i]) / size for i in range(3))
values = []
for z in range(size):
    pz = bounds_min[2] + (z + 0.5) * spacing[2]
    for y in range(size):
        py = bounds_min[1] + (y + 0.5) * spacing[1]
        for x in range(size):
            px = bounds_min[0] + (x + 0.5) * spacing[0]
            lobes = (
                math.exp(-(((px + 0.38) / 0.42) ** 2 + ((py - 0.42) / 0.28) ** 2 + ((pz + 0.05) / 0.42) ** 2)),
                0.85 * math.exp(-(((px - 0.12) / 0.52) ** 2 + ((py - 0.58) / 0.34) ** 2 + ((pz + 0.02) / 0.34) ** 2)),
                0.62 * math.exp(-(((px - 0.42) / 0.25) ** 2 + ((py - 0.76) / 0.22) ** 2 + ((pz - 0.12) / 0.25) ** 2)),
            )
            value = max(0.0, min(1.0, max(lobes) * (0.88 + 0.12 * (0.5 + 0.5 * math.sin(px * 13.0 + pz * 9.0)))))
            values.append(value)
with open(root / "density.raw", "wb") as raw:
    raw.write(struct.pack("<%df" % len(values), *values))
with open(root / "density.json", "w", encoding="utf8") as metadata:
    json.dump({"id": "authored-blender-density", "revision": 0, "dimensions": [size, size, size], "bounds": {"min": list(bounds_min), "max": list(bounds_max)}, "spacing": list(spacing), "extinctionScale": 0.025, "encoding": "r32float", "source": "Blender Python bake; not VDB"}, metadata, indent=2)
