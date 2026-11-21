| test | check | expected | measured | max rel err | noise (1 s.e.) | s |
|---|---|---|---|---|---|---|
| absorber | centre 6x6 vs exp(-tau) L | [0.18394, 0.36788, 0.73576] | [0.18372, 0.36743, 0.73486] | 0.0012 | 0.0027 | 1.66 |
| absorber | whole image RMS / L (vs numpy trilinear march) | [0.0, 0.0, 0.0] | [0.00644, 0.00644, 0.00644] | 0.0064 |  | 1.66 |
| absorber | alpha AOV centre vs 1 - exp(-tau) | [0.63212] | [0.63257] | 0.0007 | 0.0016 | 1.66 |
| absorber | alpha AOV whole image RMS | [0.0] | [0.00644] | 0.0064 |  | 1.66 |
| absorber-a05 | combined (black sky, no sun) = 0 | [0.0, 0.0, 0.0] | [0.0, 0.0, 0.0] | 0.0000 |  | 2.97 |
| absorber-a05 | alpha AOV centre vs 1 - exp(-tau) | [0.63212] | [0.63257] | 0.0007 | 0.0016 | 2.97 |
| absorber-a05 | alpha AOV whole image RMS | [0.0] | [0.00644] | 0.0064 |  | 2.97 |
| axes-fromx | RMS (vs numpy trilinear march) | [0.0] | [0.0023] | 0.0023 |  | 0.47 |
| axes-fromx | absorbance centroid px (x, y) | [105.25476, 83.13043] | [105.2555, 83.13591] | 0.0000 |  | 0.47 |
| axes-fromx | RMS vs grid mirrored in x: 0.0515, y: 0.1308, z: 0.1434 | [] | [] | 0.0000 |  | 0.47 |
| axes-fromy | RMS (vs numpy trilinear march) | [0.0] | [0.00278] | 0.0028 |  | 0.47 |
| axes-fromy | absorbance centroid px (x, y) | [83.24541, 62.30952] | [83.25163, 62.30672] | 0.0000 |  | 0.47 |
| axes-fromy | RMS vs grid mirrored in x: 0.1196, y: 0.0474, z: 0.1608 | [] | [] | 0.0000 |  | 0.47 |
| axes-fromz | RMS (vs numpy trilinear march) | [0.0] | [0.00304] | 0.0030 |  | 0.6 |
| axes-fromz | absorbance centroid px (x, y) | [82.05768, 84.66044] | [82.03173, 84.65701] | 0.0001 |  | 0.6 |
| axes-fromz | RMS vs grid mirrored in x: 0.1270, y: 0.1556, z: 0.0428 | [] | [] | 0.0000 |  | 0.6 |
| furnace-hg08 | all pixels | [0.6, 0.8, 1.0] | [0.60005, 0.79989, 1.0] | 0.0001 | 0.0000 | 0.56 |
| furnace-hg08 | through medium (3736 px) | [0.6, 0.8, 1.0] | [0.59999, 0.80003, 1.0] | 0.0000 | 0.0000 | 0.56 |
| furnace-iso | all pixels | [0.6, 0.8, 1.0] | [0.60005, 0.79989, 1.0] | 0.0001 | 0.0000 | 0.54 |
| furnace-iso | through medium (3736 px) | [0.6, 0.8, 1.0] | [0.59999, 0.80003, 1.0] | 0.0000 | 0.0000 | 0.54 |
| sky-nz | RMS / peak (vs numpy bilinear lookup) | [0.0] | [0.00022] | 0.0002 |  | 0.01 |
| sky-nz | blob [1, 1, 0] centroid px (x, y) | [80.0, 45.0] | [80.00232, 44.99985] | 0.0000 |  | 0.01 |
| sky-px | RMS / peak (vs numpy bilinear lookup) | [0.0] | [0.00031] | 0.0003 |  | 0.01 |
| sky-px | blob [1, 0, 0] centroid px (x, y) | [80.0, 45.0] | [80.00232, 44.99985] | 0.0000 |  | 0.01 |
| sky-px | blob [1, 1, 1] centroid px (x, y) | [80.0, 16.63133] | [79.99797, 16.34517] | 0.0032 |  | 0.01 |
| sky-py | RMS / peak (vs numpy bilinear lookup) | [0.0] | [0.00016] | 0.0002 |  | 0.01 |
| sky-py | blob [0, 0, 1] centroid px (x, y) | [80.0, 45.0] | [80.00244, 44.9997] | 0.0000 |  | 0.01 |
| sky-pz | RMS / peak (vs numpy bilinear lookup) | [0.0] | [0.00015] | 0.0002 |  | 0.01 |
| sky-pz | blob [0, 1, 0] centroid px (x, y) | [80.0, 45.0] | [80.00231, 44.99985] | 0.0000 |  | 0.01 |
| ss-hg08-fwd-b1 | combined, central half | [0.29352, 0.19568, 0.09784] | [0.29346, 0.19564, 0.09782] | 0.0002 | 0.0047 | 0.64 |
| ss-hg08-fwd-b512 | combined (all orders), central half | [0.29352, 0.19568, 0.09784] | [0.29811, 0.19874, 0.09937] | 0.0157 | 0.0047 | 1.33 |
| ss-hg08-fwd-b512 | Volume Direct pass, central half | [0.29352, 0.19568, 0.09784] | [0.29346, 0.19564, 0.09782] | 0.0002 | 0.0047 | 1.33 |
| ss-hg08-side-b1 | combined, central half | [0.00126, 0.00084, 0.00042] | [0.00126, 0.00084, 0.00042] | 0.0001 | 0.0007 | 1.01 |
| ss-hg08-side-b512 | combined (all orders), central half | [0.00126, 0.00084, 0.00042] | [0.00131, 0.00088, 0.00044] | 0.0472 | 0.0012 | 0.98 |
| ss-hg08-side-b512 | Volume Direct pass, central half | [0.00126, 0.00084, 0.00042] | [0.00126, 0.00084, 0.00042] | 0.0001 | 0.0007 | 0.98 |
| ss-iso-fwd-b1 | combined, central half | [0.01473, 0.00982, 0.00491] | [0.01473, 0.00982, 0.00491] | 0.0002 | 0.0008 | 1.02 |
| ss-iso-fwd-b512 | combined (all orders), central half | [0.01473, 0.00982, 0.00491] | [0.01629, 0.01086, 0.00543] | 0.1062 | 0.0010 | 1.21 |
| ss-iso-fwd-b512 | Volume Direct pass, central half | [0.01473, 0.00982, 0.00491] | [0.01473, 0.00982, 0.00491] | 0.0002 | 0.0008 | 1.21 |
| sun-e30 | ground radiance a E cos(z) / pi | [0.38197, 0.15915, 0.03979] | [0.38197, 0.15917, 0.03979] | 0.0001 | 0.0000 | 0.02 |
| sun-e70 | ground radiance a E cos(z) / pi | [0.71787, 0.29911, 0.07478] | [0.7178, 0.2991, 0.07477] | 0.0001 | 0.0000 | 0.01 |
