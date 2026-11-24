// N2a: the first half of HaloRT's per-pixel feature pass (primary-ray optical depth and the four crossing depths), in our own WGSL.
// Web port of `halort/volume_deep_profile.h` from github.com/rendervous/HaloRT (MIT), the part before NEE and the environment samples.
// Spec: docs/research/neural/halort-anatomy.md. Follows the released CODE's encodings, not the paper's (work/neural/DIVERGES.md N-S1..N-S3).
//
// Space: the density texture fills the object box [-1, 1]^3. World = object scaled per axis by `boxHalf` (the source's `transform`
// with no rotation or offset), so the object-space direction `wo = w / boxHalf` is unnormalised and the ray parameter `t` is the same in
// both spaces: every depth below is a world distance from the camera along a unit ray, as in the source.
//
// N2b adds the second half, evaluated at the first crossing x(t1) (sample_index = 0): g (raw), sun transmittance (deterministic march
// to the box exit, N-F4), environment NEE over a procedural sky (uniform sphere samples, N-F5), the albedo feature, the background, and
// a packed copy in the exact layout the authors' ONNX model takes (`packed`, [1, 17, H, W] float32, see PACKED_CHANNELS).
//
// Not ported yet: the majorant-grid DDA (a plain fixed-step march over the ray/box interval instead; N-F1).

/** Floats per pixel in the output buffer (23 used, padded to 24). */
export const FEATURE_STRIDE = 24;
/** Channel offsets in a pixel's FEATURE_STRIDE floats. */
export const FEATURE = {
  /** Raw optical depth along the primary ray (stops growing past 20). */ tau: 0,
  /** Interaction probability `1 - exp(-tau)`; written for every ray, as in the source. */ S: 1,
  /** Reduced optical depth `1 - exp(-0.2 tau)` (code; paper prints `1 - 1/(1 + 0.5 tau)`). 0 when no crossing was found, as in the source. */ tr: 2,
  /** Number of crossings found (0..4). */ count: 3,
  /** Raw crossing depths t for scales [4, 1, 0.25, 0.125], world distance from the camera; 0 where not found. */ t0: 4, t1: 5, t2: 6, t3: 7,
  /** Encoded depth `log(1 + 0.2 t0)` (sample_index = 0 in `_modeling.py`). */ depth: 8,
  /** Encoded crossings `max(0, t_i - t_{i-1}) ^ 0.25`, i = 1..3. */ c1: 9, c2: 10, c3: 11,
  /** HG anisotropy, raw (use_similarity_anisotropy off). 0 when no crossing, as in the source. */ g: 12,
  /** Sun transmittance from x(t1) toward the light, no phase (source channel 6). 0 when no crossing. */ nee: 13,
  /** Environment NEE rgb: mean over samples of T * HG(w . d, g) * L_env(d) / pdf(d), unit-mean environment (source 7-9). */ envR: 14, envG: 15, envB: 16,
  /** Albedo feature `sa ^ (2 tau (1 - sa g))` rgb (use_scattering_accumulation on); 1 when no crossing (source 10-12). */ saR: 17, saG: 18, saB: 19,
  /** Background: unit-mean environment along the view ray (the demo's condition channels 14-16). */ bgR: 20, bgG: 21, bgB: 22,
} as const;

/** The authors' ONNX input `condition` [1, 17, H, W] float32, planar: channel c of pixel p at c * H * W + p. Channels 0-13 are
 *  volume_deep_profile.h's output in its own order, 14-16 the background. Values are FEATURE offsets. */
export const PACKED_CHANNELS = [
  FEATURE.depth, FEATURE.c1, FEATURE.c2, FEATURE.c3, FEATURE.tr, FEATURE.g, FEATURE.nee,
  FEATURE.envR, FEATURE.envG, FEATURE.envB, FEATURE.saR, FEATURE.saG, FEATURE.saB, FEATURE.S,
  FEATURE.bgR, FEATURE.bgG, FEATURE.bgB,
] as const;

/** Procedural sky (N-F5): world y up. Zenith-to-horizon gradient above, flat ground below. Linear radiance before normalisation. */
export const SKY = {
  zenith: [0.15, 0.35, 0.85] as const,
  horizon: [0.75, 0.82, 0.95] as const,
  ground: [0.25, 0.22, 0.18] as const,
  /** Gradient exponent: mix(zenith, horizon, (1 - y)^k). */ k: 4,
};

