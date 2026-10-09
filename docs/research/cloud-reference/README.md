# Cloud reference catalog

Visual reference for agents that shape and light clouds. Use it to check a render against what a given cloud type really looks like, from the ground, from a plane, and at sunset.

- **[catalog.json](catalog.json)** is the source of truth. Each entry has recognition cues (`spotIt`, `shape`, `light`, `fromAbove`, `atSunset`), the WMO hand-rule `size`, typical `altitudeM` and `thicknessM`, renderer-facing `shaping` notes, and `webReferences` (Wikimedia Commons, with license and source page).
- **Human field guide:** https://claude.ai/artifact/U5R8fJFGAPE2vMamHbw46M is the same content with example photos. It is meant for sorting photos by eye.
- **Local photos** (not in git) are in the main checkout under `artifacts/research/cloud-photos/`:
  - `<id>/` holds the owner's own photos, one folder per catalog `id`. A photo can appear in more than one folder, for example a sunset shot from a plane in `stratocumulus/`, `aerial-cloud-deck/` and `sunset-layers/`.
  - `_reference/` holds the Commons images listed in `webReferences`.
  - `manifest.json` (once present) tags each personal photo: `{ "file", "types": [ids], "view": viewTag, "time": timeTag, "source", "notes" }`. The tag vocabularies are `viewTags` and `timeTags` in the catalog.

## How to use it when shaping

1. Find the target type's entry and read `shape` and `shaping`. They name the cues that make the type read correctly, such as a shared flat base for cumulus fields, flat inversion tops for stratocumulus decks, or billowy-to-fibrous change with height for cumulonimbus.
2. Open two or three photos from `<id>/` and `_reference/` at a similar view and time of day, and compare them with your capture side by side.
3. Report which cue is missing in the entry's own terms, for example "bases do not line up" or "no self-shadow in lobe creases".

Priority views for current work: `aerial-cloud-deck` (plains plane flight), `sunset-layers` (sunset colour, where Takram is currently ahead), and `stratus-fog-valley` (onsen valley).

## Types

| id | name | family | base height | erosion |
| --- | --- | --- | --- | --- |
| `cumulus-humilis` | Fair-weather cumulus | low | 0.5–2 km | Billowy (Worley-heavy). Little wispy detail. |
| `cumulus-mediocris` | Medium cumulus | low | 0.6–2 km | Billowy, with a medium-scale lobe pattern visible in silhouette. |
| `congestus` | Towering cumulus | vertical | 0.6–2 km | Billowy at several scales. Worley detail should stack (large lobes carrying smaller lobes). |
| `cumulonimbus` | Thunderstorm cloud | vertical | 0.5–2 km | Billowy low down, fading to wispy or smooth at the anvil. |
| `stratocumulus` | Stratocumulus | low | 0.3–2 km | Billowy at low amplitude. Cell pattern at a 1 to 3 km scale. |
| `altocumulus` | Altocumulus | middle | 2–6 km | Moderately billowy at a small scale. |
| `altostratus` | Altostratus | middle | 2–7 km | Mostly smooth, a little wispy. |
| `nimbostratus` | Rain layer | middle | 0.5–3 km | Low. |
| `stratus-fog-valley` | Stratus, fog and valley fog | low | 0–0.5 km | Wispy and soft. Very low billowiness. |
| `cirrus` | Cirrus | high | 6–12 km | Wispy (curl or flow noise stretched along wind). |
| `cirrocumulus` | Cirrocumulus | high | 6–12 km | Small-scale regular cellular or ripple pattern. |
| `cirrostratus` | Cirrostratus | high | 6–12 km | Minimal. |
| `lenticular` | Lenticular cloud | feature | 2–6 km | Very low. Smooth. |
| `mammatus` | Mammatus | feature | 2–10 km | Smooth, low frequency. |
| `shelf-cloud` | Shelf cloud | feature | 0.3–2 km | Smooth layered. |
| `aerial-cloud-deck` | From the plane window | view | — | Any. |
| `sunset-layers` | Sunset and sunrise colour | lighting | — | N/A |
| `crepuscular-rays` | Sun rays and silver linings | lighting | — | N/A |
