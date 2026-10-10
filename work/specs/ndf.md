# NDF: the sky's per-column data field (L1, owner decision 2026-10-10)

The procedural sky follows **Nubis Evolved / Nubis Cubed**, not the HZD 2015 R/G/B weather map. Sources: `docs/research/sources/ne22.md` (p.17–29), `sources/n3/slides-001-046.md` (s12–18), `docs/research/topics/layering.md` §1.

## Fields (per column of sky, all 0..1)

| Field | Meaning | Used by |
| --- | --- | --- |
| `coverage` | how much cloud in this column | every shaper |
| `topType` | row of the top-profile table: 0 flat stratiform top → 1 tall tiered cumulus top | HZD shaper (as the HZD type), NE table mode |
| `bottomType` | row of the bottom-profile table: **0 = sharp-onset, flat, crisp base**; 1 = slow ramp, ragged base (`sources/n3.md` §7a) | NE table mode; HZD mode ignores it |
| `minHeight` | base of the cloud column, as a fraction of the layer (or metres via the layer range) | every shaper |
| `maxHeight` | top of the cloud column | every shaper |

No precipitation channel. Storms come later as NE-style influence NDFs and a superstorm mask. The high thin layer gets its own 2-field NDF (coverage, type) later.

## Storage (an implementation detail)

- `ndfA`: `rgba8unorm` 2D — R coverage, G topType, B bottomType, A reserved (0).
- `ndfB`: `rg8unorm` 2D — R minHeight, G maxHeight.
- Shaders read the fields through one WGSL helper, `ndfSample(xz) -> NdfSample { coverage, topType, bottomType, minHeight, maxHeight }`, so packing can change without touching shaper code.
- Tiling: the map wraps (repeat addressing). World size per tile is a setting (NE uses 16 km × 16 km).

## Motion (W1, owner 2026-10-10)

Default: the NDF drifts slowly with the wind (as in Ghost of Tsushima's global weather texture), while noise scrolls over it. A setting switches to Nubis's static map (noise-only scroll). Both are needed for the A/B; build the setting from the start.

## Generation (until W2 lands)

A simple procedural NDF is enough for the HZD reference: coverage from a low-frequency fbm with islands, topType from a separate very-low-frequency field, min/max height from the layer range with mild variation. W2 replaces it with the Nubis 2017 cloud-map recipe and a paint layer.
