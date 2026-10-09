# P8 spec: sparse fine-resolution hero clouds (NanoVDB wire format, brick pool at runtime)

Design spike P8-E. The orchestrator owns this file; tasks implement it. If the spec is wrong, say so in the report.

## 0. Recommendation in one paragraph

Keep the regional 8 m field exactly as it is (NVDF rgba8, SDF r16, light grid) and give hero clouds a second,
sparse layer that carries **only the dimensional profile at 4 m** (2 m as an opt-in for one showcase hero).
On the wire that layer is a **NanoVDB Fp8 fog grid (`fine.nvdb`)** written by the hython converter through
WebVDB's pure-TS builder (or `nanovdb_convert`); at runtime the loader turns its 8³ leaves into a **brick pool
(rgba8unorm 3D texture, 10³ bricks with a one-voxel apron) plus an indirection grid** over the regional volume,
and `cloudDensity` reads the fine profile through one `textureLoad` + one trilinear fetch. Do **not** march the
NanoVDB tree in the hot path: measured on this Mac, a `pnanovdb.wgsl` Fp8 trilinear costs 2.2–2.7× a hardware
fetch, the brick-pool read 1.16–1.2×, and the tree code is 12 KB gzip against a core budget with 4 KB left.
The SDF, detail type, density scale and the light grid stay at 8 m; the coarse profile under a fine hero is the
mean of its fine voxels with an occupancy floor, so the SDF stays a conservative bound and the Q-1 micro and
in-line sun samples (0–48 m), which already resolve billow-scale self-shadowing, read the fine field for free.
Memory: a 700 m hero is 2.2–2.4 MB on the wire at 4 m (13–14 MB at 2 m) and 11–12 MB in the pool (3 MB with an
r8 pool, a follow-up). Static heroes are stamped by CPU re-bricking (snapped to the fine lattice); movable
heroes (≤ 4) sample their own local bricks and local SDF through a per-hero transform, so moving is a uniform
write. Phones keep the 8 m path (fine off by tier). WebVDB supplies the `.nvdb` loader, the CPU leaf reader
and the `.vdb → .nvdb` builder; its WGSL traversal is only needed for an optional GPU decode later.

## 1. Problem, constraints, inputs

- Q-1 / P4-G: silhouette and shading match Hyperion; the body is a smooth mass because 8 m voxels cannot hold
  5–20 m billow lobes and the 100 m-tile noise regenerates generic detail. Fine *shape* is the missing input;
  the lighting (micro sample, glow occlusion) is already in place and its cost paid.
- Dense fine storage is out: a 700 m hero at 4 m is 22–29 MB (rgba8 + r16), at 2 m 174–236 MB (measured, §2).
- The 4 MB-per-asset cap (P4) was set by dense storage. Sparse wire sizes below reset it: 4 MB coarse + 2.5 MB fine.
- Constraints that do not move: renderer-agnostic runtime (`GPUDevice` only), encode-don't-submit, no per-change
  bake that stalls a frame, Nubis density function with deviations written down, core entry under 60 KB gzip
  (55.8 KB today; `@clouds/three +deps` 58.3 KB), the parity page passes at Nubis-neutral inputs.
- Inputs: `packages/runtime/src/shaders/{volume,density,march,lighting,light-grid}.wgsl.ts`, `runtime.ts`,
  `light-grid.ts`, `generate/stamp.ts`, `import/*`, `scripts/vdb/vdb_to_nvdf.py`; WebVDB `packages/nanovdb-wgsl`
  (vendored `pnanovdb.wgsl`, `NanoVDBFile`, CPU `readValue`), `packages/vdb-web-tools` (`buildFromVdb`,
  `buildFromDense`, `quantize('fp8')`, `writeNvdb`), `packages/three-nanovdb` (not used: three-specific).

## 2. Measurements (prototype numbers)

Scratch code lives outside the repo: `<scratchpad>/p8e/measure-memory.mjs` (CPU) and `<scratchpad>/p8e/web/bench.{html,js}`
+ `serve.mjs` (GPU, driven by `scripts/gpu/capture.mjs --url`). Results in `<scratchpad>/p8e/out/{memory.json,bench/capture.json}`.
The report (`work/reports/P8-E.md`) repeats the tables.

### 2.1 Storage per hero (runtime importer `convertVdb`, fog mode, same options as the shipped assets)

"shell 40" = voxels within 40 m of the surface (`MICRO_DEPTH`): the only region where fine detail is visible.
NanoVDB sizes use the Fp8 node sizes from WebVDB's stride tables (leaf 608 B, lower 33,856 B, upper 270,400 B).
Pool sizes are 10³-voxel bricks (one-voxel apron) plus the indirection grid.

