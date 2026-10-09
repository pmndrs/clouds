# TileableVolumeNoise (S. Hillaire, Frostbite, 2016-17; GitHub sebh/TileableVolumeNoise)
Local: none (read from raw.githubusercontent.com: `TileableVolumeNoise.cpp`, `.h`, `main.cpp`, `LICENSE.md`; nothing cloned) · Tags: noise authoring shape detail · Status: 🟦 note written, code read in full (it is a ~300-line C++ tool; every formula below is transcribed from source)

## In one paragraph
A small Windows C++ tool (GLM + libtarga, PPL `parallel_for`) that bakes the GPU Pro 7 / Frostbite-2016 cloud noise: a **128^3 RGBA8** "base shape" volume (R Perlin-Worley, G/B/A three Worley fBMs of rising frequency) and a **32^3 RGBA8** "erosion" volume (three Worley fBMs), each in a raw and a "packed" (channels pre-combined into one grey value) form, written as TGA with the Z slices laid side by side. Tiling is by **genuinely periodic noise** (GLM 4D Perlin with period = frequency; Worley with integer cell counts and `mod` wrap), not by cross-blending. It is the closest public re-implementation of the GPU Pro 7 recipe, but its author says in the code that the book's text and figures disagree and the formula is "up to you". **It contains no weather map, cirrus, curl or any 2D output** (the task brief expected "cloud weather/2D outputs"; there are none). Licence MIT, (c) 2017 Sebastien Hillaire; bundled GLM and libtarga have their own licences.

## Files and what is in them
| file | content |
| --- | --- |
| `TileableVolumeNoise.cpp/.h` | class `Tileable3dNoise`: `PerlinNoise(p, frequency, octaveCount)`, `WorleyNoise(p, cellCount)`, private `hash`, `noise`, `Cells`. Header comments credit GLM for Perlin and Marc-Andre Loyer's Shadertoy `Xl2XRR` for Worley |
| `main.cpp` | the texture generators below; a disabled 32^3 single-channel Perlin/Worley example; a disabled (`#if 0`) 3x3 tile-the-slice debug dump to check seams |
| outputs | `noiseShape.tga`, `noiseShapePacked.tga` (width 128*128, height 128), `noiseErosion.tga`, `noiseErosionPacked.tga` (width 32*32, height 32); `Examples/` has one preview jpg |

## Core noise functions (exact)

**Hash and value noise** (used only as the Worley feature-point source):
```
hash(n)  = fract(sin(n + 1.951) * 43758.5453)
noise(x) : f = smoothstep-fade(fract(x)) = f*f*(3-2f);  n = p.x + 57 p.y + 113 p.z   // classic iq value noise, trilinear of hash(n + {0,1,57,58,113,114,170,171})
```

**Worley (`Cells`)**
```
pCell = p * cellCount                      // p in [0,1)^3, cellCount an integer
for xo,yo,zo in -1..1:                     // 27 cells
    tp = floor(pCell) + (xo,yo,zo)
    tp = pCell - tp - noise( mod(tp, cellCount) )     // <- noise() returns a SCALAR
    d  = min(d, dot(tp, tp))               // squared distance, in cell units
d = clamp(d, 0, 1)                         // clamped at 1 cell^2
```
Facts that matter:
- **Wrap**: `mod(tp, cellCount)` folds the integer cell index into [0, cellCount) before hashing, so cell N hashes like cell 0: periodic in the unit cube. Only valid for integer `cellCount` (every call in `main.cpp` uses one).
- **Feature point offset is one scalar added to x, y and z** (`vec3 - float`). Every cell's point therefore lies on the cell's (1,1,1) diagonal: `point = cellCorner + (h,h,h)`. This is a real defect: it gives a diagonal-aligned lattice, correlated neighbours and visible anisotropy (see Quality). A proper Worley uses three independent hashes.
- The value noise is only ever evaluated at integer positions, so the smoothstep fade does nothing: it reduces to `hash(n)`, with 8 sin() calls per cell per call, of which 7 are thrown away (27 cells x 8 hashes x ~11 Worley calls per texel, offline only).
- **The output is squared distance F1^2, clamped to 1, and callers invert it (`1 - W`)**. So the billow profile is a parabola `1 - d^2`, flatter at the cell centre than the cone `1 - d` that Houdini's F1 gives (Nubis generator, `noise.md`). The clamp at 1.0 (one cell radius) flattens the creases between cells: with diagonal-only points most of the gap area is clamped.

