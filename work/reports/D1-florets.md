# D1 florets: why our renders have no floret-scale structure
Date 2026-10-11. This was a read-only investigation for D1. No file under `packages/`, `examples/` or `scripts/` was changed.

**How the probes were rendered.** Every probe was rendered from a snapshot of HEAD `642b458` that `git archive` exported into the scratchpad. It ran on its own vite instance on a random port, with its own vite cache, so it did not share files with the D1 agent's dev server. The snapshot reproduces the round-8 capture: p101 decima differs from `final8-4k` by a mean of 0.6/255.

Two probes needed a shader change. Both were made only in scratch copies of the snapshot, never in the repo:
- `snap2`: the micro tap in view-extinction units.
- `snap3`: P3-E step widening turned off.

**Settings.** All Parkouring numbers are at 4k with the round-8 look and wind stopped (`refs.ts` `animSpeed 0`).

**What stays local.** Scripts, captures and views are in the scratchpad (`.../scratchpad/florets/`, `.../scratchpad/snap*/out/`). Decima frames and slide images are not committed.

## Answer in one paragraph
The florets are mostly there as **geometry**. On p101 the upper outline of our matte has the frame's floret-scale relief: bump depth at 45 px or less is 1.34 for ours, 1.26 for the frame and 0.73 for Decima's raw profile. What our renders lack is the **lighting relief** that makes each floret read as a dome: a lit cap with a shaded underside.

Two things in our pipeline cause this:
1. **No sun-occlusion term works at the floret scale.**
   - The two in-line sun taps sit 8 m and 32 m from the sample (`lighting.wgsl.ts:8-9`).
   - They run at 1/33 of the view extinction (`inlineLightScale 0.03` × `densityScale 2` = 0.06 per density-metre, `runtime.ts:688`).
   - The look turns the micro tap off (`microDist 0`, `runtime.ts:703`). Even when on, the micro tap runs in the same 1/33 units (`march.wgsl.ts:275-276`).
   - So a 10 m floret barely shadows itself or its neighbour.
2. **The terms cancel at the floret scale.** The ms glow reads the profile P at the visible surface, and so does the ambient (as √(1 − P)). P encodes the erosion depth, so both terms are anti-correlated with the geometric relief. Each term alone carries 1.5–5× the beauty's floret-band energy, but in the sum they cancel (§2, H2).

Our r8 lit faces have the 4–32 px energy of **Decima's un-up-rezzed profile render**: lit-half bands 0.39/1.03 for ours, 0.32/1.06 for image102, and 1.46/3.09 for image101.

Raising the tap units brings p101's floret morphology onto the frame's on every box: `inlineLightScale` 0.1, or a 4 m micro tap at 0.25 × the view extinction. Nothing else does: noise MIP, noise frequency, detail type, step widening, density scale or resolution.

The noise type is not the cause either. Decima's own wispy-only, billowy-only and blended renders (s101) all score 3.3–4.0. Ours scores 2.0–2.3 under either forced type.

## 1. The floret metric (`scratchpad/florets/florets.py`, numpy + Pillow)
**Definition.**
- **Input.** The crop's luminance (0–255) at 4k-equivalent scale. The r8 crop sheets already are at this scale; for a 1080p frame, scale 2×.
- **Lit mask.** The cloud mask (low chroma against the sky), eroded by 24 px so the silhouette is excluded, then restricted to the brighter half by a σ 10 blur.
- **Hessian.** The scale-normalised Hessian σ²H of the Gaussian-blurred luminance, at σ = 7, 10, 14, 20 px. That covers blob diameters 2√2σ ≈ 20–57 px, the judges' floret range.
- **Domes and pits.**
  - A **dome** is a bright blob, where both eigenvalues are below 0. Its response is −μ₂, the weaker curvature.
  - A **pit** is a dark blob, where both eigenvalues are above 0. Its response is μ₁.
