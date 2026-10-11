# HZD bench: tools and commands

The bench for our procedural Horizon Zero Dawn-style sky: the `hzd` shaper (GPU Pro 7's density chain on our HZD noise set and the five-field NDF, `packages/runtime/src/procedural/`), in one full-window view, beside Guerrilla's frames and the owner's photos. It works like the Decima parity bench (`work/D1-TOOLS.md`). Run commands from the repo root on `main`. Python runs with `-I`.

The reference images are third party or the owner's. The dev server reads them from the local `artifacts/research/` folder of the main checkout. Nothing copies them into the repo or the build.

## The bench (by hand)

```bash
pnpm dev --port 5180
```

- Open `http://localhost:5180/hzd/` in Chrome (it needs WebGPU), or use the Work section on the lab index. Port 5173 is often taken by the owner's other projects, and 5201 is never to be touched.
- The page renders at `ultra` quality by default.
- Every option has a control in the sidebar. The URL follows the sidebar and the tuning panel, so a copied link reopens the same view, reference and sky.

The sidebar:
- **Views:** `ground`, `gp7`, `horizon`, `sunset`, `dusk`, `afterglow`, `above`, `high`.
  - `gp7` is the ground view at pitch 25, the framing of GPU Pro 7 Fig 4.13-4.16. `high` is 4300 m at pitch -6. These are the H-reports' two capture framings.
  - `camera: fly / orbit`: drag to look. In fly mode, WASD QE move and the wheel sets the speed. In orbit mode, the wheel sets the distance.
  - `back to the view` returns to the view's camera and keeps the sun.
  - `fov`, `pitch` and `altitude` sliders.
- **Sun and time:**
  - Sun elevation (0.1° steps from -6° to 15°; the keys `[ ]` move it 0.1° and `{ }` 1°) and azimuth.
  - `time`: a time-of-day slider that sets both from a simple solar model (30° N, late spring).
  - `motion`: the renderer's `animSpeed`. `frozen` matches the H-report captures (`c_animSpeed=0`).
- **Clouds and exposure:** `coverage` (the HZD coverage bias, ±0.5 around the generated map) and `exposure`.
- **Reference:** see below.
- **Panel:** `tune (T)`, quality (reloads the page), `hide UI (H)`, `help (?)`.

### Reference viewer

- **The list:** 141 entries in `examples/lab/hzd/refs.ts`.
  - Papers: hzd15, GPU Pro 7, Nubis 2017, Nutshell, NE 2022, Nubis Cubed, Häggström. These are the "Reference frames" of `docs/research/topics/README.md`.
  - The owner's photos: `docs/research/photo-species-specs.md` §13, T1-T7, plus Santa's Sleigh and the Frog face.
  - Each entry has a title and a source (paper and page or slide, or the photo's folder and file).
- **Modes:**
  - **side by side**: our render on the left half, the reference on the right half.
  - **picture in picture**: the reference in a corner, in three sizes.
  - **R** cycles off → side → pip.
  - **Hold F** to show the reference alone.
  - **, and .** step through the list.
  - There is no overlay mode, because nothing here is pixel-matched.
- **Paper pages:** a page shows its figure by default. `show: the whole page` shows the full page.
- **Starting views:** most references carry a starting view (a bookmark plus sun, pitch, coverage, altitude), marked **approximate view**. Picking a reference sets it. Untick "picking a reference sets its view" to keep your camera, and use `apply its view` to set it later.
  - These views were set by eye from the image and the paper's text (e.g. hzd15 p037 "about 30 degrees above the horizon"). None of them were measured.
- **The route:** `/__hzd/ref/<id>` (`examples/lab/hzd/refs-plugin.ts`). It serves only the ids listed in `refs.ts`.

### Tuning panel (T)

The panel uses the shared Tweakpane panel, `examples/lab/tune/panel.ts`, the same one the Decima bench uses.

**Groups:**
- **Weather map (NDF):** seed, tile, coverage fBM and islands, footprint (Perlin or Perlin-Worley), top type range and bias, bottom type, min and max heights. Changing these regenerates the map.
- **Cloud types and height profiles:** layer bottom and top, the type blend, top rounding, smooth ramps, height from coverage, the base fade, base lumps.
- **Shape noise and the coverage remap:** build `stage` (1, 2 or 3 = Fig 4.13, 4.14 or 4.16), extinction, shape tile and contrast, the cubic read, the coverage multiply, the density power, the noise bake options (which re-bake the noise).
- **Erosion and detail:** the law and order, strength, wispy height, the detail tile and recipe, curl, wispy bottoms, the lobe rung.
- **Connective veil and skirts:** H6's veil and H7's skirts.
- **The horizon ring:** start, end, coverage, type, fade.
- **Wind and motion:** the direction, the top lean, the map drift and the noise speeds, `animSpeed`, `windVelocity`.
- **Ray march:** steps, distance, the sky layer's resolution and temporal blend.
- **Light: the procedural model** (octave or nubis, light taps, powder, phase, ambient, diffusion tail) and **Light: renderer settings** (ambient, ground bounce, phase, haze, ground shadow).
- **High cirrus layer** and **Debug**.

**Controls:**
- Each group opens with a line saying what it covers.
- Every control has an **i** with its doc comment from the code (`procedural/settings.ts`, `runtime.ts`, `sky-layer.ts`, `cirrus/index.ts`).
- The starting value is the code default. When a control differs from it, its name turns amber and shows **↺** to reset it. A link's settings therefore show as amber.
- String unions, modes (`stage`, debug views, light taps, NDF resolution) and on/off switches are dropdowns.
- The coverage bias is not in the panel: the sidebar's coverage slider drives it every frame.

**Presets and tools:**
- The filter searches names and explanations, and opens the groups that match.
- `changed only`.
- Save, export, import and reset everything. Put exported presets in `work/presets/`.
- `copy link to this view and settings`.
- `__tune.snapshot()` and `__tune.changes()` in the console.

### URL options

The URL options are the same choices the sidebar and panel make, for links and captures.

| Query | What it does |
| --- | --- |
| `?view=gp7` | The view (the compare page's `?bookmark=` also works) |
| `?sunel= ?sunaz= ?lookaz= ?pitch= ?pos=x,y,z ?posy= ?fov=` | Camera and sun, on top of the view |
| `?coverage= ?exposure= ?motion=0` | Coverage, exposure, `animSpeed` |
| `?ref=<id> ?refmode=side\|pip ?pip=s\|m\|l ?corner=bl\|br ?refpage=1 ?refview=0` | The reference and how it shows. A link with `ref` but no `view` opens at the reference's starting view |
| `?hz_<key>= ?hzn_<key>= ?proc_<key>= ?c_<key>= ?sky_<key>= ?cirrus_<key>=` | Any setting of the shaper, the NDF, the procedural march and light, the renderer, the sky layer or the cirrus layer. Arrays are comma lists, switches are 1 / 0. These are the compare page's flags |
| `?quality=high` `?clean=1` | Quality (default ultra), and no UI (for captures) |

## Captures (headless Chrome)

```bash
node scripts/gpu/capture.mjs --serve --page hzd/ --query "clean=1&motion=0" --shots "ground,gp7,horizon,sunset,above,high" --settle 300 --out work/captures/manual/hzd
```

- Shots are view names or `ref:<id>`. They take `@` variants: `@sun:el:az @cov:c @exp:e @ref:<id> @mode:off|side|pip`.
  - For example, `--shots "gp7@ref:gp7-f4.16@mode:side,ref:n3-image55"`.
  - A reference in a capture is third-party or owner content, so keep those captures local (under `artifacts/`), never in `work/captures/`.
- Settings go in the query: `--query "clean=1&motion=0&hz_stage=1&hz_veilWidth=0"`.
- The other options are in the header of `scripts/gpu/capture.mjs` and in `work/README.md`.

## What the sky can and cannot show

Many references show types this sky does not make yet. Compare those for light and mood, not for shape.

**What it makes:**
- One shell, 1.5-5 km.
- Types along stratus → stratocumulus → cumulus, from the NDF top type.
- A flat cirrus slab above, if enabled.

**What it does not make yet:**
- anvils: `hzdAnvil` is a stub (S7)
- cumulonimbus or rain (L3)
- towers above the shell, or per-cloud heights (S8)
- ragged bases from the bottom type (S3 in the procedural path)
- mid layers (L5)
- valley fog (L7)

The ids are the try-next items in `docs/research/topics/shape.md` and `layering.md`.

## Where things are

- **The page:** `examples/lab/hzd/` (`main.ts`, `tune.ts`, `refs.ts`, `refs-plugin.ts`).
- **The render:** the compare page's "ours" pane, `examples/lab/compare/panes/ours.ts`, forced to `{ model: 'procedural', shaper: 'hzd' }`. Its `internals()` hands the bench the runtime and the procedural settings.
- **The shared panel:** `examples/lab/tune/panel.ts`.
- **The settings and their docs:** `packages/runtime/src/procedural/settings.ts`. The round reports are `work/reports/H1.md`, `H5.md`, `H6.md` and `H7.md`. The judging results are `work/calibration/h6-results.md` and `h7-results.md`.
