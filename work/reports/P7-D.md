# P7-D Demo polish for the showcase scenes
Status: ready for review
Changed: examples/lab/{open-water,onsen,plains-flight,three-adapter}/main.ts, examples/lab/scenes/ocean/{index,detail}.ts. No packages touched.
Verified:
- `pnpm check` -> exit 0.
- captures (2560x1440, `?hud=0&clean=1`): work/captures/P7-D/{ow/{horizon,sunset,cruise},pf/{t0,t25},onsen/{vantage,sunset}}.jpg; before/ (old ocean + P2-03 flight); side-by-side-ocean-{horizon,sunset,crosshatch}.jpg (left before, right after).
Changes:
- Ocean: (1) the "dark band 1-3 km" and mid-field speckle came from the cloud-reflection hook looking the dome up with the sparkly detail normal; it now uses a low-passed normal (mix to up 0.85). (2) Normal slope flattened with range (smoothstep 250..4000 m, up to 75%): at grazing angles the far swell no longer tilts reflections below the horizon. (3) Crosshatch: detail tiles had 48 integer-wavevector waves (a visible lattice); now 160 with angle jitter, plus two low-frequency amplitude modulations (~170 m, ~61 m) that hide the tile period; fine tile slope 0.17 -> 0.13, spread 1.1. Cruise zoom: the diamond lattice is gone.
- open-water: sky layer on (`?sky=0` off), generator border 0, rimWidth 0, `sky_<setting>` overrides, ready waits for 20 layer frames; weather coverage 0.56..0.9 (`?lo=&hi=`) so the sky is fair-weather cumulus with blue gaps out to the horizon (preset default gave an overcast bank); new `cruise` bookmark (300 m over open sea); `?quality=auto` works (typed as CloudQuality).
- plains-flight: sky layer on (`?sky=0` off). Start moved to (2048, 2048) so the first window's min corner is (0,0): only then do the layer's box-relative weather and the streamer's world weather coincide. t25 now shows cloud tops to the horizon.
- onsen: tower replaced by `heroes/sim-congestus` (scale 1.55 at (300,-2300), `?hx ?hz ?hb ?hs`), volume 96 -> 112 layers so it fits (1344 m). Fog drift: the whole cloud box flows with the wind via `clouds.core.setVolumePosition` (uniform write, +-150 m x / +-35 m z, peak ~2.5 m/s; `?fogdrift=0` freezes): no re-stamp, no light-grid rebuild, no pop. Vantage az 6 pitch +1, sunset az -22 pitch 0 so the hero reads at the right third.
- All four pages: `?hud=0` hides debug text, `?clean=1` hides HUD and bookmark buttons.
Measures (2560x1440, high): frameMs p50 16.7, p95 16.7-16.8 in every shot (open-water horizon 4.9 ms GPU incl. skyLayer ~1.2-1.65; plains t0 4.8, t25 4.6; onsen vantage 6.5, sunset 4.8). 60 fps holds. Plains swapA vs swapB mean |d| 0.88/255 (same as without the layer).
Open issues:
- API gap (plains-flight): SkyLayerOptions has no weather origin. The layer bakes uv = (xz - boxMin)/extent; the streamer uses xz/4096. After a window swap the layer's far field shifts by the window step (700 m-scale); not visible in swapA/swapB (view across the track) but a far-field pop is possible looking along the track. Needs `SkyLayerOptions.weatherOrigin` (uv offset of the box min, rebake on swap) in packages/runtime/src/sky-layer.ts.
- onsen drift depends on `setVolumePosition`, currently an uncommitted P6-A addition in runtime.ts; if that is reverted this page fails to typecheck.
- Sky layer at the very horizon with the camera at 4-25 m shows blocky horizontal bricks in thin stacked layers (strongest at sunset); sky_resolutionScale/lodScale/stepRel did not change it. Runtime-side.
- Ocean sunset water is very dark by design of the sky reflection; plains ground texture is blocky where visible through gaps.

## Orchestrator review
Accepted. Open-water horizon/sunset, plains t0/t25 and onsen sunset read as intended. **Known issue:** open-water
`cruise` (300 m among the clouds) shows clouds as vertical-sided blocks and a tall white column in the reflection.
It looks like a voxel-box or sky-layer handoff artefact at cloud altitude, or a dome-reflection mismatch. → follow-up
task, together with the sky-layer `weatherOrigin` for streaming and the blocky bricks at the horizon at sunset.
