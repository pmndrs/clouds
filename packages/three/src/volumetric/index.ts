import {
  Data3DTexture, RedFormat, UnsignedByteType, LinearFilter, NearestFilter,
  StorageTexture, HalfFloatType, RenderTarget, DepthTexture, FloatType,
  MeshBasicNodeMaterial, QuadMesh, Matrix4, Vector3, WebGPUCoordinateSystem,
  Color, type WebGPURenderer, type Scene, type PerspectiveCamera,
} from 'three/webgpu';
import { texture, mrt, output as sceneOutput, vec4 } from 'three/tsl';
import { densityPayloadBytes, type Bounds3 } from '@clouds/core';
import { sharedBackend } from '../gpu/backend';
import { createComputeTimer } from '../gpu/timer';
import { buildConservativeOccupancy, type DenseDensityField } from '../sources/index';
import { CLOUD_WGSL } from './shader';

export interface ReferenceCloudSettings {
  densityMultiplier: number;
  viewSteps: number;
  lightSteps: number;
  occupancy: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  constantLight: boolean;
  sunDirection: Vector3;
}

/** Assign to the material.mrtNode of the reference floor at world Y=0. */
export function referenceGroundReceiver() { return mrt({ cloudReceiver: vec4(1) }); }

/** Bounded reference, conventional WebGPU depth only; no temporal state or overlapping volumes. */
export function createReferenceCloud(renderer: WebGPURenderer, initialField: DenseDensityField, occluder: Bounds3) {
  const backend = sharedBackend(renderer);
  const { device } = backend;
  const timer = createComputeTimer(device);
  const target = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true, count: 2 });
  target.texture.name = 'output';
  target.textures[1].name = 'cloudReceiver';
  target.textures[1].type = UnsignedByteType;
  const sceneMRT = mrt({ output: sceneOutput, cloudReceiver: vec4(0) });
  sceneMRT.setClearColor('cloudReceiver', new Color(0), 0);
  target.depthTexture = new DepthTexture(1, 1, FloatType);
  const output = new StorageTexture(1, 1);
  const optical = new StorageTexture(1, 1);
  for (const t of [output, optical]) { t.type = HalfFloatType; t.generateMipmaps = false; }
  output.name = 'clouds-composite-linear-hdr'; optical.name = 'clouds-radiance-transmittance';
  const material = new MeshBasicNodeMaterial({ colorNode: texture(output), depthTest: false, depthWrite: false });
  const quad = new QuadMesh(material);
  const params = device.createBuffer({ label: 'cloud-reference-params', size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const pipeline = device.createComputePipeline({
    label: 'cloud-reference-integrator', layout: 'auto',
    compute: { module: device.createShaderModule({ code: CLOUD_WGSL }), entryPoint: 'main' },
  });
  const settings: ReferenceCloudSettings = {
    densityMultiplier: 1, viewSteps: 96, lightSteps: 12, occupancy: false,
    castShadow: true, receiveShadow: true, constantLight: false,
    sunDirection: new Vector3(-0.6, 0.8, 0.4).normalize(),
  };
  let field: DenseDensityField;
  let density: Data3DTexture;
  let occupancy: Data3DTexture;
  let occupiedRatio = 0;
  let disposed = false;
  let binding: GPUBindGroup | undefined;
  const values = new Float32Array(48);
  const inverseVP = new Matrix4();
  const cameraPosition = new Vector3();
  function ensureAlive() { if (disposed) throw new Error('Reference cloud has been disposed.'); }
  function setField(next: DenseDensityField) {
    ensureAlive();
    const bytes = densityPayloadBytes(next.descriptor);
    if (next.descriptor.encoding !== 'r8unorm' || next.data.length !== bytes) throw new Error('Reference cloud requires a complete r8unorm payload.');
    if (next.descriptor.dimensions.some(d => d > device.limits.maxTextureDimension3D)) throw new Error('Density exceeds device 3D texture limits.');
    const acceleration = buildConservativeOccupancy(next, 8);
    const makeTexture = (data: Uint8Array, size: readonly number[], filtered: boolean) => {
      const t = new Data3DTexture(data, size[0], size[1], size[2]);
      t.format = RedFormat; t.type = UnsignedByteType; t.unpackAlignment = 1;
      t.minFilter = t.magFilter = filtered ? LinearFilter : NearestFilter;
      t.generateMipmaps = false; t.needsUpdate = true;
      renderer.initTexture(t);
      return t;
    };
    const nextDensity = makeTexture(next.data, next.descriptor.dimensions, true);
    const nextOccupancy = makeTexture(acceleration.data, acceleration.dimensions, false);
    density?.dispose(); occupancy?.dispose();
    density = nextDensity; occupancy = nextOccupancy; field = next;
    occupiedRatio = acceleration.data.reduce((sum, n) => sum + Number(n > 0), 0) / acceleration.data.length;
    binding = undefined;
  }
  setField(initialField);
  function resize(width: number, height: number) {
    ensureAlive();
    if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= device.limits.maxTextureDimension2D)) throw new Error('Invalid cloud render size.');
    if (target.width === width && target.height === height && binding) return;
    target.setSize(width, height); output.setSize(width, height, 1); optical.setSize(width, height, 1);
    renderer.initTexture(output); renderer.initTexture(optical); binding = undefined;
  }
  function render(scene: Scene, camera: PerspectiveCamera, present = true, measure = false) {
    ensureAlive();
    if (renderer.reversedDepthBuffer || camera.coordinateSystem !== WebGPUCoordinateSystem) throw new Error('Reference cloud supports conventional WebGPU zero-to-one perspective depth only.');
    if (!Number.isFinite(settings.densityMultiplier) || settings.densityMultiplier < 0 || ![settings.viewSteps, settings.lightSteps].every(n => Number.isInteger(n) && n >= 1 && n <= 512)) throw new Error('Invalid integration settings.');
    if (!settings.sunDirection.toArray().every(Number.isFinite) || settings.sunDirection.lengthSq() === 0) throw new Error('Sun direction must be finite and nonzero.');
    const previousTarget = renderer.getRenderTarget();
    const previousMRT = renderer.getMRT();
    try {
      renderer.setRenderTarget(target); renderer.setMRT(sceneMRT); renderer.render(scene, camera);
      camera.updateMatrixWorld();
      inverseVP.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse).toArray(values, 0);
      camera.getWorldPosition(cameraPosition).toArray(values, 16);
      values.set(field.descriptor.bounds.min, 20); values.set(field.descriptor.bounds.max, 24);
      settings.sunDirection.clone().normalize().toArray(values, 28);
      values.set([field.descriptor.extinctionScale * settings.densityMultiplier, settings.viewSteps, settings.lightSteps, Number(settings.occupancy)], 32);
      values.set([Number(settings.castShadow), Number(settings.receiveShadow), Number(settings.constantLight), 8], 36);
      values.set(occluder.min, 40); values.set(occluder.max, 44);
      device.queue.writeBuffer(params, 0, values);
      if (!binding) {
        renderer.initTexture(output); renderer.initTexture(optical);
        binding = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: backend.texture(density).createView() },
          { binding: 2, resource: sampler },
          { binding: 3, resource: backend.texture(occupancy).createView() },
          { binding: 4, resource: backend.texture(target.texture).createView() },
          { binding: 5, resource: backend.texture(target.depthTexture!).createView() },
          { binding: 6, resource: backend.texture(optical).createView() },
          { binding: 7, resource: backend.texture(output).createView() },
          { binding: 8, resource: backend.texture(target.textures[1]).createView() },
        ] });
      }
      const encoder = device.createCommandEncoder({ label: 'cloud-reference-frame' });
      const pass = encoder.beginComputePass(measure && timer ? { timestampWrites: timer.begin() } : {}); pass.setPipeline(pipeline); pass.setBindGroup(0, binding);
      pass.dispatchWorkgroups(Math.ceil(target.width / 8), Math.ceil(target.height / 8)); pass.end();
      if (measure && timer) timer.resolve(encoder);
      device.queue.submit([encoder.finish()]);
    } finally { renderer.setMRT(previousMRT); renderer.setRenderTarget(previousTarget); }
    if (present) quad.render(renderer);
  }
  /** Diagnostic only: never awaited by the animation/render connection. */
  async function readPixels(source: StorageTexture): Promise<Float32Array> {
    ensureAlive();
    const width = target.width, height = target.height;
    const pitch = Math.ceil(width * 8 / 256) * 256;
    const staging = device.createBuffer({ size: pitch * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: backend.texture(source) }, { buffer: staging, bytesPerRow: pitch }, [width, height]);
      device.queue.submit([encoder.finish()]); await staging.mapAsync(GPUMapMode.READ);
      const packed = new Uint16Array(staging.getMappedRange());
      const result = new Float32Array(width * height * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width * 4; x++) result[y * width * 4 + x] = decodeFloat16(packed[y * pitch / 2 + x]);
      return result;
    } finally { staging.destroy(); }
  }
  return {
    settings, output, optical, setField, resize, render,
    async measureGpu(scene: Scene, camera: PerspectiveCamera) {
      ensureAlive();
      if (!timer) return null;
      render(scene, camera, false, true);
      return timer.readMilliseconds();
    },
    readOptical: () => readPixels(optical), readComposite: () => readPixels(output),
    get evidence() { return { source: field.descriptor, renderSize: [target.width, target.height], occupiedBrickFraction: occupiedRatio, densityPayloadBytes: field.data.byteLength, outputPayloadBytes: target.width * target.height * 32, groundReceiver: 'explicit-material-mask-and-ray-plane', settings: { ...settings, sunDirection: settings.sunDirection.toArray() }, depth: 'webgpu-zero-to-one', temporalHistory: false }; },
    dispose() {
      if (disposed) return; disposed = true;
      density.dispose(); occupancy.dispose(); target.dispose(); output.dispose(); optical.dispose(); material.dispose(); params.destroy(); timer?.dispose();
    },
  };
}

export function decodeFloat16(value: number): number {
  const sign = value & 0x8000 ? -1 : 1;
  const exponent = (value >> 10) & 31, mantissa = value & 1023;
  return sign * (exponent === 0 ? mantissa * 2 ** -24 : exponent === 31 ? (mantissa ? NaN : Infinity) : (1 + mantissa / 1024) * 2 ** (exponent - 15));
}
