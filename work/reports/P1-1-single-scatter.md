# P1.1: single scattering, realtime direct term against a one-event path trace
Status: **gate not passed: 37 of 64 region readings within 5 %.** EmberGen passes all 16; stratus 12 (sunset misses); Parkouring 9; the sky patch 0. Every miss is traced to the sun's optical depth from the light grid (input field, resolution, a 1.2 multiplier, its medium). Phase, units and the view ray are right. Nothing tuned, no default changed. Branch `worktree-agent-abb31ed39016ad2d6`.

## How single scatter is isolated
- Page `examples/lab/reference-pt/`, panel row **Review: P1.1** (checkboxes; URL `sunOnly=1`, `single=1`, `converged=1`). **Sun only**: the PT's sky is an all-black map (its env sampler gives it pdf 0), the runtime's `ambientStrength`, `bodyEnv` and `groundAlbedo` are 0, and readLinear drops the scene term, so the background is black on both sides. **Single**: PT `maxDepth` 1; runtime `lightDebug` 1 (direct term only, no aerial perspective), nubis model, `silverStrength` 0, `phaseModel` hg, `phaseG` = the PT's g (0.8), `directProfile` 0, `edgeDarkening` 0 (no powder in the nubis model). **Converged**: P0.5 mode, 16 samples, step / 4; settle waits for the sum.
- **The PT's cap is 1.** The megakernel counts medium scattering vertices only: a box-boundary hit is an `interface` that `continue`s without touching depth (`integrator-wgsl.ts` at ad9c01e, volSurface). At depth 0 a medium event adds the sun's NEE and the phase-sampled escape (black sky); the next medium event (depth 1 >= 1) ends the path. Depth 2 doubles the image (2.28x cloud), so 1 is one event.
- **Cycles check** (EmberGen noon, 640x360, 128 spp, GPU, 13 s, manifest exported with a black sky and maxBounces 1, so Cycles bounces 0): Volume Direct / PT depth 1 (two seeds x 4096 spp) = **cloud 1.001, thick 1.001, base 1.002, fringe 0.992** (PT seed noise 0.0003-0.0034; the fringe is Cycles grain at 128 spp). Combined equals Volume Direct (0 bounces). `work/captures/P1-1/cycles/cycles-vs-pt.md`.
- Thin-segment shortcut: off in converged mode on both routes (`march.wgsl.ts:271`, threshold 0 unless `convergedKeep & 1`); the card's NVDF and direct volumes use the same march.
- PT 4096 spp per seed, 1.1-3.3 ms per pass, 4-19 s per frame. Masks: the PT side's alpha. Realtime albedo is 1 and the PT's 0.99, so **the expected ratio is 1.010**; ratios below are raw.

## Gate: realtime / path trace (two seeds averaged; seed-to-seed under 0.4 %), bold = outside 5 %
| cloud | noon c / t / b / f | low | backlit | sunset |
|---|---|---|---|---|
| Parkouring (voxel march) | 0.962 / 0.971 / **0.931** / **0.936** | 0.958 / 0.964 / **0.915** / **0.884** | **0.877** / **0.765** / **0.897** / 0.956 | 0.961 / 0.958 / 0.968 / 0.963 |
| EmberGen 02 (direct) | 1.008 / 1.009 / 0.987 / 0.955 | 1.000 / 1.001 / 0.989 / 0.963 | 0.992 / 0.987 / 0.973 / 0.992 | 0.982 / 0.981 / 0.967 / 0.980 |
| sky patch (direct) | **0.876 / 0.871 / 0.809 / 0.903** | **0.809 / 0.800 / 0.644 / 0.875** | **0.715 / 0.646 / 0.687 / 0.843** | **0.754 / 0.694 / 0.711 / 0.852** |
| stratus (direct) | 1.005 / 1.010 / 1.005 / 1.009 | 0.984 / 0.973 / 0.994 / 0.989 | 0.975 / 0.964 / 0.969 / 0.982 | **0.797 / 0.908 / 0.933 / 0.771** |
c cloud (alpha > 0.5), t thick (> 0.995), b base (bottom third), f fringe (0.05-0.6). Worst: sky low base 0.644, sky backlit thick 0.646, Parkouring backlit thick 0.765, stratus sunset fringe 0.771.

