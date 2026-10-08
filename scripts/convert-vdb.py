#!/usr/bin/env python3
"""Convert one OpenVDB fog grid to the repository's CLDA v1 dense asset.

This is intentionally an offline tool. It imports an OpenVDB Python binding
when invoked; no parser or native dependency is bundled with the browser
packages. The binding APIs differ slightly between OpenVDB releases, so the
small adapter below accepts the commonly published openvdb and pyopenvdb
spellings and fails with an actionable message when neither is available.
"""

from __future__ import annotations

import argparse
import importlib
import json
import math
import os
import struct
import sys
from typing import Any, Iterable, Sequence


DEFAULT_MAX_VOXELS = 256 * 256 * 256
DEFAULT_MAX_DIMENSION = 4096
DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024 * 1024
HEADER_BYTES = 96
FLOAT32_MAX = 3.4028234663852886e38


def fail(message: str) -> "NoReturn":
    raise RuntimeError(message)


def member(value: Any, names: Sequence[str], *, call: bool = True) -> Any:
    """Return the first existing member, calling zero-argument accessors."""
    for name in names:
        if not hasattr(value, name):
            continue
        result = getattr(value, name)
        if call and callable(result):
            try:
                result = result()
            except TypeError:
                continue
        return result
    return None


def vector3(value: Any, label: str) -> tuple[float, float, float]:
    if value is None:
        fail(f"OpenVDB {label} is unavailable.")
    if hasattr(value, "x") and hasattr(value, "y") and hasattr(value, "z"):
        result = (float(value.x), float(value.y), float(value.z))
    else:
        try:
            result = (float(value[0]), float(value[1]), float(value[2]))
        except (IndexError, KeyError, TypeError):
            fail(f"OpenVDB {label} is not a three-component vector.")
    if not all(math.isfinite(component) for component in result):
        fail(f"OpenVDB {label} contains a non-finite value.")
    return result


def call_point(function: Any, point: tuple[float, float, float]) -> tuple[float, float, float]:
    if not callable(function):
        fail("OpenVDB transform has no indexToWorld callable.")
    for unpack in (True, False):
        try:
            return vector3(function(*point) if unpack else function(point), "world coordinate")
        except TypeError:
            continue
    fail("OpenVDB indexToWorld could not be called with a 3D index.")


def normalize_class(value: Any) -> str:
    text = str(value).strip().lower().replace("_", " ").replace("-", " ")
    if "level" in text or "sdf" in text or "signed distance" in text:
        fail("The selected VDB grid is a level set/SDF, not fog density; choose a fog-volume grid.")
    if "fog" in text:
        return "fog"
    fail(f"Unsupported OpenVDB grid class {value!r}; expected a fog volume.")


def grid_class(grid: Any) -> str:
    value = member(grid, ("gridClass", "grid_class"))
    if value is None:
        metadata = member(grid, ("metadata",), call=True)
        if metadata is not None:
            try:
                value = metadata["gridClass"]
            except (KeyError, TypeError):
                try:
                    value = metadata["grid_class"]
                except (KeyError, TypeError):
                    value = None
    if value is None:
        fail("Selected OpenVDB grid has no gridClass metadata; refusing to guess fog semantics.")
    return normalize_class(value)


def grid_name(grid: Any) -> str | None:
    value = member(grid, ("name", "gridName", "grid_name"))
    return None if value is None else str(value)


def read_grid(path: str, requested_name: str) -> tuple[Any, str]:
    modules = []
    for module_name in ("openvdb", "pyopenvdb"):
        try:
            modules.append(importlib.import_module(module_name))
        except ImportError:
            continue
    if not modules:
        fail("No OpenVDB Python binding is installed. Install/use the OpenVDB Python module, or run scripts/convert-vdb-houdini.py with Houdini's hython; no dependency was installed by this repository.")

    for module in modules:
        reader = getattr(module, "read", None)
        candidates: list[Any] = []
        if callable(reader):
            for kwargs in ({"gridname": requested_name}, {"grid": requested_name}, {"gridName": requested_name}, {}):
                try:
                    loaded = reader(path, **kwargs)
                except (TypeError, KeyError, ValueError):
                    continue
                candidates.extend(candidate_items(loaded))
                if kwargs:
                    break
        read_all = getattr(module, "readAll", None)
        if callable(read_all):
            try:
                loaded = read_all(path)
                candidates.extend(candidate_items(loaded))
            except (TypeError, KeyError, ValueError):
                pass
        for candidate in candidates:
            if candidate is None:
                continue
            if grid_name(candidate) == requested_name or (grid_name(candidate) is None and len(candidates) == 1):
                return candidate, module.__name__
        available = [grid_name(candidate) for candidate in candidates if grid_name(candidate)]
        if available:
            fail(f"Grid {requested_name!r} was not found; available grids: {', '.join(available)}")
    fail(f"OpenVDB reader could not load {path!r} or grid {requested_name!r}.")


