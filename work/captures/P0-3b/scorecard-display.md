DISPLAY-REFERRED (PNG screenshots after ACES + sRGB, as PT1): for comparison with the linear scorecard only.

| view | cloud L | thick L | fringe L | fringe B/R | base L | base B/R | dark20 L | dark20 B/R | band 4-16 | 16-64 | 64-256 | lit 4-16 | sky R,G,B |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nubis noon | 1.00 | 0.96 | 1.28 | 1.46 / 1.97 | 0.97 | 1.19 / 1.11 | 1.04 | 1.29 / 1.28 | 3.25 | 2.71 | 2.60 | 2.43 | 1.00,1.00,1.00 |
| octave noon | 0.95 | 0.91 | 1.17 | 1.49 / 1.97 | 0.92 | 1.03 / 1.11 | 0.97 | 1.09 / 1.28 | 1.88 | 2.23 | 2.55 | 1.73 | 1.00,1.00,1.00 |
| nubis low | 0.98 | 0.92 | 1.24 | 2.07 / 2.80 | 0.97 | 1.42 / 1.16 | 1.13 | 2.22 / 1.87 | 1.20 | 1.90 | 1.14 | 2.38 | 1.00,1.00,1.00 |
| octave low | 0.94 | 0.90 | 1.13 | 1.94 / 2.80 | 0.88 | 0.91 / 1.16 | 0.69 | 1.18 / 1.87 | 1.43 | 2.48 | 1.85 | 1.45 | 1.00,1.00,1.00 |
| nubis backlit | 0.86 | 0.80 | 1.02 | 1.35 / 1.36 | 0.93 | 1.05 / 0.98 | 0.94 | 2.16 / 1.35 | 1.10 | 1.41 | 1.36 | 1.72 | 1.00,1.00,1.00 |
| octave backlit | 0.60 | 0.50 | 0.90 | 1.40 / 1.36 | 0.72 | 0.89 / 0.98 | 0.40 | 1.29 / 1.35 | 1.58 | 2.09 | 2.35 | 2.29 | 1.00,1.00,1.00 |

Noise floor (seed 1 vs seed 2 of the path trace: |ratio - 1|, or |B/R diff|):

| view | cloud L | thick L | fringe L | fringe B/R | base L | base B/R | dark20 L | dark20 B/R | band 4-16 | 16-64 | 64-256 | lit 4-16 | sky R,G,B |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PT seed noise noon | ±0.000 | ±0.000 | ±0.000 | ±0.001 | ±0.000 | ±0.000 | ±0.013 | ±0.012 | ±0.020 | ±0.001 | ±0.004 | ±0.033 | ±0.000 |
| PT seed noise low | ±0.000 | ±0.000 | ±0.000 | ±0.001 | ±0.001 | ±0.001 | ±0.050 | ±0.098 | ±0.029 | ±0.004 | ±0.003 | ±0.024 | ±0.000 |
| PT seed noise backlit | ±0.000 | ±0.001 | ±0.000 | ±0.000 | ±0.000 | ±0.000 | ±0.043 | ±0.044 | ±0.006 | ±0.002 | ±0.005 | ±0.005 | ±0.000 |

PT pixel noise inside the detail bands (one frame's grain / the frame's band energy), and band ratios with that grain removed from the reference in quadrature:

- noon: grain share band_4-16 0.67; band_16-64 0.05; band_64-256 0.01. Corrected ratios: nubis 4-16 4.39, 16-64 2.71 | octave 4-16 2.53, 16-64 2.24
- low: grain share band_4-16 0.90; band_16-64 0.13; band_64-256 0.01. Corrected ratios: nubis 4-16 2.71, 16-64 1.91 | octave 4-16 3.22, 16-64 2.50
- backlit: grain share band_4-16 0.80; band_16-64 0.07; band_64-256 0.01. Corrected ratios: nubis 4-16 1.82, 16-64 1.41 | octave 4-16 2.62, 16-64 2.09

- PASS a1 lit-face fine band above reference (nubis): nubis noon lit 4-16 x2.43 (noise ±0.033); nubis low lit 4-16 x2.38 (noise ±0.024)
- PASS a2 backlit thick body darker, octave more so: nubis x0.8037044209081972, octave x0.504143695323753 (noise ±0.001)
- PASS a3 fringe B/R below reference: nubis noon -0.51; octave noon -0.48; nubis low -0.73; octave low -0.87
- PASS a4 low-sun shade B/R: nubis high, octave low: nubis +0.35, octave -0.69 (noise ±0.098)
- PASS b noise floor for every measure: suns with a noise floor: ['backlit', 'low', 'noon']
