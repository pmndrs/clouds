# U2: render levels, with the upscaler as the cloud output path

Branch `worktree-agent-a5f201ecff482fd53`. Review switch **U2** (cinematic / desktop / laptop), tune-panel group "Render level (upscaler)", URL `?level=desktop`.

(numbers and verdict: see the sections below; draft in progress)

## What landed

- `CloudSettings.renderLevel`: `'cinematic'` (default) is the old path, untouched. `'desktop'` renders the sky layer (in `'procedural'` mode it is the whole cloud) at `levelScaleDesktop` 0.5 of the output, `'laptop'` at `levelScaleLaptop` 0.25 (1/3 is one slider away). `@pmndrs/upscaler`'s raw-WebGPU core (`packages/runtime/src/upscale.ts`) brings it to the output size and the composite merges it over the scene at full size.
- The upscaler's inputs, written by one small render pass at the internal size:
  - colour: the layer's front and back parts merged (premultiplied radiance, a = transmittance), times `upscaleColorScale` (1/64, see "Dark rims").
  - depth (`depth32float`, `frag_depth`): the opacity-weighted mean cloud distance (the layer's C2 depth word), as a standard perspective depth with the module's own near/far (1 m / 400 km); the far plane where the ray saw no cloud.
  - velocity: NDC current minus previous of that point, with the clouds' own wind displacement since the last frame (the same displacement C2's resolve follows; the sky layer now reports it in `lastEncode`). Clear sky moves with the camera only.
  - No jitter (`jitter: false`): the layer's output is its own temporally resolved history (16-frame amortisation), not a fresh render under this frame's offset.
- Composite: `frame.skyEnabled > 1.5` reads the upscaled colour per output pixel; the scene occlusion still comes from the layer's own depth words (the C2 in-front share, bilinear over the four nearest layer texels, empty taps excluded), so terrain cuts clouds at full resolution.
- Bench: Review switch **U2**, tune group "Render level (upscaler)" (level, both scales, path, sharpness, colour scale, fixed exposure, depth mode), `?level=` for captures, the HUD shows the level and the upscale time. `window.__hzd.bench` for scripted camera motion.
- The upscaler is the owner's local build (`/Users/dex/Developer/upscaler` at f38e9ac), vendored as `vendor/pmndrs-upscaler-0.5.0-f38e9ac.tgz` and a dependency of `@clouds/runtime`: the published 0.5.0 on npm has no `./core` entry.

## Findings on the way

### Dark rims and stair-stepped edges (fixed)
The first desktop renders had hard, 2-pixel stair-stepped cloud silhouettes with a dark rim, worst on the small distant clouds (sheet `work/captures/U2/dev/exposure-crops.png`).
Cause: the upscaler conditions colour with an invertible tonemap `x / (1 + x)` after multiplying by its exposure. Its auto exposure meters the frame, and the cloud colour is premultiplied and mostly black (clear sky is 0), so it sits at its 8x cap. At that exposure the cloud's radiance lands on the flat part of the curve: interpolating across an edge in that space darkens the in-between colour against the linearly interpolated transmittance (the rim), and steepens the edge (the steps).
- A fixed exposure of 0.05-0.2 removed both (0.01 printed bright 2x2 dots, too little conditioning).
- But the upscaler's fixed-exposure mode (`autoExposure: false`, and also its `exposureTexture` input) was the setting in place in every early device loss below, so the default now keeps its auto exposure and scales the colour by 1/64 on the way in (`upscaleColorScale`), undone in the composite: the auto exposure still tops out at 8x, so the effective conditioning is 1/8. Same clean edges.

