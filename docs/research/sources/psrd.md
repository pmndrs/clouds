# psrdnoise (S. Gustavson and I. McEwan, 2021-22; GitHub stegu/psrdnoise; JCGT vol 11 no 1)
Local: none (read from raw.githubusercontent.com: README, `src/psrdnoise3.glsl`, `psrdnoise3-min.glsl`, `psrdnoise3.wgsl`) · Tags: noise flow tiling analytic-derivatives · Status: 🟦 note written, 3D GLSL and WGSL read; the JCGT paper page returned no text through the fetcher, so paper-only claims (benchmarks, quality plots) are **not** covered, only what the source comments say

## In one paragraph
Periodic (tiling) **3D simplex noise with rotating gradients and exact analytic first derivatives**, in GLSL (1.20+), **WGSL** (`src/psrdnoise3.wgsl`, 2D and 3D, all variants), HLSL ports by third parties, MIT licence (c) 2021-22 Gustavson and McEwan. One call returns the noise value in about [-1, 1] and, optionally, its gradient. Features: integer **periods per axis (up to 289)**, a per-call scalar `alpha` that rotates every lattice gradient (the "flow noise" of Perlin and Neyret: features swirl instead of boiling), and gradients from a Fibonacci-sphere set instead of a lookup table. Uses only float maths (no textures, no integer ops): a polynomial permutation mod 289. Zero texture bandwidth.

## Key mechanisms (exact, from `psrdnoise3.glsl`)

**Axis-aligned simplex grid (this is what permits rectangular tiling)**
```
M  = mat3(0,1,1, 1,0,1, 1,1,0)         // texture space -> simplex ("uvw") space
Mi = mat3(-.5,.5,.5, .5,-.5,.5, .5,.5,-.5)   // back
uvw = M * x;  i0 = floor(uvw);  f0 = fract(uvw)
// rank-order f0 to pick the 3 other corners of the tetrahedron (same walk as Gustavson's earlier snoise)
v_k = Mi * i_k ;  x_k = x - v_k          // vectors to the four corners
```
Classic simplex noise skews along the cube diagonal, so its cells are not axis-aligned and cannot tile a box. Here the lattice vertices `v = Mi*i` are the points `((-i.x+i.y+i.z)/2, ...)`, which form a **body-centred-style lattice whose unit cell contains axis-aligned period vectors**. Optional `#define PERLINGRID` uses Perlin's older skew (`x + dot(x,1/3)`), ~1% slower, but periods must then be multiples of 3 (otherwise the real period is 3x).

**How periodicity works**: after finding the four corner vertices `v_k` in texture space, wrap each coordinate `v.x mod period.x` (etc.) per axis, convert back with `M`, round (`floor(.+0.5)` "fix rounding errors"), and hash the *wrapped integer simplex index*:
```
vx = mod(vx, period.x) (if period.x > 0) ... ; i_k = floor(M * (vx_k, vy_k, vz_k) + 0.5)
hash = permute(permute(permute(vec4(i.z)) + vec4(i.y)) + vec4(i.x))
permute(x) = mod(((mod(x,289)*34)+10) * mod(x,289), 289)
```
- **Allowed periods**: any positive integer, independently for x, y, z (a vertex shifted by an integer period maps to an integer simplex index because `M*(p,0,0) = (0,p,p)`), **up to 289**; a longer period silently produces errors because the hash is mod 289. Period <= 0 (or 0.0) disables wrap on that axis; all periods 0 runs 10-15% faster. With `PERLINGRID`, multiples of 3 up to 288.
- Period is in the units of `x`: to tile a unit texture N times, call `psrdnoise(uvw * N, vec3(N), alpha, g)`. Octaves with period N, 2N, 4N, ... must be powers or integer multiples; octave k at `2^k N` caps at 289 (N=8 allows 4 octaves, 128/256 fits only one or two).
- Because the hash is only a 289-value polynomial of the wrapped indices, a noise with period near 289 repeats its gradient pattern in x/y/z structured ways; the author chose the polynomial `(34x+10)x mod 289` for decorrelation but offers no quality guarantee beyond that.

