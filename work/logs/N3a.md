# N3a — the authors' HaloRT network on our device, fed by our feature pass

Date 2026-11-24. Agent: Opus. Check: passed on the first picture (density scale set once, see below).

## What exists now

- `experiments/neural/halort-net.ts`: `HaloNet`. ONNX Runtime Web **1.30.0 from the CDN** (`ort.webgpu.min.mjs`, the same jsDelivr
  URL the authors' demo uses; no package added, nothing in `package.json` / lockfile). Same approach as their demo, own code:
  `ort.env.webgpu.device = device`, `InferenceSession.create(url, { executionProviders: [{ name: 'webgpu', device }],
  preferredOutputLocation: 'gpu-buffer' })`, fixed GPU buffers wrapped by `ort.Tensor.fromGpuBuffer`: `condition` [1,17,512,512],
  `light_intensity` [3], `environment_scale` [3] in, `radiance` [1,3,512,512] out. Per step: GPU copy `FeaturePass.packed` →
  input, write the two light feeds, `session.run`, add into an accumulation buffer. Display as the demo: `v * 2^EV / spp`,
  `1 - exp(-v)`, gamma 2.2, and turned back 180° (the buffer is in rdv pixel order). `common/ort_replay.js` not used.
- `ortDeviceRequest(adapter)`: the limits and features the demo asks for; the page merges them with `vdbLimits` (larger wins)
  so one device serves the feature pass and ORT.
- Lab page `examples/lab/neural/`: **neural view by default** (1024² on screen, from 512²); `feature panels` checkbox in the
  Review box brings back N2b's nine panels (`?view=features`). New sliders: sun intensity (EV, `light_intensity` = demo
  scene.json sun colour × 2^EV, default 2), sky intensity (EV, `environment_scale` = our `envScale` × 2^EV, default 0),
  exposure (EV, default 1). Query `?sun= ?sky= ?exposure= ?precision=fp32|fp16 ?spp=` (default 16 frames accumulated; each
  frame re-runs the features with new env samples). The Review box is `position: fixed` so it stays on screen.
  `report()` adds `neural: { spp, mean, max, nonFinite, frameIntervalMs }`; `busy()` holds a capture until 16 spp.
- Models are not committed. The page fetches `artifacts/research/neural/rdv_on_the_web/halort/halort_512[_fp16].onnx` through
  vite's existing `/@fs` + `server.fs.allow` for `artifacts/research` (`researchDirs()` in `vite.config.ts`, unchanged; the
  page's `researchUrl()` finds the main checkout from a worktree).

## Density units

Ours: grid = raw / p99 (`densityRef` 0.8955 for `wdas_cloud_eighth`). Theirs: raw × 200. So the neural view's default
`densityScale` is `200 × densityRef` = **179** (set after load unless `?scale=` is given; the feature view keeps 10). At 10 the
cloud looked thin and milky (sheet not kept); 100 and 180 both read like their demo; 179 is the unit-matched value.

## Check

`work/captures/N3a/sheet.jpg`: ours (left) beside the authors' demo at its defaults (right, `authors-demo.jpg`; their page
opened at 256 fp32, 64 frames). Ours: `view.jpg`, report in `capture.json`.

- White cloud, sun side (right / top right) brightest, creases and the lower left in blue-grey shade, soft glow through the
  thin edges. Not black, not blown out (mean radiance 0.44, max 1.10, 0 non-finite), no tile or block artefacts.
- Orientation right first time (180° turn as N2b wrote the packed buffer). Input 512, fixed model size.
- Differences, expected: our procedural sky and ground (warmer ground, horizon at mid-frame), our camera and sun.

Frame interval seen (headless Chrome, M5 Pro, fp32, plain `session.run`, no replay cache): **~180 ms** per accumulated
frame (features + network + accumulate). Model load ~0.85 s. No other timing done.

## How to run

    CLOUDS_NO_WATCH=1 npx vite --port <free port> --strictPort     # worktree root
    node scripts/gpu/capture.mjs --url http://localhost:<port>/neural/ --size 1024x1024 --settle 10 --timeout 120 --eval-timeout 90 --out work/captures/N3a
    # authors' demo, for the comparison:
    python3 -I -m http.server <port2> --bind 127.0.0.1 --directory <main checkout>/artifacts/research/neural/rdv_on_the_web &
    node scripts/gpu/capture.mjs --url http://127.0.0.1:<port2>/halort/index.html --no-contract --size 1100x900 --settle 240 --out <dir>

## Not done

- fp16 is wired (`?precision=fp16`, requests `shader-f16`) but not captured.
- No pixel jitter (N-F6), so accumulation only averages env-sample noise; edges stay aliased at 512².
- No timing work, no replay cache.
