import { PerspectiveCamera, WebGPUCoordinateSystem, type Texture, type WebGPURenderer } from 'three/webgpu';

import { sharedBackend } from '../../../packages/three/src/gpu/backend';
import { createReconstructionAdapter, type ReconstructionAdapter } from '../../../packages/three/src/reconstruction/adapter';

export interface UpscalerCheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly error: number;
  readonly tolerance: number;
}

type Size = { width: number; height: number };

function textureData(size: Size, color: readonly [number, number, number, number]): Float32Array {
  const data = new Float32Array(size.width * size.height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(color, i);
  return data;
}

function guideData(size: Size, reactivity = 0.25): Float32Array {
  const data = new Float32Array(size.width * size.height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([0, 0, 0.5, reactivity], i);
  return data;
}

function floatToHalf(value: number): number {
  const bits = new DataView(new ArrayBuffer(4));
  bits.setFloat32(0, value, true);
  const word = bits.getUint32(0, true);
  const sign = (word >>> 16) & 0x8000;
  const exponent = ((word >>> 23) & 0xff) - 127 + 15;
  const mantissa = word & 0x7fffff;
  if (exponent <= 0) return sign;
  if (exponent >= 31) return sign | 0x7c00;
  return sign | (exponent << 10) | (mantissa >>> 13);
}

function makeTexture(device: GPUDevice, size: Size, format: GPUTextureFormat, data: Float32Array): GPUTexture {
  const texture = device.createTexture({
    label: 'p4-upscaler-check-input',
    size: [size.width, size.height],
    format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const bytes = format === 'rgba16float'
    ? new Uint8Array(Uint16Array.from(data, floatToHalf).buffer)
    : new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  device.queue.writeTexture(
    { texture },
    bytes,
    { bytesPerRow: size.width * (format === 'rgba16float' ? 8 : 16) },
    { width: size.width, height: size.height },
  );
  return texture;
}

function decodeFloat16(value: number): number {
  const sign = value & 0x8000 ? -1 : 1;
  const exponent = (value >> 10) & 31;
  const mantissa = value & 1023;
  return sign * (exponent === 0
    ? mantissa * 2 ** -24
    : exponent === 31
      ? (mantissa ? Number.NaN : Number.POSITIVE_INFINITY)
      : (1 + mantissa / 1024) * 2 ** (exponent - 15));
}

async function readOutput(renderer: WebGPURenderer, texture: Texture, size: Size): Promise<Float32Array> {
  const { device } = sharedBackend(renderer);
  const gpu = sharedBackend(renderer).texture(texture);
  const bytesPerRow = Math.ceil(size.width * 8 / 256) * 256;
  const staging = device.createBuffer({
    label: 'p4-upscaler-check-readback',
    size: bytesPerRow * size.height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = device.createCommandEncoder({ label: 'p4-upscaler-check-readback' });
    encoder.copyTextureToBuffer(
      { texture: gpu },
      { buffer: staging, bytesPerRow },
      { width: size.width, height: size.height },
    );
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await staging.mapAsync(GPUMapMode.READ);
    const packed = new Uint16Array(staging.getMappedRange());
    const result = new Float32Array(size.width * size.height * 4);
    for (let y = 0; y < size.height; y++) {
      const row = y * bytesPerRow / 2;
      for (let x = 0; x < size.width * 4; x++) result[y * size.width * 4 + x] = decodeFloat16(packed[row + x]);
    }
    staging.unmap();
    return result;
  } finally {
    staging.destroy();
  }
}

function maxError(values: Float32Array, expected: readonly [number, number, number]): number {
  let error = 0;
  for (let i = 0; i < values.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) error = Math.max(error, Math.abs(values[i + channel] - expected[channel]));
  }
  return error;
}

function finiteError(values: Float32Array): number {
  return values.every(Number.isFinite) ? 0 : 1;
}

async function temporalFrame(
  adapter: ReconstructionAdapter,
  camera: PerspectiveCamera,
  color: GPUTexture,
  guides: GPUTexture,
  reset = false,
): Promise<void> {
  adapter.beginFrame(camera);
  try {
    adapter.dispatch({ color, guides, reset, deltaTime: 1 / 60 }, camera);
  } finally {
    adapter.endFrame(camera);
  }
}

/**
 * GPU integration checks for the real FSR1/FSR3 runtime. Each check submits
 * actual upscaler work and reads back the resulting output; no CPU reference
 * implementation is counted as a pass.
 */
export async function runUpscalerChecks(renderer: WebGPURenderer): Promise<UpscalerCheckResult[]> {
  const results: UpscalerCheckResult[] = [];
  const check = (name: string, error: number, tolerance = 0.01) => results.push({
    name,
    error,
    tolerance,
    passed: Number.isFinite(error) && error <= tolerance,
  });
  const { device } = sharedBackend(renderer);
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  camera.position.set(0, 0, 4);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  const low: Size = { width: 4, height: 4 };
  const display: Size = { width: 8, height: 8 };
  const color = makeTexture(device, low, 'rgba16float', textureData(low, [2, 1, 0.5, 1]));
  const guides = makeTexture(device, low, 'rgba32float', guideData(low));
  const resizedLow: Size = { width: 5, height: 3 };
  const resizedDisplay: Size = { width: 10, height: 6 };
  const resizedColor = makeTexture(device, resizedLow, 'rgba16float', textureData(resizedLow, [2, 1, 0.5, 1]));
  const resizedGuides = makeTexture(device, resizedLow, 'rgba32float', guideData(resizedLow));
  const adapter = createReconstructionAdapter(renderer, { alpha: false });
  try {
    adapter.settings.autoExposure = false;
    adapter.settings.sharpness = 0;
    adapter.settings.lockThinFeatures = false;
    adapter.settings.detectShadingChanges = false;
    adapter.configure({ displayWidth: display.width, displayHeight: display.height, renderWidth: low.width, renderHeight: low.height, mode: 'fsr1' });
    adapter.dispatch({ color }, camera);
    await device.queue.onSubmittedWorkDone();
    const spatial = await readOutput(renderer, adapter.outputTexture, display);
    check('FSR1 spatial preserves constant linear HDR input', Math.max(finiteError(spatial), maxError(spatial, [2, 1, 0.5])), 0.03);

    adapter.configure({ displayWidth: display.width, displayHeight: display.height, renderWidth: low.width, renderHeight: low.height, mode: 'fsr3' });
    const beforeJitter = camera.view?.enabled ?? false;
    await temporalFrame(adapter, camera, color, guides, true);
    check('FSR3 temporal restores camera jitter after endFrame', (camera.view?.enabled ?? false) === beforeJitter ? 0 : 1, 0);
    await device.queue.onSubmittedWorkDone();
    const temporal = await readOutput(renderer, adapter.outputTexture, display);
    check('FSR3 temporal accepts packed guides and preserves constant HDR input', Math.max(
      finiteError(temporal), maxError(temporal, [2, 1, 0.5]),
    ), 0.03);

    // A color step without reset should retain some history. The explicit reset
    // frame must move closer to the new constant immediately.
    const changed = makeTexture(device, low, 'rgba16float', textureData(low, [4, 2, 1, 1]));
    await temporalFrame(adapter, camera, color, guides, true);
    await temporalFrame(adapter, camera, changed, guides, false);
    await device.queue.onSubmittedWorkDone();
    const noReset = await readOutput(renderer, adapter.outputTexture, display);
    await temporalFrame(adapter, camera, changed, guides, true);
    await device.queue.onSubmittedWorkDone();
    const reset = await readOutput(renderer, adapter.outputTexture, display);
    const noResetError = maxError(noReset, [4, 2, 1]);
    const resetError = maxError(reset, [4, 2, 1]);
    adapter.configure({ displayWidth: resizedDisplay.width, displayHeight: resizedDisplay.height, renderWidth: resizedLow.width, renderHeight: resizedLow.height, mode: 'fsr3' });
    await temporalFrame(adapter, camera, resizedColor, resizedGuides, true);
    await device.queue.onSubmittedWorkDone();
    const resized = await readOutput(renderer, adapter.outputTexture, resizedDisplay);
    check('FSR3 resize rebuilds output with finite pixels', finiteError(resized), 0);
    // The comparison is against a fresh history, not concurrent execution.
    // Release diagnostic timestamp pools before allocating the fresh runtime.
    adapter.dispose();
    const freshAdapter = createReconstructionAdapter(renderer, { alpha: false });
    try {
      freshAdapter.configure({ displayWidth: display.width, displayHeight: display.height, renderWidth: low.width, renderHeight: low.height, mode: 'fsr3' });
      freshAdapter.settings.autoExposure = false;
      freshAdapter.settings.sharpness = 0;
      await temporalFrame(freshAdapter, camera, changed, guides, true);
      await device.queue.onSubmittedWorkDone();
      const fresh = await readOutput(renderer, freshAdapter.outputTexture, display);
      const freshError = maxError(fresh, [4, 2, 1]);
      const resetVsFresh = Math.max(...reset.map((value, index) => Math.abs(value - fresh[index])));
      check('FSR3 reset matches a fresh history after a color change', Math.max(resetVsFresh, resetError - noResetError), 0.03);
      check('FSR3 reset output remains close to the changed HDR input', Math.max(resetError, freshError), 0.03);
    } finally {
      freshAdapter.dispose();
    }
    changed.destroy();


  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name: 'FSR GPU integration completed without validation errors', passed: false, error: Number.POSITIVE_INFINITY, tolerance: 0 });
    console.error(message);
  } finally {
    adapter.dispose();
    color.destroy();
    guides.destroy();
    resizedColor.destroy();
    resizedGuides.destroy();
  }
  return results;
}