/** Sky radiance along a unit world direction's y (the sky depends on elevation only). Same formula as the WGSL `skyRaw`. */
export function skyRaw(y: number): [number, number, number] {
  if (y < 0) return [...SKY.ground];
  const m = Math.pow(1 - y, SKY.k);
  return [0, 1, 2].map(i => SKY.zenith[i] + (SKY.horizon[i] - SKY.zenith[i]) * m) as [number, number, number];
}

/** Per-channel environment scale as the source's `normalize_environment` computes it: the plain mean over the pixels of an equirect
 *  map (here 512 x 256, rows uniform in polar angle). The pass renders against sky / scale; the composite multiplies by scale. */
export function environmentScale(rows = 256): [number, number, number] {
  const acc = [0, 0, 0];
  for (let r = 0; r < rows; r++) {
    const c = skyRaw(Math.cos(((r + 0.5) / rows) * Math.PI));
    for (let i = 0; i < 3; i++) acc[i] += c[i] / rows;
  }
  return acc as [number, number, number];
}

/** The released code's density scales for the four crossings (`TRANSMITTANCE_THRESHOLDS`). */
export const CROSSING_SCALES = [4, 1, 0.25, 0.125] as const;

export interface FeatureCamera {
  position: readonly [number, number, number];
  /** Orthonormal camera basis (world). */
  forward: readonly [number, number, number];
  right: readonly [number, number, number];
  up: readonly [number, number, number];
  /** Vertical field of view, radians. */
  fovY: number;
}

export interface FeaturePassInputs {
  /** Dense density, 3D, filterable float format (r16float). Texture axes (x, y, z) map to object axes (x, z, y): z is up (our VDB lattice). */
  density: GPUTexture;
  /** World half-extents of the box (object [-1, 1]^3 times this). */
  boxHalf: readonly [number, number, number];
  camera: FeatureCamera;
  /** Extinction per unit density per world unit (the source's `density_scale`, default 10 in `_modeling.py`). */
  densityScale: number;
  /** March step in t (world) units. The source uses 0.001; we start at 0.004 (N-F3). */
  stepSize: number;
  /** Unit world direction toward the sun (the source's `light_direction`, default (0, 1, 0)). */
  sunDirection?: readonly [number, number, number];
  /** HG anisotropy (demo scene 0.3; `_modeling.py` default 0.5). */
  g?: number;
  /** Scattering albedo rgb (default 0.99 grey). */
  albedo?: readonly [number, number, number];
  /** Environment samples per pixel (default 8; the code's default is 16). */
  envSamples?: number;
  /** Seed for the per-pixel hash (change per frame for fresh noise). */
  frame?: number;
}

