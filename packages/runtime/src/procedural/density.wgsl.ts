/**
 * X1 procedural density: the per-sample cloud models of Sky Pro and of the HZD 2015 lineage (as Takram implements it), evaluated in our
 * renderer with our lighting. One shaper is compiled per pipeline (`PROC_SHAPER`). Both return a ProcSample:
 *   sigma    extinction (1/m), scattering = extinction (albedo 1)
 *   coarse   the density before the detail erosion, 0..1: the "dimensional profile" of Nubis Evolved (NE p.29, p.34), which NE p.54 and p.59
 *            use for the multiple-scattering volume and the ambient occlusion of the vertical-profile model
 *   depth    metres below the cloud surface (a proxy; the voxel path has an SDF, a per-sample model does not)
 *   h        height fraction in the cloud (column or layer), for the ambient gradient (HZD s88, Frostbite H16 p.35)
 *
 * The 'skypro' shaper is ported from Sky Pro (sky-pro-webgpu density.wgsl, via tidewater/src/sky/SkyProClouds.js; MIT, Copyright (c) 2026
 * DRG Software Solutions LLC, used with the author's permission; see procedural/NOTICE.md). Its model, in the terms of our papers:
 *   - a 2D coverage weather map (HZD s39-41, N17 p.52-58) from a periodic Perlin fbm (main mass + detail octaves);
 *   - coverage as inflation (N17 p.40-44): the column top in shell fractions is weather + coverage - 1 + dilation * coverage, where the
 *     dilation is a weighted sum of the 64^3 Perlin-Worley noise's channels (HZD s29: Perlin dilated by Worley);
 *   - flat bases: below baseWeatherHeightEnd a column needs weather >= baseWeatherStrength (HZD s36: the base gradient);
 *   - edge erosion by the same noise at 0.13 of the scale, strength rising from base to top (HZD s37, "always an erosion from the edge", s76),
 *     and the wind-shear lean of the tops (N17 p.45: p += h * wind * 500; here windSkew metres per shell height).
 * The 'takram' shaper is ported from @takram/three-clouds 0.7.6 clouds.glsl (MIT, Shota Matsuda / Takram): HZD 2015's density
 * build in its layered form (one weather channel per layer):
 *   - height gradient per layer: a semicircle on pow(h, bias) (HZD s34 cumulus gradient, "soft at both ends");
 *   - coverage remap (HZD s35-36 SetRange, N17 p.40-44): factor = 1 - coverage * gradient, density = remap(weather, factor, factor + width);
 *   - shape erosion by the 128^3 Perlin-Worley texture: remap(density, (1 - shape) * amount, 1) (HZD s35, NE p.34);
 *   - detail erosion by the 32^3 Worley texture, inverted toward the base for wisps (HZD s37 note), offset by a 2D turbulence texture
 *     (HZD s33/s37 curl distortion), only near the camera (HZD s77-80 cheap-then-expensive);
 *   - a linear density profile, denser at the top (HZD s36: "reduces density at the base").
 * Needs the bindings of procBindingsWgsl (P (ProcParams), procNoiseA/B, procWeather, procAux, procRepeat) and COMMON_WGSL. X3: it reads no
 * Frame uniform (the camera and the wind offset come in ProcParams), so the shadow map and the dome can include it too.
 */
