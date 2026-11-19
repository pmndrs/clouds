# S1: style as a switchable axis on the HZD sky

Status: ready for review. Branch `worktree-agent-a63f6e674b2497d13` (not merged).

**Question.** The owner (2026-11-20): "Some of the early raymarch styles were excellent and we shouldn't drop them." Decision d1: the look target is "both, case by case". So the main procedural sky should be able to show more than one look, switched live.

**Answer.** The HZD bench now has a **Style** section in the sidebar (under Views) with three looks, and `?style=` for links and captures:

| style | what it is | changes over the bench defaults |
|---|---|---|
| `horizon` | the bench as it is | nothing (empty bundle: pixel-identical by construction, unit-tested) |
| `early` (label "early raymarch") | the September raymarch treatment: soft, bright, cohesive bodies, smooth large lobes | `hzd.noiseSet` nubis3 → **hzd**, `hzd.erosionStrength` 0.3 → **0.1**, `c.ambientFloor` 0.15 → **0.35** |
| `real` (label "photo weight") | first draft aimed at the photos, then (PT1) at the path-traced reference | `hzd.noiseSet` → **hzd**, `erosionStrength` → **0.15**, `lobeStrength` 0 → **0.6**, `extinction` 0.8 → **1.3**; `c.ambientStrength` 1 → **0.6**, `c.microShadow` 1 → **0.5**, `c.silverStrength` 0.4 → **0.65**, `c.diffuseSun` 0 → **0.3** |

No shader changed. Every value is a setting the tune panel (T) already has, so either look can be taken apart by hand. No method was removed.

## How it works
- `packages/runtime/src/procedural/styles.ts`: the bundles (`PROCEDURAL_STYLES`), per settings object (`proc`, `hzd`, `ndf`, `cloud`), with the reason for every value in comments. `captureStyleBase` / `applyProceduralStyle` put the page's own values back for every key any style sets, then apply the style's. Tests: `styles.test.ts` (horizon changes nothing; every key exists; switching around and back restores the page exactly).
- `examples/lab/hzd/bench/style.ts`: takes the page's values once when the sky starts (before the URL's setting keys, so `hz_...` in a link still wins over the style), applies the style, and **rebases the tuner** (`tune.ts` `rebase`): the tune panel's amber names, its resets and the URL's setting keys are then relative to the style, and the URL carries `style=early` instead of a dozen keys.
- `examples/lab/hzd/app/StyleSection.tsx`: the switch, its own small component (one line in `Sidebar.tsx`), so a "render level" section can sit beside it without conflicts. Hover a style for what it is for.
- `url.ts` reads and writes `style` (`horizon` is not written); the HUD and the capture report show it.
- References: PT1's three sheets (path traced | Nubis | octave, at noon, low sun, backlit) are in the bench's Reference picker under "Path-traced reference (PT1)", with the matching sun. They are another cloud (Parkouring), so compare softness, fringes, shade colour and backlit glow, not shapes.

## What the early raymarch did (packages/legacy/three/src, examples/lab/legacy)
- **Density.** Cloudscape (`cloudscape/shaders.ts`): smooth voxel forms from a shared atlas, linearly filtered, plus a 0.16 sine "detail". Realism (`volumetric/realistic-shader.ts`): a weather column, one shape noise (3 km), one cellular erosion (600 m) scaled 0.2 → 1.1 with height, then a `smoothstep(±edge)` boundary. Large-scale, light erosion; no fine grain anywhere.
- **Lighting.** Cloudscape: `ambient + sun · HG(g 0.45) · T_sun`, a constant sky ambient (0.28/0.34/0.43 against a 10.5/10/9 sun), so a shaded side kept about 40 % of the lit one. Realism: four octaves (attenuation × 0.35, energy × 0.5), a two-lobe phase 0.82 · HG(0.65) + 0.18 · HG(−0.25), a height-graded ambient, powder only away from the sun. ACES exposure 0.85, strong distance haze (0.75 toward the horizon colour over 18 km).
- **Against the current bench** (`work/captures/S0-legacy/hzd-gp7-now.jpg`): the bench erodes with Nubis Cubed Alligator at full strength and a sharpen (the "foam"), and lights the body with an ambient that dies with the density above to a 0.15 floor (blue-grey, contrasty shade).