**Gradient and rotation**
```
theta = hash * 3.883222077                 // 2*pi / golden ratio (Fibonacci spiral longitude)
sz    = hash * -0.006920415 + 0.996539792  // z = 1 - (hash+0.5)*2/289  (latitude)
psi   = hash * 0.108705628                 // 10*pi/289, rotation-axis phase "chosen to avoid correlation"
p  = (cos(theta)*sqrt(1-sz^2), sin(theta)*sqrt(1-sz^2), sz)       // the generating gradient (unit)
q  = unit vector orthogonal to p, from psi        // pseudo-random orthogonal axis
g  = cos(alpha) * p + sin(alpha) * q               // rotated gradient: a great circle on the sphere per lattice point
```
So all four hash-derived gradients are unit vectors spread over the sphere (289 distinct), each spins in its own plane as `alpha` grows; `alpha = 0` gives `g = p`. With `alpha != 0` it costs more sin/cos; `#define FASTROTATION` is ~10% cheaper but never takes the `alpha == 0` shortcut. If `alpha` is uniform and 0 across a wave, `alpha == 0` skips the rotation branch entirely (15-20% faster per the header).

**Noise value and gradient**
```
w   = max(0.5 - |x_k|^2, 0);  n = sum_k w_k^3 * dot(g_k, x_k)       // radial kernel (0.5-r^2)^3, support radius sqrt(0.5)
dn  = sum_k ( w_k^3 g_k - 6 w_k^2 (g_k . x_k) x_k )                  // exact analytic gradient
return 39.5 * n ;  gradient = 39.5 * dn
```
The gradient is exact (not finite differences), so it is the input of Bridson-style curl noise (below) or of surface-normal / slope effects. Not requesting the `out` gradient lets the compiler delete it (~10% cheaper).

**Variants in the repo**: `psrdnoise2.glsl` (2D, with mediump-compatible variant `mpsrdnoise2`), `psrddnoise2/3.glsl` (**second** derivatives / Hessian), the `-min.glsl` compact versions, WGSL for 2D and 3D with a family of function names (no overloading in WGSL): `psrnoise3(x, p, alpha)`, `psnoise3(x, p)`, `srnoise3(x, alpha)`, `snoise3(x)`, and `psrdnoise3 / psdnoise3 / srdnoise3 / sdnoise3` returning struct `NG3 { noise: f32, gradient: vec3<f32> }`.

## Cost per sample
Not benchmarked in the sources I could read; the header gives only relative figures (alpha const 0: -15-20%; no gradient: -10%; all periods 0: -10-15%; FASTROTATION: -10%; PERLINGRID: +1%). My count of the work (estimate, not a measurement): 4 corners (vs 8 for classic Perlin), ~3 mat-vecs + corner ranking, 3 chained `vec4` permutes (each 2 `mod`), 4 sin + 4 cos + 1 sqrt for the gradients, 4 more sin/cos for `psi` plus 2 for `alpha` when rotating, 4 `dot`s for the kernel, plus the gradient sum. Around 150-250 ALU instructions, **no texture fetches and no integer/bit ops**. Compared to one trilinear `textureSample` of a baked 3D noise this is far heavier on ALU; compared to a 3-octave fBM of baked samples it is similar per octave only if we use gradients.

## Comparison with our noise
We have **no runtime analytic noise** in the cloud sampler: shape comes from baked 3D textures (Takram `shape.bin` R8 128^3, Sky Pro 64^3 RGBA8) and the periodic Perlin fBM `scPerlin` only runs in the weather bake (`procedural/textures.ts`, classic gradient noise with a 16-way hash, quintic fade, period parameter). `cirrus/bake.wgsl.ts` has a 2D periodic gradient noise `gnoise`. The generator's Worley/value noise live in `generate/shaders.ts`. Compared with the Nubis generator (`noise.md`) and TVN (`tvn.md`):

| aspect | psrdnoise | Nubis generator R channel (5-octave Perlin, 5 cells) | TVN Perlin (GLM 4D slice) |
| --- | --- | --- | --- |
| lattice | tetrahedral simplex, axis-aligned for tiling | Perlin cubic (`onoise`) | cubic |
| tiling | exact periodic, per-axis integer period <= 289 | not periodic; 8-corner smoothstep blend, 25% border, 58% of volume softened | exact periodic, period = frequency |
| grid artefacts | far fewer than cubic (simplex has no axis-aligned creases); tetrahedral structure shows at low octave | cubic grid axes show | cubic grid axes show |
| derivatives | exact analytic | none | none |
| animation | `alpha` rotation (swirl), per-lattice-point axis | none | none |
| range | about [-1,1], not zero-mean-guaranteed | after `fit` | compressed bell around 0.5 |

## Assessment for us

**(b-1) Better-tiling bake source.** Yes. Replace the Perlin octaves (R of the PW, and TVN's GLM Perlin) with `psrdnoise` periodic octaves in a WGSL compute bake: periods 5, 10, 20, ... (and the Nubis tool's base freq 5 gives octaves 5, 10, 20, 40, 80 up to the 289 cap), exact seams, so **the Nubis tool's soft 25% blend band (58% of voxels at ~16% lower std) can be replaced with genuinely periodic noise**, as noted in `noise.md` step 4. Worley still needs its own periodic version (wrap cell index; copy the TVN approach with 3D jitter). Only the Perlin-like R base and the curl/turbulence texture benefit; the G/B/A Worley fBMs do not.