/** Binding offsets from a pass's base binding (the trace uses base 9, after the sky layer's 0..8). */
export const PROC_BINDING_OFFSETS = { params: 0, noiseA: 1, noiseB: 2, weather: 3, aux: 4, sampler: 5 } as const;
export function procBindingsWgsl(group: number, base: number): string {
  const o = PROC_BINDING_OFFSETS;
  return /* wgsl */ `
@group(${group}) @binding(${base + o.params}) var<uniform> P: ProcParams;
@group(${group}) @binding(${base + o.noiseA}) var procNoiseA: texture_3d<f32>;
@group(${group}) @binding(${base + o.noiseB}) var procNoiseB: texture_3d<f32>;
@group(${group}) @binding(${base + o.weather}) var procWeather: texture_2d<f32>;
@group(${group}) @binding(${base + o.aux}) var procAux: texture_2d<f32>;
@group(${group}) @binding(${base + o.sampler}) var procRepeat: sampler;
`;
}
export const PROC_PARAMS_WGSL = /* wgsl */ `
struct ProcParams {
  shell: vec4<f32>,      // min y, max y (m), max distance, coverage
  steps: vec4<f32>,      // fine step floor (m), max steps, light taps, full-lighting opacity
  wind: vec4<f32>,       // 0, 0, evolution (m), 0
  misc: vec4<f32>,       // density scale, light scale, debug, profile depth (m)
  spShell: vec4<f32>,    // Sky Pro: altitude, thickness, density (1/m), coverage
  spShape: vec4<f32>,    // weather scale, base scale, base strength, erosion scale multiplier
  spErosion: vec4<f32>,  // erosion strength base, peak, shape, base weather height end
  spBase: vec4<f32>,     // base weather strength, edge softness, edge falloff (log2 * thickness km), base weather height start
  spHorizon: vec4<f32>,  // horizon coverage start, ramp, amount, 0
  spWind: vec4<f32>,     // wind direction x, z, skew (m per shell height), 0
  tkMinH: vec4<f32>, tkMaxH: vec4<f32>, tkDensity: vec4<f32>, tkShape: vec4<f32>, tkDetail: vec4<f32>, tkWeatherExp: vec4<f32>,
  tkBias: vec4<f32>, tkFilter: vec4<f32>, tkExpTerm: vec4<f32>, tkExponent: vec4<f32>, tkLinear: vec4<f32>, tkConstant: vec4<f32>,
  tkChannel: vec4<f32>,
  tkRepeat: vec4<f32>,   // weather tile (m), shape repeat (1/m), detail repeat (1/m), turbulence tiles per weather tile
  tkTurb: vec4<f32>,     // turbulence displacement (m), detail distance (m), turbulence on the shape lookup too (0/1; S6 default 0), 0
  lit: vec4<f32>,        // lighting model (0 nubis, 1 octave), powder scale, octave ambient gain, 0
  octave: vec4<f32>,     // octave model: forward g, back g, back-lobe weight, diffusion tail weight
  origin: vec4<f32>,     // camera position (the curvature reference), 0       (written every frame, not part of the model version)
  drift: vec4<f32>,      // wind offset (CloudSettings.windOffset, m), 0         (likewise)
  hybrid: vec4<f32>,     // X3: box carve rim (m; 0 = density union with the voxel box), voxel density in the light taps (0/1); X4: hero shadow strength (light grid), 0
  // H1 HZD shaper (procedural/hzd/shaper.wgsl.ts; packed by settings.ts packProceduralParams)
  hzLayer: vec4<f32>,    // layer bottom, layer top (m), NDF tile (m), extinction (1/m)
  hzScale: vec4<f32>,    // shape tile, detail tile, curl tile (m), curl strength (m)
  hzCov: vec4<f32>,      // coverage bias, type bias, coverage multiply (0/1), erosion law (0 gp7, 1 hag)
  hzFade: vec4<f32>,     // base fade min, base fade height (h), detail distance (m), mip bias
  hzWind: vec4<f32>,     // wind direction x, z, cloud top offset (m), upward bias
  hzSpeed: vec4<f32>,    // NDF drift (fraction of the wind offset, 0 = static), shape speed, detail speed, type blend (0 points, 1 curves)
  hzMisc: vec4<f32>,     // build stage (1..3), H5 cubic shape-read distance (m), H5 density exponent, 0
}
struct ProcSample { sigma: f32, coarse: f32, depth: f32, h: f32 }
const PROC_EARTH_M = 6371000.0;
// Altitude above the flat world's ground with the planet's curvature about the camera (Sky Pro scShellHeight: a parabolic drop avoids
// subtracting two 6371 km values in f32).
fn procAltitude(p: vec3<f32>) -> f32 {
  let d = p.xz - P.origin.xz;
  return p.y + dot(d, d) / (2.0 * PROC_EARTH_M);
}
// X3 hybrid (needs volumeWgsl's cloudVolume): 1 outside the voxel box, falling to 0 over P.hybrid.x metres inside its walls (0 = union: always 1).
fn procCarve(p: vec3<f32>) -> f32 {
  if (P.hybrid.x <= 0.0) { return 1.0; }
  let lo = p - cloudVolume.minCorner;
  let hi = cloudVolume.minCorner + cloudVolume.extent - p;
  let inside = min(min(min(lo.x, hi.x), min(lo.y, hi.y)), min(lo.z, hi.z));
  return 1.0 - smoothstep(0.0, P.hybrid.x, inside);
}
`;

