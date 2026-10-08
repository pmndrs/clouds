// `Clouds`: drop-in volumetric clouds for a three WebGPU RenderPipeline. See work/specs/P2-api.md.
//
//   const clouds = new Clouds(renderer, { sky, quality: 'high' })
//   await clouds.load({ volume: '/clouds/parkouring/', position: [0, 500, 0] })
//   post.outputNode = clouds.node(sky.applyHaze(scenePass.getTextureNode(), { scenePass }), scenePass)
//
// The node's updateBefore (NodeUpdateType.FRAME) runs after scenePass rendered: it records the runtime's compute passes into
// its own command encoder with three's device and submits it, then the fragment shader blends `color * a + rgb`.
import { HalfFloatType, Matrix4, Vector3, type PerspectiveCamera } from 'three';
import { NodeUpdateType, StorageTexture, TempNode, type WebGPURenderer } from 'three/webgpu';
import { Fn, abs, float, max, mix, smoothstep, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import {
  createAtmosphereBindGroupLayout, createCloudRuntime, GpuTimer, loadCloudNoise, loadCloudVolume,
  type CloudFrame, type CloudNoiseAsset, type CloudQuality, type CloudRuntime, type CloudSettings, type CloudVolumeAsset, type GpuCloudVolume,
} from '@clouds/runtime';
import type { Sky } from '@pmndrs/sky';
import { sharedBackend, type SharedBackend } from './interop';
import { createSkyBridge, type SkyBridge } from './sky-bridge';
import { createUniformLighting, type UniformLighting, type UniformLightingValues } from './uniform-lighting';

export interface CloudsOptions {
  /** A @pmndrs/sky Sky. Sun, ambient and aerial perspective then come from its LUTs. Omit for uniform lighting. */
  sky?: Sky;
  quality?: CloudQuality;
  /** Initial values for the sky-less lighting (see `clouds.lighting`). */
  lighting?: Partial<UniformLightingValues>;
  /** World-space planet centre for sky planet mode (`sky.update(camera, { planetCenter })`). */
  planetCenter?: Vector3 | null;
}
export interface CloudsLoadOptions {
  /** Base URL of a cloud pack (nvdf/sdf + json), e.g. '/clouds/parkouring/'. */
  volume: string;
  /** Noise pack URL. Default '/clouds/noise/'. */
  noise?: string;
  /** World position of the volume's base centre: x/z centre, y = base height. */
  position: [number, number, number];
}
export interface SetVolumeOptions { position: [number, number, number] }

// three's node types are incomplete; setup/updateBefore take any like three's own display nodes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

type Lighting = { bindGroup: GPUBindGroup; sunDirection: ArrayLike<number>; update(camera: PerspectiveCamera): void; dispose(): void };

export class Clouds {
  readonly renderer: WebGPURenderer;
  readonly sky: Sky | undefined;
  /** Sky-less lighting values (sun/ambient radiance); mutate freely. Undefined when a sky drives the lighting. */
  readonly lighting: UniformLightingValues | undefined;
  private readonly backend: SharedBackend;
  private readonly device: GPUDevice;
  private readonly runtime: CloudRuntime;
  private readonly timer: GpuTimer;
  private readonly layout: GPUBindGroupLayout;
  private readonly uniformLighting: UniformLighting | undefined;
  private readonly options: CloudsOptions;
  private skyBridge: SkyBridge | undefined;
  private readonly cloudTexture = new StorageTexture(1, 1);
  /** three-owned copy of the runtime's reflection dome (see `reflection()`); refreshed by a texture copy in the node's encoder. */
  private readonly domeTexture: StorageTexture;
  private domeGpu: GPUTexture | undefined;
  private readonly ready = uniform(0);
  private disposed = false;
  private width = 0;
  private height = 0;
  private frameIndex = 0;
  private readonly t0 = performance.now();
  private warnedMsaa = false;
  private frame: CloudFrame;
  private readonly viewProj = new Matrix4();
  private readonly invViewProj = new Matrix4();
  private readonly previous = new Matrix4();
  private readonly cameraPosition = new Vector3();
  private readonly cameraPositionArray = [0, 0, 0];
  private readonly depthViews = new WeakMap<GPUTexture, GPUTextureView>();
  private readonly nodes = new Set<CloudsNode>();

  /** The renderer must be initialised (`await renderer.init()`); with a sky, compile it (`await sky.compileAsync()`) before `load()`. */
  constructor(renderer: WebGPURenderer, options: CloudsOptions = {}) {
    this.renderer = renderer;
    this.options = options;
    this.sky = options.sky;
    this.backend = sharedBackend(renderer);
    this.device = this.backend.device;
    this.layout = createAtmosphereBindGroupLayout(this.device);
    this.runtime = createCloudRuntime(this.device, { quality: options.quality ?? 'high', atmosphereLayout: this.layout });
    this.timer = new GpuTimer(this.device);
    if (!options.sky) {
      this.uniformLighting = createUniformLighting(this.device, this.layout, options.lighting);
      this.lighting = this.uniformLighting.values;
    }
    const domeSize = this.runtime.dome.size;
    this.domeTexture = new StorageTexture(domeSize, domeSize);
    this.domeTexture.type = HalfFloatType; this.domeTexture.generateMipmaps = false; this.domeTexture.name = 'cloud reflection dome';
    this.cloudTexture.type = HalfFloatType; this.cloudTexture.generateMipmaps = false; this.cloudTexture.name = 'cloud composite';
    this.frame = {
      view: new Float32Array(16), projection: new Float32Array(16), viewProjection: new Float32Array(16), inverseViewProjection: new Float32Array(16), previousViewProjection: new Float32Array(16),
      cameraPosition: this.cameraPositionArray, depth: undefined as unknown as GPUTextureView, depthKind: 'depth32float',
      sunDirection: [0, 1, 0], atmosphere: undefined as unknown as GPUBindGroup, time: 0, frameIndex: 0,
    };
  }

  /** Live knobs (densityScale, shadowStrength, ...). */
  get settings(): CloudSettings { return this.runtime.settings; }
  /** Rolling-average GPU ms per cloud pass (empty without timestamp-query). */
  get timings(): Record<string, number> { return this.timer.averages(); }
  /** True once volume and noise are loaded and the first frame sized the output. */
  get isReady(): boolean { return this.runtime.ready; }
  /** The runtime (escape hatch for tooling). */
  get core(): CloudRuntime { return this.runtime; }
  setQuality(quality: CloudQuality): void { this.runtime.setQuality(quality); }

  /** Loads a cloud pack and the noise, places it, and returns the volume asset (for framing a camera, for instance). */
  async load(options: CloudsLoadOptions): Promise<CloudVolumeAsset> {
    const [asset, noise] = await Promise.all([loadCloudVolume(options.volume), loadCloudNoise(options.noise ?? '/clouds/noise/')]);
    await this.setNoise(noise);
    await this.setVolume(asset, { position: options.position });
    return asset;
  }
  async setNoise(noise: CloudNoiseAsset): Promise<void> { await this.runtime.setNoise(noise); }
  /**
   * `position` is the volume's base centre in world metres. A `GpuCloudVolume` (volume generator output) stays caller-owned:
   * the runtime never destroys it, so keep the generator alive while it is shown.
   */
  async setVolume(volume: GpuCloudVolume | CloudVolumeAsset, options: SetVolumeOptions): Promise<void> {
    const [ex, , ez] = 'extentMeters' in volume ? volume.extentMeters : [volume.dims[0] * volume.voxelSizeMeters, 0, volume.dims[1] * volume.voxelSizeMeters];
    await this.runtime.setVolume(volume, { position: [options.position[0] - ex / 2, options.position[1], options.position[2] - ez / 2] });
  }

  /**
   * Cloud reflection for a reflective material: `vec4(rgb, T)` for a world-space direction `dirNode` (any vec3 node; need not be
   * normalised). rgb is premultiplied cloud radiance and T the transmittance, in the sky's exposure units; blend as
   * `env * T + rgb`. Directions at or below the horizon give (0, 0, 0, 1). The dome is seen from one reference point (the camera's
   * x/z at ground level by default), which suits large flat reflectors like water; it lags the main view by about a frame.
   * Implementation: a three StorageTexture copy of `runtime.dome.texture` (the copy is recorded with the cloud passes), sampled bilinearly
   * with the octahedral decode `uv = (x, z) / (|x| + |y| + |z|) * 0.5 + 0.5` (the upper hemisphere is the central diamond, so no fold is needed).
   */
  reflection(dirNode: AnyNode): AnyNode {
    const dome = this.domeTexture;
    return Fn(() => {
      const d = vec3(dirNode);
      const up = max(d.y, float(0));
      const l = abs(d.x).add(up).add(abs(d.z)).max(float(1e-6));
      const uv = vec2(d.x, d.z).div(l).mul(0.5).add(0.5);
      const s = texture(dome, uv).level(float(0));
      return mix(vec4(0, 0, 0, 1), s, smoothstep(float(0), float(0.02), d.y.div(d.length().max(float(1e-6)))));
    })();
  }

  /**
   * TSL node: `color * cloud.a + cloud.rgb`. `colorNode` is the scene colour (hazed or not); `scenePass` supplies depth and camera.
   * Do not give `scenePass` MSAA: its depth is read as a plain texture, so its render target samples are forced to 0.
   */
  node(colorNode: AnyNode, scenePass: AnyNode): AnyNode {
    scenePass.options.samples ??= 0;
    const node = new CloudsNode(this, colorNode, scenePass);
    this.nodes.add(node);
    return node;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ready.value = 0;
    this.runtime.dispose(); this.skyBridge?.dispose(); this.uniformLighting?.dispose(); this.cloudTexture.dispose(); this.domeTexture.dispose();
    for (const n of this.nodes) n.dispose();
    this.nodes.clear();
  }

  /** @internal */ get _cloudTexture(): StorageTexture { return this.cloudTexture; }
  /** @internal */ get _ready() { return this.ready; }

  private lightingSource(): Lighting | null {
    if (this.uniformLighting) return { bindGroup: this.uniformLighting.bindGroup, sunDirection: this.uniformLighting.sunDirection, update: () => this.uniformLighting!.update(), dispose() {} };
    if (!this.skyBridge) {
      try { this.skyBridge = createSkyBridge(this.renderer, this.sky!, { planetCenter: this.options.planetCenter, layout: this.layout }); } catch { return null; } // LUTs not compiled yet; retry next frame
    }
    const bridge = this.skyBridge;
    return { bindGroup: bridge.bindGroup, sunDirection: bridge.values.sunDirection, update: camera => bridge.update(camera), dispose() {} };
  }

  /** @internal Runs in the node's updateBefore, after the scene pass rendered. */
  _render(scenePass: AnyNode): void {
    if (this.disposed) return;
    const camera = scenePass.camera as PerspectiveCamera;
    const depthTexture = scenePass.renderTarget?.depthTexture;
    const lighting = this.lightingSource();
    const depthGpu = depthTexture ? this.backend.tryTexture(depthTexture) : null;
    if (!lighting || !depthGpu) { this.ready.value = 0; return; }
    if (depthGpu.sampleCount > 1) {
      if (!this.warnedMsaa) { this.warnedMsaa = true; console.warn('@clouds/three: the scene pass depth is multisampled; clouds are skipped. Create the pass with { samples: 0 }.'); }
      this.ready.value = 0; return;
    }
    if (depthGpu.width !== this.width || depthGpu.height !== this.height) {
      this.width = depthGpu.width; this.height = depthGpu.height;
      this.cloudTexture.setSize(this.width, this.height, 1);
      this.renderer.initTexture(this.cloudTexture);
      this.runtime.resize(this.width, this.height, this.backend.texture(this.cloudTexture));
    }
    if (!this.runtime.ready) { this.ready.value = 0; return; }

    lighting.update(camera);
    camera.updateMatrixWorld();
    const f = this.frame;
    this.previous.fromArray(f.viewProjection);
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.invViewProj.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    camera.matrixWorldInverse.toArray(f.view); camera.projectionMatrix.toArray(f.projection);
    this.viewProj.toArray(f.viewProjection); this.invViewProj.toArray(f.inverseViewProjection); this.previous.toArray(f.previousViewProjection);
    camera.getWorldPosition(this.cameraPosition).toArray(this.cameraPositionArray);
    let view = this.depthViews.get(depthGpu);
    if (!view) this.depthViews.set(depthGpu, view = depthGpu.createView({ aspect: 'depth-only' }));
    f.depth = view; f.depthKind = depthGpu.format === 'depth32float' ? 'depth32float' : 'depth24plus';
    f.sunDirection = lighting.sunDirection; f.atmosphere = lighting.bindGroup;
    f.time = (performance.now() - this.t0) / 1000; f.frameIndex = this.frameIndex++;

    this.timer.beginFrame();
    const encoder = this.device.createCommandEncoder({ label: 'clouds encoder' });
    this.runtime.encode(encoder, f, this.timer);
    if (!this.domeGpu) { this.renderer.initTexture(this.domeTexture); this.domeGpu = this.backend.tryTexture(this.domeTexture) ?? undefined; }
    if (this.domeGpu) { const n = this.runtime.dome.size; encoder.copyTextureToTexture({ texture: this.runtime.dome.texture }, { texture: this.domeGpu }, [n, n]); }
    this.timer.endFrame(encoder);
    this.device.queue.submit([encoder.finish()]);
    this.ready.value = 1;
  }
}

class CloudsNode extends TempNode<'vec4'> {
  constructor(private readonly clouds: Clouds, private readonly color: AnyNode, private readonly scenePass: AnyNode) {
    super('vec4');
    (this as unknown as { updateBeforeType: unknown }).updateBeforeType = NodeUpdateType.FRAME;
  }

  setup(builder: AnyNode): AnyNode {
    // Register the inputs as graph dependencies so three renders them (scene pass first) before our updateBefore.
    const props = builder.getNodeProperties(this);
    props.colorNode = this.color;
    props.depthNode = this.scenePass.getTextureNode('depth');
    const cloud = texture(this.clouds._cloudTexture);
    const color = vec4(this.color);
    const blended = vec4(color.rgb.mul(cloud.a).add(cloud.rgb), color.a);
    return mix(color, blended, this.clouds._ready.mul(float(1)));
  }

  updateBefore(_frame: AnyNode): undefined { this.clouds._render(this.scenePass); return undefined; }
}
