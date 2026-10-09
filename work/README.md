# How work gets done here

The current roadmap is [`docs/PLAN-2026-10-next.md`](../docs/PLAN-2026-10-next.md). Task definitions are in [`docs/PLAN-2026-10-variety.md`](../docs/PLAN-2026-10-variety.md), and the history and early phases in [`docs/AUDIT-2026-10.md`](../docs/AUDIT-2026-10.md).
**Research: read [`docs/research/README.md`](../docs/research/README.md) first.** It indexes every source and note: what each is good for, what is already extracted, and what is unread. Formulas and constants are in [`docs/research/nubis-sources.md`](../docs/research/nubis-sources.md). When you scan a new source, add a row to the index.
This folder is the working surface:

- `BOARD.md` is the task list.
- `reports/` holds one short report per task.
- `captures/` holds screenshots and timing JSON from the GPU harness.

## Roles

| Role | Who | Does |
| --- | --- | --- |
| Orchestrator | root session | Splits phases into tasks, assigns them, does visual acceptance, makes final commits, decides plan changes |
| Implementer | Haiku for mechanical work; Sonnet for code; Fable for hard rendering problems after one failed attempt | One task, only its listed files, ends with a report |
| Reviewer | Sonnet, with a fresh context | Checks a finished task against its acceptance list; reads the diff, report and captures; never rewrites the work |

## Task lifecycle

`[ ]` open → `[~]` claimed → `[r]` in review → `[x]` done (with commit hash) or `[!]` blocked.

1. **Claim.** Edit your task's line to `[~]` and add your agent name. Touch only
   the files the task lists. If you need another file, say so in the report.
2. **Build.** Run the task's acceptance commands.
   - `pnpm typecheck` and `pnpm test` must pass for your files. Other agents
     may be editing in parallel; judge only errors in files you own.
   - GPU work must be verified with the capture harness (below), not by
     reasoning about the shader.
3. **Report.** Write `reports/<task-id>.md` from the template below and set the
   task to `[r]`.
4. **Commit checkpoints often** (owner, 2026-10-09). Commit whenever you have a working state, and always before you
   start chasing a different look, so there is a safe version to fall back on. History can be rearranged later.
   - Commit **only your owned files**, by pathspec: `git commit -m "WIP <task-id>: ..." -- <your files>`. Never use
     `git add -A` or `git commit -a`, because other agents share this worktree.
   - Never commit the owner's photos or slide images, including captures that contain them.
   - End messages with the attribution line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
   - The orchestrator reviews and makes the final commit that marks the task `[x]`.

## Report template (keep it under 40 lines)

```md
# <task-id> <title>
Status: ready for review | blocked
Changed: <files>
Verified:
- `<command>` → <result>
- captures: work/captures/<task-id>/ (<what each shot shows>)
Measures: <each acceptance item: pass/fail with the number>
Open issues: <anything a reviewer or the next task must know>
```

## GPU capture harness

```bash
node scripts/gpu/capture.mjs --serve --page flagship/ --shots ground,inside --out work/captures/P1-04
```

- Runs headless Chrome on the real GPU (Metal on this Mac), with timestamp
  queries available.
- Waits for the page's `window.__clouds.ready`, settles 90 frames per shot,
  then writes `<shot>.jpg` and `capture.json` (page report plus console
  errors).
- Exits non-zero on page errors.
- `--help` lists the options. `examples/lab/gpu-smoke/` is the self-test.

**Page contract.** A page calls `installCloudsHarness()` from
`examples/lab/harness/clouds-contract.ts`:
- `ready({ report, bookmark })` once it can render
- `frame()` once per rendered frame
- `bookmark(name)` applies named camera/sun states
- `report()` returns at least `{ gpuMs: { <pass>: ms }, frameMs, renderSize }`

Commit captures that serve as evidence: JPEG, normally 1920×1080, about
200 KB each. Scratch runs go to `captures/scratch/`, which is ignored.

## Rules

These come from the plan. They are not up for negotiation in a task.

- Never add a per-change bake that stalls a frame. Never render only on input.
  Noise and jitter animate.
- No hard-coded light colors. Sun and sky light come from `@pmndrs/sky`.
- Density follows `assets/nubis-voxel-clouds/Code Fragments/VoxelCloudSampler.cg`.
  Deviations are written down in the report.
- Don't judge quality against offline or brute-force renders.
- No evidence JSON beyond `capture.json`. No new docs outside `work/`, except
  where a task says so.
- Every WGSL template string carries the `/* wgsl */` tag. The release build minifies only tagged templates (`scripts/wgsl-minify.mjs`), and the core must stay under 60 KB gzip (`node scripts/check-bundle.mjs --strict`).
- Research sources and notes are indexed in `docs/research/README.md`. When you scan a new source, add it there.
- If you are stuck after one serious attempt, stop and write a `blocked`
  report that names exactly what is wrong. Don't thrash.