/** Sky Pro's density (SkyProClouds.js CORE_WGSL scCandidate / scErodedDensity / scConeLod), renamed to the proc* namespace. */
export const PROC_SKYPRO_WGSL = /* wgsl */ `
struct ProcCandidate { conservative: f32, edge: f32, top: f32, floorMask: f32, shellHeight: f32, localHeight: f32, coverage: f32, position: vec3<f32> }
fn procConeLod(footprint: f32, scale: f32) -> f32 { return max(0.0, log2(max(footprint * 64.0 / scale, 1.0))); }
fn procShellHeight(p: vec3<f32>) -> f32 { return (procAltitude(p) - P.spShell.x) / P.spShell.y; }
fn procWeatherAt(p: vec3<f32>) -> f32 {
  return textureSampleLevel(procWeather, procRepeat, (p.xz - P.drift.xz) / P.spShape.x, 0.0).r;
}
fn procCandidate(p: vec3<f32>, coverage: f32, lod: f32) -> ProcCandidate {
  let h = procShellHeight(p);
  var r: ProcCandidate;
  r.conservative = 0.0; r.edge = 0.0; r.top = 0.0; r.floorMask = 0.0; r.shellHeight = h; r.localHeight = 0.0; r.coverage = coverage; r.position = p;
  if (h < -0.1 || h > 1.3 || coverage <= 0.0) { return r; }
  let wd = P.spWind.xy;
  let shapePosition = p - vec3(P.drift.x, 0.0, P.drift.z) - vec3(wd.x, 0.0, wd.y) * (P.spWind.z * max(h, 0.0) - P.wind.z);
  let weather = procWeatherAt(p);
  let edge = max(P.spBase.y * exp2(-max(h, 0.0) * P.spBase.z), 0.0001);
  // an all-one noise sample bounds the top dilation; a failed bound avoids the volume fetch
  let maximumTop = weather + coverage - 1.0 + 1.34 * P.spShape.z * coverage;
  if (maximumTop < h - edge) { return r; }
  let required = (1.0 - smoothstep(P.spBase.w, max(P.spErosion.w, P.spBase.w + 0.001), h)) * P.spBase.x;
  let floorMask = smoothstep(required - 0.1, required, weather);
  if (floorMask <= 0.0) { return r; }
  let baseSample = textureSampleLevel(procNoiseA, procRepeat, shapePosition / P.spShape.y, lod).rgb;
  let dilation = dot(baseSample, vec3(0.7, 0.41, 0.23)) * P.spShape.z;
  let top = weather + coverage - 1.0 + dilation * coverage;
  r.conservative = smoothstep(-edge, edge, top - h) * smoothstep(-edge, edge, h) * floorMask;
  r.edge = edge; r.top = top; r.floorMask = floorMask;
  r.localHeight = clamp(h / max(top, 0.001), 0.0, 1.0);
  r.position = shapePosition;
  return r;
}
// Returns the eroded density (x) and the erosion (y, shell fractions) so the caller can measure the depth below the eroded surface.
fn procErodedDensity(c: ProcCandidate, lod: f32) -> vec2<f32> {
  if (c.conservative <= 0.0) { return vec2(0.0); }
  let strength = mix(P.spErosion.x, P.spErosion.y, c.localHeight);
  let maximumErosion = 0.173 * strength * c.coverage;
  if (min(c.top - c.shellHeight, c.shellHeight) >= maximumErosion + c.edge) { return vec2(c.floorMask, 0.0); }
  let s = textureSampleLevel(procNoiseA, procRepeat, c.position / (P.spShape.y * P.spShape.w), lod).rgb;
  let field = mix(1.0 - s, s, P.spErosion.z);
  let erosion = dot(field, vec3(0.113, 0.04, 0.02)) * strength * c.coverage;
  let d = smoothstep(-c.edge, c.edge, c.top - erosion - c.shellHeight) * smoothstep(-c.edge, c.edge, c.shellHeight - erosion) * c.floorMask;
  return vec2(d, erosion);
}
// Sky Pro's coverage along the ray (scCoverageAt): rises toward the horizon.
fn procCoverageAt(t: f32) -> f32 {
  return P.shell.w + P.spHorizon.z * smoothstep(P.spHorizon.x, P.spHorizon.x + max(P.spHorizon.y, 1.0), t);
}

// full = false: the cheap sample (Sky Pro scLightDensity cheap: the conservative shape only).
fn procSample(p: vec3<f32>, t: f32, footprint: f32, full: bool, jitter: f32) -> ProcSample {
  var o: ProcSample;
  o.sigma = 0.0; o.coarse = 0.0; o.depth = 0.0; o.h = 0.0;
  let cov = procCoverageAt(t);
  let lod = procConeLod(footprint, P.spShape.y);
  let c = procCandidate(p, cov, lod);
  if (c.conservative <= 0.0) { return o; }
  var d = c.conservative;
  var erosion = 0.0;
  if (full) {
    let e = procErodedDensity(c, procConeLod(footprint, P.spShape.y * P.spShape.w));
    d = e.x; erosion = e.y;
  }
  o.sigma = d * P.spShell.z;
  o.coarse = c.conservative;
  // Height-field model: the vertical distance to the eroded top and base surfaces stands in for the depth below the surface.
  o.depth = max(min(c.top - erosion - c.shellHeight, c.shellHeight - erosion), 0.0) * P.spShell.y;
  o.h = c.localHeight;
  return o;
}
// Empty-column test for the coarse march: the weather's maximum over the bounds cell (procAux, 64^2 maxima) cannot reach the ray's heights.
fn procHeightAlongRay(t: f32, dir: vec3<f32>, originHeight: f32) -> f32 {
  let altitude = originHeight + dir.y * t + dot(dir.xz, dir.xz) * t * t / (2.0 * PROC_EARTH_M);
  return (altitude - P.spShell.x) / P.spShell.y;
}
fn procCellIsEmpty(t: f32, end: f32, dir: vec3<f32>, originHeight: f32, maximumWeather: f32) -> bool {
  let turningPoint = -dir.y * PROC_EARTH_M / max(dot(dir.xz, dir.xz), 0.000001);
  let minHeight = procHeightAlongRay(clamp(turningPoint, t, end), dir, originHeight);
  let maxHeight = max(procHeightAlongRay(t, dir, originHeight), procHeightAlongRay(end, dir, originHeight));
  let coverage = procCoverageAt(end);
  let maximumTop = maximumWeather + coverage - 1.0 + 1.34 * P.spShape.z * coverage;
  let edgeHeight = select(maxHeight, minHeight, P.spBase.z >= 0.0);
  let edge = max(P.spBase.y * exp2(-max(edgeHeight, 0.0) * P.spBase.z), 0.0001);
  let required = (1.0 - smoothstep(P.spBase.w, max(P.spErosion.w, P.spBase.w + 0.001), maxHeight)) * P.spBase.x;
  return maximumTop < minHeight - edge || maximumWeather <= required - 0.1;
}
const PROC_HAS_BOUNDS = true;
fn procSigmaRef() -> f32 { return P.spShell.z; }
`;

