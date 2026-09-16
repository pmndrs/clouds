# P0 implementation evidence

Date: 2026-09-16. This report records the foundation stage only. It is not evidence of cloud appearance or cloud performance.

## Delivered

- pnpm workspace, MIT license, exact dependency lock, private core/Three package stubs.
- Contract v0 with density/extinction units, frame/view metadata and resource ownership.
- Rendering lab with sky/environment and raw-GPU-sharing views.
- Deterministic camera paths; CPU submission statistics with warmup/p50/p95; JSON report and PNG capture actions.
- Standalone scheduler update-before-render adapter with no React dependency.

## Browser execution

Executed in the Codex in-app desktop browser against the local development server. WebGPU device reports `metal-3`; the browser does not expose a complete model name. Do not interpret that as independent verification of M5 Pro hardware identity. RTX 3060/Windows has not been run.

The lab performs a raw WGSL → TSL pass and a TSL → raw WGSL pass over Three-owned storage textures and a StorageBufferAttribute. Diagnostic readback compares known values against analytical expectations. The normal rendering path shares GPU handles without CPU transfer. Diagnostic checks intentionally wait/read back; their duration is not a production performance measure.

Test sizes are 16³ → 8³ → 16³, reusing the texture objects while replacing the allocations. The buffer is checked numerically, and output textures are sampled by two visible node materials. Accepted tolerance is one rgba8 quantization step plus 0.00001. The displayed 8³ fixture naturally incurs quantization error because sevenths do not map exactly to 8-bit values.

A separate probe is initialized, disposed twice, then checked to reject further dispatch. Device loss handling stops rendering and requests reload; actual device-loss injection/recovery is not claimed tested.

## Sky and shadow fixture

Sky 0.3.0's capture scene accepts an added cyan object, followed by cube/filtered-environment regeneration. Toggling that object changes the metallic sphere's reflection. Directional shadows from two spheres render on the plane; the host's directional shadow depth texture is present after rendering. Sun controls update lighting and the environment.

These tests establish integration points only. Cloud-to-geometry shadows, geometry-to-cloud shadows, volumetric capture/parallax, arbitrary transparency, and atmosphere/cloud optical ordering remain later implementation work.

## Verification scope

Type checking, unit tests and the Vite production build are required at the final checkpoint. Unit tests cover optical thickness reference, density allocation validation, deterministic camera interpolation, measurement warmup/quantiles, report serialization, scheduler order/detach and probe lifecycle errors. GPU correctness is established separately by the browser checks.

A failed initial GPU probe exposed a multi-mip storage-view mismatch; storage textures now disable mip generation. Shader/readback checks were corrected for slice indexing and 256-byte readback row stride. The final checkpoint must be rerun after these corrections; historical failed runs are not acceptance evidence.

## Next unlocked work

P1.1: generated voxel density and source fixture; L1: independent 2D layer. P1.2 then builds the actual reference integrator. Core contracts remain provisional until those consumers validate bounds, transforms and optical semantics.


## Accepted checkpoint

- `pnpm check` passed: TypeScript, 10 unit tests across 6 files, production lab build.
- Final clean browser load: all 10 report checks passed, no captured GPU errors; 16³ maximum texture error approximately zero; 8³ maximum texture error 0.001681 (below the 0.003932 acceptance tolerance).
- Distinct producer values: the TSL producer inverts X, preventing its test from passing on the raw producer's stale output. Both consumer directions read the shared volume and buffer.
- Visible 3D slice control changes the sampled layer; both output materials render correctly after resize.
- JSON and PNG export were exercised and copied to local `artifacts/p0/2026-09-16/` (gitignored). The report records 600 measured frames after 30 warmup frames. These are diagnostic CPU-submit samples, not a cloud/GPU benchmark.
- Production build emits a large-chunk advisory for the combined Three/sky diagnostic lab (~986 kB minified / 273 kB gzip). Package splitting and consumer-size checks are P5 work; the advisory is not suppressed.
- Fresh-load evidence has no new warnings. Earlier hot-development logs contained the fixed mip/deprecation issue and a transient duplicate-Three warning during dependency optimization.

P0 is accepted for the local backend. Remaining GPU/platform work includes RTX/Windows verification and explicit loss/recovery testing. No cloud shadow or renderer performance claim is inferred from this foundation fixture.
