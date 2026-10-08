# P5 / P6 local preview evidence

## Independent hardening — 2026-09-19

- Shared-renderer GPU harness: **28 checks passed** in Chrome / Metal 3.
  Two cloud views shared one renderer for three allocation/resize/disposal
  cycles. Changing and disposing one left the other view's optical output
  identical (maximum difference **0**, threshold 1e-5).
- Both views produced distinct, finite, nonblank images. Caller-owned CPU atlas
  bytes remained unchanged. Disposed views reject rendering. The caller's
  cubemap target, selected face 4 and MRT state survived compilation/rendering;
  single-cloud face restoration was corrected. No GPU validation errors.
- Material receiver ownership is now exclusive. A second runtime cannot chain
  a receiver onto the same material; explicit detach/attach or separate
  per-view materials prevent dangling references during out-of-order disposal.
- Asset decoding rejects unsupported flags/reserved bytes and trailing data.
  Mesh conversion checks vertex/triangle limits before copying data and rejects
  nonportable revisions and invalid transformed coordinates.
- React frame-driving refs update after commit. Explicit layer disposal stops
  subsequent updates and removes the mesh. Browser testing confirmed manual
  disposal, off/on recovery, camera UUID replacement, and cloud remount with
  ready=3 / dispose=2 / errors=0.
- React/vanilla parity after those operations: maximum L/T error **0** at
  **1222×744**, threshold 1e-5.
- **68 unit tests**, TypeScript and the complete lab build passed. Five package
  archives/checksums were refreshed; the independent installed consumer passed
  entry-boundary/declaration checks and **9 GPU smoke checks**. The initial
  offline install used an empty sandbox package cache; pinned dependencies were
  restored to the host cache, then the offline consumer check passed there.
  No dependency lifecycle scripts ran, and nothing was published.

These checks cover sequential shared-renderer use. Parallel asynchronous jobs,
automatic device-loss recovery, long-duration memory profiling, hardware beyond
the local Metal adapter and visual acceptance are not covered.

## Previous preview checkpoint — 2026-09-18

> **Evidence correction:** the earlier small production orbit audit disabled cloud
> self-shadowing. Its 4×/192 versus 4×/256 equality does not validate lighting
> convergence or a banding fix. The audit setting is corrected; a lit rerun and
> full-size cached/direct-light comparison remain pending. See the
> [corrected research note](research/cloud-quality-bench.md#production-atlasworld-audit--lighting-evidence-withdrawn).


2026-09-18, Apple M5 Pro / Metal 3, in-app Chromium 152. Technical results are
separate from rendering acceptance. Nothing is published.

## Library and assets

| Check | Result |
| --- | --- |
| Workspace unit tests | 66 passed |
| TypeScript and complete Vite lab build | Passed |
| Five ESM packages and declarations | Built and packed locally |
| Independent installed-archive consumer | All entries build without workspace aliases |
| Declarations | All entries pass Bundler; ordinary entries also pass NodeNext |
| Plain Three/layer boundaries | No React/FSR dependency; layer excludes volume/assets code |
| Packed consumer WebGPU smoke | 9 checks pass: asset round trip, 3 mount/resize cycles, cloudscape cache/integration and layer lifecycle |
| Plain Three preview | World, object and independent layer render; mount/unmount, camera replacement and explicit environment capture work |
| React output parity | Maximum optical L/T difference **0**, threshold 1e-5 at 1280×647 |
| React lifecycle | Actual camera UUID replacement; StrictMode remount reached ready=3 / dispose=2 / errors=0 |
| Authored fixtures | Blender 5.1.1 exported OBJ/`.blend` and a separate float32 density bake; both convert to 32³ r8 CLDA |
| Authored viewer | Both fixtures render finite visible density; malformed header and aborted fetch rejected, active cloud preserved; 5 checks pass, no errors |
| Malformed/oversized/cancelled loading | Unit tests cover metadata, transport bounds and cancellation during an outstanding read |

The optional upscaler's supplied declarations use extensionless imports and
currently require Bundler module resolution. That limitation is inherited from
the pinned port, not hidden with `skipLibCheck`. Source provenance and archive
checksums are in [release preview](release-preview.md).

The parity button compares the binding's renderer output with a separate
non-presenting vanilla runtime using identical inputs. It rejects blank or
non-finite images. This proves one static pose and the shared optical path;
it does not prove all multi-view scheduling combinations or future R3F versions.

## Rendering continuation

- P2: **19 GPU checks pass**, no application errors, after the density lookup change.
- P3: **23 GPU checks pass**, no errors, including environment capture and receivers.
- P4: **29 GPU checks pass**, no GPU validation errors; four-substep skip/full
  parity has error **0** against 1e-5.
- Full-size cached-lighting spot review: 945×600 Native with 4× view / 192 light
  samples, foreground pose and fixed flight progressing to 34.48 s, no errors.
  This is functional evidence and limited spot inspection, not acceptance of all
  reported arcs or motion strobing.
- The isolated and small production motion audits are recorded in
  [quality research](research/cloud-quality-bench.md). Their cost measurements
  do not establish production performance.

The FSR regression now disposes the old comparison runtime before creating its
fresh-history counterpart. This keeps the same image assertions while avoiding
unnecessary simultaneous Metal timestamp-query pools. Earlier query-allocation
failures and invalid shader bind groups were corrected before the clean P4 run.

## Gates still open

Original banding-angle visual retest; conservative acceleration performance;
distant/weather coverage and shadow agreement; full atmosphere; temporal wind;
long-duration multi-view stress and device loss; Windows/RTX; final API ergonomics and presets.
P6 here means an inspectable development preview, not final phase acceptance.
Use the [human review checklist](human-review.md) and [status](project-status.md).
