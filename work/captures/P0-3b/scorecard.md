| view | cloud L | thick L | fringe L | fringe B/R | base L | base B/R | dark20 L | dark20 B/R | band 4-16 | 16-64 | 64-256 | lit 4-16 | sky R,G,B |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nubis noon | 1.26 | 1.12 | 1.62 | 1.93 / 2.85 | 1.00 | 1.47 / 1.20 | 1.37 | 1.56 / 1.65 | 2.63 | 2.25 | 2.09 | 2.88 | 1.00,1.00,1.00 |
| octave noon | 0.90 | 0.79 | 1.31 | 1.86 / 2.85 | 0.87 | 0.98 / 1.20 | 1.10 | 1.12 / 1.65 | 1.43 | 1.53 | 1.68 | 1.42 | 1.00,1.00,1.00 |
| nubis low | 0.97 | 0.85 | 1.30 | 2.36 / 3.19 | 0.97 | 1.57 / 1.12 | 1.14 | 2.68 / 2.00 | 1.54 | 1.87 | 1.18 | 2.20 | 1.00,1.00,1.00 |
| octave low | 0.95 | 0.85 | 1.18 | 2.02 / 3.19 | 0.91 | 0.79 / 1.12 | 0.74 | 1.15 / 2.00 | 1.22 | 1.76 | 1.44 | 1.31 | 1.00,1.00,1.00 |
| nubis backlit | 0.70 | 0.62 | 0.99 | 1.39 / 1.37 | 0.73 | 0.97 / 0.78 | 0.94 | 2.77 / 1.49 | 0.93 | 0.91 | 0.96 | 1.07 | 1.00,1.00,1.00 |
| octave backlit | 0.40 | 0.33 | 0.77 | 1.45 / 1.37 | 0.43 | 0.75 / 0.78 | 0.45 | 1.26 / 1.49 | 0.92 | 0.91 | 1.02 | 1.02 | 1.00,1.00,1.00 |

Noise floor (seed 1 vs seed 2 of the path trace: |ratio - 1|, or |B/R diff|):

| view | cloud L | thick L | fringe L | fringe B/R | base L | base B/R | dark20 L | dark20 B/R | band 4-16 | 16-64 | 64-256 | lit 4-16 | sky R,G,B |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PT seed noise noon | ±0.000 | ±0.000 | ±0.000 | ±0.001 | ±0.001 | ±0.000 | ±0.035 | ±0.034 | ±0.009 | ±0.001 | ±0.002 | ±0.017 | ±0.000 |
| PT seed noise low | ±0.001 | ±0.001 | ±0.000 | ±0.001 | ±0.001 | ±0.001 | ±0.054 | ±0.105 | ±0.016 | ±0.005 | ±0.000 | ±0.013 | ±0.000 |
| PT seed noise backlit | ±0.000 | ±0.001 | ±0.000 | ±0.000 | ±0.000 | ±0.000 | ±0.059 | ±0.063 | ±0.006 | ±0.004 | ±0.001 | ±0.002 | ±0.000 |

PT pixel noise inside the detail bands (one frame's grain / the frame's band energy), and band ratios with that grain removed from the reference in quadrature:

- noon: grain share band_4-16 0.67; band_16-64 0.05; band_64-256 0.01. Corrected ratios: nubis 4-16 3.54, 16-64 2.26 | octave 4-16 1.92, 16-64 1.53
- low: grain share band_4-16 0.87; band_16-64 0.10; band_64-256 0.01. Corrected ratios: nubis 4-16 3.11, 16-64 1.88 | octave 4-16 2.46, 16-64 1.77
- backlit: grain share band_4-16 0.63; band_16-64 0.05; band_64-256 0.01. Corrected ratios: nubis 4-16 1.20, 16-64 0.91 | octave 4-16 1.19, 16-64 0.91

- PASS a1 lit-face fine band above reference (nubis): nubis noon lit 4-16 x2.88 (noise ±0.017); nubis low lit 4-16 x2.20 (noise ±0.013)
- PASS a2 backlit thick body darker, octave more so: nubis x0.6159407699428493, octave x0.3268278076760799 (noise ±0.001)
- PASS a3 fringe B/R below reference: nubis noon -0.92; octave noon -0.99; nubis low -0.83; octave low -1.17
- PASS a4 low-sun shade B/R: nubis high, octave low: nubis +0.68, octave -0.85 (noise ±0.105)
- PASS b noise floor for every measure: suns with a noise floor: ['backlit', 'low', 'noon']
