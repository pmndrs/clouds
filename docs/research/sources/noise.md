# Nubis Noise Generator (A. Schneider, Guerrilla, Houdini HDA v1.0.1, Aug 2017)
Local: `artifacts/research/nubis/nubis_noise_generator/nubis_noise_generator.hda` + README txt · Dump: `artifacts/research/extracted/noise/` (scripts, code, out) · Tags: noise authoring shape detail · Status: 🟦 note written, cooked headlessly (Houdini 21.0.671 Indie), 🟩 network read out in full

## In one paragraph
A Houdini 21-loadable (legacy COP2 + VOP) tool that writes the **low-frequency 128^3 RGBA tiling noise of Horizon Zero Dawn** as a stack of 2D slices: **R = Perlin-Worley, G/B/A = three five-octave Worley fBMs at increasing base frequency**. It is the only source that gives the **exact frequencies, octave weights and remaps** that GPU Pro 7 and the HZD slides leave unstated (our `procedural-shape.md` / `sources/gp7.md` mark them "not stated"). It generates **only this one texture**: no 32^3 detail texture, no curl texture, no NVDF/weather data. The Perlin-Worley construction is **not** the usual one-line `remap(perlin, 1-worley, 1, 0, 1)`; it is a chain of four Worley-driven lower-bound remaps. Tiling is done by an 8-corner trilinear cross-blend, not by periodic noise. Cooks fine headlessly (no licence problem on Houdini Indie), 128 slices in about 50 s.

## What is in the asset
- Three definitions in one file: `Cop2/nubis_noise_generator` (the node, label "Nubis Noise Generator"), `Vop/nubis_noise_generator.perlin_worley_noise_sampler`, `Vop/nubis_noise_generator.multi_octave_worley_sampler`. The two samplers are VOP subnets with no VEX body; all maths is stock VOPs (`turbnoise`, `worleynoise`, `fit`, `avg`, `mulconst`, `divconst`, `complement`, `smooth`, `mix`, `switch`). The only snippets are trivial array `append` / `getelement` helpers for the 8-sample loop.
- Inside the node: `framework` (a `vopcop2gen`) holding `generate_tiled_noise` (the 8-sample loop + mixer) which holds `noise_sample` (the editable part: 1 Perlin-Worley sampler + 3 Worley samplers wired into R,G,B,A), and `export_3d` (a `rop_comp` that writes one image per frame).
- Where the instructions are: the node's parameter-view `help` string (front end), and a **sticky note inside `noise_sample`** ("ADVANCED USAGE INSTRUCTIONS (continued)"). Both are in `extracted/noise/code/` (`main_dialogscript.txt`, `sticky_notes.txt`). The HDA's Help section is empty. Content of both: this node alone yields the HZD low-frequency noises; hover parameters for help; set an Image Array Path, press Write Images (creates missing directories, fails on read-only targets); to change frequencies/arrangement dive into the node, copy samplers, and always plug the `P` from `subinput1` into each sampler's Position; Houdini's own noises (TAB, "noise") can be used instead; slices must still be assembled into a 3D texture by the user. Version note: 1.0.1 fixed a mode bug that blocked writing a sequence.

## Parameters

Front end (`nubis_noise_generator`):

| name | label | type | default | notes |
| --- | --- | --- | --- | --- |
| `do_tiling` | Tile Texture | toggle | 1 | "Enable or disable tiling for the 3d texture" |
| `border_width` | Border Transition Width | float | 0.25 | tiling blend region size, in tile fraction per axis; range 0..10, disabled if tiling off |
| `resolution_3D` | Resolution | vec3 | 128, 128, 128 | XYZ. **Only Z actually follows it** (see quirks) |
| `image_path_3d` | Image Array Path | file | `$HIP/my3DTextureArray.$F3.tga` | one file per Z slice, `$F3` = frame 1..Z |
| `depth` | Raster Depth | menu | default | int8 / int16 / int32 / float16 / float32 / "default" (menu tokens `int8,int16,int32,float16,float32,default`) |
| `execute_images_3d` | Write Images | button | | triggers `export_3d` (frame range 1..resolution Z) |

`perlin_worley_noise_sampler` (R):

