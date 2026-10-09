import { COMMON_WGSL } from '../shaders/common.wgsl';
import { FRAME_WGSL } from '../shaders/frame.wgsl';
import { atmosphereWgsl } from '../shaders/atmosphere.wgsl';

export const CIRRUS_PARAM_BYTES = 6 * 16;
export const CIRRUS_ATMOSPHERE_GROUP = 2;

/**
 * P9-E: the high cloud layer (cirrus, cirrostratus) as a 2.5D slab on a planet-curved shell, one pass at the composite's resolution.
 *
 * Density (Nubis Evolved p.65): the type selects among the baked streaky, wispy and round noises (bake.wgsl.ts); coverage is an exponent plus a
 * fade-in; a large-scale, non-tiling coverage field breaks the tile up into patches; the fine fibre channel at 4x frequency modulates it; the
 * cirrostratus veil adds a smooth sheet (the wispy noise read at a coarse mip) with faint fibres.
 *
 * Light (thin ice, single scattering dominated; Dobashi: cirrus "seldom contain self-shadows", so no march): the layer's vertical optical depth
 * tau = density * opticalDepth is converted to the view path through the shell (exact chord through the two spheres, so the layer thickens toward
 * the horizon as it really does) and to the sun path. The sun path's density comes from two taps of the noise toward the sun across the layer
 * (NE p.67: a few samples toward the sun), so at low sun fibres shade their downsun neighbours. Radiance per unit (1 - T):
 *   sun(p) * (phase(cos) * exp(-tauSun) + ms) + ambient,
 * with sun(p) = the atmosphere's transmittance at the layer's altitude and the point's own local up (planet curve), so the layer stays lit, red,
 * after the ground and the low clouds have lost the sun, and the earth's shadow sweeps across it (softened by the sun disc). phase = an ice
 * crystal stand-in (a strong forward HG plus a broad one, optional 22 degree halo). ambient = the sky light pair of the low clouds (skyLight[1]
 * above, [2] below: C1's low-sun environment lean included). Then aerial perspective and the C2 horizon haze at the hit distance, as the sky layer.
 *
 * Output (premultiplied, the composite merges it): rgb = radiance, a = transmittance. For opaque scene pixels nearer than the layer: (0, 0, 0, s),
 * s = the optional ground shadow (1 when off).
 * Bindings (group 1): 0 Frame, 1 scene depth (FRAME_WGSL), 2 output (storage buffer, see store), 3 params, 4 noise tile, 5 its sampler, 6 the sky light buffer.
 * 'uniform' lighting drops the atmosphere group: the sun and ambient come from the sky light buffer only, no aerial perspective.
 */
