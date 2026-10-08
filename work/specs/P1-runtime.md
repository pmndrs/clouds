# P1 runtime spec: `@clouds/runtime`

The orchestrator owns this file. Tasks implement it. If the spec is wrong,
say so in your report; don't silently diverge.

## Principles

- **Renderer-agnostic.** `packages/runtime` imports nothing from three.js.
  Inputs are a `GPUDevice`, matrices as `Float32Array`/number arrays, and
  `GPUTextureView`s. The three glue lives in `examples/lab/flagship/three-bridge.ts`
  for P1, then moves to the P2 adapter package.
- **Encode, don't submit.** `runtime.encode(encoder, frame)` records passes
  into the caller's `GPUCommandEncoder`. No `queue.submit`, no `await` and no
  `mapAsync` on the frame path. Asset upload is the only async step.
- **Amortized updates.** Nothing done on a parameter or sun change may cost
  more than one frame's slice of work.
- **Raw WGSL** in TS modules (`src/shaders/*.wgsl.ts`, exporting strings).
  Shared helpers go in `common.wgsl.ts`. Pipelines are created once at init
  or on quality change, never per frame.
- **Units.** Metres, world y-up, right-handed, WebGPU clip space with z in 0…1.
  Conventional depth for P1. Reversed-Z is a P2 option.

## Foundation (exists, orchestrator-owned; extend only via your task's listed files)

- `src/assets.ts`: `loadCloudVolume(url)` (decodes the SDF to metres), `loadCloudNoise(url)`.
  Assets are served from `/assets/clouds/<name>/` because vite has `fs.allow ../..`. Use
  `new URL('../../../../assets/clouds/parkouring/', import.meta.url).href` or the equivalent from your file.
- `src/resources.ts`: `uploadCloudVolume` creates NVDF `rgba8unorm` and SDF `r16float` (metres, rounded
  down), and gives `extentMeters` in world axes. `uploadCloudNoise` uploads the 8 mips.
- `src/shaders/common.wgsl.ts`: `valueRemap`, `valueErosion`, `fractionFromValue`, `pcg`/`hash01`, `ign`.
- `src/shaders/volume.wgsl.ts`: `volumeWgsl(group)` gives the bindings plus `volumeUvw`, `insideVolume`,
  `sampleModeling(p, mip)`, `cloudDistance(p)` (conservative outside the box) and `volumeRayInterval`.
  Also `createVolumeBindGroupLayout` (explicit; never use `layout: 'auto'` for passes that take the
  volume group), `createVolumeBindGroup`, `volumeUniformData` and `createVolumeSamplers`.
- **Bind group convention:** group 0 is the volume (shared by every pass); group 1 is per-pass.

## Density function: fixed signature (P1-01 implements it, P1-04 tests it)

`src/shaders/density.wgsl.ts` exports `DENSITY_WGSL`. It requires `COMMON_WGSL` and `volumeWgsl(0)` to be
concatenated before it and declares:

```wgsl
struct DensityInputs { wind: vec3<f32>, mipDistanceScale: f32, baseMip: f32, hfDetails: u32, _p0: f32, _p1: f32 }
// x = full up-rezzed density (0..1, before extinction scaling), y = profile * density scale (cheap).
fn cloudDensity(p: vec3<f32>, rayDistance: f32, inputs: DensityInputs) -> vec2<f32>
```

- It is a line-for-line port of `GetVoxelCloudDensitySamples` + `GetUprezzedVoxelCloudDensity` from
  `assets/nubis-voxel-clouds/Code Fragments/VoxelCloudSampler.cg`, including the
  `* ValueRemap(distance, 10, 120, 0.25, 1)` near-camera fade and `pow(saturate(densityScale), 4)`.
- Noise is sampled at `(p - inputs.wind) * cloudVolume.noiseScale` with the **world** position. The
  Decima code is z-up and scrolls `xy`; our horizontal plane is `xz`, so `wind.y` should be 0.
- The NVDF is sampled at mip `inputs.baseMip`.
- The noise mip is `log2(1 + |rayDistance * mipDistanceScale|) + baseMip`.

## Frame order in the flagship (P1-01 restructures `main.ts`)

1. three renders the scene into a `RenderTarget` with a `DepthTexture` (`FloatType`, `depth32float`).
2. `sky.update`, then the runtime encodes light-grid, march and composite into one encoder, reading the
   scene depth through `sharedBackend(renderer).texture(...)`, as the legacy `volumetric/index.ts` did.
3. A three `QuadMesh` presents `sceneColor * cloud.a + cloud.rgb`, then tone mapping.

The current `cloud-hook.ts` runs before the scene render, so P1-01 must change it.

## Data

