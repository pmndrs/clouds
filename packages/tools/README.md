# @clouds/tools

CPU reference conversion from a static closed triangle mesh into dense r8unorm
cloud density. `convertMeshToDensity(mesh, options)` accepts indexed or
non-indexed triangles, explicit world-space padding/softness, and an optional
column-major transform. It validates a watertight manifold edge set.

The converter prioritizes correctness and small tooling fixtures, not large
interactive meshes. Use closed, non-self-intersecting surfaces. VDB parsing,
sparse GPU playback and VDB export are not implemented by this package.

Runtime rendering and React are separate packages. This is an unpublished preview.
