# P0.3: linear compare and scorecard
Status: gate **passed**. Branch `worktree-agent-a0b4e94456d5e70a9`. No look, lighting, shape or default changed.

## What was built
- **Linear readback** on `examples/lab/reference-pt/`: `window.__clouds.readLinear()` reads the current view as float32 RGBA. Fetch the floats with `linearChunk(offset, bytes)`.
  - `pt-*`: accumulator / samples.
  - `nubis-*`, `octave-*`: the scene's HDR target × transmittance + cloud. This is the bridge's composite before exposure and ACES (`linear.ts`).
  - `alpha-*`: the bake opacity. `rtalpha-*`: 1 − the march's transmittance.
  - `?seed=` sets the path tracer's sampler seed. `three-bridge.ts` now exposes `sceneTarget` (additive). `packages/runtime` is untouched: `runtime.output` was already public.
- **Units check: no factor.** On clear-sky pixels the runtime matches the PT to within 0.05 % per channel, at all three suns (p5–p95 of the per-pixel ratio: 0.999–1.000). The PFMs, put through the page's ACES in Python, reproduce the PNG screenshots: PT within 1/255. Runtime frames are off by a mean 0.4/255, from per-frame jitter between the screenshot and the readback.
- **`capture.mjs --linear`** writes `<shot>.pfm` next to each screenshot. RGB frames are `PF`; masks are one-channel `Pf`. The data comes over CDP in 1 MB base64 chunks; a 4 MB chunk never returns.
- **`scripts/gpu/scorecard.py`** (numpy only):
  - Modes: one comparison, `--noise` (two seeds), `--gate DIR`, `--display` (the same measures on the PNGs, i.e. PT1's units) and `--selftest`.
  - The band measure is a difference of Gaussians of log-luminance (σ = wavelength/4). It uses masked convolution over the thick body and is read on that body eroded by 3 px. `lit` = the half of that body the reference lights more brightly.
  - The noise mode also measures the path tracer's own grain in each band.

## Rerun
```
node scripts/gpu/capture.mjs --serve --page reference-pt/ --query "clean=1&spp=1024&seed=1" --size 1280x720 --format png --linear \
  --settle 90 --eval-timeout 1800 --timeout 300 --out work/captures/P0-3b \
  --shots pt-noon,nubis-noon,octave-noon,alpha-noon,rtalpha-noon,pt-low,nubis-low,octave-low,alpha-low,rtalpha-low,pt-backlit,nubis-backlit,octave-backlit,alpha-backlit,rtalpha-backlit
node scripts/gpu/capture.mjs --serve --page reference-pt/ --query "clean=1&spp=1024&seed=2" --size 1280x720 --format png --linear \
  --settle 90 --eval-timeout 1800 --timeout 300 --out work/captures/P0-3b/seed2 --shots pt-noon,pt-low,pt-backlit
python3 scripts/gpu/scorecard.py --gate work/captures/P0-3b        # add --display for the PT1-units table
python3 scripts/gpu/scorecard.py --selftest
```
Cost: 23 ms per pass at 1280×720, so about 25 s per 1024-spp view on an Apple GPU shared with another agent. PFMs and PNGs are git-ignored; JSON, Markdown and `sheet-*.jpg` are committed.

## Scorecard (linear; ratios are ours / PT; B/R is ours / PT)
| view | cloud L | thick L | fringe L | fringe B/R | base L | base B/R | dark20 L | dark20 B/R | 4-16 | 16-64 | 64-256 | lit 4-16 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nubis noon | 1.26 | 1.12 | 1.62 | 1.93 / 2.85 | 1.00 | 1.47 / 1.20 | 1.37 | 1.56 / 1.65 | 2.63 | 2.25 | 2.09 | 2.88 |
| octave noon | 0.90 | 0.79 | 1.31 | 1.86 / 2.85 | 0.87 | 0.98 / 1.20 | 1.10 | 1.12 / 1.65 | 1.43 | 1.53 | 1.68 | 1.42 |
| nubis low | 0.97 | 0.85 | 1.30 | 2.36 / 3.19 | 0.97 | 1.57 / 1.12 | 1.14 | 2.68 / 2.00 | 1.54 | 1.87 | 1.18 | 2.20 |
| octave low | 0.95 | 0.85 | 1.18 | 2.02 / 3.19 | 0.91 | 0.79 / 1.12 | 0.74 | 1.15 / 2.00 | 1.22 | 1.76 | 1.44 | 1.31 |
| nubis backlit | 0.70 | 0.62 | 0.99 | 1.39 / 1.37 | 0.73 | 0.97 / 0.78 | 0.94 | 2.77 / 1.49 | 0.93 | 0.91 | 0.96 | 1.07 |
| octave backlit | 0.40 | 0.33 | 0.77 | 1.45 / 1.37 | 0.43 | 0.75 / 0.78 | 0.45 | 1.26 / 1.49 | 0.92 | 0.91 | 1.02 | 1.02 |


**Noise floor** (two PT seeds; |ratio − 1| or |B/R diff|):
- Under ±0.002 for cloud, thick, fringe, base, 16–64 and 64–256. 4–16 band ±0.006–0.016, lit 4–16 ±0.002–0.017. dark20: ±0.035–0.059 luminance, ±0.034–0.105 B/R (worst at low sun; noisy pixels change which pixels are in the darkest 20 %).
- **These seed-to-seed numbers understate the fine band's uncertainty.** At 1024 spp the PT's grain is 63–87 % of the reference's 4–16 band energy, and grain is the same in both seeds. With that grain removed in quadrature, Nubis's 4–16 is 3.5× (noon) and 3.1× (low).

## Gate
Every check passes, each clearing 3× its seed noise (`scorecard.md`): (a1) lit-face fine band, Nubis ×2.88 at noon and ×2.20 at low; (a2) backlit thick body, Nubis ×0.62, octave ×0.33; (a3) fringe B/R below the reference by 0.83 to 1.17; (a4) low-sun shade B/R, Nubis +0.68, octave −0.85; (b) a noise floor for every measure.

## Surprises (all plain readings, nothing tuned)
1. **PT1's "overall brightness is about right" does not hold in linear at noon.** Nubis is 1.26× the PT over the cloud, 1.12× in the thick body, 1.37× in shade and 1.62× in the fringes. ACES's shoulder at exposure 0.35 squeezes this to 1.00 on screen. At low sun Nubis is right (0.97). Backlit is worse than PT1 reported: thick body Nubis 0.62×, octave 0.33× (on screen 0.80× and 0.50×).
2. **The display-space scorecard reproduces PT1's numbers on these new captures** (noon cloud ×1.00, thick ×0.96; backlit thick ×0.80 and ×0.50). The captures agree with PT1; every difference above comes from the colour space.
3. **Backlit "foam" is a tone-map effect.** In linear, both models' backlit fine band is at or below the reference (0.92–0.93). The excess shows only on screen, where darker frames sit lower on the curve and get more contrast.
4. **The 16–64 px band does not reproduce PT1's "lobes about right".** This measure gives 1.5–2.3× at noon and low sun (display version 1.9–2.7×), so the difference is the method; PT1's band measure was not recorded.
5. Runtime frames carry their own per-frame jitter, which no noise floor here captures. Step 0.5's converged mode, or averaged frames, would remove it.

## Requests for the pathtracer repo
- A per-pixel second-moment (sum of L²) accumulator, so one render gives its own variance (replaces the two-seed run); and a denoised or variance-limited reference output. The fine band needs about 8× the samples, or OIDN, before a 1.25× gate (Phase 1.2) is meaningful.