**Perlin fBM (`PerlinNoise`)**
```
for oct in 0..octaveCount-1:
    p4  = (p.x, p.y, p.z, 0) * frequency
    val = glm::perlin(p4, vec4(frequency))        // periodic 4D Perlin, period = frequency on all 4 axes; w fixed at 0
    sum += val * weight; weightSum += weight
    weight *= weight;  frequency *= 2             // NB: weight SQUARES: 0.5, 0.25, 0.0625 (not 0.5, 0.25, 0.125)
return clamp( (sum/weightSum) * 0.5 + 0.5, 0, 1)
```
- Tiling: GLM's periodic Perlin (`perlin(p, rep)`) wraps lattice indices modulo `rep`; frequency 8/16/32 are integer periods that divide the unit cube exactly.
- The 4D call is a workaround: the author's comment says GLM's `vec3` periodic Perlin is "bugged on the Z axis, black stripes are visible", so he evaluates the 4D version on the w = 0 slice (a 3D slice through 4D noise; costs 16 corners instead of 8 but is correct).
- Effective octave weights are 0.5/0.8125 = 0.615, 0.25/0.8125 = 0.308, 0.0625/0.8125 = 0.077 (3 octaves). Raw GLM Perlin spans roughly [-1,1] but rarely reaches the ends, so after `*0.5+0.5` the field is a compressed bell around 0.5 and is never re-stretched.

## Texture recipes (`main.cpp`, exact)
`remap(v, a, b, c, d) = c + (v-a)/(b-a) * (d-c)` (unclamped). `W(c)` below = `1 - WorleyNoise(coord, c)`. `coord = (s,t,r)/N`, note **texel index, not texel centre** (`coord = i/N`; harmless because the field is periodic, but there is a half-texel shift against `(i+0.5)/N`).

**Base shape, 128^3, RGBA8** (cellCount base 4; `frequenceMul = {2, 8, 14, 20, 26, 32}` is "special weight for perlin-worley")
```
perlin   = PerlinNoise(coord, frequency 8, 3 octaves)           // 8, 16, 32 cells/tile
wfbm     = W(4*2)*0.625 + W(4*8)*0.25 + W(4*14)*0.125            // cells 8, 32, 56
R  = remap(perlin, 0, 1, wfbm, 1)  =  wfbm + perlin * (1 - wfbm)  // "PerlinWorley"
G  = W(4*2)*0.625  + W(4*4)*0.25  + W(4*8)*0.125                  // cells  8, 16, 32
B  = W(4*4)*0.625  + W(4*8)*0.25  + W(4*16)*0.125                 // cells 16, 32, 64
A  = W(4*8)*0.75   + W(4*16)*0.25                                  // cells 32, 64  (3rd octave dropped)
```
(W(4*1) and W(4*32) are computed or commented out but unused.) The author's comments: A drops its third octave because 128 texels / 128 cells would be texel-frequency noise; the commented alternative `remap(worleyFBM, 0, 1, 0, perlin)` "matches better Figure 4.7" while the text of p.101 matches the version that shipped; "there are a lot of fudge factors in the code, e.g. *0.2, so it is really up to you". He also notes the 128 size must drop with the frequencies if reduced.

**Packed (one grey channel, "for direct usage in shader")** matches GPU Pro 7's sampler [gp7 p.106]:
```
lowFreqFBM = G*0.625 + B*0.25 + A*0.125
value      = clamp( remap(R, -(1 - lowFreqFBM), 1, 0, 1), 0, 1 )
RGB = value*255, A = 255
```
Stored as `unsigned char(255*v)` (truncation, mean error -0.5 LSB).

**Erosion, 32^3, RGBA8** (active `#if 1` branch, base cellCount 2)
```
W0..W3 = W(2), W(4), W(8), W(16)                                   // cells 2, 4, 8, 16
R = W0*0.625 + W1*0.25 + W2*0.125        // 2, 4, 8
G = W1*0.625 + W2*0.25 + W3*0.125        // 4, 8, 16
B = W2*0.75  + W3*0.25                   // 8, 16
A = 255
packed = (R*0.625 + G*0.25 + B*0.125) grey    // = the fBM the gp7 sampler forms at runtime
```
`#else` branch (unused): two-octave fBM with arbitrary cell counts 4, 7, 10, 13, weights 0.75/0.25 per channel. At 32 texels, 16 cells/tile is the Nyquist limit (2 texels/cell).

**Layout**: `addr = r*N*N + t*N + s` (x = s fastest), 4 bytes/texel, then one `tga_write_raw(..., TGA_TRUECOLOR_32)`: the volume is stored as an N^2 x N image. 32-bit TGA by libtarga: check byte order (BGRA) and row origin before loading into a GPU 3D texture. The packed TGA is grey RGB + alpha 255, so repack to R8.

## Key ideas for us
- The **frequency ladder is octave doubling** (G 8/16/32, B 16/32/64, A 32/64 cells per tile; erosion 2..16) with weights 0.625/0.25/0.125. The Nubis generator (`noise.md`) is 5-octave and **1 : 1.7 : 2.3** with weights 1, 1/3, 1/6, 1/8, 1/3. These are two different readings of "increasing frequency"; neither is confirmed as what shipped in HZD (Hillaire reverse-engineered his; Schneider's tool is the author's own).
- **Perlin-Worley is the simple form**: Worley fBM as a *raised floor* under Perlin (`wfbm + perlin(1-wfbm)`) instead of the Nubis tool's chain of four Worley black-point remaps (two raising by up to 0.5/0.2 of F1, two lowering). TVN's field has no carved pits.
- **Packing pre-bakes the gp7 combine** (`remap(R, -(1-lowFreq), 1)`), losing the ability to change the G/B/A weights or the remap at runtime. We should keep channels separate (RGBA8) and combine in the shader.
- Cell counts are chosen against the texture size (Nyquist note in code): a useful rule for our own bakes (finest octave cells <= N/2 per tile).
- Seam test code (3x3 tile of a slice) is a ready-made recipe for our own tiling check.

