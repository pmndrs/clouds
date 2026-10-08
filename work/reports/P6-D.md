# P6-D Sky layer uses the lattice-free profile noise (orchestrator)
Status: done
Changed: `packages/runtime/src/shaders/sky-layer.wgsl.ts`, one line: the layer's profile depth noise now calls `profileNoise` (P6-C, in BILLOW_WGSL) instead of the single axis-aligned value-noise octave, so the layer matches the generator again.
Verified: `pnpm check` exit 0; packed consumer OK. A/B in `work/captures/P6-D/sky-layer-before-after.jpg` covers cloudscape-gen `sky=1` horizon/seamNorth and open-water horizon/sunset. Mean |d| is 1.5–2.2/255. Open-water sunset reads 15/255, but that is animated water sparkle and near-cloud motion; the layer band is unchanged to slightly smoother. `cloudsTotal` is within noise (3.97–5.13 ms before, 4.39–4.61 after).
