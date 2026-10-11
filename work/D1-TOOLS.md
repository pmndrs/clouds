# D1 parity: tools and commands

Every command used in the Decima parity work, in one place. Run them from the repo root on `main`. Python runs with `-I`. Decima's frames are third party: the tools read them from the local `artifacts/research/` folder of the main checkout, and nothing writes them into the repo.

## The bench (by hand)

Start the dev server. Port 5173 is often taken by the owner's other projects, and 5201 is never to be touched.

```bash
pnpm dev --port 5180
```

Open `http://localhost:5173/decima/` in Chrome (it needs WebGPU), or use the Work section on the lab index.

Everything on the bench has a control in the sidebar: shots for both clouds, the look, compare mode and frame, matte, sky (painted or physical), quality, the far-pass resolution, hide UI and help. The URL follows the sidebar, so a copied link reopens the same view. The query options below are the same choices for links and captures; you never need to type them.

| Query | What it does |
| --- | --- |
| `?bookmark=p101` | The shot: Parkouring `p101 p102 p125 p161 p213` (`p102` = p101's camera with the fine detail off, against slide 78's raw-profile image102), Stormbird `s206 s214 s33t3 s33t6 s33t9` (Stormbird also needs `&cloud=stormbird`) |
| `?look=decima\|deck\|art` | The starting dial set: `decima` is the parity tune, `deck` is the slides' numbers, `art` is our older defaults |
| `?compare=wipe\|overlay\|frame` | Opens with Guerrilla's frame shown against ours |
| `?s.<setting>=<value>` | Any runtime setting, e.g. `?s.detailBias=0.2` |
| `?sun=el,az` `?exposure=e` `?matte=1` `?clean=1` | The sun, the exposure, the opacity matte only, hide the UI |

Keys and buttons:
- **R / compare** cycles off → wipe → overlay → frame. Guerrilla's frame for the shot sits over our render, letterboxed to the frames' 16:9.
  - Drag the yellow handle on the image to move the wipe; in overlay mode the same handle sets the frame's opacity (shift-move also works, and so does the panel slider).
  - Hold **F** to flip to the frame.
  - **The frame picker** (under the compare slider, or the `[` and `]` keys, or `?ref=p213` in the URL) shows any of the cloud's frames against the current camera, e.g. our p102 camera against image101, image102 and image213. The HUD shows `vs <frame>`.
  - The frame only lines up from the shot camera ("back to the shot camera").
- **T / tune** is the tuning panel: every runtime setting and the shot's scene values (sun, exposure, haze, colours, tints, tone curve).
  - The filter box and "changed only" narrow the list.
  - ↺ resets one dial; hover a name to see what it does.
  - "save" stores a preset in the browser; "export" / "import" read and write JSON files. Put exported presets in `work/presets/`.
  - Hand changes carry across shots unless that box is unticked.
  - **Camera dials** (scene section): `camEye`, `camTarget` (metres, y from the cloud base), `vfov`, `roll`.
    - `vfovKeepSize` is a dolly zoom: it changes the field of view while moving the camera so the cloud keeps its size, which tests perspective rather than framing.
    - "use the current view as the camera" copies an orbited view into the dials.
    - "copy camera for refs.ts" copies the camera dials as a `refs.ts` line (framing values as a comment) to paste into `examples/lab/decima/refs.ts`, or to send to Claude.
    - **Framing:** `frameWidth` / `frameHeight` scale how much the view shows on each axis (anamorphic: horizontal and vertical field of view apart; 1 = as fitted), and `shiftX` / `shiftY` are a lens shift for off-centre framing. The HUD shows the effective vfov, hfov, shift, and the camera's height above the cloud base.
    - Guerrilla never published the cameras: every shot's camera was fitted from the silhouette (`scripts/d0/d0.py fit`, then `scripts/d1/camfit.py`).
- Variants from the console, the same strings the capture runs use: `await __clouds.bookmark('p101@sun:15:210@suntint:1:1:1@exp:0.24')`.
  - The full `@` list is at the top of `examples/lab/decima/main.ts`: `@sun @exp @turb @skyf @sunc @suntint @ambtint @mieg @atm @ramp @skytint @wind @post @dither @look @matte @cam @s.<setting>`.
  - `__tune.snapshot()` returns the current state as a preset.