| name | label | default | meaning |
| --- | --- | --- | --- |
| `Position` | Position | 0,0,0 | wire `P` here |
| `freq` | Base Frequency | 3.5 (HDA default); **5 in the shipped network** | Perlin cells per tile edge (plus `freq` scales every Worley below) |
| `OctaveFrequencyMults` | Octave Freq Multipliers | 2, 4, 17, 33 | multipliers on `freq` for the four Worley terms |
| `remap` | Range Remapper | -0.1, 1.1 | final `fit` source range, "re-range ... for max precision in 3D slices"; help says defaults don't use the full range because of Nubis' density model |

`multi_octave_worley_sampler` (G, B, A):

| name | label | default | shipped values |
| --- | --- | --- | --- |
| `Position` | Position | 0,0,0 | wired to `P` |
| `_freq__gain` | Base Frequency | 0 | **G = 1.0, B = 1.7, A = 2.3** |
| `OctaveFrequencyMults` | Octave Freq Multipliers | 5, 10, 19, 25, 37 | unchanged in all three |
| `remap` | Range Remapper | 0.75, 1.0 | unchanged in all three |

## Channel specs (exact, read from the network)

Notation: `W(f)` = Houdini `worleynoise` output `dist1` (F1 distance, metric `wnoise`) at `P * f`, i.e. `f` feature cells per unit of tile (checked: local minima on a 2D slice scale as about 1.4 f^2, f = 5 and 10); `fit(v, a, b, 0, 1)` = Houdini `fit`, **clamped**; `P` in [0,1)^3.

**R, Perlin-Worley** (`freq` f = 5):
```
t  = turbnoise(type onoise (original Perlin), pos P, freq (f,f,f), offset (10,2.8,4), amp 1, rough 0.54, atten 1, turb 5)
r  = fit(t, -0.6, 0.6 -> 0..1)
r  = fit(r, -0.1 * (1 - W(17 f)), 1 -> 0..1)      // octave mult 17, inverted worley, lower bound goes slightly negative
r  = fit(r, -0.1 * (1 - W(33 f)), 1 -> 0..1)      // octave mult 33
r  = fit(r,  0.5 * W( 2 f),       1 -> 0..1)      // octave mult 2, NOT inverted, lower bound 0..~0.5*F1
r  = fit(r,  0.2 * W( 4 f),       1 -> 0..1)      // octave mult 4
R  = fit(r, remap.x = -0.1, remap.y = 1.1 -> 0..1)  // = (r + 0.1) / 1.2
```
So R is a 5-octave Houdini turbulence Perlin (5 cells/tile base, `turb` 5, roughness 0.54) pushed through four successive Worley-driven black-point remaps: the two fine ones (85 and 165 cells/tile) use inverted Worley and *lower* the black point (dilate, add fine bumps), the two coarse ones (10 and 20 cells/tile) raise it by up to 0.5 / 0.2 of F1 (carve cell-shaped holes). The final remap gives R in [0.083, 0.917]; measured 0.083..0.900, mean 0.504, std 0.105 (1/99 percentile 0.252 / 0.749). The "remap to [-0.1, 1.1]" is by design not full range.

**G, B, A: multi-octave Worley, one recipe, different gain g** (g = 1.0, 1.7, 2.3):
```
a = ( W(10 g)  +  W(19 g)/3  +  W(25 g)/6  +  W(37 g)/8  +  W(5 g)/3 ) / 5     // VOP avg of five inputs
out = fit(1 - a, 0.75, 1 -> 0..1)                                                 // inverted worley (billow), black point at 0.75
```
Weights are 1, 1/3, 1/6, 1/8 on the multipliers 10, 19, 25, 37 and 1/3 on the extra low octave 5, so energy sits in the mid octave (mult 10) with a weaker low octave and weaker fine octaves. Four of the five Worley calls also carry a Y offset (200, 400, 800 on three of them) to decorrelate octaves.

| ch | g | cells per tile of the five octaves (5g, 10g, 19g, 25g, 37g) | measured (float32) |
| --- | --- | --- | --- |
| G | 1.0 | 5, 10, 19, 25, 37 | min 0.057, max 0.974, mean 0.686, std 0.104; spectral peak k = 4 |
| B | 1.7 | 8.5, 17, 32.3, 42.5, 62.9 | mean 0.687, std 0.102; peak k = 6 |
| A | 2.3 | 11.5, 23, 43.7, 57.5, 85.1 | mean 0.687, std 0.102; peak k = 7 |

