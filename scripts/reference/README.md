# Reference frames: manifest and Cycles renderer

A reference frame is one JSON manifest plus the files it names. The manifest describes the whole scene, so three renderers can draw
the same frame and be compared pixel for pixel in linear radiance:

- `cycles_render.py`, Blender 5.1 Cycles (this directory);
- the sibling WebGPU path tracer (`examples/lab/reference-pt/`);
- the realtime runtime.

Validated against closed forms by `validate.py`. Results: `work/captures/P0-2b/tests/results.md`. Report: `work/reports/P0-2b-cycles-reference.md`.

## Commands

```sh
B=/Applications/Blender.app/Contents/MacOS/Blender
$B -b --factory-startup -P scripts/reference/cycles_render.py -- frame/manifest.json --out frame/cycles.exr \
   [--pfm frame/cycles.pfm] [--device CPU|GPU] [--spp N] [--passes] [--alpha] [--threads N] [--keep-blend]
python3 scripts/reference/make_test_manifests.py              # synthetic scenes -> work/captures/P0-2b/tests
python3 scripts/reference/validate.py [--only furnace,ss] [--device GPU]
$B -b --factory-startup -P scripts/reference/vdb_to_grid.py -- cloud.vdb --out dir --voxel 4 --up z   # VDB -> raw grid
python3 scripts/reference/preview.py frame.pfm preview.jpg --exposure 1.5   # a look only, never a measurement
```

Outputs of `cycles_render.py`:
- `--out`: a multipart EXR with one part per pass, 32-bit float, scene-linear Rec.709.
- The PFM of Combined RGB (`--pfm`, by default next to `--out`).
- `<stem>.json`: what ran and how long it took.
- With `--passes`: `<pfm>.volume_direct.pfm` and `.volume_indirect.pfm`, plus `.environment`, `.diffuse_direct` and `.diffuse_indirect`.
- With `--alpha`: `<pfm>.alpha.pfm`, which is 1 − transmittance along the camera rays. It comes from a second, cheap render.

## Manifest

```jsonc
{
  "grid": {                         // or null: no medium
    "file": "density.f32",          // relative to the manifest
    "dims": [nx, ny, nz],
    "order": "x-fastest",           // flat index i + nx * (j + ny * k)
    "voxel": 2.0,                   // metres, cubic voxels
    "origin": [x, y, z],            // world metres of the grid's min corner (corner of voxel 0, not its centre)
    "extinctionScale": 0.3          // sigma_t (1/m) per unit density
  },
  "medium": { "albedo": 0.99,       // scalar or [r, g, b]: sigma_s = albedo sigma_t, sigma_a = (1 - albedo) sigma_t
              "phase": { "type": "hg", "g": 0.8 } },
  "sun": { "direction": [x, y, z],  // unit vector TOWARD the sun; or null
           "irradiance": [r, g, b], // on a plane facing the sun, linear
           "angularRadius": 0 },    // radians; 0 = delta light
  "sky": { "uniform": [r, g, b] }   // radiance; or an equirect map:
      // { "file": "sky.pfm", "mapping": "equirect-rowtop+Y-u=atan2(x,-z)/2pi", "scale": 1 }
  "ground": null,                   // or { "y": 0, "albedo": [r, g, b], "halfSize": 1e5 }: Lambertian square, normal +Y
  "camera": { "position": [..], "target": [..], "up": [0, 1, 0], "fovY": 30, "width": 1280, "height": 720 },
  "render": { "spp": 1024, "maxBounces": 512, "seed": 0, "russianRoulette": false }
}
```

Extra keys (`notes`, `source`, ...) are ignored.

### Conventions

**World.** Metres, right-handed, +Y up: the three.js and pathtracer world. Radiance is in the runtime's linear exposure units, and
sky radiance (per steradian) and sun irradiance use the same units. Colour primaries are linear Rec.709/sRGB, and no transfer
function is applied anywhere.

**Grid.** Raw little-endian float32 with no header, x fastest, then y, then z. A JavaScript `Float32Array` in that order can be
written as is. Voxel (i, j, k) has its centre at `origin + (i + 0.5, j + 0.5, k + 0.5) * voxel`. Density is trilinear between voxel
centres and zero outside the grid, matching the pathtracer's `ptVolDensity`. `sigma_t = density * extinctionScale`, grey.

- **Leave at least one zero voxel on every face.** The pathtracer clips its medium at the box `[origin, origin + dims * voxel]`.
  Cycles lets the trilinear ramp run half a voxel past it. With an empty border the two see the same medium.
- `cycles_render.py` writes the grid to a temporary `.vdb` with grid name `density` and class FOG_VOLUME. Its transform is a scale
  by `voxel`, then a translation to `origin + voxel / 2`, because OpenVDB puts voxel centres at integer index coordinates.
- In the material, an Attribute node reads `density`. Its value is multiplied by `extinctionScale` and fed to **Volume Scatter**
  (Density = sigma_t, Color = albedo, so sigma_s = albedo × sigma_t) and **Volume Absorption** (Density = sigma_t, Color = albedo,
  so sigma_a = (1 − albedo) × sigma_t).
- There is no other multiplier. Volume precision is FULL (Blender's default is HALF), clipping is 0 (Blender's default 0.001 would
  drop thin material), and interpolation is LINEAR.

**Phase.** The angle is between the light's propagation direction and the scattered ray's. g > 0 scatters forward.
- `{"type": "hg", "g"}`: Henyey-Greenstein.
- `{"type": "draine", "g", "alpha"}`: Draine.
- `{"type": "mie", "diameter"}`: water droplets, diameter in µm, Blender's Jendersie-d'Eon 2023 fit, valid for 5–50 µm.
- `{"type": "mix", "lobes": [{"weight", ...phase}, ...]}`: a weighted mix, rendered as several Scatter closures that split sigma_s.
  This is our dual lobe.
