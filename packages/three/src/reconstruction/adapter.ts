import { Matrix4, Texture } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import {
  QualityMode,
  Upscaler,
  type RuntimeSettings,
  type UpscalePath,
} from '@pmndrs/upscaler';

import { sharedBackend } from '../gpu/backend';

/** A Three texture or a native texture created by the renderer's device. */
export type ReconstructionTexture = Texture | GPUTexture;

export type ReconstructionMode =
  | 'native'
  | 'bilinear'
  | 'spatial'
  | 'temporal'
  | 'final-scene-spatial'
  | 'final-scene-temporal'
  // Friendly aliases for callers comparing the two FSR generations.
  | 'fsr1'
  | 'fsr3';

export interface ReconstructionConfig {
  displayWidth?: number;
  displayHeight?: number;
  width?: number;
  height?: number;
  /** Input size. If omitted, the upscaler derives it from the ratio/quality. */
  renderWidth?: number;
  renderHeight?: number;
  customUpscaleRatio?: number;
  /** Internal resolution fraction; `0.5` means a 2× upscale ratio. */
  scale?: number;
  qualityMode?: QualityMode;
  mode?: ReconstructionMode;
  /** `path` is accepted as an alias for `mode` for configuration symmetry. */
  path?: ReconstructionMode;
  /** Temporal jitter is enabled by default for the temporal path. */
  jitter?: boolean;
}

export interface ReconstructionGuides {
  /** One packed cloud guide texture: xy=NDC motion, z=device depth, w=reactivity. */
  packed: ReconstructionTexture;
}

export interface ReconstructionFrame {
  /** Linear HDR composed scene color at render resolution. Optical L/T uses the separate resolver. */
  color: ReconstructionTexture;
  /** Three depth texture, or the packed cloud guide texture. */
  depth?: ReconstructionTexture;
  /** Jitter-free NDC current-minus-previous velocity. */
  velocity?: ReconstructionTexture;
  /** Render-resolution reactivity mask (red channel in [0, 1]). */
  reactive?: ReconstructionTexture;
  guides?: ReconstructionGuides | ReconstructionTexture;
  /** Optional simulation time. Used to derive deltaTime when it is omitted. */
  time?: number;
  deltaTime?: number;
  /** Explicitly drop temporal history (camera cut, teleport, or resize). */
  reset?: boolean;
  /** Alias kept for callers that label cuts separately. */
  cut?: boolean;
  cutReset?: boolean;
  /** A changed key also drops history; useful for camera/volume identity. */
  resetKey?: string | number;
}

export interface ReconstructionAdapterOptions {
  /** Defaults to false for opaque final-scene output. */
  alpha?: boolean;
}

export interface ReconstructionMetrics {
  readonly gpuTimings: ReadonlyMap<string, number>;
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly upscaleRatio: number;
  readonly mode: ReconstructionMode;
}

type Backend = {
  device: GPUDevice;
  get(object: object): { texture?: GPUTexture };
  set(object: object, value: { texture: GPUTexture }): void;
  delete?(object: object): void;
};

const UNPACK_SHADER = /* wgsl */ `
@group(0) @binding(0) var packed : texture_2d<f32>;
@group(0) @binding(1) var velocityOut : texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var reactiveOut : texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let size = textureDimensions(packed);
  if (any(gid.xy >= size)) { return; }
  let guide = textureLoad(packed, vec2i(gid.xy), 0);
  textureStore(velocityOut, gid.xy, vec4f(guide.xy, 0.0, 0.0));
  textureStore(reactiveOut, gid.xy, vec4f(clamp(guide.w, 0.0, 1.0), 0.0, 0.0, 1.0));
}
`;

// Depth formats cannot be storage writes. The depth lane is therefore unpacked
// by a depth-only render pass, preserving the texture_depth_2d contract used by
// @pmndrs/upscaler's reconstruct pass.
const DEPTH_UNPACK_SHADER = /* wgsl */ `
var<private> positions = array<vec2f, 3>(
  vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0)
);

@group(0) @binding(0) var packed : texture_2d<f32>;

@vertex
fn vertex(@builtin(vertex_index) index : u32) -> @builtin(position) vec4f {
  return vec4f(positions[index], 0.0, 1.0);
}

@fragment
fn fragment(@builtin(position) position : vec4f) -> @builtin(frag_depth) f32 {
  let pixel = vec2i(floor(position.xy));
  return textureLoad(packed, pixel, 0).z;
}
`;

/** Pure helper used by the adapter and lifecycle tests. */
export function resetKeyChanged(
  previous: string | number | undefined,
  next: string | number | undefined,
): boolean {
  return previous !== undefined && next !== undefined && !Object.is(previous, next);
}

