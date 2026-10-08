# P1-01 review (commit 30edaf7)

Reviewer: read-only pass over `runtime.ts`, `shaders/{march,density,composite,frame,common,volume}.wgsl.ts`, `resources.ts`, `half.ts`, `flagship/{main,three-bridge}.ts`, against the spec, `VoxelCloudSampler.cg` and `assets/clouds/README.md`. Nothing was executed; findings come from reading the code and doing the arithmetic. Line numbers are file lines in the checked-out tree.

No Critical defects found: ray reconstruction, axis mapping, uniform layout, integration formula and composite order are right (see the last section). The High items are failure modes that will show up as soon as the cloud gets thin or the camera sits in it.

## High

### H1. `maxSteps` cap silently drops the rest of the ray and leaves it transparent
- `march.wgsl.ts:77` `for (i < frame.maxSteps)`; nothing after the loop (`:111`) handles hitting the cap. `runtime.ts:73` default 768.
- Failure: the loop exits with `T` still high and the remaining cloud is never integrated. The output is `(radiance so far, T)`, so the far side of the cloud shows sky or ground through it. Near-camera rays take 1 m steps (`step = max(1, 0.08*sqrt(t))` is 1 m until t is about 156 m). A ray that spends more than 768 m in a thin or eroded region cannot finish. Examples: the camera inside or just at the edge of the 864 m Parkouring box looking along a wisp, or `?s.maxSteps=` lowered for perf. The near-camera density fade (x0.25 at 10 m, `density.wgsl.ts:44`) makes this more likely right where the camera sits. The cut-off distance is camera-relative, so it swims as the camera moves.
- Fix: do not use a hard cut. Make the step grow once `i` passes a threshold (for example `step *= 1.0 + 0.02 * f32(max(i, 256u) - 256u)`), or at the cap treat the unmarched remainder as terminated: `T = 0` if `T < 0.3`, otherwise fade `T` towards 1 over the last 10% of steps so the edge is not visible. Also expose a debug counter or colour for "cap hit" in the test page.

### H2. Float16 overflow into the HDR targets is not guarded
- `march.wgsl.ts:115` stores `radiance` into `rgba16float`; `composite.wgsl.ts:51` and `three-bridge.ts:19` then compute `scene*a + rgb`.
- Failure: `lit` is `sunRadiance * (exp(-tau)*phase + ...)`. `sunRadiance` is the sky's `light.color * intensity`, i.e. in `luminanceScale` units and set by the sky, not by us. The forward lobe peaks near 3.6 (0.3 * HG(0.8, cos 1)) and the sum over steps approaches `lit` for an opaque cloud. If the sky's sun illuminance in these units is above roughly 20000, looking through a cloud at the sun gives +Inf in the half-float target. Inf times 0 is NaN in the blend, which three then tone-maps into a black or white blob that bloom or any later TAA smears across the frame. The captures only exercise `?time` values where the sun is moderate.
- Fix: `radiance = min(radiance, vec3(60000.0))` before the store. Better, store radiance divided by a per-frame exposure scalar and multiply it back in the blend. Add a NaN/Inf scan to the GPU test page.

## Medium

### M1. Composite rejects taps on scene distance, not on whether the tap actually lost cloud
- `composite.wgsl.ts:20`: `strict && d.y < sceneT*0.97 - 1.0`. `d.y` is the farthest scene distance in the tap's 2x2 block; `sceneT` is this pixel's own.
- Failure A (grazing ground): neighbouring output pixels on a ground plane differ in distance by about `2 * 0.0011 / theta` between two taps, so for the first 4 to 5 degrees below the horizon (about 60 px at 1080p) the nearer taps are rejected for the farther pixel even though the cloud (a few km away) is in front of both. You lose half of the bilinear footprint, so cloud edges in that band shift by up to one march pixel and stair-step. When all four are rejected, the fallback (`:49`) takes the nearest tap and clips it at `d.x > sceneT*1.02+1` (`:22`), which can delete valid cloud.
- Failure B (silhouettes against distant terrain): a tap marched to 80 km is rejected for a pixel at 100 km although the volume exits at 5 km and nothing was truncated.
- Fix: a tap lost information only if its scene end was inside the cloud interval of this pixel's ray, i.e. `d.y < min(volumeExit(pixelRay), sceneT)`. Pass the volume exit distance for the pixel (recompute with `volumeRayInterval`, cheap) and reject on `d.y < min(exit, sceneT) * 0.97 - 1`. The same quantity can replace the `sceneT*1.02+1` test at `:22`: a tap's cloud is behind the pixel's surface only if `d.x > sceneT`, with a tolerance relative to the voxel size rather than a percentage.

