# P0 integration decision — 2026-09-16

## Selected baseline

- Three.js and types 0.186.0; TypeScript 5.9.3, Vite 6.4.3, Vitest 3.2.7; pnpm 10.33.0.
- `@pmndrs/scheduler` 0.2.0 and `@pmndrs/sky` 0.3.0 are exact dev dependencies for probes.
- Registry checked: R3F v10 alpha target is 10.0.0-alpha.5 (stable is 9.7.0). React bindings are not installed or claimed compatible yet; implement in P5 against a pinned v10 revision.
- Local upscaler reference: 0.2.0 at 4a79229, inspected previously against Three r185. P0 tests the analogous resource connection at r186 rather than assuming compatibility.
- Internal workspace package names `@clouds/core` and `@clouds/three` are private placeholders. No npm namespace is reserved or published.

## Contract v0

Core uses right-handed world coordinates in metres, linear HDR, explicit density-to-extinction scale, immutable descriptors and content revisions. The frame declares view ID, render/output sizes and depth convention. No renderer or React dependency in core. Density encoding and memory counts are validated before allocation; GPU limit checks belong to upload/allocation.

The initial descriptor covers axis-aligned fixtures; arbitrary source transform and multi-volume world placement remain P1/P2 additions, not secretly supported. GPU resources have explicit owners and producer/consumer relationships. Direct WGSL is allowed through a small r186 bridge, with Three-owned shared textures and buffers. Public resource APIs remain provisional.

## Scheduler

The installed scheduler core is framework independent. P0 uses a private manual scheduler for lab update-before-render order; it does not import React or start a second RAF loop. A unit test verifies ordering despite reverse registration order and unregister behavior. The host owns the RAF driver. Reuse in production remains optional; R3F binds to its own host lifecycle, not a second scheduler instance per cloud.

## Shadows

Three r186 node materials expose `receivedShadowNode` and `castShadowNode`; directional light shadow data is available after a shadowed render. The lighting probe renders two shadow-casting/receiving spheres and a plane, and reports whether the shadow depth texture exists. This establishes host availability, not cloud cast/receive correctness. P1.3 must sample/project directional shadow data at volume positions and prove both cloud-to-geometry and geometry-to-cloud behavior. Cache work follows in P3.

## Sky/environment

Sky 0.3.0 exports `SkyAtmosphereBaker`, including `skyScene`, `markCubeDirty`, and raw/filtered environment textures. The P0 fixture adds a cyan marker to that capture scene, triggers rebake, and lets the user toggle the marker while observing a diffuse and a metallic sphere. No extra main-scene sky dome is required. This is a concrete capture insertion point; directional volumetric integration and atmosphere ordering remain P3 work.

The probe owns a separate scene and baker, so it cannot overwrite caller-owned environment state. The future adapter still needs attach/detach restoration tests. Environment capture is explicitly dirtied, not recomputed every frame. Aerial perspective is disabled in P0 so it cannot hide composition bugs.

## Limits

The lab is not a cloud renderer or performance target. GPU device identity may be privacy-reduced to an architecture string. CPU submit timing is labeled as such; no GPU-time claims are made without timestamp evidence. Windows/RTX validation remains pending. Device-loss handling stops the lab and requests reload; automatic recovery is not implemented yet.
