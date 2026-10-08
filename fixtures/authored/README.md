# Authored mesh fixture

This fixture is a redistributable, author-owned cube mesh in Wavefront OBJ form
and converted to the portable CLDA dense density asset. It is a small pipeline
proof, not a production cloud asset. The OBJ is watertight and uses metres; its
density bounds include 0.15 m of explicit padding and a 0.08 m surface softness
band. The reproducible authoring recipe is [`blender-authoring.py`](blender-authoring.py).
The recipe was executed successfully with Blender 5.1.1 (build
`b70da489d7f4`) on 2026-09-18, producing `cube.blend` and `cube.obj` before
running the dense converter. The initial sandboxed invocation failed during
Metal initialization; a permitted background invocation with device access
succeeded. No manually fabricated DCC export is used in the current fixture.

Blender authors a one-metre cube centred at `(0.5, 0.5, 0.5)`. OBJ's default
export axis conversion gives bounds `(0,0,-1)` to `(1,1,0)`; the converter
retains those coordinates. Padded density bounds are `(-0.15,-0.15,-1.15)` to
`(1.15,1.15,0.15)`, with 0.040625 m voxel spacing and extinction scale
0.025 m⁻¹. The viewer exposes a separate 100× display density multiplier.
This original fixture is covered by the repository MIT license. Blender is an
external authoring tool and is not redistributed with the library.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python fixtures/authored/blender-authoring.py
```

To repeat the conversion from this directory (from the repository root):

```sh
pnpm exec esbuild fixtures/authored/build-fixture.ts --bundle --platform=node --format=esm \
  --alias:@clouds/core=./packages/core/src/index.ts \
  --alias:@clouds/assets=./packages/assets/src/index.ts \
  --alias:@clouds/tools=./packages/tools/src/index.ts \
  --outfile=/private/tmp/clouds-authored-fixture.mjs
node /private/tmp/clouds-authored-fixture.mjs
```

The conversion is deterministic and writes `cube-density.clda` and
`authored-density.clda`. `density.raw` is little-endian float32 source data
from the Blender Python bake, and `density.json` records bounds, spacing,
extinction scale, and `r32float` source encoding. The build script validates
every source value is finite and in `[0,1]` before quantizing to runtime r8.
This is a static authored density bake, not a native VDB reader or writer.
Mesh transforms are explicit in the converter options; no hidden object
transform is inferred.

VDB import/export and sparse playback are separate gated experiments. This
fixture intentionally proves dense mesh conversion plus one static authored
density bake; it does not claim sparse playback or VDB support.
