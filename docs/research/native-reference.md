# Native Blender VDB reference

This reference is intended to be rendered from the authored Houdini OpenVDB
file at `fixtures/authored/vdb/houdini-cloudnoise.vdb`. It is a ground truth
for native volume shape and lighting. It is not a WebGPU render and must not
be used as evidence that the browser renderer produces the same image.

## Scene and material

- Renderer: Blender Cycles, CPU, 64 samples.
- Volume: native OpenVDB fog grid `density`; the grid transform and voxel
  spacing are preserved by Blender's volume loader.
- Object translation: `[0, 1676, 0]`, putting the source bounds around world
  center `y=1700` while retaining the authored grid transform.
- Volume shader: pure white Principled Volume, density attribute `density`
  multiplied by `0.025` (extinction per metre), anisotropy `0.65`.
- Multiple volume bounces: 8; maximum path bounces: 8.
- Ground: dark blue diffuse plane.
- Sky: Nishita sky background, strength `0.35`.
- Sun: normalized direction `[-0.671, 0.574, -0.470]`, energy `6`, color
  `[1, 0.95, 0.85]`.
- Camera: location `[350, 1360, 1800]`, target `[0, 1700, 0]`, vertical FOV
  `55°`, output `960×640`.

The reproducible scene builder is
[`scripts/render-cloud-reference.py`](../../scripts/render-cloud-reference.py).
The intended command is:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python scripts/render-cloud-reference.py -- \
  --vdb fixtures/authored/vdb/houdini-cloudnoise.vdb \
  --output artifacts/realism/native-reference.png
```

## Render status

The repository's Blender 5.1.1 binary was invoked in background mode on the
macOS host. It exits with status `139` during startup, before Python executes:
the crash occurs while Blender detects the Metal GPU backend
(`GPU_backend_type_selection_detect` / `MTLBackend::metal_is_supported`).
Explicit `--gpu-backend metal` has the same result; `opengl` is not supported
by this build. Therefore `artifacts/realism/native-reference.png` is not
present and no synthetic substitute is claimed. Once a headless-capable
Blender build is available, the command above will produce the requested
native render and its adjacent JSON settings record.

This limitation concerns only the local Blender process. The VDB itself is a
genuine Houdini 21.0.671 fog grid: 73×30×33 voxels, 16-unit spacing, bounds
`[-584,-216,-264]..[584,264,264]`, native density range `[0,1]`.


## Verified host run — 2026-10-08

Root completed the Cycles render with Blender 5.1.1 outside the sandbox.
Compatibility repairs used the installed volume API, multiple-scattering sky
node enum, Y-up to Z-up basis conversion, correct sun direction and camera far
clip. Output: `artifacts/realism/native-reference.png`, `.blend`, and `.json`.
This is an offline reference of the original Houdini fixture. It remains soft
and does not establish WebGPU parity or reference-quality cloud shaping.

## Billowy candidate — 2026-10-08

Rendered `houdini-cloudnoise-billowy.vdb` headlessly with the repaired Cycles
script, 64 samples at 960×640. Outputs: `artifacts/realism/native-billowy-reference`
PNG, metadata JSON and Blend scene. The cloud is present, with a dark underside
and rounded lobes, but remains soft and smooth. The WebGPU candidate also remains
too smooth. This is useful qualitative source evidence, not matched radiance,
WebGPU parity or appearance acceptance. Existing baseline outputs are preserved.
