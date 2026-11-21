// PT1: the reference side. Drives the owner's path tracer (@pmndrs/pathtracer megakernel, P5 volumes: delta tracking, ratio-tracked shadows,
// 8^3 brick majorants, HG phase; validated against pbrt-v4 / Mitsuba) from outside its bench, on its own device:
//   - one box mesh with an `interface` material bounding a grid medium (our baked density, sigma_t = density * extinction, albedo, HG g);
//   - the sun as a delta directional light (irradiance = the runtime's sun at the cloud centre), the sky as an equirect environment
//     (the runtime's sky-view LUT), importance-sampled;
//   - progressive accumulation; display divides the accumulator and tone-maps exactly as the flagship does (three's ACES filmic at the
//     page exposure, then sRGB), so the PT and runtime frames are directly comparable.
// Nothing in the sibling repo is changed: everything below is its public API (the same calls its bench adapter makes).
import { buildSceneCopy, detectCaps, envMapMean, requestDeviceForCaps, sceneFormatOf, uploadSceneCopy, type Caps, type SceneCopyBuffers } from '@pmndrs/raytracer';
import { brickMajorants, gridWorldToIndex, PtMegakernel, type PtLookAtCamera } from '@pmndrs/pathtracer';
import { buildTraceScene, createMeshBvhBuilder, uploadTraceScene, type TraceSceneBuffers } from '@pmndrs/bvh';
import type { DensityGrid, SkyBake, V3 } from './bake';

export interface PtMediumParams { extinction: number; albedo: number; g: number }
/** `noSun`: no sun light at all (P0.6 furnace and absorber checks: the sky alone). */
export interface PtSceneParams { sunDir: V3; sky: SkyBake; noSun?: boolean }

const DISPLAY_WGSL = /* wgsl */ `
struct Display { size: vec2<u32>, exposure: f32, mode: u32 }
@group(0) @binding(0) var<storage, read> accum: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> display: Display;
struct VsOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  let p = vec2(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VsOut; o.pos = vec4(p * 2.0 - 1.0, 0.0, 1.0); o.uv = vec2(p.x, 1.0 - p.y); return o;
}
// three.js ACESFilmicToneMapping (ToneMappingFunctions.js): exposure / 0.6, sRGB -> AP1 (rows), RRT+ODT fit, back (rows), clamp.
fn rrtOdt(v: vec3<f32>) -> vec3<f32> {
  let a = v * (v + 0.0245786) - 0.000090537;
  let b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
fn aces(c0: vec3<f32>, exposure: f32) -> vec3<f32> {
  let c = c0 * exposure / 0.6;
  let i = vec3(dot(vec3(0.59719, 0.35458, 0.04823), c), dot(vec3(0.07600, 0.90834, 0.01566), c), dot(vec3(0.02840, 0.13383, 0.83777), c));
  let r = rrtOdt(i);
  let o = vec3(dot(vec3(1.60475, -0.53108, -0.07367), r), dot(vec3(-0.10208, 1.10813, -0.00605), r), dot(vec3(-0.00327, -0.07276, 1.07602), r));
  return saturate(o);
}
fn srgb(c: vec3<f32>) -> vec3<f32> {
  return select(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3(0.0031308));
}
@fragment fn fs(in: VsOut) -> @location(0) vec4<f32> {
  let px = min(vec2<u32>(in.uv * vec2<f32>(display.size)), display.size - 1u);
  let s = accum[px.y * display.size.x + px.x];
  let L = s.rgb / max(s.w, 1.0);
  if (display.mode == 1u) { return vec4(L, 1.0); }   // the alpha mask: raw
  return vec4(srgb(aces(L, display.exposure)), 1.0);
}
`;

