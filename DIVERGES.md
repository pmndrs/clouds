# Where we diverge from our sources

One entry per place where our implementation departs from the source a concept came from. Add an entry in the same change that creates or finds the divergence.

Status values:
- **intended**: a deliberate choice; keep.
- **open**: not chosen; close it or decide.
- **unknown**: found, not yet measured.

"Measured effect" is a scorecard number or a sheet path, never an opinion. Leave it blank until measured.

| ID | Concept | Source | The source does | We do | Why | Measured effect | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L1 | Phase function | Real droplets; Jendersie & d'Eon 2023 | Strongly forward, mean cosine about 0.85 | Default dual HG, 0.2 at 60 % and 0.85 at 40 % (mean 0.46). The HG + Draine fit exists as an option | Art-tuned silver lining | Backlit body 0.81x (Nubis) and 0.51x (octave) of the path trace (PT1) | open |
| L2 | Surface occlusion on multiple scattering | Physics; Nubis Cubed deck | Multiple scattering fills small pits | `microOcc`, a single-scatter shadow over the first metres, multiplies the glow and deep terms | Added in Q-1 so lobes read; strengthened in D1 for Decima's florets | Lit-face 4 to 16 px energy 1.6 to 1.9x the path trace (PT1) | open; becomes **intended** only as the `horizon` style |
| L3 | Glow on thin material | Path trace | Thin fringes are translucent and stay sky-tinted | Glow and ambient light thin material to near white | Side effect of the profile-driven glow | Fringe luma +0.13, B/R 1.46 vs 1.97 at noon (PT1) | open |
| L4 | Shade colour | Path trace | Mild blue-grey with diffused sunlight | Nubis: hemisphere-mean sky, little diffused sun (too blue). Octave: sun colour kept in shade (too brown) | Two models from two sources | Dark-20 % B/R 2.26 / 1.21 vs 1.83 at low sun (PT1) | open |
| L5 | Ambient attenuation law | Nubis Cubed deck (s128) | `exp(-tau)` above the sample | `1 / (1 + tau)` by default; the deck law is a switch | H3: the exponential printed dark blotches on bases | | unknown |
| L6 | Extinction scale | Measured cumulus, roughly 0.03 to 0.13 per metre | Mean free path of 10 to 30 m | Flagship 0.3 per metre; the Decima look 2 per metre | Inherited from the pack and the deck | | unknown |
| L7 | In-scatter profile on the procedural sky | Nubis Evolved | Exact profile from the height table and coverage | Exact since C1 where a table exists; a depth stand-in for sheets and fractus | Those forms have no table | | open |
| S1 | Density formula | Nubis Evolved 2022 | Subtracts the inverted profile from the noise | HZD's GPU Pro 7 remap chain | The shaper started from the 2015 recipe | Never A/B'd | unknown |
| S2 | Mid-scale 3D structure | Photos; simulated VDBs | Lobes at several nested sizes | Coverage map times height profile, then erosion; no billow stage between outline and erosion | Follows the 2015 recipe literally | See AUDIT-2026-11, finding 1 | open |
| S3 | Detail noise | HZD 2015 Worley; Nubis Cubed Alligator | One set each | Both exist; default Alligator, two of three styles switch back to Worley | N1 fixed "sprinkles"; S1 found a hatch with it | | open |
| R1 | Reference phase function | Our runtime | Dual lobe or HG + Draine | The path tracer has a single HG lobe, validated to g 0.6 | Not yet built in the pathtracer repo | Brackets only (g 0.8 and 0.46 runs) | open |
| R2 | Reference comparison space | — | Linear radiance | PT1 compared tone-mapped PNGs | First pass | | open |