- **Detection.** Detected blobs are maxima in (x, y, σ) above τ. Global non-maximum suppression drops any blob whose centre falls inside a stronger blob's radius (1.41σ).
- **Threshold.** τ is relative: `REL` × the lit face's own RMS scale-normalised Laplacian, with **REL = 0.25**. So the count measures *shape* (how many distinct blobs share the face's own contrast), not amount.
- **REL was fixed once, on Decima's own pair** (image101 up-rezzed against image102 raw profile, same camera, same engine). It maximised the up-rez/raw ratio (3.5×) and was never tuned on our renders.

**Outputs.**
- **`blobs`** = (domes + pits) per 10⁴ lit px. This is the floret metric.
- **`b3lit`** = the judges' bands3 (1–3 / 4–12 / 12–32 px band std, 8-bit), but on the **lit half only**. This is the amount.
- Also reported: `dfrac` = domes / (domes + pits), roundness, coverage. Frames sit at dfrac ≈ 0.5: an egg-crate of domes and hollows. Our crests sit at 0.6–0.85: isolated bumps.

**Use both numbers.** Noise frequency ×2 raises `blobs` to near the frame's (3.2–3.4) at low contrast, while `b3lit` stays at 0.50/1.16 against the frame's 1.46/3.09. Blobs alone can be fooled by faint fine texture.

**Robustness** (p101 tower):
- Gaussian blur 1–2 px, JPEG q70, or ±2 grain: frame 3.58–3.66, render 1.92–2.09.
- Repeat captures with the same settings (s206 body): 1.70–1.78.

**Calibration on Decima's own frames (no renderer of ours involved).**

| Box | up-rezzed | raw profile |
| --- | --- | --- |
| p101 cloud (image101 / image102) | 3.00 | 0.85 |
| p101 tower | 3.62 | 0.81 |
| p125 cloud (image125 / 126 / 127 against 136) | 3.45 / 3.31 / 3.99 | 1.17 |
| p125 tower | 3.83 / 4.26 / 4.59 | 1.43 |

**Calibration against the judges** (crop sheets `sheets-r8`, frame / r6 / r8). Rows marked ✓ are the judges' "frame has florets, renders are balloons" calls.

| Crop | blobs | b3lit 4–12 / 12–32 (frame; r8) | judges' bands3 12–32 (frame / r8) | judges |
| --- | --- | --- | --- | --- |
| p213 tower (A-R2) | **4.25** / 1.97 / 2.24 | 1.36/3.13; 0.44/1.00 | 3.62 / 3.42 (blind) | ✓ florets missing |
| p101 leftmass (D-R9) | **2.81** / 2.05 / 1.57 | 0.76/1.94; 0.36/0.96 | 3.74 / 3.85 (blind) | ✓ |
| p101 tower (D-R10) | **3.61** / 1.68 / 1.95 | 1.46/3.09; 0.39/1.03 | 5.41 / 4.88 | ✓ |
| s33t3 upper (B-R5) | **2.95** / 1.81 / 1.96 | 1.35/3.54; 2.23/4.30 | 3.50 / 3.99 (wrong sign) | ✓ |
| s206 body (C-R8) | **2.33** / 1.48 / 1.73 | 0.72/1.70; 2.06/4.08 | 2.78 / 3.22 (wrong sign) | ✓ |
| s206 leg (C-R7) | **3.32** / 2.09 / 2.51 | 1.10/2.76; 0.90/2.21 | 2.20 / 1.62 | ✓ fibre missing |
| p213 base (A-R1) | 2.75 / 2.47 / 2.50 | 0.61/1.43; 0.39/0.88 | 1.37 / 1.27 | renders soft (small) |
| s33t3 trunk (B-R6) | 2.40 / **3.86 / 3.06** | 0.37/0.86; 0.62/1.55 | | renders carved where the frame is haze |
| s33t3 base (B-R4) | 3.22 / 3.50 / 3.58 | | | renders carved (ring, slit) |
| p101 tower shade (D-R11) | 2.07 / **5.43 / 5.81** | | | renders tiled with discs |
| p213 crease (A-R3) | 2.99 / 4.58 / 3.79 | | | r6 whorl counted as texture; the one miss |

