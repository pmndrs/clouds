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
- **Clouds and exposure:** `coverage` (the HZD coverage bias, ±0.5 around the generated map), `exposure`, and `paint the weather map (M)`.
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
- **Weather map (NDF):** seed, tile (F2: 32 km at 1024² by default), coverage fBM and islands, footprint (Perlin or Perlin-Worley), top type range and bias, the bottom type field (F2: centre, range, cells and correlation with the top type: per-area bases), min and max heights and their cells. Changing these regenerates the map.
- **Cloud types and height profiles:** layer bottom and top, the Nutshell type blend, top rounding, smooth ramps (these four shape the Nutshell profile only), height from coverage, the base fade, base lumps.
- **Cloud types: profile tables** (F2: the default profile): `profileMode` (tables or nutshell), where the tables are read from (`tableSource`: storage buffer, or F1's uniform array), the HZD type to table type map (`tableTypeCumulus` 0.4 is NE's; 0.6-0.75 gives towering cumulus), the shader-side bottom-type bias and variation (a stopgap from F1, 0 now that the map carries the bottom type), the table floor.
- **Storms and anvils**, **Mid-level layer and low deck**, **Fractus** (F1, all off by default).
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

### Weather-map painter (M)

Paint the weather map (the NDF) in a dock on the left of the bench. The sky updates as you paint, so quick changes and demos no longer need another app. Open it with **M** or the sidebar's `paint the weather map`.

