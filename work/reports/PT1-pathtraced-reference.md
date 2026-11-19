# PT1: a path-traced reference for our cloud lighting
Status: ready for review. Branch `worktree-agent-ad73c5d9755194344` (not merged).

**Question.** You said the clouds "keep feeling odd, might just be Horizon". To split "that's the Nubis/Horizon style" from "that's our approximation being wrong", I rendered the same cloud density two ways. One is an unbiased path tracer that follows every light bounce: your `@pmndrs/pathtracer`, using its P5 volume code, which was validated against pbrt-v4 and Mitsuba. The other is our realtime runtime, with both of its lighting models.

**Short answer.** The overall brightness is about right. The odd look comes from four measurable departures from the physics. Most of them are ours, not Horizon's:
1. Lit surfaces have about **2× too much small-scale texture**: pits and florets, the "foam".
2. **Thin fringes read white and solid** where real ones are see-through.
3. **Backlit bodies are too dark** (Nubis about 0.86× the reference, octave about 0.6×). Nubis also tints them blue.
4. **Shade colour is wrong in opposite directions:** Nubis shade is too blue, octave shade is too brown.

## How it was made
- **Page:** `examples/lab/reference-pt/` (`/reference-pt/?view=pt-noon`; panel buttons for every view; `window.__clouds` contract; bookmarks `<pt|nubis|octave|alpha|rtalpha>-<noon|low|backlit>`).
- **Cloud:** Nubis pack hero Parkouring, placed as on the flagship. Flagship art look, quality ultra, wind frozen.
- **The path tracer's density** is a GPU bake of the runtime's own `DENSITY_WGSL` `cloudDensity().x` on a 2 m grid (376×156×376), run on the runtime's own device and textures. Each voxel is evaluated at its distance to the camera, so the noise mip matches the march. Extinction is the runtime's `densityScale` (0.3/m), albedo 0.99, a single Henyey-Greenstein lobe with g = 0.8 (`?albedo=`, `?g=`, `?voxel=` change these).
- **Path tracer setup:** delta tracking, ratio-tracked shadows, 8³ brick majorant, maxDepth 512, no Russian roulette, 4096 spp at 1600×900. That took 40–80 ms per pass on this Mac while another agent was capturing.
- **Sun and sky:** the path tracer's sun is a delta light. Its irradiance is the runtime's `sunRadianceAt(cloud centre)`. Its environment is the runtime's sky-view LUT baked to an equirect map. The map's hemisphere means agree with the runtime's ambient values within 1–2 % (noon sky up 0.387/0.772/1.679 vs 0.390/0.777/1.693).
- **Removed on both sides:** aerial perspective (`enableAerialPerspective: false`) and our horizon haze.
- **Display:** both sides use three's ACES filmic at exposure 0.35, then sRGB, so the frames compare directly.
- **Validation that it is the same cloud:** the `rtalpha` view reads back the march's own transmittance. Against the bake's opacity (`alpha` view), the mean |Δα| is 0.005–0.006 at all three angles, and the thin-fringe mean is 0.25 vs 0.25. Every difference below is lighting, not shape.
- **Sun setups:**
  - noon: 13:00, sun 69° up, camera 70° off the sun's azimuth.
  - low: 17:36, sun 19.5° up, same ring.
  - backlit: same sun, camera at 140°, so the sun is behind the cloud and to one side.

  The "low" sun is 19.5°, not a sunset. Golden hour is not covered.

## Sheets
- `work/captures/PT1/sheet-{noon,low,backlit}.jpg`: path traced | ours Nubis | ours octave. The full frame cropped to the cloud sits on top, with 2× crops of the lit top, the mid body and the base below.
- `work/captures/PT1/sheet-controls.jpg`: what moves the reference.
  - g 0.46: our dual lobe's mean cosine.
  - albedo 0.999.
  - a 1.25 m bake.
- **Raw frames:** `work/captures/PT1/*.png`. Variants are in `var-g046/`, `var-albedo0999/` and `var-voxel125/`; the runtime's opacity is in `rtalpha/`.
- **Numbers:** `stats.json`, written by `python3 scripts/gpu/pt1-sheet.py work/captures/PT1`.
- **Units:** values are display-referred luma (after the tone map). The regions come from the alpha mask.

## Where we depart from the reference

