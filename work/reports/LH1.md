# LH1: the Nubis shade is too blue

**Cause** (measured, `work/captures/LH1/`, frozen clouds, cloud pixels = difference to a coverage-0 sky, "shade" = darkest 30 % of them)
- Under Nubis lighting a shaded body gets no sun at all: the debug views `c_lightDebug` 1 (direct), 2 (glow), 3 (deep + diffuse) are black in the shade at sun 40 deg, because the sun taps' optical depth kills them. What is left is the **sky ambient term** (`lightDebug` 4) alone, i.e. the sky's saturated blue. Shade B/R: ambient term 1.87, final 1.98 (octave 1.37).
- The octave model's shade is neutral before aerial perspective (B/R 1.09, `lightDebug` 6): its body octaves still carry white sun light into the shade. Same luminance of the ambient term in both (0.23), so the weight is not the issue, only the colour.
- Not the cause: ambient weight (equal luminance), absorption colour (none), tone curve (not isolated; the pre-tonemap ambient term is already B/R 1.87 and grey ambient removes most of the blue). Aerial perspective adds a little blue to both (+0.14 Nubis, +0.26 octave).
- Owner's photos (cumulus, 17 shots, crude auto segmentation): shade B/R 1.4 to 1.6, lit 1.1, sky 2 to 3.8. So real shade is slightly cool, not neutral and not 2.0.

**Fix**: no shader change. The M1 setting `c.ambientSaturation` (`materialTint` in `lighting.wgsl.ts`, Nubis model only) already desaturates the sky light at constant luminance. The HZD bench pane now starts it at 0.15 when the lighting is Nubis (`HZD_AMBIENT_SATURATION` in `examples/lab/compare/panes/ours.ts`; library default stays 1; `?c_ambientSaturation=1` is the old look). Shade B/R 1.98 to 1.59 (gp7), 1.95 to 1.64 (ground); lit B/R 1.08 to 1.04. Luminance and fine detail unchanged (high-pass contrast 0.0189 vs 0.0188), dusk/sunset shade go greyer (B/R 1.28 to 1.14, 1.14 to 1.02, octave 1.37 / 1.12).

**Tried and not chosen** (`sheet-cands.jpg`, gp7 + ground): saturation 0.5 alone only reaches 1.74 (aerial perspective and the sky behind semi-transparent edges keep some blue). Adding diffuse sun (`c.diffuseSun` 0.3 with saturation 0.6, the M1 warm fill) gives B/R 1.51 but brightens the shade to octave level and drops the extra detail (normalised contrast 0.0243 vs Nubis 0.0302, octave 0.0250). Saturation 0 gives 1.53 with no detail loss but goes dull at dusk (B/R 1.11). 0.15 is the compromise. `c.diffuseSun` and `c.diffuseFalloff` are now in the tune panel ("Light: renderer settings") as a further knob.

**Switch**: Review item LH1 "shade hue (Nubis)": old sky blue (1) / new neutral (0.15), with a slider. Tune panel: "Light: renderer settings" -> ambientSaturation.

**Captures**: `work/captures/LH1/sheet-final.jpg` (columns octave | Nubis now | Nubis fixed; rows gp7, ground, sunset, dusk), `sheet-final2.jpg` (horizon, above), per-view PNGs in `g_octave`, `g_now`, `g_fixed` (and `g_sky`, the coverage-0 mask). Sun 40 deg for gp7/ground, 4 deg sunset, 3 deg dusk.

**What I saw**: gp7 and ground shaded bodies go from strong blue to a grey with a slight cool cast, close to octave but darker, with the Nubis contrast and detail kept. Lit tops, rims and sunset colours unchanged. Better than before, and nearer the photos, though still a touch bluer than octave (B/R 1.59 vs 1.37); raise `diffuseSun` if the owner wants it greyer.

**Cost**: none (one uniform value, no new shader work). `pnpm typecheck` passes; `pnpm test` passes (one earlier run had a single failure under load, the rerun was clean). Note: one sunset/dusk capture came out with no clouds at all (a flaky settle), re-captured.