| hero | voxel | dims | occupied voxels (frac) | leaves | dense rgba8+r16 | `fine.nvdb` Fp8 | pool r8 | pool rgba8 | shell 40: nvdb / pool rgba8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sim-cumulus | 8 m | 85×92×62 | 121 k (25%) | 482 | 2.9 MB | 0.60 MB | 0.49 MB | 1.9 MB | 0.59 / 1.9 |
| sim-cumulus | 4 m | 169×182×121 | 976 k (26%) | 2,961 | 22.3 MB | **2.21 MB** | 3.0 MB | **11.9 MB** | 2.06 / 10.9 |
| sim-cumulus | 2 m | 336×361×239 | 7.8 M (27%) | 19,745 | 173.9 MB | 12.9 MB | 20.0 MB | 79 MB | 11.2 / 68 |
| sim-congestus | 4 m | 162×149×198 | 1.13 M (24%) | 3,151 | 28.7 MB | **2.32 MB** | 3.2 MB | **12.6 MB** | 2.01 / 10.6 |
| sim-congestus | 2 m | 322×297×395 | 9.0 M (24%) | 21,653 | 226.7 MB | 14.1 MB | 22.0 MB | 87 MB | 10.9 / 66 |
| disney (quarter, ×1.75) | 4 m | 181×217×124 | 1.13 M (23%) | 3,295 | 29.2 MB | **2.41 MB** | 3.3 MB | **13.2 MB** | 2.21 / 11.9 |
| disney (quarter, ×1.75) | 2 m | 361×441×247 | 8.8 M (22%) | 22,098 | 235.9 MB | 14.4 MB | 22.4 MB | 88 MB | 12.3 / 75 |

Conversion (node, importer, including the exact EDT): 1.1–1.6 s at 4 m, 8.5–9.5 s at 2 m.
Reading: sparse Fp8 is 10–16× smaller than dense; 4 m is the sweet spot (one hero ≈ one current coarse asset on
the wire); 2 m is a 13–14 MB download and a 70–90 MB rgba8 pool, so it is for one hero with the shell option or
the r8 pool. The shell cuts 15–25% (these heroes are mostly shell), 2.3× less at 24 m.

### 2.2 GPU cost per profile sample (headless Chrome 149, Metal, M5 Pro, timestamp queries, median of 12)

WebVDB's `wdas_cloud_quarter_fp8.nvdb` (41,312 leaves, 29 MB), a 256³ index crop decoded on the GPU through the
vendored library; 1920×1080 threads each taking N coherent samples along one diagonal direction; sums verified
equal across kernels (mean 23.02 / 22.94 / 23.02).