| | noon PT / Nubis / octave | low PT / Nubis / octave | backlit PT / Nubis / octave |
|---|---|---|---|
| cloud mean luma | 0.768 / 0.771 / 0.729 | 0.570 / 0.561 / 0.535 | 0.676 / 0.584 / 0.409 |
| p10 – p90 spread | 0.25 / 0.39 / 0.36 | 0.50 / 0.47 / 0.61 | 0.52 / 0.54 / 0.67 |
| thick body (α > 0.995) | 0.814 / 0.785 / 0.744 | 0.627 / 0.578 / 0.563 | 0.646 / 0.521 / 0.328 |
| thin fringe (0.05 < α < 0.6), luma, B/R | 0.45, 1.97 / 0.58, 1.46 / 0.53, 1.50 | 0.30, 2.81 / 0.37, 2.08 / 0.33, 1.95 | 0.57 / 0.58 / 0.52 |
| base third luma, B/R | 0.71, 1.11 / 0.69, 1.18 / 0.66, 1.03 | 0.50, 1.16 / 0.48, 1.42 / 0.44, 0.91 | 0.79, 0.98 / 0.73, 1.05 / 0.57, 0.89 |
| PT's darkest 20 %: luma, B/R | 0.60, 1.27 / 0.62, 1.30 / 0.58, 1.09 | 0.31, 1.83 / 0.34, 2.26 / 0.20, 1.21 | 0.40, 1.33 / 0.37, 2.19 / 0.16, 1.32 |
| detail energy, 4–16 px band | 0.0088 / 0.0164 / 0.0119 | 0.0083 / 0.0135 / 0.0140 | 0.0115 / 0.0159 / 0.0190 |

1. **Surface texture: the biggest finding.** On lit faces, ours carries 1.6–1.9× the reference's 4–16 px detail. At noon the tonal spread is 0.39 against 0.25.
   - The reference is soft: billows read as rounded masses with smooth light falloff.
   - The bake resolution is not the cause. A 1.25 m bake gives 0.0091 against 0.0088 for the 2 m one.
   - It is physics. At this extinction the mean free path is about 3 m. Multiply-scattered light spreads across several of those, so erosion pits 4–20 m across hardly shade at all.
   - Our direct term plus the 4 m micro-shadow tap shade each pit with single-scatter `exp(-tau)`. Nothing then fills the pit back in.
   - That is the "pebbly / foam / cauliflower" read. It matches your note that "shaping is drifting back toward foam".
   - Octave has less texture than Nubis (0.0119). Nubis's micro-shadow and glow occlusion add the rest.
   - At the 16–64 px lobe scale we are only 1.1–1.35× the reference. The large-scale lobes are about right.
2. **Thin fringes and wisps.** In the reference they are translucent: the sky shows through and they stay bluish (B/R 1.97 at noon). Ours paints them near-white and solid (luma +0.13 at noon, B/R 1.46).
   - About half of this is the phase function. A reference at our mean cosine (g 0.46) lifts its fringes from 0.45 to 0.53.
   - The rest is our glow and ambient lighting thin material. Our physical g is too low, and the glow terms boost what is left.
   - No dark "powder" rim appears in the reference at these angles. Front-lit edges simply go see-through. Our `edgeDarkening` and Takram's powder are not reproducing anything physical here.
3. **Interior brightness from multiple scattering.** It is close by day: Nubis is 4 % darker in the thick body at noon and 8 % darker at low sun. Backlit, it falls off: Nubis is 0.81× and octave 0.51× in the body.
   - Albedo is not the cause. Albedo 0.999 brightens the reference by only 2–3 %.
4. **Silver lining and backlit bodies.** The reference's backlit cloud is bright all through (mean 0.68, top 10 % at 0.94), because forward-peaked light carries through the whole body.
   - Our Nubis lighting gets the rim (0.90) but leaves the towers blue-grey (top third 0.50 against 0.63).
   - Octave goes dark grey (0.41).
   - A reference at g 0.46 drops to 0.53. So our dual lobe (0.2 at 60 % plus 0.85 at 40 %) has far too little forward scattering for a backlit body. Real cloud droplets are closer to g 0.85 overall.
5. **Base darkness.** By day the Nubis base matches within 3 %; octave's is 8–12 % darker.
   - Under backlight both are darker than the reference. In the reference the base glows from forward-scattered light: 0.79 against Nubis 0.73 and octave 0.57.
