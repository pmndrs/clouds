/**
 * The Nubis lighting model shared by the march and the reflection dome. Needs COMMON_WGSL and FRAME_WGSL
 * (reads frame.phaseG, silverG, silverStrength, msStrength, ambientStrength, ambientSkyBias, ambientExtinction,
 * glowBoost, glowFront, edgeDarkening, deepScatter, deepAttenuation, ambientFloor, body, mie, lightDebug). All light colours come in as arguments (sky exposure units, no literals).
 * cloudInScatterMicro (Q-1) adds the billow-scale occlusion of the glow terms; cloudInScatter is the same with no occlusion (dome, sky layer).
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
const MIE_PHASE_MAX = 25.0; // C1: clamp of the Mie fit's sub-degree forward peak (stands in for the sun-disc average, approximate-mie.md sec. 3)

fn henyeyGreenstein(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}
// HG(g = phaseG) with an art-directable forward lobe (silver lining), or (C1, frame.body.z = 1) the Jendersie & d'Eon 2023 HG + Draine fit
// of real droplets, frame.mie = (gHG, gD, alpha, wD) from the droplet diameter (docs/research/approximate-mie.md).
fn mieLobe(omu: f32, g: f32) -> f32 {
  let om = 1.0 - g;
  let q = max(om * om + 2.0 * g * omu, 1e-9);   // 1 + g^2 - 2 g u without the cancellation near u = 1
  return q * sqrt(q);
}
fn cloudPhase(cosTheta: f32) -> f32 {
  if (frame.body.z > 0.5) {
    let m = frame.mie;
    let omu = 1.0 - cosTheta;
    let hg = (1.0 - m.x * m.x) / (4.0 * PI * mieLobe(omu, m.x));
    let draine = (1.0 - m.y * m.y) * (1.0 + m.z * cosTheta * cosTheta) / (4.0 * PI * (1.0 + m.z * (1.0 + 2.0 * m.y * m.y) / 3.0) * mieLobe(omu, m.y));
    return min(mix(hg, draine, m.w), MIE_PHASE_MAX);
  }
  return mix(henyeyGreenstein(cosTheta, frame.phaseG), henyeyGreenstein(cosTheta, frame.silverG), frame.silverStrength);
}
// In-scattered radiance per unit scattering at one sample. profile = in-scatter probability, sdf = signed distance to the
// surface (m, negative inside), h = height fraction in the volume, tau = optical depth toward the sun, gridUp = light grid
// 'up' sum (density*m), phase = cloudPhase(cosSun), sunRelax = valueRemap(cosSun, 0, 0.9, 0, 1).
fn cloudInScatter(profile: f32, sdf: f32, h: f32, tau: f32, gridUp: f32, phase: f32, sunRelax: f32, sunRadiance: vec3<f32>, ambientUp: vec3<f32>, ambientDown: vec3<f32>) -> vec3<f32> {
  return cloudInScatterMicro(profile, sdf, h, tau, gridUp, phase, sunRelax, sunRadiance, ambientUp, ambientDown, ambientUp, ambientDown, 1.0);
}
// Q-1: as cloudInScatter, with a billow-scale occlusion factor microOcc = exp(-microShadow * tau over the first metres toward
// the sun, full up-rezzed density) that the glow terms (ms, deep octaves) see. Without it the glow terms, which carry most of
// the lit radiance, vary only with the smooth profile and a 0.25-relaxed tau, so the lobes shade flat and the body reads as a
// smooth mass; the direct term alone resolves them but is too weak and too dark in the clefts to carry the look.
// C1 low-sun handoff (Bouthors 2008 order analysis, docs/research/frostbite-yusov-hogfeldt.md 1b): the glow and deep octaves are the
// high scattering orders, the diffuse body. Their sun-fed part scales with the sun's cosine to the surface (frame.body.x, 1 at high sun,
// MU_FLOOR at the horizon), and the environment pair takes it over as the sun drops (frame.body.y, 0 at high sun): envUp = the sky
// reduced with a weight toward the sun (RDR2 S36), envDown = ground bounce. The direct term (low orders: rims, silver lining) is untouched.
fn cloudInScatterMicro(profile: f32, sdf: f32, h: f32, tau: f32, gridUp: f32, phase: f32, sunRelax: f32, sunRadiance: vec3<f32>, ambientUp: vec3<f32>, ambientDown: vec3<f32>, envUp: vec3<f32>, envDown: vec3<f32>, microOcc: f32) -> vec3<f32> {
  // Inner glow: the profile is an in-scatter probability; extinction relaxes deep inside and toward the sun.
  let relax = mix(0.25, valueRemap(sdf, -128.0, 0.0, 0.05, 0.25), max(sunRelax, frame.glowFront));
  let ms = profile * exp(-tau * relax) * (1.0 + frame.glowBoost * sunRelax) * microOcc;
  // Ambient: dark where the profile is high, sky light attenuated by the density above, ground light from below.
  let tauUp = gridUp * frame.lightDensityScale * frame.ambientExtinction;
  // P3-F: sky light diffuses through thick cloud instead of dying: the attenuation saturates at ambientFloor, and so does the
  // profile occlusion (a thick base is lit by what scatters in from the sides and below, not just by what comes straight down).
  let above = mix(frame.ambientFloor, 1.0, exp(-tauUp));
  let occlusion = mix(frame.ambientFloor, 1.0, sqrt(1.0 - saturate(profile)));
  let skyWeight = frame.ambientSkyBias + (1.0 - frame.ambientSkyBias) * h;
  let ambient = AMBIENT_GAIN * frame.ambientStrength * occlusion * mix(ambientDown, ambientUp * above, skyWeight);
  // P3-F deep multiple scattering (Wrenninge / Hillaire octaves, n >= 1; n = 0 is the direct term above): b^n * phase(c^n) * exp(-a^n tau).
  // The eccentricity c^n is approximated by blending the phase toward isotropic. Uses the same tau, no extra samples.
  var deep = 0.0;
  var an = 1.0; var bn = 1.0; var cn = 1.0;
  for (var n = 1; n < DEEP_OCTAVES; n++) {
    an *= frame.deepAttenuation; bn *= DEEP_B; cn *= DEEP_C;
    deep += bn * mix(ISO_PHASE, phase, cn) * exp(-tau * an);
  }
  // C1: the sun's share of the body: elevation (body.x) and, at low sun, the optical depth toward the sun (body.w): dense cloud scatters
  // the sun away before it reaches the body, which is then lit only by its surroundings. The environment takes over what the sun lost.
  let sunShare = frame.body.x * exp(-tau * frame.body.w);
  let envShare = frame.body.y * (1.0 - sunShare);
  let direct = sunRadiance * (exp(-tau) * phase);
  let msLight = sunRadiance * (frame.msStrength * ms * MS_NORMALISATION * sunShare);
  // The environment-fed body: isotropic (no forward glow boost, no sun-ward occlusion), irradiance = pi * mean radiance.
  let envLight = mix(envDown, envUp * above, skyWeight) * (PI * envShare * profile * (frame.msStrength * MS_NORMALISATION + frame.deepScatter * ISO_PHASE));
  let deepLight = sunRadiance * (frame.deepScatter * deep * microOcc * sunShare);
  if (frame.lightDebug > 0.5 && frame.lightDebug < 5.5) {
    let k = u32(frame.lightDebug);
    return select(select(select(select(envLight, ambient, k == 4u), deepLight, k == 3u), msLight, k == 2u), direct, k == 1u);
  }
  return direct + msLight + deepLight + envLight + ambient;
}
// X3 'octave' lighting model (CloudSettings.lightingModel / ProceduralSettings.lightingModel): the per-sample model of Frostbite and Takram,
// for density without an SDF or an in-scatter profile (Hillaire 2016 eq. 19-20 after Wrenninge 2013 "Oz"; Takram three-clouds clouds.frag).
// n = 0..7: b^n * phase(g c^n) * exp(-a^n tau) with a = b = c = 0.5, phase a two-lobe HG (o.x forward g, o.y back g, o.z back weight).
// Octave 0 is the low order (rims, silver lining) and keeps the sun. Octaves >= 1 are the body: C1's low-sun handoff (Bouthors 2008) scales
// their sun share by elevation and the optical depth toward the sun (frame.body.x, .w) and gives the share it lost to the environment pair,
// isotropically (irradiance / 4 pi = radiance / 4), with the same depth falloff. Ambient: the sky irradiance / 4 pi along a height gradient
// (0.5 at the base, 1 at the top, Frostbite/Hogfeldt's [a, 1] bias), the lower hemisphere at half weight, times ambientGain.
// Powder (Takram): radiance *= 1 - o.w exp(-sigma 150 m). Takram's values: o = (0.7, -0.2, 0.5, 0.8), gain 1.
const OCTAVE_COUNT = 8;
fn cloudOctaveLight(tau: f32, cosSun: f32, h: f32, sigma: f32, sun: vec3<f32>, up: vec3<f32>, down: vec3<f32>, envUp: vec3<f32>, envDown: vec3<f32>, o: vec4<f32>, ambientGain: f32) -> vec3<f32> {
  var low = 0.0; var body = 0.0; var bodyIso = 0.0;
  var k = 1.0;
  for (var n = 0; n < OCTAVE_COUNT; n++) {
    let att = k * exp(-tau * k);
    let s = att * mix(henyeyGreenstein(cosSun, o.x * k), henyeyGreenstein(cosSun, o.y * k), o.z);
    if (n == 0) { low = s; } else { body += s; bodyIso += att; }
    k *= 0.5;
  }
  let sunShare = frame.body.x * exp(-tau * frame.body.w);
  let envShare = frame.body.y * (1.0 - sunShare);
  let g = saturate(h) * 0.5 + 0.5;
  let direct = sun * low;
  let msLight = sun * (body * sunShare);
  let envLight = mix(envDown, envUp, g) * (0.25 * envShare * bodyIso);
  let ambient = (up * g + down * ((1.0 - g) * 0.5)) * (0.25 * ambientGain);
  let powder = 1.0 - o.w * exp(-sigma * 150.0);
  if (frame.lightDebug > 0.5 && frame.lightDebug < 5.5) {
    let k = u32(frame.lightDebug);
    return powder * select(select(select(select(envLight, ambient, k == 4u), vec3(0.0), k == 3u), msLight, k == 2u), direct, k == 1u);
  }
  return (direct + msLight + envLight + ambient) * powder;
}
// The voxel march and the NVDF sky layer in 'octave' mode (frame.haze.w = 1): Takram's phase and powder.
const OCTAVE_DEFAULT = vec4(0.7, -0.2, 0.5, 0.8);
fn octaveOn() -> bool { return frame.haze.w > 0.5; }
// Dark edges (front-lit): rays that only graze the cloud (shallow in the SDF) scatter little. Multiply the ray's radiance by this.
fn cloudEdgeFactor(depthMax: f32, frontness: f32) -> f32 {
  return mix(1.0, mix(EDGE_FLOOR, 1.0, smoothstep(0.0, EDGE_DEPTH, depthMax)), frame.edgeDarkening * frontness);
}
`;
