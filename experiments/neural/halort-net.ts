// N3a: the HaloRT authors' ONNX network (github.com/rendervous/HaloRT, weights MIT) run by ONNX Runtime Web on OUR GPUDevice, fed by
// FeaturePass.packed (the [1, 17, H, W] `condition`). Same approach as the authors' web demo (rdv_on_the_web/halort/index.html: one
// device for features and network, every input and output a fixed GPU buffer wrapped by ort.Tensor.fromGpuBuffer), written fresh.
// Their ORT replay cache (common/ort_replay.js) is NOT used: no licence, and speed is not this step.
//
// ORT: onnxruntime-web 1.30.0 `ort.webgpu.min.mjs` from the same jsDelivr URL the demo uses (no package added yet).
// The graph composites itself: radiance = (direct * light + envScale * env) * S + background * envScale * (1 - S), so the sun and sky
// intensities are the `light_intensity` and `environment_scale` feeds, outside the network.

const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.min.mjs';

/** Minimal surface of the ORT module this file uses (loaded at runtime from the CDN, so no package types). */
interface OrtTensor { dispose(): void }
interface OrtSession { run(feeds: Record<string, OrtTensor>, fetches: Record<string, OrtTensor>): Promise<unknown>; release(): Promise<void> }
interface OrtModule {
  env: { webgpu: { device?: GPUDevice } };
  InferenceSession: { create(url: string, options: Record<string, unknown>): Promise<OrtSession> };
  Tensor: { fromGpuBuffer(buffer: GPUBuffer, options: { dataType: string; dims: number[] }): OrtTensor };
}

let ortModule: Promise<OrtModule> | null = null;
function loadOrt(): Promise<OrtModule> {
  ortModule ??= import(/* @vite-ignore */ ORT_URL) as Promise<OrtModule>;
  return ortModule;
}

/** Device features and limits ONNX Runtime's WebGPU EP wants on a device it did not create (the demo requests the same list). */
export function ortDeviceRequest(adapter: GPUAdapter): { requiredFeatures: GPUFeatureName[]; requiredLimits: Record<string, number> } {
  const requiredLimits: Record<string, number> = {};
  for (const k of ['maxStorageBufferBindingSize', 'maxBufferSize', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup',
    'maxComputeWorkgroupSizeX', 'maxComputeWorkgroupSizeY', 'maxComputeWorkgroupSizeZ', 'maxComputeWorkgroupsPerDimension',
    'maxStorageBuffersPerShaderStage'] as const) requiredLimits[k] = adapter.limits[k];
  const requiredFeatures = (['shader-f16', 'timestamp-query'] as GPUFeatureName[]).filter(f => adapter.features.has(f));
  return { requiredFeatures, requiredLimits };
}

