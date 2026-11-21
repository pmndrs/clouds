# P0.4: the scene card (5 densities x 4 suns, linear radiance)
Status: **4 of 5 clouds complete; the Disney cloud has realtime, alpha and rtalpha frames but no path trace** (it does not fit the 5-minute render cap, below). Branch `worktree-agent-aa708b160547fc3f4`. No default, lighting or shape setting changed. Page: `examples/lab/reference-pt/?cloud=<key>` (cloud select and all 20 renderer x sun buttons on the panel). Data: `work/captures/card/` (`manifest.json`, `scorecard.md`, `rt-noise.md`, `<cloud>/contact.jpg`; floats and PNGs git-ignored).

## Clouds (one field reaches both sides; alpha Δ = mean |alpha - rtalpha| where either > 0.02, four suns)
| key | source | world size, voxel | sigma_t | PT side | runtime side | alpha Δ |
|---|---|---|---|---|---|---|
| A parkouring | Nubis pack NVDF | 864 x 408 x 864 m, bake 2 m | densityScale | bake of the up-rezzed density per camera (PT1) | NVDF + up-rez, default material | 0.0054-0.0066 |
| B embergen02 | CloudPack 02 .vdb, Z-up | 1344 x 720 x 1936 m, 4 m (336x484x180) | 0.6 x density /m | the runtime's r16f texels | direct volume (no up-rez) | 0.0012-0.0015 |
| C wdas | Disney 1/8 .vdb | 1518 x 1050 x 1848 m, 6 m (253x308x175) | 0.6 x density /m | same | direct volume | 0.0018-0.0023 |
| D sky | HZD bench sky, seed 3, wind 0: x 3-6 km, z -8.8 to -5.8 km | 3000 x 1600 x 3000 m, 8 m | procSample sigma | same | direct volume | 0.0031-0.0063 |
| E stratus | HZD deck slot 'stratus', main layer off | 3000 x 280 x 3000 m, 8 m | procSample sigma | same | direct volume | 0.0008-0.0009 |

- B and C: `vdb-direct.ts` resamples the VDB onto the runtime lattice (1 tap per texel at native voxel); `direct.ts` packs that field once (r16f density / p99 densityRef) and hands the PT the same texels decoded, with sigma_t = directDensity x densityRef. Both sides are trilinear on the same lattice. No up-rez on the direct route, so nothing had to be switched off.
- D and E (procedural, `proc-bake.ts`): I baked the patch and render it through the same direct route, **not** the trace with `boxCarve`. Reason: it is identical by construction. The procedural trace is amortised (1/16 pixels per frame, sky-layer resolution, history), so its alpha cannot be pinned to a grid. The cost of that choice: the card measures the voxel march's lighting on the baked field, not the procedural trace's lighting (the same LIGHTING_WGSL models, but with proxies for depth and profile).
- D window: 2 % of its edge columns are above optical depth 1 (50 m scan), so its border cuts almost no cloud. Two main masses, bases about 1675 m, tops about 2525 m. Bake resolution, measured on one body from the card camera (pixel about 5 m): |Δα| against a 4 m bake is 0.020 at 16 m and **0.006 at 8 m**, with edge detail RMS -9 % at 8 m. 8 m keeps the visible structure and fits the memory cap (112 MB grid); 4 m for the whole patch would be about 900 MB. E is smooth: 8 m against 2 m gives 0.0019.
- E window: the deck breaking up (column optical depth median 0.9, 35 % of columns below 0.1). Camera 100 m up, 1200 m from the centre (under the slab), looking up at about 28 degrees.
- Framing: ring radii put the cloud at 44-54 % of the frame width (A 53 %, B 44-54 %, C 45 %, D measured 70-79 % at 4800 m, so I moved it out to 6800 m). Largest grid: B, 117 MB.

## Suns (lat 40, @pmndrs/sky's default day; camera ring angle from the sun's azimuth, 0 = sun behind the camera)
noon 13 h (el 69.3) ring 70; low 17.6 h (19.5) ring 70; backlit 17.6 h ring 140; **sunset 18.949 h (el 5.000, az 296.6, solved by bisection on `solarPosition`) ring 120: side and back lit.**

## Re-run
```
node node_modules/.bin/vite --port 5391 &        # or pass --url of any dev server
node scripts/gpu/capture.mjs --url "http://127.0.0.1:5391/reference-pt/?clean=1&cloud=sky&spp=1024&seed=1" --size 1280x720 --format png --linear --out /tmp/one --shots pt-noon,nubis-noon,octave-noon,alpha-noon,rtalpha-noon
node scripts/gpu/card.mjs --url http://127.0.0.1:5391 --spp 2048 --spp-embergen02 1024 --spp-sky 1024 --spp-wdas 1024    # whole card + manifest
node scripts/gpu/card.mjs --url ... --clouds parkouring,embergen02 --rerun nubis-noon,octave-noon,...  # step 0.1 rerun
python3 scripts/gpu/scorecard.py --gate work/captures/card ; python3 scripts/gpu/scorecard.py --rt-noise work/captures/card ; python3 scripts/gpu/scorecard.py --selftest
```