/** Takram's density (clouds.glsl sampleWeather / sampleMedia), renamed to the proc* namespace. */
export const PROC_TAKRAM_WGSL = /* wgsl */ `
fn procRemap4(x: vec4<f32>, a: vec4<f32>, b: vec4<f32>) -> vec4<f32> { return saturate((x - a) / max(b - a, vec4(1e-6))); }
// HZD s34 / Takram shapeAlteringFunction: a semicircle on pow(h, bias), rounding the clouds toward the top.
fn procShapeAltering(h: vec4<f32>, bias: vec4<f32>) -> vec4<f32> {
  let x = clamp(pow(h, bias) * 2.0 - 1.0, vec4(-1.0), vec4(1.0));
  return 1.0 - x * x;
}
fn procWeatherChannels(uv: vec2<f32>) -> vec4<f32> {
  let w = textureSampleLevel(procWeather, procRepeat, uv, 0.0);
  let c = vec4<u32>(P.tkChannel);
  return vec4(w[c.x], w[c.y], w[c.z], w[c.w]);
}
struct ProcWeather { hf: vec4<f32>, density: vec4<f32> }
fn procWeatherSample(p: vec3<f32>, alt: f32) -> ProcWeather {
  var o: ProcWeather;
  o.hf = procRemap4(vec4(alt), P.tkMinH, P.tkMaxH);
  let uv = (p.xz - P.drift.xz) / P.tkRepeat.x;
  let local = pow(procWeatherChannels(uv), P.tkWeatherExp);
  let heightScale = procShapeAltering(o.hf, P.tkBias);
  // Coverage as inflation (N17 p.40-44; Takram after Skybolt's Clouds.h): the threshold falls as coverage x height gradient rises.
  let factor = 1.0 - P.shell.w * heightScale;
  o.density = procRemap4(mix(local, vec4(1.0), P.tkFilter), factor, factor + P.tkFilter);
  // Layers with no density scale (unused lanes) never contribute.
  o.density = select(vec4(0.0), o.density, P.tkDensity > vec4(0.0));
  return o;
}
fn procLayerDensity(h: vec4<f32>) -> vec4<f32> {
  return P.tkExpTerm * exp(P.tkExponent * h) + P.tkLinear * h + P.tkConstant;
}
fn procSample(p: vec3<f32>, t: f32, footprint: f32, full: bool, jitter: f32) -> ProcSample {
  var o: ProcSample;
  o.sigma = 0.0; o.coarse = 0.0; o.depth = 0.0; o.h = 0.0;
  let alt = procAltitude(p);
  let w = procWeatherSample(p, alt);
  if (!any(w.density > vec4(1e-5))) { return o; }
  var density = w.density;
  let uv = (p.xz - P.drift.xz) / P.tkRepeat.x;
  let turb = P.tkTurb.x * (textureSampleLevel(procAux, procRepeat, uv * P.tkRepeat.w, 0.0).rgb * 2.0 - 1.0) * dot(density, procRemap4(w.hf, vec4(0.3), vec4(0.0)));
  let wp = vec3(p.x - P.drift.x, alt, p.z - P.drift.z);
  // S6 (H1): the turbulence displaces the detail lookup only (hzd15 s37, gp7 p.108); displacing the shape lookup too (Takram's original,
  // tkTurb.z = 1) tears the silhouettes.
  let shape = textureSampleLevel(procNoiseA, procRepeat, (wp + turb * P.tkTurb.z) * P.tkRepeat.y, 0.0).r;
  density = procRemap4(density, vec4(1.0 - shape) * P.tkShape, vec4(1.0));
  let coarse = density;
  // Detail near the camera (HZD s77-80), jittered across its fade so the switch does not draw a line.
  if (full && t < P.tkTurb.y * (0.75 + 0.5 * jitter)) {
    let detail = textureSampleLevel(procNoiseB, procRepeat, (wp + turb) * P.tkRepeat.z, 0.0).r;
    // Fluffy at the top and whippy at the bottom (HZD s37 note: invert the Worley at the base).
    var modifier = mix(vec4(pow(detail, 6.0)), vec4(1.0 - detail), procRemap4(w.hf, vec4(0.2), vec4(0.4)));
    modifier = mix(vec4(0.0), modifier, P.tkDetail);
    density = procRemap4(density * 2.0, modifier * 0.5, vec4(1.0));
  }
  let profile = procLayerDensity(w.hf);
  density = saturate(density * P.tkDensity * profile);
  let sum = density.x + density.y + density.z + density.w;
  o.sigma = sum;
  if (sum > 0.0) {
    let wgt = density / sum;
    o.coarse = saturate(dot(coarse, wgt));
    o.h = dot(w.hf, wgt);
    // No surface distance in a per-sample model: the coarse density (the dimensional profile) times the layer height stands in.
    o.depth = o.coarse * dot(P.tkMaxH - P.tkMinH, wgt) * 0.25;
  }
  return o;
}
fn procCellIsEmpty(t: f32, end: f32, dir: vec3<f32>, originHeight: f32, maximumWeather: f32) -> bool { return false; }
const PROC_HAS_BOUNDS = false;
fn procSigmaRef() -> f32 { return max(max(P.tkDensity.x, P.tkDensity.y), max(P.tkDensity.z, P.tkDensity.w)); }
`;
