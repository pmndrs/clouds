// N2a: the first half of HaloRT's per-pixel feature pass (primary-ray optical depth and the four crossing depths), in our own WGSL.
// Web port of `halort/volume_deep_profile.h` from github.com/rendervous/HaloRT (MIT), the part before NEE and the environment samples.
// Spec: docs/research/neural/halort-anatomy.md. Follows the released CODE's encodings, not the paper's (work/neural/DIVERGES.md N-S1..N-S3).
//
// Space: the density texture fills the object box [-1, 1]^3. World = object scaled per axis by `boxHalf` (the source's `transform`
// with no rotation or offset), so the object-space direction `wo = w / boxHalf` is unnormalised and the ray parameter `t` is the same in
// both spaces: every depth below is a world distance from the camera along a unit ray, as in the source.
//
// Not ported yet: the majorant-grid DDA (a plain fixed-step march over the ray/box interval instead; N-F1), sun NEE, environment NEE,
// albedo, g. Those are the second half of the pass.

/** Floats per pixel in the output buffer. */
export const FEATURE_STRIDE = 12;
/** Channel offsets in a pixel's FEATURE_STRIDE floats. */
export const FEATURE = {
  /** Raw optical depth along the primary ray (stops growing past 20). */ tau: 0,
  /** Interaction probability `1 - exp(-tau)`; written for every ray, as in the source. */ S: 1,
  /** Reduced optical depth `1 - exp(-0.2 tau)` (code; paper prints `1 - 1/(1 + 0.5 tau)`). 0 when no crossing was found, as in the source. */ tr: 2,
  /** Number of crossings found (0..4). */ count: 3,
  /** Raw crossing depths t for scales [4, 1, 0.25, 0.125], world distance from the camera; 0 where not found. */ t0: 4, t1: 5, t2: 6, t3: 7,
  /** Encoded depth `log(1 + 0.2 t0)` (sample_index = 0 in `_modeling.py`). */ depth: 8,
  /** Encoded crossings `max(0, t_i - t_{i-1}) ^ 0.25`, i = 1..3. */ c1: 9, c2: 10, c3: 11,
} as const;

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
}

const WGSL = /* wgsl */ `
struct Params {
  size: vec2u, _p0: vec2u,
  camPos: vec3f, tanHalfFov: f32,
  camFwd: vec3f, aspect: f32,
  camRight: vec3f, densityScale: f32,
  camUp: vec3f, stepSize: f32,
  boxHalf: vec3f, _p1: f32,
}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var densityTex: texture_3d<f32>;
@group(0) @binding(2) var densitySampler: sampler;
@group(0) @binding(3) var<storage, read_write> outFeatures: array<f32>;

const STRIDE = ${FEATURE_STRIDE}u;
const TAU_STOP = 20.0;
const MAX_STEPS = 16384;

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

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.size.x || id.y >= P.size.y) { return; }
  let base = (id.y * P.size.x + id.x) * STRIDE;
  var out: array<f32, ${FEATURE_STRIDE}>;
  for (var i = 0u; i < STRIDE; i++) { out[i] = 0.0; }

  // Primary ray (world), then object space.
  let ndc = (vec2f(id.xy) + 0.5) / vec2f(P.size) * 2.0 - 1.0;
  let w = normalize(P.camFwd + P.camRight * (ndc.x * P.tanHalfFov * P.aspect) - P.camUp * (ndc.y * P.tanHalfFov));
  let x = P.camPos / P.boxHalf;
  var wo = w / P.boxHalf;
  wo += select(vec3f(0.0), vec3f(1e-7), wo == vec3f(0.0)); // volume_deep_profile.h:94

  let span = boxInterval(x, wo);
  let tMin = max(0.0, span.x);
  let tMax = span.y;
  if (tMax <= 0.0 || tMin >= tMax) {
    for (var i = 0u; i < STRIDE; i++) { outFeatures[base + i] = out[i]; }
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
  }
  for (var i = 0u; i < STRIDE; i++) { outFeatures[base + i] = out[i]; }
}
`;

/** The feature pass: one compute dispatch per call, writing FEATURE_STRIDE floats per pixel into `output` (row-major, row 0 at the top). */
export class FeaturePass {
  readonly output: GPUBuffer;
  private readonly pipeline: GPUComputePipeline;
  private readonly params: GPUBuffer;
  private readonly sampler: GPUSampler;
  private group: GPUBindGroup | null = null;
  private groupTexture: GPUTexture | null = null;

  constructor(private readonly device: GPUDevice, readonly width: number, readonly height: number) {
    this.output = device.createBuffer({ label: 'neural features', size: width * height * FEATURE_STRIDE * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.params = device.createBuffer({ label: 'neural features params', size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
    this.pipeline = device.createComputePipeline({ label: 'neural features', layout: 'auto', compute: { module: device.createShaderModule({ label: 'neural features', code: WGSL }), entryPoint: 'main' } });
  }

  encode(encoder: GPUCommandEncoder, inputs: FeaturePassInputs): void {
    const { camera: c } = inputs;
    const buf = new ArrayBuffer(96);
    const u32 = new Uint32Array(buf), f32 = new Float32Array(buf);
    u32.set([this.width, this.height, 0, 0], 0);
    f32.set([...c.position, Math.tan(c.fovY / 2)], 4);
    f32.set([...c.forward, this.width / this.height], 8);
    f32.set([...c.right, inputs.densityScale], 12);
    f32.set([...c.up, inputs.stepSize], 16);
    f32.set([...inputs.boxHalf, 0], 20);
    this.device.queue.writeBuffer(this.params, 0, buf);
    if (!this.group || this.groupTexture !== inputs.density) {
      this.groupTexture = inputs.density;
      this.group = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: inputs.density.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.output } },
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

  destroy(): void { this.output.destroy(); this.params.destroy(); }
}