Frequency ratio between channels is **1 : 1.7 : 2.3**, not octave doubling. This contradicts `hzd-nubis-evolved.md:117` ("roughly octave doubling"), which `sources/gp7.md` already lists as unverified. Caveat: this is the *tool's* default, not proof that HZD shipped exactly these numbers; the README calls it the generator for the "low frequency noises used for Horizon Zero Dawn".

Channels are almost independent: correlation R-G 0.25, every other pair under 0.01.

**Tiling** (`generate_tiled_noise`): not a periodic noise. The full RGBA sample is evaluated **8 times** at `P + o`, `o` in {0,1}^3, and cross-faded trilinearly with per-axis weight `w = smoothstep(1 - border, 1, P_axis)` (Houdini `smooth`, min = 1 - `border_width`, max = 1). Weight 0 selects offset +1, weight 1 offset 0, so value at p = 0 equals value at p = 1: seamless. With the default 0.25 border, **58% of the volume is inside some blend band** (1 - 0.75^3); measured per-channel std in the blended voxels is about 16% below the interior (0.095 vs 0.113), i.e. visibly softer/greyer, which matters for how we reuse it (see below). Verified by a wrap-around vs neighbour difference test on all three axes and a 2x2 tile render: seams invisible.

**Sample positions**: X,Y = COP pixel-centre coords ((i+0.5)/res), Z = frame / ZRES with frame 1..ZRES (so slice k sits at z = k/Z; last slice is z = 1, equal to z = 0 by the tiling).

## Output formats and file layout
- One image per Z slice, `<path>.$F3.<ext>`, frames 1..Z, 128x128 pixels each. Format is chosen by file extension, bit depth by `depth`. Default is `.tga` 32-bit RLE ("default" depth = 8-bit). Cooked: 128 TGA = 8.5 MB (8-bit RGBA), 128 EXR float32 (zip) = 32 MB. Raw float32 volume = 128^3 x 4 x 4 B = 33.5 MB.
- **Pitfall (measured): the default TGA output does not hold the true channel values.** Its RGB equals float RGB / A, clamped to 1 (maximum abs difference 0.0009 against that formula). Because A averages 0.69, the TGA's G and B saturate (mean 0.92 vs true 0.686) and R shows max 1.0. Alpha is intact. Use **EXR (float32 or float16)** and the RGB are the true values. Anyone who baked `.tga` slices from this tool has premultiplication-distorted G/B/A-relative data.
- Row order: Houdini images have the origin at the bottom; flip Y when building the 3D texture for WebGPU.
- Quirks of the front end: `export_3d` has `res1/res2` hard-coded to 128 and `pixelcrop3/4` hard-coded to 127, so XY resolution cannot be changed from the front end (the COP size follows `resolution_3D`, but the ROP writes 128^2). Z resolution works (`f2 = resolution_3Dz`, `ZRES`).

## Slices cooked (default settings)
In `extracted/noise/out/` (local only): `exr/` (128 float32 slices), `tga/` (128 default slices), `vol128_f32.npy`, `slice_z10_rgba.png`, `slice_z64_rgba.png` (R | G | B | A, left to right), `slice_xz_rgba.png`, `tile2x2_{R,G,B,A}.png`. What they look like: R is a soft cloudy field with fine pebbled texture and occasional dark pits (carved by the coarse Worley terms); G is a mid-size billow field (cauliflower blobs of ~1/10 tile), B finer, A the finest tightly-packed bumps. G/B/A are pale (mean 0.69) with narrow dark creases: they are an inverted-Worley with a black point at 0.75, not a centred noise.

## Comparison with our noise (`packages/runtime/src/`)
We do **not build** a shape noise in the procedural path; `procedural/textures.ts` loads baked blobs: Takram `shape.bin` (128^3 **R8**, one channel), `shape_detail.bin` (32^3 **R8**), `turbulence.png` (128^2), and Sky Pro `baseShape64.bin` (64^3 RGBA8 with mips). The only noise we generate ourselves is the voxel/generator path's inverted-Worley billow (`generate/shaders.ts` `worleyLobes`, up to 3 octaves, cell halving) and Sky Pro's periodic Perlin fbm for the weather map (`textures.ts` WGSL). Differences:

