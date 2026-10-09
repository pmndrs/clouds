import { atmosphereWgsl } from '../shaders/atmosphere.wgsl';
import { FRAME_WGSL } from '../shaders/frame.wgsl';
import { LIGHTING_WGSL } from '../shaders/lighting.wgsl';
import { MARCH_ATMOSPHERE_GROUP, MARCH_RADIANCE_LIMIT, SKY_LIGHT_ENTRIES, SUN_HEIGHT_WGSL } from '../shaders/march.wgsl';
import { SKY_BACK_BINDING, SKY_COLOR_BINDING, SKY_DEPTH_BINDING, SKY_LIGHT_STORAGE_BINDING, SKY_PARAMS_BINDING, SKY_PARAMS_WGSL, SKY_SAMPLER_BINDING, SKY_WEATHER_BINDING } from '../shaders/sky-layer.wgsl';
import { PROC_PARAMS_WGSL, PROC_SKYPRO_WGSL, PROC_TAKRAM_WGSL } from './density.wgsl';
import type { ProceduralShaper } from './settings';

/** Extra group-1 bindings of the procedural trace (after the sky layer's 0..8). */
export const PROC_BINDINGS = { params: 9, noiseA: 10, noiseB: 11, weather: 12, aux: 13, sampler: 14 } as const;

/**
 * X1: the procedural trace. It replaces the sky layer's trace pass when CloudSettings.densityModel is 'procedural' and writes the same targets
 * (front colour, depth, back colour), so the sky layer's temporal resolve (1/16 pixels per frame, SKY_RESOLVE_WGSL), the composite and the haze
 * are shared. It covers everything from the camera to the horizon (no voxel box partition: the voxel march is off in this mode), so the whole
 * result is the 'front' part and the back part stays clear.
 *
 * The march is Sky Pro's (sky-pro clouds.wgsl, via tidewater/src/sky/SkyProClouds.js scMarch; MIT, DRG Software Solutions LLC, used with the
 * author's permission): a spherical shell interval, coarse steps of 4x the fine step until a cloud is found, a step back, fine steps sized by the
 * pixel cone and shortened at the surface (0.5 / sigma), back to coarse after four empty steps; the Sky Pro shaper also skips whole empty weather
 * cells (64^2 maxima). This is HZD's cheap-to-full march (s75-80) with NE p.39's distance-growing step.
 * Light: Sky Pro's cone of light taps toward the sun (HZD s83: six cone samples, the last far away), 25 m * 1.7^i, the cheap density once the
 * ray is half opaque (HZD s84), reused while the density stays similar; two cheap taps straight up for the ambient optical depth. The radiance is
 * OUR lighting (LIGHTING_WGSL cloudInScatterMicro: N3 multiple-scattering body, the deep octaves, the C1 low-sun handoff, the ambient pair), with
 * the sun evaluated at the sample's altitude (sunRadianceAt) and our aerial perspective and C2 haze applied at the opacity-weighted mean
 * distance (NE p.187), as the voxel march and the sky layer do.
 */
