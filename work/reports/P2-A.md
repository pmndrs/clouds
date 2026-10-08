# P2-A Open-water scene module
Status: ready for review
Changed: examples/lab/scenes/ocean/index.ts, examples/lab/scenes/ocean/detail.ts (new); examples/lab/ocean/main.ts, index.html, controls.ts (copy of flagship CameraRig)
API: `createOcean(renderer, scene, sky, { sun?, radius?, rings?, segments?, waves?, level?, ...settings })` -> `{ mesh, settings, time, update(dt, camera), heightAt(x, z), dispose() }`.
Design:
- Camera-following polar grid (220 rings x 512, geometric spacing to 150 km). 12 Gerstner swell waves (220 m down to 9 m) displace it, faded by grid spacing.
- Fragment normal: the same 12 waves analytically (with a per-wave footprint fade), plus 3 taps of two CPU-baked tileable slope maps (24 m and 3.2 m tiles, baked once at init, scrolled along the wind) for ripples.
- Waves smaller than the pixel footprint fade out, and their lost slope variance widens roughness, so the horizon does not shimmer and the glint widens with distance.
- Shading is MeshPhysicalNodeMaterial, ior 1.333: Fresnel IBL of scene.environment (the sky), the sun glint from the sky's sun light (GGX), a dark water body colour lit by the sky, and a sun-driven scatter emissive. No sky colours are hard-coded; the water and scatter tints are material properties.
- The page sets `mirrorBelowHorizon` so the sky below the horizon is clean for reflections.
Verified:
- `node scripts/gpu/capture.mjs --serve --page ocean/ --shots shore,horizon,sunset --out work/captures/P2-A` -> exit 0, no console errors.
- `pnpm typecheck` -> no errors in my files. One error remains in packages/runtime/src/generate/cpu-edt.test.ts (another agent's in-progress file). No tests touch these files.
- captures: work/captures/P2-A/ shore (2 m, sun off to the right, bright blue sea with whitecap-like glints), horizon (20 m, flat sea reaching a clean horizon, no shimmer), sunset (sun 3 deg, glitter path and dark facets reflecting the warm sky).
Measures:
- Ocean GPU = 1.19 ms at 1920x1080 (pass). This is the render-pass timestamp with the ocean visible minus hidden, 25th percentile over 160 frames per phase, measured live by the page and shown in the HUD and capture.json (gpuMs.ocean). Sky-only is 0.25 ms. The GPU clock ramps and makes single samples bimodal (roughly 1.5x), so treat it as +/-0.5 ms.
- Frame pacing 60 fps (frame p50 16.7 ms, p95 16.8 ms) in all three shots.
- Cost history: 32 analytic waves cost about 6 ms; moving fine detail into the baked tiles brought it to about 1.2 ms.
Open issues:
- Calibration (40+160+160 frames of hide/show) runs before ready(), so the page takes about 6 s to become ready; `?nocal=1` skips it.
- The long swell reaches about 2 m, so the page lifts the camera above `ocean.heightAt()`; callers placing a camera near the surface must do the same, otherwise they see through the back face.
- Faint tile repetition is visible in the mid field at grazing angles (shore shot). A third tile scale or a rotated A layer would hide it.
- The sun glint relies on the sun light; the sun disc is not in the PMREM, so the disc itself is not mirrored. P2 clouds composited into the sky will reflect only if they are in scene.environment or sampled separately.
- No foam, no refraction or underwater view, no shore.