export function cirrusRenderWgsl(mode: 'atmosphere' | 'uniform'): string {
  const atm = mode === 'atmosphere';
  return /* wgsl */ `
${COMMON_WGSL}
${FRAME_WGSL}
struct CirrusParams {
  layer: vec4<f32>,   // altitude (m), thickness (m), planet radius (m), tile size (m)
  shape: vec4<f32>,   // coverage, type, veil, optical depth at density 1
  wind: vec4<f32>,    // offset x, z (m), cos, sin of the streak direction
  look: vec4<f32>,    // fine detail, coverage variation, ground shadow strength, halo
  fine: vec4<f32>,    // fine-detail offset x, z (m), sun gain, ambient gain
  misc: vec4<f32>,    // forward g, broad g, forward weight, multiple scattering
}
// The output: one texel per composite pixel, row-major at the composite's width, rgba as two pack2x16float words (the composite is at the
// per-stage sampled-texture limit, so it reads a storage buffer).
@group(1) @binding(2) var<storage, read_write> outBuf: array<vec2<u32>>;
fn store(px: vec2<i32>, c: vec4<f32>) { outBuf[u32(px.y) * u32(frame.misc.z) + u32(px.x)] = vec2(pack2x16float(c.xy), pack2x16float(c.zw)); }
@group(1) @binding(3) var<uniform> cp: CirrusParams;
@group(1) @binding(4) var noiseTex: texture_2d<f32>;
@group(1) @binding(5) var noiseSampler: sampler;
@group(1) @binding(6) var<storage, read> skyLight: array<vec4<f32>, 8>;
${atm ? atmosphereWgsl(CIRRUS_ATMOSPHERE_GROUP) : ''}

const CIRRUS_RADIANCE_LIMIT = 60000.0;
const SUN_HALF_ANGLE_COS = 0.0047;
const SUN_PATH_MAX = 3.0;

fn planetCentre() -> vec3<f32> {
  ${atm ? 'if (atmosphere.flatWorld < 0.5) { return atmosphere.planetCenter; }' : ''}
  return vec3(frame.cameraPos.x, -cp.layer.z, frame.cameraPos.z);
}
// Height of p above the planet's surface sphere (oc = p - centre). Flat world: the sphere sits under the camera, so the height is y plus
// the drop of the surface at p's horizontal distance (no |oc| - R of two 6e6 m numbers, which loses metres in f32).
fn altitudeOf(p: vec3<f32>, oc: vec3<f32>) -> f32 {
  ${atm ? 'if (atmosphere.flatWorld < 0.5) { return length(oc) - cp.layer.z; }' : ''}
  let d = p.xz - frame.cameraPos.xz;
  let y = p.y;
  return y + dot(d, d) / (sqrt(dot(d, d) + (y + cp.layer.z) * (y + cp.layer.z)) + y + cp.layer.z);
}
// Ray / sphere at height altS above the surface, from a point at height altO: (t near, t far), or (1, -1) for a miss. Written for f32 with
// radii of 6e6 m: c = |oc|^2 - r^2 from the heights, and the stable root pair (q, c / q).
fn sphereHit(oc: vec3<f32>, dir: vec3<f32>, altO: f32, altS: f32) -> vec2<f32> {
  let b = dot(oc, dir);
  let c = (altO - altS) * (2.0 * cp.layer.z + altO + altS);
  let disc = b * b - c;
  if (disc < 0.0) { return vec2(1.0, -1.0); }
  let q = -b - select(-1.0, 1.0, b >= 0.0) * sqrt(disc);
  if (abs(q) < 1e-6) { return vec2(0.0); }
  let t1 = q; let t2 = c / q;
  return vec2(min(t1, t2), max(t1, t2));
}
// Length of the ray (t > 0, up to tMax) inside the sphere at height altS.
fn inside(oc: vec3<f32>, dir: vec3<f32>, altO: f32, altS: f32, tMax: f32) -> f32 {
  let h = sphereHit(oc, dir, altO, altS);
  return max(0.0, min(h.y, tMax) - max(h.x, 0.0));
}
// Distance to the layer's mid surface (0 = none in front), and the chord through the shell [r - th/2, r + th/2].
fn layerHit(origin: vec3<f32>, dir: vec3<f32>) -> vec2<f32> {
  let c = planetCentre();
  let oc = origin - c;
  let a = altitudeOf(origin, oc);
  // The planet blocks the ray.
  let ground = sphereHit(oc, dir, a, 0.0);
  var tMax = 1.0e9;
  if (ground.x <= ground.y && ground.x > 1.0) { tMax = ground.x; }   // ahead of the ray (a point on the ground itself is not blocked)
  let h = sphereHit(oc, dir, a, cp.layer.x);
  if (h.x > h.y) { return vec2(0.0); }
  var t = h.x;
  if (t <= 0.0) { t = h.y; }   // inside the sphere (below the layer): the exit point
  if (t <= 0.0 || t > tMax) { return vec2(0.0); }
  let hh = 0.5 * cp.layer.y;
  let chord = inside(oc, dir, a, cp.layer.x + hh, tMax) - inside(oc, dir, a, max(cp.layer.x - hh, 0.0), tMax);
  return vec2(t, max(chord, 0.0));
}
// World point -> tile uv: x along the streak direction, y across, scrolled by the layer's own wind.
fn tileUv(p: vec3<f32>, offset: vec2<f32>, tile: f32) -> vec2<f32> {
  let q = p.xz - offset;
  return vec2(dot(q, cp.wind.zw), dot(q, vec2(-cp.wind.w, cp.wind.z))) / tile;
}
// Non-tiling large-scale coverage field (value noise, 2 octaves, about 50 km and 20 km), in [0, 1].
fn vhash(p: vec2<f32>) -> f32 { return hash01(pcg((bitcast<u32>(i32(p.x)) * 0x27d4eb2du) ^ pcg(bitcast<u32>(i32(p.y))))); }
fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p); let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), u.x), mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), u.x), u.y);
}
fn largeCoverage(p: vec3<f32>) -> f32 {
  let q = (p.xz - cp.wind.xy) / 50000.0;
  return 0.65 * vnoise(q + 17.3) + 0.35 * vnoise(q * 2.5 + 41.7);
}
// NE p.65 with our coverage variation: n = baked (streaky, wispy, round, fine) at the main frequency, fine = the fine channel at 4x.
fn cirrusDensity(n: vec4<f32>, fine: f32, veilBase: f32, cov: f32) -> f32 {
  let type_ = cp.shape.y;
  let d0 = mix(mix(n.x, n.y, saturate(type_ * 2.0)), n.z, saturate(type_ * 2.0 - 1.0));
  var d = pow(max(d0, 0.0), 1.0 - valueRemap(cov, 0.0, 1.0, -0.9, 0.9));
  d *= valueRemap(cov * cov, 0.0, 0.36, 0.0, 1.0);
  d *= mix(1.0, saturate(0.35 + 1.3 * fine), cp.look.x);
  // Cirrostratus veil: a smooth sheet with faint fibres, its own coverage the same field.
  // It follows the large-scale coverage, so the sheet covers part of the sky and thins out elsewhere.
  let veil = cp.shape.z * saturate(1.4 * veilBase - 0.1) * mix(1.0, 0.7 + 0.6 * fine, 0.5) * smoothstep(0.3, 0.85, cov);
  return saturate(d + veil * (1.0 - d));
}
fn hg(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-5), 1.5));
}
fn icePhase(c: f32) -> f32 {
  var p = mix(hg(c, cp.misc.y), hg(c, cp.misc.x), cp.misc.z);
  // 22 degree halo (cirrostratus): a narrow ring, sharper inside.
  if (cp.look.w > 0.0) {
    let a = acos(clamp(c, -1.0, 1.0)) - 0.3840;
    p += cp.look.w * 0.12 * exp(-a * a / select(0.00004, 0.0006, a > 0.0));
  }
  return p;
}
// Sun illuminance at the layer point p (exposure units): the atmosphere's transmittance at the layer's radius along the point's own up.
fn cirrusSun(p: vec3<f32>) -> vec3<f32> {
  ${atm ? `
  let c = planetCentre();
  let up = normalize(p - c);
  let rKm = clamp(length(p - c) * 0.001, atmosphere.bottomRadiusKm, atmosphere.topRadiusKm);
  let mu = dot(atmosphere.sunDirection, up);
  let hc = atmHorizonCos(rKm);
  let disc = smoothstep(hc - SUN_HALF_ANGLE_COS, hc + SUN_HALF_ANGLE_COS, mu);
  if (disc <= 0.0) { return vec3(0.0); }
  let tr = textureSampleLevel(atmTransmittanceLut, atmSampler, atmTransmittanceUv(rKm, max(mu, hc + 1e-4)), 0.0).rgb;
  return tr * disc * atmosphere.luminanceScale * atmosphere.sunColor;` : 'return skyLight[0].xyz;'}
}

struct Sample { n: vec4<f32>, fine: f32, veil: f32 }
fn fetch(p: vec3<f32>, gx: vec2<f32>, gy: vec2<f32>) -> Sample {
  var s: Sample;
  let uv = tileUv(p, cp.wind.xy, cp.layer.w);
  s.n = textureSampleGrad(noiseTex, noiseSampler, uv, gx, gy);
  s.fine = textureSampleGrad(noiseTex, noiseSampler, tileUv(p, cp.fine.xy, cp.layer.w * 0.25), gx * 4.0, gy * 4.0).a;
  s.veil = 0.0;
  if (cp.shape.z > 0.0) { s.veil = textureSampleLevel(noiseTex, noiseSampler, uv * 0.5 + 0.31, 6.0).y; }
  return s;
}
// Distance to the layer's mid surface only (the neighbour rays for the texture gradients): 0 = none.
fn layerT(origin: vec3<f32>, dir: vec3<f32>) -> f32 {
  let oc = origin - planetCentre();
  let h = sphereHit(oc, dir, altitudeOf(origin, oc), cp.layer.x);
  if (h.x > h.y) { return 0.0; }
  return select(h.x, h.y, h.x <= 0.0);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let cs = frame.misc.zw;
  if (any(vec2<f32>(gid.xy) >= cs)) { return; }
  let px = vec2<i32>(gid.xy);
  let uv = (vec2<f32>(gid.xy) + 0.5) / cs;
  // The farthest scene depth over the scene pixels this one covers (as the composite).
  var depth = 0.0;
  if (cs.x >= frame.outputSize.x) {
    depth = textureLoad(sceneDepth, px, 0);
  } else {
    let ratio = frame.outputSize / cs;
    let lo = vec2<i32>(floor(vec2<f32>(gid.xy) * ratio));
    let hi = min(vec2<i32>(ceil(vec2<f32>(gid.xy + vec2<u32>(1u)) * ratio)) - vec2<i32>(1), lo + vec2<i32>(3));
    let dmax = vec2<i32>(textureDimensions(sceneDepth)) - vec2<i32>(1);
    for (var y = lo.y; y <= hi.y; y++) { for (var x = lo.x; x <= hi.x; x++) { depth = max(depth, textureLoad(sceneDepth, min(vec2<i32>(x, y), dmax), 0)); } }
  }
  let sceneT = sceneDistance(depth, uv);
  let origin = frame.cameraPos;
  let dir = normalize(unprojectDepth(uv, 1.0) - origin);
  let sun = frame.sunDir;
  let hit = layerHit(origin, dir);
  let covVar = cp.look.y;

  if (hit.x <= 0.0 || hit.x >= sceneT) {
    // No layer in front of this pixel. An opaque surface may take the layer's (faint, optional) shadow.
    var s = 1.0;
    if (sceneT < FAR_T && cp.look.z > 0.0 && sun.y > 0.0 && origin.y < cp.layer.x) {
      let ps = origin + dir * sceneT;
      let hs = layerHit(ps, sun);
      if (hs.x > 0.0) {
        let q = ps + sun * hs.x;
        let n = textureSampleLevel(noiseTex, noiseSampler, tileUv(q, cp.wind.xy, cp.layer.w), 4.0);
        let fine = textureSampleLevel(noiseTex, noiseSampler, tileUv(q, cp.fine.xy, cp.layer.w * 0.25), 4.0).a;
        let veil = textureSampleLevel(noiseTex, noiseSampler, tileUv(q, cp.wind.xy, cp.layer.w) * 0.5 + 0.31, 6.0).y;
        let cov = saturate(cp.shape.x + covVar * (largeCoverage(q) - 0.5) * 2.0);
        let tau = cirrusDensity(n, fine, veil, cov) * cp.shape.w * hs.y / max(cp.layer.y, 1.0);
        s = mix(1.0, exp(-tau), cp.look.z);
      }
    }
    store(px, vec4(0.0, 0.0, 0.0, s));
    return;
  }

  let p = origin + dir * hit.x;
  // Texture gradients from the neighbouring pixels' hits (anisotropic filtering at grazing angles).
  let dx = normalize(unprojectDepth(uv + vec2(1.0 / cs.x, 0.0), 1.0) - origin);
  let dy = normalize(unprojectDepth(uv + vec2(0.0, 1.0 / cs.y), 1.0) - origin);
  let hx = layerT(origin, dx); let hy = layerT(origin, dy);
  let uv0 = tileUv(p, cp.wind.xy, cp.layer.w);
  var gx = select(vec2(0.05), tileUv(origin + dx * hx, cp.wind.xy, cp.layer.w) - uv0, hx > 0.0);
  var gy = select(vec2(0.05), tileUv(origin + dy * hy, cp.wind.xy, cp.layer.w) - uv0, hy > 0.0);
  let cov = saturate(cp.shape.x + covVar * (largeCoverage(p) - 0.5) * 2.0);
  let s0 = fetch(p, gx, gy);
  let d = cirrusDensity(s0.n, s0.fine, s0.veil, cov);
  if (d <= 1e-4) { store(px, vec4(0.0, 0.0, 0.0, 1.0)); return; }
  let th = max(cp.layer.y, 1.0);
  let tauV = d * cp.shape.w;
  let T = exp(-tauV * hit.y / th);

  // Toward the sun across the layer: two taps of the main noise at a coarser mip (no anisotropy; the fine and veil terms are this pixel's).
  // The path factor 1 / mu is capped: the layer is patchy, so a grazing sun reaches a fibre through gaps (a uniform slab would black it out).
  let up = normalize(p - planetCentre());
  let muS = dot(sun, up);
  let sunH = sun - up * muS;
  let reach = min(0.5 * th * length(sunH) / max(muS, 0.03), 12000.0);
  let sH = sunH / max(length(sunH), 1e-4);
  let lod = clamp(log2(max(length(gx), length(gy)) * f32(textureDimensions(noiseTex).x)) + 1.5, 0.0, 10.0);
  let n1 = textureSampleLevel(noiseTex, noiseSampler, tileUv(p + sH * (0.35 * reach), cp.wind.xy, cp.layer.w), lod);
  let n2 = textureSampleLevel(noiseTex, noiseSampler, tileUv(p + sH * reach, cp.wind.xy, cp.layer.w), lod);
  let d1 = cirrusDensity(n1, s0.fine, s0.veil, cov);
  let d2 = cirrusDensity(n2, s0.fine, s0.veil, cov);
  let tauSun = (0.3 * d + 0.4 * d1 + 0.3 * d2) * cp.shape.w * 0.5 * min(1.0 / max(muS, 1e-3), SUN_PATH_MAX);

  let sunL = cirrusSun(p) * cp.fine.z;
  let cosS = dot(dir, sun);
  // Thin ice: single scattering with the sun's attenuation, plus a low-order multiple-scattering share that grows with the layer's thickness.
  let thick = 1.0 - exp(-tauV * 2.0);
  let msL = cp.misc.w * (0.5 * exp(-0.5 * tauSun) + 0.25 * exp(-0.25 * tauSun)) * thick / (4.0 * PI);
  let direct = sunL * (icePhase(cosS) * exp(-tauSun) + msL);
  let ambient = (skyLight[1].xyz * 0.6 + skyLight[2].xyz * 0.4) * cp.fine.w;
  var rgb = (direct + ambient) * (1.0 - T);
  ${atm ? `
  rgb = applyAerialPerspective(rgb, T, dir, hit.x);
  rgb = applyHorizonHaze(rgb, T, origin, dir, hit.x, frame.haze);` : ''}
  store(px, vec4(min(rgb, vec3(CIRRUS_RADIANCE_LIMIT)), T));
}
`;
}
