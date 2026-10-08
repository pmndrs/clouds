#!/usr/bin/env python3
"""Generate the self-authored native Houdini cloud-noise fixture.

Run with Houdini 21's initialized hython environment:

  source ./houdini_setup
  hython scripts/generate-houdini-cloud.py fixtures/authored/vdb
  hython scripts/generate-houdini-cloud.py fixtures/authored/vdb --detail
  hython scripts/generate-houdini-cloud.py fixtures/authored/vdb --soft
  hython scripts/generate-houdini-cloud.py fixtures/authored/vdb --billowy

The network uses verified Houdini 21 SOPs: VDB from Particles followed by
Cloud Noise. The output is a real OpenVDB fog grid named ``density``; the
source point profile is intentionally irregular and Cloud Noise adds native
multiscale noise beyond the source shape.
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
import sys
from pathlib import Path


MAX_PAYLOAD_BYTES = 16 * 1024 * 1024
VOXEL_SIZE = 16.0
DETAIL_VOXEL_SIZE = 8.0
SOFT_DENSITY_SCALE = 0.4


def fail(message: str) -> "NoReturn":
    raise RuntimeError(message)


def load_converter():
    path = Path(__file__).with_name("convert-vdb-houdini.py")
    spec = importlib.util.spec_from_file_location("houdini_vdb_converter", path)
    if spec is None or spec.loader is None:
        fail(f"Cannot load Houdini converter {path}.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def require_hou():
    try:
        import hou  # type: ignore
    except ImportError:
        fail("Run this generator with Houdini hython, not workspace Python.")
    return hou


def source_points(hou, detail=False):
    if detail:
        # A taller, asymmetric profile with deterministic gaps gives Cloud
        # Noise irregular rims and interior voids to work from.
        centers = ((-420.0, 35.0, -50.0), (-170.0, 110.0, 80.0), (100.0, 40.0, 130.0), (360.0, -30.0, 10.0))
        points = []
        radii = []
        for lobe, (cx, cy, cz) in enumerate(centers):
            for iz in range(-3, 4):
                for iy in range(-2, 3):
                    for ix in range(-3, 4):
                        phase = lobe * 17 + ix * 19 + iy * 11 + iz * 23
                        # Leave reproducible holes in the source profile rather
                        # than filling every lattice site.
                        if (phase * 7 + lobe * 13) % 19 in (0, 1, 2):
                            continue
                        jitter_x = math.sin(phase * 0.43) * 28.0
                        jitter_y = math.cos(phase * 0.31) * 22.0
                        jitter_z = math.sin(phase * 0.27) * 30.0
                        points.append((cx + ix * 68.0 + jitter_x, cy + iy * 56.0 + jitter_y, cz + iz * 74.0 + jitter_z))
                        radii.append(62.0 + 38.0 * (0.5 + 0.5 * math.sin(phase * 0.17)))
        return points, radii

    # Three offset, irregular point lobes provide a coarse authored profile.
    # The downstream Cloud Noise SOP supplies the actual native cloud detail.
    centers = ((-280.0, 20.0, 0.0), (0.0, 50.0, 30.0), (270.0, -5.0, -20.0))
    points = []
    radii = []
    for lobe, (cx, cy, cz) in enumerate(centers):
        for iz in range(-2, 3):
            for iy in range(-2, 3):
                for ix in range(-3, 4):
                    phase = lobe * 11 + ix * 17 + iy * 7 + iz * 13
                    jitter_x = math.sin(phase * 0.71) * 22.0
                    jitter_y = math.cos(phase * 0.53) * 18.0
                    jitter_z = math.sin(phase * 0.37) * 20.0
                    points.append((cx + ix * 62.0 + jitter_x, cy + iy * 48.0 + jitter_y, cz + iz * 58.0 + jitter_z))
                    radii.append(78.0 + 24.0 * (0.5 + 0.5 * math.sin(phase * 0.29)))
    return points, radii


def set_parameters(node, settings, label):
    for name, value in settings.items():
        parm = node.parm(name)
        if parm is None:
            fail(f"Houdini {label} parameter {name!r} is unavailable.")
        parm.set(value)
    return settings


def set_cloud_noise(node, overrides=None):
    settings = {
        "spatialscale": 1.0,
        "noiseamount": 0.62,
        "noisetype": "snoise",
        "noiseoctaves": 4,
        "noiseelementsize": 115.0,
        "noiseelementscale1": 1.25,
        "noiseelementscale2": 0.72,
        "noiseelementscale3": 1.0,
        "noiseoffset1": 0.0,
        "noiseoffset2": 0.0,
        "noiseoffset3": 0.0,
        "noiserough": 0.55,
        "smoothvalleys": True,
        "absnoise": True,
        "advectnoise": True,
        "advectamp": 0.2,
        "advectelemsize": 90.0,
        "advectrough": 0.5,
    }
    if overrides:
        settings.update(overrides)
    return set_parameters(node, settings, "Cloud Noise")


def generate(directory, detail=False, soft=False, billowy=False):
    if sum((detail, soft, billowy)) > 1:
        fail("--detail, --soft and --billowy are mutually exclusive.")
    hou = require_hou()
    converter = load_converter()
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    stem = "houdini-cloudnoise-billowy" if billowy else "houdini-cloudnoise-soft" if soft else "houdini-cloudnoise-detail" if detail else "houdini-cloudnoise"
    voxel_size = DETAIL_VOXEL_SIZE if detail or soft or billowy else VOXEL_SIZE
    vdb_path = directory / f"{stem}.vdb"
    clda_path = directory / f"{stem}.clda"
    provenance_path = directory / f"{stem}.provenance.json"
    points_path = directory / f"{stem}.source.bgeo.sc"

    points, radii = source_points(hou, detail=detail or soft or billowy)
    geometry = hou.Geometry()
    geometry.createPoints(tuple(points))
    geometry.addAttrib(hou.attribType.Point, "pscale", 1.0)
    geometry.setPointFloatAttribValues("pscale", radii)
    geometry.saveToFile(str(points_path))

    obj = hou.node("/obj")
    container = obj.createNode("geo", stem.replace("-", "_"))
    try:
        source = container.createNode("file", "source_points")
        source.parm("file").set(str(points_path))
        particles = container.createNode("vdbfromparticles", "fog_density")
        particles.setInput(0, source)
        for name, value in {
            "voxelsize": voxel_size,
            "builddistance": False,
            "buildfog": True,
            "fogname": "density",
            "radiusscale": 0.7 if soft or billowy else 1.0,
            "minvoxelradius": 1.5,
            "footprint": "sphere",
        }.items():
            parm = particles.parm(name)
            if parm is None:
                fail(f"Houdini VDB from Particles parameter {name!r} is unavailable.")
            parm.set(value)
        if billowy:
            billowy_node = container.createNode("cloudbillowynoise", "native_cloud_billowy")
            billowy_node.setInput(0, particles)
            billowy_settings = set_parameters(billowy_node, {
                "usealphamask": False,
                "doiter": True,
                "densityscale": 1.0,
                "nnoises": 3,
                "amplitude": 0.35,
                "elementsize": 180.0,
                "worleyblend": 0.8,
                "worleyerosion": 0.85,
                "oct": 5,
                "advectnoise": True,
                "advect_ampscale": 0.35,
                "advect_elementsizecale": 0.45,
                "advect_oct": 4,
                "fogisovalue": 0.5,
                "amplitude_atten": 0.55,
                "elementsize_atten": 0.45,
                "nnoises_atten": 1.0,
                "worleyblend_atten": 0.75,
                "worleyerosion_atten": 0.8,
                "oct_atten": 1.0,
            }, "Cloud Billowy Noise")
            terminal = billowy_node
            noise_settings = {"cloudBillowy": billowy_settings}
            authoring_nodes = ["vdbfromparticles", "cloudbillowynoise"]
        elif soft:
            noise = container.createNode("cloudnoise", "native_cloud_noise_soft")
            noise.setInput(0, particles)
            noise_settings = set_cloud_noise(noise, {
                "noiseamount": 0.46,
                "noiseoctaves": 4,
                "noiseelementsize": 85.0,
                "noiseelementscale1": 1.0,
                "noiseelementscale2": 0.55,
                "noiserough": 0.65,
                "advectamp": 0.15,
                "advectelemsize": 65.0,
            })
            noise.cook(force=True)
            pre_result = noise.geometry()
            pre_vdb = converter.find_vdb(hou, pre_result, "density")
            pre_minimum, pre_maximum = converter.bbox_indices(pre_vdb)
            _, pre_values = converter.source_values(pre_vdb, pre_minimum, pre_maximum)
            negative_clamp_count = sum(value < 0.0 for value in pre_values)
            scale_node = container.createNode("volumewrangle", "explicit_density_scale")
            scale_node.setInput(0, noise)
            snippet = "@density = max(0, @density * 0.4);"
            parm = scale_node.parm("snippet")
            if parm is None:
                fail("Houdini Volume Wrangle snippet parameter is unavailable.")
            parm.set(snippet)
            terminal = scale_node
            authoring_nodes = ["vdbfromparticles", "cloudnoise", "volumewrangle"]
        elif detail:
            coarse = container.createNode("cloudnoise", "native_cloud_noise_coarse")
            coarse.setInput(0, particles)
            coarse_settings = set_cloud_noise(coarse, {
                "noiseamount": 0.78,
                "noiseoctaves": 4,
                "noiseelementsize": 200.0,
                "noiseelementscale1": 1.35,
                "noiseelementscale2": 0.55,
                "noiserough": 0.65,
                "advectamp": 0.35,
                "advectelemsize": 120.0,
            })
            fine = container.createNode("cloudnoise", "native_cloud_noise_fine")
            fine.setInput(0, coarse)
            fine_settings = set_cloud_noise(fine, {
                "noiseamount": 0.48,
                "noiseoctaves": 4,
                "noiseelementsize": 50.0,
                "noiseelementscale1": 0.85,
                "noiseelementscale2": 0.45,
                "noiserough": 0.72,
                "advectamp": 0.18,
                "advectelemsize": 50.0,
            })
            terminal = fine
            noise_settings = {"coarse": coarse_settings, "fine": fine_settings}
            authoring_nodes = ["vdbfromparticles", "cloudnoise", "cloudnoise"]
        else:
            noise = container.createNode("cloudnoise", "native_cloud_noise")
            noise.setInput(0, particles)
            noise_settings = set_cloud_noise(noise)
            terminal = noise
            authoring_nodes = ["vdbfromparticles", "cloudnoise"]
        terminal.cook(force=True)
        result = terminal.geometry()
        vdb = converter.find_vdb(hou, result, "density")
        if vdb.isSDF():
            fail("Native Cloud Noise output is an SDF, expected fog density.")
        if vdb.activeVoxelCount() <= 0 or vdb.volumeMax() <= 0 or not vdb.volumeMax() > vdb.volumeMin():
            fail("Native Cloud Noise output is empty or has no density variation.")
        if vdb.volumeMax() > 1.0 + 1e-6:
            fail(f"Native density exceeds the declared r8 range: {vdb.volumeMax()}")
        native_stats = {
            "activeVoxelCount": int(vdb.activeVoxelCount()),
            "volumeMin": float(vdb.volumeMin()),
            "volumeMax": float(vdb.volumeMax()),
            "volumeAverage": float(vdb.volumeAverage()),
            "background": float(vdb.intrinsicValue("background")),
        }
        final_minimum, final_maximum = converter.bbox_indices(vdb)
        final_dimensions, final_values = converter.source_values(vdb, final_minimum, final_maximum)
        final_peak = max(final_values)
        saturated_count = sum(value >= final_peak - 1e-6 for value in final_values)
        native_stats.update({
            "sourceDimensions": list(final_dimensions),
            "globalMean": sum(final_values) / len(final_values),
            "saturatedVoxelCount": saturated_count,
            "saturatedVoxelFraction": saturated_count / len(final_values),
            "saturatedActiveFraction": saturated_count / max(1, int(vdb.activeVoxelCount())),
        })
        result.saveToFile(str(vdb_path))
    finally:
        container.destroy()
        points_path.unlink(missing_ok=True)

    converter.convert_file(vdb_path, clda_path, "density")
    conversion_metadata = json.loads(Path(str(clda_path) + ".json").read_text(encoding="utf-8"))
    metadata = {
        "source": "self-authored-houdini-cloud-billowy" if billowy else "self-authored-houdini-cloud-noise-soft" if soft else "self-authored-houdini-cloud-noise-detail" if detail else "self-authored-houdini-cloud-noise",
        "runtime": hou.applicationVersionString(),
        "sourceVDB": str(vdb_path.resolve()),
        "outputCLDA": str(clda_path.resolve()),
        "grid": "density",
        "gridClass": "fog",
        "authoringNodes": authoring_nodes,
        "voxelSize": voxel_size,
        "sourcePointCount": len(points),
        "cloudNoise": noise_settings,
        "nativeStats": native_stats,
        "r8Normalization": "none; native density is already in [0,1]",
        "extinctionScale": 0.025,
        "quantizationMaxAbsError": 0.5 / 255.0,
    }
    if billowy:
        metadata["densityAuthoringTransform"] = {
            "operation": "native Cloud Billowy Noise displacement with Worley erosion",
            "densityScale": 1.0,
            "normalization": "none; native billowy output",
        }
    elif soft:
        metadata["densityAuthoringTransform"] = {
            "operation": "density = max(0, density * 0.4)",
            "scale": SOFT_DENSITY_SCALE,
            "negativeClampCount": negative_clamp_count,
            "normalization": "none; fixed authoring scale",
        }
    if detail or soft or billowy:
        metadata["conversionChecks"] = {
            "positiveVoxelCount": conversion_metadata["sourceStats"]["positiveVoxelCount"],
            "positiveVoxelFraction": conversion_metadata["sourceStats"]["positiveVoxelFraction"],
            "mass": conversion_metadata["sourceStats"]["mass"],
            "peakDensity": conversion_metadata["sourceStats"]["peakDensity"],
            "globalMean": native_stats["globalMean"],
            "saturatedVoxelCount": native_stats["saturatedVoxelCount"],
            "saturatedVoxelFraction": native_stats["saturatedVoxelFraction"],
            "saturatedActiveFraction": native_stats["saturatedActiveFraction"],
            "readbackParity": conversion_metadata["readbackParity"],
            "quantizationMaxAbsError": conversion_metadata["quantizationMaxAbsError"],
        }
    provenance_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    if vdb_path.stat().st_size > MAX_PAYLOAD_BYTES or clda_path.stat().st_size > MAX_PAYLOAD_BYTES:
        fail(f"Generated fixture exceeds {MAX_PAYLOAD_BYTES} bytes.")
    print(json.dumps({"sourceVDB": str(vdb_path), "outputCLDA": str(clda_path), "provenance": str(provenance_path), "activeVoxelCount": metadata["nativeStats"]["activeVoxelCount"], "volumeMax": metadata["nativeStats"]["volumeMax"]}))


if __name__ == "__main__":
    try:
        if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] not in ("--detail", "--soft", "--billowy")):
            raise SystemExit("usage: hython scripts/generate-houdini-cloud.py OUTPUT_DIRECTORY [--detail|--soft|--billowy]")
        generate(sys.argv[1], detail=len(sys.argv) == 3 and sys.argv[2] == "--detail", soft=len(sys.argv) == 3 and sys.argv[2] == "--soft", billowy=len(sys.argv) == 3 and sys.argv[2] == "--billowy")
    except Exception as error:
        print(f"generate-houdini-cloud.py: error: {error}", file=sys.stderr)
        raise SystemExit(2)
