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
export interface PtSceneParams { sunDir: V3; sky: SkyBake }

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
  return vec4(srgb(aces(L, display.exposure)), 1.0);
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
  medium: PtMediumParams = { extinction: 0.3, albedo: 0.99, g: 0.8 };
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
    if (!this.trace) {
      // The medium's boundary is the grid box. Trace scene: one static instance.
      const mesh = boxMesh(grid.min, grid.max);
      const builder = createMeshBvhBuilder();
      const data = await buildTraceScene([{ positions: mesh.positions, indices: mesh.indices }], [{ meshIndex: 0, instanceIndex: 0, objectToWorld: IDENTITY, material: 0, mask: 1, static: true }], { build: g => builder.build(g), mergeStaticInstances: true });
      builder.dispose();
      this.trace = uploadTraceScene(this.device, data, 'pt1 cloud box');
    }
    this.uploadScene(scene);
    const majorant = brickMajorants(grid.resolution, grid.density);
    const integrator = {
      sampler: 'owen-sobol', nee: true, envMap: true, envSampling: 'importance' as const, sunVisible: false,
      volumes: {
        media: [{ sigmaT: [medium.extinction, medium.extinction, medium.extinction] as V3, albedo: [medium.albedo, medium.albedo, medium.albedo] as V3, g: medium.g,
          grid: { resolution: grid.resolution, worldToIndex: gridWorldToIndex(grid.resolution, [grid.min, grid.max]), densityMax: grid.densityMax } }],
        materials: [{ interior: 1, exterior: 0, boundary: true }],
        majorant: 'brick' as const,
      },
    };
    this.kernel?.destroy();
    this.kernel = await PtMegakernel.create(this.device, this.caps, {
      format: sceneFormatOf({ nodeFormat: this.trace!.nodeFormat, triangleLeaves: this.trace!.triangleLeaves, positionLayout: this.trace!.positionLayout }),
      layout: this.lastLayout, textures: null, integrator,
      volumeGrid: { resolution: grid.resolution, density: grid.density, majorant },
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
      sun: { direction: [-scene.sunDir[0], -scene.sunDir[1], -scene.sunDir[2]], irradiance: scene.sky.sun, angularRadius: 0 },
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
    k.setSeed(1);
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
    const p = new ArrayBuffer(16); new Uint32Array(p).set([this.width, this.height], 0); new Float32Array(p)[2] = exposure;
    this.device.queue.writeBuffer(this.displayParams, 0, p);
    this.displayGroup ??= this.device.createBindGroup({ layout: this.displayLayout, entries: [{ binding: 0, resource: { buffer: accum, size: this.width * this.height * 16 } }, { binding: 1, resource: { buffer: this.displayParams } }] });
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.displayGroup); pass.draw(3); pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  /** Mean linear radiance of the image (for the report): reads the accumulator back. */
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