## Shadow optical depth: realtime tau / true tau
New debug setting `lightProbe` (view optical depth D; `lightProbeMode` 0/1): the march writes, at the first lit sample whose view optical depth reaches D (pixel-centre ray), its tau, the sample distance, and the tau split (in-line + micro taps / grid). D = 0.05, 0.3, 1, 3, 10, four suns, 100 random pixels each (1600 points per cloud). True tau: the PT's own grid (exported manifest; Parkouring per sun), trilinear, quarter-voxel steps to the box exit (`tau.py`). Geometry check: probe view OD / CPU view OD median 1.000-1.013.
| true tau | Parkouring | EmberGen | sky | stratus | 5 % radiance needs |
|---|---|---|---|---|---|
| 0-1 | 1.12 [0.57-2.06]; grid 1.41 | 1.05 [0.73-1.42]; grid 1.87 | **1.75** [1.11-3.55]; grid 3.57 | 1.06 [0.92-1.25]; grid 1.15 | abs 0.049: ±10 % at 0.5 |
| 1-3 | 1.08 [0.72-1.54]; grid 1.36 | 0.99 [0.73-1.31]; grid 1.05 | 1.13 [0.90-1.65]; grid 3.12 | 1.00 [0.97-1.08]; grid 1.01 | ±2.5 % at 2 |
| 3-10 | 1.11 [0.88-1.33]; grid 1.18 | 1.00 [0.91-1.12]; grid 1.00 | 1.09 [0.91-1.36]; grid 1.38 | 1.00 [0.98-1.02]; grid 1.00 | ±0.75 % at 6.5 |
| 10-30 | 1.09 [0.95-1.25]; grid 1.12 | 1.00 [0.93-1.06]; grid 1.00 | 1.01 [0.93-1.09]; grid 1.01 | 1.00 [0.98-1.01]; grid 1.00 | ±0.25 % (weight e^-10) |
| 30+ | 1.07 [1.01-1.17]; grid 1.07 | 0.99 [0.93-1.05]; grid 0.99 | 0.99 [0.96-1.04]; grid 0.99 | 0.99 [0.98-1.00]; grid 0.99 | none (e^-30) |
Median [p10-p90] over four suns; "grid" = the light-grid part / the true part beyond 48 m. The in-line taps (0-48 m) are 0.94-1.03 in every bin and cloud (sky sunset 1-3: 0.84). On the sky, the NVDF field the grid integrates (below) reproduces the grid's excess: 3.04x / 2.10x / 1.09x of true in the first three bins; the grid over that field is 1.01-1.19. Stratus sunset alone: grid / that field 2.11 at tau < 1. Every bin's p10-p90 misses the tolerance below tau 10; only the median is near 1 on EmberGen and stratus.