### M2. Mean cloud distance is a poor occlusion test for clouds that straddle a foreground surface
- `march.wgsl.ts:114`, `composite.wgsl.ts:22`.
- Failure: a ray with cloud both in front of and behind a nearer foreground object (a mountain top poking into a cloud, an aircraft inside the cloud) gets one weighted mean distance in the middle. The composite then either keeps all of it (leaks the behind-the-surface half onto the object) or drops all of it (loses the in-front half). Both show as a fringe around the object at silhouettes. It is rare in the current scene (the ground is a plane), so keep it Medium until a geometry test scene exists.
- Fix (P1-06 or later): also store the transmittance at the scene surface (or the radiance up to `sceneEnd` separately). For the final version, split the march at the pixel's own depth in the composite instead of using a mean.

### M3. The SDF is not strictly conservative under trilinear filtering
- `volume.wgsl.ts:44-51`, comment at `:41` says "never larger than the true distance"; `march.wgsl.ts:81`.
- Failure: the stored values are an exact EDT to voxel centres minus half a voxel (`assets/clouds/README.md`). That is exact for face neighbours but overestimates the distance to the staircase surface at diagonal cells (about 2.9 m for a 3-diagonal at 8 m voxels). Trilinear interpolation of a 1-Lipschitz field has gradient up to sqrt(3), adding up to about half a voxel of error. A long `step = sdf` can land up to roughly one voxel (4 to 8 m) inside the sdf<0 region, so the first one to two samples at the edge of every grazing silhouette are skipped. Because density is a low eroded tail there, the effect is a slightly chipped edge, not a hole. The same applies to the clamp-to-edge SDF fetch at the box face (`:48`), which reads a texel half a voxel inside.
- Fix: in `cloudDistance`, return `s - 0.5 * cloudVolume.voxelSize` when `s > 0` (about one extra step per ray near the boundary). Keep the README claim honest ("conservative to within half a voxel") if it is not changed.

### M4. Per-step cost inside the cloud is higher than needed (this is the 9.4 ms case)
These are in addition to the known 1 m step and the 6-tap sun march that are being replaced.
- SDF is fetched every step (`march.wgsl.ts:80`) although deep inside it cannot change sign: the field is 1-Lipschitz (plus M3), so once `sdf <= -2*step` the next sample cannot be `>= 0`. Cache `sdfEst = sdf + step` (moving away from the nearest surface at most `step`) and refetch only when `sdfEst > -2*step`. `relax` (`:94`) can use the cached estimate, since it is a 0.05 to 0.25 ramp over 128 m.
- `hfDetails` is on for `ts < 150`, which is exactly the inside case. `density.wgsl.ts:31` and `:41` then evaluate about 7 `pow`s per step (`pow(.,4)`, `pow(.,2)`, `pow(d, mix(0.5,1,f))`, `pow(profile,0.25)`, `pow(d, mix(0.3,0.6,..))`, `pow(saturate(densityScale),4)`). Each is an exp2/log2 pair on Metal. Replace constant exponents: `x*x`, `x2*x2`, `sqrt(sqrt(profile))`; the two variable exponents stay. Also `march.wgsl.ts:97` `pow(.., 0.5)` -> `sqrt`.
- Hoist ray-constant terms out of the loop: `valueRemap(cosSun, 0.0, 0.9, 0.0, 1.0)` (`:94`) and the unused `sunRelax` (`:74`, dead code).
- `sunOpticalDepth` (`:92`) runs for every sample with `d.x > 0`, including samples whose contribution is negligible. Skip lighting when `sigma*ds < 1e-3` (accumulate `T` only), which also stops the pow-amplified density tail from paying for six extra fetches.
- Early exit at `T < 0.01` could be 0.03 to 0.05 with the remainder folded into `T = 0` for a visible saving in dense fog; the error is under 5% of the radiance of the last bit.
- The 4x4 depth max loop (`:53`) is at most 16 `textureLoad`s per march pixel at quality 'low' and 4 at 'high'; negligible against the march. Leave it.
- Divergence: per-thread trip counts differ inside an 8x8 tile; at a cloud edge a tile waits for its slowest ray. The planned near/far split is the right answer; nothing to do now.