### The sky layer's own history: kept (agent's call)
Tested at desktop on the `above` view (the worst case for surface texture), 1080p, crops `work/captures/U2/dev/sky-history-crops.jpg`:
- **Off** (`sky.temporal` false, every layer pixel traced every frame): much worse, and about 16x the trace cost. The trace's per-pixel jitter only changes once per 16-frame cycle, so the upscaler (no jitter, see above) has nothing to average: the lit tops turn into a coarse blocky noise.
- **Reduced** (`sky.temporalBlend` 0.6 instead of 0.3): worse. A stronger 4x4 hatch (the amortisation's one-pixel-per-block pattern) shows through the upscale.
- **Lower** (0.15): calmer than 0.3, but softer.
- **Kept** (0.3, the default): the choice. The upscaler then mostly does the spatial upsample, its own reprojection and RCAS sharpening; it cannot add detail without jitter.

### Device loss when the upscaler starts (open)
On this machine (shared with several other agents' headless Chromes; load average 20-280, swap nearly full) the bench lost its WebGPU device ("Metal command buffer failed: Insufficient Memory, kIOGPUCommandBufferCallbackErrorOutOfMemory") within 1-5 frames of the upscaler's first dispatch in roughly half of the desktop/laptop runs. Runs that got past those frames never failed (1000-2700 frames). Cinematic never lost the device (8 runs), nor did the old path at a 0.5 layer (3 runs).
- Ruled out, one at a time (`work/reports` notes from the bisect): the timer span, the prep render pass, the upscaler's passes themselves (a run that created and compiled it but never dispatched also failed), its shading-change detector, NaN/Inf inputs (now guarded), fixed vs auto exposure (both failed), the start frame (1, 200, 554 failed; 647 and 974 did not, too few to call).
- With Chrome's frame limit and vsync off (`--disable-frame-rate-limit --disable-gpu-vsync`, as `bench-sweep.mjs` runs) desktop lost the device 4 times in 4, cinematic 0 in 2; so the timing sweep script cannot measure the levels and the numbers below come from capped pages.
- The upscaler alone in a bare page (same sizes, zero or synthetic inputs, fixed and auto exposure) ran 900-2700 frames without a loss, 4 of 4.
- Likely environmental (memory pressure while new GPU memory is first touched), but not proven. **Owner check: switch the bench's U2 to desktop on your machine with nothing else running; if it survives the first second it should stay up.** If it also dies there, the next step is a Chrome trace of the GPU process.

## What the sheet shows (by eye)
Sheet: `work/captures/U2/U2-sheet.jpg` (cinematic | desktop | laptop; full frames, then 1:1 crops shown at 2x: lit ridges, soft bases, distant clouds). Laptop 1/4 against 1/3: `U2-sheet-laptop-quarter-vs-third.jpg` (gp7). Captures `work/captures/U2/<level>/` at 1920x1080, settle 400, `clean=1` added so the UI is hidden. The levels were captured minutes apart with the clouds moving, so shapes differ slightly; compare texture and edges, not positions.
- **Desktop is worse than cinematic, but close at full-frame size.** Full frames read the same. At 1:1: lit ridges are a little softer and the finest 1-2 px billow grain is gone; a faint regular **4x4 hatch** (the sky layer's one-pixel-per-block amortisation, now at half resolution and sharpened) shows on lit and shaded surfaces, strongest from `above` (looking down onto the tops). Soft bases and distant clouds hold up well. Sunset rims are slightly softer. No dark rims, no stair steps (after the colour-scale fix), the terrain still cuts the clouds at full resolution.
- **Laptop 1/4 is clearly soft.** Lit ridges go mushy, which breaks the owner rule (lit ridges crisp). 1/3 is noticeably better than 1/4 and still soft next to desktop. If laptop has to stay near 3 ms, 1/3 is the better trade; I kept 1/4 as the default only because the compass says 1/4 (agent-chosen, flagged).
- Sharpness 0 vs 0.5 (agent default 0.5): 0 is a little calmer on the hatch, 0.5 a little crisper on ridges. Spatial (FSR1) path: crisper edges than temporal but rings on the billows; bilinear path: close to temporal. Without jitter the temporal path adds little over bilinear in stills: the gain it can give needs the layer to render under the upscaler's jitter (see open problems).

## GPU time per level
HZD bench, ultra, 1280x720, one fresh page per (level, view), 900 frames settle, then 300 frames; the page's own GPU timer (median of the samples). The machine was shared and loaded (load average 40-80) and the same cinematic page measured 26-33 ms on gp7 between two runs, so read these as ratios, not absolutes. Raw: `work/captures/U2/timing-720p.jsonl`.

| level | sky layer (trace) gp7 / above | upscaler (isolated, see below) | vs cinematic |
|---|---|---|---|
| cinematic (layer 0.75, bilinear) | 33.1 / 37.6 ms (26.1 / 33.2 in a quieter run) | none | 1 |
| desktop (0.5) | 17.9 / 19.9 ms | 0.6 ms | about 0.55 |
| laptop 1/3 | 9.0 / 12.3 ms | 0.67 ms | about 0.3 |
| laptop 1/4 | 6.1 / 8.0 ms | 0.62 ms | about 0.2 |

- The resolve and composite stay under 0.3 ms at every level.
- The upscaler's own cost, measured in isolation with its `gpuTiming` (same sizes, `dispatch` form, scratch page): 0.61 ms for 640x360 to 1280x720, 0.62 ms from 320x180, 0.67 ms from 427x240, 1.31 ms for 960x540 to 1920x1080; the bilinear path 0.09 ms. The in-page `upscale` span (two empty timestamped compute passes around it) read 0.1-3 ms and is not reliable on Metal.
- **None of the levels is near the compass targets** (desktop 4 ms, laptop 3 ms): the 2.5D trace itself is the cost, and it scales with less than the pixel count (desktop traces 44 % of cinematic's rays for 55-60 % of its time). The levels are the output path the performance pass (amortised lighting, shaping, LOD) now plugs into; they do not buy the budget by themselves.
