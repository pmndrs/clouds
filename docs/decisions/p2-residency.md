# P2 residency decision — shared atlas and bounded window

**Status:** implemented and measured locally; R2 human coverage review remains pending. See [P2 evidence](../archive/p2-evidence.md).

## Decision

Start P2 with a bounded camera-centred window of deterministic world cells and
one shared eight-tile `48³` r8unorm atlas. The default world window is
`radius: 4`, or 9 × 9 = 81 cell descriptors. A cell stores its world bounds,
atlas index, extinction scale, and deterministic active mask. The atlas is
uploaded once; moving the window changes the resident descriptor set rather
than generating 81 independent density fields.

This gives the first experiment a fixed, inspectable working set while keeping
the world-space distribution stable. The cell hash uses signed global cell
coordinates, so a cell that remains resident across a positive or negative
camera-cell crossing keeps exactly the same placement and optical metadata.
The window rebase uploads descriptors for the new snapshot but does not
regenerate density or rebuild the shared atlas.

## Memory comparison

The atlas is r8unorm, so one voxel is one byte. The payload comparison is:

| Representation | Calculation | Density payload |
| --- | --- | ---: |
| Shared eight-tile atlas | `8 × 48³ × 1 byte` | 884,736 bytes ≈ **0.84 MiB** |
| 81 separate dense fields | `81 × 48³ × 1 byte` | 8,957,952 bytes ≈ **8.54 MiB** |

The shared atlas leaves per-cell variation in descriptors and in projected
procedural detail. It does not imply that all cells have the same bounds or
optical thickness. The current light cache is a separate resource: its
`132 × 32 × 132` rgba16float payload is `132 × 32 × 132 × 8` bytes, about
**4.25 MiB**. These are payload estimates and exclude driver allocations,
staging, views, and bind groups.

## Sampling and transitions

The integrator resolves overlapping cells by summing extinction at each world
sample over the 3 × 3 horizontal neighbor stencil. It does not alpha-sort
cloud boxes, so overlapping density remains additive in the shared integration
path.

The atlas provides the coarse cloud shape. Procedural detail is selected and
faded by projected footprint as the camera gets farther away; this is a detail
fade, not a coarse atlas LOD switch. The same world-space cell remains the
source during that fade, which avoids a representation change that could pop or
double-count extinction. A separate distant 2D layer remains an optional
presentation and must not render the same formation a second time.

## Measurement context

Final matching 960 × 540 measurements with 320 maximum view steps put the
accelerated cloud pass at 0.98–1.38 ms p50 versus 3.87–5.96 ms for the full
march. A GPU-generated 88 × 32 × 88 r32uint candidate field costs 0.95 MiB and
reduces density sampling to conservative intersecting owners. The CPU reference
and GPU field match exactly in the test fixture; sparse and shaped optical
comparisons match the full march. This is the selected default acceleration.

The light-cache rebuild is separately measured at 0.39 ms after the first
pose's 1.64 ms. Candidate generation measures 0–0.066 ms with quantized GPU
timestamps. No cache scrolling is justified by these local measurements yet.
All GPU values exclude scene rendering and presentation. See the evidence for
full settings, p95 values and limitations.

## Horizon and scope

The 9 × 9 window is finite. It supplies stable near and medium distance
formations around the camera; it does not claim infinite world coverage.
The camera-relative view-density fade starts at 4.4 km and ends at 7.7 km
horizontally. The fixed camera-distance sample lattice and continuous fade
prevent descriptor-window changes from abruptly changing retained view density.
The light cache uses unfaded physical density, so distant shadow/appearance
matching remains a P3 concern. Radius-zero fixtures bypass this fade and do not
claim rebase continuity. Horizon coverage beyond this support needs a separately measured far
representation, with world-space continuity and no duplicate cloud extinction.

This decision is a bounded dense-atlas experiment. It makes no claim to a full
sparse-volume or clipmap implementation and is not a claim about Nubis or any
other production cloud architecture. Those alternatives remain possible only
after representative coverage, memory, and traversal measurements justify
them.