const WGSL = /* wgsl */ `
struct Params {
  size: vec2u, envSamples: u32, frame: u32,
  camPos: vec3f, tanHalfFov: f32,
  camFwd: vec3f, aspect: f32,
  camRight: vec3f, densityScale: f32,
  camUp: vec3f, stepSize: f32,
  boxHalf: vec3f, g: f32,
  sunDir: vec3f, _p2: f32,
  albedo: vec3f, _p3: f32,
  envInvScale: vec3f, _p4: f32,
}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var densityTex: texture_3d<f32>;
@group(0) @binding(2) var densitySampler: sampler;
@group(0) @binding(3) var<storage, read_write> outFeatures: array<f32>;
@group(0) @binding(4) var<storage, read_write> outPacked: array<f32>;

const STRIDE = ${FEATURE_STRIDE}u;
const TAU_STOP = 20.0;
const MAX_STEPS = 16384;
const PI = 3.14159265358979;
var<private> PACKED: array<u32, 17> = array<u32, 17>(${PACKED_CHANNELS.map(c => `${c}u`).join(', ')});

// Henyey-Greenstein with the 1/(4 pi) factor, cos = dot(w_in, w_out) (rendervous hg_phase_eval, as compiled in the authors' web demo).
fn hgPhase(cosTheta: f32, g: f32) -> f32 {
  if (abs(g) < 0.001) { return 0.0795774683; }
  let g2 = g * g;
  return 0.0795774683 * (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
}

// Procedural sky, raw linear radiance (SKY in the TS); the pass uses it times envInvScale (unit mean, normalize_environment).
fn skyRaw(d: vec3f) -> vec3f {
  if (d.y < 0.0) { return vec3f(${SKY.ground.join(', ')}); }
  return mix(vec3f(${SKY.zenith.join(', ')}), vec3f(${SKY.horizon.join(', ')}), pow(1.0 - d.y, ${SKY.k.toFixed(1)}));
}
fn skyUnit(d: vec3f) -> vec3f { return skyRaw(d) * P.envInvScale; }

// PCG hash: per pixel, per frame, per sample.
var<private> rngState: u32;
fn rand() -> f32 {
  rngState = rngState * 747796405u + 2891336453u;
  var w = ((rngState >> ((rngState >> 28u) + 4u)) ^ rngState) * 277803737u;
  w = (w >> 22u) ^ w;
  return f32(w >> 8u) * (1.0 / 16777216.0);
}

fn scaleAt(i: i32) -> f32 {
  switch i { case 0: { return ${CROSSING_SCALES[0].toFixed(4)}; } case 1: { return ${CROSSING_SCALES[1].toFixed(4)}; }
             case 2: { return ${CROSSING_SCALES[2].toFixed(4)}; } default: { return ${CROSSING_SCALES[3].toFixed(4)}; } }
}

// Expected optical depth at the crossing for density scale s (volume_deep_profile.h:170): the mean of an exponential free flight
// truncated to the ray's total optical depth s * tau.
fn tauCrossing(s: f32, tau: f32) -> f32 {
  let st = s * tau;
  if (st < 0.01) { return 0.5 * st; }
  if (st >= 10.0) { return 1.0; }
  return 1.0 - (st * exp(-st)) / (1.0 - exp(-st));
}

// The source's extinction(node, x) * density_scale at an object-space point. Texture axes (x, y, z) = object (x, z, y).
fn extinction(p: vec3f) -> f32 {
  let uvw = p * 0.5 + 0.5;
  return textureSampleLevel(densityTex, densitySampler, vec3f(uvw.x, uvw.z, uvw.y), 0.0).r * P.densityScale;
}

// Slab test against [-1, 1]^3 for an unnormalised direction (the source's ray_box_intersection).
fn boxInterval(x: vec3f, w: vec3f) -> vec2f {
  let inv = 1.0 / w;
  let a = (vec3f(-1.0) - x) * inv;
  let b = (vec3f(1.0) - x) * inv;
  let lo = min(a, b);
  let hi = max(a, b);
  return vec2f(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
}

// Transmittance from object-space point p along world direction d to the box exit: deterministic fixed-step march with the start
// offset by "offset" steps (0.5 for the sun; a random offset for environment rays). Source: transmittance_rm over the first 0.2 units,
// then ratio tracking (sun), ratio tracking (environment). N-F4.
fn transmittance(p: vec3f, d: vec3f, offset: f32) -> f32 {
  var od = d / P.boxHalf;
  od += select(vec3f(0.0), vec3f(1e-7), od == vec3f(0.0));
  let span = boxInterval(p, od);
  if (span.y <= 0.0 || span.y < span.x) { return 1.0; }
  var tau = 0.0;
  var t = max(0.0, span.x) + offset * P.stepSize;
  for (var guard = 0; guard < MAX_STEPS && t < span.y; guard++) {
    tau += extinction(p + od * t) * P.stepSize;
    t += P.stepSize;
    if (tau > TAU_STOP) { break; }
  }
  return exp(-tau);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.size.x || id.y >= P.size.y) { return; }
  let base = (id.y * P.size.x + id.x) * STRIDE;
  var out: array<f32, ${FEATURE_STRIDE}>;
  for (var i = 0u; i < STRIDE; i++) { out[i] = 0.0; }
  // Source defaults (volume_deep_profile.h:69-75): everything 0, the albedo channels 1.
  out[${FEATURE.saR}] = 1.0; out[${FEATURE.saG}] = 1.0; out[${FEATURE.saB}] = 1.0;
  rngState = (id.y * P.size.x + id.x) * 9781u + P.frame * 6271u + 1u;
  _ = rand();

  // Primary ray (world), then object space.
  let ndc = (vec2f(id.xy) + 0.5) / vec2f(P.size) * 2.0 - 1.0;
  let w = normalize(P.camFwd + P.camRight * (ndc.x * P.tanHalfFov * P.aspect) - P.camUp * (ndc.y * P.tanHalfFov));
  let x = P.camPos / P.boxHalf;
  var wo = w / P.boxHalf;
  wo += select(vec3f(0.0), vec3f(1e-7), wo == vec3f(0.0)); // volume_deep_profile.h:94

  let span = boxInterval(x, wo);
  let tMin = max(0.0, span.x);
  let tMax = span.y;
  let bg = skyUnit(w);
  out[${FEATURE.bgR}] = bg.x; out[${FEATURE.bgG}] = bg.y; out[${FEATURE.bgB}] = bg.z;
  if (tMax <= 0.0 || tMin >= tMax) {
    writeOut(id.xy, base, out);
    return;
  }

  // Pass 1: accumulate tau; remember the first non-empty sample (plain fixed-step march, no majorant DDA: N-F1).
  var tau = 0.0;
  var firstT = -1.0;
  {
    var t = tMin;
    for (var guard = 0; guard < MAX_STEPS && t < tMax; guard++) {
      let e = extinction(x + wo * t);
      if (firstT < 0.0 && e > 0.0) { firstT = t; }
      tau += e * P.stepSize;
      t += P.stepSize;
      if (tau > TAU_STOP) { break; }
    }
  }

  // Pass 2: from the first non-empty sample, the four crossings (volume_deep_profile.h:167-226).
  var depthIndex = 0;
  var scale = scaleAt(0);
  var crossing = tauCrossing(scale, tau);
  if (tau > 0.0001) {
    var currentTau = 0.0;
    var t = firstT;
    var done = false;
    for (var guard = 0; guard < MAX_STEPS && t < tMax && !done; guard++) {
      currentTau += extinction(x + wo * t) * P.stepSize;
      for (var k = 0; currentTau * scale >= crossing && k < 5; k++) {
        out[4 + depthIndex] = t;
        depthIndex++;
        if (depthIndex >= 4) { break; }
        scale = scaleAt(depthIndex);
        crossing = tauCrossing(scale, tau);
      }
      if (depthIndex >= 4) { done = true; break; }
      t += P.stepSize;
      if (currentTau > TAU_STOP) { done = true; break; }
    }
  }

  out[0] = tau;
  out[1] = 1.0 - exp(-tau);
  out[3] = f32(depthIndex);
  if (depthIndex > 0) {
    // use_depth_encoding = 1, sample_index = 0 (_modeling.py:1501): gaps to the fourth root, then the log depth of crossing 0.
    let checkT = out[4];
    for (var i = 3; i >= 1; i--) { out[8 + i] = pow(max(0.0, out[4 + i] - out[4 + i - 1]), 0.25); }
    out[8] = log(1.0 + 0.2 * checkT);
    // use_reduced_transmittance = 1.
    out[2] = 1.0 - exp(-0.2 * tau);

    // Second half (volume_deep_profile.h:247-314), at x(t1).
    let samplePos = x + wo * checkT;
    let g = P.g;
    out[${FEATURE.g}] = g; // use_similarity_anisotropy = 0
    // use_scattering_accumulation = 1: estimated path-through absorption.
    for (var i = 0u; i < 3u; i++) { out[${FEATURE.saR}u + i] = pow(P.albedo[i], 2.0 * tau * (1.0 - P.albedo[i] * g)); }
    // Sun: transmittance only, no phase (the source's comment: no phase/albedo weighting).
    out[${FEATURE.nee}] = transmittance(samplePos, P.sunDir, 0.5);
    // Environment: uniform sphere directions, pdf 1 / (4 pi); weight T * HG(dot(w, d), g) * L(d) / pdf, mean over samples.
    var env = vec3f(0.0);
    let n = P.envSamples;
    for (var s = 0u; s < n; s++) {
      let z = 1.0 - 2.0 * rand();
      let phi = 2.0 * PI * rand();
      let r = sqrt(max(0.0, 1.0 - z * z));
      let d = vec3f(r * cos(phi), z, r * sin(phi));
      env += transmittance(samplePos, d, rand()) * hgPhase(dot(w, d), g) * skyUnit(d) * (4.0 * PI);
    }
    if (n > 0u) { env /= f32(n); }
    out[${FEATURE.envR}] = env.x; out[${FEATURE.envG}] = env.y; out[${FEATURE.envB}] = env.z;
  }
  writeOut(id.xy, base, out);
}

// Writes the pixel's features, and the packed ONNX input: planar [17, H, W], in rdv's camera order, which is our image turned 180
// degrees (the demo's camera: row 0 at the bottom, column 0 at the right; see work/logs/N2b.md).
fn writeOut(px: vec2u, base: u32, out: array<f32, ${FEATURE_STRIDE}>) {
  var o = out;
  for (var i = 0u; i < STRIDE; i++) { outFeatures[base + i] = o[i]; }
  let plane = P.size.x * P.size.y;
  let rdvPixel = (P.size.y - 1u - px.y) * P.size.x + (P.size.x - 1u - px.x);
  for (var c = 0u; c < 17u; c++) { outPacked[c * plane + rdvPixel] = o[PACKED[c]]; }
}
`;