## Samples, wall time, caps
- spp per seed (two seeds each, averaged): **A and E 2048; B and D 1024**. Measured on this shared GPU at 1280x720, the PT cost per pass was A 0.03 s, E 0.12-0.22 s, B 0.16-0.32 s, D 0.24-0.29 s, C 0.65 s. At 2048, B and D would take 5.5-11 min per render, over the ~5 min per frame in the brief, so I used 1024. C would take about 11 min even at 1024. Under the owner's later 5-minute render cap I left C's path traces out. Its realtime and mask frames are on the card.
- One E render ran before the cap existed and took 458 s (stratus pt-backlit, seed 1). The rest were 160-330 s (A 51-110 s).
- Wall time 2 h 05 min: A 14 min, E 40, B 33, D 36, C 0.6 (no PT), reruns 0.7. The path tracer is almost all of it.
- **The card does not re-run in 15 min.** At these costs, 15 min allows about 64 spp per seed at full resolution for all five clouds. At half PT resolution (`ptScale=0.5`, about 4x faster) it allows about 256 per seed, or about 500 without C. Fewer than 2048 spp raises the grain (below). The bands are in pixels, so at half resolution their scales would need halving too. The real fix is in the path tracer: a variance or denoised output, and cheaper deep multiple scattering.

## Noise floors
- **Reference grain** (averaged reference; grain = band energy of half the seed difference / the frame's band energy). 4-16 px: A 0.38-0.72, B 0.42-0.64, D 0.18-0.27, E 0.77-0.80. Lit 4-16: A 0.27-0.65, B 0.30-0.57, D 0.16-0.23. 16-64 px is under 0.1 everywhere. **E's fine band is grain**: its field is smooth, so E's 4-16 ratios (0.05-0.26) are not measurements. Every other measure's floor is ±0.002 or less, except dark20 (±0.01-0.04).
- **Realtime run-to-run** (fresh browser session, A and B x 4 suns x both models, `rt-noise.md`): A has 4-16 and lit 4-16 up to ±0.007, all others ±0.002 or less. B is ±0.0008 or less for every measure. Per-pixel mean |ΔL|/L: A 0.1-0.8 %, B 0.01-0.08 %. Stage-1 check: on a fresh Parkouring run, the PT and alpha frames were bit-identical to P0-3b and the runtime ones differed by this same jitter (scorecard within 0.02).

## Scorecard (ours / PT; n = Nubis, o = octave; full table with every measure and noise row in `work/captures/card/scorecard.md`)
| cloud sun | α Δ | cloud L n/o | thick L n/o | fringe B/R n/o (PT) | dark20 B/R n/o (PT) | lit 4-16 corr n/o | 16-64 n/o |
|---|---|---|---|---|---|---|---|
| parkouring noon | 0.0057 | 1.26/0.90 | 1.12/0.79 | 1.93/1.86 (2.85) | 1.57/1.13 (1.64) | 3.94/1.94 | 2.27/1.54 |
| parkouring low | 0.0055 | 0.97/0.95 | 0.85/0.85 | 2.35/2.02 (3.19) | 2.73/1.18 (1.97) | 4.58/2.75 | 1.89/1.78 |
| parkouring backlit | 0.0054 | 0.70/0.40 | 0.62/0.33 | 1.39/1.45 (1.37) | 2.81/1.28 (1.46) | 1.24/1.19 | 0.91/0.92 |
| parkouring sunset | 0.0066 | 0.68/0.30 | 0.59/0.24 | 1.34/1.42 (1.35) | 1.88/1.38 (1.01) | 1.77/2.72 | 0.99/1.46 |
| embergen02 noon | 0.0015 | 0.64/0.66 | 0.60/0.61 | 2.09/2.17 (2.75) | 0.99/1.07 (1.17) | 2.13/2.80 | 1.53/2.16 |
| embergen02 low | 0.0015 | 0.66/0.80 | 0.64/0.77 | 2.04/1.98 (2.79) | 0.78/0.88 (1.26) | 2.22/3.25 | 1.68/2.58 |
| embergen02 backlit | 0.0014 | 0.43/0.40 | 0.41/0.37 | 1.49/1.56 (1.46) | 0.80/1.03 (1.28) | 1.10/1.43 | 0.87/1.20 |
| embergen02 sunset | 0.0012 | 0.42/0.27 | 0.40/0.25 | 1.08/1.38 (1.26) | 0.40/1.05 (0.92) | 1.61/2.29 | 1.25/1.93 |
| sky noon | 0.0038 | 0.63/0.58 | 0.60/0.56 | 2.17/2.76 (2.96) | 0.95/1.16 (1.05) | 1.08/1.63 | 1.02/1.28 |
| sky low | 0.0031 | 0.62/0.62 | 0.59/0.60 | 1.93/2.44 (2.76) | 0.80/1.19 (0.92) | 1.02/1.83 | 0.98/1.33 |
| sky backlit | 0.0063 | 0.46/0.33 | 0.47/0.30 | 1.76/2.20 (1.62) | 0.86/1.70 (0.96) | 0.77/1.13 | 0.88/1.14 |
| sky sunset | 0.0033 | 0.52/0.23 | 0.50/0.19 | 1.28/1.76 (1.37) | 0.44/1.66 (0.67) | 0.86/1.33 | 0.65/0.87 |
| stratus noon | 0.0008 | 0.66/0.65 | 0.44/0.44 | 1.47/1.60 (2.28) | 1.01/1.01 (1.47) | (grain) | 1.30/1.55 |
| stratus low | 0.0008 | 0.92/0.76 | 0.70/0.50 | 1.51/1.54 (2.70) | 0.85/0.90 (1.46) | (grain) | 1.28/1.78 |
| stratus backlit | 0.0008 | 0.50/0.40 | 0.50/0.33 | 1.11/1.25 (1.04) | 0.73/0.83 (0.90) | (grain) | 0.52/0.78 |
| stratus sunset | 0.0009 | 0.74/0.24 | 0.82/0.15 | 1.34/1.94 (1.75) | 0.40/1.68 (1.03) | (grain) | 0.43/0.91 |

**True on every cloud:** clear sky matches within 0.2 %, so units agree. Backlit and sunset bodies are darker than the PT, and octave much more so: thick body at sunset is 0.15-0.25 for octave and 0.40-0.82 for Nubis. At noon and low sun, fringe B/R is below the PT for both models (fringes less blue than the PT).
**Only some:** the direct-route clouds B, D and E (M1 material) are **0.4-0.6x the PT in the thick body even at noon**, for both models; Parkouring (default material) is 0.79-1.12. Lit-face fine texture is too strong on A (Nubis 3.9-4.6x after grain correction) and B (2.1-3.3x), but about right on D for Nubis (1.0-1.1x; the 8 m bake has no grain finer than that, and the direct route adds none), with octave above on D (1.6-1.8x). Sunset shade (dark20 B/R, higher is bluer): Nubis is too brown on B, D and E (0.40-0.44 against 0.67-1.03) but too blue on A (1.88 against 1.01). Octave is too blue on D and E (1.66-1.68).

## Where the two sides are NOT guaranteed identical
1. **A**: the PT reads a 2 m bake of the up-rezzed density at voxel-centre distances. The runtime evaluates it per sample, with its own mip and hf distance. Alpha Δ 0.006.
2. **Direct clouds**: GPU hardware trilinear filtering (reduced-precision weights) against the PT's f32 trilinear. The march's stepping (SDF skips, sparse and dense step widening, jitter, transmittance cutoff) against delta tracking. Alpha Δ 0.001-0.006.
3. **Lighting inputs, not density**: the light grid and shadow map read NVDF R = min(density/p99, 1) in 8 bits (1/255 floor), so sun optical depth saturates in the densest 1 % and is coarse in thin fringes. The runtime has albedo 1 and its own phase function; the PT has albedo 0.99 and one HG g = 0.8. PT maxDepth is 512 (0.99^512 = 0.6 % energy cut).
4. **Sky**: the PT gets a 512x256 equirect of the sky-view LUT plus a delta sun at the cloud centre. The runtime takes the sun at each sample's height and the hemisphere means. No ground on either side. Aerial perspective and haze are off on both.
5. **Material per cloud** (agent-chosen, flag for the owner): direct volumes get `setVolume`'s default `DIRECT_VOLUME_SETTINGS` (M1), as vdb-sky does; A keeps the default material. This is the likely cause of the 0.4-0.6x.
6. **D and E bakes**: t is fixed at the ring distance and the footprint at the voxel size, and the curvature reference is the patch centre. The procedural trace varies these per sample and camera, and fades past 96 km. E's camera is 500 m from the deck, where the trace would add N1 hhf detail (< 900 m) that the bake leaves out. Neither is the procedural trace itself.

## Requests for the pathtracer repo
- Unchanged from P0.3: a per-pixel second moment or a denoised output. One more: thick clouds cost 5-20x Parkouring per pass (deep multiple scattering), so the card needs either a faster path for many bounces or a convergence estimate to stop early.