| aspect | Nubis generator (HZD low freq) | ours |
| --- | --- | --- |
| texture | 128^3 RGBA | Takram 128^3 **R only**; Sky Pro 64^3 RGBA |
| R | 5-octave Perlin (5 cells) through 4 Worley remaps | Takram baked R8 (unknown recipe); Sky Pro baked |
| G/B/A | 5-octave Worley fBM each, base 5/8.5/11.5 cells (g 1, 1.7, 2.3), octave weights 1, 1/3, 1/6, 1/8, 1/3 | **not stored in Takram path** (R8); Sky Pro weights its RGB by `(0.7,0.41,0.23)` dilation, `(0.113,0.04,0.02)` erosion (`density.wgsl.ts` :108, :124) |
| use in the density | gp7: `low_freq_FBM = .625 g + .25 b + .125 a`, `remap(r, -(1-fbm), 1, 0, 1)` | Sky Pro: dot-product sum added to the column top; Takram: single `.r` read |
| tiling | 8-sample trilinear blend, 25% border, 58% of volume blended | Takram/Sky Pro baked (periodic Perlin for weather; others unknown) |
| remap headroom | R in [0.083, 0.917], G/B/A in [0, 1] but mean 0.69 | n/a (8-bit baked) |
| generator billow | inverted Worley `1 - F1` (A is the same family) | `worleyLobes`: lobes with per-feature radius 0.75-1.3 cells and heights 0.65-1, `max` union, 3 octaves |
| detail 32^3 | **not in this tool** | Takram R8 |
| curl 128^2 | **not in this tool** | Takram `turbulence.png` |
| NVDF / Nubis Cubed noise | none (older HZD-era tool; no wispy/billowy channel pairs, no curly-alligator) | n/a |

Our `procedural-shape.md` weights (`0.625/0.25/0.125`) come from GPU Pro 7 for the **G/B/A of this texture**; they fit this recipe (G coarsest, A finest, the finest gets the smallest weight).

## How to use it in our pipeline
1. Cook EXR float32 (never TGA) with the existing hython: `extracted/noise/scripts/cook.py` is a working template (`n.parm("execute_images_3d").pressButton()` after setting `image_path_3d`, `depth`). Run once per variant; ~50 s per 128^3.
2. Read EXR slices back (`exr2npy.py` uses a COP `file` node and `allPixels`) or write the slices straight to `.bin` as RGBA8 / R8 with `y` flipped. Pack G/B/A and R separately if we want 4 R8 textures, or RGBA8 for one fetch.
3. For a tunable variant, copy the two sampler VOPs inside `noise_sample`, change the octave multipliers, gains, `remap`, or swap the Worley for our own shape; the `remap` field is exactly how to stretch the range to full 8-bit before quantising (R: set to about (0, 1) of its current content; G/B/A: black point 0.75 can be moved).
4. The port to WGSL compute is mechanical: Perlin fBM (we have `scPerlin`), Worley F1 with jitter (we have `worleyF1`), the `fit` chain above, and (only if we generate at runtime) the 8-sample blend, which we could replace with genuinely periodic Perlin/Worley (cheaper, no soft band). Runtime generation would make every parameter above a live control and remove the baked-asset licence question for the shape noise.
5. Do not ship the HDA; ship only baked outputs or our own port of the recipe.

## What we already do / don't / should try
- **Don't:** use G/B/A at all in the Takram path; use a Worley-chain Perlin-Worley; have a frequency ladder other than doubling in generated noise.
- **Try (shape / detail):** (a) replace `noiseA.r` with the chain-remap Perlin-Worley (R above) and test billows vs the plain `remap(perlin, 1-worley)`; (b) store this recipe's G/B/A and apply `0.625/0.25/0.125` dilation (gp7) with the 1 : 1.7 : 2.3 ladder; (c) author a matching 32^3 detail texture with the same Worley fBM recipe at higher gains (a fourth sampler, no Perlin), since the tool stops at the low-frequency set; (d) use the Worley remap **black point** (0.75) as a billow-contrast control at runtime instead of baking it; (e) compare tile-blend softness against periodic generation in the 58% blended region.

## Superseded by / supersedes
Same family as the HZD/N17 noise (`hzd15`, `n17`, `gp7`); supplies the numbers they omit. Nubis Cubed (`n3`) replaces this texture set with NVDF-based channels; this tool does not cover that.
