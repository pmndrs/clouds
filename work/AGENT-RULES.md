# Rules for every agent task (read once)

- Work only in your own git worktree. Commit by pathspec (never `git add -A` / `commit -a`). End messages with "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>". Never merge to main. **Commit after every working step** — the session may be cut off by a usage limit at any time; uncommitted work is lost.
- **Never remove code, methods or looks** (owner rule). New behaviour goes behind a setting; change the default only when it clearly looks better, and keep the old value selectable.
- **Every new or changed default gets a switch in the HZD bench's Review section**: add an entry to `ITEMS` in `examples/lab/hzd/app/Review.tsx` (id = your task id, old/new options, a tip saying what it does and which tune-panel group has it). Also add new settings to the tune panel groups in `examples/lab/hzd/tune.ts` with a one-line doc. The owner reviews with controls, never URL-only.
- Token-frugal: read line ranges (`sed -n`), grep, never dump whole large files.
- If the worktree has no `node_modules`, `ln -s /Users/dex/Developer/WebGPUClouds/node_modules` and remove the link before your last commit.
- `pnpm typecheck` and `pnpm test` must pass (a Disney VDB test can time out under load; rerun it alone).
- Captures: start your own vite (`npx vite --port <free port>` from the worktree root) and use `node scripts/gpu/capture.mjs --url ...` (read its header; `--serve` times out cold). **Never use ports 5180, 5173 or 5201.** Kill your vite and any headless Chrome when done. Bench page: `/hzd/`; views: ground (250 m), gp7, horizon, above, high, storm, sunset, dusk, afterglow. Save captures under `work/captures/<TASK>/` with one sheet JPG ≤1920 px wide (`python3 -I`, PIL). Our own renders only; never commit third-party images.
- Report: `work/reports/<TASK>.md` — new file, never overwrite an existing report. Short: what changed, settings, which Review switch, what you saw (worse / better / just different vs the papers), cost in ms.
- Python always with `-I`. Never read `.env`. Don't touch other worktrees or main.
- Final message to the orchestrator: under 100 words — branch, commits, settings, verdict, problems.
- Time box: aim to finish within ~60 minutes; if a step gets risky, stop, commit what works, and report.
