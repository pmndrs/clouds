| test | check | expected | measured | max rel err | noise (1 s.e.) | s |
|---|---|---|---|---|---|---|
| absorber | centre 6x6 vs exp(-tau) L | [0.18394, 0.36788, 0.73576] | [0.18425, 0.3685, 0.73701] | 0.0017 | 0.0003 | 11.05 |
| absorber | whole image RMS / L (vs numpy trilinear march) | [0.0, 0.0, 0.0] | [0.0009, 0.0009, 0.0009] | 0.0009 |  | 11.05 |
| absorber | alpha AOV centre vs 1 - exp(-tau) | [0.63212] | [0.63157] | 0.0009 | 0.0005 | 11.05 |
| absorber | alpha AOV whole image RMS | [0.0] | [0.00198] | 0.0020 |  | 11.05 |
| absorber-a05 | combined (black sky, no sun) = 0 | [0.0, 0.0, 0.0] | [0.0, 0.0, 0.0] | 0.0000 |  | 27.8 |
| absorber-a05 | alpha AOV centre vs 1 - exp(-tau) | [0.63212] | [0.6339] | 0.0028 | 0.0025 | 27.8 |
| absorber-a05 | alpha AOV whole image RMS | [0.0] | [0.00967] | 0.0097 |  | 27.8 |
| axes-fromz | RMS (vs numpy trilinear march) | [0.0] | [0.00223] | 0.0022 |  | 5.98 |
| axes-fromz | absorbance centroid px (x, y) | [82.05768, 84.66044] | [82.03314, 84.66751] | 0.0001 |  | 5.98 |
| axes-fromz | RMS vs grid mirrored in x: 0.1264, y: 0.1549, z: 0.0432 | [] | [] | 0.0000 |  | 5.98 |
| hetero-absorber-e0.1 | partial-transmittance pixels (3009) mean vs numpy trilinear march | [0.31932] | [0.31967] | 0.0011 |  | 22.99 |
| hetero-absorber-e0.1 | whole image RMS | [0.0] | [0.00221] | 0.0022 |  | 22.99 |
| hetero-furnace-e0.6 | all pixels | [1.0, 1.0, 1.0] | [1.0, 1.0, 1.0] | 0.0000 | 0.0000 | 86.84 |
| hetero-furnace-e0.6 | through medium (4465 px) | [1.0, 1.0, 1.0] | [1.0, 1.0, 1.0] | 0.0000 | 0.0000 | 86.84 |
| hetero-furnace-e0.6 | largest single-pixel deviation | [0.0] | [0.0] | 0.0000 |  | 86.84 |
| ss-hg08-fwd-b1 | combined, central half | [0.29352, 0.19568, 0.09784] | [0.29319, 0.19546, 0.09773] | 0.0011 | 0.0048 | 2.63 |
| ss-mix-25-b1 | combined, central half | [0.03648, 0.02432, 0.01216] | [0.03644, 0.02429, 0.01215] | 0.0011 | 0.0026 | 4.86 |
