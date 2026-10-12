# Authored weather maps (HZD NDF)

Example maps for the `hzd` procedural shaper's authored-map input (W1, `work/reports/W1.md`). Served at `/clouds/ndf/<name>.png`.

Our own drawings, made by `work/captures/W1/tools/draw_maps.py` (spectral noise and soft shapes placed by eye). They recreate the *arrangement* the papers describe; no paper image is used.

| Map | Recreates | Tile |
| --- | --- | --- |
| `desert-morning.png` | n17 p.64 / nut s17: calm desert morning, stratus only, a broken mottle with holes | 16 km |
| `desert-afternoon.png` + `-height.png` | n17 p.65 / nut s18: scattered afternoon cumulus; the height map keeps them fair-weather | 16 km |
| `alpine-congestus.png` + `-height.png` | n17 p.66: isolated congestus columns (tall, from the height map), a stratus band ahead-right | 24 km |
| `boss-fight.png` | n17 p.68 / nut s19: a mixed map, a wedge of stratocumulus streets, an opening ahead toward the sun, painted holes | 24 km |
| `cutscene-gradient.png` | hzd15 s47: a smooth coverage-against-type gradient | 30 km |

Maps painted in the HZD bench's weather-map painter (`hzd/`, key M; `work/HZD-BENCH.md`) are saved to `painted/<name>.png` and `painted/<name>-height.png`, in the format below. Commit the ones worth keeping.

## Format

- `<name>.png`: RGBA, 8-bit linear (not colour-managed). R = coverage, G = top type (0 stratus, 0.5 stratocumulus, 1 cumulus), B = bottom type, A = 255 (ignored).
- `<name>-height.png` (optional): R = min height, G = max height, as fractions of the cloud layer. Without it, the heights come from the generator.
- The image centre is the world origin. Up is north (the compare page's default view, `lookAz 0`) and right is east. The image spans `ndf.tileMeters` and wraps.
- Coverage is on our shaper's scale. A mean base shape survives where coverage is above about 0.38. The generated map's percentiles are p50 0.30, p90 0.52 and p99 0.67. Paint soft gradients: a flat plateau of coverage turns into a flat-sided slab or column.

## Use

```
compare/?impls=hzd&hzn_image=/clouds/ndf/boss-fight.png&hzn_tileMeters=24000
compare/?impls=hzd&hzn_image=/clouds/ndf/alpine-congestus.png&hzn_heightImage=/clouds/ndf/alpine-congestus-height.png&hzn_tileMeters=24000
```

In code, set `proc.settings.hzd.ndf.image` (and `heightImage`) before `proc.load({ hzd: true })`, which waits for the image. Changing the setting later reloads the image; the generated map shows until it lands.
