# D1 round 10 blind judging (2026-10-11)

Judges: Opus (`d1j-judge-opus.md`), Fable (`d1j-judge-fable.md`); key `d1j-key.json`. Sources: Decima, round 9, round 10 (decima look). Four framings, 12 crop regions.

| Framing | Opus distance / close | Fable distance / close |
|---|---|---|
| p101 (Parkouring, close) | r10 narrowly / r9 narrowly | r9 narrowly / r9 narrowly |
| p213 (Parkouring, far) | r10 / r10 (r9 only on the base: r10's dissolves into fog) | r10 / r9 (r10's fog erases base and junction structure) |
| s206 (Stormbird, broad) | r9 / r9 | r9 / r9 |
| s33t3 (Stormbird, tall tower) | r9 / r9 | r9 / r9 by a hair |

- **Round 10 is a regression on balance:** it takes 4 of the 16 calls, all on Parkouring. Stormbird is clearly worse.
- **Florets on Parkouring improved** (Opus blob density p213: frame 1.76, r9 0.84, r10 1.60). Fable sees a single-scale "egg-crate" bubble tiling on the p101 tower face rather than florets.
- **The painted sky ramp** shows a visible stepped or curved band (y≈400–800 depending on framing). It also adds a white fog wall below the cloud that dissolves the base (p213, s33t3, s206), where the frames' haze is a smooth ramp that leaves the base edge readable.
- **The Stormbird renders** with the new 35° suns are washed flat (s206, Opus) or show a blown milky dome and greenish-olive shade (s33t3, Fable).
- Both judges spot the references by capture signature: the renders' output dither (sky high-pass std about 0.49 vs 0.05–0.11) and the frames' 8×8 blocking. The set is not truly blind on that cue, but the picks were always obvious anyway.

Remaining gaps (both judges):
1. **Colour and lit level:** the frames' lit faces are pink-salmon (R−B +12 to +25) with mauve shade; ours are neutral grey or beige. The lit faces are also too dim on Parkouring (206–217 vs 230–236), while the Stormbird domes blow out into flat plateaus.
2. **Surface:** 4–12 px detail is 40–60 percent of the frames' on most crops. Where the amplitude matches, it comes from lobe-scale contrast or blown plateaus, not florets. The fine relief we do have comes as whorls, rings, slits or single-scale bubbles.
3. **Edges:** our silhouettes read soft or defocused, with cut-out 1 px bright rims and serrated turrets. Thin parts (the s206 trail, satellites) render as solid blobs where the frames show torn wisps.
4. **Shade:** too dark and brown-olive, with slits, pits and a sooty trunk smudge; the frames' shade is pale, luminous grey-mauve.
5. **Junctions:** the frame's dark pit with a crisp lit chip becomes a glow blob or a dark slit in ours.
