# FX1: live settings, a continuous ground-shadow crossfade, surface sparkle

Three owner bugs on the HZD bench. Branch `worktree-agent-a7b7d5c4bf9dac728`, one commit per fix.

## 1. Live settings did not apply (LH1 "shade hue" changed nothing)

**Causes (two, both measured):**
- **The tune panel clamped the value back.** A number setting without a fixed range got a slider guessed from its starting value (0 to 4x
  the start: 0..0.6 for ambientSaturation 0.15). Tweakpane clamps the value it reads on every refresh and **writes the clamped value back**
  into the settings. The Review's "old: 1" became 0.6 straight away, which is the `c_ambientSaturation=0.6` the owner saw in the URL.
  Any setting the Review, the URL or the console set outside its guessed range had the same problem.
- **The sky layer never restarted its history.** `core.resetTemporal()`, which every settings change calls, reset only the voxel march
  passes. A lighting setting is not one of the sky layer's model params, so the layer could not see the change: it faded in over about 100
  frames (blend 0.3 per 16-frame cycle). At bench frame rates that is 3 to 5 s, so a toggle looked like it did nothing.

**Fixes:** `examples/lab/tune/panel.ts`: number sliders bind through a holder that ignores the slider's own clamp and step write-backs, so
only a real slider move changes a setting. `tune.ts`: full ranges for the c.* light settings (ambientStrength, Saturation, Warmth,
Floor, diffuseSun, diffuseFalloff). `runtime.ts`: `resetTemporal()` also resets the sky layer (one full-resolution trace per change).

**Check (scripted, every Review item):** each item's options were clicked through the DOM, the frame captured, and the setting read back.
Every option now sticks, and every item changes the frame live (frame difference against a repeat of the same option, at the
right view and motion). Weak signals are expected for A8 (only after painting), A6, SH1a and SH1b (motion only), CI1 (around the same mean)
and ST2 (rotation needs motion). PF1 "exact" is the same image by design. LH1 after the fix: 3.2 mean difference 2 frames after the click
(before: 0.1 after 2 frames and 1.4 after 92).

## 2. Ground shadow: a continuous crossfade (SH1a follow-up)

**What changed** (`packages/runtime/src/shadow-map.ts`, `shaders/shadow-map.wgsl.ts`, `packages/three/src/clouds.ts`):
- `shadow.advectContinuous` (default **true**): the next sweep is built into a third back buffer while the previous one is still being
  crossfaded. The crossfade lasts at least the last refresh period (sweep frames, or longer while a slow wind waits for
  `advectRefreshMeters` of drift), so the shadow is always part-way through a morph and never sits still and then lands.
  It reads the previous snapshot directly; it copies the map as shown only if a sweep lands before the crossfade is 90 % done.
- `shadow.advectSnap` (default **true**): each snapshot is stored at a wind offset on the far cascade's 64 m texel lattice relative to
  the previous one. The rows are still computed at the current moment; only the stored frame moves. The crossfade then reads the old
  snapshot at a whole-texel offset. Without this, every landing resampled the old snapshot and the shadow's 8 m texel pattern jumped
  for one frame: a residual step at every landing, even with the crossfade.
