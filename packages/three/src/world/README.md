# Deterministic cloud world

`createCloudWorld()` maintains a finite, camera-centred residency window of
cloud cell descriptors. The default window is 9 × 9 cells (`radius: 4`) at
2,200 metres per cell. It is a bounded horizon window: it provides stable
near and medium distance formations around the camera, while a later distant
representation can cover beyond the window.

Cells are ordered with X varying fastest. A cell's descriptor is derived from
its signed global `(cellX, cellZ)` coordinate and seed. Re-centering the window
therefore preserves every overlapping cell's placement, atlas slot, optical
scale, and active mask. An update within the current camera cell returns the
same snapshot object. Crossing a cell boundary creates descriptors only for
new coordinates and retains the previous descriptors for overlaps.

The CPU residency is fixed at `(2 * radius + 1)²` descriptors. With the default
81 cells, the scalar payload is 11 values per cell (cell coordinates, six bound
values, atlas index, extinction scale, and active flag), about 3.5 KiB assuming
packed 32-bit values. JavaScript object and array overhead varies by engine; a
practical estimate for the descriptor objects and the fixed window is about 16
KiB. This excludes GPU atlas textures and upload staging.

The world bounds include every resident cell, including inactive cells, with a
small horizontal margin and a vertical range of 0–3,000 metres. Cloud bottoms
are generated in the 800–1,100 metre range and tops in the 1,800–3,000 metre
range. Horizontal centres jitter by at most 0.15 cell and half extents are at
most 0.6 cell.
