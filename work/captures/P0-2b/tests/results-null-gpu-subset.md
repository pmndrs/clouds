| test | check | expected | measured | max rel err | noise (1 s.e.) | s |
|---|---|---|---|---|---|---|
| axes-fromz | RMS (vs numpy trilinear march) | [0.0] | [0.00304] | 0.0030 |  | 9.98 |
| axes-fromz | absorbance centroid px (x, y) | [82.05768, 84.66044] | [82.03173, 84.65699] | 0.0001 |  | 9.98 |
| axes-fromz | RMS vs grid mirrored in x: 0.1270, y: 0.1556, z: 0.0428 | [] | [] | 0.0000 |  | 9.98 |
| furnace-hg08 | all pixels | [0.6, 0.8, 1.0] | [0.60005, 0.79989, 1.0] | 0.0001 | 0.0000 | 6.2 |
| furnace-hg08 | through medium (3736 px) | [0.6, 0.8, 1.0] | [0.59999, 0.80003, 1.0] | 0.0000 | 0.0000 | 6.2 |
| sky-px | RMS / peak (vs numpy bilinear lookup) | [0.0] | [0.00031] | 0.0003 |  | 0.48 |
| sky-px | blob [1, 0, 0] centroid px (x, y) | [80.0, 45.0] | [80.00228, 44.99985] | 0.0000 |  | 0.48 |
| sky-px | blob [1, 1, 1] centroid px (x, y) | [80.0, 16.63133] | [79.99801, 16.34519] | 0.0032 |  | 0.48 |
| ss-hg08-fwd-b512 | combined (all orders), central half | [0.29352, 0.19568, 0.09784] | [0.29811, 0.19874, 0.09941] | 0.0161 | 0.0047 | 3.31 |
| ss-hg08-fwd-b512 | Volume Direct pass, central half | [0.29352, 0.19568, 0.09784] | [0.29346, 0.19564, 0.09786] | 0.0002 | 0.0047 | 3.31 |