- `shadow.advectBlendFilter`: 'catmull' (default) or 'bilinear' (SH1's) for the old snapshot read. This only matters with the
  copy fallback; with snap the offsets are whole texels.
- `advectBlendFrames` default 6 -> **12** (= `advectRefreshFrames`).
- **Bug fix in the three adapter:** it mirrored the map into three's textures only when a refresh slice ran. With SH1's advect the map
  changes through the landing copy and the blend pass, so on the ground SH1's 6-frame ease froze part-way and then jumped when the
  next sweep began. It now copies on every write (new `shadowMap.info.writes`). This also fixes the old SH1 path.

**Review:** FX1a (old: ease, then wait / new: continuous), FX1b (refresh frames, slider 1..96), FX1c (blend frames, slider 0..96).
Tune panel "Light: renderer settings": advectContinuous, advectSnap, advectBlendFilter, advectRefreshFrames, advectBlendFrames.

**Measured** (`work/captures/FX1/shadow-metrics.txt`: ground view, pitch -35, x20, 1/60 s steps, step-frames.mjs + shadow-jitter.py):

| run | change/frame sd | max / mean | shape change sd | shape max / mean |
|---|---|---|---|---|
| SH1 as landed | 0.0201 | 1.61 | 0.0144 | 1.92 |
| SH1 path + adapter fix | 0.0145 | 1.24 | 0.0081 | 1.40 |
| FX1 continuous, no snap | 0.0128 | 1.41 | 0.0066 | 1.39 |
| **FX1 default** | **0.0114** | **1.26** | **0.0052** | **1.16** |
| exact map every frame | 0.0117 | 1.34 | 0.0096 | 1.36 |

SH1 had a landing step every 18 frames: a 6-frame ease, then a still map. FX1 has no periodic step left: the per-frame change is as even as an
exact map rebuilt every frame, and the shape change is spread evenly over the period. I judged this by numbers and frame differences; the
owner should confirm by eye (ground view, motion: time-lapse, flip FX1a).

**Cost:** at x20 a sweep slice now runs on 48 of 60 frames (SH1: 40) and the blend pass on every frame (SH1: about 26 of 60). The blend is
one 1024x1024 two-cascade compute pass with no timestamp of its own. The sweep pass measured 1.31 ms against SH1's 1.32 ms, which is noise.
With the wind still, nothing runs. Memory 32 MB (SH1: 24); 40 MB if the copy fallback is ever used.

## 3. Sparkle on lit and shaded surfaces

**Cause: SH1b's Catmull-Rom history fetch, at normal motion.** Reproduced at 2036x1137 (gp7, sun 40). I toggled each candidate one at a
time and measured high-frequency energy, isolated specks and temporal flicker in three crops at 1:1. I also split the fine detail into the
part two runs share (real detail) and the rest (sampling noise):
- Frozen clouds (motion 0): the speck level is the same now as before this week (exported ce204a6 on its own vite). Catmull and bilinear
  are the same here, because the history is not resampled.
- Motion x1 at 20 fps (motion 3 at 60 Hz steps): Catmull-Rom has twice the specks of bilinear and of the bench before this week
  (lit ridge 6.2 % vs 3.0-3.5 %). It has the same shared detail (0.96 vs 0.91 / 0.93) and about 35 % more noise (1.65 vs 1.23 / 1.16).
  The bilinear resample every frame had been averaging away the march's per-pixel sampling noise; Catmull-Rom keeps the noise.
  Two converged frozen renders share only about 36 % of their fine pattern, so most of that pattern is noise that shimmers.
- Not the cause: LH1 (ambientSaturation 1 vs 0.15), extinction 0.5 vs 0.8, PF1 emptySkip off, n3HhfDistance 0. All were within run-to-run
  spread. `n3Sharpen` 0 halves the specks at any motion (the deck's sharpen adds more noise than detail), but it predates this week
  and is the deck's recipe, so I left it at 1.
- In a x20 time-lapse, Catmull-Rom does keep more real detail (shared detail 0.82 vs 0.62), which is what SH1b was for.

**Fix:** `sky.historyFilter` 'adaptive' (new default). Bilinear while the clouds drift slowly. Catmull-Rom once the clouds move
`historySharpWindFrom` .. `historySharpWindFull` (0.15 .. 0.4 m per frame of cloud motion; the bench's x1 wind is 0.03 m at 60 fps and
0.08 at 20 fps, x20 is 0.56 at 60 fps), or on a fast camera turn (`historySharpFrom/Full` 0.5 .. 1.5 layer px). 'catmull' and
'bilinear' stay selectable. Sky params 88 -> 92 floats (`resolveOpts2`).
Result at x1: specks 3.2 % (Catmull 6.4 %, bilinear 3.2 %), noise 1.04 (1.48 / 1.07). At x20 it matches Catmull (shared detail 0.82).
**Review:** SH1b now has three options: old bilinear / SH1b Catmull-Rom / FX1 adaptive (default). Tune panel "Ray march": historyFilter,
historySharpFrom/Full, historySharpWindFrom/Full.

**Captures:** `work/captures/FX1/sparkle-ab-sheet.jpg`, crops at 1:1. Columns: before this week, SH1b, FX1, bilinear. Rows: x1 lit ridge, x1
shaded body, x20 lit ridge. The "before this week" column is at a different moment and still has the blue shade (LH1 not yet in).
All numbers are in `sparkle-metrics.txt`.

**Verdict:** better. At x1 the surfaces are as calm as before this week, and the time-lapse keeps SH1b's detail. Cost: none at x1 (the
Catmull taps are skipped); the same as SH1b in a time-lapse.

`pnpm typecheck` and `pnpm test` (324) pass.
