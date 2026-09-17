# Bounded world traversal

`nextCellSampleIndex` advances a fixed midpoint ray lattice to the first
sample at or beyond the next horizontal (`XZ`) cell face. It only skips
midpoints that are strictly before that face, uses an early epsilon at floating
point ties, and always makes forward progress. The `u32` result is clamped at
its maximum value.

The helper is safe only when the caller has a conservative empty-cell proof.
For filtered density, the occupancy mask must cover every neighbouring cell
touched by the filter overlap (including the required halo). The mask is an
acceleration certificate; it must not be inferred from a density threshold at
the current sample. The caller should skip only when all candidate cells in
the sample's `3x3` horizontal neighbourhood are certainly empty, then use the
helper to preserve the exact fixed lattice after the skip.

The WGSL string `TRAVERSAL_WGSL` and the TypeScript reference
`nextCellSampleIndex` intentionally share the same face, epsilon, and overflow
rules.