The sign agrees with the judges on 10 of 11 crops:
- On all 6 floret crops, the frame is 1.3–2.2× the renders.
- On the 3 "invented relief" crops, the renders are above the frame.

The judges' whole-crop bands3 is blind or has the wrong sign on 4 of the 5 floret crops. Our energy sits in the shade and terminator, not on the lit crests. The lit-half bands show the gap on Parkouring, but not on Stormbird, where our lit faces are over-contrasted (open item 3 of `d1h-results.md`).

**Silhouette relief (geometry only)**, from `silhouette.py`. It measures the bump depth per unit outline length between blur σ 3 and σ 8 / 16 px (bumps up to ~20 and ~45 px). It is measured on the **upper** outline, because the chroma mask merges Decima's white horizon with the base.

| Image | ≤20 px | ≤45 px |
| --- | --- | --- |
| p101 frame | 0.51 | 1.26 |
| Decima raw profile (image102) | 0.22 | 0.73 |
| Ours, matte | 0.51 | 1.34 |
| Ours, wispy-only matte | 0.45 | 1.15 |
| Ours, billowy-only matte | 0.50 | 1.29 |
| Ours, noise ×2 matte | 0.71 | 1.52 |
| p125 Decima (three variants) | 0.63–0.71 | 1.44–1.59 |
| p125 ours | 0.47 | 1.33 |

## 2. Ranked hypotheses, with the evidence

### H1 (primary): there is no sun-occlusion term at the floret scale
This is confirmed by probe.

**The mechanism.**
- Florets are 20–60 px at 4k: 4.5–13 m at p101, where 684 m and vfov 39° give 0.224 m/px.
- The deck says "the first two [light] samples are taken in-line as before … preserve detail near the surfaces" (s113 notes).
- Ours sample at 8 m and 32 m (segments 0–16 and 16–48 m, `lighting.wgsl.ts:8-9`, `march.wgsl.ts:203-205, 261-268`). Both are at or beyond a floret's radius, so they cannot see a floret's own curvature.
- They also run at 0.06 per density-metre. On the tower crest (S 0.84–0.99, density 0.6–1) a floret's own optical depth toward the sun is 0.3–0.6, and the ms term sees 0.25× that.
- The light grid (16 m cells of P·S, from 48 m on, s113–114 and `light-grid.wgsl.ts`) is smooth by design.
- Inference, not a deck fact: the deck's 'as before' light march was 10 samples over 256 m (s115). If its spacing grew with the sample index, as the HZD cone kernel's did (GP7 p.123), its first two samples would be about 2–9 m out.

**Evidence** (`blobs`, then b3lit 4–12/12–32; frame first):

| Variant | p101 tower | p101 leftmass | p101 cloud | p213 tower |
| --- | --- | --- | --- | --- |
| frame | 3.62 (1.46/3.09) | 2.90 (0.76/1.95) | 3.00 (1.02/2.42) | 4.24 (1.36/3.14) |
| r8 | 2.00 (0.39/1.03) | 1.67 (0.37/0.97) | 2.08 (0.47/1.30) | 2.25 (0.44/1.00) |
| `inlineLightScale` 0.1 | 4.26 (1.26/3.00) | 2.60 (0.51/1.53) | 3.18 (0.92/2.25) | 4.04 (0.75/1.78) |
| `inlineLightScale` 0.3 | 6.06 (3.01/6.65) | 3.62 | 4.12 | 5.77 (1.62/3.76) |
| `inlineLightScale` 1 | 8.23 (4.33/9.39) | 4.05 | 5.29 | |
| micro tap 4 m at 0.25 × view ext. (probe) | 3.32 (0.72/1.53) | 2.89 (0.43/1.08) | 2.76 (0.59/1.38) | 4.24 (0.59/1.22) |
| micro tap 4 m at 0.5 × view ext. (probe) | 4.98 (1.51/2.85) | 3.81 (0.79/1.86) | 4.12 (1.10/2.21) | 7.95 (1.30/2.40) |