// The cloud's opacity along each camera ray (1 - exp(-optical depth) through the baked grid, nearest voxel, 1 m steps): a mask for the
// sheet's statistics (which pixels are cloud, thin edge or thick body). Written in the accumulator's format (rgb = alpha, w = 1).
const ALPHA_WGSL = /* wgsl */ `
struct AlphaParams { origin: vec3<f32>, ext: f32, forward: vec3<f32>, voxel: f32, right: vec3<f32>, w: u32, up: vec3<f32>, h: u32, gmin: vec3<f32>, lookup: u32, gmax: vec3<f32>, _b: f32 }
@group(0) @binding(0) var<uniform> P: AlphaParams;
@group(0) @binding(1) var grid: texture_3d<f32>;
@group(0) @binding(2) var<storage, read_write> outAlpha: array<vec4<f32>>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= P.w || gid.y >= P.h) { return; }
  let ndc = vec2((f32(gid.x) + 0.5) / f32(P.w) * 2.0 - 1.0, 1.0 - (f32(gid.y) + 0.5) / f32(P.h) * 2.0);
  let d = normalize(P.forward + P.right * ndc.x + P.up * ndc.y);
  let inv = 1.0 / d;
  let t0 = (P.gmin - P.origin) * inv; let t1 = (P.gmax - P.origin) * inv;
  let tn = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), max(min(t0.z, t1.z), 0.0));
  let tf = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
  var tau = 0.0;
  let dims = vec3<i32>(textureDimensions(grid));
  if (P.lookup == 0u) {
    // PT1: nearest voxel, 1 m steps (kept for Parkouring's mask).
    for (var t = tn + 0.5; t < tf; t += 1.0) {
      let g = vec3<i32>(floor((P.origin + d * t - P.gmin) / P.voxel));
      if (all(g >= vec3(0)) && all(g < dims)) { tau += textureLoad(grid, g, 0).r; }
    }
  } else {
    // P0.4: the path tracer's own lookup (trilinear between voxel centres, zero outside the grid), midpoint steps of a quarter voxel.
    let dt = P.voxel * 0.25;
    for (var t = tn + 0.5 * dt; t < tf; t += dt) {
      let gx = (P.origin + d * t - P.gmin) / P.voxel - 0.5;
      let i0 = vec3<i32>(floor(gx));
      let fr = gx - floor(gx);
      var acc = 0.0;
      for (var c = 0u; c < 8u; c++) {
        let o = vec3<i32>(i32(c & 1u), i32((c >> 1u) & 1u), i32((c >> 2u) & 1u));
        let ii = i0 + o;
        if (all(ii >= vec3(0)) && all(ii < dims)) {
          let wt = select(1.0 - fr.x, fr.x, o.x == 1) * select(1.0 - fr.y, fr.y, o.y == 1) * select(1.0 - fr.z, fr.z, o.z == 1);
          acc += textureLoad(grid, ii, 0).r * wt;
        }
      }
      tau += acc * dt;
    }
  }
  let a = 1.0 - exp(-tau * P.ext);
  outAlpha[gid.y * P.w + gid.x] = vec4(a, a, a, 1.0);
}
`;