- `fournier_forand {ior, backscatter}` and `rayleigh {}` pass through to Blender and are not validated.

**Sun.** `direction` points toward the sun. The pathtracer's `buildSceneCopy` takes the negated vector (travel direction). Blender's sun
strength is irradiance in W/m² on a plane facing the light. This was verified: a Lambertian ground reads a·E·cos(zenith)/π within
0.01 %. The script sets strength = max(irradiance) and colour = irradiance / max. Blender's `angle` is the angular **diameter**,
so it is set to 2 × angularRadius. The sun is never seen directly.

**Sky map.** Equirect PFM, RGB (`PF`) or grey (`Pf`), little-endian (scale −1).
- Image row 0 is +Y (zenith) and the last row is −Y. Because the PFM spec stores the **bottom row first**, the file holds the −Y
  row first. `refio.read_pfm` and `refio.write_pfm` flip, so callers always see row 0 = top.
- `u = atan2(x, −z) / 2π`, wrapped to [0, 1): u = 0 at −Z, 0.25 at +X, 0.5 at +Z, 0.75 at −X. `v = acos(y) / π`.
- Texel (i, j) covers [i/W, (i+1)/W] × [j/H, (j+1)/H]. The lookup is bilinear between texel centres; u wraps and v clamps.
- This is the pathtracer's `env-map.ts` convention (Mitsuba's `envmap` with an identity transform) and `bake.ts`'s `bakeSky`.
- Blender does not read the map with its own equirect convention. The world shader turns the ray direction back into our frame,
  computes u and v with math nodes, clamps v to half a texel, and samples an Image Texture (Linear, Repeat) holding the pixels
  unchanged (Non-Color).
- The importance map is MANUAL at the map's width.

**Camera.** A pinhole look-at camera. `right = normalize(cross(forward, up))` and `up' = cross(right, forward)`. `fovY` is the full
vertical angle in degrees. Pixel (px, py) has `ndc = ((px + jitter) / W * 2 − 1, 1 − (py + jitter) / H * 2)`, so image row 0 is
the top. This matches the pathtracer's `PtLookAtCamera`.
- Cycles uses a **box filter 1 px wide**: uniform jitter over the pixel, as the pathtracer does. Its sensor fit is VERTICAL with
  `angle_y = fovY`.
- Output images, in memory and after `read_pfm`, have row 0 at the top.

**Bounces.** `maxBounces` counts scattering or reflection vertices per path. It is pbrt's and the pathtracer's `maxDepth`:
1 = single scattering, meaning direct sun and sky light at the first vertex only.
- Cycles counts bounces after the first vertex, so the script sets Cycles `max_bounces = volume_bounces = diffuse_bounces = maxBounces − 1`.
  This was verified: maxBounces 1 matches closed-form single scattering within 0.02 %.
- With `russianRoulette: false` (the default), `min_light_bounces` is set to the cap, so there is no roulette, as in the pathtracer.

**Our Y-up world to Blender's Z-up.** Every object is built in our coordinates and placed with one proper rotation
`R: (x, y, z) -> (x, −z, y)`, which is +90° about X. This applies to the volume object, the camera, the sun and the ground. The
world shader applies R⁻¹ to the ray direction before the equirect lookup. Nothing relies on an importer's axis settings.
The `--up z` option of `vdb_to_grid.py` uses the same rotation: `(x, y, z)_src -> (x, z, −y)_ours`.

**Cycles settings that matter for bias.**
- Volumes use null scattering (`volume_biased = False`, unbiased; Cycles 5.x's default). Step size and step rate only affect the
  biased ray-marching mode. `volume_max_steps` is set to its maximum, 65536.
- These are all off: denoiser, adaptive sampling, clamping (direct and indirect), light threshold, fast GI / AO bounces, path
  guiding and scrambling distance.
- View transform is Standard with exposure 0. EXR output is scene-linear whatever the view transform.

### Passes

- **Volume Direct** is light reaching a volume scattering vertex at the first bounce: single scattering, sun and sky. It matched the
  closed form within 0.02 % with all 512 bounces enabled. **Volume Indirect** is every higher order. To split sun from sky, render
  twice; the result is linear.
- **Transmittance has no single-pass AOV.** Cycles' `volume_majorant` pass is the majorant's transmittance, not the medium's.
  `--alpha` re-renders with transparent film, lights off and maxBounces 1, then writes the film alpha, which is
  1 − E[transmittance].

## What the exporting side (the WebGPU page) must write

- **`density.f32`**: `DensityGrid.density` as is. `bakeDensity` already writes x fastest, then y, then z, with centres at
  `min + (i + 0.5) * voxel`.
  - `origin = grid.min`, `voxel = grid.voxel`, `dims = grid.resolution`.
  - `extinctionScale = runtime.settings.densityScale`.
  - Keep the empty margin (PT1 used 8 m).
- **`sky.pfm`**: `SkyBake.env` with RGBA reduced to RGB, rows reversed (PFM is bottom row first), header `PF\n<w> <h>\n-1.0\n`.
- **`sun`**: `direction` = `skyBridge.values.sunDirection` (toward the sun); `irradiance` = `SkyBake.sun`; `angularRadius` 0.
- **`camera`**: the `PtLookAtCamera` (`position`, `target`, `up`, `yFovDeg` → `fovY`) and the PT film size.
- **`medium`**: albedo and the phase. **`render`**: `maxBounces` = the PT's `maxDepth`, and `spp`.
