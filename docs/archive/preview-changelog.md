# 0.0.0-preview.1 — local, unpublished

## Library delivery

- Framework-free Three.js entry points for cloudscape, bounded objects, a separate
  thin layer, environment capture and optional reconstruction.
- React 19 / R3F v10 WebGPU wrappers with explicit frame ownership, resize,
  camera replacement and disposal.
- Five locally packable ESM packages with declarations, boundary checks and an
  independent installed-package GPU smoke page.
- CLDA v1 dense transport with bounded fetch and cancellation, plus a CPU static
  mesh-to-density converter. A Blender 5.1.1 cube is exported and converted to
  a 32³ r8 density fixture with documented metres, bounds and extinction.

## Library hardening — 2026-09-19

- Shared-renderer lifecycle checks cover two views, independent resize/settings,
  disposal and caller-owned atlas retention across three cycles.
- Single-cloud rendering restores the caller's selected cubemap face/mip.
- Shadow receivers reject competing material owners and preserve later caller
  hooks on detach. Environment settings copy the experimental light method.
- React frame refs update after commit; explicit layer disposal removes its mesh
  and stops frame updates while the component remains mounted.
- Dense decoding rejects unknown header fields/trailing data. Mesh conversion
  validates vertex/triangle limits before copying and rejects invalid transforms
  and nonportable revision values.
- Refreshed unpublished archives pass independent consumer checks.

## Rendering investigation

- Independent analytic/voxel cloud bench with a dense reference, moving-camera
  audit, error view and separate primary/light sampling budgets.
- Opt-in production quadrature and light budgets in the reconstruction viewer.
- Strict skip/full-density parity checks; quality candidates remain under review.
- Visible comparison divider and explicit human pass/fail guides.

## Not resolved by this preview

Prominent volume banding is not accepted. Far coverage/LOD, view/shadow agreement,
weather coverage semantics, physical atmosphere, temporal wind, performance
presets and Windows/RTX evidence remain open. VDB/sparse playback and export are
not implemented. No stable API or publication decision is implied.

See [release preview](release-preview.md), [status](project-status.md) and
[human review](human-review.md) for the actual gates.