| Resource | Format | Notes |
| --- | --- | --- |
| NVDF | `rgba8unorm` 3D, (X, Ymap, Zup) | R profile, G detail type, B density scale. Linear filter, clamp-to-edge, no mips in P1 |
| SDF | `r16unorm` 3D, same dims | metres = lerp(−256, 4096, v); negative inside. Linear filter, clamp |
| Noise | `rgba8unorm` 3D 128³ | Full mips, linear-mip-linear, repeat. R/G wispy, B/A billowy |
| Light grid | `rg16float` 3D storage | x = summed sun density, y = summed up (sky) density. ≈ NVDF dims / 2, min 16 per axis |
| March output | `rgba16float` 2D at render res | rgb = in-scattered radiance (premultiplied); a = transmittance |
| March depth | `r32float` 2D at render res | Transmittance-weighted mean distance (m); 0 where no cloud |
| Composite | `rgba16float` 2D at output res | Upsampled march output for the caller to blend: `scene * a + rgb` |

**Axis mapping.** World point `p` maps to volume-local `q = p − volume.min`,
with metres in (x, y_up, z). The texture coordinate is
`uvw = vec3(q.x, q.z, q.y) / (dims * voxelSize)`. That is, texture axes are
(world x, world z, world y). Confirm `assets/clouds/README.md` agrees; if
the source map's Y is mirrored, flip in the converter, not the shader.

## API (P1 surface; P2 hardens it)

```ts
const runtime = createCloudRuntime(device, { quality?: 'high' | 'medium' | 'low' })
await runtime.setVolume(await loadCloudVolume(url), { position: [x, y, z] })  // min corner in world metres
await runtime.setNoise(await loadCloudNoise(url))
runtime.resize(outputWidth, outputHeight)           // allocates render-res targets from quality
runtime.encode(encoder, frame, timer?)              // records all passes
runtime.output                                      // GPUTexture to blend: scene * a + rgb
runtime.settings                                    // live knobs: densityScale, windOffset, animSpeed, …
runtime.dispose()
```

`frame: CloudFrame`:
- `view`, `projection`, `viewProjection`, `inverseViewProjection`,
  `previousViewProjection` (column-major `Float32Array(16)`)
- `cameraPosition`
- `depth`: `GPUTextureView` with `depthKind: 'depth32float' | 'depth24plus'`.
  The scene depth at output res, conventional 0…1. Linearize it with
  `inverseViewProjection`.
- `sunDirection` (unit vector, toward the sun)
- `sunRadiance`: rgb, already scaled by the sky's exposure (`luminanceScale`)
- `ambientTop`, `ambientBottom`: rgb sky irradiance seen from the clouds, same
  scale
- `atmosphere?`, optional in P1-05:
  `{ transmittanceLut: GPUTextureView, aerialPerspective?: GPUTextureView, … }`
  with the parameterization from `@pmndrs/sky`
- `time` (seconds), `frameIndex`

## Passes, in encode order

1. `light-grid`: compute. Update 1/8 of the grid's z-slices per frame, so a
   full refresh takes 8 frames. Restart from slice 0 when the sun moves by
   more than 0.5°. For each voxel, march toward the sun to the grid bounds
   accumulating `profile * densityScale` (cheap `mProfile`). Then march
   straight up the same way.
2. `march`: compute at render res.
   - Ray from the camera to min(volume exit, scene depth).
   - Step rule from `nubis-sources.md` §5:
     `step = max(sdf, max(1, sqrt(t) * 0.08))`. Jitter is `hash * step`,
     animated per frame within 250 m and static beyond, and is applied to the
     sample position only.
   - Sample only where sdf < 0. Density comes from the up-rez sampler,
     ported exactly from `VoxelCloudSampler.cg`.
   - Lighting:
     - first 2 sun samples marched in-line, the rest from the light grid
     - Beer for direct light
     - HG with g = 0.2 plus a forward lobe
     - ms inner glow and ambient as in `nubis-sources.md` §4
   - Energy-conserving integration (Hillaire):
     `S = L * (1 - exp(-σ ds)) / σ` with σ the extinction coefficient.
   - Early exit when T < 0.01.
   - Writes color/T and the mean depth.
3. `composite`: compute at output res. Depth-aware upsample of the march
   output: 4 taps, weighted by the difference between march depth and scene
   depth. Writes `output`.
4. **Near/far split (P1-06).** The march runs twice: rays with t < 200 m at ¼
   res, t ≥ 200 m at ½ res. Composite merges them front to back.

## Constants to start from

| Constant | Value |
| --- | --- |
| Extinction σ | `density * 0.1 m⁻¹` at density 1 (tune by eye, expose as `densityScale`) |
| `fineDetailMipDistanceScale` | 0.01 |
| Transmittance limit | 0.01 |
| HG | 0.2 · forward 0.8 lobe, mixed 0.7 / 0.3 |
| Noise tile | `pos * 0.01` (100 m) |
| Wind | `windOffset += windVelocity * dt` |

## Verification

`examples/lab/runtime-tests/` is a GPU test page:
- runs WGSL density at fixed points and compares against the CPU reference
  (`packages/runtime/src/reference/density.ts`)
- checks light-grid values against a CPU march on a small synthetic volume
- reports pass/fail through `window.__clouds.report()`

Run it with the capture harness. The visual bar is the flagship page's
bookmarks, captured with `scripts/gpu/capture.mjs`.
