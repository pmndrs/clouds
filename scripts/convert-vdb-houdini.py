#!/usr/bin/env python3
"""Houdini HOM bridge for real OpenVDB fog grids and a bounded fixture.

Run this file with Houdini's hython, not the workspace Python:

  hython convert-vdb-houdini.py input.vdb output.clda --grid density
  hython convert-vdb-houdini.py --generate-fixture fixtures/authored/vdb

The bridge uses hou.Geometry.loadFromFile/saveToFile and hou.VDB's documented
active bounds, voxel and value APIs. It performs a readback of the written VDB
before writing the CLDA output. It does not silently treat an SDF as fog.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path


MAX_PAYLOAD_BYTES = 16 * 1024 * 1024


def fail(message: str) -> "NoReturn":
    raise RuntimeError(message)


def require_hou():
    try:
        import hou  # type: ignore
    except ImportError as error:
        fail("This bridge must run under Houdini hython; import hou failed.")
    return hou


def load_clda_encoder():
    path = Path(__file__).with_name("convert-vdb.py")
    spec = importlib.util.spec_from_file_location("convert_vdb_dense_encoder", path)
    if spec is None or spec.loader is None:
        fail(f"Cannot load dense encoder {path}.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.encode_clda


def primitive_name(prim) -> str:
    try:
        return str(prim.stringAttribValue("name"))
    except Exception:
        return ""


def find_vdb(hou, geometry, name: str):
    candidates = [prim for prim in geometry.prims() if isinstance(prim, hou.VDB)]
    if not candidates:
        fail("Houdini readback contains no VDB primitive.")
    for prim in candidates:
        if primitive_name(prim) == name:
            return prim
    available = ", ".join(primitive_name(prim) or "<unnamed>" for prim in candidates)
    fail(f"VDB grid {name!r} was not found; available grids: {available}")


def vector3(value):
    return (float(value[0]), float(value[1]), float(value[2]))


def bbox_indices(vdb):
    bbox = vdb.activeVoxelBoundingBox()
    minimum = tuple(int(round(value)) for value in bbox.minvec())
    maximum_exclusive = tuple(int(round(value)) for value in bbox.maxvec())
    maximum = tuple(value - 1 for value in maximum_exclusive)
    if any(maximum[axis] < minimum[axis] for axis in range(3)):
        fail("The selected VDB has no active voxels.")
    return minimum, maximum


def full_transform(hou, vdb):
    # hou.VDB.transform() is the 3x3 index-to-position scale/rotation. The
    # primitive's first vertex supplies the translation in SOP coordinates.
    matrix = hou.Matrix4(vdb.transform())
    translation = vdb.vertex(0).point().position()
    return matrix * hou.hmath.buildTranslate(translation)


def transform_point(hou, matrix, point):
    value = hou.Vector4((point[0], point[1], point[2], 1.0)) * matrix
    weight = float(value[3])
    if weight != 0.0 and weight != 1.0:
        return (float(value[0]) / weight, float(value[1]) / weight, float(value[2]) / weight)
    return (float(value[0]), float(value[1]), float(value[2]))


def axis_aligned_bounds(hou, vdb, minimum, maximum):
    matrix = full_transform(hou, vdb)
    points = [
        transform_point(hou, matrix, (x, y, z))
        for x in (minimum[0] - 0.5, maximum[0] + 0.5)
        for y in (minimum[1] - 0.5, maximum[1] + 0.5)
        for z in (minimum[2] - 0.5, maximum[2] + 0.5)
    ]
    bounds = (tuple(min(point[axis] for point in points) for axis in range(3)), tuple(max(point[axis] for point in points) for axis in range(3)))
    # The shared dense contract cannot preserve rotation/shear. Check basis
    # vectors before allowing transformed coordinates to become an AABB.
    origin = transform_point(hou, matrix, (0, 0, 0))
    basis = [transform_point(hou, matrix, tuple(1 if axis == component else 0 for component in range(3))) for axis in range(3)]
    scale = max(1.0, *(abs(basis[axis][component] - origin[component]) for axis in range(3) for component in range(3)))
    tolerance = scale * 1e-10
    for axis, point in enumerate(basis):
        vector = tuple(point[component] - origin[component] for component in range(3))
        if vector[axis] <= tolerance or any(abs(vector[component]) > tolerance for component in range(3) if component != axis):
            fail("The selected VDB transform has rotation, shear or negative spacing; the dense CLDA contract requires positive axis-aligned spacing.")
    return bounds, matrix


def source_values(vdb, minimum, maximum):
    size = tuple(maximum[axis] - minimum[axis] + 1 for axis in range(3))
    count = size[0] * size[1] * size[2]
    if count * 4 > MAX_PAYLOAD_BYTES:
        fail(f"Source active payload exceeds the {MAX_PAYLOAD_BYTES} byte fixture/bridge limit.")
    # voxelRangeAsFloat is the documented bulk accessor. Its index range is
    # inclusive on both corners for this call.
    try:
        values = tuple(float(value) for value in vdb.voxelRangeAsFloat(vdb.activeVoxelBoundingBox()))
    except Exception:
        values = ()
    if len(values) != count:
        # Houdini releases differ on whether the end coordinate is inclusive;
        # retry with the inclusive form before failing closed.
        values = tuple(float(value) for value in vdb.voxelRangeAsFloat((minimum, maximum)))
    if len(values) != count:
        fail(f"Houdini returned {len(values)} values for active dimensions {size}, expected {count}.")
    if not all(math.isfinite(value) for value in values):
        fail("VDB fog values contain a non-finite sample.")
    return size, values


def encode_field(identifier, values, dimensions, bounds, encoding="r8unorm"):
    if encoding != "r8unorm":
        fail("The Houdini bridge currently emits r8unorm CLDA only.")
    payload = bytearray(len(values))
    for index, value in enumerate(values):
        if value < 0 or value > 1:
            fail("Fog density is outside [0, 1]; normalize it in Houdini or extend the bridge value-range option.")
        payload[index] = round(value * 255)
    if len(payload) > MAX_PAYLOAD_BYTES:
        fail(f"CLDA payload exceeds {MAX_PAYLOAD_BYTES} bytes.")
    return load_clda_encoder()(identifier, 0, dimensions, bounds, 0.025, encoding, bytes(payload)), bytes(payload)


def convert_file(input_path, output_path, grid_name):
    hou = require_hou()
    geometry = hou.Geometry()
    geometry.loadFromFile(str(input_path))
    vdb = find_vdb(hou, geometry, grid_name)
    if vdb.isSDF():
        fail("The selected VDB is an SDF/level set, not fog density.")
    minimum, maximum = bbox_indices(vdb)
    dimensions, values = source_values(vdb, minimum, maximum)
    bounds, matrix = axis_aligned_bounds(hou, vdb, minimum, maximum)
    identifier = Path(output_path).stem
    clda, payload = encode_field(identifier, values, dimensions, bounds)
    # Re-open the written source VDB and compare representative values before
    # accepting the dense conversion as native evidence.
    reread_geometry = hou.Geometry()
    reread_geometry.loadFromFile(str(input_path))
    reread = find_vdb(hou, reread_geometry, grid_name)
    nonzero = [index for index, value in enumerate(values) if value > 0]
    if not nonzero:
        fail("Native fog VDB has no positive density voxels.")
    peak_index = max(range(len(values)), key=values.__getitem__)
    samples = list(dict.fromkeys([nonzero[0], nonzero[len(nonzero) // 2], peak_index, nonzero[-1]]))
    parity = []
    for index in samples:
        z, remainder = divmod(index, dimensions[0] * dimensions[1])
        y, x = divmod(remainder, dimensions[0])
        original = float(values[index])
        reread_value = float(reread.voxel((minimum[0] + x, minimum[1] + y, minimum[2] + z)))
        parity.append({"index": [x, y, z], "source": original, "readback": reread_value, "absError": abs(original - reread_value)})
    max_error = max(item["absError"] for item in parity)
    if max_error > 1e-6:
        fail(f"Native VDB readback parity exceeded tolerance: {max_error}")
    quantization_errors = [abs(payload[index] / 255.0 - values[index]) for index in range(len(values))]
    quantization_max_error = max(quantization_errors)
    if quantization_max_error > 0.5 / 255.0 + 1e-7:
        fail(f"r8 quantization error exceeded the declared 0.5/255 budget: {quantization_max_error}")
    active_count = int(vdb.activeVoxelCount())
    positive_count = len(nonzero)
    mass = float(sum(values))
    if active_count <= 0 or positive_count <= 0 or max(values) <= 0:
        fail("Native fog VDB is empty after readback.")
    Path(output_path).write_bytes(clda)
    spacing = vector3(vdb.voxelSize())
    metadata = {
        "source": "houdini-openvdb",
        "sourcePath": str(Path(input_path).resolve()),
        "runtime": hou.applicationVersionString(),
        "grid": grid_name,
        "gridClass": "fog",
        "sourceDimensions": list(dimensions),
        "sourceIndexBounds": {"min": list(minimum), "max": list(maximum)},
        "destinationDimensions": list(dimensions),
        "bounds": {"min": list(bounds[0]), "max": list(bounds[1])},
        "voxelSize": list(spacing),
        "encoding": "r8unorm",
        "payloadBytes": len(payload),
        "sourceStats": {
            "activeVoxelCount": active_count,
            "positiveVoxelCount": positive_count,
            "positiveVoxelFraction": positive_count / len(values),
            "mass": mass,
            "peakDensity": max(values),
            "peakIndex": [peak_index % dimensions[0], (peak_index // dimensions[0]) % dimensions[1], peak_index // (dimensions[0] * dimensions[1])],
            "background": float(vdb.intrinsicValue("background")),
        },
        "readbackParity": {"samples": parity, "maxAbsError": max_error},
        "r8Normalization": "none; native Houdini fog density is expected in [0,1]",
        "extinctionScale": 0.025,
        "quantizationMaxAbsError": quantization_max_error,
        "indexToWorldMatrix": [float(value) for value in matrix.asTuple()],
    }
    Path(str(output_path) + ".json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"vdb": str(input_path), "clda": str(output_path), "metadata": str(output_path) + ".json", "payloadBytes": len(payload), "readbackMaxAbsError": max_error}))


def generate_fixture(directory):
    module_path = Path(__file__).with_name("generate-houdini-cloud.py")
    spec = importlib.util.spec_from_file_location("houdini_cloud_generator", module_path)
    if spec is None or spec.loader is None:
        fail(f"Cannot load native cloud generator {module_path}.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.generate(directory)


def make_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?")
    parser.add_argument("output", nargs="?")
    parser.add_argument("--grid", default="density")
    parser.add_argument("--generate-fixture", metavar="DIRECTORY")
    return parser


if __name__ == "__main__":
    try:
        args = make_parser().parse_args()
        if args.generate_fixture:
            generate_fixture(args.generate_fixture)
        elif args.input and args.output:
            convert_file(args.input, args.output, args.grid)
        else:
            make_parser().error("provide INPUT OUTPUT or --generate-fixture DIRECTORY")
    except Exception as error:
        print(f"convert-vdb-houdini.py: error: {error}", file=sys.stderr)
        raise SystemExit(2)