def candidate_items(loaded: Any) -> list[Any]:
    """Normalize read/readAll results, including readAll's (grids, metadata)."""
    if isinstance(loaded, tuple) and len(loaded) == 2 and isinstance(loaded[0], (list, tuple)):
        return list(loaded[0])
    if isinstance(loaded, (list, tuple)):
        return list(loaded)
    return [loaded]


def active_bounds(grid: Any) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    value = member(grid, ("evalActiveVoxelBoundingBox", "activeVoxelBoundingBox", "active_bbox", "bbox"))
    if value is None:
        fail("OpenVDB grid has no active voxel bounding-box accessor.")
    if hasattr(value, "min") and hasattr(value, "max"):
        minimum = value.min() if callable(value.min) else value.min
        maximum = value.max() if callable(value.max) else value.max
    else:
        try:
            minimum, maximum = value[0], value[1]
        except (IndexError, TypeError):
            fail("OpenVDB active bounding box is not a min/max pair.")
    lo = tuple(int(round(component)) for component in vector3(minimum, "active bbox minimum"))
    hi = tuple(int(round(component)) for component in vector3(maximum, "active bbox maximum"))
    if any(hi[axis] < lo[axis] for axis in range(3)):
        fail("OpenVDB grid has no active voxels.")
    return lo, hi


def resolve_transform(grid: Any) -> Any:
    transform = member(grid, ("transform",), call=True)
    if transform is None:
        fail("OpenVDB grid has no transform; world spacing and bounds cannot be preserved.")
    return transform


def transform_point(transform: Any, point: tuple[float, float, float]) -> tuple[float, float, float]:
    function = member(transform, ("indexToWorld", "index_to_world"), call=False)
    return call_point(function, point)


def voxel_size(transform: Any, grid: Any) -> tuple[float, float, float] | None:
    value = member(transform, ("voxelSize", "voxel_size"))
    if value is None:
        value = member(grid, ("voxelSize", "voxel_size"))
    if value is None:
        return None
    return vector3(value, "voxel size")


def world_bounds(transform: Any, lo: tuple[int, int, int], hi: tuple[int, int, int]) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    points = []
    for x in (lo[0] - 0.5, hi[0] + 0.5):
        for y in (lo[1] - 0.5, hi[1] + 0.5):
            for z in (lo[2] - 0.5, hi[2] + 0.5):
                points.append(transform_point(transform, (x, y, z)))
    return tuple(min(point[axis] for point in points) for axis in range(3)), tuple(max(point[axis] for point in points) for axis in range(3))


def ensure_axis_aligned(transform: Any) -> None:
    origin = transform_point(transform, (0.0, 0.0, 0.0))
    basis = [transform_point(transform, tuple(1.0 if axis == component else 0.0 for component in range(3))) for axis in range(3)]
    vectors = [tuple(basis[axis][component] - origin[component] for component in range(3)) for axis in range(3)]
    scale = max(1.0, *(abs(value) for vector in vectors for value in vector))
    tolerance = scale * 1e-10
    for axis, vector in enumerate(vectors):
        if vector[axis] <= tolerance or any(abs(vector[component]) > tolerance for component in range(3) if component != axis):
            fail("OpenVDB index-to-world transform has rotation, shear or negative spacing; the axis-aligned dense contract cannot represent it.")


def background(grid: Any) -> float:
    value = member(grid, ("background", "backgroundValue", "background_value"))
    if value is None:
        tree = member(grid, ("tree",), call=True)
        value = member(tree, ("background", "backgroundValue", "background_value")) if tree is not None else None
    if value is None:
        fail("OpenVDB grid background is unavailable; refusing to invent an inactive value.")
    result = float(value)
    if not math.isfinite(result):
        fail("OpenVDB grid background is non-finite.")
    return result


def make_accessor(grid: Any) -> Any:
    for name in ("getConstAccessor", "getAccessor"):
        function = getattr(grid, name, None)
        if callable(function):
            return function()
    return None


