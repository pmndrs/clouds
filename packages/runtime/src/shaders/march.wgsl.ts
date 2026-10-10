import { FRAME_WGSL } from './frame.wgsl';
import { lightGridWgsl } from './light-grid.wgsl';
import { atmosphereWgsl } from './atmosphere.wgsl';
import { LIGHTING_WGSL } from './lighting.wgsl';

/** Bindings in the march pass (group 1): the light grid texture + sampler, then the per-frame sky light buffer. */
export const MARCH_LIGHT_GRID_BINDING = 4;
export const MARCH_SKY_LIGHT_BINDING = 6;
/** Near-pass colour, read by the far pass to skip pixels hidden behind opaque near cloud (a dummy texture for the near pass). */
export const MARCH_NEAR_BINDING = 7;
/** D1 round 5: the blue-noise mask (r8unorm, BLUE_NOISE_SIZE square) the march jitter reads with jitterNoise. */
export const MARCH_BLUE_NOISE_BINDING = 8;
export const MARCH_ATMOSPHERE_GROUP = 2;
/** Radiance written to the half-float targets never exceeds this (f16 max is 65504). */
export const MARCH_RADIANCE_LIMIT = 60000;

/**
 * Entries of the per-frame sky light buffer (vec4 each). The march, sky layer and dome read [0..2]; the march and sky layer also [3..6].
 * [0] sun radiance at the volume centre (illuminance, exposure units), [1] sky ambient from above, [2] from below (mean radiance per hemisphere),
 * C1: [3] / [4] log(sun radiance) at the lit part's lowest / the volume's top height (w = that height, m), mixed by sample height (sunRadianceAtHeight),
 * [0].w = height of the earth's shadow (m; below it the sun has set, -1e9 while the sun is up), [2].w = half the width of its penumbra (m),
 * [5] the environment light above the body (the sky reduced with a weight toward the sun), [6] below it (ground bounce + the lower hemisphere),
 * [7] parameters written by the CPU before the dispatch: x = ground albedo, y = the sun weight of [5], z = how far [1]/[2] lean to [5]/[6] (low sun),
 * w = ambientBelowMirror (D1: how far the lower hemisphere [2]/[6] follows the upper one).
 */
export const SKY_LIGHT_ENTRIES = 8;
export const SKY_LIGHT_BYTES = SKY_LIGHT_ENTRIES * 16;
/** Per-sample sun radiance from the [3]/[4] pair: geometric interpolation in height, so the earth's shadow fades in from below. */
export const SUN_HEIGHT_WGSL = /* wgsl */ `
fn sunRadianceAtHeight(y: f32) -> vec3<f32> {
  let lo = skyLight[3];
  let hi = skyLight[4];
  let pen = skyLight[2].w;
  let earth = smoothstep(-pen, pen, y - skyLight[0].w);   // the earth's shadow, softened by the sun disc
  return exp(mix(lo.xyz, hi.xyz, saturate((y - lo.w) / max(hi.w - lo.w, 1.0)))) * earth;
}
`;

/**
 * P6-B/C lightning: in-scattered radiance (per unit scattering, in units of the scene light reference) at sample p from the flash point light.
 * Nubis³ s130 glow = pow(1 - d/r, 12) * (1 - sat(rho * 5)) lights the thin, wispy cloud near the discharge. On its own it vanishes wherever
 * rho > 0.2, which is all of a cumulonimbus's body, so a second term carries the light through dense cloud (documented deviation):
 * the point light's inverse-square law with a finite core, pow(1 - d/r, 2) / (1 + (d/CORE)^2), occluded by the cloud between the sample and
 * the strike: three taps of the cheap profile density (NVDF profile * scale, no noise fetch) along that segment give an optical depth, relaxed
 * by FLASH_DIFFUSE because multiple scattering carries light much farther through dense cloud than exp(-tau) (the inner glow uses the same
 * kind of relaxation for the sun). So the light is brightest at the strike and reaches the surface where the cloud between is thin, which is
 * what shapes the glow instead of a uniform wash. Colour runs from a warm white at the strike to the flash's own (cool) colour at the edge.
 */