### M5. Black frame if `encode` skips while a three StorageTexture is bound
- `runtime.ts:163` returns early when not ready (volume/noise not set, or `output` null after a failed `resize`), and `three-bridge.ts:60` still presents `scene * cloud.a + cloud.rgb`. The never-written StorageTexture is zero, so `a = 0` and the whole frame is black. `main.ts` awaits the loads before the loop, so it is hidden today, but any later hot-swap of the volume (`setVolume` is async API) or an error path will black out the canvas.
- Fix: make `present()` check `runtime.ready` and fall back to a plain scene blit, or have `encode` clear `output` to `(0,0,0,1)` when not ready.

## Low

### L1. NaN hazards
- `common.wgsl.ts:12` `valueErosion` divides by `1 - oldMin`; `noiseComposite` can be exactly 1.0 (8-bit noise at 255 and `profile == 1.0`, both likely in a core of 255s). That gives 0/0 for `profile == 1`; WGSL `saturate(NaN)` is implementation-defined and Metal fast-math may return NaN. `march.wgsl.ts:90` (`d.x > 0.0`) probably masks it, but only by accident. Use `/ max(1.0 - oldMin, EPSILON)`.
- `volume.wgsl.ts:36-37` `1.0 / dir` gives `0 * inf = NaN` when a ray component is exactly 0 and the origin lies on a box plane (level camera exactly at `minCorner.y`). Clamp: `let inv = 1.0 / select(dir, vec3(1e-9), abs(dir) < vec3(1e-9))`.
- `pow(0, negative)` does not occur (all exponents are positive); HG denominator stays positive for g = 0.8 even if `cos` rounds above 1.

### L2. Camera position read from the local transform
- `three-bridge.ts:57` uses `camera.position`, but `invViewProj` is built from `matrixWorld`. If the camera ever gets a parent (rig, XR), the ray origin and the unprojected points disagree. Use `camera.matrixWorld.elements[12..14]` (or `getWorldPosition`).

### L3. Depth unprojection loses precision at large far/near
- `frame.wgsl.ts:21-24`: the `w` row of the f32 `invViewProj` is `(1/f - 1/n) z + 1/n` (cancellation). With `n = 0.5`, `f = 1.5e6` the relative error of `w`, hence of distance, is about 1.2e-7 / (1/d): 1% at 100 km, 3.6% at 300 km. That is only the horizon band of the ground plane and is not used for the ray direction (which is scale-invariant), but it makes the 3% tolerance in M1 noisy there. A reversed-Z depth (P2 option in the spec) or storing linear view distance in the scene pass fixes it.

### L4. `animSpeed` scales the integrated offset, not the rate
- `runtime.ts:192-193`: `windOffset * animSpeed`. Changing `animSpeed` at runtime teleports the noise by `offset * delta`. Integrate `windOffset += windVelocity * animSpeed * dt` and send `windOffset` as is.
- Also `windOffset` advances by wall-clock `frame.time`, so captures taken at different times differ in noise phase; make the harness pin `time` (or set `windVelocity` to 0) if pixel comparison is wanted.

### L5. Lifecycle and misuse
- `dispose()` (`runtime.ts:212`) destroys buffers but leaves `volumeGroup`, `marchGroup`, etc. set; a later `encode` produces validation errors that invalidate the whole command buffer, including the caller's passes. Add a `disposed` flag that makes `encode` a no-op.
- No `device.lost` handling in the runtime. Acceptable while three owns the device, but note it for P2.
- `encode` writes a single shared `frameUniforms` buffer with `queue.writeBuffer`. Calling `encode` twice before one `submit` (two views, VR) makes both passes see the last data. Document it, or move to a small ring of uniform buffers when stereo is on the plan.
- `resize()` does not check that a caller-supplied `output` is exactly `width x height`; a mismatch writes out of bounds (silently discarded) and leaves part of the image uncovered.
- Per-frame garbage: `runtime.ts:186-195` builds about 8 small array literals per frame for `f.set([...])`, and `main.ts:150-163` allocates `E`, `removed`. Not a spec violation (no buffers, textures, bind groups or pipelines per frame; bind groups are rebuilt only when the depth view changes), but trivial to write with indexed assignments.

### L6. Scene antialiasing is lost
- `main.ts:30` requests `antialias: true` for the canvas, but the scene is rendered into a non-MSAA `RenderTarget` (`three-bridge.ts:12`) and the canvas only receives a full-screen quad. Geometry edges (ground horizon, future meshes) are aliased and the canvas MSAA is wasted. Either drop the flag or add an FXAA/TAA step after the blend. The cloud composite itself is fine because it is a smooth image.

