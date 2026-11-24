# N3b: path trace | neural | our raymarch, one cloud, two suns

Date 2026-11-24. Agent: Opus. All three columns rendered on the first try. Sheet `work/captures/N3b/sheet.jpg`.

## What ran

| column | page | settings | cost at 512² (M5 Pro, headless Chrome) |
|---|---|---|---|
| Path trace | `/reference-pt/?cloud=wdas&view=pt-<sun>` | pmndrs pathtracer, delta tracking (brick majorant), 1024 spp, depth 512, albedo 0.99, HG g 0.8 | noon **130 s** (127 ms/spp), low **184 s** (179 ms/spp) |
| Neural | `/neural/?net=engine&precision=fp16` | HaloRT on our WGSL engine, fp16, g 0.8, 16 frames averaged (env-sample noise) | **33.0 / 33.1 ms per frame** (features + network + blend + accumulate, `__neuralTiming(20)` median); the picture is 16 frames, so ~530 ms of work |
| Our raymarch | `/reference-pt/?cloud=wdas&view=nubis-<sun>&quality=high` | the runtime as shipped for a direct volume: quality `high` (vdb-sky's and the library's default), `nubis` lighting, material auto (DIRECT_VOLUME_SETTINGS), settled 90 frames (temporal) | **1.0 / 0.9 ms per frame** (`runtimeTiming(30)` median: `runtime.encode` → `onSubmittedWorkDone`; the three.js sky draw is not in it) |

Suns are reference-pt's existing `noon` (elevation 69.3°, azimuth 221.2) and `low` (19.5°, 284.7), not 60° / 15°: they were already
wired to the camera ring and sky bake, and "about" was close enough. Camera ring 70° from the sun azimuth, 3400 m out, 150 m up, fov 30.

## Matching

- **Cloud and extinction.** `/neural/` uses densityScale 179 over its [-1, 1] box: σ = 179 × raw / 0.8955 = 199.9 × raw per box unit.
  Its box's longest axis is the lattice row (311 native voxels of 1.6667 VDB units incl. 2-voxel margins), so 1 unit = 259.2 VDB units
  = 911.7 m at reference-pt's world scale (3.5179 m per VDB unit, the cloud 1800 m wide). That is σ = 0.2193 × raw per metre. reference-pt's
  card is 0.6 × raw per metre, so `extScale=0.3654` (PT) and `s.directDensity=0.21925` (runtime). Both read raw VDB values (each
  normalises by its own p99 and multiplies it back).
- **Camera and sun.** Same axes on both pages (lattice x, row = +z, up = +y; box centred). The neural orbit was computed from the reference
  camera relative to the lattice centre (0, 1425, 0) m: noon yaw 0.5028, pitch −0.3592, dist 3.979; low yaw −0.6074, pitch −0.3588,
  dist 3.982; fov 30. The neural camera looks at the lattice centre, reference-pt at the occupied-box centre (3 m away): framing matches by eye.
  Sun direction copied: noon `sunAz=-41.17 sunEl=69.34`, low `sunAz=-104.73 sunEl=19.48`.
- **Medium.** Albedo 0.99 on all. HG g 0.8 for the path trace and the neural page (the network takes g as an input; the authors' demo
  default is 0.3). The raymarch keeps its shipped phase model (phaseG 0.2 + silver lobe 0.85 × 0.4, multiple-scattering octaves).
- **Exposure.** All three read back as linear radiance and tone mapped by one script (`make_sheet.py`: three.js ACES, exposure 0.35, sRGB).
  The neural radiance is multiplied by the ratio of sun luminances (reference sky bake's sun irradiance over the neural page's
  light_intensity): ×21.3 noon, ×17.7 low. The neural sky EV was set so its upper-hemisphere mean / sun luminance equals the reference
  sky's `ambientUp` / sun: `sky=-3.62` noon, `-3.76` low (a linear scale of the environment term, not a network input).

## Not matched

- The neural sky is its own gradient (bluer-grey, with a flat ground below the horizon that shows in the lower half); the reference pages
  use the pmndrs physical sky. Only its sky-to-sun luminance ratio was matched.
- The neural sun is a fixed warm-white colour; the reference sun is physically coloured (yellow-orange at 19.5°). So the neural low-sun
  cloud is neutral white where the other two are warm. Colour difference there is an input difference, not the network.
- The neural page has no pixel jitter (aliased silhouettes); 16 frames averaged. The path trace is visibly grainy at 1024 spp (worst in
  the shadowed underside). The raymarch is temporal and settled.
- Timing methods differ by necessity: the PT is total wall time; neural and raymarch are wall time per frame encode → done, median.

## What the sheet shows