/** The feature pass: one compute dispatch per call, writing FEATURE_STRIDE floats per pixel into `output` (row-major, row 0 at the top). */
export class FeaturePass {
  readonly output: GPUBuffer;
  /** The authors' ONNX `condition` input: [1, 17, H, W] float32, planar, rdv camera order (PACKED_CHANNELS). */
  readonly packed: GPUBuffer;
  /** Per-channel environment scale (normalize_environment); the composite multiplies the environment term and background by it. */
  readonly envScale = environmentScale();
  private frameCounter = 0;
  private readonly pipeline: GPUComputePipeline;
  private readonly params: GPUBuffer;
  private readonly sampler: GPUSampler;
  private group: GPUBindGroup | null = null;
  private groupTexture: GPUTexture | null = null;

  constructor(private readonly device: GPUDevice, readonly width: number, readonly height: number) {
    this.output = device.createBuffer({ label: 'neural features', size: width * height * FEATURE_STRIDE * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.packed = device.createBuffer({ label: 'neural features packed', size: width * height * PACKED_CHANNELS.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.params = device.createBuffer({ label: 'neural features params', size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
    this.pipeline = device.createComputePipeline({ label: 'neural features', layout: 'auto', compute: { module: device.createShaderModule({ label: 'neural features', code: WGSL }), entryPoint: 'main' } });
  }

  encode(encoder: GPUCommandEncoder, inputs: FeaturePassInputs): void {
    const { camera: c } = inputs;
    const buf = new ArrayBuffer(144);
    const u32 = new Uint32Array(buf), f32 = new Float32Array(buf);
    u32.set([this.width, this.height, inputs.envSamples ?? 8, inputs.frame ?? this.frameCounter++], 0);
    f32.set([...c.position, Math.tan(c.fovY / 2)], 4);
    f32.set([...c.forward, this.width / this.height], 8);
    f32.set([...c.right, inputs.densityScale], 12);
    f32.set([...c.up, inputs.stepSize], 16);
    f32.set([...inputs.boxHalf, inputs.g ?? 0.3], 20);
    f32.set([...(inputs.sunDirection ?? [0, 1, 0]), 0], 24);
    f32.set([...(inputs.albedo ?? [0.99, 0.99, 0.99]), 0], 28);
    f32.set([...this.envScale.map(v => 1 / v), 0], 32);
    this.device.queue.writeBuffer(this.params, 0, buf);
    if (!this.group || this.groupTexture !== inputs.density) {
      this.groupTexture = inputs.density;
      this.group = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: inputs.density.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.output } },
        { binding: 4, resource: { buffer: this.packed } },
      ] });
    }
    const pass = encoder.beginComputePass({ label: 'neural features' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group);
    pass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
    pass.end();
  }

  /** Read the whole feature buffer back (FEATURE_STRIDE floats per pixel). */
  async read(): Promise<Float32Array> {
    const size = this.output.size;
    const staging = this.device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.output, 0, staging, 0, size);
    this.device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap(); staging.destroy();
    return data;
  }

  destroy(): void { this.output.destroy(); this.packed.destroy(); this.params.destroy(); }
}