### L7. Spec drift to record (not defects)
- March depth is `rg32float`, not `r32float` (reported). The spec's "Composite weighted by depth difference" is implemented as a binary tap rejection (M1) rather than weights.
- Extinction default 0.3, not 0.1 (reported). `depthKind` is accepted but unused (fine, `texture_depth_2d` covers both).
- Light-grid and in-line-2-samples lighting are not in this march yet (P1-05), so the sun term is the temporary 6-tap one.

## Verified correct; do not change

- **Depth and ray reconstruction.** `unprojectDepth` flips y (`1 - 2*uv.y`) correctly for WebGPU texture rows, uses conventional 0..1 depth, and the matrix is `matrixWorld * projectionMatrixInverse`, which is the exact inverse of `P*V`. three sets `camera.coordinateSystem = WebGPU` during `render`, and `fillFrame` runs after `renderScene`, so the matrices are the 0..1 ones even on frame 0. The ray direction (`unproject(uv, 1) - origin`, normalised) is independent of the f32 error in `w`. `sceneDistance` is Euclidean ray distance, which equals `t` because `dir` is unit length. `depth >= 1.0` treated as sky is right for a cleared 1.0 depth.
- **Axis mapping.** `volumeUvw` maps (x, y-up, z) to (x, z, y) and divides by `(ex, ez, ey)`; `extentMeters = [w*v, d*v, h*v]` matches; the uniform struct (48 bytes) and `volumeUniformData` agree.
- **Frame uniform layout.** Every offset in `runtime.ts:184-196` matches the WGSL `Frame` struct (0/64/80/96/112/128/144/160/168/176/180, 192 bytes total).
- **Integration.** `radiance += lit * T * (1 - exp(-sigma*ds)); T *= exp(-sigma*ds)` is Hillaire's `S = sigma_s * L * (1 - exp(-sigma_t ds)) / sigma_t` with albedo 1 (sigma_s = sigma_t), constant `lit` per segment. It is energy conserving for that assumption. When you add albedo, the factor becomes `albedo * lit * T * (1 - stepT)`; keep the `T *= stepT` unchanged.
- **Jitter.** Applied to the sample position only (`ts = t + j*step`), the advance is `t += step`, animated below 250 m and static beyond, `ds = min(step, tEnd - t)` and `ts < tEnd` guard the last segment. This matches `nubis-sources.md` §5.
- **Premultiplied blend and order.** March writes `(radiance, T)`, composite interpolates premultiplied values linearly, the blend `scene*a + rgb` is done in linear HDR before three's tone mapping (the quad is a toned-mapped material rendered to the canvas). The ray is correctly attenuated through the sky and the sun disc. Phase uses `dot(dir, sunDir)` with both pointing toward their targets, so forward scattering peaks when looking at the sun.
- **Density port.** `density.wgsl.ts` matches `VoxelCloudSampler.cg` branch for branch (mip, wispy/billowy, HF fold and blend, erosion, powered scale, sharpen, HF re-sharpen, near fade), with the horizontal xz wind deviation documented. Constant exponents are positive, so no `pow(0, <0)`. Parity numbers from P1-04 are consistent with this.
- **Ms relax.** `mix(0.25, remap(sdf,-128,0,0.05,0.25), remap(cosSun,0,0.9,0,1))` equals `remap(cosSun,0,0.9,0.25, remap(sdf,...))` from the source.
- **SDF encoding.** `toHalfBitsRoundDown` correctly steps toward -inf for both signs (including the -0 / subnormal edge), and `r16float` is filterable.
- **Composite design.** Using the farthest depth of the covered block for the march end, plus rejecting taps by their own scene end and cloud mean distance, is a sound way to avoid cloud-behind-foreground leaks at 2x2 granularity. The fallback to the nearest tap when all four are rejected prevents holes. Keep the structure; only fix the criteria (M1).
- **Spec compliance.** `packages/runtime` imports no three module; no submit/await/mapAsync in `encode`; pipelines and layouts are created once in `createCloudRuntime` with explicit layouts (no `layout: 'auto'`); bind groups are rebuilt only when the depth view or targets change; storage-texture formats (`rgba16float`, `rg32float` write-only) are legal in core WebGPU; `rg32float` is read as `unfilterable-float`; the depth view uses `aspect: 'depth-only'` and is cached in a WeakMap.
- **Resize path.** `resize` is idempotent, `releaseTargets` only destroys textures the runtime owns, and `setQuality` re-allocates with the same external output. WebGPU defers destruction until submitted work completes, so destroying old targets mid-frame is safe.
