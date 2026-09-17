import { HalfFloatType, RGBAFormat, StorageTexture, type Texture, type WebGPURenderer } from 'three/webgpu';
import { sharedBackend } from '../gpu/backend';
import { createComputeTimer } from '../gpu/timer';
import { OPTICAL_RESOLVE_WGSL } from './shader';

export interface OpticalResolveRenderOptions {
  /** Conventional WebGPU camera near plane in world units. */
  readonly cameraNear?: number;
  /** Conventional WebGPU camera far plane in world units. */
  readonly cameraFar?: number;
  /** Relative linear-eye-depth rejection threshold. Defaults to 3%. */
  readonly depthThreshold?: number;
  /** Resolve timestamps for the opt-in GPU diagnostic. */
  readonly measure?: boolean;
}

export interface OpticalResolve {
  readonly output: StorageTexture;
  readonly shader: string;
  resize(displayWidth: number, displayHeight: number): void;
  render(
    opticalLow: Texture,
    sceneColorFull: Texture,
    sceneDepthFull: Texture,
    cameraNearOrOptions?: number | OpticalResolveRenderOptions,
    cameraFar?: number,
    measure?: boolean,
  ): void;
  measureGpu(
    opticalLow: Texture,
    sceneColorFull: Texture,
    sceneDepthFull: Texture,
    cameraNearOrOptions?: number | OpticalResolveRenderOptions,
    cameraFar?: number,
  ): Promise<number | null>;
  dispose(): void;
}

type TextureImageSize = { width?: number; height?: number };

function imageSize(texture: Texture): [number, number] | null {
  const image = (texture as unknown as { image?: TextureImageSize }).image;
  if (!image || !Number.isFinite(image.width) || !Number.isFinite(image.height)) return null;
  return [Number(image.width), Number(image.height)];
}

function validateSize(width: number, height: number, max: number): void {
  if (![width, height].every((value) => Number.isInteger(value) && value > 0 && value <= max)) {
    throw new Error('Invalid optical resolve display size.');
  }
}

function parseOptions(
  cameraNearOrOptions: number | OpticalResolveRenderOptions | undefined,
  cameraFar: number | undefined,
  measure: boolean | undefined,
): Required<Pick<OpticalResolveRenderOptions, 'cameraNear' | 'cameraFar' | 'depthThreshold' | 'measure'>> {
  const options = typeof cameraNearOrOptions === 'object' && cameraNearOrOptions !== null ? cameraNearOrOptions : undefined;
  const near = options?.cameraNear ?? (typeof cameraNearOrOptions === 'number' ? cameraNearOrOptions : 0.1);
  const far = options?.cameraFar ?? (typeof cameraFar === 'number' ? cameraFar : 10000);
  const threshold = options?.depthThreshold ?? 0.03;
  const shouldMeasure = options?.measure ?? measure ?? false;
  if (!Number.isFinite(near) || near <= 0 || !Number.isFinite(far) || far <= near) {
    throw new Error('Optical resolve cameraNear/cameraFar must be finite with 0 < near < far.');
  }
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new Error('Optical resolve depthThreshold must be finite and between 0 and 1.');
  }
  return { cameraNear: near, cameraFar: far, depthThreshold: threshold, measure: shouldMeasure };
}

/**
 * Resolve low-resolution cloud optical data into a full-resolution linear HDR
 * target. This path only records a compute pass: the caller owns scene
 * rendering and no renderer target, MRT, or scene state is touched here.
 */