/** Resolves a frame's clock without creating an animation loop. */
export function resolveDeltaTime(
  previousTime: number | undefined,
  time: number | undefined,
  explicit: number | undefined,
): number {
  if (explicit !== undefined) return Math.max(0, Math.min(explicit, 0.1));
  if (time === undefined || previousTime === undefined) return 1 / 60;
  return Math.max(0, Math.min(time - previousTime, 0.1));
}

function modePath(mode: ReconstructionMode): { mode: ReconstructionMode; path: UpscalePath; jitter: boolean } {
  switch (mode) {
    case 'native':
      return { mode, path: 'bilinear', jitter: false };
    case 'bilinear':
      return { mode, path: 'bilinear', jitter: false };
    case 'spatial':
    case 'final-scene-spatial':
    case 'fsr1':
      return { mode, path: 'spatial', jitter: false };
    case 'fsr3':
    case 'final-scene-temporal':
    case 'temporal':
      return { mode, path: 'temporal', jitter: true };
  }
}

function isThreeTexture(value: ReconstructionTexture): value is Texture {
  return (value as Texture).isTexture === true;
}

/**
 * Imperative Three/WebGPU adapter for the author's actual FSR1/FSR3 runtime.
 * It owns one {@link Upscaler}, one history, and the small GPU unpack set used
 * by packed cloud guides. It never starts a loop and never keeps a second
 * temporal history.
 */
export class ReconstructionAdapter {
  readonly upscaler: Upscaler;
  readonly unjitteredProjectionMatrix: Matrix4;

  private readonly renderer: WebGPURenderer;
  private readonly backend: Backend;
  private readonly ownedWrappers = new Set<Texture>();
  private readonly wrapperCache = new WeakMap<object, Texture>();
  private readonly alpha: boolean;
  private unpackPipeline?: GPUComputePipeline;
  private depthPipeline?: GPURenderPipeline;
  private guideVelocity?: Texture;
  private guideReactive?: Texture;
  private guideDepth?: Texture;
  private guideVelocityGPU?: GPUTexture;
  private guideReactiveGPU?: GPUTexture;
  private guideDepthGPU?: GPUTexture;
  private modeValue: ReconstructionMode = 'temporal';
  private frameOpen = false;
  private frameCamera?: Parameters<Upscaler['beginFrame']>[0];
  private disposed = false;
  private previousTime?: number;
  private previousResetKey?: string | number;

  constructor(renderer: WebGPURenderer, options: ReconstructionAdapterOptions = {}) {
    this.renderer = renderer;
    this.backend = (renderer as unknown as { backend: Backend }).backend;
    // sharedBackend performs the initialized/WebGPU capability check and keeps
    // this adapter on the same device as Three and the cloud integrator.
    sharedBackend(renderer);
    this.alpha = options.alpha ?? false;
    this.upscaler = new Upscaler({ renderer, alpha: this.alpha });
    this.upscaler.init();
    this.unjitteredProjectionMatrix = this.upscaler.unjitteredProjectionMatrix;
  }

  configure(config: ReconstructionConfig): void {
    this.ensureAlive();
    if (this.frameOpen) throw new Error('Cannot reconfigure reconstruction during an open frame.');
    const displayWidth = config.displayWidth ?? config.width;
    const displayHeight = config.displayHeight ?? config.height;
    if (!Number.isInteger(displayWidth) || displayWidth! < 1 ||
        !Number.isInteger(displayHeight) || displayHeight! < 1) {
      throw new Error('Reconstruction display size must be positive integers.');
    }
    if ((config.renderWidth === undefined) !== (config.renderHeight === undefined)) {
      throw new Error('Reconstruction renderWidth and renderHeight must be provided together.');
    }
    if (config.renderWidth !== undefined &&
        (!Number.isInteger(config.renderWidth) || config.renderWidth < 1 ||
         !Number.isInteger(config.renderHeight) || config.renderHeight! < 1)) {
      throw new Error('Reconstruction render size must be positive integers.');
    }
    if (config.scale !== undefined &&
        (!Number.isFinite(config.scale) || config.scale <= 0 || config.scale > 1)) {
      throw new Error('Reconstruction scale must be finite and between 0 and 1.');
    }
    const selected = modePath(config.mode ?? config.path ?? 'temporal');
    const customUpscaleRatio = config.customUpscaleRatio ??
      (config.scale === undefined ? undefined : 1 / config.scale);
    if (customUpscaleRatio !== undefined &&
        (!Number.isFinite(customUpscaleRatio) || customUpscaleRatio <= 0)) {
      throw new Error('Reconstruction scale must be a positive finite number.');
    }
    const upscalerConfig = {
      displayWidth: displayWidth!,
      displayHeight: displayHeight!,
      renderWidth: config.renderWidth,
      renderHeight: config.renderHeight,
      customUpscaleRatio,
      qualityMode: config.qualityMode,
      path: selected.path,
      jitter: selected.jitter && (config.jitter ?? true),
    };
    this.upscaler.configure(upscalerConfig);
    this.modeValue = selected.mode;
    this.disposeGuideTextures();
    this.previousTime = undefined;
    this.previousResetKey = undefined;
  }