| kernel | what it does | N=48, 1 voxel/step | N=24, 4 voxels/step |
| --- | --- | --- | --- |
| `tex` | `textureSampleLevel` on a dense rgba8unorm 3D texture (today's `sampleModeling`) | 11.32 ms, 0.114 ns/sample, **1.00×** | 5.28 ms, 0.106 ns, 1.00× |
| `atlas` | `textureLoad` on a 32³ r32uint indirection + one trilinear fetch from the brick pool | 13.16 ms, **1.16×** | 6.33 ms, **1.20×** |
| `nvdb1` | one `pnanovdb_readaccessor_get_value_float` (nearest, cached descent) | 4.22 ms, 0.37× | 3.17 ms, 0.60× |
| `nvdb` | `pnanovdb_sample_trilinear_fp8` (8 accessor taps) | 24.76 ms, **2.19×** | 14.29 ms, **2.71×** |

Also: decoding the 16.7 M-voxel crop from the tree (one uncached accessor per voxel) took **0.85 ms GPU**
(≈ 20 G voxels/s), so a GPU decode of a 4 m hero (5 M-voxel box) is about 0.25 ms; the brick pool fill from a
dense texture was in the same range. The Fp8 wire format costs nothing at sample time because the pool holds
decoded unorm8.

Reading: the tree is a fine *container* and a poor *sampler*. In the march every lit step makes about four
`cloudDensity` calls (sample, micro, two in-line sun samples) plus noise, SDF and light-grid fetches; a 2.2–2.7×
profile fetch would add roughly 25–40% to the march inside heroes, the brick pool about 3–5%. Phone GPUs have
smaller caches and no measured number here; the pool's two texture ops are the safe shape for them.

## 3. Format decision

| option | sample cost | wire | GPU memory (4 m hero) | core size | verdict |
| --- | --- | --- | --- | --- | --- |
| A. NanoVDB tree sampled in the march (profile+SDF in trees) | 2.2–2.7× per profile fetch; accessor state per ray and per sun ray; SDF in a tree is pointless (dense by nature) | 2.4 MB | 2.4 MB (the image as is) | +12.3 KB gz WGSL | **rejected for the hot path**; kept as the wire and decode source |
| B. brick pool + indirection (this spec) | 1.16–1.2× | 2.4 MB (`fine.nvdb`) | 12 MB rgba8 (3 MB r8) + 1 MB indirection | ≈ +1.5 KB gz | **chosen** |
| C. dense fine texture | 1.0× | 22–29 MB | 22–29 MB | 0 | rejected: memory and download |

What is fine and what stays coarse:

| field | resolution | where | why |
| --- | --- | --- | --- |
| profile (R) | 4 m (2 m opt-in) | brick pool | the only field whose resolution the eye sees (erosion shell, silhouette, billow self-shadowing) |
| detail type (G), density scale (B) | 8 m | regional NVDF, copied into the bricks at load | slowly varying (height-driven, P4-B); copying them into the brick keeps one fetch inside heroes |
| SDF | 8 m | regional SDF | only has to be a lower bound: built from the coarse profile whose occupancy is a superset of the fine occupancy (§4.3) |
| light grid | 16 m cells | as today, from the coarse field | low-pass sums; billow-scale shadowing comes from the fine in-line samples (§4.4) |
| noise | as today | | §4.5 |

Why rgba8 bricks and not r8: inside a fine brick the sampler returns the brick's (profile, type, scale) with one
fetch and never touches the regional NVDF; with r8 bricks every hero sample would pay a second fetch for G/B
(≈ 2.2× the NVDF cost instead of 1.2×). Memory is the price (12 MB vs 3 MB per 4 m hero). An r8 pool with the
double fetch is a documented follow-up for 2 m heroes (`HERO_POOL_R8` build switch), not v1.

Shell option: the converter may drop leaves deeper than `--fine-shell <m>` (default off at 4 m, 32–40 m
recommended at 2 m). The sampler needs no change: an empty indirection cell falls back to the coarse field,
which holds the hero's interior anyway. The seam sits 32–40 m inside, where erosion no longer shows.

## 4. Runtime design

### 4.1 Resources

Per regional volume (one `GpuCloudVolume`):

- **Indirection grid** `heroIndir`: `r32uint` 3D, dims = `ceil(volumeDims * 8 / (8 * fineVoxel / coarseVoxel))`,
  i.e. one cell per fine brick footprint (32 m at 4 m, 16 m at 2 m), texture axes (x, map row, up) like the NVDF.
  512×512×64 @ 8 m → 128×128×16 cells = 1 MB at 4 m; 256×256×32 = 8 MB at 2 m. Value: brick slot, `0xFFFFFFFF` empty.
- **Brick pool** `heroPool`: `rgba8unorm` 3D, bricks of 10³ texels (8³ payload + apron), packed 32×32 per slab:
  size `[320, 320, 10 * slabs]`, 4 KB per brick, 4 MB per slab of 1,024 bricks. Grown by reallocation in whole slabs
  (copy old slabs with `copyTextureToTexture`); capacity limit `maxTextureDimension3D` (2048) → 204 slabs.
  Slot `s` → brick origin `(s % 32, (s / 32) % 32, s / 1024) * 10`.
- **Hero uniform block** (64 B): fine voxel size, cells per axis, pool depth, `fineDistance`, `fineErosion`, instance count.
- Bind group: `createVolumeBindGroupLayout` gains bindings 6 (`heroIndir`), 7 (`heroPool`), 8 (hero uniforms);
  always present (a 1×1×1 empty indirection and a 10³ pool when the volume has no heroes), so every pass keeps one
  volume bind group and `layout: 'auto'` stays banned.
- Usage: pool and indirection are `TEXTURE_BINDING | COPY_DST | COPY_SRC` (CPU-filled by `writeTexture` per slab;
  `rgba8unorm` is also a storage format, which the later GPU stamp path uses).

### 4.2 Sampling (WGSL, in `volume.wgsl.ts`)

```wgsl
struct HeroParams { fineVoxel: f32, cells: vec3<u32>, poolDepth: f32, fineDistance: f32, fineErosion: f32, instances: u32 }
@group(g) @binding(6) var heroIndir: texture_3d<u32>;
@group(g) @binding(7) var heroPool: texture_3d<f32>;
@group(g) @binding(8) var<uniform> hero: HeroParams;
const HERO_EMPTY = 0xffffffffu;

// Modeling triple with the fine hero overlay where a brick exists; the coarse triple elsewhere. x = profile, y = type, z = scale,
// w = 1 inside a fine brick (lets the density function scale the erosion).
fn sampleModelingHero(p: vec3<f32>, mip: f32) -> vec4<f32> {
  if (!insideVolume(p)) { return vec4(0.0); }
  let q = p - cloudVolume.minCorner;
  let f = vec3(q.x, q.z, q.y) / hero.fineVoxel;            // fine voxel coordinates, texture axes
  let cell = vec3<i32>(floor(f / 8.0));
  let slot = textureLoad(heroIndir, cell, 0).r;
  if (slot == HERO_EMPTY) { return vec4(sampleModeling(p, mip), 0.0); }
  let origin = vec3<f32>(f32(slot % 32u), f32((slot / 32u) % 32u), f32(slot / 1024u)) * 10.0;
  let uvw = (origin + 1.0 + (f - vec3<f32>(cell) * 8.0)) / vec3(320.0, 320.0, hero.poolDepth);
  return vec4(textureSampleLevel(heroPool, clampSampler, uvw, 0.0).rgb, 1.0);
}
```

Integration:

- `DensityInputs` gains `fine: u32` (replaces the free `_p0`-style slot; the signature in P1-runtime.md is amended).
  `cloudDensity` calls `sampleModelingHero` when `fine != 0 && rayDistance < hero.fineDistance`, else `sampleModeling`.
  The march sets `fine = 1` for the near pass and the far pass; the dome, the sky layer and the parity page pass 0.
  The in-line and micro sun samples share `inputs`, so they read the fine field too (that is the point).
- `fineDistance` is a tier preset: ultra/high 3000 m, medium 1500 m, low 600 m, mobile 0 (off; mobile and low keep
  today's cost and memory, the loader skips the pool upload when the tier has fine off).
- Erosion: `noiseComposite *= mix(1.0, hero.fineErosion, m.w)` before `valueErosion`, default `fineErosion = 1`
  (no change, Nubis-neutral); art tuning in H6 (§4.5).
- Everything else that reads `sampleModeling` stays coarse: the light-grid reduce, `flashGlow`, the dome, the sky layer,
  the stamp seeds, the composite. The indirection load is ~0.16× of a fetch, so empty space costs ≤ 3% of the march.

### 4.3 Composition with the regional field

Static (stamped) heroes:

1. **Coarse stamp, as today** (`stampCloud`), but a fine hero must be stamped with `mode: 'replace'` (the regional
   cloud is cleared within `clearMargin` of the hero) and with its position snapped to the fine lattice and its yaw
   to a quarter turn (§4.6). With `max` the fine overlay would carve holes where the hero's fine profile is 0 over a
   regional cloud, so `max`/`cutout` stamps of fine heroes silently drop the fine layer (coarse-only, warned once).
2. **Coarse-from-fine rule** (converter and importer, §5): coarse R = mean of the 2×2×2 (4×4×4 at 2 m) fine profiles,
   floored at 1/255 when any of them is > 0. Hence `profile > 0` on the coarse lattice ⊇ the fine occupancy dilated to
   coarse voxels, the EDT with the generator's one-voxel margin stays a lower bound of the true distance, and
   `cloudDistance`, `MICRO_DEPTH`, `DEPTH_CAP` and the inner-glow remap keep their meaning. Coarse G/B as today.
3. **Fine stamp**: the loader re-bricks the hero's fine lattice into the volume's brick grid (a brick straddles up to
   8 world bricks when the offset is not a multiple of 8 fine voxels: pure block copies, no filtering) and writes
   slots into the indirection; the apron of each world brick is filled from the hero's lattice (0 outside it).
   G/B of each brick texel come from the volume's coarse NVDF (CPU trilinear of the just-stamped coarse field).
4. **SDF**: `createSdfRebuilder` once after the last stamp, unchanged (32–68 ms, amortizable).

Density union: inside a fine brick the brick wins (replace), outside the coarse field (which already holds the
`max`/`replace` result of all coarse stamps). SDF min is only needed for instanced heroes (§4.6). The indirection
grid is the acceleration structure: no per-hero loop for static heroes, empty cells cost one cached load.

### 4.4 Light grid

Keep it: 16 m cells, fed by the coarse `sampleModeling` in the reduce pass, sun march unchanged. Reasons:

- The grid carries the far optical depth (48 m and beyond); at that range an 8 m mean of the hero is the right input.
- Billow-scale self-shadowing (2–20 m) comes from the Q-1 micro sample (4 m, every lit step) and the two in-line
  samples (0–16, 16–48 m) which call `cloudDensity` and therefore see the fine profile. No extra cost: the samples exist.
- A hero-local grid would add a binding, a scheduler and a seam at its border for no visible gain at > 48 m.
- Static heroes change the coarse field at stamp time → `lightGrid.invalidate()` as today. Instanced heroes: §4.6.

### 4.5 Up-rez noise at 2–4 m voxels

- The noise texture stays (128³, 100 m tile = 0.78 m texels, mips by distance). It already has the frequencies; what it
  lacked was a profile with lobes to erode. PACK_FIT's profile reaches 1 over 66 m regardless of voxel size, so the
  erosion depth in metres is unchanged; at 4 m the noise cuts into a lobed surface instead of a smooth one.
- `fineErosion` (per volume, default 1) scales `noiseComposite` inside fine bricks; expected tuning range 0.6–1.0 if
  fine heroes read "double-detailed". `detailBias` (Q-1, 0.5) stays global. HF detail fold (< 150 m) unchanged.
- Converter: `corrVox` of the profile-spread noise is 3 *voxels* in PACK_FIT; it must become metres (24 m) so the
  patchwork statistics fitted at 8 m hold at 4 and 2 m. Depth bins of the fit were 4 m already.
- Acceptance is visual (H6): Disney edge side by side, cumulus ground 1:1 crops.

### 4.6 Instancing and transforms (movable heroes)

Two kinds of hero:

| | static (stamped) | instanced (movable) |
| --- | --- | --- |
| profile | in the volume's pool via the world indirection | in the pool, addressed by a per-hero *local* indirection grid in the hero's own lattice |
| G/B, SDF | regional NVDF/SDF (stamped) | the hero's own coarse NVDF and SDF (8 m) in an **instance atlas**: one rgba8 3D, one r16float 3D and one r32uint 3D texture holding the ≤ 4 instances' local volumes side by side (3 bindings, no bindless needed) |
| transform | snapped: position on the fine lattice, yaw ∈ {0, 90, 180, 270}°, scale 1 (the coarse stamp uses the same snapped values so coarse and fine agree) | free: translation, yaw, uniform scale; a 64 B entry in a uniform array `instances[4]` (inverse transform, local AABB in volume metres, atlas offsets) |
| move cost | re-stamp on the CPU (block copies, ≈ 5–20 ms per hero on a worker) + SDF rebuild | one uniform write; `lightGrid.invalidate()` when moved > 8 m or turned > 2°, at most once per finished build |
| sample cost | indirection load only | per sample: `instances` AABB tests (ALU); inside a box: inverse transform + the same indirection/pool read, `cloudDistance = min(regional, scale * localSdf(R⁻¹(p − t) / scale))` (valid for similarity transforms) |
| limit | pool capacity | 4 (uniform array; AABB tests are the per-sample cost) |

The coarse `sampleModeling` also gets the instance loop (max with the instance's coarse NVDF) so the light-grid
reduce, the dome and the lightning glow see movable heroes. Instanced heroes are phase H5; v1 ships static only.
"10 hero instances ≤ 1 ms" (plan) is met for static heroes by construction (no per-hero cost); for instanced ones the
budget is ≤ 0.2 ms each at 1440p high, to be measured.

### 4.7 Cost model and tiers

| | desktop high 1440p | phone (mobile tier) |
| --- | --- | --- |
| march overhead, no fine brick on the ray | ≤ 3% (one cached `textureLoad` per NVDF fetch) | 0 (fine off) |
| march overhead inside heroes | 3–5% (fetch 1.16–1.2×, no coarse fetch inside bricks) | 0 |
| acceptance | ≤ +10% and ≤ +0.3 ms on flagship `edge`/`inside` with a fine hero in view; ≤ +3% with none | bit-identical captures |
| GPU memory | +1 MB indirection (+8 MB at 2 m), +4 KB per brick: 12–13 MB per 4 m hero, 70–90 MB per 2 m hero (55–65 with shell 40) | +0 (pool not uploaded) |
| wire | +2.2–2.4 MB per 4 m hero (`fine.nvdb`, codec NONE; gzip over HTTP helps little on Fp8 codes) | same files, fine part skipped by tier |

Stamping and SDF: unchanged costs (stamp ≈ 0.05 ms GPU; SDF 32–68 ms amortized). Loader CPU: `.nvdb` parse is a
header read (codec NONE, zero-copy), brick extraction ≈ 3,000 leaves × 1,000 texels ≈ 10–20 ms per 4 m hero,
≈ 150 ms at 2 m (worker or `requestIdleCallback`; never on the frame path).

## 5. Asset format and conversion

### 5.1 `cloud.json` additions

```json
"fine": { "file": "fine.nvdb", "voxelSizeMeters": 4, "grid": "profile", "shellMeters": null,
          "offsetFineVoxels": [0, 0, 0], "dims": [181, 217, 124], "leaves": 3295, "bytes": 2410000 }
```

- `fine.nvdb`: one NanoVDB **Fp8 fog-volume** grid named `profile`, values 0..1, codec NONE, ABI 32.x, index space
  anchored so that fine index `(i, j, k)` (VDB axes X, Y up, Z) covers world `boundsMin + (i, j, k) * voxelSize`
  with the same axis mapping as the coarse data (texture x = X, row = Z, up = Y); the Map holds the voxel size and the
  translation so NanoVDB tools read it in metres. Coarse and fine lattices are nested (`coarseVoxel / fineVoxel` ∈ {2, 4}).
- Loaders without fine support ignore the key (coarse assets stay valid; `fine` is additive).

### 5.2 Converter (hython) and `.vdb → .nvdb`

`scripts/vdb/vdb_to_nvdf.py --fine-voxel-size 4 [--fine-shell 40]`:

1. Resample the source to the fine lattice (existing tent resampler), mask, exact EDT, PACK_FIT with `corrVox` in
   metres → fine profile (uint8). Coarse lattice = reduction of the fine one by the §4.3 rule (mean R + floor),
   G/B/SDF as today from the coarse mask. Writes `nvdf.bin`, `sdf.bin` (unchanged format) and `fine.vdb` (a float
   fog grid "profile", Houdini writes VDB natively; values already quantised to k/255 so Fp8 is lossless).
2. `node scripts/vdb/vdb-to-nvdb.mjs fine.vdb fine.nvdb --fp8` using WebVDB's `vdb-web-tools`
   (`parseVdb` → `buildFromVdb` → `quantize(image, 'fp8')` → `writeNvdb`), or `nanovdb_convert --fp8` from the
   OpenVDB tools / WebVDB's Docker image. Both produce byte-equivalent trees (WebVDB parity suite).
   The hython converter shells out to step 2 when `node` is on the path, else prints the command.
3. `check_parity.py` gains a fine check: decode `fine.nvdb` with WebVDB's CPU `readValue` and compare to the
   fine lattice (exact after quantisation).

### 5.3 In-browser importer (`@clouds/runtime/import`)

`importVdb(device, buffer, { voxelSize: 8, fineVoxelSize: 4, fineShell })`: `convertVdb` runs once at the fine
voxel size (1.1–1.6 s at 4 m, 8–10 s at 2 m, §2.1), derives the coarse lattice by the §4.3 reduction (so the two
agree by construction), builds the bricks straight from the fine lattice (no NanoVDB round trip), uploads coarse +
SDF rebuild as today, then the pool. Optional `exportFineNvdb(converted)` → `buildFromDense` + `quantize` +
`writeNvdb` (WebVDB) for the vdb-drop page's "download hero" button and for caching in IndexedDB.

### 5.4 Loader (`loadCloudVolume` → `uploadCloudVolume` / stamp)

- `NanoVDBFile` (WebVDB `nanovdb-wgsl/nvdb-file.ts`) for the header and the zero-copy grid image (codec NONE;
  ZIP via the import subpath only, to keep `fflate` out of the core).
- Leaf enumeration over the Fp8 image (lower/upper child masks → leaf origins; `gridTypeConstantsForId` gives the
  offsets; a ~60-line walker to add, see §6) → per leaf: `value = code * quantum + minimum` → unorm8, into the brick's
  payload; the apron from the 26 neighbouring leaves (hash of origins) or 0.
- Bricks are packed per slab in CPU memory (320×320×10 rgba8 = 4 MB) and uploaded with one `writeTexture` per slab.
- `uploadCloudVolume(asset)` returns the `GpuCloudVolume` with `fine?: { pool, indir, fineVoxel, slots }`;
  `setVolume` binds it; a volume without fine data binds the empty placeholders.

## 6. WebVDB: use, finish, extend

| item | state in WebVDB 0.1.0 | needed here | action |
| --- | --- | --- | --- |
| `NanoVDBFile` loader (`nvdb-file.ts`) | done, tested | yes | vendor into `packages/runtime/vendor/nanovdb-wgsl/` with NOTICE (as P4-H did for the parser) until WebVDB publishes; NONE codec in core, ZIP through the import subpath (`fflate` dependency) |
| CPU reader (`readValue`, `readLeafQuantum`, stride tables) | done, browser-safe since the baked tables | yes (converter parity, tests) | vendor; **add** a leaf enumerator (`forEachLeaf(image, (origin, valuesAddress, min, quantum) => …)`) — small, worth upstreaming |
| `buildFromVdb` / `buildFromDense` / `quantize('fp8')` / `writeNvdb` | done, native-parity tested on 4 fixtures (FLOAT and FP8) | yes (Node converter step, in-browser export) | use from `vdb-web-tools` dist in `scripts/vdb/vdb-to-nvdb.mjs`; in the browser only behind `@clouds/runtime/import` |
| `.vdb` parser | ours is ahead: Blosc lz4, `select`, constant tiles, pre-222 leaves, inactive-value defaults | yes (already vendored) | **upstream** `vendor/vdb-web-tools` changes to WebVDB (D6 wants blosc; ours is pure TS) |
| `pnanovdb.wgsl` traversal | done, audited, 12.3 KB gzip | not on the hot path; optional GPU decode (0.85 ms / 16.7 M voxels) | keep out of core; optional later `pnanovdb_decode_bricks` compute (brick list in, pool out), as a renderer-agnostic WGSL export of `nanovdb-wgsl` |
| `decodeToAtlas` (three-nanovdb) | writes a dense `Data3DTexture`, three-specific | no | the brick variant above replaces it for us |
| HDDA node skipping | deferred to v1.1 in WebVDB | no | none |
| `readNvdb` in vdb-web-tools | stub | no | none (loader covers it) |
| Fp4 / FpN | reader yes, quantizer FpN | no (Fp4's 16 levels band under erosion) | none |
| packaging | 0.1.0 tarballs, unpublished | | publish `nanovdb-wgsl` and `vdb-web-tools` 0.1.x, then replace the vendored copies with dependencies in the import subpath; core stays dependency-free |

Size budget: core gets the sampler WGSL, three bindings and `GpuCloudVolume.fine` plumbing (≈ +1.5 KB gzip →
≈ 57.3 of 60 KB). The `.nvdb` loader, leaf walker, brick packer, re-bricking stamp and export go to
`@clouds/runtime/import` (22.4 KB, unbudgeted); `check-bundle --strict` is part of every acceptance.

## 7. Phasing (tasks for the board)

| id | task | tier | size | owns |
| --- | --- | --- | --- | --- |
| H1 | Fine overlay in the runtime: indirection + pool resources, `sampleModelingHero`, `DensityInputs.fine`, `fineDistance`/`fineErosion`, placeholders, bind group; a test page `runtime-tests/hero-fine/` with a procedural 4 m field (sphere with 6–12 m bumps) in a 128³ volume, A/B vs its 8 m reduction | Sonnet (Fable on failure) | M | `shaders/{volume,density,march}.wgsl.ts`, `runtime.ts`, `resources.ts`, `index.ts`, the page |
| H2 | Converter: `--fine-voxel-size`, `--fine-shell`, coarse-from-fine reduction, `corrVox` in metres, `fine.vdb` out; `scripts/vdb/vdb-to-nvdb.mjs` (WebVDB); parity check; rebuild `disney`, `heroes/sim-*` at 4 m, one 2 m Disney (`assets/clouds/disney-2m/`, gitignored if > 15 MB) | Sonnet | M | `scripts/vdb/**`, `assets/clouds/**` |
| H3 | Loader and static stamp: vendored `NanoVDBFile` + leaf walker, brick packer, `GpuCloudVolume.fine`, `stampCloud` fine path (snapped transform, replace mode, re-bricking, apron fill, G/B copy), `cloud.json` schema | Sonnet | M | `packages/runtime/vendor/nanovdb-wgsl/**`, `import/**`, `generate/stamp.ts`, `assets.ts`, `resources.ts` |
| H4 | In-browser importer: `fineVoxelSize`, coarse by reduction, bricks from the lattice, `exportFineNvdb`; vdb-drop page controls | Sonnet | S–M | `import/**`, `examples/lab/vdb-drop/**` |
| H5 | Instanced heroes: instance atlas, `instances[4]` uniform, local SDF min, coarse loop for the light grid/dome, `clouds.addHero / hero.setTransform`, invalidation policy, flagship/onsen demo of a drifting hero | Fable | L | `shaders/volume.wgsl.ts`, `runtime.ts`, `packages/three/**`, demo |
| H6 | Tiers, art tuning, captures and docs: presets, `fineErosion`, Disney edge vs Hyperion, 1:1 crops, mobile A/B, docs page | Sonnet | S–M | presets in `runtime.ts`, `docs/guide/**`, captures |
| H7 | WebVDB upstreaming (owner's repo): parser changes, leaf walker, optional `pnanovdb_decode_bricks`, publish 0.1.x, swap vendored copies for dependencies | Sonnet | S | WebVDB; then `vendor/**` |

Order: H1 ∥ H2 → H3 → H4 ∥ H6 → H5; H7 any time after H3. H1–H3 give the visible result (Disney at 4 m in the flagship).

Acceptance per task:

- **H1**: parity page `pass: true` with `fine = 0`; test page captures show the bumps at 4 m and not at 8 m; a smooth
  ramp field sampled through the pool equals the dense trilinear within 1/255 everywhere, including brick borders and the
  volume's faces (apron test); flagship captures bit-identical with no fine data bound; `check-bundle --strict` green;
  march cost with an all-fine 128³ test volume ≤ 1.2× the dense one at the same resolution (GPU timer).
- **H2**: parity of `fine.nvdb` vs the fine lattice exact; Disney 4 m: `fine.nvdb` ≤ 3 MB, coarse ≤ 4 MB; 2 m with
  shell 40 ≤ 13 MB; conversion < 60 s wall; `test_nvdf_math.py` extended for the reduction rule (occupancy superset).
- **H3**: Disney 4 m loads and renders in the flagship (`?cloud=disney`) and stamped in the stamp page; pool memory within
  10% of §2.1; SDF conservativeness check (P4-C's CPU EDT comparison) still 0 overshoots with fine heroes stamped; march
  cost on flagship `edge`/`inside` ≤ +10% and ≤ +0.3 ms at 1440p high, ≤ +3% on a view without heroes; loader CPU
  ≤ 30 ms per 4 m hero (worker or idle).
- **H4**: Disney eighth imports at 4 m in ≤ 8 s total; exported `fine.nvdb` re-imports byte-equal; `convert.test.ts` covers the reduction.
- **H5**: one hero drifting 500 m across the flagship at 60 fps, no restamp hitch (frame p99 ≤ 20 ms), cost ≤ +0.2 ms
  per instance at 1440p high, its shadow in the light grid follows within 16 frames; 4 instances ≤ +0.8 ms.
- **H6**: side by side `work/captures/H6/disney-edge-hyperion-q1-h6.jpg` (Hyperion | Q-1 | H6) with visibly lobed, self-shadowed
  billows at 5–20 m; mobile and low captures bit-identical to today; docs page with the asset format and the converter recipe.
- **H7**: WebVDB tests green with the upstreamed parser; `pnpm check` here green after the dependency swap; sizes unchanged.

## 8. Risks

| risk | likelihood | mitigation |
| --- | --- | --- |
| Seams at brick borders (apron or half-texel convention wrong, or empty neighbour aprons) | medium | H1's ramp test; aprons always filled from the hero lattice (0 beyond it), never left uninitialised |
| Fine heroes look over-detailed or "double eroded" after the noise | medium | `fineErosion` (per volume), `detailBias` global; H6 captures decide; Nubis-neutral defaults keep parity |
| `replace`-only constraint surprises demo authors (holes with `max`) | low | documented; `stampCloud` warns and drops the fine layer for `max`/`cutout` |
| Coarse/fine misalignment from arbitrary yaw or unsnapped positions | medium | snapping enforced in `stampCloud` for fine heroes; the coarse stamp uses the snapped transform; H5's instanced path is the free-transform path |
| 2 m heroes blow the pool (70–90 MB) | high if used carelessly | 4 m default; 2 m only with shell 32–40 m or the r8 follow-up; `estimateCloudMemory` reports the pool; loader refuses above a per-volume pool cap (default 128 MB) |
| Jitter sparkle gets stronger with sharper fields (Q-1 noted it) | medium | temporal filter follow-up (P5-B history already exists); not a blocker |
| WebVDB unpublished; vendoring drifts | low | NOTICE + commit pin as for the parser; H7 swaps to dependencies |
| CPU re-bricking on placement (5–20 ms at 4 m, 150 ms at 2 m) hitches | low | at load, or on a worker; GPU stamp into the pool (rgba8 storage) is the follow-up if runtime restamps become common |
| Phone GPU behaviour of the indirection path unmeasured | medium | fine off on mobile/low tiers by default; P8-D's simulator bring-up can measure later |
| Light grid rebuild on moving instances (8–16 frames) lags fast movers | low | invalidation policy; accept lag for cinematics, cap instance speed in docs |

## 9. Open questions for the owner

1. Fine voxel default 4 m everywhere, 2 m only for one showcase hero: agreed?
2. Pool format rgba8 (fast, 12 MB/hero) now, r8 (3 MB/hero, +1 fetch) as a follow-up: agreed, or r8 from the start for 2 m?
3. Publishing WebVDB 0.1.x so the import subpath can depend on it instead of vendoring (H7).
4. Instanced heroes (H5) in this phase or deferred again; v1 static heroes already cover the onsen/flagship uses.
