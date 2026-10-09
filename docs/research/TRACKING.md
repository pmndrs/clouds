# Research tracking and extraction plan

Owner's ask (2026-10-09): we have the papers, but their knowledge isn't summarised or easy to reach. So every source gets:
- a summary with tags;
- extracted formulas and code;
- a clear "what's in here for us".

Then topic guides gather what we need for shape, layering and surface detail first. Slides and decks often carry code **inside slide images**, and the `.pptx` files hold slide text, speaker notes and images. Read all three.

This file is the single tracker. Update a source's row when you finish a step.

## Where things go

| What | Where | Committed? |
| --- | --- | --- |
| Raw dumps: slide text, speaker notes, page text, slide/page images | `artifacts/research/extracted/<id>/` (main checkout) | No: third-party material, local only |
| Verbatim code transcribed from slides or papers, with slide/page numbers | `artifacts/research/extracted/<id>/code/` | No |
| One note per source: metadata, summary, tags, key ideas, formulas, a slide/page index of every code listing, "what we use / don't use / should try" | `docs/research/sources/<id>.md` | Yes. Paraphrase; quote only short snippets and formulas |
| Topic guides that combine all sources | `docs/research/topics/<topic>.md` | Yes |
| The index | `docs/research/README.md` | Yes |

Local sources live at `/Users/dex/Developer/WebGPUClouds/artifacts/research/`: papers in `papers/`, Guerrilla's material in `nubis/`. The worktree has no `artifacts/`, so use that absolute path.

## Extraction method

- **pptx:** unzip the members you need, never the whole file. `Nubis Cubed - 4k.pptx` is 3.5 GB, mostly video.
  - `ppt/slides/slideN.xml` holds the slide text.
  - `ppt/notesSlides/notesSlideN.xml` holds the speaker notes.
  - `ppt/media/*` holds images; skip `.mp4` and `.mov`.
  - `ppt/slides/_rels/slideN.xml.rels` maps images to slides.
  - Write `slides.md` with one section per slide: text, notes and image paths.
- **pdf:** `pdftotext -layout` per page, and `pdftoppm -r 110 -png` for pages that have code, figures or plots. Both are installed in `/opt/homebrew/bin`. PyMuPDF and python-pptx are **not** installed; use stdlib `zipfile` plus XML parsing.
- **Code in images:**
  - Open the image with the Read tool and transcribe it into `code/<id>-s<slide>.hlsl` (or `.txt`).
  - Head each file with `// transcribed from slide N image; verify`.
  - Note uncertain characters.
  - Never invent missing lines.
- **Speaker notes matter.** Schneider's reasoning is often only in the notes. The PDFs "with speaker notes" are the fallback.
- **Houdini assets** (`nubis_noise_generator.hda`): the Houdini CLI is available, as L1 and L2 used it. Record the parameters and what the network does; don't redistribute the asset.

## Source note template (`docs/research/sources/<id>.md`, about 80–200 lines)

```
# <Title> (<author>, <venue> <year>)
Local: <path> · Tags: shape layering detail weather light perf authoring storm · Status: <see tracker>
## In one paragraph
## Key ideas (bullets, each with slide/page)
## Formulas and constants (exact, with slide/page)
## Code listings (slide/page → local file in extracted/<id>/code/, one line on what each does)
## What we already do / what we don't / what to try (link runtime files and board tasks)
## Superseded by / supersedes (other sources)
```

## Status key

⬜ not started · 🟨 raw dump done · 🟦 source note written · 🟩 code transcribed · ✅ reviewed (an Opus spot-check of 5+ claims against the source)

## Tracker