What the views show (`scratchpad/florets/view/`):
- **`inline_tower.png`, `micro_*.png`:** with either change, the crest lumps get lit tops and shaded undersides, which is the cauliflower read. At distance, inline 0.1 is the closest whole-cloud read in the set (`whole_variants.png`).
- **Costs:**
  - inline 0.1 darkens the body at the lobe scale. The lit-half 4–32 px energy rises to the frame's, but so does the shade between masses.
  - inline 0.3 and above go grey and over-contrasted.
  - The micro probe at 0.5 brings back pits and slits in the shade face. This is round 1's "pitting", erosion holes casting hard shadows.
  - The window is micro 0.25–0.5, or inline about 0.1.

Round 8 rejected `inlineLightScale` 0.06 / 0.1 on bands3 measured **with the wind running**: "image +2 to +6 percent, tower shade −30 to −43 percent". That smear removed exactly this scale, so the rejection should be re-run on the stills (T1).

**Stormbird** (1080p video frames, judged at 2×, `scratchpad/snap2/out/e8`):

| Region | frame | r8 | inline 0.1 |
| --- | --- | --- | --- |
| leg | 3.44 | 2.42 | 3.34 |
| upper | 2.94 | 2.01 | 2.70 |
| body | 2.14 | 1.73 | 2.75 (overshoot) |
| trunk | 2.39 | 3.03 | 2.83 (still carved) |

- The micro probe at 0.25 changes nothing on Stormbird. The sun is behind-right, and S is low (median 0.29 in the shell).
- Our Stormbird lit-half amounts are already 1.2–2.7× the frame's (body 2.06/4.12 against 0.77/1.85). Fix tone and contrast first, then re-measure the floret count.
- A 4k render downsampled to the frame's scale gives the same numbers as 1080p (body 1.77, upper 2.04), so resolution is not the cause.

### H2 (contributing): the profile-driven terms cancel the relief that remains
- ms = P · exp(−τ · relax), and the ambient goes as √(1 − P) (s123, s126; `lighting.wgsl.ts:72-85`).
- At the visible surface P sits near the local erosion threshold n. So P is a map of the erosion depth, inverted against the geometric relief:
  - a protruding floret has low P: dim ms, bright ambient;
  - a crease has high P.
- `lightDebug` isolation on the p101 tower (`termcorr.py`): DoG band 4–12 px correlation inside the lit interior.

| Setting | direct ↔ ms | ms ↔ ambient | band std: direct / ms / ambient / **beauty** |
| --- | --- | --- | --- |
| r8 (tower) | **−0.49** | −0.75 | 4.0 / 5.9 / 1.9 / **1.2** |
| r8 (leftmass) | −0.27 | −0.78 | 3.5 / 4.0 / 1.3 / 1.2 |
| inline 0.1 (tower) | −0.26 | −0.71 | 10.5 / 5.7 / 2.0 / 3.3 |
| inline 0.3 (tower) | +0.24 | −0.42 | 17.6 / 6.8 / 2.0 / 7.2 |
| micro probe 0.5 (tower) | 0.00 | −0.58 | 7.5 / 5.5 / 2.0 / 3.0 |

In the ms term alone, the tower scores 4.17 blobs, above the frame. The view shows hard dark rims on every occlusion outline (`view/terms_tower.png`): the "cut paper" layering the judges see.

- `msStrength` 0.2 lifts the lit bands from 0.39/1.03 to 0.67/1.89, but blobs only from 2.00 to 2.28. Removing the cancellation alone does not make florets; the direct term needs floret-scale occlusion (H1).
- With taps in the right units, the ms decorrelates, because its exp(−τ · relax) inherits the taps.
- `glowDepth` 0 gives tower 2.17 (0.55/1.64): more P structure, the discs.
- `ambientStrength` 0.3 gives 2.34.
- **Which term should carry the relief:** the direct term and the ms's τ, both through short in-line taps. The P-driven glow and ambient should stay smooth at this scale. `glowDepth` 12 already pushes the glow that way.