**(b-2) Runtime analytic noise.** Possible but not as a replacement for the baked textures: per-sample cost in the march (fBM x octaves x steps) is too high. Fits where the sample count is small:
- **Near-camera detail**: add 1-2 psrdnoise octaves only for hero-range steps when the baked 32^3 detail would show texel repetition at 100 m tile; the repeat-free option is `period = 0`.
- **Curl / flow for advected detail** (`docs/research/cloud-motion-ideas.md`): the exact gradient gives a divergence-free field cheaply as the curl of three decorrelated psrdnoise gradients (`curl = (dNz/dy - dNy/dz, ...)`, three calls or the Hessian versions `psrddnoise3`) or of a vector potential built from three offsets; no finite differences, no 3 extra texture reads, and tiling in a period box. Our baked `turbulence.png` (128^2 R8) is a 2D, fixed-resolution alternative.
- **Boiling vs travelling**: advect the sample position by wind/velocity (translate, no `alpha`) for **travelling detail**; use `alpha(t)` for **boiling/swirl** in place. The recommendation in the motion notes is "no boiling", so `alpha` should be small/slow and tied to local vorticity, if used at all, and per-lattice-point rotation axes mean features do not shear coherently like real advection.
- Flow-noise caveats: with rotation, features at different lattice points spin at the same rate, making a visible uniform "churn"; use `alpha` as a small perturbation on a travelling base.

**(b-3) Use as the 3D "cloud shape" generator for artist VDB/NVDF up-rez**: the analytic gradient gives surface normals/slope for free, useful for shading the up-rez erosion (not tested).

**(c) Quality issues.**
- **Range and zero-mean**: output in about [-1,1] but real values rarely exceed +/-0.7; renormalise before using in a `remap` chain (Nubis tool's `fit(-0.6, 0.6)` is the same idea).
- **Hash/period limit 289**: octave frequencies beyond 289 break; periods near that limit show the 289-value gradient set repeating. Keep frequencies <= ~64 for baked tiles, use domain shifts instead of higher periods.
- **Precision**: all in f32 with `mod 289` of values up to ~289^2; fine in f32, **not safe in f16**. `mediump` exists only for 2D. In WGSL, `f32` is fine; do not use `f16` for the hash.
- **Tetrahedral structure**: simplex noise has directional bias at the lattice axis; the Perlin grid option rotates it but forces periods multiples of 3.
- **8-bit quantisation** of any bake still applies: store Perlin-like fields with their own range stretch.
- **Cost**: the gradient is dead-code-eliminated if unused; WGSL has no overloading so call the right variant (`psnoise3` etc.).
- **WGSL port needs a syntax fix before it compiles today**: the repo's `psrdnoise3.wgsl` uses the 2021-era struct syntax (`noise: f32;` with semicolons); current WGSL requires commas. Everything else is plain arithmetic. The README says its output matches the GLSL but it has had only "minimal testing". Allow for a 15-minute port plus a CPU reference check (we have no WGSL test harness for it yet).

## Formulas and constants (summary)
`M`, `Mi` above; `permute(x) = mod((34 x + 10) x, 289)`; `theta = hash * 3.883222077`; `sz = hash * -0.006920415 + 0.996539792`; `psi = hash * 0.108705628`; kernel `(0.5 - r^2)_+^3`; scale `39.5`; gradient `39.5 * sum( w^3 g - 6 w^2 (g.x) x )`.

## What we already do / don't / should try
- **Don't:** have a rotating, gradient-returning, simplex or flow noise anywhere; runtime fBM in the density path.
- **Try (shape):** (1) bake the Nubis R-channel Perlin from periodic psrdnoise instead of the blended build; compare softness in the blended region (`noise.md` step 4). (2) Replace `turbulence.png` by an analytic curl of psrdnoise in the detail lookup of a hero cloud lab page and A/B against the baked texture (cost, visible repetition at 100 m tile). (3) Flow-noise `alpha` driven by local velocity curl as the "no-boiling" shear test for `cloud-motion-ideas.md`.

## Superseded by / supersedes
Builds on Perlin's simplex noise (2001, the "Flow Noise" of Perlin and Neyret, 2001) and Gustavson's earlier `snoise`/WebGL noise; supersedes the older non-tiling GLSL simplex implementations. The patent on simplex noise expired in January 2022 (README); these functions don't use the patented methods in any case.
