# Research extraction brief (RS-1 to RS-4)

Read this whole file before starting. The plan and tracker are in `docs/research/TRACKING.md` (read its template section).

## Why we're doing this
Owner, 2026-10-10: we want the bleeding-edge cloud system on the web (WebGPU, compute shaders, our native peers' latest techniques). Guerrilla uses **both** volumes and procedural methods, so we must master both. **Procedural comes first: shapes, flows, noise, rendering.** **The target is Horizon Zero Dawn and the owner's photos, never Takram.** Takram, Sky Pro and Tidewater are simplified single-cloud-type takes on HZD; don't use them as the reference for what's right, and when you compare our runtime, compare against the source papers. **Matching Horizon Zero Dawn's procedural clouds is the floor.** Our weakest areas are **shape, layering, and surface noise/detail**. Lighting matters less right now (ours is acceptable); still record lighting maths, but spend your depth on shape, density, noise, weather/layering and authoring.

The problem with our notes today: they repeat the same summary many times, while the detailed maths (Häggström), the early code (GPU Pro 7) and the code in Nubis slides is not reachable. Your note must make the **specific, unique content** of your source reachable: exact formulas, constants, code, parameter values, figures that explain shape. Don't re-summarise the generic Nubis story; say "same as X" and move on.

## Paths
- Worktree (write committed notes here): `/Users/dex/Developer/WebGPUClouds/.claude/worktrees/cloud-research-setup-10bf11`
- Sources (local only): `/Users/dex/Developer/WebGPUClouds/artifacts/research/` (`papers/`, `nubis/`)
- Raw dumps (local only): `/Users/dex/Developer/WebGPUClouds/artifacts/research/extracted/<id>/`
  - pptx: `pptx/slides.md` (slide text + speaker notes + image list), `pptx/media/` (full-res images), `pptx/index.json`
  - pdf: `full.txt`, `pages/pNNN.txt`, `png/pNNN.png` (110 dpi renders, if made)
  - If a dump or a page render you need is missing, make it: `scripts/research/extract-pdf.sh <pdf> <out> 12-15,40` (renders those pages; `DPI=200` env for small code), or `python3 -I scripts/research/extract-pptx.py <pptx> <out>`.
- Our runtime, for the "what we do / don't" section: `packages/runtime/src/` (procedural model in `procedural/`, NVDF/voxel path elsewhere). Existing notes: `docs/research/*.md` (esp. `nubis-sources.md`, `procedural-shape.md`, `hzd-nubis-evolved.md`). Read the ones overlapping your source so you add rather than repeat, and flag anything in them your source contradicts.

## Outputs
1. **Source note** `docs/research/sources/<id>.md` (committed). Follow the TRACKING template. Paraphrase; quotes under 15 words; formulas and short code snippets (a few lines) are fine. Cite `[s12]` for slides, `[p.34]` for pages. Length: as long as the unique content needs (80–400 lines); no padding.
2. **Code transcriptions** `extracted/<id>/code/<id>-s<slide>.hlsl` or `-p<page>.hlsl` (local, not committed): every code listing in the source, whether it's slide text, PDF text or **inside an image**. For images, open them with the Read tool (zoom by rendering the PDF page at `DPI=200` if needed) and transcribe exactly. Head each file with `// <id> slide/page N; transcribed from image|text; verify`. Mark unreadable characters `/*?*/`. Never invent missing lines. The source note lists every listing: location → file → one line on what it does.
3. **Figures that explain shape**: list slide/page numbers of the best diagrams and reference renders (profiles, gradients, noise breakdowns, weather maps) with one line each, so the topic-guide author can pull them.
4. Finish with a short report to the orchestrator (your final message, ≤ 25 lines): status reached (🟦 note written / 🟩 code transcribed), number of code listings, anything you couldn't read, contradictions with our existing notes, and your **top 5 "try next" items** for shape/layering/detail with source refs.

## Rules
- Don't edit `TRACKING.md`, `README.md`, the board, or any runtime code. Don't commit; the orchestrator commits. Write only your own note file(s) and your `extracted/<id>/` folder.
- Never copy slide images, page renders or paper text into the worktree.
- Repeated template images (logos, backgrounds) appear on many slides; skip them after checking once.
- Be exact. If you're unsure of a number, say so; a wrong constant is worse than a gap.
- Use python with `-I`. Don't start dev servers.
