# Dense authored assets

The first asset track uses one renderer-independent dense field contract:

```ts
{ descriptor: DensityDescriptor, data: Uint8Array }
```

`descriptor.dimensions` is `[x, y, z]`; `x + y * width + z * width * height`
is the payload order. Bounds are axis-aligned world metres and values are
dimensionless. `extinctionScale` maps a sampled value to inverse metres. The
Three reference uploader currently consumes `r8unorm` fields, while the
portable container also preserves the byte lengths of `r16float` and
`r32float` payloads for future readers.

## CLDA v1

`encodeDenseAsset` and `decodeDenseAsset` in `@clouds/assets` use a fixed 96
byte little-endian header followed by UTF-8 asset id metadata and the raw
payload. The decoder checks magic, version, header and metadata lengths,
dimensions, encoding, descriptor finiteness, expected payload length and input
truncation before it copies the payload. The default maximum payload is 256 MiB
and callers can lower it with `maxPayloadBytes`. No unchecked length from a
file controls an allocation. `fetchDenseAsset(url, { signal })` passes the
caller's `AbortSignal` to `fetch` and cancels outstanding stream reads on abort. It caps both declared and streamed transport bytes before retaining chunks; it does not create or own a controller.

The payload is raw bytes. The container does not perform a float conversion or
claim a sparse/VDB representation; a future `r32float` reader must validate
finite samples before converting them to a GPU format.

## Mesh conversion

`convertMeshToDensity` in `@clouds/tools` accepts indexed or non-indexed static
triangle positions. It validates finite vertices, indices, non-degenerate
triangles and a watertight two-manifold edge set. The caller supplies explicit
`padding` and `softness` in metres. An optional column-major 4×4 matrix is
applied before bounds and occupancy tests. The converter uses a slow CPU ray
parity reference and a point-to-triangle distance for the interior softness
band, producing a bounded `r8unorm` field with the same x-fastest layout. Mesh
vertex and triangle limits are checked before copying or allocating converted
geometry; callers can lower them with `maxVertices` and `maxTriangles`.

The redistributable author-owned cube fixture and its Blender authoring recipe live in
[`fixtures/authored`](../fixtures/authored/README.md). Its repeatable script
converts `cube.obj` to `cube-density.clda` at 32³ with 0.15 m padding and 0.08
m softness. The same Blender recipe bakes `density.raw` and `density.json`, a
static multi-lobe float32 source that the build script validates and quantizes
to `authored-density.clda`. Blender 5.1.1 produced the checked-in `.blend` and
OBJ on the current runner; the initial sandboxed Metal initialization failure
was resolved by the permitted background invocation. This is a dense mesh and
static authored-density proof, not a native VDB reader or writer. Sparse
storage, animated assets, and VDB support remain gated experiments until a real
parser/writer and round trip are verified.
