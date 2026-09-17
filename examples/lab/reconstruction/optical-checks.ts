import {
  DataTexture, DepthTexture, FloatType, HalfFloatType, Mesh, MeshBasicNodeMaterial,
  OrthographicCamera, PlaneGeometry, RGBAFormat, RenderTarget, Scene, WebGPUCoordinateSystem,
  type Texture, type WebGPURenderer,
} from 'three/webgpu';
import { sharedBackend } from '../../../packages/three/src/gpu/backend';
import { createOpticalResolve } from '../../../packages/three/src/optical-resolve';

export interface OpticalGpuCheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly error: number;
  readonly tolerance: number;
}

const WIDTH = 4;
const HEIGHT = 4;
const LOW_WIDTH = 2;
const LOW_HEIGHT = 2;
const NEAR = 0.1;
const FAR = 10;
const TOLERANCE = 0.02;

function checkResult(results: OpticalGpuCheckResult[], name: string, error: number, tolerance = TOLERANCE): void {
  results.push({ name, passed: Number.isFinite(error) && error <= tolerance, error, tolerance });
}

function maxError(values: readonly number[], expected: readonly number[]): number {
  return values.reduce((max, value, index) => Math.max(max, Math.abs(value - expected[index])), 0);
}

function floatToHalf(value: number): number {
  if (!Number.isFinite(value)) return value < 0 ? 0xfc00 : 0x7c00;
  if (value === 0) return 0;
  const sign = value < 0 ? 0x8000 : 0;
  const absolute = Math.abs(value);
  const exponent = Math.floor(Math.log2(absolute));
  if (exponent < -14) return sign | Math.max(1, Math.round(absolute * 2 ** 24));
  if (exponent > 15) return sign | 0x7c00;
  const mantissa = Math.round((absolute / 2 ** exponent - 1) * 1024);
  return sign | ((exponent + 15) << 10) | Math.min(mantissa, 1023);
}

function colorTexture(data: Float32Array, width: number, height: number, name: string): DataTexture {
  // WebGPU's rgba16float upload is two bytes per channel. Three forwards the
  // DataTexture payload directly, so provide IEEE-754 binary16 words here.
  const packed = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i += 1) packed[i] = floatToHalf(data[i]);
  const texture = new DataTexture(packed, width, height, RGBAFormat, HalfFloatType);
  texture.name = name;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function fillTexture(width: number, height: number, rgba: readonly [number, number, number, number], name: string): DataTexture {
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return colorTexture(data, width, height, name);
}

function halfToFloat(value: number): number {
  const sign = value & 0x8000 ? -1 : 1;
  const exponent = (value >> 10) & 31;
  const mantissa = value & 1023;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 31) return mantissa ? Number.NaN : sign * Infinity;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

async function readHalfTexture(renderer: WebGPURenderer, texture: Texture, width: number, height: number): Promise<Float32Array> {
  const { device } = sharedBackend(renderer);
  const native = sharedBackend(renderer).texture(texture);
  const bytesPerRow = Math.ceil(width * 8 / 256) * 256;
  const staging = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const encoder = device.createCommandEncoder({ label: 'clouds-optical-check-readback' });
    encoder.copyTextureToBuffer({ texture: native }, { buffer: staging, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await staging.mapAsync(GPUMapMode.READ);
    const packed = new Uint16Array(staging.getMappedRange());
    const result = new Float32Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      const row = y * bytesPerRow / 2;
      for (let x = 0; x < width * 4; x += 1) result[y * width * 4 + x] = halfToFloat(packed[row + x]);
    }
    staging.unmap();
    return result;
  } finally {
    staging.destroy();
  }
}

function makeDepthTarget(renderer: WebGPURenderer): RenderTarget {
  const target = new RenderTarget(WIDTH, HEIGHT, { depthBuffer: true, stencilBuffer: false });
  target.depthTexture = new DepthTexture(WIDTH, HEIGHT, FloatType);
  target.depthTexture.name = 'clouds-optical-check-depth';
  renderer.initRenderTarget(target);
  return target;
}

function clearDepth(renderer: WebGPURenderer, target: RenderTarget): void {
  renderer.setRenderTarget(target);
  renderer.clear(true, true, false);
}

function foregroundDepth(renderer: WebGPURenderer, target: RenderTarget): { scene: Scene; camera: OrthographicCamera; geometry: PlaneGeometry; material: MeshBasicNodeMaterial } {
  clearDepth(renderer, target);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  const geometry = new PlaneGeometry(1, 2);
  const material = new MeshBasicNodeMaterial({ color: 0xffffff, depthTest: true, depthWrite: true });
  const plane = new Mesh(geometry, material);
  plane.position.x = -0.5;
  scene.add(plane);
  renderer.render(scene, camera);
  return { scene, camera, geometry, material };
}

/**
 * Actual WebGPU checks for the cloud-only optical resolve. Every assertion
 * reads the rgba16float output after a submitted resolve dispatch; depth is a
 * real depth32float render target, including the foreground-edge fixture.
 */
