import { atmosphereWgsl } from '../shaders/atmosphere.wgsl';
import { FRAME_WGSL } from '../shaders/frame.wgsl';
import { LIGHTING_WGSL } from '../shaders/lighting.wgsl';
import { MARCH_ATMOSPHERE_GROUP, MARCH_RADIANCE_LIMIT, SKY_LIGHT_ENTRIES, SUN_HEIGHT_WGSL } from '../shaders/march.wgsl';
import { SKY_BACK_BINDING, SKY_BLUE_NOISE_BINDING, SKY_COLOR_BINDING, SKY_DEPTH_BINDING, SKY_LIGHT_STORAGE_BINDING, SKY_PARAMS_BINDING, SKY_PARAMS_WGSL, SKY_SAMPLER_BINDING, SKY_VOXEL_DEPTH_BINDING, SKY_WEATHER_BINDING, SKY_JITTER_WGSL } from '../shaders/sky-layer.wgsl';
import { PROC_PARAMS_WGSL } from './density.wgsl';
import { procShaperBindingsWgsl, procShaperWgsl } from './hzd/shaper.wgsl';
import type { ProceduralShaper } from './settings';

/** Extra group-1 bindings of the procedural trace (after the sky layer's 0..8). */
export const PROC_BINDINGS = { params: 9, noiseA: 10, noiseB: 11, weather: 12, aux: 13, sampler: 14, lut: 17 } as const;

