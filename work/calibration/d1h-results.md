# D1 round 8 blind judging (2026-10-11)

Judges: Opus (`d1h-judge-opus.md`), Fable (`d1h-judge-fable.md`); key `d1h-key.json`. Sources: Decima, round 6, round 8 (decima look). Four framings, 11 crop regions.

Decoded (both judges made the same calls; each grouped the winners as one "variant", but they are not):

| Framing | Opus distance / close | Fable distance / close |
|---|---|---|
| p213 (Parkouring, far) | r8 / r8 | r8 / r8 |
| p101 (Parkouring, close) | r8 / r8 | r8 / r8 |
| s33t3 (Stormbird, tall tower) | r6 / r6 | r6 / r6 |
| s206 (Stormbird, broad) | r6 / r6 (r8 wins the tail crop, Opus) | r6 / r6 |

- **Parkouring: round 8 wins outright.** The disc arrays are reduced to faint ghosts (p101); the whorl is gone from p213 (Fable) or is a faceted glowing patch (Opus). Fable calls d11 (p101 r8) the cleanest render in the set.
- **Stormbird: round 6 wins.** Round 8 renders Stormbird sharper: the wind is stopped, and the temporal smear that hid the asset's fingerprints is gone. The trunk ring and slit, the pits, the ink-stain blotches and the hard white chip on s206, and serrated crests with detached flecks are all more visible. Round 6's softness was hiding them, not fixing them.
- Both judges: overall 3–4, nothing reaches "same engine".

Remaining gaps (both judges, biggest first):
1. **Surface detail is the wrong kind** (Fable: "no render crop has floret-scale structure"). The frames have 20–60 px (4k) florets with crisp crusts and creases down to grain; the renders are smooth balloons, and what fine detail they have comes as whorls, discs and blotches. Fable: the band-energy metric confirms missing or invented relief, but cannot tell a balloon from florets (R2/R9). Do not use it alone.
2. **Shade looks painted, not volumetric:** the s33t3 trunk is carved with a ring, pits and a slit where the frame has haze (2–2.5× the frame's 4–32 px energy); the s206 shade breaks into blotches and a chip; p101 has disc ghosts.
3. **Tone/colour:** blue-white on a deep saturated sky vs cream/pink on a paler hazy sky. The Stormbird tops are blown out, and contrast is too high.
4. **Edges:** lit silhouettes are hard and serrated, with detached flecks. The s206 leg is a clean blob where the frame has torn fibre. The frames' flat dark bases fade to a pale diffuse edge in ours.
5. **Shade placement (p213):** the frame has a dark belly and a light tower flank; the renders invert this.
