# Status: what's running, what's waiting on you, what landed

The one page to check. Everything left to do, by track: `work/ROADMAP.md`. Updated by the orchestrator at every merge. Details live in the linked reports. The bench is at http://localhost:5180/hzd/ (T opens the tune panel).

Updated 2026-10-13.

## Running
Nothing.

Your notes (2026-10-22): LH1 no visible change (confirmed bug); SH1a shadows still change quickly, want a crossfade; SH1b no clear difference but new sparkle on ridges; storms trusted. **Shaping is drifting back toward foam, not clouds**: revisit as a tuning pass once the phases are through (ROADMAP P18).

## Waiting on you

### A. Review the defaults that agents chose
**Flip them on the bench:** the sidebar's "Review: old vs new" section has an old/new switch for each (hover a name for what it does and which tune-panel group has it). The links below open the same states. Say "keep" or "revert" for each.

Your answers (2026-10-22): **A1 keep** (Alligator is better), **A2 keep**, **A3 keep** (stays a tunable value), **A4 keep**, **A5 keep for now** (more detail, but the hue is far too strong: tune later), **A6 keep** (but the cloud shadows jitter as they update), **A7 keep**, **A8 and A9 trusted** (need painting to judge).

| # | What changed | Who chose | Old look | New look |
| --- | --- | --- | --- | --- |
| A1 ✅ kept | Cloud-detail noise: Nubis Cubed (Alligator) replaces the HZD Worley noise, which fixes your "sprinkles" (N1) | agent + orchestrator, from close-ups | [old](http://localhost:5180/hzd/?view=gp7&hz_noiseSet=hzd) | [new](http://localhost:5180/hzd/?view=gp7) |
| A2 ✅ kept | Weather map: Nubis 2017 layout (clusters with clear lanes) replaces the H6 even field (W1) | agent + orchestrator, from sheets | [old](http://localhost:5180/hzd/?view=high&hzn_recipe=h6) | [new](http://localhost:5180/hzd/?view=high) |
| A3 ✅ kept | Cloud density (extinction) 0.5 → 0.8, to bring back surface texture with the tables (F2) | agent | [0.5](http://localhost:5180/hzd/?view=above&hz_extinction=0.5) | [0.8](http://localhost:5180/hzd/?view=above) |
| A4 ✅ kept | Per-area cloud bases on the map: crisp under cumulus, soft under stratus (F2) | agent | [off](http://localhost:5180/hzd/?view=ground&hzn_bottomTypeRange=0) | [on](http://localhost:5180/hzd/?view=ground) |
| A5 ✅ kept | Lighting: the HZD bench now lights with Nubis Evolved lighting from the exact profile, replacing the Takram-style octave model (C1). Bodies are greyer-blue with more shading and brighter rims; the exact and stand-in profiles look nearly the same at this scale. Sheet: `work/captures/C1/sheet-gp7.jpg` | agent + orchestrator, from sheets | [octave](http://localhost:5180/hzd/?view=gp7&light=octave) | [Nubis](http://localhost:5180/hzd/?view=gp7) |
| A6 ✅ kept | Time-lapse: the sky's frame-to-frame blend now follows the wind (C2). The streaky smear is gone, but at fast time-lapse clouds are still softer and slightly blocky against a render without the blend. Sheet: `work/captures/C2/mid_off_on_notemporal.png` (off / on / no blend) | agent + orchestrator | [off](http://localhost:5180/hzd/?view=ground&sky_temporalCloudMotion=false) | [on](http://localhost:5180/hzd/?view=ground) |
| A7 ✅ kept | Mid-level clouds: when altocumulus or altostratus is switched on (still off by default), they now use 'hybrid': the volume up close fading into a 2.5D layer read from the map at distance, which removes the clip line and saves ~2 ms (L3). Far away the layer is fainter and sparser than the volume. Sheet: `work/captures/L3/sheet.jpg` (volume / layer / hybrid) | agent | volume: add `&hz_midLayerMode=volume` | hybrid: default |
| A8 ✅ trusted | Painting: a painted map now blends over the generated sky through a painted influence mask (paint just a hole by the sun, the rest stays generated) instead of replacing it; 'replace' kept. Plus five weather states (clear, cumulus, towering, stratocumulus, overcast) with 10–30 s transitions and an auto cycle; their numbers are by eye (W2). Sheet: `work/captures/W2/W2-sheet.jpg` | agent | replace: `ndf.paintBlend` = replace in the tune panel | influence: default |
| A9 ✅ trusted | Storms (STORM1): a paintable storm area in the map, a downwind anvil plate and anvil cirrus, darker denser storm lighting and optional lightning. **Not made the default:** the anvil plate is less clean than F1's mushroom and the anvil cirrus reads as torn streaks, so storms still use F1's placed cell unless you choose 'map'. The `storm` view shows the new one. Sheet: `work/captures/STORM1/STORM1-sheet.jpg` | orchestrator kept the old default | [old cell](http://localhost:5180/hzd/?view=storm&hz_stormSource=cell) | [new map storm](http://localhost:5180/hzd/?view=storm) |

You already chose these: the profile tables as the default, and the 32 km map.

### A2. New this round (2026-10-22): flip each in the bench sidebar's Review section
Agents made likely choices; these are the defaults now unless noted.

| # | What | Default now | Verdict |
| --- | --- | --- | --- |
| LH1 | Nubis shade hue: shaded sides lit by a much less saturated sky light (`ambientSaturation` 1 → 0.15 on the HZD bench). Shade went from strong blue to slightly cool grey, detail unchanged | new | fixes your "hue is super strong"; `diffuseSun` (tune panel) adds warm light to the shade if you want it greyer still |
| SH1a | Cloud shadows on the ground slide with the wind between refreshes instead of stepping (`shadowMap.advect`) | new | fixes the jitter by the numbers (frame-to-frame change 0.25 → 0.01); judge by eye in time-lapse; shadow map costs ~0.7 ms more |
| SH1b | Sharper frame-to-frame blend (Catmull-Rom history, `sky.historyFilter`) | new | less softening in fast motion, no ringing seen |
| CI1 | Cirrus coverage and type vary per area from the weather map (`cirrus.source`) | new (cirrus itself is still off on the bench: the switch turns it on) | just different, not clearly better in one frame |
| ST2a | Storm anvil: a smooth plate with a thinning rim and fibrous cirrus, replacing STORM1's lumpy one | new, for the map storm | better than STORM1, but **the old placed cell stays the storm default**: its mushroom still reads cleaner from far away |
| ST2 | Storm rotation (NE22's rotating rings) | **off** | costs ~3.6 ms and the blend smears it until we have motion vectors |
| PF1 | Skipping clear areas of the map in the ray march (`hzd.emptySkip`) | exact (pixel-identical) | no gain on the default map (97 % of it has some cloud), 10–20 % on sparse maps; 'free' reaches further but changes the far horizon |

PF1 also timed the sky: the thin veil is 30–40 % of the sky pass and the detail noise 25–35 %; light taps are small. Those are the targets for the performance pass. See `work/reports/PF1.md`.

### A3. FX1 fixes (2026-10-22), flip in the Review section
- **LH1 now works live.** Two bugs: the tune panel clamped values to a guessed slider range and wrote them back (your 1 became 0.6), and changes faded in over ~100 frames because the sky layer's history wasn't reset. Every Review switch was clicked by a script and changes the frame at once.
- **Shadows crossfade continuously** (FX1a–c): the fade now spans the whole 12-frame refresh, so the shadow always morphs and never lands in a step. Sliders for refresh and fade frames.
- **The sparkle came from SH1b's sharper filter** (it doubled the specks at normal speed). New default `adaptive`: the old bilinear at normal speed (same speck level as before this week), the sharper one only in time-lapse. SH1b has all three options. Sheet: `work/captures/FX1/sparkle-ab-sheet.jpg`.

### B. One taste choice
| # | Question | Try |
| --- | --- | --- |
| B1 | Cumulus height with the tables: standard (0.4, Nubis Evolved's value) or towering (0.6 / 0.75)? | [0.4](http://localhost:5180/hzd/?view=gp7) · [0.6](http://localhost:5180/hzd/?view=gp7&hz_tableTypeCumulus=0.6) · [0.75](http://localhost:5180/hzd/?view=gp7&hz_tableTypeCumulus=0.75) |

### C. Approve the next work (one yes covers the list, in order)
1. ~~**Nubis lighting for the HZD sky, from the exact profile.**~~ Done (C1), review as A5. The procedural sky knows each sample's height profile and map coverage exactly, so it can light like Nubis Evolved without the voxel data. Today it uses the Takram-style "octave" model by default; its Nubis option uses a stand-in that mixes in the noise. The NVDF sky layer already does it exactly (coverage × table, depth from the gradient); C1 moves that into the HZD sky. The octave model stays as an option. This is likely part of the "toon" look.
2. ~~**Cloud motion in the temporal blend.**~~ Done (C2), review as A6. Follow-up: a sharper history fetch (bicubic) for the remaining softness at fast time-lapse. Fixes the time-lapse smear; it's also the first step toward your upscaler (U1).
3. ~~**Altocumulus, altostratus and cirrus as 2.5D layers read from the map (L3).**~~ Done for altocumulus and altostratus (review as A7). Cirrus still uses one type for the whole sky; its fade is cov² where NE22 uses cov³ (option `cirrus.coverageFadeNe22`). Removes the visible layer edge, cheaper.
4. ~~**Influence painting (W2):**~~ Done (review as A8). Known gaps: hero shadow caches don't follow a transition. paint over part of the generated sky instead of replacing all of it, plus weather states.
5. ~~**Storm package:**~~ Steps 1–3 done (review as A9), rotation not started. Needs a better anvil shape before it becomes the default. an authored storm area, a proper anvil, storm lighting, rotation.

Parked:
- The Houdini camera rig (for the Decima work, when it resumes).
- **The performance pass, after parity.** Culling, distance and LOD as they stand, what the papers say about distant clouds, and the candidates: `work/reports/PERF-LOD-audit.md`.
- Footprint (connected or islands) and the motion policy: these are per-scene choices with fine defaults.

## Where we differ from Nubis Evolved, and whether it's worse
Status of each from `docs/research/ne22-coverage.md`, in plain terms:
- **Painted maps:** now blend over the generated map with an influence mask, as theirs do (W2). Weather states exist; theirs are regional sets, ours are whole-sky states.
- **Density formula.** Ours is HZD's (GP7) remap; theirs subtracts the inverted profile from the noise. Neither is known to be worse; it's a look choice to A/B (later, with the lighting).
- **Lighting from stand-ins.** The Nubis lighting needs to know how deep inside a cloud each sample is (the "profile"). Voxel clouds store that; our procedural sky estimates it, and by default doesn't use Nubis lighting at all. Theirs computes it exactly from the same height profile and coverage. Ours is worse, for historical reasons: the procedural path came from the Takram port. To do: C1.
- **Storm.** Ours now has a painted storm area, anvil and lightning glow like theirs, but our anvil shape is worse than F1's old one and there is no rotation yet. Ours is worse.
- **Cirrus.** Ours has one type and coverage for the whole sky. Theirs reads coverage and type from the map, so it varies by area. Ours is worse. To do: C3.
- **Mid-level layers.** Ours are volumes that show their edge at distance. Theirs are 2D / 2.5D. Ours is worse at distance. To do: C3.

## Landed (newest first)
| When | What | Tag / report |
| --- | --- | --- |
| 10-22 | LH1, SH1, CI1, ST2, PF1 (hue, shadow jitter, sharper blend, cirrus from the map, anvil and rotation, clear-sky skipping) | `stable-2026-10-22`, `work/reports/{LH1,SH1,CI1,ST2,PF1}.md` |
| 10-22 | FX1: live settings, shadow crossfade, sparkle fix | `work/reports/FX1.md` |
| 10-22 | Bench: Review section with switches; ground view at 250 m | — |
| 10-15 | STORM1: painted storm area, anvil, storm lighting (old cell stays the default) | `work/reports/STORM1.md` |
| 10-15 | W2: influence painting and weather states | `work/reports/W2.md` |
| 10-15 | L3: mid-level clouds as 2.5D layers at distance | `work/reports/L3.md` |
| 10-15 | C2: the temporal blend follows the wind | `work/reports/C2-temporal-motion.md` |
| 10-15 | C1: Nubis lighting from the exact profile on the HZD bench | `work/reports/C1-hzd-light.md` |
| 10-13 | All worktrees merged and removed; only `main` remains (plus this session's own checkout) | — |
| 10-13 | Culling / distance / LOD audit (read only) | `work/reports/PERF-LOD-audit.md` |
| 10-13 | N1: Nubis Cubed noise (the default), HZD noise kept | `stable-2026-10-13`, `work/reports/N1.md` |
| 10-13 | Nubis Evolved audit and ranked plan | `docs/research/ne22-coverage.md` |
| 10-12 | React HZD bench with the map painter (your other session) | `work/HZD-BENCH.md` |
| 10-12 | F2: tables as default, fast; per-area bases; 32 km map | `stable-2026-10-12b`, `work/reports/F2.md` |
| 10-12 | F1: storms, mid-level layers, fractus, tables (all off) | `work/reports/F1.md` |
| 10-12 | W1: Nubis 2017 map, painted maps, motion policies | `work/reports/W1.md` |
| 10-12 | The HZD bench | `work/HZD-BENCH.md` |