def value_at(grid: Any, index: tuple[int, int, int], accessor: Any = None) -> float:
    owners = (accessor,) if accessor is not None else (grid, member(grid, ("tree",), call=True))
    for owner in owners:
        if owner is None:
            continue
        for name in ("getValue", "get_value", "value"):
            function = getattr(owner, name, None)
            if not callable(function):
                continue
            for unpack in (False, True):
                try:
                    value = function(index) if not unpack else function(*index)
                    result = float(value)
                    if not math.isfinite(result):
                        fail("OpenVDB grid contains a non-finite density value.")
                    return result
                except (TypeError, IndexError, KeyError):
                    continue
    fail("OpenVDB binding has no supported voxel-value accessor (getValue/get_value).")


def trilinear(grid: Any, source_lo: tuple[int, int, int], source_size: tuple[int, int, int], position: tuple[float, float, float], accessor: Any = None) -> float:
    coordinates = []
    for axis in range(3):
        local = max(0.0, min(float(source_size[axis] - 1), position[axis]))
        first = int(math.floor(local))
        coordinates.append((first, min(source_size[axis] - 1, first + 1), local - first))
    result = 0.0
    for z, wz in ((coordinates[2][0], 1 - coordinates[2][2]), (coordinates[2][1], coordinates[2][2])):
        for y, wy in ((coordinates[1][0], 1 - coordinates[1][2]), (coordinates[1][1], coordinates[1][2])):
            for x, wx in ((coordinates[0][0], 1 - coordinates[0][2]), (coordinates[0][1], coordinates[0][2])):
                result += value_at(grid, (source_lo[0] + x, source_lo[1] + y, source_lo[2] + z), accessor) * wx * wy * wz
    return result


def parse_size(values: Sequence[int]) -> tuple[int, int, int]:
    if len(values) == 1:
        return int(values[0]), int(values[0]), int(values[0])
    if len(values) == 3:
        return int(values[0]), int(values[1]), int(values[2])
    fail("--resolution accepts one integer or x y z.")


def check_limits(size: tuple[int, int, int], max_dimension: int, max_voxels: int, max_payload: int, bytes_per_voxel: int) -> int:
    if any(axis < 1 or axis > max_dimension for axis in size):
        fail(f"Destination dimensions {size} exceed max-dimension {max_dimension}.")
    count = size[0] * size[1] * size[2]
    if count > max_voxels:
        fail(f"Destination has {count} voxels, above max-voxels {max_voxels}.")
    payload = count * bytes_per_voxel
    if payload > max_payload:
        fail(f"Destination payload is {payload} bytes, above max-payload-bytes {max_payload}.")
    return count


def encode_clda(identifier: str, revision: int, dimensions: tuple[int, int, int], bounds: tuple[tuple[float, float, float], tuple[float, float, float]], extinction_scale: float, encoding: str, payload: bytes) -> bytes:
    identifier_bytes = identifier.encode("utf-8")
    if not identifier_bytes or len(identifier_bytes) > 0xFFFFFFFF:
        fail("Asset id is empty or too large.")
    if revision < 0 or revision > 0xFFFFFFFF:
        fail("Revision must fit an unsigned 32-bit integer.")
    encoding_id = {"r8unorm": 1, "r32float": 3}.get(encoding)
    if encoding_id is None:
        fail(f"Unsupported encoding {encoding!r}.")
    expected = dimensions[0] * dimensions[1] * dimensions[2] * (1 if encoding == "r8unorm" else 4)
    if len(payload) != expected:
        fail(f"Payload length {len(payload)} does not match {expected}.")
    header = bytearray(HEADER_BYTES)
    struct.pack_into("<4sHHIIII3I", header, 0, b"CLDA", 1, 0, HEADER_BYTES, len(identifier_bytes), len(payload), revision, *dimensions)
    struct.pack_into("<3d3ddB", header, 36, *bounds[0], *bounds[1], float(extinction_scale), encoding_id)
    return bytes(header) + identifier_bytes + payload