### H3 (low, not the crests): wispy-typed surfaces erode to the raw profile plus web creases
Parkouring's surface voxels are 59 % wispy (T < 0.3). These are the base and skirt: T ≈ 0.05 and S ≈ 0.06 at heights 0–0.2. The tops are billowy (T 0.74–0.96, S 0.9–0.99 at heights 0.6–1.0). That matches the deck's physical rule (s88).

On wispy surfaces:
- The composite is ≈ r, the LF Curly-Alligator. Its median is 0.06, and its web lines reach about 0.5.
- The surface is the raw profile's balloon cut by 30–50 m-deep web creases: the slits, pits and whorls.

Effect on the measures:
- Forcing wispy everywhere lowers our matte's upper-outline relief from 1.34 to 1.15.
- Forcing billowy changes it to 1.29.
- Neither moves the interior blobs (p125: 2.11 shipped, 2.28 wispy, 1.99 billowy).
- In Decima the type does not matter for the florets either (3.31–3.99).

This is not the floret cause on the crests. It may matter for the bases and the Stormbird trunk (the carving).

**Open:** Decima's s101 triplet shows no wispy-only outline loss. One of image126 / image127 is wispy-only, and image125 equals the final s107 image133 (mean |Δ| 0.06/255). If that holds up, our wispy path erodes less at the outline than Decima's, which T6 checks.

### Ruled out by probe
- **P3-E step widening** (sparse-run ×7, dense gain 3; `march.wgsl.ts:135-138, 240-241`). With both gains at 0 (`snap3`): tower 2.21, cloud 2.07, p213 tower 2.25. The matte outline is identical (1.59 against 1.60). The width cap max(step, −sdf/2) already keeps the step at the deck's 2.1 m near the eroded surface.
- **Noise MIP** (`mipDistanceScale` 0.0005, mip 0.3 instead of 1.24 at 684 m): tower 2.42, leftmass 1.67, cloud 2.31, outline unchanged. The HF Alligator's feature diameter is about 10 m (autocorrelation half-width 4.7 m, 6 texels), which is 5× the 1.85 m texel at mip 1.24.
- **Noise frequency ×2** (`noiseScale` 0.02): blobs 3.2–3.4 with b3lit unchanged (0.50/1.16). The extra blobs are smaller and faint; this is the wrong fix.
- **Density scale** (`densityScale` 0.6 / 6 with the units held): 1.46 / 2.59 on the tower; no floret read.
- **Detail type** (override 0 / 1): see H3.
- **Noise orientation:** our y-up world samples the z-up noise axis-swapped. The channels are isotropic (autocorrelation half-widths per axis are r 18/19/17, g 9/9/9, b 9/9/8, a 6/7/6 texels), so this changes nothing.
- **Resolution:** Stormbird at 4k gives the same numbers as at 1080p.