export function proceduralTraceWgsl(mode: 'atmosphere' | 'uniform', shaper: ProceduralShaper): string {
  const atm = mode === 'atmosphere';
  const B = PROC_BINDINGS;
  return /* wgsl */ `
${FRAME_WGSL}
${SKY_PARAMS_WGSL}
@group(1) @binding(${SKY_COLOR_BINDING}) var skyColorOut: texture_storage_2d<rgba16float, write>;
@group(1) @binding(${SKY_DEPTH_BINDING}) var skyDepthOut: texture_storage_2d<rgba32float, write>;
@group(1) @binding(${SKY_WEATHER_BINDING}) var skyWeather: texture_2d<f32>;
@group(1) @binding(${SKY_SAMPLER_BINDING}) var skySampler: sampler;
@group(1) @binding(${SKY_LIGHT_STORAGE_BINDING}) var<storage, read> skyLight: array<vec4<f32>, ${SKY_LIGHT_ENTRIES}>;
${SUN_HEIGHT_WGSL}
@group(1) @binding(${SKY_PARAMS_BINDING}) var<uniform> SKY: SkyParams;
@group(1) @binding(${SKY_BACK_BINDING}) var skyBackOut: texture_storage_2d<rgba16float, write>;
@group(1) @binding(${B.params}) var<uniform> P: ProcParams;
@group(1) @binding(${B.noiseA}) var procNoiseA: texture_3d<f32>;
@group(1) @binding(${B.noiseB}) var procNoiseB: texture_3d<f32>;
@group(1) @binding(${B.weather}) var procWeather: texture_2d<f32>;
@group(1) @binding(${B.aux}) var procAux: texture_2d<f32>;
@group(1) @binding(${B.sampler}) var procRepeat: sampler;
${atm ? atmosphereWgsl(MARCH_ATMOSPHERE_GROUP) : ''}
${LIGHTING_WGSL}
${PROC_PARAMS_WGSL}
${shaper === 'skypro' ? PROC_SKYPRO_WGSL : PROC_TAKRAM_WGSL}

fn procSunRadiance(p: vec3<f32>) -> vec3<f32> {
${atm ? '  return sunRadianceAt(vec3(p.x, procAltitude(p), p.z));' : '  return sunRadianceAtHeight(procAltitude(p));'}
}
fn radicalInverse(i0: u32, base: u32) -> f32 {
  var i = i0; var f = 1.0; var r = 0.0;
  let b = f32(base);
  for (var k = 0; k < 8 && i > 0u; k++) { f = f / b; r += f * f32(i % base); i = i / base; }
  return r;
}
// Sky Pro scShellRoots: ray / sphere-shell roots about the planet centre below the camera (flat world, y = altitude at the camera).
fn procShellRoots(direction: vec3<f32>, altitude: f32, originHeight: f32) -> vec2<f32> {
  let radius = PROC_EARTH_M;
  let b = (radius + originHeight) * direction.y;
  let c = (originHeight - altitude) * (2.0 * radius + originHeight + altitude);
  let h = b * b - c;
  if (h < 0.0) { return vec2(-1.0); }
  let q = -b - select(-sqrt(h), sqrt(h), b >= 0.0);
  let other = c / select(-0.0001, q, abs(q) > 0.0001);
  return vec2(min(q, other), max(q, other));
}
fn procCloudInterval(dir: vec3<f32>, originHeight: f32) -> vec2<f32> {
  let inner = procShellRoots(dir, P.shell.x, originHeight);
  let outer = procShellRoots(dir, P.shell.y, originHeight);
  var start = 0.0; var end = min(outer.y, P.shell.z);
  if (outer.y <= 0.0) { return vec2(0.0); }
  if (originHeight < P.shell.x) { start = max(inner.y, 0.0); }
  else {
    if (originHeight > P.shell.y) { start = max(outer.x, 0.0); }
    if (inner.x >= 0.0) { end = min(end, inner.x); }
  }
  // The planet's surface (Sky Pro): a ray below the horizon ends on the ground sphere, not on the far side of the curved shell.
  let ground = procShellRoots(dir, 0.0, originHeight);
  if (ground.x > 0.0) { end = min(end, ground.x); }
  return vec2(start, end);
}
// Lighting A/B (P.lit.x = 1): Takram's per-sample radiance (@takram/three-clouds clouds.frag marchClouds, MIT): the multiple-scattering
// approximation of Wrenninge's Oz volumes (8 octaves, attenuation = contribution = phase attenuation = 0.5) with Takram's two-lobe HG
// (g = 0.7 and -0.2, mixed 50/50), the sky irradiance / 4 pi along a height gradient (0.5..1), powder. Same sun and sky radiance as ours:
// the sky irradiance is pi * the cosine-weighted mean radiance (skyLight[1]); the ground bounce is approximated by the lower hemisphere.
fn procHG(g: f32, c: f32) -> f32 { let g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-7), 1.5)); }
fn procTakramLight(tau: f32, cosSun: f32, h: f32, sigma: f32, sun: vec3<f32>, up: vec3<f32>, down: vec3<f32>) -> vec3<f32> {
  var ms = 0.0;
  var k = 1.0;
  for (var i = 0; i < 8; i++) {
    ms += k * exp(-tau * k) * (0.5 * procHG(0.7 * k, cosSun) + 0.5 * procHG(-0.2 * k, cosSun));
    k *= 0.5;
  }
  let skyGradient = h * 0.5 + 0.5;
  var r = sun * ms + (up * skyGradient + down * (1.0 - skyGradient) * 0.5) * 0.25;
  return r * (1.0 - P.lit.y * exp(-sigma * 150.0));
}
const PROC_FAR_TAPS = 4u;
const PROC_FAR_REACH = 20000.0;
fn heat(x0: f32) -> vec3<f32> {
  let x = saturate(x0);
  return vec3(smoothstep(0.25, 0.6, x), smoothstep(0.0, 0.35, x) * (1.0 - smoothstep(0.7, 1.0, x)), 1.0 - smoothstep(0.1, 0.5, x));
}

@compute @workgroup_size(8, 8)
fn trace(@builtin(global_invocation_id) gid: vec3<u32>) {
  let full = SKY.temporal.z > 0.5;
  var px = vec2<i32>(gid.xy);
  if (!full) { px = px * 4 + bayerPos(u32(SKY.temporal.x)); }
  if (any(vec2<f32>(px) >= frame.renderSize)) { return; }
  let uv = (vec2<f32>(px) + 0.5) / frame.renderSize;
  let sceneEnd = skySceneEnd(px, uv);
  let origin = frame.cameraPos;
  // Sub-pixel jitter per cycle (as the sky layer, P7-E): the history converges to the pixel's average.
  let cycle = u32(SKY.temporal.y);
  let subPx = (vec2(radicalInverse(1u + cycle % 16u, 2u), radicalInverse(1u + cycle % 16u, 3u)) - 0.5) * 2.0;
  let dir = normalize(unprojectDepth((vec2<f32>(px) + 0.5 + subPx) / frame.renderSize, 1.0) - origin);
  // Cone angles (Sky Pro): one layer pixel for the step, one output pixel for the texture LOD.
  let dirY = normalize(unprojectDepth((vec2<f32>(px) + vec2(0.5, 1.5)) / frame.renderSize, 1.0) - origin);
  let stepConeAngle = length(dirY - normalize(unprojectDepth(uv, 1.0) - origin));
  let pixelConeAngle = stepConeAngle * frame.renderSize.y / frame.outputSize.y;
  let interval = procCloudInterval(dir, origin.y);
  let tEnd = min(interval.y, sceneEnd);

  var color = vec3(0.0);
  var T = 1.0;
  var depthSum = 0.0; var depthSqSum = 0.0; var weightSum = 0.0; var depthMax = 0.0;
  var steps = 0u; var firstHit = -1.0; var firstProfile = 0.0;
  if (tEnd > interval.x) {
    let jitter = ign(vec2<f32>(px), cycle);
    let L = frame.sunDir;
    let cosSun = dot(dir, L);
    let phase = cloudPhase(cosSun);
    let sunRelax = valueRemap(cosSun, 0.0, 0.9, 0.0, 1.0);
    let frontness = 1.0 - smoothstep(-0.6, 0.1, cosSun);
    let ambientUp = skyLight[1].xyz;
    let ambientDown = skyLight[2].xyz;
    let envUp = skyLight[5].xyz;
    let envDown = skyLight[6].xyz;
    // Light taps (Sky Pro update(): a 25 m local segment, then 25 * 1.7^i over a cone of 0.05 rad).
    var tx = vec3(L.z, 0.0, -L.x);
    if (abs(L.y) > 0.99) { tx = vec3(0.0, -L.z, L.y); }
    tx = normalize(tx);
    let bx = cross(L, tx);
    let taps = u32(P.steps.z);
    var tapOff: array<vec4<f32>, 8>;
    for (var i = 1u; i < 8u; i++) {
      let growth = pow(1.7, f32(i));
      let mid = 25.0 * ((growth - 1.0) / 0.7 + growth * 0.5);
      let angle = f32(i) * 2.399963;
      let radius = sqrt((f32(i) + 0.5) / max(f32(taps), 1.0));
      let u = cos(angle) * radius * 0.05 * mid;
      let v = sin(angle) * radius * 0.05 * mid;
      tapOff[i] = vec4(L * mid + tx * u + bx * v, 25.0 * growth);
    }
    let densityScale = P.misc.x;
    let fadeStart = 0.8 * P.shell.z;
    var t = interval.x + jitter * P.steps.x;
    var coarse = true; var emptyRun = 0u; var accumulated = 0.0; var refineEnd = -1.0;
    var cellEnd = -1.0; var cellStart = -1.0; var maximumWeather = 1.0;
    var shadowAt = -1.0e9; var shadowDensity = -1.0; var shadowTau = 0.0; var nearTau = 0.0; var skyTau = 0.0; var shadowCheap = false;
    let maxSteps = u32(P.steps.y);
    for (var i = 0u; i < maxSteps; i++) {
      if (t >= tEnd || T < SKY.steps.w) { break; }
      steps++;
      if (coarse && PROC_HAS_BOUNDS) {
        if (t >= cellEnd || t < cellStart) {
          let size = vec2<i32>(textureDimensions(procAux));
          let grid = (origin.xz + dir.xz * t - frame.wind.xz) / P.spShape.x * vec2<f32>(size);
          let cell = vec2<i32>(floor(grid));
          maximumWeather = textureLoad(procAux, ((cell % size) + size) % size, 0).r;
          let dist = select(fract(grid), 1.0 - fract(grid), dir.xz >= vec2(0.0)) / max(abs(dir.xz) * vec2<f32>(size) / P.spShape.x, vec2(0.0000001));
          cellStart = t; cellEnd = min(tEnd, t + max(min(dist.x, dist.y), 0.05));
        }
        if (procCellIsEmpty(t, cellEnd, dir, origin.y, maximumWeather)) { t = cellEnd + 0.05; continue; }
      }
      let footprint = t * pixelConeAngle;
      let fineStep = max(P.steps.x, t * stepConeAngle * 1.5);
      let p = origin + dir * t;
      if (coarse) {
        let c = procSample(p, t, footprint, true, jitter);
        if (c.sigma > 0.0) {
          refineEnd = t;
          t = max(interval.x, t - fineStep * 4.0) + fineStep;
          t = min(t, refineEnd);
          coarse = false; emptyRun = 0u;
          continue;
        }
        t += fineStep * 4.0;
        continue;
      }
      let s = procSample(p, t, footprint, true, jitter);
      if (s.sigma <= 0.0) {
        shadowAt = -1.0e9;
        emptyRun++;
        if (t < refineEnd) { t = min(t + fineStep, refineEnd); continue; }
        if (emptyRun >= 4u) { coarse = true; }
        t += select(fineStep, fineStep * 4.0, coarse);
        continue;
      }
      emptyRun = 0u; refineEnd = -1.0;
      let fade = 1.0 - smoothstep(fadeStart, P.shell.z, t);
      let sigmaT = s.sigma * densityScale * fade;
      let surfaceStep = clamp(0.5 / max(sigmaT, 0.000001), fineStep * 0.15, fineStep);
      let stepLength = min(mix(surfaceStep, fineStep * 3.0, smoothstep(1.0, 3.0, accumulated)), tEnd - t);
      let stepT = exp(-sigmaT * stepLength);
      if (sigmaT * stepLength > 2.0e-3) {
        let cheap = (1.0 - T) >= P.steps.w;
        let reuse = min(fineStep * 3.0, max(20.0, P.spShape.y * P.spShape.w * 0.03));
        if (abs(t - shadowAt) >= reuse || abs(s.sigma - shadowDensity) > 0.08 * procSigmaRef() || cheap != shadowCheap) {
          shadowTau = 0.0; nearTau = 0.0;
          for (var k = 1u; k < 8u; k++) {
            if (k >= taps) { break; }
            let o = tapOff[k];
            let ls = procSample(p + o.xyz, t, max(footprint, length(o.xyz) * 0.1), !cheap, jitter);
            let tau = ls.sigma * densityScale * o.w;
            shadowTau += tau;
            if (k == 1u) { nearTau = tau; }
            if (shadowTau >= 32.0) { break; }
          }
          // Far taps (X1, after HZD s83's last light sample "far away to capture shadows cast by distant clouds"; Takram covers this range with
          // its beer shadow map): the cone taps end about 1 km out, but toward a low sun the path to the top of the clouds is many km. Up to
          // PROC_FAR_TAPS cheap samples, geometrically spaced from the cone's end to where the sun ray leaves the shell (at most PROC_FAR_REACH).
          let coneEnd = tapOff[taps - 1u].w * 0.5 + length(tapOff[taps - 1u].xyz);
          let toTop = (P.shell.y - procAltitude(p)) / max(L.y, 0.01);
          let reach = min(toTop, PROC_FAR_REACH);
          if (reach > coneEnd * 1.2 && shadowTau < 32.0) {
            let ratio = pow(reach / coneEnd, 1.0 / f32(PROC_FAR_TAPS));
            var a = coneEnd;
            for (var k = 0u; k < PROC_FAR_TAPS; k++) {
              let b = a * ratio;
              let d = sqrt(a * b);
              shadowTau += procSample(p + L * d, t, max(footprint, d * 0.1), false, jitter).sigma * densityScale * (b - a);
              a = b;
            }
          }
          let up0 = procSample(p + vec3(0.0, 125.0, 0.0), t, footprint * 2.0 + 10.0, false, jitter).sigma;
          let up1 = procSample(p + vec3(0.0, 600.0, 0.0), t, footprint * 2.0 + 60.0, false, jitter).sigma;
          skyTau = (up0 * 250.0 + up1 * 700.0) * densityScale;
          shadowAt = t; shadowDensity = s.sigma; shadowCheap = cheap;
        }
        let tauLocal = sigmaT * 25.0;
        let tau = tauLocal + shadowTau * P.misc.y;
        let microOcc = exp(-frame.microShadow * (tauLocal + nearTau));
        // In-scatter probability (our lighting's 'profile'): rises with the depth below the surface over profileDepth metres, as the sky layer's
        // PACK_FIT ramp; the coarse (dimensional) density bounds it (NE p.54, p.59).
        let profile = min(pow(saturate(s.depth / max(P.misc.w, 1.0)), 1.05), s.coarse);
        var lit: vec3<f32>;
        if (P.lit.x > 0.5) { lit = procTakramLight(tau, cosSun, saturate(s.h), sigmaT, procSunRadiance(p), ambientUp, ambientDown); }
        else { lit = cloudInScatterMicro(max(profile, 1.0 / 255.0), -s.depth, saturate(s.h), tau, skyTau, phase, sunRelax, procSunRadiance(p), ambientUp, ambientDown, envUp, envDown, microOcc); }
        let w = T * (1.0 - stepT);
        color += lit * w;
        depthSum += t * w; depthSqSum += t * t * w; weightSum += w;
        depthMax = max(depthMax, s.depth);
        if (firstHit < 0.0) { firstHit = t; firstProfile = profile; }
      }
      T *= stepT;
      accumulated += sigmaT * stepLength;
      t += stepLength;
    }
    if (T < SKY.steps.w) { color /= max(1.0 - T, 0.5); T = 0.0; }
    if (P.lit.x < 0.5) { color *= cloudEdgeFactor(depthMax, frontness); }
    let dbg = u32(P.misc.z);
    if (dbg != 0u) {
      let k = max(ambientUp.x + ambientUp.y + ambientUp.z, 1e-3);
      var c = vec3(0.0);
      if (dbg == 1u) { c = heat(f32(steps) / P.steps.y); }
      else if (dbg == 2u) { c = select(vec3(0.0, 0.0, 0.3), heat(firstHit / 30000.0), firstHit >= 0.0); }
      else if (dbg == 3u) { c = heat(firstProfile); }
      color = c * k; T = select(1.0, 0.0, firstHit >= 0.0 || dbg == 1u);
    }
  }
  let mean = select(0.0, depthSum / max(weightSum, 1e-6), weightSum > 1e-3);
${atm ? `  if (mean > 0.0 && frame.lightDebug < 0.5 && P.misc.z < 0.5) {
    color = applyHorizonHaze(applyAerialPerspective(color, T, dir, mean), T, origin, dir, mean, frame.haze);
  }` : ''}
  color = clamp(color, vec3(0.0), vec3(${MARCH_RADIANCE_LIMIT}.0));
  textureStore(skyColorOut, px, vec4(color, T));
  textureStore(skyBackOut, px, vec4(0.0, 0.0, 0.0, 1.0));
  var spread = 0.0;
  if (weightSum > 1e-3) { spread = sqrt(max(depthSqSum / weightSum - mean * mean, 0.0)); }
  textureStore(skyDepthOut, px, vec4(mean, sceneEnd, mean, spread));
}
`;
}