def convert(args: argparse.Namespace) -> None:
    grid, binding = read_grid(args.input, args.grid)
    normalize_class(grid_class(grid))
    lo, hi = active_bounds(grid)
    source_size = tuple(hi[axis] - lo[axis] + 1 for axis in range(3))
    transform = resolve_transform(grid)
    ensure_axis_aligned(transform)
    spacing = voxel_size(transform, grid)
    bounds = world_bounds(transform, lo, hi)
    source_background = background(grid)
    accessor = make_accessor(grid)
    if accessor is None:
        fail("OpenVDB grid has no getConstAccessor/getAccessor; refusing an unverified voxel lookup path.")
    destination = parse_size(args.resolution)
    encoding = args.encoding
    bytes_per_voxel = 1 if encoding == "r8unorm" else 4
    count = check_limits(destination, args.max_dimension, args.max_voxels, args.max_payload_bytes, bytes_per_voxel)
    value_min, value_max = args.value_range
    if not math.isfinite(value_min) or not math.isfinite(value_max) or not value_max > value_min:
        fail("--value-range requires finite min max values with max greater than min.")

    same_size = source_size == destination
    def destination_value(x: int, y: int, z: int) -> float:
        source_position = (
            (x + 0.5) * source_size[0] / destination[0] - 0.5,
            (y + 0.5) * source_size[1] / destination[1] - 0.5,
            (z + 0.5) * source_size[2] / destination[2] - 0.5,
        )
        return value_at(grid, (lo[0] + x, lo[1] + y, lo[2] + z), accessor) if same_size else trilinear(grid, lo, source_size, source_position, accessor)

    # Validate float32 representability before allocating the dense payload.
    if encoding == "r32float":
        for z in range(destination[2]):
            for y in range(destination[1]):
                for x in range(destination[0]):
                    if abs(destination_value(x, y, z)) > FLOAT32_MAX:
                        fail("A density value cannot be represented as r32float.")

    payload = bytearray(count * bytes_per_voxel)
    for z in range(destination[2]):
        for y in range(destination[1]):
            for x in range(destination[0]):
                value = destination_value(x, y, z)
                output_index = x + y * destination[0] + z * destination[0] * destination[1]
                if encoding == "r8unorm":
                    normalized = (value - value_min) / (value_max - value_min)
                    if not args.clamp and (normalized < 0 or normalized > 1):
                        fail("A density value is outside --value-range; pass --clamp to quantize with clipping.")
                    payload[output_index] = round(max(0.0, min(1.0, normalized)) * 255)
                else:
                    if abs(value) > FLOAT32_MAX:
                        fail("A density value cannot be represented as r32float.")
                    struct.pack_into("<f", payload, output_index * 4, value)

    identifier = args.id or os.path.splitext(os.path.basename(args.output))[0]
    asset = encode_clda(identifier, args.revision, destination, bounds, args.extinction_scale, encoding, bytes(payload))
    with open(args.output, "wb") as handle:
        handle.write(asset)
    metadata_path = args.metadata or f"{args.output}.json"
    metadata = {
        "source": "openvdb",
        "binding": binding,
        "input": os.path.abspath(args.input),
        "grid": args.grid,
        "gridClass": "fog",
        "sourceDimensions": source_size,
        "sourceIndexBounds": {"min": lo, "max": hi},
        "destinationDimensions": destination,
        "bounds": {"min": bounds[0], "max": bounds[1]},
        "voxelSize": spacing,
        "background": source_background,
        "encoding": encoding,
        "valueRange": [value_min, value_max],
        "clamped": bool(args.clamp),
        "extinctionScale": args.extinction_scale,
    }
    with open(metadata_path, "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2)
        handle.write("\n")
    print(f"wrote {args.output} ({len(asset)} bytes) and {metadata_path}")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("input", help="Input OpenVDB .vdb path")
    result.add_argument("output", help="Output CLDA dense asset path")
    result.add_argument("--grid", default="density", help="Fog grid name (default: density)")
    result.add_argument("--resolution", nargs="+", type=int, default=[128], metavar="N", help="Destination resolution: N or X Y Z (default: 128)")
    result.add_argument("--encoding", choices=("r8unorm", "r32float"), default="r8unorm")
    result.add_argument("--value-range", nargs=2, type=float, default=(0.0, 1.0), metavar=("MIN", "MAX"), help="Density range for r8 quantization (default: 0 1)")
    result.add_argument("--clamp", action="store_true", help="Clamp r8 values outside --value-range")
    result.add_argument("--id", help="Dense asset id (default: output basename)")
    result.add_argument("--revision", type=int, default=0)
    result.add_argument("--extinction-scale", type=float, default=0.025)
    result.add_argument("--max-dimension", type=int, default=DEFAULT_MAX_DIMENSION)
    result.add_argument("--max-voxels", type=int, default=DEFAULT_MAX_VOXELS)
    result.add_argument("--max-payload-bytes", type=int, default=DEFAULT_MAX_PAYLOAD_BYTES)
    result.add_argument("--metadata", help="Sidecar metadata path (default: OUTPUT.json)")
    return result


if __name__ == "__main__":
    try:
        convert(parser().parse_args())
    except (OSError, RuntimeError, ValueError) as error:
        print(f"convert-vdb.py: error: {error}", file=sys.stderr)
        raise SystemExit(2)