const ACCUMULATE_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> radiance: array<f32>;
@group(0) @binding(1) var<storage, read_write> accum: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x < arrayLength(&accum)) { accum[id.x] += radiance[id.x]; }
}`;

/** Shows the accumulated radiance as the demo does: v * 2^EV / spp, filmic 1 - exp(-v), gamma 2.2. The buffer is in rdv pixel order
 *  (our image turned 180 degrees, see feature-pass.ts), so it is turned back here. Fills the viewport it is drawn into. */
const DISPLAY_WGSL = /* wgsl */ `
struct D { size: u32, _a: u32, scale: f32, _b: f32, origin: vec2f, extent: vec2f }
@group(0) @binding(0) var<uniform> U: D;
@group(0) @binding(1) var<storage, read> A: array<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let n = U.size;
  let uv = (pos.xy - U.origin) / U.extent;
  let px = min(vec2u(uv * f32(n)), vec2u(n - 1u));
  let rdv = (n - 1u - px.y) * n + (n - 1u - px.x);
  let plane = n * n;
  var c = vec3f(A[rdv], A[rdv + plane], A[rdv + 2u * plane]) * U.scale;
  c = 1.0 - exp(-max(c, vec3f(0.0)));
  return vec4f(pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2)), 1.0);
}`;

export type HaloPrecision = 'fp32' | 'fp16';

export class HaloNet {
  readonly input: GPUBuffer;
  readonly light: GPUBuffer;
  readonly sky: GPUBuffer;
  readonly output: GPUBuffer;
  readonly accum: GPUBuffer;
  spp = 0;
  private readonly feeds: Record<string, OrtTensor>;
  private readonly fetches: Record<string, OrtTensor>;
  private readonly accPipe: GPUComputePipeline;
  private readonly accGroup: GPUBindGroup;
  private readonly dispPipe: GPURenderPipeline;
  private readonly dispGroup: GPUBindGroup;
  private readonly dispBuf: GPUBuffer;

  private constructor(private readonly device: GPUDevice, readonly size: number, private readonly session: OrtSession, ort: OrtModule, format: GPUTextureFormat) {
    const U = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const buf = (label: string, bytes: number) => device.createBuffer({ label, size: Math.max(bytes, 16), usage: U });
    const plane = size * size;
    this.input = buf('halort condition', 17 * plane * 4);
    this.light = buf('halort light_intensity', 12);
    this.sky = buf('halort environment_scale', 12);
    this.output = buf('halort radiance', 3 * plane * 4);
    this.accum = buf('halort accum', 3 * plane * 4);
    const tensor = (b: GPUBuffer, dims: number[]) => ort.Tensor.fromGpuBuffer(b, { dataType: 'float32', dims });
    this.feeds = { condition: tensor(this.input, [1, 17, size, size]), light_intensity: tensor(this.light, [3]), environment_scale: tensor(this.sky, [3]) };
    this.fetches = { radiance: tensor(this.output, [1, 3, size, size]) };
    this.accPipe = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ label: 'halort accumulate', code: ACCUMULATE_WGSL }), entryPoint: 'main' } });
    this.accGroup = device.createBindGroup({ layout: this.accPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.output } }, { binding: 1, resource: { buffer: this.accum } }] });
    const mod = device.createShaderModule({ label: 'halort display', code: DISPLAY_WGSL });
    this.dispPipe = device.createRenderPipeline({ layout: 'auto', vertex: { module: mod, entryPoint: 'vs' }, fragment: { module: mod, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
    this.dispBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.dispGroup = device.createBindGroup({ layout: this.dispPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.dispBuf } }, { binding: 1, resource: { buffer: this.accum } }] });
  }

  /** Loads ORT (once) and the model at `modelUrl` (halort_<size>[_fp16].onnx) on `device`. */
  static async create(device: GPUDevice, size: number, modelUrl: string, format: GPUTextureFormat): Promise<HaloNet> {
    if (size % 64 !== 0) throw new Error(`HaloRT input size must be a multiple of 64 (got ${size})`);
    const ort = await loadOrt();
    ort.env.webgpu.device = device;
    const session = await ort.InferenceSession.create(modelUrl, { executionProviders: [{ name: 'webgpu', device }], preferredOutputLocation: 'gpu-buffer' });
    return new HaloNet(device, size, session, ort, format);
  }

  /** Clears the accumulation (call when the view or any input changes). */
  restart(): void {
    const enc = this.device.createCommandEncoder();
    enc.clearBuffer(this.accum);
    this.device.queue.submit([enc.finish()]);
    this.spp = 0;
  }

  /** One frame: copy the packed features into the network input (GPU copy), set the light feeds, run, accumulate. */
  async run(packed: GPUBuffer, lightIntensity: readonly number[], environmentScale: readonly number[]): Promise<void> {
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(packed, 0, this.input, 0, this.input.size);
    this.device.queue.submit([enc.finish()]);
    this.device.queue.writeBuffer(this.light, 0, Float32Array.from(lightIntensity));
    this.device.queue.writeBuffer(this.sky, 0, Float32Array.from(environmentScale));
    await this.session.run(this.feeds, this.fetches);
    this.accumulate();
  }

  /** Adds `output` to the accumulation (one frame). N5.12: also called after our engine's blend has written `output`. */
  accumulate(): void {
    const enc = this.device.createCommandEncoder();
    const p = enc.beginComputePass();
    p.setPipeline(this.accPipe);
    p.setBindGroup(0, this.accGroup);
    p.dispatchWorkgroups(Math.ceil((3 * this.size * this.size) / 256));
    p.end();
    this.device.queue.submit([enc.finish()]);
    this.spp++;
  }

  /** Draws the accumulated radiance into `view` over the pixel rectangle origin + extent (exposure in EV, as the demo's slider). */
  draw(enc: GPUCommandEncoder, view: GPUTextureView, exposure: number, origin: [number, number], extent: [number, number]): void {
    const d = new ArrayBuffer(32);
    new Uint32Array(d, 0, 1)[0] = this.size;
    new Float32Array(d, 8, 1)[0] = Math.pow(2, exposure) / Math.max(1, this.spp);
    new Float32Array(d, 16, 4).set([...origin, ...extent]);
    this.device.queue.writeBuffer(this.dispBuf, 0, d);
    const rp = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    rp.setViewport(origin[0], origin[1], extent[0], extent[1], 0, 1);
    rp.setPipeline(this.dispPipe);
    rp.setBindGroup(0, this.dispGroup);
    rp.draw(3);
    rp.end();
  }

  /** Mean, max and non-finite count of the accumulated radiance / spp (for the report). */
  async stats(): Promise<{ spp: number; mean: number; max: number; nonFinite: number }> {
    const staging = this.device.createBuffer({ size: this.accum.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.accum, 0, staging, 0, this.accum.size);
    this.device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const a = new Float32Array(staging.getMappedRange());
    let sum = 0, max = -Infinity, bad = 0;
    for (let i = 0; i < a.length; i++) { const v = a[i]; if (!Number.isFinite(v)) { bad++; continue; } sum += v; if (v > max) max = v; }
    const spp = Math.max(1, this.spp), n = a.length;
    staging.destroy(); // detaches `a`
    return { spp: this.spp, mean: +(sum / n / spp).toFixed(4), max: +(max / spp).toFixed(4), nonFinite: bad };
  }
}