export async function runOpticalGpuChecks(renderer: WebGPURenderer): Promise<OpticalGpuCheckResult[]> {
  const results: OpticalGpuCheckResult[] = [];
  const backend = sharedBackend(renderer);
  const resolve = createOpticalResolve(renderer);
  resolve.resize(WIDTH, HEIGHT);
  const sceneColor = fillTexture(WIDTH, HEIGHT, [1.5, 2.25, 4, 1], 'clouds-optical-check-hdr-scene');
  const zeroScene = fillTexture(WIDTH, HEIGHT, [0, 0, 0, 1], 'clouds-optical-check-zero-scene');
  const optical = fillTexture(LOW_WIDTH, LOW_HEIGHT, [2.75, 3.5, 1.25, 0.4], 'clouds-optical-check-constant');
  const emptyOptical = fillTexture(LOW_WIDTH, LOW_HEIGHT, [0, 0, 0, 1], 'clouds-optical-check-empty');
  const edgeOptical = colorTexture(new Float32Array([
    2, 0, 0, 0, 90, 90, 90, 0,
    2, 0, 0, 0, 90, 90, 90, 0,
  ]), LOW_WIDTH, LOW_HEIGHT, 'clouds-optical-check-edge');
  const disoccludedOptical = fillTexture(1, 1, [77, 77, 77, 0], 'clouds-optical-check-disoccluded');
  const depth = makeDepthTarget(renderer);
  const edgeDepth = makeDepthTarget(renderer);
  const previousTarget = renderer.getRenderTarget();
  const previousFace = renderer.getActiveCubeFace();
  const previousMip = renderer.getActiveMipmapLevel();
  const previousMRT = renderer.getMRT();
  let edgeFixture: ReturnType<typeof foregroundDepth> | undefined;
  try {
    clearDepth(renderer, depth);
    resolve.render(optical, sceneColor, depth.depthTexture!, { cameraNear: NEAR, cameraFar: FAR });
    const constantOutput = await readHalfTexture(renderer, resolve.output, WIDTH, HEIGHT);
    const expectedConstant: [number, number, number, number] = [3.35, 4.4, 2.85, 1];
    checkResult(results, 'GPU constant HDR L/T conservation', maxError(Array.from(constantOutput.slice(0, 4)), expectedConstant));
    checkResult(results, 'GPU constant HDR values stay above SDR range', constantOutput[0] > 1 && constantOutput[1] > 1 && constantOutput[2] > 1 ? 0 : 1, 0);

    resolve.render(emptyOptical, sceneColor, depth.depthTexture!, { cameraNear: NEAR, cameraFar: FAR });
    const emptyOutput = await readHalfTexture(renderer, resolve.output, WIDTH, HEIGHT);
    checkResult(results, 'GPU empty optical preserves full scene through T=1', maxError(Array.from(emptyOutput.slice(0, 4)), [1.5, 2.25, 4, 1]));

    edgeFixture = foregroundDepth(renderer, edgeDepth);
    resolve.render(edgeOptical, zeroScene, edgeDepth.depthTexture!, { cameraNear: NEAR, cameraFar: FAR });
    const edgeOutput = await readHalfTexture(renderer, resolve.output, WIDTH, HEIGHT);
    const leftPixel = (1 * WIDTH + 1) * 4;
    const rightPixel = (1 * WIDTH + 2) * 4;
    checkResult(results, 'GPU foreground edge rejects depth-disparate cloud taps', Math.max(
      maxError(Array.from(edgeOutput.slice(leftPixel, leftPixel + 4)), [2, 0, 0, 1]),
      maxError(Array.from(edgeOutput.slice(rightPixel, rightPixel + 4)), [90, 90, 90, 1]),
    ));

    resolve.render(disoccludedOptical, zeroScene, edgeDepth.depthTexture!, { cameraNear: NEAR, cameraFar: FAR });
    const disoccludedOutput = await readHalfTexture(renderer, resolve.output, WIDTH, HEIGHT);
    const nearPixel = Array.from(disoccludedOutput.slice(4, 8));
    checkResult(results, 'GPU all-rejected disocclusion returns clear optical identity', maxError(nearPixel, [0, 0, 0, 1]));

    // Reuse the same Three wrapper after replacing its native resource. The
    // resolve must observe the new 1×1 GPU texture and rebuild its bind group.
    optical.dispose();
    optical.image = { data: new Uint16Array([6, 7, 8, 0.5].map(floatToHalf)), width: 1, height: 1 };
    optical.needsUpdate = true;
    renderer.initTexture(optical);
    resolve.render(optical, zeroScene, depth.depthTexture!, { cameraNear: NEAR, cameraFar: FAR });
    const resizedOutput = await readHalfTexture(renderer, resolve.output, WIDTH, HEIGHT);
    checkResult(results, 'GPU reused input texture rebuilds binding after resize', maxError(Array.from(resizedOutput.slice(0, 4)), [6, 7, 8, 1]));
  } finally {
    renderer.setMRT(previousMRT);
    renderer.setRenderTarget(previousTarget, previousFace, previousMip);
    edgeFixture?.scene.clear();
    edgeFixture?.geometry.dispose();
    edgeFixture?.material.dispose();
    depth.dispose();
    edgeDepth.dispose();
    sceneColor.dispose();
    zeroScene.dispose();
    optical.dispose();
    emptyOptical.dispose();
    edgeOptical.dispose();
    disoccludedOptical.dispose();
    resolve.dispose();
  }
  // Keep this call after cleanup so validation scopes see all submitted work.
  await backend.device.queue.onSubmittedWorkDone();
  return results;
}