- **Sources:**
  - the sky as it is now (read back from the GPU)
  - the generator (seed, footprint and the tuning panel's map settings)
  - W1's example maps and saved paintings, loaded through the runtime's own image path, so they read exactly as `?hzn_image=` does
  - a PNG from disk, a blank map, or the last painting (autosaved in this browser)
- **Channels:** coverage, top type, bottom type, min height and max height. Tick the channels a stroke changes; each channel's slider is the value paint, noise, gradient and fill go toward. Click a name to view that channel as a ramp. **Recipes** tick and set several at once: clear, stratus, strato-cu, cumulus, congestus. They are starting points set by eye, not measured.
- **Tools (1-8 over the map):**
  - paint, raise, lower, smooth, smudge
  - noise: toward value × fBM. It breaks up plateaus, since a painted plateau turns into a flat-sided slab (W1).
  - restore: back toward the source map
  - gradient: drag a line
- **Brush:** size in metres, strength, hardness and the noise grain.
- **Whole-map operations:** fill, blur all, invert, + noise.
- **Map controls:**
  - Alt-click picks the values under the cursor.
  - Right-click puts the camera over that spot.
  - The wheel zooms. Space-drag or middle-drag pans. Shift-wheel or `[ ]` sets the size.
  - Ctrl/cmd-Z undoes, shift-ctrl/cmd-Z redoes. `0` fits the map.
- **The map view:**
  - north up, and the map tiles
  - the camera and its view wedge
  - the horizon ring (beyond `ringStart` the ring replaces the map, as in HZD)
  - the sun, the wind
  - the coverage-threshold contour: 0.38 less the coverage bias, about where a mean base shape survives
  - It follows the map's drift (`ndfMotion`). Opening the painter sets `map motion: static`, so the map stays where you painted it; pick `drift` in the Sky section to let it move with the wind again.
- **Sky:** `update: while painting` or `on release`. Each update cuts the temporal history, so the sky is noisy while a stroke runs. The other controls are the map size (`ndf.tileMeters`), `view from above` (14 km, straight down) and `drop the painting` (back to the generator or `ndf.image`).
- **Save:** writes `assets/clouds/ndf/painted/<name>.png` and `<name>-height.png` (the authored-map format, `assets/clouds/ndf/README.md`) through the dev server, and points `ndf.image` and `ndf.heightImage` at them. The page's URL then reopens the painted sky: `copy link`. `download` saves the same two PNGs. A static build cannot save.
- **Where it is:** `examples/lab/hzd/paint/` (`editor.ts` the dock, `fields.ts` the model and brush maths with `fields.test.ts`, `plugin.ts` the dev-server list and save routes). The runtime takes the map through `proc.setNdf`, which writes in place while a map of the same size is bound.

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
| `?hzn_tileMeters=16000&hzn_resolution=512&hzn_coverageCells=9&hzn_islandCells=2&hzn_typeCells=2&hzn_worleyCells=6&hzn_gateCells=3&hzn_bottomTypeCells=3&hzn_heightCells=3` | The 16 km map tile of H1-W1 (F2 made it 32 km; `HZD_NDF_TILE_16KM` in code) |
| `?hz_profileMode=nutshell&hz_extinction=0.5` | H6's profile and extinction (F2 made the tables and 0.8 the defaults) |

## Captures (headless Chrome)

```bash
node scripts/gpu/capture.mjs --serve --page hzd/ --query "clean=1&motion=0" --shots "ground,gp7,horizon,sunset,above,high" --settle 300 --out work/captures/manual/hzd
```

- Shots are view names or `ref:<id>`. They take `@` variants: `@sun:el:az @cov:c @exp:e @ref:<id> @mode:off|side|pip`.
  - For example, `--shots "gp7@ref:gp7-f4.16@mode:side,ref:n3-image55"`.
  - A reference in a capture is third-party or owner content, so keep those captures local (under `artifacts/`), never in `work/captures/`.
- Settings go in the query: `--query "clean=1&motion=0&hz_stage=1&hz_veilWidth=0"`.
- A shot re-applies its view's camera, so `posy`, `fov` and `pitch` in the query are lost for named shots. For a custom camera, put the view in the query and pass no `--shots` (the shot is saved as `view.jpg`), e.g. F1's side view: `--query "clean=1&motion=0&view=horizon&posy=900&fov=35&pitch=4"`.
- `work/captures/F2/tools/runs.mjs` runs several setting arms interleaved over reps and collects the sky layer's GPU time per shot (`--side 1` adds the side view); `sheet.py` makes a contact sheet with those timings, `diff.py` compares two capture folders.
- The other options are in the header of `scripts/gpu/capture.mjs` and in `work/README.md`.

## What the sky can and cannot show

Many references show types this sky does not make yet. Compare those for light and mood, not for shape.

**What it makes:**
- One shell, 1.5-5 km.
- Types along stratus → stratocumulus → cumulus, from the NDF top type, through Nubis Evolved's top x bottom profile tables (F2 default; the Nutshell trapezoids are `hz_profileMode=nutshell`, with `hz_extinction=0.5` for H6's look).
- Per-area bases from the NDF bottom type (F2): crisp flat bases under cumulus, soft rounded ones under stratiform areas.
- F1 forms behind settings: storm cells with anvils, altocumulus / altostratus / stratus sheets, fractus.
- A flat cirrus slab above, if enabled.

**What it does not make yet:**
- rain, storm lighting (dark bases, the shaded column under an anvil), fibrous anvil edges (L3, F1's leftovers)
- towers above the shell, or per-cloud heights (S8)
- valley fog (L7)

The ids are the try-next items in `docs/research/topics/shape.md` and `layering.md`.

## Where things are

- **The page:** `examples/lab/hzd/` (`main.ts`, `tune.ts`, `refs.ts`, `refs-plugin.ts`, `paint/` the weather-map painter).
- **The render:** the compare page's "ours" pane, `examples/lab/compare/panes/ours.ts`, forced to `{ model: 'procedural', shaper: 'hzd' }`. Its `internals()` hands the bench the runtime and the procedural settings.
- **The shared panel:** `examples/lab/tune/panel.ts`.
- **The settings and their docs:** `packages/runtime/src/procedural/settings.ts`. The round reports are `work/reports/H1.md`, `H5.md`, `H6.md` and `H7.md`. The judging results are `work/calibration/h6-results.md` and `h7-results.md`.
