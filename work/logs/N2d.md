# N2d — our features beside the HaloRT authors' (parity sheet)

Date 2026-11-24. Agent: Sonnet. Sheet: `work/captures/N2d/parity.jpg` (rows = features, left theirs, right ours, same grey mapping per row, mean / p99 printed on each panel).

## Settings matched
Theirs: `halort/index.html` defaults at 512²: camera alpha 0, beta 0.3, distance 2.7 (origin 0, 0.80, 2.58), fov 45, sun (-1.2, 0.5) rad = az -68.75, el 28.65 deg, density 200, g 0.3, albedo 0.99, 8 env samples.
Ours: `/neural/?view=features&scale=179&yaw=0&pitch=0.3&dist=2.7&fov=45&sunAz=-68.75&sunEl=28.65&g=0.3&env=8` (new query settings `yaw pitch dist fov` in `examples/lab/neural/main.ts`, plus `window.__neuralPacked(channels)`).
Not matched: cloud (their Disney 2x downsample vs our `wdas_cloud_eighth`), our fov is assumed vertical like theirs (not checked in the kernel), environment sky, their pixel jitter (one jittered sample vs our centre sample), step size (ours 0.004).

## How to repeat
1. Theirs: copy `halort/index.html` into a scratch folder (symlink `common/`, `halort/features.js`, `scene.json`), make the copy select 512 by default, stub out `ort.InferenceSession.create` (the ORT model load hangs headless here and is not needed), and add `window.__rdvFeatures(channels)`: copy `features.region('condition')` to a MAP_READ buffer, return base64. Serve with `python3 -I -m http.server`. Read channels 0..13 one evaluate at a time (a single 20 MB return timed out over CDP). Buffer is in rdv order (our image turned 180 deg).
2. Ours: `window.__neuralPacked([0..13])` on the URL above, same order.
3. `python3 -I scripts/neural/parity-sheet.py theirs.f32 ours.f32 work/captures/N2d/parity.jpg` (turns both by 180 deg).
Gotcha: the authors' page idles on `requestAnimationFrame`, which never fires in headless Chrome, so changing sliders after load does nothing; set defaults in the copy instead.

## Verdicts
- tr: same (mean 0.290 vs 0.283).
- S: same (0.314 vs 0.305).
- depth: same (0.130 vs 0.128), same cell pattern.
- crossings 2, 3, 4: same (0.107/0.124/0.110 vs 0.102/0.118/0.105), same ridge lines.
- nee: same (0.158 vs 0.159), same lit and shadowed lobes.
- albedo feature: same (0.931 vs 0.933).
- environment: same shape, different colour/level: ours bluer and p99 0.83 vs 0.74 (about 10 percent), as expected from our own sky; both grainy at 8 samples.
Means differ by 2-5 percent on the cloud rows from the different voxel resolution and edge sampling; nothing visible.
