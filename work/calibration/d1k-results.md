# D1 round 11 blind judging (2026-10-11)

Judges: Opus (`d1k-judge-opus.md`), Fable (`d1k-judge-fable.md`); key `d1k-key.json`. Sources: Decima, round 9, round 11 (decima look); every source went through the same JPEG q90 round-trip. Four framings, 12 crop regions.

| Framing | Opus distance / close | Fable distance / close |
|---|---|---|
| p213 (Parkouring, far) | r11 / r11 | r11 / r11 (reservations: washed out, pocks) |
| p101 (Parkouring, close) | r9 / r9 (r11's relief reads as wormy whorls) | r11 / r11 |
| s206 (Stormbird, broad) | r11 (sky) / r9 by a hair | r11 / r9 by a hair |
| s33t3 (Stormbird, tall tower) | r11 (sky) / r11 marginally | r11 / r9 |

- **Round 11 is the first clear win since round 8:** it takes 11 of the 16 calls, and every distance call except Opus's p101. Several Stormbird wins are the sky (r9's is violet with no haze). The cloud on Stormbird is nearly the same in both rounds.
- **The fog wall is not fully gone:** both judges still see the p213 base dissolving into a white haze (rows about 700–1079), with a grey band below it.
- **Relief:** r11's extra relief reads as single-scale pocks, donut dimples or wormy whorls rather than florets. Fable's floret stats: the rough renders reach the frames' blob count (1.4–2.0 vs 1.3–2.1), but as domes without hollows (dark fraction 0.67–0.87 vs the frames' 0.52–0.62).
- **Fine grain:** even with matched JPEG, the frames have more 1–3 px grain on lit faces (std 0.43–0.52 vs ours 0.32–0.39). This is no longer only an encoder difference.
- **Asset time (Opus):** the leg size, the holes and an extra fragment differ between frame and render on s206 and s33t3, so the frames may show the asset at a different time or animation state from ours. This limits silhouette comparison; check it.

Remaining gaps (both judges, biggest first):
1. **Cauliflower hierarchy:** the frames have domes on domes down to 1–3 px grain, with hollows between them and a pink lit rim. Ours have one balloon per lobe, or a field of same-size pocks.
2. **Lit colour:** the frames are warm cream/pink (lit RGB about 222/205/198); ours are neutral-cool, khaki on the p213 shade sides, and blown flat on the s33t3 dome.
3. **Shade artefacts:** glow discs (s206 core), ochre/khaki blotches, slits, rings, crescents and smoke curls; where the frame has a dark pit, we render a bright ribbon. The shaded satellites are too dark and featureless.
4. **Edges:** serrated chalky rims with a bright outline vs the frames' fibrous, florety, pink-rimmed edges; base edges smeared or dissolved.
5. **Shade depth:** the p213 trunk is too dark and brown; the p101 belly is too dark and blue-grey.