/** Closed box with outward winding (the bench's tessellateBox): the medium is on the side its geometric normals point away from. */
function boxMesh(min: V3, max: V3): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const faces: [V3, V3[]][] = [
    [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
    [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
    [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
    [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
    [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
  ];
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  for (const [n, corners] of faces) {
    const base = positions.length / 3;
    for (const c of corners) { positions.push(...c); normals.push(...n); }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export class PtReference {
  device!: GPUDevice;
  caps!: Caps;
  kernel: PtMegakernel | null = null;
  private trace: TraceSceneBuffers | null = null;
  private sceneBuffers: SceneCopyBuffers | null = null;
  private grid: DensityGrid | null = null;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private pipeline!: GPURenderPipeline;
  private displayLayout!: GPUBindGroupLayout;
  private displayParams!: GPUBuffer;
  private displayGroup: GPUBindGroup | null = null;
  width = 0;
  height = 0;
  samples = 0;
  passMs = 0;
  compileMs = 0;
  kernelBytes = 0;
  maxDepth = 512;
  /** Scrambling seed base for the sampler (`?seed=`): two seeds give independent realisations of the same view (the scorecard's noise floor). */
  seed = 1;
  medium: PtMediumParams = { extinction: 0.3, albedo: 0.99, g: 0.8 };
  /** P0.4: the opacity mask's lookup: 'nearest' at 1 m steps (PT1, Parkouring) or 'trilinear' at voxel / 4 (the path tracer's own). */
  alphaFilter: 'nearest' | 'trilinear' = 'nearest';
  /** P0.6: the delta-tracking majorant: 'brick' (8^3 bricks walked by a DDA; what the card used) or 'global' (one scalar, densityMax * sigma_t). */
  majorant: 'brick' | 'global' = 'brick';
  /** Bumped by every reset; a progress loop stops when it changes. */
  epoch = 0;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('PT: no WebGPU adapter');
    const { device, caps } = await requestDeviceForCaps(adapter, detectCaps(adapter), { label: 'pt1 reference' });
    this.device = device; this.caps = caps;
    this.context = canvas.getContext('webgpu') as GPUCanvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device, format: this.format, alphaMode: 'opaque' });
    this.displayLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ] });
    const module = device.createShaderModule({ label: 'pt1 display', code: DISPLAY_WGSL });
    this.pipeline = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [this.displayLayout] }), vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list' } });
    this.displayParams = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  /** (Re)builds the kernel for a density grid and medium: the grid, the majorants and the medium constants are compiled into it. */
  async setMedium(grid: DensityGrid, medium: PtMediumParams, scene: PtSceneParams): Promise<void> {
    const t0 = performance.now();
    this.grid = grid; this.medium = { ...medium };
    this.gridTexture?.destroy(); this.gridTexture = null;
    if (!this.trace) {
      // The medium's boundary is the grid box. Trace scene: one static instance.
      const mesh = boxMesh(grid.min, grid.max);
      const builder = createMeshBvhBuilder();
      const data = await buildTraceScene([{ positions: mesh.positions, indices: mesh.indices }], [{ meshIndex: 0, instanceIndex: 0, objectToWorld: IDENTITY, material: 0, mask: 1, static: true }], { build: g => builder.build(g), mergeStaticInstances: true });
      builder.dispose();
      this.trace = uploadTraceScene(this.device, data, 'pt1 cloud box');
    }
    this.uploadScene(scene);
    const majorant = this.majorant === 'brick' ? brickMajorants(grid.resolution, grid.density) : undefined;
    const integrator = {
      sampler: 'owen-sobol', nee: true, envMap: true, envSampling: 'importance' as const, sunVisible: false,
      volumes: {
        media: [{ sigmaT: [medium.extinction, medium.extinction, medium.extinction] as V3, albedo: [medium.albedo, medium.albedo, medium.albedo] as V3, g: medium.g,
          grid: { resolution: grid.resolution, worldToIndex: gridWorldToIndex(grid.resolution, [grid.min, grid.max]), densityMax: grid.densityMax } }],
        materials: [{ interior: 1, exterior: 0, boundary: true }],
        majorant: this.majorant,
      },
    };
    this.kernel?.destroy();
    this.kernel = await PtMegakernel.create(this.device, this.caps, {
      format: sceneFormatOf({ nodeFormat: this.trace!.nodeFormat, triangleLeaves: this.trace!.triangleLeaves, positionLayout: this.trace!.positionLayout }),
      layout: this.lastLayout, textures: null, integrator,
      volumeGrid: { resolution: grid.resolution, density: grid.density, ...(majorant ? { majorant } : {}) },
      label: 'pt1 cloud',
    });
    this.kernelBytes = this.kernel.wgslBytes;
    this.kernel.setScene(this.trace, this.sceneBuffers!);
    this.compileMs = performance.now() - t0;
    this.displayGroup = null;
  }

  private lastLayout: unknown = null;
  /** Sun and sky (the scene copy). Cheap; call reset() after. */
  uploadScene(scene: PtSceneParams): void {
    const grid = this.grid!;
    const mesh = boxMesh(grid.min, grid.max);
    const env = scene.sky.env;
    const copy = buildSceneCopy({
      meshes: [{ positions: mesh.positions, indices: mesh.indices, normals: mesh.normals }],
      instances: [{ meshIndex: 0, instanceIndex: 0, objectToWorld: IDENTITY, material: 0, mask: 1 }],
      materials: [{ baseColor: [0, 0, 0], baseWeight: 0, specularWeight: 0 }],   // the bench's `interface` material
      sun: scene.noSun ? null : { direction: [-scene.sunDir[0], -scene.sunDir[1], -scene.sunDir[2]], irradiance: scene.sky.sun, angularRadius: 0 },
      environment: { radiance: envMapMean(env), map: env },
      options: { surface: { positions: true } },
    });
    this.lastLayout = copy.layout;
    this.sceneBuffers?.destroy?.();
    this.sceneBuffers = uploadSceneCopy(this.device, copy, { label: 'pt1 scene' });
    this.kernel?.setScene(this.trace, this.sceneBuffers);
  }

  setView(camera: PtLookAtCamera, width: number, height: number): void {
    const k = this.kernel!;
    if (width !== this.width || height !== this.height) { this.width = width; this.height = height; this.displayGroup = null; }
    k.setFilm(width, height);
    k.setCamera(camera);
    k.setLimits({ maxDepth: this.maxDepth, rrStartDepth: 0 });
    k.setSeed(this.seed);
  }

  reset(): void {
    const enc = this.device.createCommandEncoder();
    this.kernel!.reset(enc);
    this.device.queue.submit([enc.finish()]);
    this.samples = 0;
    this.displayGroup = null;
    this.epoch++;
  }

  /** One sample pass per call, timed; resolves when the GPU has finished it. */
  async step(passes = 1): Promise<void> {
    const t0 = performance.now();
    const enc = this.device.createCommandEncoder({ label: 'pt1 passes' });
    this.kernel!.encode(enc, passes);
    this.device.queue.submit([enc.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    this.samples += passes;
    this.passMs = (performance.now() - t0) / passes;
  }

  present(exposure: number): void {
    const accum = this.kernel?.accumulator;
    if (!accum) return;
    this.displayGroup ??= this.device.createBindGroup({ layout: this.displayLayout, entries: [{ binding: 0, resource: { buffer: accum, size: this.width * this.height * 16 } }, { binding: 1, resource: { buffer: this.displayParams } }] });
    this.draw(this.displayGroup, exposure, 0);
  }

  private draw(group: GPUBindGroup, exposure: number, mode: number, size: [number, number] = [this.width, this.height]): void {
    const p = new ArrayBuffer(16); new Uint32Array(p).set(size, 0); new Float32Array(p)[2] = exposure; new Uint32Array(p)[3] = mode;
    this.device.queue.writeBuffer(this.displayParams, 0, p);
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, group); pass.draw(3); pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  /** Shows `data` (accumulator format, rgb = value, w = 1, row 0 = top) raw: the runtime's own opacity read back from its device. */
  presentRaw(data: Float32Array<ArrayBuffer>, width: number, height: number): void {
    const buffer = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buffer, 0, data);
    this.draw(this.device.createBindGroup({ layout: this.displayLayout, entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: this.displayParams } }] }), 1, 1, [width, height]);
    void this.device.queue.onSubmittedWorkDone().then(() => buffer.destroy());
  }

  private gridTexture: GPUTexture | null = null;
  private alphaPipeline: GPUComputePipeline | null = null;
  /** The opacity mask of the current grid from `camera` (same film), shown raw (alpha as grey). */
  async presentAlpha(camera: PtLookAtCamera): Promise<void> {
    const out = await this.computeAlpha(camera);
    this.draw(this.device.createBindGroup({ layout: this.displayLayout, entries: [{ binding: 0, resource: { buffer: out } }, { binding: 1, resource: { buffer: this.displayParams } }] }), 1, 1);
    await this.device.queue.onSubmittedWorkDone();
    out.destroy();
  }

  /** P0.3: the same opacity mask read back (accumulator format: rgb = alpha, w = 1, row 0 = top), at the film size. */
  async readAlpha(camera: PtLookAtCamera): Promise<Float32Array> {
    const out = await this.computeAlpha(camera);
    const size = this.width * this.height * 16;
    const staging = this.device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.device.createCommandEncoder(); enc.copyBufferToBuffer(out, 0, staging, 0, size); this.device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap(); staging.destroy(); out.destroy();
    return data;
  }

  /** Runs the opacity kernel into a new storage buffer (the caller destroys it). */
  private async computeAlpha(camera: PtLookAtCamera): Promise<GPUBuffer> {
    const grid = this.grid!, device = this.device;
    if (!this.gridTexture) {
      this.gridTexture = device.createTexture({ label: 'pt1 alpha grid', size: grid.resolution, dimension: '3d', format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      device.queue.writeTexture({ texture: this.gridTexture }, grid.density as Float32Array<ArrayBuffer>, { bytesPerRow: grid.resolution[0] * 4, rowsPerImage: grid.resolution[1] }, grid.resolution);
    }
    if (!this.alphaPipeline) {
      const module = device.createShaderModule({ label: 'pt1 alpha', code: ALPHA_WGSL });
      const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
      if (errors.length) throw new Error(`pt1 alpha WGSL: ${errors.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
      this.alphaPipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    }
    const sub = (a: readonly number[], b: readonly number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]); return a.map(v => v / l); };
    const cross = (a: number[], b: readonly number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const f = norm(sub(camera.target, camera.position)), r = norm(cross(f, camera.up)), u = cross(r, f);
    const th = Math.tan((camera.yFovDeg * Math.PI) / 360), aspect = this.width / this.height;
    const p = new ArrayBuffer(96), pf = new Float32Array(p), pu = new Uint32Array(p);
    pf.set(camera.position, 0); pf[3] = this.medium.extinction; pf.set(f, 4); pf[7] = grid.voxel;
    pf.set(r.map(v => v * th * aspect), 8); pu[11] = this.width; pf.set(u.map(v => v * th), 12); pu[15] = this.height;
    pf.set(grid.min, 16); pu[19] = this.alphaFilter === 'trilinear' ? 1 : 0; pf.set(grid.max, 20);
    const params = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(params, 0, p);
    const out = device.createBuffer({ size: this.width * this.height * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.alphaPipeline);
    pass.setBindGroup(0, device.createBindGroup({ layout: this.alphaPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: this.gridTexture.createView() }, { binding: 2, resource: { buffer: out } }] }));
    pass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
    pass.end();
    device.queue.submit([enc.finish()]);
    void device.queue.onSubmittedWorkDone().then(() => params.destroy());
    return out;
  }

  /** Linear radiance of the image (accumulator / sample count, rgb; w = 1; row 0 = top): reads the accumulator back. */
  async readLinear(): Promise<Float32Array> {
    const accum = this.kernel!.accumulator!;
    const size = this.width * this.height * 16;
    const staging = this.device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.device.createCommandEncoder(); enc.copyBufferToBuffer(accum, 0, staging, 0, size); this.device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const sums = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap(); staging.destroy();
    for (let i = 0; i < sums.length; i += 4) { const n = Math.max(1, sums[i + 3]); sums[i] /= n; sums[i + 1] /= n; sums[i + 2] /= n; sums[i + 3] = 1; }
    return sums;
  }
}