| id | Source (local path) | Tags | Priority | Status | Note |
| --- | --- | --- | --- | --- | --- |
| n3 | `nubis/Nubis Cubed - 4k.pptx` + `nubis/Nubis Cubed.pdf` (speaker notes) | all | **P0, the primary source** | ✅ `sources/n3.md` + `n3/slides-*.md`; code 🟩 (local); spot-check 10/10 | |
| gp7 | `papers/GPU_PRO_7-clouds.pdf` | shape weather perf | P1 | ✅ `sources/gp7.md`; 12 listings | Settles the "recalled" constants in `procedural-shape.md` |
| hfw | `papers/TheReal-timeVolumetricSuperstormsOfHorizonForbiddenWest_Schneider_Andrew.pdf` | shape storm detail | P1 | ✅ `sources/hfw.md`; 14 listings | Updated methods, as code in slide images |
| ne22 | `nubis/nubis-evolved-2022.pdf` | shape weather cirrus | P1 | ✅ `sources/ne22.md`; 26 listings | Re-check slide code |
| nut | `nubis/Nubis+-+Realtime+Volumetric+Cloudscapes+In+A+Nutshell+(1).pptx` | shape weather | P1 | ✅ `sources/nut.md`; gradient stops from slide XML | Older talk; pptx has slide text and code |
| n17 | `papers/Nubis - Authoring Realtime Volumetric Cloudscapes ... Final .pdf` | authoring shape | P1 | ✅ `sources/n17.md`; formulas only (no code in PDF) | |
| hzd15 | `papers/The Real-time Volumetric Cloudscapes of Horizon - Zero Dawn - ARTR.pdf` | shape weather perf | P1 | ✅ `sources/hzd15.md`; formula slides only | |
| syn | `nubis/Schneider - Synthesizing Realistic Clouds for Video Games.pptx` | shape light | P1 | ✅ `sources/syn.md`; 6 listings | 800 MB; skip video |
| noise | `nubis/nubis_noise_generator/` | noise authoring | P1 | 🟩 `sources/noise.md`; network dumped, cooked in Houdini 21 (not spot-checked) | Guerrilla's Houdini Perlin-Worley generator |
| hag | `papers/Haggstrom.pdf` | shape light perf | P1 | ✅ `sources/hag.md`; all 61 equations, B.1–B.7 | Full maths of an HZD-style implementation (owner) |
| web18 | `papers/Procedural-Cloudscapes-EG2018-article.pdf` | shape layering | P1 | ✅ `sources/web18.md`; supplementary (8 type functions) not available | Per-type shape functions |
| bou08 | `papers/bouthors08.pdf` | light detail | P2 | ✅ `sources/bou08.md` (shape/detail side) | Hypertexture section for detail |
| fb16 | `papers/s2016-pbs-frostbite-sky-clouds-new.pdf` | light weather | P2 | 🟦 (`frostbite-yusov-hogfeldt.md`) | Type LUT (5.3) for layering |
| hog16 | `papers/hogfelt.pdf` | perf weather | P2 | 🟦 (same) | Weather channels |
| survey | `papers/COMPREHENSIVE SURVEY OF CLOUDS 2021.pdf` | survey | P2 | ✅ `sources/survey.md`; fetch list of 17 | Bibliography for the fetch list |
| hil20 | `papers/s2020_pbs_hillaire_slides.pdf` | light atmosphere | P3 (lighting parked) | ⬜ | |
| yus14 | `papers/Yusov-Clouds.pdf` | perf | P3 | 🟦 | |
| rdr2 | `papers/slides_public_release.pptx` | horizon light perf | P3 | 🟦 (`rdr2-atmosphere.md`) | |
| mie | `jendersie/` | light | P3 | 🟦 (`approximate-mie.md`) | |
| pack | `nubis-pack/` (voxel cloud pack) | authoring | P2 | 🟦 (P0 work) | Re-read its docs for authoring conventions |

| tvn | sebh/TileableVolumeNoise (web, MIT) | noise | P1 | 🟦 `sources/tvn.md` | Owner-supplied 2026-10-10 |
| psrd | stegu/psrdnoise (web, MIT) | noise motion | P1 | 🟦 `sources/psrd.md` | Owner-supplied 2026-10-10 |
| cloudpack | `vdbs/CloudPack/` (EmberGen, 10 VDBs + `.ember`) | authoring | P1 | 🟦 `cloudpack-embergen.md` | Z-up; seeding vs our Pyro |
| santa | `cloud-photos/santasSleigh/` + annotations pptx | shape detail scene | P0 | 🟦 `targets/santa-sleigh.md` | Owner's hero: multi-body merging line |
| frog | `cloud-photos/Frog Cloud/` | detail | P1 | 🟦 `targets/frog.md` | Surface-detail catalogue |
| native | web survey | comparison | P2 | 🟦 `native-implementations.md` | Comparison only; target stays HZD + photos |

**Not yet fetched** (from `procedural-shape.md`):
- ~~Hillaire's TileableVolumeNoise repo~~ (read 2026-10-10, `sources/tvn.md`);
- Bouthors and Neyret 2004, "Modeling Clouds Shape";
- Goswami and Neyret 2017 and 2018;
- Ebert, *Texturing & Modeling*, cloud chapter;
- Webanck 2018 supplementary material (the other 8 per-type shape functions);
- the ranked list of 17 in `sources/survey.md` (top: Bouthors & Neyret 2004, Neyret 2000 phenomenological shader, Goswami & Neyret 2017 + Goswami 2019 evolving cumulus, Neyret 2003 advected textures). **Downloads need the owner's OK.**

## Tasks (board ids RS-*)

| Task | What | Model | Depends on |
| --- | --- | --- | --- |
| **RS-0** | `scripts/research/extract-pptx.py` and `extract-pdf.sh`: raw dumps (🟨) for every source above | Haiku, or Sonnet if it struggles | none |
| **RS-1** | `n3` in full: slide-by-slide notes, every code listing transcribed, section map, and a diff of what the deck says against what our runtime does (`packages/runtime/src/**`). Split it across agents by slide range if large | Opus (lead), Sonnet helpers per range | RS-0 |
| **RS-2** | The Nubis family: gp7, hfw, ne22, nut, n17, hzd15, syn, noise. One agent per source | Sonnet each; Opus review | RS-0 |
| **RS-3** | Academic shape: hag, web18, bou08 (detail section), survey | Sonnet | RS-0 |
| **RS-4** | Lighting and atmosphere: fb16, hil20, hog16, yus14, rdr2, mie (top-ups only) | Sonnet | RS-0; lowest priority |
| **RS-5** | Topic guides: `topics/shape.md`, `layering.md`, `surface-detail.md`, `weather.md`, `authoring.md` (sims, noise generator, voxel pack), later `lighting.md` and `perf.md`. Each method lists: sources with slide/page, code pointer, our status, recommendation. Ends with a ranked "try next" list for the board | Opus | RS-1, RS-2, RS-3 |
| **RS-6** | Index refresh: README points to `sources/` and `topics/`. Older notes that overlap get a "superseded by" line, not deletion | Sonnet | RS-5 |

**Review:** each source note gets one Opus spot-check of five or more claims against the source before ✅. Disagreements are fixed in the note, not argued in the report.

**Parallelism:** up to about 5 extraction agents at once. The `nubis/` folder is 4.5 GB, so stream members out of the zip rather than unzipping everything.
