/**
 * The Nubis lighting model shared by the march and the reflection dome. Needs COMMON_WGSL and FRAME_WGSL
 * (reads frame.phaseG, silverG, silverStrength, msStrength, ambientStrength, ambientSkyBias, ambientExtinction,
 * glowBoost, glowFront, edgeDarkening, deepScatter, deepAttenuation, ambientFloor). All light colours come in as arguments (sky exposure units, no literals).
 */
export const LIGHTING_WGSL = /* wgsl */ `
const INLINE_NEAR = 16.0;   // first in-line sun sample covers 0..16 m
const INLINE_FAR = 48.0;    // second covers 16..48 m, the grid takes over from there
// Art-tuned against the Tidewater captures: the knobs (msStrength, ambientStrength) stay 1 by default.
const MS_NORMALISATION = 3.0 / (4.0 * PI);
const AMBIENT_GAIN = 1.5;
const DEEP_OCTAVES = 4;    // P3-F: octaves 1..3 of the multiple-scattering approximation (a = deepAttenuation, b, c below)
const DEEP_B = 0.5;
const DEEP_C = 0.5;
const ISO_PHASE = 1.0 / (4.0 * PI);
const EDGE_DEPTH = 70.0;   // metres below the surface a ray must reach to count as 'thick' (front-lit edge darkening is released by then)
const EDGE_FLOOR = 0.08;   // radiance share left at a silhouette with edgeDarkening = 1

fn henyeyGreenstein(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}
// HG(g = phaseG) with an art-directable forward lobe (silver lining).
fn cloudPhase(cosTheta: f32) -> f32 {
  return mix(henyeyGreenstein(cosTheta, frame.phaseG), henyeyGreenstein(cosTheta, frame.silverG), frame.silverStrength);
}
// In-scattered radiance per unit scattering at one sample. profile = in-scatter probability, sdf = signed distance to the
// surface (m, negative inside), h = height fraction in the volume, tau = optical depth toward the sun, gridUp = light grid
// 'up' sum (density*m), phase = cloudPhase(cosSun), sunRelax = valueRemap(cosSun, 0, 0.9, 0, 1).
fn cloudInScatter(profile: f32, sdf: f32, h: f32, tau: f32, gridUp: f32, phase: f32, sunRelax: f32, sunRadiance: vec3<f32>, ambientUp: vec3<f32>, ambientDown: vec3<f32>) -> vec3<f32> {
  // Inner glow: the profile is an in-scatter probability; extinction relaxes deep inside and toward the sun.
  let relax = mix(0.25, valueRemap(sdf, -128.0, 0.0, 0.05, 0.25), max(sunRelax, frame.glowFront));
  let ms = profile * exp(-tau * relax) * (1.0 + frame.glowBoost * sunRelax);
  // Ambient: dark where the profile is high, sky light attenuated by the density above, ground light from below.
  let tauUp = gridUp * frame.lightDensityScale * frame.ambientExtinction;
  // P3-F: sky light diffuses through thick cloud instead of dying: the attenuation saturates at ambientFloor, and so does the
  // profile occlusion (a thick base is lit by what scatters in from the sides and below, not just by what comes straight down).
  let skyAbove = ambientUp * mix(frame.ambientFloor, 1.0, exp(-tauUp));
  let occlusion = mix(frame.ambientFloor, 1.0, sqrt(1.0 - saturate(profile)));
  var ambient = AMBIENT_GAIN * frame.ambientStrength * occlusion * mix(ambientDown, skyAbove, frame.ambientSkyBias + (1.0 - frame.ambientSkyBias) * h);
  // P3-F deep multiple scattering (Wrenninge / Hillaire octaves, n >= 1; n = 0 is the direct term above): b^n * phase(c^n) * exp(-a^n tau).
  // The eccentricity c^n is approximated by blending the phase toward isotropic. Uses the same tau, no extra samples.
  var deep = 0.0;
  var an = 1.0; var bn = 1.0; var cn = 1.0;
  for (var n = 1; n < DEEP_OCTAVES; n++) {
    an *= frame.deepAttenuation; bn *= DEEP_B; cn *= DEEP_C;
    deep += bn * mix(ISO_PHASE, phase, cn) * exp(-tau * an);
  }
  return sunRadiance * (exp(-tau) * phase + frame.msStrength * ms * MS_NORMALISATION + frame.deepScatter * deep) + ambient;
}
// Dark edges (front-lit): rays that only graze the cloud (shallow in the SDF) scatter little. Multiply the ray's radiance by this.
fn cloudEdgeFactor(depthMax: f32, frontness: f32) -> f32 {
  return mix(1.0, mix(EDGE_FLOOR, 1.0, smoothstep(0.0, EDGE_DEPTH, depthMax)), frame.edgeDarkening * frontness);
}
`;
