# Orchestrator handoff (2026-10-10, early morning)

For the next orchestrator session. Read this, then `docs/research/topics/README.md` (topic map, combined top-20, all owner questions), `work/README.md` (protocol) and `docs/PLAN-2026-10-next.md`.

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