/**
 * X1: the procedural trace. It replaces the sky layer's trace pass when CloudSettings.densityModel is 'procedural' or 'hybrid' and writes the same
 * targets (front colour, depth, back colour), so the sky layer's temporal resolve (1/16 pixels per frame, SKY_RESOLVE_WGSL), the composite and the
 * haze are shared. It covers everything from the camera to the horizon.
 * X3 hybrid: the voxel march runs too. Each layer pixel reads the voxel cloud's mean distance from the march's histories (the nearest over the output
 * pixels it covers, near and far pass) and splits its samples there: in front of the voxel cloud into the front part, behind it into the back part,
 * so the composite's front-over-voxel-over-back merge orders them. Where both have density they add (a union). The light taps also integrate the
 * voxel field (P.hybrid.y), so a hero shades the procedural cloud next to and below it; P.hybrid.x > 0 fades the procedural density out inside
 * the voxel box (a generated voxel field then replaces it there). With no voxel cloud on a pixel (or in the 'procedural' mode, where the march
 * is off) the split is at infinity and everything is the front part.
 *
 * The march is Sky Pro's (sky-pro clouds.wgsl, via tidewater/src/sky/SkyProClouds.js scMarch; MIT, DRG Software Solutions LLC, used with the
 * author's permission): a spherical shell interval, coarse steps of 4x the fine step until a cloud is found, a step back, fine steps sized by the
 * pixel cone and shortened at the surface (0.5 / sigma), back to coarse after four empty steps; the Sky Pro shaper also skips whole empty weather
 * cells (64^2 maxima). This is HZD's cheap-to-full march (s75-80) with NE p.39's distance-growing step.
 * Light: Sky Pro's cone of light taps toward the sun (HZD s83: six cone samples, the last far away), 25 m * 1.7^i, the cheap density once the
 * ray is half opaque (HZD s84), reused while the density stays similar; two cheap taps straight up for the ambient optical depth. The radiance
 * is one of the two lighting models in LIGHTING_WGSL (X3, P.lit.x): 'octave' (cloudOctaveLight, the default here: Frostbite / Takram octaves)
 * or 'nubis' (cloudInScatterMicro: the N3 body, deep octaves, ambient pair, with proxies for the SDF depth and the in-scatter profile). Both
 * take the C1 low-sun handoff, the sun evaluated at the sample's altitude (sunRadianceAt: per-altitude colour and the earth's shadow), and our
 * aerial perspective and C2 haze applied at the opacity-weighted mean distance (NE p.187), per part, as the voxel march and the sky layer do.
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
@group(1) @binding(${SKY_VOXEL_DEPTH_BINDING}) var voxNearDepth: texture_2d<u32>;
@group(1) @binding(${SKY_VOXEL_DEPTH_BINDING + 1}) var voxFarDepth: texture_2d<u32>;
@group(1) @binding(${SKY_BLUE_NOISE_BINDING}) var<storage, read> skyBlueNoise: array<u32, 4096>;
${SKY_JITTER_WGSL}
${atm ? atmosphereWgsl(MARCH_ATMOSPHERE_GROUP) : ''}
${LIGHTING_WGSL}
${PROC_PARAMS_WGSL}
${procShaperBindingsWgsl(shaper, 1, B.params)}
${procShaperWgsl(shaper)}

// X3 hybrid: the nearest voxel cloud distance (march depth word x, 0 = no cloud) over the pass texels this layer pixel covers (at most 4 x 4).
fn procVoxelMin(tex: texture_2d<u32>, rect: vec2<f32>, uv0: vec2<f32>, uv1: vec2<f32>) -> f32 {
  let hiTex = vec2<i32>(rect) - vec2<i32>(1);
  let lo = clamp(vec2<i32>(floor(uv0 * rect)), vec2<i32>(0), hiTex);
  let hi = min(min(vec2<i32>(ceil(uv1 * rect)) - vec2<i32>(1), lo + vec2<i32>(3)), hiTex);
  var m = FAR_T;
  for (var y = lo.y; y <= hi.y; y++) {
    for (var x = lo.x; x <= hi.x; x++) {
      let d = depthWordX(textureLoad(tex, vec2<i32>(x, y), 0).x);
      if (d > 0.0) { m = min(m, d); }
    }
  }
  return m;
}
fn procVoxelSplit(px: vec2<i32>) -> f32 {
  let uv0 = vec2<f32>(px) / frame.renderSize;
  let uv1 = vec2<f32>(px + vec2<i32>(1)) / frame.renderSize;
  var m = procVoxelMin(voxFarDepth, frame.rects.zw, uv0, uv1);
  if (frame.splitDistance > 0.0) { m = min(m, procVoxelMin(voxNearDepth, frame.rects.xy, uv0, uv1)); }
  return m;
}
// X3 hybrid: the voxel field's cheap density (profile * scale, as the dome and the flash use it) as extinction, for the light taps.
fn procVoxelSigma(q: vec3<f32>) -> f32 {
  if (P.hybrid.y < 0.5 || !insideVolume(q)) { return 0.0; }
  let m = sampleModeling(q, 0.0);
  return m.x * m.z * frame.extinction;
}

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
// One premultiplied part (in front of the voxel cloud, or behind it) and its opacity-weighted distance moments.
struct ProcPart { rad: vec3<f32>, T: f32, depthSum: f32, depthSqSum: f32, weightSum: f32 }
fn procPartInit() -> ProcPart { return ProcPart(vec3(0.0), 1.0, 0.0, 0.0, 0.0); }
fn procPartAdd(part: ptr<function, ProcPart>, lit: vec3<f32>, t: f32, stepT: f32) {
  let w = (*part).T * (1.0 - stepT);
  (*part).rad += lit * w; (*part).depthSum += t * w; (*part).depthSqSum += t * t * w; (*part).weightSum += w;
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
  if (SKY.converged.x > 0.5) { px.y += i32(SKY.convergedKeep.y); }   // P0.5: this frame's band of rows
  if (any(vec2<f32>(px) >= frame.renderSize)) { return; }
  let uv = (vec2<f32>(px) + 0.5) / frame.renderSize;
  let sceneEnd = skySceneEnd(px, uv);
  let origin = frame.cameraPos;
  // Sub-pixel jitter per cycle (as the sky layer, P7-E): the history converges to the pixel's average.
  let cycle = u32(SKY.temporal.y);
  let subPx = skySubPixel(px, cycle);   // S2: span and per-pixel rotation from sky.subPixelSpan / subPixelRotate
  let dir = normalize(unprojectDepth((vec2<f32>(px) + 0.5 + subPx) / frame.renderSize, 1.0) - origin);
  // Cone angles (Sky Pro): one layer pixel for the step, one output pixel for the texture LOD.
  let dirY = normalize(unprojectDepth((vec2<f32>(px) + vec2(0.5, 1.5)) / frame.renderSize, 1.0) - origin);
  let stepConeAngle = length(dirY - normalize(unprojectDepth(uv, 1.0) - origin));
  // S2: SKY.resolveOpts.w moves the texture LOD from the output pixel (0, the pre-S2 cone) toward the layer pixel (1): at the reduced render levels a
  // layer pixel is 2-4 output pixels and the upscaler gets no jitter, so noise read at the output pixel's LOD aliases in the layer (a fixed moire).
  let pixelConeAngle = stepConeAngle * pow(frame.renderSize.y / frame.outputSize.y, 1.0 - saturate(SKY.resolveOpts.w));
  let interval = procCloudInterval(dir, origin.y);
  let tEnd = min(interval.y, sceneEnd);

  // X3: front = in front of the voxel cloud, back = behind it (see the hybrid note above). The split is the pixel's, not the jittered ray's.
  let tSplit = procVoxelSplit(px);
  var front = procPartInit();
  var back = procPartInit();
  var T = 1.0;
  var depthMax = 0.0;
  var steps = 0u; var firstHit = -1.0; var firstProfile = 0.0; var firstCrisp = 0.0;
  if (tEnd > interval.x) {
    let jitter = skyJitter(px, cycle);   // S2: IGN or blue noise (sky.jitterNoise)
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
    // P0.5 converged march (SKY.converged.x > 0, runtime settings.converged): every step length (fine, coarse, the surface step, the start offset) is
    // divided by cvDiv, the coarse search returns after as many metres of empty fine steps as before, the step budget is raised to match (times
    // SKY.converged.y), the light taps are recomputed at every lit step and no thin segment skips the light. Off, every expression is the normal one.
    let cv = SKY.converged.x > 0.5;
    let cvDiv = select(1.0, SKY.converged.x, cv);
    var t = interval.x + jitter * select(P.steps.x, P.steps.x / cvDiv, cv);
    var coarse = true; var emptyRun = 0u; var accumulated = 0.0; var refineEnd = -1.0;
    var cellEnd = -1.0; var cellStart = -1.0; var cellData = vec4(1.0);
    let boundsMode = procBoundsMode();
    var shadowAt = -1.0e9; var shadowDensity = -1.0; var shadowTau = 0.0; var nearTau = 0.0; var skyTau = 0.0; var shadowCheap = false;
    // S2: the last fine sample that was empty (< 0: none since the last sample inside), for the surface bisection (P.hybrid.w steps).
    var lastEmpty = -1.0;
    var sinceEntry = 99u;   // S2: fine samples since the last bisected cloud entry (99: none)
    let refineSteps = u32(P.hybrid.w + 0.5);
    let maxSteps = select(u32(P.steps.y), u32(P.steps.y * cvDiv * SKY.converged.y), cv);
    let emptyRunMax = select(4u, u32(4.0 * cvDiv + 0.5), cv);
    for (var i = 0u; i < maxSteps; i++) {
      if (t >= tEnd || T < SKY.steps.w) { break; }
      steps++;
      if (coarse && PROC_HAS_BOUNDS && boundsMode != 0u) {
        if (t >= cellEnd || t < cellStart) {
          let cell = procBoundsCell(origin, dir, t);
          cellData = cell.data;
          cellStart = t; cellEnd = min(tEnd, t + cell.length);
        }
        if (procCellIsEmpty(t, cellEnd, dir, origin.y, cellData)) {
          if (boundsMode == 1u) { t = cellEnd + 0.05; continue; }
          // PF1 exact walk (HZD): the same coarse strides the march would take through the empty cell, without sampling it. The sample positions
          // after the cell are the ones the unskipped march has. Mode 2 charges each stride to the step budget (the image is the unskipped
          // march's); mode 3 does not (the ray can reach further past the budget).
          var strides = 0u;
          loop {
            let stride = max(P.steps.x, t * stepConeAngle * 1.5) * 4.0;
            t += select(stride, stride / cvDiv, cv);
            strides++;
            if (t >= cellEnd || t >= tEnd) { break; }
          }
          if (boundsMode == 2u) { i += strides - 1u; }
          continue;
        }
      }
      let footprint = t * pixelConeAngle;
      let fineStep0 = max(P.steps.x, t * stepConeAngle * 1.5);
      let fineStep = select(fineStep0, fineStep0 / cvDiv, cv);
      var p = origin + dir * t;
      if (coarse) {
        let c = procSample(p, t, footprint, true, jitter);
        if (c.sigma > 0.0) {
          refineEnd = t;
          t = max(interval.x, t - fineStep * 4.0) + fineStep;
          t = min(t, refineEnd);
          coarse = false; emptyRun = 0u; lastEmpty = -1.0;
          continue;
        }
        t += fineStep * 4.0;
        continue;
      }
      var s = procSample(p, t, footprint, true, jitter);
      if (s.sigma <= 0.0) {
        shadowAt = -1.0e9;
        lastEmpty = t;
        emptyRun++;
        if (t < refineEnd) { t = min(t + fineStep, refineEnd); continue; }
        if (emptyRun >= emptyRunMax) { coarse = true; }
        t += select(fineStep, fineStep * 4.0, coarse);
        continue;
      }
      // S2: entering a cloud from an empty fine sample: halve the gap refineSteps times and start at the first point found inside, so the first sample
      // sits within a fraction of the step under the surface wherever the jitter put the step grid (else a hard lit face takes the colour of a point
      // up to a step deep, set by the per-pixel jitter: S1's hatch).
      // P.spWind.w (surfaceRefineTau): only where the entry is that hard (the fine step at the first sample's density at least that optically thick).
      if (refineSteps > 0u && lastEmpty >= 0.0 && lastEmpty < t && s.sigma * densityScale * fineStep > P.spWind.w) {
        var lo = lastEmpty; var hi = t;
        for (var k = 0u; k < refineSteps; k++) {
          let m = 0.5 * (lo + hi);
          let sm = procSample(origin + dir * m, m, m * pixelConeAngle, true, jitter);
          if (sm.sigma > 0.0) { hi = m; if (P.spHorizon.w < 0.5) { s = sm; } } else { lo = m; }
        }
        t = hi; p = origin + dir * t;
        sinceEntry = 0u;
      }
      lastEmpty = -1.0;
      emptyRun = 0u; refineEnd = -1.0;
      let fade = 1.0 - smoothstep(fadeStart, P.shell.z, t);
      let sigmaT = s.sigma * densityScale * fade * procCarve(p);
      let surfaceTarget = 0.5 / max(sigmaT, 0.000001);
      var surfaceStep = clamp(select(surfaceTarget, surfaceTarget / cvDiv, cv), fineStep * 0.15, fineStep);
      // S2: the bisected entry sits where the density has only just begun, so 0.5 / sigma there is a full fine step, which would jump over the surface
      // layer the bisection found (and print the step as contour lines). Grow the step from the surface minimum instead: 0.15, 0.3, 0.6 of a fine step.
      if (sinceEntry < 3u && P.tkTurb.w > 0.5) { surfaceStep = min(surfaceStep, fineStep * 0.15 * f32(1u << sinceEntry)); }
      sinceEntry = min(sinceEntry + 1u, 99u);
      let stepLength = min(mix(surfaceStep, fineStep * 3.0, smoothstep(1.0, 3.0, accumulated)), tEnd - t);
      let stepT = exp(-sigmaT * stepLength);
      if (sigmaT * stepLength > select(2.0e-3, 0.0, cv && (u32(SKY.convergedKeep.x) & 1u) == 0u)) {
        let cheap = (1.0 - T) >= P.steps.w;
        let reuse = min(fineStep * 3.0, max(20.0, P.spShape.y * P.spShape.w * 0.03));
        if ((cv && (u32(SKY.convergedKeep.x) & 2u) == 0u) || abs(t - shadowAt) >= reuse || abs(s.sigma - shadowDensity) > 0.08 * procSigmaRef() || cheap != shadowCheap) {
          shadowTau = 0.0; nearTau = 0.0;
          // P1.3a: the early stop (P.wind.w, lightTauCap; 32 for nubis/octave, none for fit: its 1 / (1 + K tau) ms still tells 32 from 100).
          let tauCap = P.wind.w;
          for (var k = 1u; k < 8u; k++) {
            if (k >= taps) { break; }
            let o = tapOff[k];
            let q = p + o.xyz;
            let ls = procSample(q, t, max(footprint, length(o.xyz) * 0.1), !cheap, jitter);
            let tau = (ls.sigma * densityScale * procCarve(q) + procVoxelSigma(q)) * o.w;
            shadowTau += tau;
            if (k == 1u) { nearTau = tau; }
            if (shadowTau >= tauCap) { break; }
          }
          // Far taps (X1, after HZD s83's last light sample "far away to capture shadows cast by distant clouds"; Takram covers this range with
          // its beer shadow map): the cone taps end about 1 km out, but toward a low sun the path to the top of the clouds is many km. Up to
          // PROC_FAR_TAPS cheap samples, geometrically spaced from the cone's end to where the sun ray leaves the shell (at most PROC_FAR_REACH).
          let coneEnd = tapOff[taps - 1u].w * 0.5 + length(tapOff[taps - 1u].xyz);
          let toTop = (P.shell.y - procAltitude(p)) / max(L.y, 0.01);
          let reach = min(toTop, PROC_FAR_REACH);
          if (reach > coneEnd * 1.2 && shadowTau < tauCap) {
            let ratio = pow(reach / coneEnd, 1.0 / f32(PROC_FAR_TAPS));
            var a = coneEnd;
            for (var k = 0u; k < PROC_FAR_TAPS; k++) {
              let b = a * ratio;
              let d = sqrt(a * b);
              let q = p + L * d;
              shadowTau += (procSample(q, t, max(footprint, d * 0.1), false, jitter).sigma * densityScale * procCarve(q) + procVoxelSigma(q)) * (b - a);
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
        var profile = min(pow(saturate(s.depth / max(P.misc.w, 1.0)), 1.05), s.coarse);
        var litDepth = s.depth;
        // C1 (HZD lightProfile 'exact'): the analytic dimensional profile and depth in cloud; samples without one (sheets, fractus) keep the stand-in.
        if (P.lit.w > 0.5 && s.prof > 0.0) { profile = saturate(s.prof); litDepth = s.depthX; }
        var lit: vec3<f32>;
        // P1.2d (P.lit.x = 2, lightingModel 'fit'): the voxel march's fitted model with this trace's tau and skyTau; nothing else applied.
        if (P.lit.x > 1.5) { lit = cloudFitLight(tau, skyTau, cosSun, procSunRadiance(p), ambientUp, ambientDown); }
        else if (P.lit.x > 0.5) { lit = cloudOctaveLight(tau, cosSun, saturate(s.h), sigmaT, procSunRadiance(p), ambientUp, ambientDown, envUp, envDown, vec4(P.octave.xyz, P.lit.y), vec4(P.octave.w, P.lit.z, 0.0, 0.0)); }
        else { lit = cloudInScatterMicro(max(profile, 1.0 / 255.0), -litDepth, saturate(s.h), tau, skyTau, phase, sunRelax, procSunRadiance(p), ambientUp, ambientDown, envUp, envDown, microOcc); }
        // STORM1 internal lightning: the flash envelope at this point times the storm weight, relative to the scene's light (sun share + sky).
        // STORM1 dark storm: the light inside the storm is dimmed by stormDark, most at the column and the anvil's underside (h < 0.8).
        if (s.storm > 0.0 && P.hzStorm4.y > 0.0) { lit *= 1.0 - P.hzStorm4.y * s.storm * (0.25 + 0.6 * (1.0 - smoothstep(0.1, 0.8, s.h))); }
        if (s.glow > 0.0) {
          let fl = procFlash(p, frame.time);
          if (fl > 0.0) { lit += vec3(0.8, 0.88, 1.0) * (s.glow * fl * (0.25 * dot(procSunRadiance(p), vec3(0.3, 0.6, 0.1)) + dot(ambientUp, vec3(0.3, 0.6, 0.1)))); }
        }
        if (t < tSplit) { procPartAdd(&front, lit, t, stepT); } else { procPartAdd(&back, lit, t, stepT); }
        depthMax = max(depthMax, s.depth);
        if (firstHit < 0.0) { firstHit = t; firstProfile = profile; firstCrisp = s.dbg; }
        // P2.5c: view 5 shows the first sample the edge character reached (the veil's samples come first on most rays: magenta only if no other).
        if (s.dbg > 0.9 && firstCrisp <= 0.9) { firstCrisp = s.dbg; }
      }
      if (t < tSplit) { front.T *= stepT; } else { back.T *= stepT; }
      T = front.T * back.T;
      accumulated += sigmaT * stepLength;
      t += stepLength;
    }
    // Hit the cutoff: close the part being marched; the remaining light continues as the mean colour of what it accumulated (as the sky layer).
    if (T < SKY.steps.w) {
      if (t >= tSplit) { back.rad /= max(1.0 - back.T, 0.5); back.T = 0.0; } else { front.rad /= max(1.0 - front.T, 0.5); front.T = 0.0; }
    }
    if (P.lit.x < 0.5) { let e = cloudEdgeFactor(depthMax, frontness); front.rad *= e; back.rad *= e; }
    let dbg = u32(P.misc.z);
    if (dbg != 0u) {
      let k = max(ambientUp.x + ambientUp.y + ambientUp.z, 1e-3);
      var c = vec3(0.0);
      if (dbg == 1u) { c = heat(f32(steps) / P.steps.y); }
      else if (dbg == 2u) { c = select(vec3(0.0, 0.0, 0.3), heat(firstHit / 30000.0), firstHit >= 0.0); }
      else if (dbg == 3u) { c = heat(firstProfile); }
      // P2.5c: the HZD edge crispness c at the first lit sample it reached (heat 0 blue .. 1 red); else the first lit sample's kind: magenta =
      // veil-only, black = the main path with the edge character not applied (off, past the detail fade), grey = another path (fractus, sheets).
      else if (dbg == 5u) {
        c = vec3(0.35);
        if (firstCrisp > 0.9) { c = heat(firstCrisp - 1.0); } else if (firstCrisp > 0.4) { c = vec3(0.0); } else if (firstCrisp > 0.1) { c = vec3(0.8, 0.0, 0.8); }
      }
      else if (dbg == 4u) { c = select(vec3(0.0, 0.0, 0.3), heat(tSplit / 10000.0), tSplit < FAR_T); }
      front.rad = c * k; front.T = select(1.0, 0.0, firstHit >= 0.0 || dbg == 1u || (dbg == 4u && tSplit < FAR_T));
      back = procPartInit();
    }
  }
  let meanFront = select(0.0, front.depthSum / max(front.weightSum, 1e-6), front.weightSum > 1e-3);
  let meanBack = select(0.0, back.depthSum / max(back.weightSum, 1e-6), back.weightSum > 1e-3);
${atm ? `  if (frame.lightDebug < 0.5 && P.misc.z < 0.5) {
    if (meanFront > 0.0) { front.rad = applyHorizonHaze(applyAerialPerspective(front.rad, front.T, dir, meanFront), front.T, origin, dir, meanFront, frame.haze); }
    if (meanBack > 0.0) { back.rad = applyHorizonHaze(applyAerialPerspective(back.rad, back.T, dir, meanBack), back.T, origin, dir, meanBack, frame.haze); }
  }` : ''}
  textureStore(skyColorOut, px, vec4(clamp(front.rad, vec3(0.0), vec3(${MARCH_RADIANCE_LIMIT}.0)), front.T));
  textureStore(skyBackOut, px, vec4(clamp(back.rad, vec3(0.0), vec3(${MARCH_RADIANCE_LIMIT}.0)), back.T));
  // The whole ray's opacity distribution (mean and spread over both parts), as the sky layer writes it (C2).
  let wAll = front.weightSum + back.weightSum;
  var meanAll = 0.0;
  var spread = 0.0;
  if (wAll > 1e-3) {
    meanAll = (front.depthSum + back.depthSum) / wAll;
    spread = sqrt(max((front.depthSqSum + back.depthSqSum) / wAll - meanAll * meanAll, 0.0));
  }
  textureStore(skyDepthOut, px, vec4(select(meanBack, meanFront, meanFront > 0.0), sceneEnd, meanAll, spread));
}
`;
}
