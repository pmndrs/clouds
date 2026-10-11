# Orchestrator handoff (2026-10-11, paused for the week)

The project is paused until next week: the weekly model limit was reached (it resets on 15 Oct at 12:00 Tokyo time). Start here, then read `work/reports/D1.md` (§10–16 and its "resume here" list), `work/calibration/d1k-results.md` (the latest judged round) and `work/reports/D1-florets.md`.

**Review of the pause (owner-facing):** https://claude.ai/artifact/UfkrDuARTKY61vDBUXfmBt (source `work/review/d1-review.html`).

**Rounds overview (living page, update it every round):** https://claude.ai/artifact/VqPT2dzg3uFNXpcvnMQRQw (source `work/review/rounds.html`).

## Where we are

**Owner priority: D1 parity first.** All other renderer work is paused until our render of Guerrilla's own clouds (Parkouring, Stormbird; the NVDF pack assets) matches Decima's frames. Fable leads D1 with a free hand (the deck and art looks are both just inputs, sky changes are allowed, no Karma port). The HZD/procedural branches may continue later: pure procedural, newer Nubis methods, hybrids, LOD and fog.

- **Score:** both blind judges give a steady 3–4/10, "same cloud, different engine", over 12 rounds. Round 11 was the first clear win since round 8 (11 of 16 calls against r9). **Round 12 is done but not yet judged:** blind set `scratchpad/blind-d1l/` + key `blind-d1l-key/key.json` (Decima / r11 / r12, every source through JPEG q90). The scratchpad is session-local and may be gone next week; if so, rebuild the set from the captures (the D1 agent's recipe is in the report). Copies of every blind set and key (d1f–d1l) are kept locally in `artifacts/research/d1-parity/blind/` (main checkout), and the session scripts are preserved in `scripts/d1/session/` and `scripts/d1/florets/`.
- **The look lives in** `CLOUD_DECIMA_SETTINGS` (`packages/runtime/src/runtime.ts`) plus the per-frame scene settings in the parity page's `refs.ts` (cameras, suns, exposures, sky ramp, `sunTint`, Parkouring `lightDensityScale` 0.045). Captures: `work/captures/D1/{parkouring,stormbird}`; sheets (local only): `artifacts/research/d1-parity/sheets-r*/`; scripts: `scripts/d1/` (d1.py bands3, sunsweep, termfit, camfit, postfit), plus the floret metric `florets.py` (copy it from the scratchpad into `scripts/d1/` next session if it is still there; the D1-florets report has its definition).
- **What was learned (12 rounds):**
  1. Light units: the deck's light sums are in "density samples"; our in-line taps were 10× too strong and the light grid 1.44×.
  2. Disc blotches: the dimensional profile's lobes showing through the glow (ms) term. Fixed by reading the glow's P deeper along the ray (`glowDepth`) and by weighting it with density (`inScatterProfile` 0.5 = P·√S), which also removed most of the Stormbird slit, ring and pits.
  3. **Wind smears florets:** the noise scrolls with the wind, and the temporal resolve reprojects only through the camera. The parity stills stop the wind. Reprojecting through the noise cannot fix it, because the florets change shape as the noise slides over a static profile. The product will need a lower blend under wind (a performance-pass item).
  4. **Florets:** the geometry is there. They lacked floret-scale sun occlusion: the micro taps at 4 m and 4–8 m, plus the glow occluded by the up-rez excess. Hollows come from erosion (`detailBias` 0.1), not from occlusion.
  5. The sky: the frames' horizon band is painted as a smooth 8-stop ramp, in the sky only. In the ambient it over-lit the bellies.
  6. Colour: a per-scene sun tint apart from the sky (`sunTint`) gives the Parkouring pink. On Stormbird the lit faces sit on the ACES shoulder, which limits the tint.
  7. Asset time: the NVDF has no evolution, and the noise scroll never changes the leg, the holes or the extra fragment. So the frames show a different authoring state of the asset than the pack we have, and silhouettes should be scored with that in mind.
- **Open, in order** (also the judges' gaps):
  1. Cauliflower hierarchy: domes on domes down to 1–3 px grain, with hollows. Our relief is still single-scale, and the frames carry about 30 percent more 1–3 px grain even through matched JPEG.
  2. Stormbird lit level and pink (the ACES shoulder).
  3. The p213 base edge against the haze band.
  4. Shade artefacts: the s206 glow disc, ochre blotches, the s33t3 ring and slit.
  5. Serrated chalky rims versus fibrous, pink-rimmed edges.
- **Process that works:** one change at a time, each with its own A/B crop sheet against the round's anchor. Only visual winners go into the bundle. Then both judges (Opus and Fable) score blind: full frames plus zoom crops, the same JPEG treatment for every source, and decoded results in `work/calibration/d1<x>-results.md`. Bundled rounds regressed twice (r7, r10). Metrics: band std at 1–3 / 4–12 / 12–32 px on the lit half, plus floret blob count and dark fraction. Neither replaces the eye; the owner's eye is final.

## Targets and the asset (owner, 2026-10-11)

- **Primary targets: p213 and s214**, the renders published with the pack on slide 191. Until now the blind sets used p101, p213, s206 and s33t3, and never s214. Slide 78's image101/102 (p101/p102) and the turntable frames stay as secondary checks.
- **The asset is exact.** Our converted clouds (from the pack VDBs) equal the pack's TGA slices voxel for voxel: R, G and B identical on both clouds, 45,301 and 102,627 voxels, mean difference 0. The noise was already checked bit for bit (P1). The input is not the gap.
- **Next: a Houdini camera match.** Guerrilla published no cameras. Load the pack VDB in Houdini with each frame as the camera's background plate, match the camera by eye (or have the owner do it), and export position, aim, focal length and aperture to `refs.ts`. That replaces the silhouette fits, which confuse distance with field of view.
  - A Karma render of the raw profile from the same camera, set against our `p102`-style raw render, also checks our projection, placement and axes exactly.
  - Karma cannot render the Nubis up-rez, so it gives camera and geometry truth, not Decima's look (K1 was dropped for that reason).

## Owner hypothesis: the cameras, not a different asset state (2026-10-11)

The owner suspects the silhouette differences (the s206 leg, the holes, the extra fragment) come from our cameras, not from a different authoring state.
- Guerrilla published no camera data. Every shot's camera was fitted from the silhouette alone: `d0.py fit`, then `camfit.py`, matte IoU 0.85–0.93.
- A silhouette fit cannot separate distance from field of view, so a wrong perspective with the right outline is plausible.
- The pack fixes the scale at 8 m voxels (N3 s71–73; `voxelSizeMeters` 8 in the asset).

How the cameras were fitted (D0, `scripts/d0/d0.py fit`):
- The camera sits on a sphere around the cloud's density centroid, at a yaw and elevation, with the distance taken from a coarse list of multiples of the cloud's radius.
- A proxy silhouette is rendered at a fixed 40° vfov, and a 2D scale and shift match it to the frame's mask. The scale becomes the vfov and the shift becomes the aim.
- So distance and field of view were never solved separately: the field of view absorbed the size. `camfit.py` (D1) then hill-climbed eye, target and vfov on the outline overlap, which barely responds to perspective.
- The camera height comes out of the elevation angle times that distance. Nothing fixed it independently: not the horizon line in the frames (which sets the pitch), and not the cloud's real altitude (we place the base at 500 m, `CLOUD_BASE_HEIGHT`).
- All the frames are 16:9 (3840×2160 or 1920×1080), so the aspect matches if the slides show uncropped frames.

Test with the panel's `vfovKeepSize` (dolly zoom) and `roll` on s206 and s33t3, plus a camfit pass that scores interior features (holes, the leg) and not only the outline.

## Owner tuning by hand (2026-10-11)

All the commands (the bench, captures, measures, round tools) are in `work/D1-TOOLS.md`. The bench also shows Guerrilla's frame against ours: press R for the compare view.

The owner may tune by hand during the pause. The Decima parity page (`/decima/`; `pnpm dev --port 5180`, because 5173 is used by the owner's other projects) has a tuning panel (`T`, `examples/lab/decima/tune.ts`). It exposes every runtime setting and each shot's scene values as live dials, and supports presets. **Before restarting the agents, check `work/presets/`** for exported presets, and ask the owner for any presets still only in their browser. Treat them as the owner's direction: a hand-found setting beats our measures, and the next rounds should start from it.

## Owner hypothesis to test first: a near-sunset sun (2026-10-11)

The owner believes the pink comes from Guerrilla setting the time of day near sunset on purpose. Their deck cover and other hero shots are clearly at sunset; the midday sun we fitted is the doubtful part. Our `sunTint` is a stand-in for this. Facts so far:
- Every sun sweep so far tested elevations of 15° and above only (`sweep6`: 15–75°; `r10i`: 25–55°). Nothing near sunset (2–12°) has been scored.
- A quick look on the bench: physical sun colour, no tint, p101 at azimuth 210. At 8° the cloud goes orange and dark; at 15° it turns warm, but the shade pattern moves to the side and the left mass falls into shade. A low sun therefore needs its own azimuth, probably behind the camera to keep the frames' front-lit faces, plus a per-sun exposure refit.

Test (one change, with A/B sheets):
1. Run `sunsweep.py` at elevations 2–15° over all azimuths, with `@suntint:1:1:1` and the exposure refit for each sun.
2. Score the shading (corr and lit IoU) plus the lit faces' R−B / R−G against the frames.
3. If a low sun explains both the shading and the pink, replace `sunTint` with it. That also tells us what the sky's colour should be.

## Read, not acted on: stochastic texture filtering (2026-10-11)

The owner asked whether NVIDIA's "Filtering After Shading With Stochastic Texture Filtering" (Pharr et al. 2024) helps. The note and the verdict are in `docs/research/sources/stochtex.md`.

**Not a D1 lever.** Its two levers are:
- better reconstruction of the 8 m grid (tricubic);
- less prefiltering before the nonlinear erosion (noise mip).

D1 already tried both (`profileFilter` 3, `lightGridFilter` 1, `mipDistanceScale` 0.0005, noise mip 0) and saw no visible change. Decima itself filters before shading with hardware trilinear. Don't spend a round on it.

**Where it does fit:** keep it for the hero-brick / imported-VDB work (no brick borders, one-tap tricubic for coarse sims) and for the performance pass. The two Shadertoys the owner linked (clXXDs, MfyXzV) are still unread: Shadertoy's Cloudflare check blocked the agent's browser.

## Next steps, in order

1. Judge round 12 (both judges, set l) and record `d1l-results.md`. Round 12 is committed (c6b7ee5, 64d322d, 0fe2cf8); the tree is clean and passing. Fable's own priority list is in D1.md §16, "Resume here": the shade's range (deep-shade fill), the Stormbird lit level (a per-cloud tone curve), a per-octave erosion amplitude for the cauliflower hierarchy, the base fringe and thin material, then the shade artefacts.
2. Ask the owner whether they want to look at the latest crops themselves. Offered three times, unanswered: the judges have been split by half a point for several rounds.
3. **Cost:** Fable used the week's limit. D1 rounds are about 0.4–1 M tokens each, plus about 0.4 M per pair of judges. Consider:
   - Opus for D1 implementation rounds, with Fable kept for judging and for specific hard problems
   - one judge per round, with both only on bundles we intend to keep
   - narrower rounds (two or three changes)

   Agree the budget with the owner before restarting.
4. Round H is complete (H5 accepted 2026-10-11). The rest of the top 20 is planned on the board as W1, W2, L2, A4, S7 and R2 (section "Next from the top 20"). They are gated on D1 and the owner's go.
5. Continue D1 from the open list above. When parity is "good enough" by the owner's eye, recommend NVDF-volume defaults from the decima look and resume the queued work:
   - M-like material for imported VDBs
   - the HZD sky: fractus skirts per body from the belly line, held until the renderer baseline is right
   - fog: procedural and SDF
   - Round W: weather/NDF map, paint page, valley fog
   - Round S: the Santa's Sleigh multi-body scene, with multi-volume support
   - Round A: authoring quality
   - Round P: the performance pass, which must handle the wind/temporal florets issue

## Housekeeping

- **Branch:** everything is on `main` in the main checkout (`/Users/dex/Developer/WebGPUClouds`). On 2026-10-11 every branch and worktree was merged into it and removed: the research setup, the audit, the D0 agent, the snapshot, the photo catalogue and the perf notes. `master` was renamed `main`. There is no remote. Start new work from `main`.
- **Start here in the browser:** `pnpm dev` from the repo root, then `/`. The lab index has a Work section: the Decima bench with its shots, the docs viewer (`/docs/`, every note rendered and searchable), the other benches, and the review pages.
- **Local only (ignored by git, in the main checkout):** `assets/clouds/local/` (3.1 GB of converted test clouds), `work/captures/scratch/` (1.7 GB of agent experiments), and `artifacts/` (third-party frames, sheets, blind sets).
- **Owner review pages:**
  - Round H: https://claude.ai/artifact/RPabtz6qpXTh9nS9nfGMu5
  - Research: https://claude.ai/artifact/SUx3sFPuiHSBEARrFHhsfS

  Their databases hold the owner's answers.
- **Standing rules:**
  - Never touch port 5201.
  - Never commit Decima frames, slide images, EmberGen or Karma renders, or the owner's photos (they stay in `artifacts/`).
  - Never read `.env` / `FAL_KEY`.
  - Commit by pathspec with the attribution line.
  - Run python with `-I`.
  - Downloads need the owner's OK in chat.

---

# Earlier handoff (2026-10-10, early morning)

For the next orchestrator session. Read this, then `docs/research/topics/README.md` (topic map, combined top-20, all owner questions), `work/README.md` (protocol) and `docs/PLAN-2026-10-next.md`.

**Rounds overview (living page, keep it updated each round):** https://claude.ai/artifact/VqPT2dzg3uFNXpcvnMQRQw (source `work/review/rounds.html`). The older progress and roadmap artifacts (1XG5…, NVZp…) are stale.

## Round H (2026-10-10, afternoon)

All Round H tasks are finished and accepted (board section "Round H"; reports in `work/reports/`). Owner review page with the open decisions: https://claude.ai/artifact/RPabtz6qpXTh9nS9nfGMu5 (source `work/review/round-h.html`; database collection `answers`, docs `h5`, `direct`, `m1`, `free` with `{choice, note}`). Calibration and judging: `work/calibration/` (rubric v2; both Opus and Fable judge every look change; owner is final). Open decisions: (1) H5 sky A vs B, (2) imported VDBs render directly by default, (3) start M1 material (Karma numbers in `work/reports/V1.md`).

## State

- **Branch:** `claude/cloud-research-setup-10bf11` (worktree `.claude/worktrees/cloud-research-setup-10bf11`). It fast-forwarded from the audit branch's 0dbc220 and carries all of the research work below. The audit worktree is stale.
- **Research organisation is done (RS-0 to RS-6, plus RS-T, RS-V, RS-N).** No engine code changed. All agents are stopped.
  - 17 source notes in `docs/research/sources/` (n3 split by section plus the `n3.md` entry note with the deck-vs-runtime diff), 11 of them spot-checked by Opus against the sources.
  - 5 topic guides in `docs/research/topics/` with ranked try-next lists, merged into a combined top-20 in `topics/README.md`.
  - Owner photo studies: `docs/research/targets/santa-sleigh.md` (the hero is a multi-body merging line, not one tower) and `frog.md`.
  - Also: `native-implementations.md` (comparison only), `cloudpack-embergen.md` (EmberGen VDBs, Z-up), Houdini 21 cloud-node dumps in `artifacts/research/extracted/houdini/`.
- **Owner review page:** https://claude.ai/artifact/SUx3sFPuiHSBEARrFHhsfS (source `work/review/research-review.html`). Read its database with `ArtifactData`: `verdicts` (doc id = top-20 item id, `{verdict: go|hold|skip, note, rank}`), `answers` (`q01`–`q12` guide questions, `t01`–`t11` photo questions, `free`; `{text}`), `fetch` (`f01`–`f12` papers; `{choice: yes|no}`). The older review https://claude.ai/artifact/J3Ybc83B1HbCXwxjyQ3Fp4 was still empty on 2026-10-10.

## Next steps, in order

1. Read the owner's verdicts and answers. Ask before acting on partial answers.
2. Start the approved top-20 items as board tasks. Ranks 1–7 need no owner input (noise set bake, noise blur constant, the low/mobile near-detail gate bug, the `hzd` reference shaper, Nubis art-bias defaults, deck step size, curl on detail only).
3. Fetch the papers the owner approves (downloads need their OK).
4. Carry over: P9-E2 cirrus brush strokes and L2 library regrow are still paused (see below). L2 should switch to lens-seeded Pyro (authoring AU3).

## Owner direction added 2026-10-10

- **Takram is not the target.** HZD and the owner's photos are. Takram and Sky Pro are simplified single-type takes on HZD; never tune toward them.
- **Procedural mastery first**, Houdini authoring in parallel (Houdini has many cloud tools beyond Pyro), and save rigs as `.hip` files the owner can open.
- The hero is a scene of several bodies; see the target study.

---

# Previous handoff (2026-10-09, night)


For the next orchestrator session. Read this, then `work/README.md` (protocol), `docs/PLAN-2026-10-next.md` (roadmap and owner direction), `docs/research/README.md` and `docs/research/TRACKING.md`.

## State: everything is paused

All agents are stopped. Every change is committed, on branch `claude/webgpu-cloud-audit-8c9f29` in worktree `.claude/worktrees/webgpu-cloud-audit-8c9f29`. The last commits are f6d473d (research) and the commit that adds this file. `pnpm check` was green at P9-E (9f3ae2b); WIP commits since then have not been re-checked.

**Next steps, in order:**
1. **Research organisation (RS-0 to RS-6 in `docs/research/TRACKING.md`).** The owner asked for this before any new engine work. Start with RS-0 (extraction scripts), then RS-1 on `nubis/Nubis Cubed - 4k.pptx`, which the owner calls the greatest resource: full reasoning plus code.
2. **Read the owner's review.** The artifact is https://claude.ai/artifact/J3Ybc83B1HbCXwxjyQ3Fp4 (the page is `scratchpad/art/review/cloud-review.html` from the old session; the data is what matters). Read its database with the `ArtifactData` tool:
   - `pins`: `{item, x, y, text}`, with x and y as 0–1 fractions of the image;
   - `reviews`: one doc per item id (S1–S3, A1–A3, C1–C3, H1, H2, P1), `{verdict, note}`;
   - `answers`: one doc per question id (Q1–Q11), `{choices, text}`.
   The item and question texts are in the page; read it with `Artifact` `action: "read"`. The owner may not have finished; ask before acting on partial answers.
3. Then, with the owner, assess where we are and plan the next round. That includes the generator-framing session (Q3).

## What landed today (see each `work/reports/<id>.md`)

| Task | Result |
| --- | --- |
| X1, X2 | Procedural density model (Takram/Sky Pro shapers) in our runtime (`packages/runtime/src/procedural/`); a faithful Sky Pro pane |
| X3 | `densityModel: 'nvdf' \| 'procedural' \| 'hybrid'`. Switchable lighting (`lightingModel: 'nubis' \| 'octave'`; octave is the procedural default, nubis the voxel default). Procedural ground shadows and dome reflections |
| X4 | Procedural clouds shadow voxel heroes in hybrid (`ProceduralSettings.heroShadow`); open-water hybrid border fade; `?uniform=1` |
| P9-E | Cirrus/cirrostratus high layer (`runtime.cirrus`, off by default, `?cirrus=1`). Over its 0.3 ms guide; pale-patch bug under thick veils |
| L1 | Target loop for the "Texas afternoon" hero tower. Found that **Pyro buoyancy was off in every library recipe** (`temperature0 = 0` divides the lift by zero) and the lids acted as ceilings. Tools: `scripts/targets/*`, `examples/lab/target/`, `scripts/vdb/authoring/sim/targets.py` |
| B2 | Generator split out of the core bundle. **The owner removed the package size cap**; `check-bundle` is report-only |
| R3 | `docs/research/procedural-shape.md`: 10 shape and layering methods we don't use yet, plus a fetch list |

## Paused mid-task (board `[~]`)

- **P9-E2 cirrus brush strokes** (bb5fe1e, WIP, not verified):
  - Daytime strokes look much better than the wood grain.
  - Sunset self-shadowing is broken: hard dark cut-outs. The fix is a blurrier, shorter sun sample in `cirrus/render.wgsl.ts`.
  - Hooks, the haze patch fix and dome reflections are not done.
  - Status is in `work/reports/P9-E2.md`; captures are in `work/captures/scratch/p9e2/`.
- **L2 library regrow** (25365b9, WIP):
  - No assets have changed.
  - With real buoyancy, the old P9-F sources make thin smoke chimneys, because they emit from hot spots in a thin slab.
  - An `L2_RETUNED` guard in `library.py` blocks writing un-retuned entries.
  - Planned next: wide emitters across the whole base, a thicker source, weak lids. The owner's Q5 decides how far beyond plain Pyro to go.
- **T4 sunset** is a living target, re-shot after each quality pass.
- **P8-D WebKit** is stale.
- **S1 scheduler** is deferred until after look parity.

## Owner direction to keep (also in memory and the plan)

- **Biggest problems: shape, layering, surface noise and detail.** Lighting is adjustable later; ours is fine. **Takram is not the target** (owner, 2026-10-10): it simplifies HZD to one cloud type. Targets are HZD and the owner's photos; never tune toward Takram.
- Quality first, performance later. Budgets are relative: steady cost about 20% of the frame and spikes at most 10%, both at the app's target fps. Phones are deferred. No bundle size cap.
- **Hybrid, never procedural-only.** Keep the NVDF, generator, species, library and hero work, and keep both shapers and both lighting models switchable. Our generator is paused until a framing session with the owner.
- Sky Pro's MIT code may be used directly, with attribution. Takram is MIT.
- The target-driven authoring loop (`docs/PLAN-2026-10-next.md`): target cards from the owner's photos, fal views (Qwen multi-angle, nano-banana-2; skip FLUX for re-posing), sims, auto-match, the owner picks.
- **Models:** Haiku for mechanical work, Sonnet where suited, Opus for orchestration and most tasks, Fable only when Opus struggles; it is expensive.
- Commit WIP often, by pathspec, with the attribution line. Never `git add -A`. Never commit the owner's photos, slide images or paper content; third-party extracts go in `artifacts/research/extracted/` (local).
- Don't touch port 5201 (the owner's other project). The lab dev server is `.claude/launch.json` `clouds-lab` (`pnpm dev`, port 5173); start it with the preview tool when needed.

## Useful paths

- Owner photos: `/Users/dex/Developer/WebGPUClouds/artifacts/research/cloud-photos/` (local; the target is `_targets/texas-afternoon.jpg`).
- Papers: `.../artifacts/research/papers/`; Nubis decks and the noise generator: `.../artifacts/research/nubis/`.
- Compare page: `http://localhost:5173/compare/?impls=ours,takram,photo&vibe=1`. Model and lighting keys are listed in X3 and X4.
- Review loop: `node scripts/review-scenes.mjs --label X [--photos]`.
- Artifacts:
  - progress: https://claude.ai/artifact/1XG5CmRFoLwYRbXTCi86xZ
  - roadmap: https://claude.ai/artifact/NVZpAkX8eRTjb5qxawAPEk
  - variety plan: https://claude.ai/artifact/JcWbdknKvZFBdM76srWwbY
  - review: https://claude.ai/artifact/J3Ybc83B1HbCXwxjyQ3Fp4
  The progress and roadmap pages predate today's work.
- fal connector: `upload_file` then `submit_jobs` / `wait_for_jobs`. The `FAL_KEY` is in the main checkout's `.env`; never read or print it.

## Open owner questions (also on the review page)

1. Tower picks (L1).
2. The Texas photo's lens.
3. What the generator is for.
4. Where voxels go versus procedural.
5. Sims beyond plain Pyro.
6. Surface-detail faults.
7. Which layering cases come first.
8. Papers: now supplied, see TRACKING.
9. Whether demos default to hybrid.
10. Whether photos may go on review pages.
11. Free notes.