## Formulas and constants (summary)
See the blocks above. Constants to keep: Perlin base freq 8, 3 octaves, weights 0.5/0.25/0.0625 (squaring); Worley hash `fract(sin(n+1.951)*43758.5453)`, strides 57/113; Worley base cells 4 (shape) / 2 (erosion); multipliers `{2,8,14}` for R, `{1,2,4,8,16}` for G/B/A; fBM weights `0.625/0.25/0.125`, `0.75/0.25`.

## Assessment for us

**(a) Equivalence to HZD / GPU Pro 7 textures.** Structurally the same product: 128^3 RGBA (PW + 3 Worley fBM) and 32^3 RGB Worley, same weights `0.625/0.25/0.125`, same sampler maths on the shader side. Numerically it is *a* reading, not *the* data: (1) frequencies are Hillaire's choice (doubling), the book gives none [gp7]; (2) Perlin-Worley is the book's p.101 text form, not the Nubis tool's chain (`noise.md`); (3) Worley here is squared-distance with diagonal-only feature points, a different profile and statistics from Houdini's `worleynoise`; (4) Perlin octave weights are 0.5/0.25/0.0625, G/B/A are 8-bit truncated and Perlin range is un-stretched (R centred ~0.5 and narrow, so the remap's "full" range is not reached); (5) tiling is exact periodic (no soft blend band), unlike the Nubis tool whose 8-corner blend softens ~58% of the volume. For matching HZD we should treat the Nubis generator as the primary recipe and TVN as the cross-check/tiling reference. As a *tiling method*, TVN's is better (no softened zone).

**(c) Quality issues.**
1. **Diagonal feature points** (scalar offset): axis-(1,1,1) bias, lines of cells align along the cube diagonal; creases in `1-d^2` clamp at 1. Fix when porting: three independent hashes (`hash3(cell)`) and F1 (not squared), no clamp or clamp at sqrt(3).
2. **sin-based hash**: not portable to GPU (sin precision differs per vendor); use an integer hash (PCG / the `scHash33` we already have in `textures.ts`).
3. **Value noise wasted** (8 sin per cell); rewrite.
4. **Nyquist**: B's 64 cells and A's 64 cells at 128 texels are 2 texels per cell: aliasing under trilinear and especially under minification (mips of the 128^3). Test mip chains; GPU Pro 7 samples with mips.
5. **8-bit**: truncation + compressed Perlin range + fBM averaging leaves roughly 100-150 distinct levels in R, and 0.625/0.25/0.125 sums are narrow bells; contrast is then re-expanded by the remap chain, amplifying banding. Stretch the range before quantising (the Nubis tool has a `remap` knob for exactly this) or use R16/RG16 on devices where we can afford 2x memory.
6. **GLM Perlin**: classic gradient noise (12 edge gradients, quintic fade) has axis-aligned artefacts at octave 1; the 4D-slice workaround makes the w=0 slice sample only the 4D lattice's w=0 hyperplane, which lowers but does not remove grid alignment.
7. TGA output: 32-bit BGRA order, bottom-up rows; watch Y flip like the Nubis tool.

## What we already do / don't / should try
- **Do:** periodic noise in the weather bake (Sky Pro Perlin, `procedural/textures.ts` `scPerlin(..., period)`), `cirrus/bake.wgsl.ts` periodic gradient noise, generator Worley (`generate/shaders.ts` `worleyF1`).
- **Don't:** generate our own 128^3 shape/32^3 detail; we load Takram/Sky Pro blobs of unknown recipe (see `noise.md` comparison).
- **Try:** (i) a compute-shader port (WGSL) of the TVN recipe with fixed Worley (3D jitter, F1) writing to a `rgba8unorm`/`rgba16float` 3D storage texture at init, as a reference arm against the Nubis recipe; (ii) test both ladders (doubling vs 1:1.7:2.3) and PW forms side by side in the same sampler; (iii) use the MIT licence: the structure can be reused with the credit, but the code is simple enough to rewrite cleanly.

## Superseded by / supersedes
Reimplements GPU Pro 7 ch. 4 [gp7]; companion to the Frostbite SIGGRAPH 2016 course (physically based sky/atmosphere/clouds). Superseded for HZD fidelity by the Nubis noise generator (`noise.md`), and for Nubis Cubed by Alligator/Curly-Alligator noise [`n3`].
