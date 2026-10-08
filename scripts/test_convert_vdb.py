#!/usr/bin/env python3
"""Executable adapter smoke tests; no OpenVDB installation is required."""

from __future__ import annotations

import importlib.util
import struct
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


SCRIPT = Path(__file__).with_name("convert-vdb.py")
SPEC = importlib.util.spec_from_file_location("convert_vdb", SCRIPT)
assert SPEC and SPEC.loader
CONVERTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONVERTER)


class Transform:
    def voxelSize(self):
        return (2.0, 3.0, 4.0)

    def indexToWorld(self, point):
        x, y, z = point
        return (10.0 + 2.0 * x, 20.0 + 3.0 * y, 30.0 + 4.0 * z)


class RotatedTransform(Transform):
    def indexToWorld(self, point):
        x, y, z = point
        return (10.0 + y, 20.0 + x, 30.0 + z)


class Accessor:
    def __init__(self, values):
        self.values = values

    def getValue(self, point):
        x, y, z = point
        return self.values[x + 2 * y + 4 * z]


class FakeFogGrid:
    name = "density"
    gridClass = "fog volume"
    background = 0.0

    def __init__(self, transform=None, values=None):
        self.transform = transform or Transform()
        self.values = values or [0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0]

    def evalActiveVoxelBoundingBox(self):
        return ((0, 0, 0), (1, 1, 1))

    def getConstAccessor(self):
        return Accessor(self.values)


def arguments(input_path: str, output_path: str, **overrides):
    values = dict(
        input=input_path,
        output=output_path,
        grid="density",
        resolution=[4, 2, 2],
        encoding="r8unorm",
        value_range=(0.0, 1.0),
        clamp=False,
        id="fixture",
        revision=0,
        extinction_scale=0.025,
        max_dimension=4096,
        max_voxels=256 * 256 * 256,
        max_payload_bytes=256 * 1024 * 1024,
        metadata=None,
    )
    values.update(overrides)
    return SimpleNamespace(**values)


class ConverterSmokeTests(unittest.TestCase):
    def test_clda_bounds_payload_and_center_mapping(self):
        grid = FakeFogGrid()
        original = CONVERTER.read_grid
        CONVERTER.read_grid = lambda path, name: (grid, "fake-openvdb")
        try:
            with tempfile.TemporaryDirectory() as directory:
                output = str(Path(directory) / "fixture.clda")
                CONVERTER.convert(arguments("fixture.vdb", output))
                data = Path(output).read_bytes()
        finally:
            CONVERTER.read_grid = original

        magic, version, flags, header, id_bytes, payload_bytes, revision, x, y, z = struct.unpack_from("<4sHHIIII3I", data, 0)
        minimum = struct.unpack_from("<3d", data, 36)
        maximum = struct.unpack_from("<3d", data, 60)
        encoding = struct.unpack_from("<B", data, 92)[0]
        payload = data[header + id_bytes:]
        self.assertEqual((magic, version, flags, header, id_bytes, payload_bytes, revision), (b"CLDA", 1, 0, 96, 7, 16, 0))
        self.assertEqual((x, y, z), (4, 2, 2))
        self.assertEqual(minimum, (9.0, 18.5, 28.0))
        self.assertEqual(maximum, (13.0, 24.5, 36.0))
        self.assertEqual(encoding, 1)
        self.assertEqual(list(payload[:4]), [0, 64, 191, 255])
        self.assertEqual(list(payload[4:8]), [0, 64, 191, 255])
        self.assertEqual(len(payload), payload_bytes)

    def test_rotated_transform_is_rejected(self):
        grid = FakeFogGrid(transform=RotatedTransform())
        original = CONVERTER.read_grid
        CONVERTER.read_grid = lambda path, name: (grid, "fake-openvdb")
        try:
            with tempfile.TemporaryDirectory() as directory:
                output = str(Path(directory) / "rejected.clda")
                with self.assertRaisesRegex(RuntimeError, "rotation, shear"):
                    CONVERTER.convert(arguments("fixture.vdb", output))
                self.assertFalse(Path(output).exists())
        finally:
            CONVERTER.read_grid = original


if __name__ == "__main__":
    unittest.main()