## Rounds (one change per step, A/B sheets; frozen motion, `clean=1`)
Sheets per round: `work/captures/S1/<round>/ab-*.jpg` (full frame plus 1:1 crops of a lit ridge and a base, yellow boxes mark the crops).

**early**
- r1 `early-r1/ab-e0-e2-*.jpg`: Nubis Cubed at strength 0.4 removes the foam but bares a fine diagonal **hatch** on lit faces. `hatch/hatch-gp7.jpg`: the hatch is the march sampling a hard surface (it shows with no detail noise at all, `stage 2`); `n3Sharpen 0` hides it at about 2× the sky cost. Not used.
- e1 `early-r2/ab-e0-e2-*.jpg`: **HZD Worley detail at erosion 0.1**: smooth large lobes, crisp lit silhouette, no hatch. Kept.
- e2: extinction 0.4: blurry everywhere and 2–3× the sky cost. Rejected.
- e3b / e6 `early-r2/ab-e1-e3b-e4-*.jpg`, `early-r3/ab-e1-e5-e6-*.jpg`: ambientFloor 0.6 flattens the shade to grey and shows the shape's contour lines; **0.35** brightens the bodies and keeps their form. Kept 0.35.
- e4 lobe rung 0.4, e5 msStrength 0.7: no clear gain. e7 `early-r3/ab-e6-e7-*.jpg` haze 0.15: milky, lowers ridge contrast. Rejected.

