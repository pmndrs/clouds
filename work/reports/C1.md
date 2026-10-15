# C1: HZD sky lit with Nubis lighting from the exact profile

**What changed**
- `ProcSample` gains `prof` and `depthX` (0 from the other shapers). The HZD shaper (`hzd/shaper.wgsl.ts`, end of `hzdMainSample`) fills them when the new flag is on:
  `prof = coverage x height gradient` (NE22's dimensional profile, no noise, no lumps), `depthX = f/|df/dy|` on the smooth level set `f = 0.5 g - (1 - coverage)`
  (base noise at its mean), gradient by central difference of the type gradient, clamped to half the column. Same idea as the sky layer's `f/|grad f|`, vertical only (no horizontal coverage gradient).
- `trace.wgsl.ts`: with `P.lit.w = 1` and `s.prof > 0` the Nubis call gets `profile = prof` and depth `depthX`; otherwise (sheets, fractus, 'standin') the old stand-in. `hzdMerge` mixes both new fields.
- Setting `hzd.lightProfile: 'standin' | 'exact'` (library default `standin`; packed into `lit.w`, HZD shaper only). URL `hz_lightProfile=`. In the bench tune panel, group "Light: the procedural model".
- Bench default (HZD pane only; takram/skypro untouched): `lightingModel nubis` + `lightProfile exact`. `octave` stays selectable.

**Links** (port as you run it)
- old: `/hzd/?view=gp7&light=octave`
- Nubis + stand-in: `/hzd/?view=gp7&light=nubis&hz_lightProfile=standin`
- new default (Nubis + exact): `/hzd/?view=gp7`
(The task's `hz_lightingModel` does not exist; the model key is `light=` or `proc_lightingModel=`.)

**Captures** `work/captures/C1/{octave,standin,exact}/{gp7,ground,horizon,above}.png` (no `side` view exists in the bench; `above` used instead).

**What I saw**
- Octave: bright, soft, white bodies, little shading. Both Nubis variants: much more contrast, blue-grey shaded bodies and undersides, bright silver rims.
- Exact vs stand-in: rims slightly crisper and brighter, interiors a bit flatter/more uniform (the stand-in's depth varies with the base noise). No black interiors, no blown edges; no tuning applied.
- Verdict: different, not obviously worse, and closer to NE22's structure (profile from the map, not noise). Vs NE22 itself the owner's eye decides; bodies read darker than Decima's.

**Cost** (gp7, ultra, headless M-series, GPU ms, noisy single runs): total octave 32.0, stand-in 26.2, exact 28.0; sky layer 18.8 / 16.2 / 18.8. Ground/horizon/above within 1 ms across all three. Exact costs about 2 gradient-table reads x3 per sample (only when on); effectively within noise.

**Checks**: `pnpm typecheck` and `pnpm test` (305) pass. Note: capture.mjs `--serve` timed out on a cold vite here; a pre-warmed vite on a spare port plus `--url` worked.