export function createOpticalResolve(renderer: WebGPURenderer): OpticalResolve {
  const backend = sharedBackend(renderer);
  const { device } = backend;
  const output = new StorageTexture(1, 1);
  output.name = 'clouds-optical-resolve-output';
  output.format = RGBAFormat;
  output.type = HalfFloatType;
  output.generateMipmaps = false;
  renderer.initTexture(output);

  const params = device.createBuffer({ label: 'clouds-optical-resolve-params', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const pipeline = device.createComputePipeline({
    label: 'clouds-optical-resolve',
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: OPTICAL_RESOLVE_WGSL }), entryPoint: 'main' },
  });
  const timer = createComputeTimer(device);
  const values = new Float32Array(8);
  let displayWidth = 1;
  let displayHeight = 1;
  let binding: GPUBindGroup | undefined;
  let boundOptical: Texture | undefined;
  let boundColor: Texture | undefined;
  let boundDepth: Texture | undefined;
  // Three texture identity is stable across setSize()/dispose()+recreate,
  // while the backend GPUTexture is replaced. Keep both identities so a
  // reused wrapper never leaves a bind group pointing at the old resource.
  let boundOpticalNative: GPUTexture | undefined;
  let boundColorNative: GPUTexture | undefined;
  let boundDepthNative: GPUTexture | undefined;
  let disposed = false;

  function ensureAlive(): void {
    if (disposed) throw new Error('Optical resolve has been disposed.');
  }

  function resize(width: number, height: number): void {
    ensureAlive();
    validateSize(width, height, device.limits.maxTextureDimension2D);
    if (width === displayWidth && height === displayHeight) return;
    displayWidth = width;
    displayHeight = height;
    output.setSize(width, height, 1);
    renderer.initTexture(output);
    binding = undefined;
  }

  function render(
    opticalLow: Texture,
    sceneColorFull: Texture,
    sceneDepthFull: Texture,
    cameraNearOrOptions: number | OpticalResolveRenderOptions = 0.1,
    cameraFar?: number,
    measure?: boolean,
  ): void {
    ensureAlive();
    if (!opticalLow || !sceneColorFull || !sceneDepthFull) throw new Error('Optical resolve requires optical, color, and depth textures.');
    const options = parseOptions(cameraNearOrOptions, cameraFar, measure);
    const lowSize = imageSize(opticalLow);
    if (lowSize && lowSize.some((value) => !Number.isInteger(value) || value < 1)) throw new Error('Optical resolve input texture has invalid dimensions.');
    const colorSize = imageSize(sceneColorFull);
    const depthSize = imageSize(sceneDepthFull);
    if (colorSize && (colorSize[0] !== displayWidth || colorSize[1] !== displayHeight)) throw new Error('Optical resolve scene color must match the display size.');
    if (depthSize && (depthSize[0] !== displayWidth || depthSize[1] !== displayHeight)) throw new Error('Optical resolve scene depth must match the display size.');

    // initTexture is idempotent for already-uploaded caller-owned textures and
    // gives sharedBackend a native view for newly-created Three textures.
    renderer.initTexture(opticalLow);
    renderer.initTexture(sceneColorFull);
    renderer.initTexture(sceneDepthFull);
    const opticalNative = backend.texture(opticalLow);
    const colorNative = backend.texture(sceneColorFull);
    const depthNative = backend.texture(sceneDepthFull);
    values.set([displayWidth, displayHeight, lowSize?.[0] ?? displayWidth, lowSize?.[1] ?? displayHeight, options.cameraNear, options.cameraFar, options.depthThreshold, 0]);
    device.queue.writeBuffer(params, 0, values);

    if (!binding || boundOptical !== opticalLow || boundColor !== sceneColorFull || boundDepth !== sceneDepthFull
      || boundOpticalNative !== opticalNative || boundColorNative !== colorNative || boundDepthNative !== depthNative) {
      binding = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: opticalNative.createView() },
        { binding: 2, resource: colorNative.createView() },
        { binding: 3, resource: depthNative.createView() },
        { binding: 4, resource: backend.texture(output).createView() },
      ] });
      boundOptical = opticalLow;
      boundColor = sceneColorFull;
      boundDepth = sceneDepthFull;
      boundOpticalNative = opticalNative;
      boundColorNative = colorNative;
      boundDepthNative = depthNative;
    }

    const encoder = device.createCommandEncoder({ label: 'clouds-optical-resolve-frame' });
    const pass = encoder.beginComputePass(options.measure && timer ? { timestampWrites: timer.begin() } : {});
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, binding);
    pass.dispatchWorkgroups(Math.ceil(displayWidth / 8), Math.ceil(displayHeight / 8));
    pass.end();
    if (options.measure && timer) timer.resolve(encoder);
    device.queue.submit([encoder.finish()]);
  }

  async function measureGpu(
    opticalLow: Texture,
    sceneColorFull: Texture,
    sceneDepthFull: Texture,
    cameraNearOrOptions: number | OpticalResolveRenderOptions = 0.1,
    cameraFar?: number,
  ): Promise<number | null> {
    ensureAlive();
    if (!timer) return null;
    const options = typeof cameraNearOrOptions === 'object'
      ? { ...cameraNearOrOptions, measure: true }
      : { cameraNear: cameraNearOrOptions, cameraFar, measure: true };
    render(opticalLow, sceneColorFull, sceneDepthFull, options);
    return timer.readMilliseconds();
  }

  return {
    output,
    shader: OPTICAL_RESOLVE_WGSL,
    resize,
    render,
    measureGpu,
    dispose() {
      if (disposed) return;
      disposed = true;
      output.dispose();
      params.destroy();
      timer?.dispose();
    },
  };
}

export { OPTICAL_RESOLVE_WGSL } from './shader';
