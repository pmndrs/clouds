# Tidewater density reference

Read-only source inspection, 2026-10-08. No Tidewater code or assets were copied,
and the demo was not executed. Its bundled beach screenshot was inspected as a
visual reference; the screenshot's renderer revision was not established.

## What is actually active

[`App.js:120`](/Users/dex/Developer/tidewater/src/App.js:120) uses
[`SkyProClouds.js`](/Users/dex/Developer/tidewater/src/sky/SkyProClouds.js:5)
by default. `?oldClouds` selects the earlier
[`Clouds.js`](/Users/dex/Developer/tidewater/src/sky/Clouds.js:10).
Both are readable raw WebGPU/WGSL implementations using Tidewater's own engine.
The active implementation explicitly identifies its Sky Pro lineage.

## Why this is useful for our quality gap

| Component | Tidewater evidence | Consequence for our implementation |
| --- | --- | --- |
| Weather and shape separation | Active weather scale 29 km, base scale 7.5 km; weather controls coverage and column height. Candidate shape is evaluated before erosion (`SkyProClouds.js:28–47,104–127`). | Coverage must change regional formation and height, with detail controlled independently. |
| Fine erosion | Active source samples shape noise again at 13% of base scale, with height-dependent erosion (`129–138`). The earlier source has separate erosion bands and a further close-range fetch (`Clouds.js:489–515`). | A broadly sampled final density field alone cannot retain the required small rim detail. Use a separate detail representation shared by view and light integration. |
| Boundary construction | The earlier source combines weather profile and shape into a raw boundary value before applying erosion and a steep density ramp (`Clouds.js:469–486`, helpers near `175`). | Preserve a shape/boundary representation during generation. Eroding an already saturated final density has lost some of the information needed to carve useful forms. |
| Distance filtering | Active `scConeLod` uses distance × pixel angular size, independently for base and detail (`103,255–261`). Earlier erosion bands converge toward their mean as they become subpixel (`Clouds.js:489–515`). | Detail should become filtered cloud mass with distance, retaining regional coverage. Avoid fading whole formations out merely because their detailed representation ends. |
| Noise production | Earlier source generates Perlin-Worley base and multiband Worley erosion on GPU (`Clouds.js:747–765`). Active source loads a mipmapped noise volume (`SkyProClouds.js:456–475`). | A small repeated noise texture can describe fine detail across a large world. Its resolution need not equal the resolution of the whole world density field. |

The active noise blob was inspected as data only: gzip, `NZZ1` header,
64×64×64, four channels and seven mip levels. This establishes that its noise
sampling has real mip data, not just a shader LOD parameter.

Our current broad procedural field is 96³ over 10×2.2×10 km: roughly 104 m
horizontal voxel spacing. The viewer's 3 km version changes that spacing to
31.25 m by stretching the same normalized field. The optional GPU refinement
can double resolution up to 192 per axis, but cannot recover all shape
information lost in the original final-density bake. Its erosion is also
baked at that bounded resolution. These are source-code observations and an
engineering explanation for missing detail, not a measured attribution of
every visual artifact.

The bundled Houdini fixtures have a separate problem: their input is explicitly
a dense collection of spherical particle footprints with native noise added.
They validate VDB conversion, not realistic cloud authoring. Their 8 m voxels do
not by themselves make those shapes a suitable quality reference.

## Next implementation packet

1. Keep the shared voxel/VDB transport and resource ownership foundations.
   Freeze the sphere-derived fixtures as import tests.
2. Build one isolated procedural formation source with explicit weather,
   base boundary, multiscale erosion and height profile. Generate detail at its
   own physical scale rather than baking everything into one broad 96³ field.
3. Evaluate the same final density in view and sunlight paths. Keep authored
   VDB data faithful by default; procedural erosion is an optional source
   modifier, not an obligatory reinterpretation of imported assets.
4. Compare fixed source/light/camera poses against the existing source, then
   orbit, approach, fly inside, and compare fine detail against its filtered
   distant representation. Measure transport and inspect silhouettes,
   cauliflower rims, flat bases, wisps, and temporal artifacts separately.
5. Optimize after convincing source quality: conservative skipping, light
   reuse and temporal reconstruction are useful references, not substitutes
   for cloud morphology.

Tidewater's sky-shell/background composition does not establish arbitrary
scene-depth composition or our voxel streaming/fly-through requirements. It
should inform this source packet, not replace the whole library architecture.

## Provenance

The repository declares MIT, copyright DRG Software Solutions LLC.
[`CREDITS.md:91`](/Users/dex/Developer/tidewater/CREDITS.md:91) expressly says the
owner publishes its earlier cloud adaptation under MIT. The active file is
also within the repository-wide code license. Noise/blue-noise binary provenance
is less explicit: `public/clouds/LICENSING.md` names other textures but not these
two blobs. This study imports neither code nor assets; no licensing confirmation
is needed to use it as reference. If source is subsequently adapted, retain
required notices and record exactly which source was used; generate our own
noise assets unless their reuse terms are established.

See the [transport audit](tidewater-transport-reference.md) for sampling,
lighting, reconstruction and ground-shadow details.