**real**
- r1/r2 `real-r1/ab-r0-r2-*.jpg`: Nubis Cubed at 0.6 (less foam but a torn, hatched surface), extinction 1.3 (crisper, denser). The noise rejected, the density kept.
- r3/r3x `real-r2/ab-r2-r3-*.jpg`: **HZD detail 0.15 + lobe rung 0.6** (H7's billowy octave between body and grain): dome-scale lobes, clean rims. Kept, with extinction 1.3.
- r4–r8 `real-r3/ab-r3x-r5-*.jpg`, `ab-r4-r7-*.jpg`: **ambientStrength 0.6** darkens the bases (kept). deepScatter 0.6 darker but bluer (not kept). ambientSaturation 0: no visible change. Diagnosis (`real-diag`): the shade's blue is the atmosphere's **aerial perspective** (shade B/R 1.9 with it, 1.1 without; the cloud lighting alone is neutral grey). Haze 0: 1.94 → 1.90. Not a cloud-lighting fix.
- PT1 round `real-pt/ab-p0-p1-*.jpg`, `ab-p1-p4-*.jpg` (after the path-traced reference): **microShadow 0.5** (lit-face 4–16 px detail 0.0170 → 0.0155 on gp7), **silverStrength 0.65** (brighter backlit rims at sunset, no change front-lit), glowBoost 0 (darkens the backlit body: the opposite of PT1's finding 4; **not kept**), **diffuseSun 0.3** (shade B/R 1.93 → 1.58, greyer, and lifted). Numbers: `python3 scripts/s1/metrics.py`.

## Final sheets
`work/captures/S1/final/styles-{gp7,ground,above,sunset}.jpg` (horizon | early | real; frozen). The task's own capture command (`--query style=<s>&clean=1`, motion on) is in `work/captures/S1/{horizon,early,real}/`.

Numbers (`scripts/s1/metrics.py`, frozen frames; lit-face detail = 4–16 px band energy on lit cloud away from the silhouette, PT1's measure; shade = darkest 15 % of the base crop):

| view | horizon detail / shade luma / B/R | early | real |
|---|---|---|---|
| gp7 | 0.0207 / 0.43 / 1.73 | 0.0187 / 0.52 / 1.43 | **0.0141** / 0.45 / 1.58 |
| ground | 0.0201 / 0.43 / 1.71 | 0.0152 / 0.53 / 1.43 | **0.0133** / 0.45 / 1.58 |
| sunset (backlit) | 0.0184 / 0.46 / 0.90 | 0.0220 / 0.51 / 0.93 | 0.0219 / 0.42 / 0.88 |

PT1 measured our lit faces at 1.6–1.9× the reference's texture; real takes about 0.68× of horizon's off on gp7 and ground.

GPU ms, sky layer, 1920×1080 ultra, one frozen run each (`final/*/capture.json`), the machine shared with other agents' captures:

| | gp7 | ground | above | sunset |
|---|---|---|---|---|
| horizon | 29.6 | 25.4 | 26.7 | 29.1 |
| early | 33.0 | 33.1 | 35.4 | 35.2 |
| real | 29.6 | 25.2 | 45.8 | 35.1 |

Across all rounds the same horizon settings measured 25–49 ms on gp7, so these differences are inside the noise. No style changes the step count or the taps; extinction 0.4 (rejected) was the only change that clearly cost more (2–3×). The motion-on runs (`work/captures/S1/{horizon,early,real}/capture.json`) overlapped another capture job and read 35–60 ms; do not use them for cost.

## Judgement, by eye
- **gp7 and ground (front/side lit, the main views).** early is what was asked for: the foam is gone, the bodies read as big soft cohesive masses with brighter shade, and the lit silhouette stays crisp. It is the closest of the three to the legacy cloudscape/realism pages, and also to PT1's ground truth. real is the best-looking of the three to me here: dome-scale lobes, crisp white rims, greyer shade, lit faces the smoothest of the three (closest to PT1). horizon still has the most surface detail, and in these crops it is the foam the owner described.
- **above.** Both new looks read as a soft white mass from above, flatter than horizon. horizon's foam at least gives the tops texture. Worse for early and real; this view needs lobe shading that neither look has yet.
- **sunset (backlit).** horizon is the most natural here. early prints a uniform bright outline around every body (a "cut-paper" rim: smooth density plus the silver lining, nothing to break it up): worse than horizon. real has less of it, and its brighter forward lobe gives better backlit rims than early, but it is not better than horizon at sunset.
- **Overall.** early: better than horizon from the ground and at gp7, worse from above and at sunset. real: better at gp7 and ground, about even at sunset, worse from above. Neither replaces horizon; that fits d1 ("case by case").

## Open issues
- **Hatch on bared surfaces.** With the foam gone, the sky march prints a fine diagonal hatch on hard lit faces (the jitter sampling the edge ramp). The early and real looks keep it faint with the softer HZD detail; it is a sampling issue for the march, not a look setting.
- **Shade blue is the atmosphere.** Aerial perspective, not the clouds, makes the bases blue at 3–6 km (B/R 1.9 vs 1.1 without). The photos' bases are greyer. A clouds-only aerial-perspective weight would fix it but breaks consistency with the terrain; it belongs to the scene's atmosphere (turbidity), not to a cloud style.
- **real vs the photos' "darker bases".** After PT1 the real style's shade is greyer but slightly lighter than horizon's (diffuseSun lifts it). PT1 says daytime base brightness is already right within 3 %, so I leaned toward the reference; ambientStrength 0.6 is the knob if the owner wants heavier bases back.
- **PT1 levers not done.** "No glow boost on thin material" needs a shader option (glow weighted by the profile); as a global it darkens backlit bodies. "Stronger forward phase" was done through silverStrength only; `phaseModel mie` was not tried. The early style could take the same PT1 levers (it already shares PT1's soft, cohesive read).
- **early at sunset** draws a uniform bright outline around every body (smooth density, nothing breaks up the silver lining). A next step for early: some of horizon's edge breakup at low erosion near the rim, or PT1's see-through fringes.
- **From above** both new looks read as a soft white mass (the `above` view is front-lit): the lobes lose their shading where horizon's foam gave it texture.
- **GPU timings are noisy** on this Mac (the same settings measured 25 and 71 ms in two runs, and other agents capture at the same time). The ms below are single runs.