Region means of linear luminance after the sun normalisation (noon: top lit puffs / mid body / underside; low: upper-left lit side / mid
body / underside). Numbers only point where to look.

| | PT | neural | raymarch |
|---|---|---|---|
| noon lit top | 3.38 | 3.75 (+11 %) | 1.83 (−46 %) |
| noon mid body | 2.34 | 2.11 (−10 %) | 1.47 (−37 %) |
| noon underside | 0.98 | 0.74 (−25 %) | 0.59 (−40 %) |
| low lit side | 3.80 | 4.11 (+8 %) | 1.65 (−57 %) |
| low mid body | 1.89 | 2.36 (+25 %) | 1.08 (−43 %) |
| low underside | 1.02 | 1.23 (+20 %) | 0.63 (−38 %) |

By eye:

- **Noon.** Path trace: bright white body, crisp lit puffs on top, a light grey underside, heavy grain. Neural: closest to it in brightness
  and in the lit/shade balance; smoother and softer than the PT (puff edges and inner creases blurred, less detail inside the body), the
  underside a little darker and more uniform. Raymarch: the whole cloud is grey, lit faces about half the PT's brightness; the most
  detail and the crispest puffs and silhouette of the three, with strong dark creases between puffs that the PT does not show as dark.
- **Low sun.** Path trace: warm lit upper-left, a dark brown-grey underside that reads as a clear shadow band. Neural: lit side right,
  but the body and the underside are too bright: the shadow band is a mid grey, much shallower than the PT's; neutral white (sun colour
  not matched). Raymarch: warm, like the PT; the dark underside band reads as deep as or deeper than the PT's, so **the shadow shape and
  depth are closer to the PT in the raymarch than in the neural picture**; but its lit faces are again far too dark (−57 %) and grey,
  and its crease contrast is higher than the PT's.
- The path trace looks plausible, not wrong: noise aside, its shape and shading are what the other two are being compared to. Its grain at
  1024 spp makes fine-detail comparison (crispness) uncertain.

Summary: in brightness of lit faces and overall tone the neural picture is closer to the path trace at both suns; in the low-sun shadow
depth and in colour the raymarch is closer; the raymarch is sharper and more detailed than both, the neural picture softer than the PT.
Cost: raymarch ~1 ms, neural ~33 ms per frame (×16 frames for the picture shown), path trace 2–3 minutes.

## How to run

    CLOUDS_NO_WATCH=1 npx vite --port <free port> --strictPort      # worktree root
    Q='cloud=wdas&quality=high&g=0.8&extScale=0.3654&s.directDensity=0.21925&spp=1024'
    node scripts/gpu/capture.mjs --url "http://localhost:<port>/reference-pt/?clean=1&$Q&view=nubis-noon" --size 512x512 --settle 90 \
      --format png --shots nubis-noon --linear --evals <[{"name":"timing","expr":"window.__clouds.runtimeTiming(30)"}]> --out <dir>/rm-noon
    node scripts/gpu/capture.mjs --url "http://localhost:<port>/reference-pt/?clean=1&$Q&view=pt-noon" --size 512x512 --settle 2 \
      --eval-timeout 295 --format png --shots pt-noon --linear --out <dir>/pt-noon
    node scripts/gpu/capture.mjs --url "http://localhost:<port>/neural/?net=engine&precision=fp16&g=0.8&fov=30&yaw=0.50285&pitch=-0.35917&dist=3.97859&sunAz=-41.174&sunEl=69.342&sky=-3.6182" \
      --size 1024x1024 --settle 10 --evals <__neuralRadiance(), __neuralRadianceChunk(0..3), __neuralTiming(20)> --out <dir>/nn-noon
    python3 -I work/captures/N3b/make_sheet.py <dir> work/captures/N3b/sheet.jpg
    # low: view=*-low; neural yaw=-0.60740 pitch=-0.35884 dist=3.98200 sunAz=-104.729 sunEl=19.481 sky=-3.7565

Run reports (camera, sun, sky bake, PT samples and wall time, timings) are in `work/captures/N3b/{pt,rm,nn}-{noon,low}/`. The PFMs and
neural readbacks were left in the scratchpad (3–4 MB each).

## Changes

- `examples/lab/reference-pt/main.ts`: `window.__clouds.runtimeTiming(runs)` (measurement only; holds the frame loop's runtime encode while
  it runs). `fb1b839`.
- Worktree setup, not committed: this worktree's `node_modules` was stale (`@clouds/runtime` could not resolve `@pmndrs/upscaler/core`, so
  `/reference-pt/` did not load). `pnpm install --frozen-lockfile --offline --force` relinked it from the local store (no downloads).
