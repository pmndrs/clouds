#!/usr/bin/env python3
"""V1: measure the reference light (Karma Physical Sky at the C1 sun) in numbers our renderer can match.

  $HYTHON scripts/vdb/reference/sky_probe.py

Renders the sky dome alone (no cloud, sun disc hidden from camera) as six 64x64 cube faces with Karma from the C1 camera
height, integrates them, and reads the sun light's attributes from the stage. Prints JSON (also written to
artifacts/research/v1-reference/sky_probe.json): sun irradiance (normal incidence) and colour, sky radiance at zenith / at the
C1 sky patch direction, sky irradiance on a horizontal surface (upper hemisphere) and from the ground (lower hemisphere).
All values are Karma linear units (scene-referred, same as the reference EXRs before exposure).
"""
import json
import math
import os
import subprocess
import sys

import hou
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scene  # noqa: E402
import render  # noqa: E402

N = 64
FACES = {'px': (0, -90), 'nx': (0, 90), 'py': (90, 0), 'ny': (-90, 0), 'pz': (0, 180), 'nz': (0, 0)}   # (rx, ry), rotate order xyz


def rot(rx, ry):
    a, b = math.radians(rx), math.radians(ry)
    Rx = np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
    Ry = np.array([[math.cos(b), 0, math.sin(b)], [0, 1, 0], [-math.sin(b), 0, math.cos(b)]])
    return Ry @ Rx


def main():
    out_dir = os.path.join(scene.OUT_DIR, 'sky_probe')
    os.makedirs(out_dir, exist_ok=True)
    stage = hou.node('/stage')
    sky = stage.createNode('karmaphysicalsky', 'sun_and_sky')
    sky.parm('solar_altitude').set(scene.SUN_EL)
    sky.parm('solar_azimuth').set(scene.SUN_AZ)
    sky.parm('turbidity').set(3.0)
    for c in 'rgb':
        sky.parm(f'ground_albedo{c}').set(0.2)
    sky.parm('sun_renderlightgeo').set(0)
    prev = sky
    for name, (rx, ry) in FACES.items():
        cam = stage.createNode('camera', f'cam_{name}')
        cam.setInput(0, prev)
        cam.parm('primpath').set(f'/cameras/{name}')
        cam.parmTuple('t').set((0, 2, 0))
        cam.parmTuple('r').set((rx, ry, 0))
        cam.parm('horizontalAperture').set(2.0)
        cam.parm('verticalAperture').set(2.0)
        cam.parm('focalLength').set(1.0)      # 90 deg
        prev = cam
    rs = stage.createNode('karmarendersettings')
    rs.setInput(0, prev)
    rs.parm('res_mode').set('manual')
    rs.parm('resolutiony').lock(False)
    rs.parm('resolutionx').set(N)
    rs.parm('resolutiony').set(N)
    rs.parm('pathtracedsamples').set(16)
    usd = os.path.join(out_dir, 'sky.usd')
    rs.stage().Export(usd)
    sun = rs.stage().GetPrimAtPath('/lights/sun_and_sky/sun')
    intensity = sun.GetAttribute('inputs:intensity').Get()
    colour = list(sun.GetAttribute('inputs:color').Get())
    angle = sun.GetAttribute('inputs:angle').Get()

    E_up, E_down = np.zeros(3), np.zeros(3)
    zen = None
    u = (np.arange(N) + 0.5) / N * 2 - 1
    U, V = np.meshgrid(u, -u)                                  # row 0 = top (v = +1)
    dw = (4.0 / (N * N)) / (1 + U ** 2 + V ** 2) ** 1.5
    for name, (rx, ry) in FACES.items():
        exr = os.path.join(out_dir, f'{name}.exr')
        subprocess.run([os.path.join(render.HB, 'husk'), '-c', f'/cameras/{name}', '--res', str(N), str(N), '-o', exr, usd], check=True, capture_output=True)
        L = render.read_exr(exr)
        R = rot(rx, ry)
        right, up, fwd = R @ [1, 0, 0], R @ [0, 1, 0], R @ [0, 0, -1]
        d = fwd[None, None, :] + U[..., None] * right + V[..., None] * up
        d /= np.linalg.norm(d, axis=-1, keepdims=True)
        cy = d[..., 1]
        E_up += (L * (np.clip(cy, 0, None) * dw)[..., None]).reshape(-1, 3).sum(0)
        E_down += (L * (np.clip(-cy, 0, None) * dw)[..., None]).reshape(-1, 3).sum(0)
        if name == 'py':
            zen = L[N // 2 - 2:N // 2 + 2, N // 2 - 2:N // 2 + 2].reshape(-1, 3).mean(0)
    sun_dir = scene.sun_vector()
    res = {
        'sun': {'intensity': intensity, 'color': colour, 'angle_deg': angle, 'normalize': True,
                'irradiance_normal_rgb': [intensity * c for c in colour], 'direction_to_sun': sun_dir,
                'irradiance_horizontal_rgb': [intensity * c * sun_dir[1] for c in colour]},
        'sky': {'model': 'Karma Physical Sky (Hosek-Wilkie), turbidity 3, ground albedo 0.2',
                'zenith_radiance_rgb': zen.tolist(), 'irradiance_horizontal_up_rgb': E_up.tolist(),
                'irradiance_from_ground_rgb': E_down.tolist()},
    }
    lum = lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    res['ratios'] = {'sun_normal_over_sky_horizontal_irradiance': lum(res['sun']['irradiance_normal_rgb']) / lum(E_up),
                     'sun_horizontal_over_sky_horizontal': lum(res['sun']['irradiance_horizontal_rgb']) / lum(E_up)}
    json.dump(res, open(os.path.join(scene.OUT_DIR, 'sky_probe.json'), 'w'), indent=1)
    print(json.dumps(res, indent=1))


if __name__ == '__main__':
    main()
