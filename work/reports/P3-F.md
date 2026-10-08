# P3-F Lighting at scale: thick-cloud undersides and the day cycle
Status: ready for review
Changed: `packages/runtime/src/shaders/lighting.wgsl.ts` (signatures unchanged; dome and sky layer pick it up), `shaders/frame.wgsl.ts` (3 padding floats renamed `deepScatter`, `deepAttenuation`, `ambientFloor`; same 224 B), `runtime.ts` (3 settings + defaults + 3 uniform writes `f[43]`, `f[54]`, `f[55]`; re-read before editing). `march.wgsl.ts` untouched.
What changed (cloudInScatter)
- Deep multiple scattering: sum over octaves n=1..3 of `b^n * phase(c^n) * exp(-a^n * tau)` times sun radiance, b=c=0.5 (consts), a = `deepAttenuation` 0.35. Same tau as the direct term, no new samples. c^n is approximated by blending the phase toward isotropic. n=0 is the existing direct term.
- Soft-saturating ambient: `exp(-tauUp)` becomes `mix(ambientFloor, 1, exp(-tauUp))`, and the `sqrt(1-P)` occlusion becomes `mix(ambientFloor, 1, sqrt(1-P))`. Ground bounce is the existing `ambientDown` blend (sky lower hemisphere, no new term). All colours sky-derived.
- New settings (`?s.<name>=` on flagship, `?c_<name>=` on cloudscape-gen): `deepScatter` 1.2, `deepAttenuation` 0.35, `ambientFloor` 0.15. 0 / 0 gives the old look (minus the extra ALU).
- Tuning: first defaults (4 / 0.3) washed everything flat and removed the clefts; swept on cloudscape ground (1/0.12, 1.5/0.2, 2.5/0.1), kept 1.2/0.15.
Verified
- `pnpm check` exit 0; density parity page `pass: true`.
- captures: `work/captures/P3-F/compare-{cumulus-ground,plains-t15,onsen-vantage,stormbird-frontlit,stormbird-backlit}.jpg` (before | after | Tidewater; Tidewater tiles are P0-04 a/d/c, unmatched framing); `daycycle-onsen.jpg` (7, 9, 12, 15, 18, 19, 19.5 h), `daycycle-stormbird.jpg` (7, 9, 12, 15, 18, 19.5 h); raw frames in `day/`.
Look (honest)
- cumulus ground: charcoal bases are now blue-grey with structure; clefts and bright tops stay. Clear win. Still less contrasty than Tidewater's wispy edges.
- plains t15 (standing inside a thick base): from near-black slate to mid blue-grey with soft structure; the top is still fairly dark and smooth, structure is faint (low-frequency volume, not lighting).
- onsen vantage (sun 6 deg): slightly lighter blue-grey bases; modest change, it was not charcoal-black there.
- stormbird frontlit: nearly unchanged, a touch flatter/brighter in the core. Backlit: inner blue pockets are slightly less contrasted than before; silver rim intact. This is the cost of the floor.
- Day cycle: no noon clipping, 7/9/15/18 h clouds white with blue-grey bases; onsen 19 h gives purple-grey bases with warm tops and no black clouds. At 19.5 h the sun is below the horizon on both pages (onsen -3.9 deg: the whole scene including terrain is black, a scene-lighting matter, not cloud; flagship -0.5 deg: cloud is deep red on a navy sky, plausible but saturated). 18.6-19 h is the usable sunset window.
Measures
- March cost: within noise. The GPU was shared (repeated flagship runs of marchNear+marchFar swing 0.7 to 2.4 ms for identical settings), so only A/B in sessions is meaningful: cumulus ground 3.19 -> 3.07 ms, plains t15 6.83 -> 6.70, onsen 2.30 -> 1.76; flagship with the new terms off vs on equal medians (~1.0 ms). Added work is 3 exp + a few mul/mix per lit step. Judged <= +0.3 ms; not provable tighter here.
Open issues
- Sky layer / dome use the same function, so distant layers get the same lift; not re-captured (P3-C2 is editing them).
- Sun/ambient are one sample at the volume centre, so a 19.5 h twilight on large layers is unchecked.