  get mode(): ReconstructionMode { return this.modeValue; }
  get outputTexture(): Texture { return this.upscaler.outputTexture as Texture; }
  get output(): Texture { return this.outputTexture; }
  get renderWidth(): number { return this.upscaler.renderWidth; }
  get renderHeight(): number { return this.upscaler.renderHeight; }
  get displayWidth(): number { return this.upscaler.displayWidth; }
  get displayHeight(): number { return this.upscaler.displayHeight; }
  get upscaleRatio(): number { return this.upscaler.upscaleRatio; }
  get gpuTimings(): ReadonlyMap<string, number> { return this.upscaler.gpuTimings; }
  get metrics(): ReconstructionMetrics {
    return {
      gpuTimings: this.gpuTimings,
      renderWidth: this.renderWidth,
      renderHeight: this.renderHeight,
      displayWidth: this.displayWidth,
      displayHeight: this.displayHeight,
      upscaleRatio: this.upscaleRatio,
      mode: this.mode,
    };
  }
  get settings(): RuntimeSettings { return this.upscaler.settings; }

  beginFrame(camera: Parameters<Upscaler['beginFrame']>[0]): void {
    this.ensureAlive();
    if (this.frameOpen) throw new Error('Reconstruction frame already began.');
    this.upscaler.beginFrame(camera);
    this.frameOpen = true;
    this.frameCamera = camera;
  }

  endFrame(camera: Parameters<Upscaler['endFrame']>[0]): void {
    this.ensureAlive();
    if (!this.frameOpen) return;
    this.upscaler.endFrame(camera);
    this.frameOpen = false;
    this.frameCamera = undefined;
  }

  resetHistory(): void {
    this.ensureAlive();
    this.upscaler.resetHistory();
  }

  /** Marks a non-camera change (wind, lighting, density, or resource edit). */
  invalidate(_reason?: string): void {
    this.resetHistory();
  }

  applySettings(settings: Partial<RuntimeSettings>): void {
    this.ensureAlive();
    Object.assign(this.upscaler.settings, settings);
  }