## 3. Q1: our density chain against the deck's, line by line
Ours is `density.wgsl.ts:41-86` (a port of the pack's `VoxelCloudSampler.cg:51-99`) and `march.wgsl.ts`. The deck is s91–s109 and s113–s128.

| Step | Deck / pack | Ours (decima look) | Same? |
| --- | --- | --- | --- |
| Wind | `p −= wind * speed` (s91) | `p − wind` (`:55`); stopped on the stills | yes |
| Noise fetch | `uvw = p · 0.01` (100 m tile, 0.78 m/texel), mip `log2(1 + d·k)`, k unpublished (s92) | `noiseScale` 0.01, `mipDistanceScale` 0.002: mip 1.24 at 684 m (`runtime.ts:718`) | k is a guess; probe shows no effect |
| Channels | R/G Curly-Alligator LF/HF, B/A Alligator LF/HF (s90) | same texture (16-bit from the pack VDB when present) | yes |
| Wispy | `lerp(r, g, P)`: 88–94 % LF at the surface (P 0.06–0.12) | `:62` | yes |
| Billowy | `lerp(.3b, .3a, P^0.25)`: ~50–60 % HF at the surface, capped at 0.3 | `:63` | yes |
| Composite | `lerp(wispy, billowy, T)` (s100) | `:64`; `typeFromScale` 0, `wispyBias` 0, `detailBias` 0 | yes |
| HHF fold | within 150 m only (s103–104, s109) | `:66-72`; inactive at 700 m | yes |
| Erosion | `ValueErosion(P, n) = sat((P − n)/(1 − n))` (s107) | `:76` | yes |
| Density scale | `S' = S⁴`; `ρ ·= S'`; `ρ = ρ^lerp(.3, .6, S')` (s109) | `:77-80` | yes |
| Near soften and fade | s109; pack 10–120 m | `:81-86`; inactive at 700 m | yes |
| Profile / SDF gating | erosion only where P > 0; sample only where SDF < 0 (s149); the SDF drives the glow's relax (s123) | `:50`, `march.wgsl.ts:245`; SDF = EDT of P > 0 | yes |
| What the erosion shapes | P ramps 0→1 over ~105 m in Parkouring's shell (\|∇P\| 0.0095/m). Billowy n ≤ 0.3 displaces the surface 0–31 m in ~10 m cells: the florets. Wispy n is ≈ 0.06 with 0.5 web lines: balloons and creases. | same data | — |
| View extinction | unpublished (D0 fit 0.3–0.6) | `densityScale` 2 per unit density per metre | ours by fit |
| In-line sun samples | "first two in-line", on mFull, "preserve detail near surfaces" (s113); distances and units unpublished | segments 0–16 and 16–48 m (midpoints 8 / 32 m) at 0.06/density-metre (1/33 of view) | **this is the gap (H1)** |
| Light grid | P·S summed density samples, 256×256×32 (s82, s113–114) | P·S, 16 m cells, from 48 m, `lightDensityScale` 0.031 | yes |
| MS | `P · exp(−τ · Remap(sun_dot, 0, .9, .25, ValueRemap(sdf, −128, 0, .05, .25)))` (s123) | `glowFront` 1 (relax by SDF at every angle), `glowDepth` 12 (P read 12 m behind), `msStrength` 0.7 | deviations, partly cancel H2 |
| Ambient | `√(1 − P) · exp(−S_up)` (s126, s128) | + floor 0.15, `ambientExtinction` 0.5, ground term | deviation |
| Step | `max(sdf, max(1, 0.08√t))`: 2.1 m at 700 m (s150) | same, plus P3-E widening (ruled out) | yes |

## 4. Q2: geometric or lighting relief?
**Both, but our gap is the lighting.**
- **Decima has the geometry.** Its up-rez adds floret outline relief over its raw profile: 0.73 → 1.26 at ≤45 px on p101, and 0.77 → 1.44–1.59 on p125. Ours has the same on the crests (1.34 matte p101; 1.33 p125).
- **The interior shows florets through shading.** Each dome has a lit cap and a darker crease. On a near-opaque crest (S ≈ 0.9, densityScale 2, mean free path ≈ 1 m), that shading can only come from sun occlusion that varies inside one floret.
- **Which terms should carry it:** the in-line taps (direct, and the ms's τ). The glow's P and the ambient's √(1 − P) should not; they invert the relief (H2). Nothing in the per-sample shadow path does this today. The micro tap is off in the look, and in the wrong units when on.

## 5. Q3: is something averaging the structure away?

| Suspect | Verdict | Evidence |
| --- | --- | --- |
| Noise resolution / MIP | no | mip 1.24 → 0.3: ±0.1–0.4 blobs, outline unchanged |
| Trilinear of a coarse noise | no | 0.78 m texels, features ~10 m |
| Step size near the surface | no | deck step 2.1 m; P3-E widening off changes nothing |
| Light grid 16 m cells | flat by design, not the carrier | the deck reads the grid only after the two in-line samples (s113) |
| Temporal resolve | no on stills, **yes live** | round 8: wind drift smears 2–4 px; the stills stop the wind; `windCompensate` needs a Catmull-Rom history |
| Far-pass scale 0.75 | no | florets are 15–45 px at march resolution; round 8: full resolution only adds 1–3 px grain |
| **Floret-scale sun occlusion** | **yes** | H1 table |
| **P-driven terms anti-correlated with the relief** | **yes, contributing** | H2 table |

## 6. Falsifiable tests for the D1 agent (stills, wind stopped)
Measure every test with `florets.py` (`blobs` and lit-half `b3lit`) on the judged crops, alongside `d1.py stats` shade p10 and pit.

- **T1 — tap units:** `inlineLightScale` 0.1 on all 9 bookmarks.
  - Predicted: Parkouring crest blobs within ±15 % of the frame (p101 tower 4.3 / 3.6, leftmass 2.6 / 2.9, p213 tower 4.0 / 4.2).
  - H1 is false if blobs stay within 10 % of r8.
  - Watch: lobe-scale shade darkening, and pit on the frames.
- **T2 — split units:** a short tap in view-extinction units.
  - Change: `march.wgsl.ts:275-276` reads `tauMicro = density(ps + sun · microDist/2).x · microDist · extinction · microShadow` instead of `· inlineExt` (the scratch `snap2` patch, 2 lines).
  - Settings: `microDist` 4, `microShadow` 0.25, taps at 0.03.
  - Predicted: p101 tower 3.3, leftmass 2.9, cloud 2.8, p213 tower 4.2, with the body's lobe-scale light kept.
  - Prefer T2 over T1 if its shade p10 and pit stay at r8's.
  - At `microShadow` 0.5 expect pits back (tower 5.0, p213 tower 8.0).
- **T3 — cancellation:** `lightDebug` 1/2/4 at the chosen T1/T2 setting, plus `termcorr.py`.
  - Predicted: corr(direct, ms) ≥ 0 in the 4–12 px band.
  - If the beauty's band std is still < 0.5× the direct's, the P-terms still cancel. Next levers are `glowDepth` and putting the short tap's occlusion on the ambient.
- **T4 — geometry guard:** `silhouette.py` on the upper outline of the matte (p101 box 600,300,2700,1000).
  - Expected ≈ 1.3 at ≤45 px.
  - A change that lowers it below 1.15 has removed floret geometry.
- **T5 — Stormbird:** repeat T1/T2 after the tone and contrast work.
  - Today inline 0.1 brings the leg and upper to the frame's blobs (3.34 / 3.44, 2.70 / 2.94) but adds contrast where the lit faces are already 1.2–2.7× over.
- **T6 — wispy path:** p125 with `detailTypeOverride` 0 and 1, outline and blobs, against image126 / image127.
  - Decima's outline does not change with type; ours drops from 1.33 to 1.15 wispy-only.
  - If T1/T2 do not close s33t3 base and trunk, check the wispy convention: `noiseInvert` bit 2, P1's switch.
- **Already run, needs no repeat:** P3-E widening off, noise MIP 0.0005, `noiseScale` 0.02, type override, `densityScale` 0.6 / 6, Stormbird at 4k. All are in §2.

## 7. Files (scratchpad, local only)
- `florets/florets.py`: the metric. Modes: `sheet <crop sheets>` or `img <images> --box x,y,w,h [--scale 2] [--debug dir]`. Environment: `FLORET_REL` (0.25), `FLORET_MODE` (`rel` / `abs`).
- `florets/evalset.py <p101|p213|p125> <images>`: the fixed 4k boxes used above.
- `florets/silhouette.py <box> <images>`: outline relief.
- `florets/termcorr.py <dir> <beauty> <box>`: term correlations.
- `florets/noise_stats.py`, `nvdf_stats.py`: noise feature sizes, and the NVDF shell's T / S / |∇P|.
- Captures:
  - `snap/out/{t0, e1, e3, e4, e7, e8k}`: pristine HEAD.
  - `snap2/out/{e2, e6, e6s, e8}`: micro-tap units probe.
  - `snap3/out/e5`: step widening off.
- Views: `florets/view/*.png`.
