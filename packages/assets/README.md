# @clouds/assets

Renderer-free dense cloud transport. `encodeDenseAsset` / `decodeDenseAsset`
use the versioned CLDA container; `fetchDenseAsset(url, {signal})` loads with
caller-owned cancellation. Imports only `@clouds/core`.

Density payloads are X-fastest in axis-aligned metre bounds. The current GPU
uploader supports r8unorm. Wider float encodings are raw byte transport only,
not an advertised floating-point renderer. Configure `maxPayloadBytes` and
`maxDimension` for the target device. CLDA is not VDB or sparse storage.

This is an unpublished preview. See the repository's authored-asset example
and conversion provenance before choosing a production asset format.
