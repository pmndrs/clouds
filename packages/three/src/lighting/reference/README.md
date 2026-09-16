# Bounded shadow reference

This directory contains the P1 directional shadow proof for opaque, bounded
axis-aligned boxes. It is an analytic AABB reference that the cloud integrator
and the later Three.js scene-shadow implementation can compare against.

`intersectBox` computes the interval for a world-space ray written as
`origin + direction * t`. The direction need not be normalized, so `t` is a
ray parameter rather than a guaranteed metre distance. Zero direction
components are handled explicitly: a ray parallel to a slab is unconstrained
when its origin lies in that slab and misses when it lies outside.

`boxOccludes` requires a positive-length forward intersection. Entering from a
box boundary counts; a ray pointing outward from a boundary and a tangent
single-point touch do not. A zero direction has no forward segment and does
not occlude.

`REFERENCE_SHADOW_WGSL` mirrors the TypeScript behavior for use in a raw WGSL
pass. The proof covers opaque AABBs and a directional-light ray only. It does
not provide transforms, finite shadow-map bounds, soft shadows, density or
transparency, filtering, or cache invalidation. The caller owns light-ray
construction, world-to-box transforms, and any epsilon policy needed when
starting rays from scene surfaces.