The reference frame for each shot:

```bash
python3 -I scripts/d1/d1.py refof p101
```

## Captures (headless Chrome)

```bash
node scripts/gpu/capture.mjs --serve --page decima/ --query "cloud=parkouring&clean=1" --shots "p101,p125,p161,p213" --settle 300 --format png --out work/captures/manual/parkouring
```

```bash
node scripts/gpu/capture.mjs --serve --page decima/ --query "cloud=stormbird&clean=1" --shots "s206,s33t3,s33t6,s33t9,s214" --settle 300 --format png --out work/captures/manual/stormbird
```

- Shots take the same `@` variants, e.g. `--shots "p101@look:decima,p101@s.detailBias:0.2"`.
- `--size 3840x2160 --quality 100` makes 4k JPEG pairs.
- `?matte=1` in the query, or `@matte` on a shot, captures the opacity mattes.
- The page contract and the other options are in `work/README.md` and the header of `scripts/gpu/capture.mjs`.

## Measuring (`scripts/d1/`)

| Command | What it gives |
| --- | --- |
| `python3 -I scripts/d1/d1.py stats <ref> <ours...>` | Parity numbers against the frame: lobe correlation, levels, pits, grain, relief |
| `python3 -I scripts/d1/d1.py bands3 <imgs...> [--box x,y,w,h]` | The judges' detail measure: band std at 1–3 / 4–12 / 12–32 px |
| `python3 -I scripts/d1/d1.py crops <out> <ref> <ours...> --box x,y,w,h` | Side-by-side 1:1 crops |
| `python3 -I scripts/d1/d1.py flicker <imgs...>` | Temporal stability across repeated shots |
| `python3 -I scripts/d1/sunsweep.py <dir> <ref>` | Which sun direction best explains a frame's shading (captures named `<ref>@sun:el:az`) |
| `python3 -I scripts/d1/camfit.py <ref> [--passes 3] [--step 40]` | Refits a shot's camera on the matte |
| `python3 -I scripts/d1/termfit.py --dir <captures> --exposure 0.04 --mattes work/captures/D1 --frames p101,p213` | Fits the lighting terms' balance to the frames |
| `python3 -I scripts/d1/postfit.py --lin <dir> --lin-exposure E --mattes work/captures/D1` | Fits a tone curve and colour matrix to the frames |
| `python3 -I scripts/d1/florets/florets.py img <image> --box x,y,w,h` | The floret measure: domes and hollows per area, the dome share (`dfrac`), lit-half bands |

## Round tools (`scripts/d1/session/`)

These are copied out of the 2026-10-11 session scratchpad. Their paths point at the old scratchpad, so re-point `S`/`ROOT` before use (see the folder's README).
- `ab.py <out.jpg> <frame> <anchor.png> <change.png>`: a one-change A/B sheet (frame | anchor | change over the judged regions, with band measures). Every change gets one before it goes into a round.
- `blind12.py`: builds a blind set (Decima / previous round / this round, full frames plus crops on the 12 judged regions, all through JPEG q90) and its key. Judges get the set; the key stays hidden.
- `floreteval.py`: the floret measure on the judged crops of every capture in a folder.
- `final12.sh`: the round's deliverable captures (all shots × looks, mattes, 4k pairs, stability).

## Where things are

- **Comparison sheets** (local only): `artifacts/research/d1-parity/sheets-r<round>/`.
  - `D1<x>-<shot>.jpg`: full frames, Decima | this round | previous round | art.
  - `D1<x>-crop-*.png`: the judged close-ups.
  - `ab-*.jpg`: the single-change sheets.
- **Blind sets and keys** (local only): `artifacts/research/d1-parity/blind/`.
- **Decima's frames** (local only): `artifacts/research/extracted/n3/pptx/media/` (deck images) and `artifacts/research/d0-parity/ref/frames/` (video frames).
- **Judging results:** `work/calibration/d1*-results.md`; the round reports are in `work/reports/D1.md`.
- **The look:** `CLOUD_DECIMA_SETTINGS` in `packages/runtime/src/runtime.ts`; per-shot scene values in `examples/lab/decima/refs.ts`.