6. **Colour of shade.** In the reference, shade is a mildly blue grey: B/R 1.27 at noon, 1.83 at low sun on the darkest 20 %.
   - Nubis is too blue at low sun and backlit (2.26 and 2.19). Shade comes from the hemisphere-mean sky ambient with too little sunlight diffused into it.
   - Octave is too warm and neutral (1.21, and 0.91 at the base). Its octave sum keeps sun colour in the shade and its ambient share is small.
   - The reference sits between them and carries more diffused sunlight in the shade than either model.

## What it implies for the "odd" look
- **Not mostly Horizon.** Average brightness and the lit/base balance by day are right in Nubis. What reads odd is mesoscale: pitted lit faces (1), white solid fringes (2) and blue backlit masses (4, 6). Each is a measurable departure from the physics for this same density.
- **(1) is partly the house style.** Nubis's micro-shadow and floret occlusion were tuned toward Guerrilla's frames (D1 rounds 9–12), and Decima's frames do show florets. This test says that much floret contrast is not physical at our density, so Decima's look may be stylised there too. Whether to keep it is your call, by eye. Your "lit ridges crisp" rule is about silhouettes and lobes, which the reference keeps; it does not require pitting every face.
- **Cheapest likely wins** (each is one A/B round, not done here):
  1. Weaken the micro-shadow / floret occlusion by about half on lit faces.
  2. Add a stronger forward lobe (silver g 0.85 at 0.6–0.7 weight, or the existing Mie option) and re-check the backlit sheet.
  3. Make thin, low-density material see-through: no glow boost where the profile is small.
  4. Add a diffused-sun share to the shade (`diffuseSun` exists, 0 in the art look) so Nubis shade goes greyer.
  5. In octave, carry the sky ambient into the base instead of the sun colour.

## Limits
- One cloud (Parkouring), the flagship art look, the voxel runtime.
- **The HZD bench is not covered yet.** It uses procedural density with Nubis-from-profile lighting. A dense bake of a procedural patch fits the same page (`bakeDensity` takes any box); that is the obvious next run.
- **The deck and decima looks were not run.** Decima's extinction is 2/m, about 7× the path-tracer cost.
- The reference uses a single Henyey-Greenstein lobe. The path tracer has no dual-lobe or Mie phase, so the reference cannot use our exact phase. The g 0.8 vs g 0.46 pair brackets it.
- The low sun is 19.5°. Golden hour was not covered.
- No ground plane. Both sides see the same LUT below the horizon.
- The reference frames still show some grain at 4096 spp in the deep body. The Denoiser's OIDN was not wired in.
- Every capture logs one "Failed to load module script ... text/html" line. It appears to come from Vite's first-load dependency reload and did not affect any frame.

## Build notes
- **Sibling import:** `vite.config.ts` finds the sibling repo by walking up from the config until a directory has `pathtracer/packages/pathtracer/src/index.ts`. `PATHTRACER_DIR` overrides it. This works from the main checkout (`../pathtracer`) and from a worktree.
  - It aliases `@pmndrs/pathtracer`, `@pmndrs/raytracer` and `@pmndrs/bvh` (the copy the sibling's raytracer resolves) and adds the directory to `fs.allow`.
  - The page is a build input only when the sibling exists.
  - `pt-modules.d.ts` declares the API slice used, so `tsc` does not depend on the sibling.
  - The page reads the sibling's working tree, which currently has the NRC work uncommitted. Nothing in it was edited.
- **Capture:** `capture.mjs` gained `--eval-timeout <s>`, because a path-traced settle can take minutes. The command:

  `node scripts/gpu/capture.mjs --serve --page reference-pt/ --query "clean=1&spp=4096" --shots pt-noon,nubis-noon,octave-noon,... --settle 600 --size 1600x900 --format png --eval-timeout 1500 --out work/captures/PT1`

  Use `alpha-*` and `rtalpha-*` for the masks.
- **Path tracer:** driven entirely through its public API (`PtMegakernel`, `buildSceneCopy`, `buildTraceScene`, `brickMajorants`). Nothing needed changing there. Optional asks for that repo:
  - a dual-lobe or tabulated (Mie) phase function;
  - an `r16float` grid option, since the 2 m grid is 88 MB as r32float.