const FLASH_WGSL = /* wgsl */ `
const FLASH_CORE = 110.0;      // metres: size of the finite core of the point light
const FLASH_DIFFUSE = 0.05;    // relaxation of the extinction along the strike-to-sample path (profile density): e^-2 through about 400 m of solid cloud
const FLASH_GAIN = 2.2;        // gain of the core term
const FLASH_WISP = 6.0;        // gain of the Nubis wisp term relative to the core one
fn flashGlow(p: vec3<f32>, rho: f32) -> vec3<f32> {
  let r = frame.flash.w;
  let toStrike = frame.flash.xyz - p;
  let d = length(toStrike);
  let x = saturate(1.0 - d / r);
  if (x <= 0.0) { return vec3(0.0); }
  var tau = rho * frame.extinction * min(d, 24.0);
  if (d > 24.0) {
    let m0 = sampleModeling(p + toStrike * 0.2, 0.0);
    let m1 = sampleModeling(p + toStrike * 0.5, 0.0);
    let m2 = sampleModeling(p + toStrike * 0.8, 0.0);
    tau += (m0.x * m0.z + m1.x * m1.z + m2.x * m2.z) * (d / 3.0) * frame.extinction;
  }
  let wisp = pow(x, 12.0) * (1.0 - saturate(rho * 5.0));
  let core = x * x / (1.0 + (d / FLASH_CORE) * (d / FLASH_CORE)) * exp(-FLASH_DIFFUSE * tau);
  let warm = frame.flashColor.xyz * vec3(1.25, 0.98, 0.72);
  let colour = mix(warm, frame.flashColor.xyz, smoothstep(0.0, 0.5, d / r));
  return colour * (FLASH_WISP * wisp + FLASH_GAIN * core);
}
`;

/**
 * SDF sphere-trace march with the Nubis lighting model (N3 s110-128) driven by the sky atmosphere (atmosphereWgsl).
 * Concatenate COMMON_WGSL + volumeWgsl(0) + DENSITY_WGSL + MARCH_WGSL. Group 1: 0 Frame, 1 scene depth,
 * 2 colour out (premultiplied radiance, a = transmittance), 3 depth out (direct: r32uint packDepth(mean cloud distance or 0, distance the ray was marched to,
 * scene distance); trace (`direct` false): r32float mean distance, at the dispatch coordinate), 4/5 light grid + sampler, 6 sky light (storage).
 * Group 2: the atmosphere (sky LUTs, see atmosphereWgsl).
 *
 * Direct light: transmittance toward the sun = exp(-(tauMicro + tauInline + tauGrid)): a short full-density sample from every lit
 * step (0-microDist m, Q-1: resolves billow-scale self-shadowing, fetched only within MICRO_DEPTH of the SDF surface), two in-line
 * samples of the real up-rezzed density (to 16 m and 16-48 m: keeps surface detail), the rest from the voxel light grid at
 * p + sun * 48 m. The first 16 m also occlude the glow terms (cloudInScatterMicro).
 * Everything is in the sky's exposure units (sunRadiance = sunRadianceAt, ambient = skyAmbient), no literal colours.
 * `fine` (P13-H1): every density sample (the step, the micro and the in-line sun samples) goes through cloudDensityFine, so within
 * hero.fineDistance they read the volume's fine hero overlay; flashGlow, the light grid and the dome stay on the coarse field. Without it
 * the shader is the pre-H1 one (cloudDensity), which keeps volumes without fine data bit-identical.
 */
export type MarchLightingMode = 'atmosphere' | 'uniform';
/**
 * 'uniform' drops the atmosphere group (no sky library): sun radiance and ambient come only from the skyLight buffer, and the
 * cloud gets no aerial perspective. Pipeline layout is then [volume, pass] only.
 */
