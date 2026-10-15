# C2: temporal reprojection follows the cloud motion

## What changed
- `shaders/sky-layer.wgsl.ts` (resolve): the history lookup is shifted back by the clouds' world displacement since last frame (`SKY.cloudMotion.xyz`, new vec4 after `erosion`; `SKY_PARAM_FLOATS` 80 -> 84). The shifted point `cam + dir*rd - shift` is projected with `prevViewProj` at the pixel's cloud mean distance `rd` (transmittance-weighted depth of the fresh sample, else the stored history distance, else far). Off-screen reprojection was already rejected (`valid`).
- History weight: with cloud motion on, a fresh pixel's blend rises from `temporalBlend` toward 1 as the on-screen motion grows from 6 to 40 layer pixels. The variance clip strength follows the camera-only movement (the shifted history already matches the cloud; clipping at every wind pixel blocked the detail).
- `sky-layer.ts`: new setting `temporalCloudMotion` (default true); tracks the previous wind offset, writes the displacement (cut or first frame: none). Old camera-only path kept (setting false, `cloudMotion.w = 0`).
- `procedural/index.ts` + `types.ts`: optional `motionSpeed` on the model = fraction of the wind offset the visible clouds follow (HZD: the weather-map speed `ndfDrift` (0.5 in drift mode); static map: mean of the shape and detail speeds; other shapers 1).
- Tune panel: `sky.temporalCloudMotion` in "Wind and motion" (doc is the interface comment). URL: `sky_temporalCloudMotion=false|true`.

## Bench URLs
- old: `http://localhost:5180/hzd/?motion=20&c_windVelocity=60,0,30&sky_temporalCloudMotion=false`
- new: `http://localhost:5180/hzd/?motion=20&c_windVelocity=60,0,30` (default on)

## Evidence
`work/captures/C2/mid_off_on_notemporal.png` (rows: camera-only, cloud motion, no temporal reference). Capture times cannot be aligned (dt is wall-clock), so the weather differs per row; compare character, not shapes. Camera-only: stretched streaks with Bayer stipple (the smear). Cloud motion on: no streaks or stipple, clean silhouettes. Remaining difference from the converged reference: softer and slightly stair-stepped at this speed (about 5 m/s x 20 time-lapse), from repeated bilinear history resampling and the 1/16 sampling; at the extreme 15 km/s test it was blockier. Not fixed here: a bicubic (Catmull-Rom) history fetch would be the next step. Owner to judge on the live bench.

## Cost
One extra mat4 projection per resolve pixel (resolve pass only, ALU), no new textures or passes. Not measured separately.

## Motion vectors for U1 (FSR3)
The resolve already computes `puv` (previous-frame uv of the pixel, camera plus cloud motion). The motion vector is `puv - uv` (uv units; multiply by render size for pixels). To expose it: add an `rg16float` storage output next to `histColorOut` in SKY_RESOLVE_WGSL and write `puv - uv` (zero where `valid` is false); for the output-resolution composite, upscale/dilate it by the cloud depth. Not built.