  dispatch(frame: ReconstructionFrame, camera: Parameters<Upscaler['dispatch']>[1]): void {
    this.ensureAlive();
    const color = this.asThreeTexture(frame.color, 'reconstruction-color');
    const reset = Boolean(
      frame.reset || frame.cut || frame.cutReset ||
      resetKeyChanged(this.previousResetKey, frame.resetKey),
    );
    const deltaTime = resolveDeltaTime(this.previousTime, frame.time, frame.deltaTime);
    if (frame.time !== undefined) this.previousTime = frame.time;
    if (frame.resetKey !== undefined) this.previousResetKey = frame.resetKey;

    let depth = frame.depth;
    let velocity = frame.velocity;
    let reactive = frame.reactive;
    const packed = frame.guides === undefined
      ? undefined
      : 'packed' in (frame.guides as object)
        ? (frame.guides as ReconstructionGuides).packed
        : frame.guides as ReconstructionTexture;
    if (packed !== undefined) {
      this.unpackGuides(this.asThreeTexture(packed, 'reconstruction-packed-guides'));
      depth = this.guideDepth!;
      velocity = this.guideVelocity!;
      reactive = reactive ?? this.guideReactive!;
    }

    const path = modePath(this.mode).path;
    if (path === 'temporal' && (!depth || !velocity)) {
      throw new Error('Temporal reconstruction requires depth and velocity or packed guides.');
    }
    this.upscaler.dispatch({
      color,
      depth: depth ? this.asThreeTexture(depth, 'reconstruction-depth') : undefined,
      velocity: velocity ? this.asThreeTexture(velocity, 'reconstruction-velocity') : undefined,
      reactive: reactive ? this.asThreeTexture(reactive, 'reconstruction-reactive') : undefined,
      reset,
      deltaTime,
    }, camera);
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.frameOpen && this.frameCamera) {
      // Restore a camera left jittered by an interrupted owner frame.
      this.upscaler.endFrame(this.frameCamera);
    }
    this.disposed = true;
    if (this.frameOpen) this.frameOpen = false;
    this.frameCamera = undefined;
    this.disposeGuideTextures();
    this.upscaler.dispose();
    for (const wrapper of this.ownedWrappers) this.backend.delete?.(wrapper);
    this.ownedWrappers.clear();
  }

  private asThreeTexture(value: ReconstructionTexture, label: string): Texture {
    if (isThreeTexture(value)) return value;
    const cached = this.wrapperCache.get(value);
    if (cached) return cached;
    const texture = new Texture({ width: value.width, height: value.height });
    texture.name = label;
    texture.generateMipmaps = false;
    this.backend.set(texture, { texture: value });
    this.wrapperCache.set(value, texture);
    this.ownedWrappers.add(texture);
    return texture;
  }

  private unpackGuides(packed: Texture): void {
    const packedGPU = this.backend.get(packed).texture;
    if (!packedGPU) throw new Error('Packed reconstruction guides are not initialized on the GPU.');
    if (packedGPU.width !== this.renderWidth || packedGPU.height !== this.renderHeight) {
      throw new Error(`Packed reconstruction guides must be ${this.renderWidth}×${this.renderHeight}.`);
    }
    this.ensureGuideTextures();
    const device = this.backend.device;
    if (!this.unpackPipeline) {
      this.unpackPipeline = device.createComputePipeline({
        label: 'clouds-reconstruction-guide-unpack',
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: UNPACK_SHADER }), entryPoint: 'main' },
      });
    }
    if (!this.depthPipeline) {
      this.depthPipeline = device.createRenderPipeline({
        label: 'clouds-reconstruction-depth-unpack',
        layout: 'auto',
        vertex: { module: device.createShaderModule({ code: DEPTH_UNPACK_SHADER }), entryPoint: 'vertex' },
        fragment: { module: device.createShaderModule({ code: DEPTH_UNPACK_SHADER }), entryPoint: 'fragment', targets: [] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'always' },
      });
    }
    const unpackBindGroup = device.createBindGroup({
      layout: this.unpackPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: packedGPU.createView() },
        { binding: 1, resource: this.guideVelocityGPU!.createView() },
        { binding: 2, resource: this.guideReactiveGPU!.createView() },
      ],
    });
    const depthBindGroup = device.createBindGroup({
      layout: this.depthPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: packedGPU.createView() }],
    });
    const encoder = device.createCommandEncoder({ label: 'clouds-reconstruction-guide-unpack' });
    const compute = encoder.beginComputePass();
    compute.setPipeline(this.unpackPipeline);
    compute.setBindGroup(0, unpackBindGroup);
    compute.dispatchWorkgroups(Math.ceil(this.renderWidth / 8), Math.ceil(this.renderHeight / 8));
    compute.end();
    const depthPass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: this.guideDepthGPU!.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    depthPass.setPipeline(this.depthPipeline);
    depthPass.setBindGroup(0, depthBindGroup);
    depthPass.draw(3);
    depthPass.end();
    device.queue.submit([encoder.finish()]);
  }

  private ensureGuideTextures(): void {
    if (this.guideDepthGPU) return;
    const device = this.backend.device;
    this.guideVelocityGPU = device.createTexture({
      label: 'clouds-reconstruction-velocity', size: [this.renderWidth, this.renderHeight],
      format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    this.guideReactiveGPU = device.createTexture({
      label: 'clouds-reconstruction-reactive', size: [this.renderWidth, this.renderHeight],
      format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    this.guideDepthGPU = device.createTexture({
      label: 'clouds-reconstruction-depth', size: [this.renderWidth, this.renderHeight],
      format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.guideVelocity = this.wrapOwnedTexture(this.guideVelocityGPU, 'clouds-reconstruction-velocity');
    this.guideReactive = this.wrapOwnedTexture(this.guideReactiveGPU, 'clouds-reconstruction-reactive');
    this.guideDepth = this.wrapOwnedTexture(this.guideDepthGPU, 'clouds-reconstruction-depth');
  }

  private wrapOwnedTexture(gpu: GPUTexture, label: string): Texture {
    const texture = this.asThreeTexture(gpu, label);
    return texture;
  }

  private disposeGuideTextures(): void {
    this.unpackPipeline = undefined;
    this.depthPipeline = undefined;
    for (const [wrapper, gpu] of [
      [this.guideVelocity, this.guideVelocityGPU],
      [this.guideReactive, this.guideReactiveGPU],
      [this.guideDepth, this.guideDepthGPU],
    ] as const) {
      if (wrapper) this.backend.delete?.(wrapper);
      if (gpu) gpu.destroy();
      if (wrapper) {
        this.ownedWrappers.delete(wrapper);
        if (gpu) this.wrapperCache.delete(gpu);
      }
    }
    this.guideVelocity = undefined;
    this.guideReactive = undefined;
    this.guideDepth = undefined;
    this.guideVelocityGPU = undefined;
    this.guideReactiveGPU = undefined;
    this.guideDepthGPU = undefined;
  }

  private ensureAlive(): void {
    if (this.disposed) throw new Error('Reconstruction adapter has been disposed.');
  }
}

export function createReconstructionAdapter(
  renderer: WebGPURenderer,
  options?: ReconstructionAdapterOptions,
): ReconstructionAdapter {
  return new ReconstructionAdapter(renderer, options);
}