/** V2 `directDensity`: every density sample reads the volume's direct density (cloudDensityDirect, shaders/direct.wgsl.ts, concatenated before). */
export function marchWgsl(mode: MarchLightingMode, direct = true, fine = false, directDensity = false): string {
  const atm = mode === 'atmosphere';
  const density = directDensity ? 'cloudDensityDirect' : fine ? 'cloudDensityFine' : 'cloudDensity';
  return /* wgsl */ `
${FRAME_WGSL}
@group(1) @binding(2) var marchColor: texture_storage_2d<rgba16float, write>;
${direct ? '@group(1) @binding(3) var marchDepth: texture_storage_2d<r32uint, write>;' : '@group(1) @binding(3) var marchDepth: texture_storage_2d<r32float, write>;'}
${lightGridWgsl(1, MARCH_LIGHT_GRID_BINDING)}
// The sky light buffer: see SKY_LIGHT_ENTRIES.
@group(1) @binding(${MARCH_SKY_LIGHT_BINDING}) var<storage, read> skyLight: array<vec4<f32>, ${SKY_LIGHT_ENTRIES}>;
${SUN_HEIGHT_WGSL}
@group(1) @binding(${MARCH_NEAR_BINDING}) var nearColor: texture_2d<f32>;
@group(1) @binding(${MARCH_BLUE_NOISE_BINDING}) var blueNoiseTex: texture_2d<f32>;
// D1 round 5 (jitterNoise): a blue-noise mask per pixel plus the golden-ratio sequence per frame (fract(b + phi * n), exact in u32), so each
// pixel's jitter over frames is a 1D low-discrepancy sequence and its phase relative to its neighbours is blue noise. The exponential temporal
// resolve never converges fully (its newest frame keeps temporalBlend of the weight); what it leaves behind is a function of the per-pixel phase,
// which with the interleaved gradient noise is IGN's diagonal whorl structure (the judges' fingerprint contours), with blue noise a fine
// high-frequency grain below the eye's contrast threshold.
fn marchJitter(px: vec2<u32>, frameIndex: u32) -> f32 {
  if (frame.d2.x > 0.5) {
    let dims = textureDimensions(blueNoiseTex);
    let b = textureLoad(blueNoiseTex, vec2<i32>(px % dims), 0).r + 0.5 / 256.0;
    let g = f32((frameIndex * 2654435769u) >> 8u) * (1.0 / 16777216.0);
    return fract(b + g);
  }
  return ign(vec2<f32>(px), frameIndex);
}
${atm ? atmosphereWgsl(MARCH_ATMOSPHERE_GROUP) : ''}
${LIGHTING_WGSL}
${FLASH_WGSL}

const STEP_GROWTH_FROM = 256u;
const STEP_MIN = 3.0;     // low/medium path (stepScale > 1)
const STEP_SQRT = 0.2;
const DECK_STEP_MIN = 1.0;   // SD2: N3 s150 max(1, 0.08*sqrt(t)), used on high/ultra (stepScale <= 1)
const DECK_STEP_SQRT = 0.08;
const SDF_SKIP_MARGIN = 6.0;     // metres: closer than this to the surface, fetch the real distance
const SDF_SKIP_RANGE = 24.0;     // metres: refetch at least this often so the inner-glow remap stays accurate
const DENSE_STEP_GAIN = 3.0;     // P3-E: step *= 1 + gain * (1 - T)^2: samples deep in thick media carry little weight (T * (1 - stepT)), so they are spaced wider
const DEPTH_CAP = 0.5;        // fraction of the depth below the surface a widened step may cover
const SPARSE_GAIN = 1.0;   // P3-E: inside the SDF but with almost no density (eroded haze) the step grows by this per consecutive thin sample...
const SPARSE_MAX = 6.0;     // ...up to this many
const SPARSE_THIN = 0.1;   // a sample is thin when sigma * step is below this (optical depth of the segment)
const LIGHT_MIN_OPTICAL_DEPTH = 2.0e-3; // segments thinner than this skip the sun/ambient evaluation
const MICRO_DEPTH = 40.0;   // Q-1: metres below the SDF surface within which the micro sun sample is fetched (the eroded billow shell)

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  // Temporal amortization (P5-B): the dispatch covers only this frame's traced pixels (all of them when k = 1 or on a cut).
  let pxu = tracedPixel(gid.xy);
  if (any(vec2<f32>(pxu) >= frame.renderSize)) { return; }
  let px = vec2<i32>(pxu);
  let uv = (vec2<f32>(pxu) + 0.5) / frame.renderSize;

  // Farthest scene depth over the output pixels this march pixel covers.
  let sceneEnd = passSceneEnd(pxu, uv);

  let origin = frame.cameraPos;
  let dir = normalize(unprojectDepth(uv, 1.0) - origin);
  let interval = volumeRayInterval(origin, dir);
  let isNear = frame.passMode == 0u;
  let tCap = select(frame.misc.y, frame.splitDistance, isNear);
  let tEnd = min(min(interval.y, sceneEnd), tCap);
  var t = max(interval.x, select(frame.splitDistance, 0.0, isNear));

  // Far pass: pixels whose neighbourhood in the near pass is (almost) opaque contribute nothing; skip them.
  var hidden = false;
  if (!isNear && frame.splitDistance > 0.0) {   // splitDistance 0: the near pass is off (the 'mobile' tier), the far pass marches the whole ray
    let nd = vec2<i32>(frame.rects.xy);
    let c = vec2<i32>(floor(uv * vec2<f32>(nd))) - vec2<i32>(1);
    var maxT = 0.0;
    for (var y = 0; y < 4; y++) {
      for (var x = 0; x < 4; x++) { maxT = max(maxT, textureLoad(nearColor, clamp(c + vec2<i32>(x, y), vec2<i32>(0), nd - vec2<i32>(1)), 0).a); }
    }
    hidden = maxT < 0.02;
  }

  var T = 1.0;
  var depthMax = 0.0;   // deepest point below the cloud surface this ray reached (thin silhouettes stay shallow)
  var radiance = vec3(0.0);
  var flashAcc = vec3(0.0);   // P6-B: secondary light energy from the lightning glow, kept apart so the edge darkening (a sun term) does not touch it
  var depthSum = 0.0;
  var weightSum = 0.0;

  if (interval.x <= interval.y && t < tEnd && !hidden) {
    let jitterAnimated = marchJitter(pxu, frame.frameIndex);
    // D1 (N3 s150): with jitterStatic the hash past 250 m is the pixel's fixed one; the temporal resolve then has nothing to average there.
    let jitterStatic = marchJitter(pxu, 0u);
    // D1 round 5 (stepJitter): the step sequence itself starts at a random phase where the ray enters the cloud. The sample jitter alone leaves the
    // segment boundaries fixed per ray, and the segment estimator (one density for the whole segment) is biased by the segment's phase against the
    // surface, so neighbouring rays with different entry phases shade differently: arcs at the step period following the entry-depth contours.
    var entryJitter = select(0.0, fract(jitterAnimated + 0.618034), frame.d2.y > 0.5);
    let inlineReuse = frame.d2.w;
    let staticJitter = frame.material2.z > 0.5;
    // D1: the in-line taps' optical depth in the light sums' units (inlineLightScale; 1 = the view extinction).
    let inlineExt = frame.extinction * frame.material2.y;
    let cosSun = dot(dir, frame.sunDir);
    let phase = cloudPhase(cosSun);
    let sunRelax = valueRemap(cosSun, 0.0, 0.9, 0.0, 1.0);
    // 1 with the sun behind the viewer, 0 when looking toward it or sideways: where the dark edges apply.
    let frontness = (1.0 - smoothstep(-0.6, 0.1, cosSun));
    let sunRadiance = skyLight[0].xyz;
    let ambientUp = skyLight[1].xyz;
    let ambientDown = skyLight[2].xyz;
    let envUp = skyLight[5].xyz;
    let envDown = skyLight[6].xyz;
    let sunInline0 = frame.sunDir * (0.5 * INLINE_NEAR);
    let sunInline1 = frame.sunDir * (0.5 * (INLINE_NEAR + INLINE_FAR));
    let sunGrid = frame.sunDir * INLINE_FAR;
    let invExtentY = 1.0 / cloudVolume.extent.y;
    var inputs = DensityInputs(frame.wind, frame.mipDistanceScale, frame.baseMip, 0u, frame.wispyBias, frame.detailBias, frame.uprez);
    // The in-line sun samples skip the high-frequency fold (they are 8-32 m from the sample, below its scale).
    // D1: lightMipBias coarsens their field and noise fetches; inlineProfile makes them read the cheap profile (.y) instead of the up-rez (.x).
    let lightInputs = DensityInputs(frame.wind, frame.mipDistanceScale, frame.baseMip + frame.d1.y, 0u, frame.wispyBias, frame.detailBias, frame.uprez);
    let inlineProfile = frame.d1.x > 0.5;
    let flashOn = frame.flash.w > 0.0;   // uniform: the whole glow below is skipped (never evaluated) when no flash is active
    let flashRef = dot(sunRadiance + ambientUp, vec3(0.2126, 0.7152, 0.0722));   // exposure reference: the scene's own light, no literal brightness
    let sunMicro = frame.sunDir * (0.5 * frame.microDist);
    let microOn = frame.microDist > 0.0;
    var capped = true;
    // Lipschitz bound on the signed distance: |sdf(p + s) - sdf(p)| <= s, so the last fetched value minus the distance
    // travelled since is a conservative (more negative would be wrong) bound while we are deep inside; refetch when it nears 0.
    var sdfBound = 0.0;
    var sdfFetchT = -1.0e9;
    var sparseRun = 0.0;
    var inlineT = -1.0e9;
    var tauInline = 0.0;
    var tauNear = 0.0;   // the 0..INLINE_NEAR m part of tauInline (micro sample excluded)

    for (var i = 0u; i < frame.maxSteps; i++) {
      if (t >= tEnd || T < frame.tCutoff) { capped = false; break; }
      let p = origin + dir * t;
      var sdf = sdfBound + (t - sdfFetchT);   // upper bound of the true distance at t
      if (sdf > -SDF_SKIP_MARGIN || t - sdfFetchT > SDF_SKIP_RANGE) {
        sdf = cloudDistance(p);
        sdfBound = sdf; sdfFetchT = t;
      }
      let deckStep = frame.stepScale <= 1.0;
      var step = max(sdf, select(max(STEP_MIN, sqrt(t) * STEP_SQRT) * frame.stepScale, max(DECK_STEP_MIN, sqrt(t) * DECK_STEP_SQRT), deckStep));
      // Never silently truncate a long ray at the step cap: coarsen the step once a ray has used a lot of them.
      {
        // P3-E: widen the step in thin or dark-deep media, but never by more than half the depth below the surface (the SDF is a bound,
        // so such a step stays inside the cloud and cannot skip across a skin or a bulge).
        let wide = step * (1.0 + sparseRun * SPARSE_GAIN) * (1.0 + DENSE_STEP_GAIN * (1.0 - T) * (1.0 - T));
        step = min(wide, max(step, -sdf * DEPTH_CAP));
      }
      if (i > STEP_GROWTH_FROM) { step *= 1.0 + 0.02 * f32(i - STEP_GROWTH_FROM); }
      if (sdf < 0.0 && entryJitter > 0.0) { step *= entryJitter; entryJitter = 0.0; }
      if (sdf < 0.0) {
        // Jitter moves the sample, not the advance. Q2: animated at every distance. The static far jitter (one interleaved-gradient value per
        // pixel, fixed) printed IGN's diagonal structure into every dense cloud past 250 m as a fixed 'pebbly' hatch, since the temporal
        // resolve only averages what changes between frames.
        let ts = t + select(jitterAnimated, jitterStatic, staticJitter && t >= 250.0) * step;
        let ds = min(step, tEnd - t);
        if (ts < tEnd) {
          inputs.hfDetails = select(0u, 1u, ts < max(frame.misc.x, 150.0));
          let ps = origin + dir * ts;
          let d = ${density}(ps, ts, inputs);
          sparseRun = select(0.0, min(sparseRun + 1.0, SPARSE_MAX), d.x * frame.extinction * step < SPARSE_THIN);
          if (d.x > 0.0) {
            let sigma = d.x * frame.extinction;
            let stepT = exp(-sigma * ds);
            if (sigma * ds > LIGHT_MIN_OPTICAL_DEPTH) {
              // Optical depth toward the sun: two in-line samples, then the light grid from 48 m on.
              if (ts - inlineT >= inlineReuse) {
                let s0 = ${density}(ps + sunInline0, ts, lightInputs);
                let s1 = ${density}(ps + sunInline1, ts, lightInputs);
                let d0 = select(s0.x, s0.y, inlineProfile);
                let d1 = select(s1.x, s1.y, inlineProfile);
                tauNear = d0 * (INLINE_NEAR - frame.microDist) * inlineExt;
                tauInline = tauNear + d1 * (INLINE_FAR - INLINE_NEAR) * inlineExt;
                inlineT = ts;
              }
              // Q-1: one short full-density sample toward the sun from every lit step (never reused: it is what resolves the
              // billows). Its optical depth joins the direct term, and the first INLINE_NEAR metres toward the sun also occlude the
              // glow terms (microOcc): multiply-scattered light diffuses only a few metres in dense cloud, so a lobe's shadow side
              // glows less than its lit side. The relaxed, grid-fed tau in the lighting keeps the inner glow of deep interiors.
              // Deeper than the erosion shell the sample's own density stands in for it (the lobes are all within MICRO_DEPTH of the surface).
              // D1 round 9 (microLightScale, the floret investigation's T2): the short tap's optical depth in its own units, a fraction of the view
              // extinction (the deck's first in-line sample "preserves detail near the surfaces", s113); 0 = the in-line taps' units as before.
              let microExt = select(inlineExt, frame.extinction * frame.d3.z, frame.d3.z > 0.0);
              var tauMicro = d.x * frame.microDist * microExt;
              if (microOn && sdf > -MICRO_DEPTH) { tauMicro = ${density}(ps + sunMicro, ts, inputs).x * frame.microDist * microExt; }
              let microOcc = exp(-frame.microShadow * (tauMicro + tauNear));
              // D1 round 3: lobe-scale ambient occlusion, one upward sample of the full density (ambientTap metres) in the in-line light units.
              var ambOcc = 1.0;
              if (frame.d1.z > 0.0) { ambOcc = exp(-${density}(ps + vec3(0.0, 0.5 * frame.d1.z, 0.0), ts, lightInputs).x * frame.d1.z * inlineExt); }
              var grid: vec2<f32>;
              if (frame.d2.z > 0.5) { grid = lightGridSampleCubic(ps + sunGrid); } else { grid = lightGridSampleClamped(ps + sunGrid); }
              let tau = tauMicro + tauInline + grid.x * frame.lightDensityScale;
              let h = saturate((ps.y - cloudVolume.minCorner.y) * invExtentY);
              var lit: vec3<f32>;
              // H3: the ambient's up sum is read at the sample itself. The sun tap (48 m toward the sun) landed inside the neighbouring
              // tower on shaded walls and under dense cores, so the ambient darkened by that column, not the cloud above the sample.
              if (octaveOn()) { lit = cloudOctaveLight(tau, cosSun, h, sigma, sunRadianceAtHeight(ps.y), ambientUp, ambientDown, envUp, envDown, OCTAVE_DEFAULT, octaveVoxel()); }
              else {
                // D1 round 3 (inScatterProfile): the deck's in-scatter probability is the dimensional profile alone (s123/s126), not profile x scale.
                // D1 round 6 (profileFilter, bit 1): the lighting profile through the tricubic read (trilinear kinks print voxel-plane seams).
                let cubicP = (u32(frame.material2.w) & 1u) != 0u;
                // D1 round 9: inScatterProfile is an exponent, pLight = P * S^(1 - t): 0 = P x S (P1 and before), 1 = the deck's P (s123), 0.5 = P sqrt(S).
                var mLight = sampleModeling(ps, frame.baseMip);
                if (cubicP) { mLight = sampleModelingCubic(ps, frame.baseMip); }
                // D1 round 8 (glowDepth): the deck's glow is the light scattered deeper inside shining through the surface (s116-119); read P
                // where that light comes from, glowDepth metres past the sample, instead of at the lobe's own front, where the profile is small and
                // a protruding profile lobe prints a dark disc. Mode 0: along the view ray; 1: max of both reads; 2 (round 9): inward along the
                // SDF's gradient (the lobe's own core), so a thin lit sliver in front of a dense body does not borrow the body's P (the hard chip).
                if (frame.d3.x > 0.0) {
                  var inward = dir;
                  if (frame.d3.y > 1.5) {
                    let e = 0.5 * cloudVolume.voxelSize;
                    let g = vec3(cloudDistance(ps + vec3(e, 0.0, 0.0)) - cloudDistance(ps - vec3(e, 0.0, 0.0)), cloudDistance(ps + vec3(0.0, e, 0.0)) - cloudDistance(ps - vec3(0.0, e, 0.0)), cloudDistance(ps + vec3(0.0, 0.0, e)) - cloudDistance(ps - vec3(0.0, 0.0, e)));
                    inward = -normalize(g + vec3(1e-6, 0.0, 0.0));
                  }
                  let mDeep = sampleModeling(ps + inward * frame.d3.x, frame.baseMip);
                  if (frame.d3.y > 0.5 && frame.d3.y < 1.5) { mLight = select(mLight, mDeep, mDeep.x > mLight.x); } else { mLight = mDeep; }
                }
                let pLight = mLight.x * pow(max(mLight.z, 1e-4), 1.0 - saturate(frame.d1.w));
                // D1 round 4: the glow's depth relaxation reads the true distance at the sample (s123 GetVoxelCloudDistance), not the stepping
                // bound sdf (the last fetch minus the distance travelled, refetched every 24 m): the bound's error followed the per-pixel
                // jitter and printed speckle into the ms term wherever the relaxation is steep.
                var sdfLit = cloudDistance(ps);
                if ((u32(frame.material2.w) & 2u) != 0u) { sdfLit = cloudDistanceCubic(ps); }   // D1 round 6 (profileFilter, bit 2)
                lit = cloudInScatterMicro(pLight, sdfLit, h, tau, lightGridSampleClamped(ps).y, phase, sunRelax, sunRadianceAtHeight(ps.y), ambientUp * ambOcc, ambientDown * ambOcc, envUp, envDown, microOcc);
              }
              depthMax = max(depthMax, -sdf);
              // Energy-conserving segment integration (albedo 1, so scattering = extinction).
              let w = T * (1.0 - stepT);
              radiance += lit * w;
              if (flashOn) { flashAcc += flashGlow(ps, d.x) * (flashRef * w); }
              depthSum += ts * w;
              weightSum += w;
            }
            T *= stepT;
          }
        }
      }
      t += step;
    }
    // Ran out of steps with cloud left to march: finish thin remainders rather than dropping them as transparent.
    if (capped && t < tEnd && T < 0.3) { T = 0.0; }
    if (T < frame.tCutoff) {
      // Early-out at the cutoff: let the remaining light continue as the mean colour of what was accumulated,
      // so a high cutoff does not darken or brighten the ray by the ignored residual (what the sky would show through it).
      let keep = 1.0 / max(1.0 - T, 0.5);
      radiance *= keep; flashAcc *= keep;
      T = 0.0;
    }
    radiance = radiance * select(cloudEdgeFactor(depthMax, frontness), 1.0, octaveOn()) + flashAcc;
  }

  let meanDistance = select(0.0, depthSum / max(weightSum, 1e-6), weightSum > 1e-3);
${atm ? `  if (meanDistance > 0.0 && frame.lightDebug < 0.5) {
    // Aerial perspective of the cloud as a whole, at its transmittance-weighted mean distance.
    let viewDir = normalize(unprojectDepth(uv, 1.0) - origin);
    radiance = applyAerialPerspective(radiance, T, viewDir, meanDistance);
    radiance = applyHorizonHaze(radiance, T, origin, viewDir, meanDistance, frame.haze);
  }` : ''}
  radiance = clamp(radiance, vec3(0.0), vec3(${MARCH_RADIANCE_LIMIT}.0));
${direct ? `  textureStore(marchColor, px, vec4(radiance, T));
  textureStore(marchDepth, px, vec4<u32>(packDepth(meanDistance, tEnd, sceneEnd), 0u, 0u, 0u));` : `  // Trace target: only this frame's traced pixels, stored compactly at the dispatch coordinate (x only needs the mean distance).
  textureStore(marchColor, vec2<i32>(gid.xy), vec4(radiance, T));
  textureStore(marchDepth, vec2<i32>(gid.xy), vec4(meanDistance, 0.0, 0.0, 0.0));`}
}
`;
}
export const MARCH_WGSL = marchWgsl('atmosphere');