## Causes, ranked by image error explained (one factor at a time, new debug settings, defaults off; `work/captures/P1-1/<cloud>/iso-*`)
**Direct-volume route** (EmberGen, sky, stratus)
1. **Light-grid input: the NVDF R channel**, `max(1, round(255 x density / p99))` for any voxel above 1e-4 of the max (`vdb-direct.ts:216`; the 1/255 floor seeds the SDF). On the sky patch's thin haze this floor is 1/255 of p99 = 0.002/m, a deep false shadow. `lightGridSource=1` (grid reduces the r16f texels the march reads): sky cloud 0.876→0.962 noon, 0.809→0.948 low, 0.715→0.907 backlit, 0.754→0.904 sunset; base 0.644→0.906. EmberGen and stratus: under 0.2 %. Corrects P0.6, which judged the floor "tiny" and the clamp the only effect.
2. **Light-grid resolution** (half the volume: 16 m cells, steps growing 12 % of the distance). `lightGridFull=1`: stratus sunset cloud 0.797→0.974, fringe 0.771→0.971; stratus low/backlit thick 0.97→1.00. Sky with both 1 and 2 (fresh sessions): **0.96-1.04 on every region and sun**. EmberGen not run (grid 700 MB, over the cap).
3. **Sun colour by height** (`sunRadianceAtHeight`, `march.wgsl.ts:35`, against the PT's single sun at the centre): `sunAtCentre=1` moves sunset by +1.4 to +3 points (EmberGen base 0.967→0.994), under 1 % elsewhere. Our side is the more physical one; the reference simplifies.
4. **Albedo**: realtime 1 (`march.wgsl.ts:358-360`, no factor), PT 0.99: +1.0 % everywhere.
5. **Unexplained**: EmberGen fringe 0.955 noon / 0.963 low (-5.4 % against the expected 1.010). Not the shadow (shallow probes D 0.05-0.3: mean exp(-tau) ratio 0.99-1.02), not the view step (step / 16 identical), not the sun height.

**Voxel-march route** (Parkouring)
1. **`lightDensityScale` 1.2** multiplies the grid's optical depth (an art fudge for the up-rez the grid lacks; `runtime.ts:720`). `=1`: backlit thick 0.765→0.842, sunset cloud 0.961→0.998, low base 0.915→0.952.
2. **Light-grid resolution**: with 1, `lightGridFull=1`: backlit thick 0.842→0.981, low base 0.952→0.995, noon fringe 0.945→0.979.
3. **Grid medium**: the grid integrates the NVDF profile x scale, not the up-rezzed density the view ray and the PT see. After 1 and 2, sunset overshoots (cloud 1.035, base 1.069) and low fringe stays 0.942; grid / true beyond 48 m is 0.93-1.17 by bin once the 1.2 is removed.
4. Sun by height: under 1 point. View ray: runtime alpha / PT alpha 0.999-1.000 in every region (`iso-rtalpha`).

**Phase**: exact. HG(0.8) at the card's centre view angles, ours = the PT's to 1e-6: noon 78.4° 0.01892, low 101.0° 0.01055, backlit 37.6° 0.1261, sunset 60.1° 0.03704 (same normalisation 1/4pi; the PT's `ptHgPhase(dot(-view, sun))` is our `henyeyGreenstein(dot(view, sun))`). The **default** phase (0.6 HG 0.2 + 0.4 HG 0.85) is 2.9x / 4.0x / 0.90x / 1.9x of HG 0.8 at those angles: a large single-scatter difference in normal rendering (DIVERGES L1). **Units**: sun irradiance identical on both sides (`sunRadianceAt` of the centre); clear sky matched in P0.3.

## Proposed fixes (for a later step, each behind a setting)
1. Build the light grid's reduced volume from the direct r16f density, unclamped (keep R's floor for the SDF only). Cost: one extra texture read per grid texel in a pass that runs once per volume; nothing per frame. (The `lightGridSource` diagnostic is this, already.)
2. Give the sun channel full volume resolution in its own r16float texture (2 B per voxel: sky 56 MB, EmberGen 58 MB; up sum stays at half), or keep the grid and extend the in-line taps (a third tap 48-128 m, about one fetch per lit step). Rebuild cost 8x, already sliced.
3. Parkouring: lightDensityScale 1 in the physical model, and a grid built from the up-rezzed density (a reduce from DENSITY_WGSL at grid texels: once per volume, more fetches).
4. An albedo setting (0.99) on every scattered term: free.
5. For gating, read the realtime with `sunAtCentre=1` (or give the PT a height-varying sun); not a realtime change.

## Every multiplier on the realtime direct term (nubis model, `march.wgsl.ts` / `lighting.wgsl.ts`)
- `sunHere` = `sunRadianceAtHeight(ps.y)` (march:322, 30-36; earth-shadow smoothstep). Physical (per-height transmittance), differs from the PT's single sun.
- `exp(-tau)`, tau = `tauMicro` (march:289-290: density at 2 m x microDist x `microExt` = extinction x `microLightScale` or x `inlineLightScale`) + `tauInline` (march:278-279: two point samples at 8 and 32 m x `inlineLightScale`) + grid x **`lightDensityScale`** (march:312). Non-physical when inlineLightScale, microLightScale or lightDensityScale differ from 1 (Parkouring 1.2; the decima look 0.03-0.25).
- `phase` = `cloudPhase` (lighting:41): mix of HG(phaseG) and HG(silverG) by silverStrength, or the Mie fit; not the PT's HG(0.8) by default.
- `mix(1, saturate(profile), directProfile x rimW)` (lighting:102): non-physical edge weight, default 0.
- `T (1 - exp(-sigma ds))` (march:359): exact segment integral for albedo 1; **no albedo factor**.
- `cloudEdgeFactor(depthMax, frontness)` (march:381, lighting:163): non-physical darkening, `edgeDarkening` 0.5 on Parkouring's defaults.
- Cutoff continuation `1 / max(1 - T, 0.5)` when T < cutoff (march:377): non-physical, adds light.
- Thin segments under optical depth 0.002 add no light (march:271, normal mode): non-physical, loses light.
- Aerial perspective and haze (march:389-390): physical, off in `lightDebug`.
- Octave model: `sun x exp(-tau) x mix(HG 0.7, HG -0.2, 0.5)` (lighting:132, 139) x powder `1 - 0.8 exp(-150 sigma)` (lighting:149): non-physical.

## Files
`work/captures/P1-1/`: `gate.md|json`, `tau-tables.md`, `<cloud>/tau.json`, `<cloud>-sheet.jpg` (PT | realtime, four suns, each sun at its own exposure), `cycles/`, scripts `p11.py`, `tau.py`, `iso.py|sh`, `run.sh`, `make_evals.py`. Floats git-ignored. A full-resolution grid on the sky took longer to rebuild than a converged sum, so its multi-sun session read stale grids (`stale-*`); the page's settle now waits out late restarts when `lightGridFull` is on, and the sky numbers above are from fresh sessions. Typecheck clean; `vitest packages/runtime` 163 of 163.
