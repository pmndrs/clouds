# N2b — second half of HaloRT's feature pass, and the packed ONNX input

Date 2026-11-24. Agent: Opus. Check: passed on the first picture.

## The authors' ONNX input (read from their web demo, `rdv_on_the_web/halort/index.html` + `features.js`)

- Feed `condition`: **float32, dims `[1, 17, H, W]`, NCHW planar**: channel `c` of pixel `p` at `c * H * W + p`, with
  `p = x + y * W` (the rdv kernel's `heap_store_f32(condition + ((c * plane) + pixel) * 4)`). H = W = 256 or 512
  (`halort_256*.onnx`, `halort_512*.onnx`; fp16 graphs still take float32 inputs).
- Channels 0–13 = `volume_deep_profile.h`'s output in its own order: `0 depth (log(1+0.2 t1))`, `1–3 crossing gaps^0.25`,
  `4 tr`, `5 g`, `6 nee (sun T)`, `7–9 env rgb`, `10–12 albedo feature rgb`, `13 S`.
  Channels 14–16 = background rgb: the (unit-mean) environment along the view ray (`forward_3(env, w)`).
- Other feeds: `light_intensity` float32 `[3]`, `environment_scale` float32 `[3]` (the `normalize_environment` scale).
  Fetch: `radiance` float32 `[1, 3, H, W]`, planar. The graph does the composite itself
  (`(direct * light + envScale * env) * S + background * envScale * (1 - S)`).
- **Row and column order:** rdv's camera has `xaxis = normalize(cross(up, forward))` (the camera's *left*) and
  `p = (id + jitter) / size * 2 - 1`, `w = xaxis * p.x + yaxis * p.y + forward * sz`. So pixel `(0, 0)` is the
  bottom-right of the view: the buffer read row-major with row 0 at the top is our image **turned 180°** (not mirrored).
  Our packed buffer is written in that order (`rdvPixel = (H-1-y) * W + (W-1-x)`) so the network sees the orientation it
  was trained on; turn the radiance back by 180° for display.
- The demo jitters the pixel position each frame (`jittered == 1`) and accumulates; one feature sample per frame.
- Demo scene defaults (`scene.json`): g 0.3, albedo 0.99, environment_samples 8, density_scale 200 (their volume).

## What exists now

- `experiments/neural/feature-pass.ts`: the pass now writes 24 floats per pixel (`FEATURE`: N2a's 12, then g, nee,
  env rgb, albedo rgb, background rgb) and a second buffer `packed` = the ONNX `condition` above (`PACKED_CHANNELS` maps
  the 17 channels to `FEATURE` offsets). `envScale` holds the per-channel environment scale for the composite.
  At x(t1) (`sample_index = 0`), with the production flags (depth encoding on, reduced transmittance on, similarity
  anisotropy off, scattering accumulation on):
  - g raw; albedo `sa ^ (2 tau (1 - sa g))` per channel (default 0.99 grey);
  - nee: transmittance toward `sunDirection` (toward the light, as the source's `light_direction`), no phase;
  - env: mean over N uniform sphere directions of `T * HG(dot(w, d), g) * L(d) * 4π`. HG includes `1/(4π)` and takes
    `cos = dot(view propagation w, d toward the light)`: checked in the demo's compiled `hg_phase_eval`. No extra 4π
    divide (the source's commented-out `* 4 * pi`).
  - No crossing: everything 0 except the albedo channels (1), S (written for every ray that enters the box) and the
    background. Matches `volume_deep_profile.h:69-75` and `:228`.
  - Procedural sky (`SKY`, `skyRaw`): zenith-to-horizon gradient above, flat ground below; normalised by the plain
    mean over equirect rows (as `normalize_environment` takes the pixel mean). Scale = (0.239, 0.316, 0.522).
  - Per-pixel, per-frame PCG hash (`frame` input, auto-increments per encode).
- `examples/lab/neural/`: 3 × 3 panels (N2a's six, then nee, env rgb as colour, albedo R), a Review box with sliders
  for sun azimuth / elevation, g, density scale, env samples (also `?sunAz= ?sunEl= ?g= ?env= ?scale=`).
  `report()` adds the new channels and `packed: { dims, maxDiffVsFeatures }` (packed vs per-pixel buffer through the
  180° map; 0 on the capture).

## Check

`work/captures/N2b/view.jpg` (all nine panels, report in `capture.json`) and `compare.jpg` (ours vs the authors'
`kloofendal` and `syferfontein` direct-light and environment pictures). Sun az 120°, el 30° (from the right of the view).

- nee: lit on the right (sun side), falling into shadow on the left and in the creases; same look as theirs.
- env: grainy at 8 samples, blue-grey from the sky, as theirs; ours shows a warm base from the ground (our ground is
  brighter relative to the sky than their HDRs). Mean env 0.38 per channel over covered pixels.
- albedo: 0.90..1.0 at albedo 0.99, white outside (the no-crossing default).

## Skipped / divergences

- N-F4 (intended): sun and environment shadow rays are a fixed-step march to the box exit, not ratio tracking.
- N-F5 (open): uniform sphere sampling of a procedural sky, not luminance importance sampling of an HDR map.
- N-F6 (open): no pixel jitter.
- No timing, no tuning, no empty-space skipping. The ONNX model is not run.
- `pnpm typecheck`: only the two known `packages/runtime/src/upscale.ts` errors.