/** One thread per frame: sun radiance and sky ambient at the volume centre -> a small buffer the march reads. */
export const SKY_LIGHT_BINDING = 0;
export const SKY_LIGHT_WGSL = /* wgsl */ `
@group(1) @binding(${SKY_LIGHT_BINDING}) var<storage, read_write> skyLightOut: array<vec4<f32>, ${SKY_LIGHT_ENTRIES}>;
${atmosphereWgsl(MARCH_ATMOSPHERE_GROUP)}

const LOG_FLOOR = 1.0e-12;
const SUN_HALF_ANGLE = 0.00465;   // radians
@compute @workgroup_size(1)
fn main() {
  let c = cloudVolume.minCorner + cloudVolume.extent * 0.5;
  let a = skyAmbient(c);
  let sun = sunRadianceAt(c);
  let params = skyLightOut[7];
  let up = atmLocalUp(c);
  // C1: after sunset at the ground, cloud above the earth's shadow still sees the sun (through the whole low atmosphere: red and dim).
  // The shadow height over a flat world: r = R / sqrt(1 - mu^2) for mu < 0; its penumbra is the sun disc's angle times the distance to the
  // tangent point. The per-height sun is sampled from just above the shadow (or the base) to the top, the shadow itself is applied per sample.
  let muSun = dot(atmosphere.sunDirection, up);
  var shadowY = -1.0e9;
  var pen = 1.0;
  if (muSun < 0.0) {
    let R = atmosphere.bottomRadiusKm * 1000.0;
    let hShadow = R / sqrt(max(1.0 - muSun * muSun, 1e-6)) - R;
    pen = max(sqrt(2.0 * R * hShadow) * SUN_HALF_ANGLE, 1.0);
    shadowY = hShadow;
  }
  let yBase = cloudVolume.minCorner.y;
  let yTop = yBase + cloudVolume.extent.y;
  let yLo = clamp(shadowY + pen, yBase, yTop);
  let pLo = c + up * (yLo - c.y);
  let pHi = c + up * (yTop - c.y);
  skyLightOut[0] = vec4(sun, shadowY);
  skyLightOut[3] = vec4(log(max(sunRadianceAt(pLo), vec3(LOG_FLOOR))), yLo);
  skyLightOut[4] = vec4(log(max(sunRadianceAt(pHi), vec3(LOG_FLOOR))), yTop);
  let envUp = skyAmbientSunWeighted(c, params.y);
  // Ground bounce under the cloud: a Lambertian ground of albedo params.x lit by the sun and the sky, plus the haze of the lower hemisphere.
  let ground = c - up * (atmRadiusKm(c) - atmosphere.bottomRadiusKm) * 1000.0;
  let muS = max(dot(atmosphere.sunDirection, up), 0.0);
  // D1 round 3 (params.w = ambientBelowMirror): the lower hemisphere follows the upper one, the deck frames' sky below the horizon.
  let lower = mix(a.lower, a.upper, saturate(params.w));
  let envDown = lower + params.x * (sunRadianceAt(ground) * (muS / ATM_PI) + a.upper);
  skyLightOut[5] = vec4(envUp, 0.0);
  skyLightOut[6] = vec4(envDown, 0.0);
  // The ambient pair leans to the environment pair as the sun drops (params.z = 0 at and above the body knee: unchanged by day).
  skyLightOut[1] = vec4(mix(a.upper, envUp, params.z), 0.0);
  skyLightOut[2] = vec4(mix(lower, envDown, params.z), pen);
}
`;
