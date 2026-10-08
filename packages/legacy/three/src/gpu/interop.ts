import type { Storage3DTexture, StorageBufferAttribute, StorageTexture, WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  float,
  globalId,
  storage,
  storageTexture,
  storageTexture3D,
  textureLoad,
  textureStore,
  uvec2,
  uvec3,
  vec4,
} from 'three/tsl';
import type StorageBufferNode from 'three/src/nodes/accessors/StorageBufferNode.js';
import type ComputeNode from 'three/src/nodes/gpgpu/ComputeNode.js';
import {
  Storage3DTexture as Storage3DTextureClass,
  StorageBufferAttribute as StorageBufferAttributeClass,
  StorageTexture as StorageTextureClass,
} from 'three/webgpu';

/** The small, fixed-size diagnostic used by the P0 integration probe. */
export const INTEROP_PROBE_SIZE = 16;

export interface InteropProbePassReport {
  readonly passed: boolean;
  readonly textureMaxError: number;
  readonly volumeMaxError: number;
  readonly bufferMaxError: number;
}

export interface InteropProbeReport {
  readonly size: number;
  readonly rawToTSL: InteropProbePassReport;
  readonly tslToRaw: InteropProbePassReport;
  readonly nativeBufferValidated: boolean;
  readonly gpuErrors: readonly string[];
}

export interface InteropStorageNodes {
  /** Read-only TSL node for the 2D storage texture. */
  readonly texture: ReturnType<typeof storageTexture>;
  /** Read-only TSL node for the 3D storage texture. */
  readonly volumeTexture: ReturnType<typeof storageTexture3D>;
  /** Read-only TSL node for the storage buffer. */
  readonly buffer: StorageBufferNode<'vec4'>;
}

export interface InteropProbe {
  readonly texture: StorageTexture;
  readonly volumeTexture: Storage3DTexture;
  readonly storageNode: InteropStorageNodes;
  /** Runs both producer/consumer directions; readback is diagnostic-only. */
  run(): Promise<InteropProbeReport>;
  resize(size: number): Promise<void>;
  dispose(): void;
}

interface BackendData {
  readonly device?: GPUDevice | null;
  readonly isWebGPUBackend?: boolean;
  get(object: object): { texture?: GPUTexture; buffer?: GPUBuffer } | undefined;
  createStorageAttribute(attribute: StorageBufferAttribute): void;
}

interface RendererInternals {
  readonly backend?: BackendData;
}

type TslComputeFunction = (() => ComputeNode);

interface ProbeState {
  size: number;
  texture: StorageTexture;
  volumeTexture: Storage3DTexture;
  buffer: StorageBufferAttribute;
  nodes: InteropStorageNodes;
  rawToTSL: TslComputeFunction;
  tslToRaw: TslComputeFunction;
  disposed: boolean;
  initialized: boolean;
}

const RAW_PRODUCER_WGSL = (size: number) => `
const SIZE: u32 = ${size}u;
@group(0) @binding(0) var volume: texture_storage_3d<rgba8unorm, write>;
@group(0) @binding(1) var<storage, read_write> values: array<vec4<f32>>;

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= SIZE || id.y >= SIZE || id.z >= SIZE) { return; }
  let denom = f32(SIZE - 1u);
  let value = vec4<f32>(f32(id.x) / denom, f32(id.y) / denom, f32(id.z) / denom, 1.0);
  textureStore(volume, id, value);
  let index = id.x + id.y * SIZE + id.z * SIZE * SIZE;
  values[index] = value;
}
`;

const RAW_CONSUMER_WGSL = (size: number) => `
const SIZE: u32 = ${size}u;
const SLICE: u32 = ${Math.floor(size / 2)}u;
@group(0) @binding(0) var volume: texture_storage_3d<rgba8unorm, read>;
@group(0) @binding(1) var output: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<storage, read_write> values: array<vec4<f32>>;

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= SIZE || id.y >= SIZE) { return; }
  let volumeValue = textureLoad(volume, vec3<u32>(id.x, id.y, SLICE));
  let index = id.x + id.y * SIZE + SLICE * SIZE * SIZE;
  let value = (volumeValue + values[index]) * 0.5;
  textureStore(output, id.xy, value);
  values[id.x + id.y * SIZE] = value;
}
`;

function backendOf(renderer: WebGPURenderer): BackendData {
  const backend = (renderer as unknown as RendererInternals).backend;
  if (!backend?.device || backend.isWebGPUBackend !== true) {
    throw new Error('Interop probe requires an initialized Three.js WebGPU backend.');
  }
  return backend;
}

function checkSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 2 || size > 256) {
    throw new Error('Interop probe size must be an integer between 2 and 256.');
  }
}

function makeBuffer(size: number): StorageBufferAttribute {
  const buffer = new StorageBufferAttributeClass(size * size * size, 4);
  buffer.name = 'clouds-interop-values';
  return buffer;
}

function makeNodes(state: Pick<ProbeState, 'size' | 'texture' | 'volumeTexture' | 'buffer'>): {
  nodes: InteropStorageNodes;
  rawToTSL: TslComputeFunction;
  tslToRaw: TslComputeFunction;
} {
  const { size, texture, volumeTexture, buffer } = state;
  const total = size * size * size;
  const half = Math.floor(size / 2);

  const volumeRead = storageTexture3D(volumeTexture).toReadOnly();
  const outputWrite = storageTexture(texture).toWriteOnly();
  const valuesRead = storage(buffer, 'vec4', total).toReadOnly();
  const volumeWrite = storageTexture3D(volumeTexture).toWriteOnly();
  const valuesWrite = storage(buffer, 'vec4', total);

  // Three TSL reads the raw producer's 3D texture and native buffer, then writes
  // the 2D texture. Keeping both inputs in the expression prevents either binding
  // from being optimized away by the node builder.
  const rawToTSL = Fn(() => {
    const id = globalId;
    const index = id.x.add(id.y.mul(size)).add(half * size * size);
    const volumeValue = textureLoad(volumeRead, uvec3(id.x, id.y, half));
    const bufferValue = valuesRead.element(index);
    textureStore(outputWrite, uvec2(id.x, id.y), volumeValue.add(bufferValue).mul(0.5));
  }) as unknown as TslComputeFunction;

  // TSL produces a 3D gradient and the same native storage buffer layout. The
  // raw consumer below then reads that Three-owned texture and writes outputs.
  const tslToRaw = Fn(() => {
    const id = globalId;
    const denom = float(size - 1);
    const value = vec4(
      float(1).sub(float(id.x).div(denom)),
      float(id.y).div(denom),
      float(id.z).div(denom),
      1,
    );
    const index = id.x.add(id.y.mul(size)).add(id.z.mul(size * size));
    textureStore(volumeWrite, uvec3(id.x, id.y, id.z), value);
    valuesWrite.element(index).assign(value);
  }) as unknown as TslComputeFunction;

  return {
    nodes: { texture: storageTexture(texture).toReadOnly(), volumeTexture: storageTexture3D(volumeTexture).toReadOnly(), buffer: valuesRead },
    rawToTSL,
    tslToRaw,
  };
}

async function runRawPass(
  device: GPUDevice,
  shader: string,
  entries: GPUBindGroupEntry[],
  dispatch: [number, number, number],
): Promise<void> {
  let error: GPUError | null = null;
  device.pushErrorScope('validation');
  try {
    const module = device.createShaderModule({ code: shader });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
    const encoder = device.createCommandEncoder({ label: 'clouds-interop-raw-pass' });
    const pass = encoder.beginComputePass({ label: 'clouds-interop-raw-pass' });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(...dispatch);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  } finally {
    error = await device.popErrorScope();
  }
  if (error) throw new Error(`Raw interop pass validation failed: ${error.message}`);
}

async function runTSLPass(
  device: GPUDevice,
  renderer: WebGPURenderer,
  node: ComputeNode,
  dispatch: [number, number, number],
): Promise<void> {
  let error: GPUError | null = null;
  device.pushErrorScope('validation');
  try {
    await renderer.computeAsync(node, dispatch);
    await device.queue.onSubmittedWorkDone();
  } finally {
    error = await device.popErrorScope();
  }
  if (error) throw new Error(`TSL interop pass validation failed: ${error.message}`);
}

async function readTexture(renderer: WebGPURenderer, texture: StorageTexture, size: number): Promise<Uint8Array> {
  const backend = backendOf(renderer);
  const copyTextureToBuffer = (backend as unknown as {
    copyTextureToBuffer?: (texture: StorageTexture, x: number, y: number, width: number, height: number, face: number) => Promise<Uint8Array>;
  }).copyTextureToBuffer;
  if (!copyTextureToBuffer) throw new Error('Three WebGPU backend has no diagnostic texture readback method.');
  return await copyTextureToBuffer.call(backend, texture, 0, 0, size, size, 0);
}

async function readBuffer(renderer: WebGPURenderer, buffer: StorageBufferAttribute): Promise<Float32Array> {
  const readback = (renderer as unknown as {
    getArrayBufferAsync?: (attribute: StorageBufferAttribute) => Promise<ArrayBuffer>;
  }).getArrayBufferAsync;
  if (!readback) throw new Error('Three renderer has no diagnostic storage-buffer readback method.');
  return new Float32Array(await readback.call(renderer, buffer));
}

function maxTextureError(bytes: Uint8Array, size: number, z: number, invertX = false): number {
  let max = 0;
  // WebGPU copyTextureToBuffer aligns every row to 256 bytes. The returned
  // typed array therefore contains padding for the small 16x16 diagnostic.
  const rowStrideTexels = Math.ceil((size * 4) / 256) * (256 / 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * rowStrideTexels + x) * 4;
      const expected = [invertX ? 1 - x / (size - 1) : x / (size - 1), y / (size - 1), z / (size - 1), 1];
      for (let c = 0; c < 4; c++) max = Math.max(max, Math.abs(bytes[i + c] / 255 - expected[c]));
    }
  }
  return max;
}

function maxBufferError(values: Float32Array, size: number, z: number, invertX = false): number {
  let max = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const expected = [invertX ? 1 - x / (size - 1) : x / (size - 1), y / (size - 1), z / (size - 1), 1];
      for (let c = 0; c < 4; c++) max = Math.max(max, Math.abs(values[i + c] - expected[c]));
    }
  }
  return max;
}

function maxVolumeBufferError(values: Float32Array, size: number, invertX = false): number {
  let max = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (x + y * size + z * size * size) * 4;
        const expected = [invertX ? 1 - x / (size - 1) : x / (size - 1), y / (size - 1), z / (size - 1), 1];
        for (let c = 0; c < 4; c++) max = Math.max(max, Math.abs(values[i + c] - expected[c]));
      }
    }
  }
  return max;
}

function passReport(textureMaxError: number, volumeMaxError: number, bufferMaxError: number): InteropProbePassReport {
  return { passed: Math.max(textureMaxError, volumeMaxError, bufferMaxError) <= 1 / 255 + 1e-5, textureMaxError, volumeMaxError, bufferMaxError };
}

/**
 * Creates the P0 mixed raw-WGSL/Three-TSL resource-sharing diagnostic.
 * GPU resources are allocated lazily by run() or resize() after renderer.init().
 */
export function createInteropProbe(renderer: WebGPURenderer, initialSize = INTEROP_PROBE_SIZE): InteropProbe {
  checkSize(initialSize);
  const texture = new StorageTextureClass(initialSize, initialSize);
  const volumeTexture = new Storage3DTextureClass(initialSize, initialSize, initialSize);
  texture.name = 'clouds-interop-output';
  volumeTexture.name = 'clouds-interop-volume';
  // Storage views used by raw WGSL and TSL are level-zero views. Avoid Three
  // allocating a mip chain whose 3D view dimensions differ from the probe.
  texture.generateMipmaps = false;
  volumeTexture.generateMipmaps = false;
  const buffer = makeBuffer(initialSize);
  const nodeParts = makeNodes({ size: initialSize, texture, volumeTexture, buffer });
  const state: ProbeState = { size: initialSize, texture, volumeTexture, buffer, ...nodeParts, disposed: false, initialized: false };

  const ensureReady = async (): Promise<BackendData> => {
    if (state.disposed) throw new Error('Interop probe has been disposed.');
    await renderer.init();
    const backend = backendOf(renderer);
    if (!state.initialized) {
      renderer.initTexture(state.texture);
      renderer.initTexture(state.volumeTexture);
      backend.createStorageAttribute(state.buffer);
      state.initialized = true;
    }
    return backend;
  };

  const run = async (): Promise<InteropProbeReport> => {
    const gpuErrors: string[] = [];
    const backend = await ensureReady();
    const device = backend.device!;
    const rawVolume = backend.get(state.volumeTexture)?.texture;
    const rawOutput = backend.get(state.texture)?.texture;
    const rawValues = backend.get(state.buffer)?.buffer;
    if (!rawVolume || !rawOutput || !rawValues) throw new Error('Three did not expose initialized native interop resources.');
    const half = Math.floor(state.size / 2);
    try {
      await runRawPass(device, RAW_PRODUCER_WGSL(state.size), [
        { binding: 0, resource: rawVolume.createView({ dimension: '3d' }) },
        { binding: 1, resource: { buffer: rawValues } },
      ], [state.size, state.size, state.size]);
      await runTSLPass(device, renderer, state.rawToTSL().compute(state.size * state.size, [1, 1, 1]), [state.size, state.size, 1]);
      const rawToTexture = await readTexture(renderer, state.texture, state.size);
      const rawToBuffer = await readBuffer(renderer, state.buffer);
      const rawToVolume = await (backend as unknown as { copyTextureToBuffer: (texture: Storage3DTexture, x: number, y: number, width: number, height: number, face: number) => Promise<Uint8Array> }).copyTextureToBuffer(state.volumeTexture, 0, 0, state.size, state.size, half);
      const rawToTSLReport = passReport(maxTextureError(rawToTexture, state.size, half), maxTextureError(rawToVolume, state.size, half), maxVolumeBufferError(rawToBuffer, state.size));

      await runTSLPass(device, renderer, state.tslToRaw().compute(state.size * state.size * state.size, [1, 1, 1]), [state.size, state.size, state.size]);
      await runRawPass(device, RAW_CONSUMER_WGSL(state.size), [
        { binding: 0, resource: rawVolume.createView({ dimension: '3d' }) },
        { binding: 1, resource: rawOutput.createView({ dimension: '2d' }) },
        { binding: 2, resource: { buffer: rawValues } },
      ], [state.size, state.size, 1]);
      const tslToTexture = await readTexture(renderer, state.texture, state.size);
      const tslToBuffer = await readBuffer(renderer, state.buffer);
      const tslToVolume = await (backend as unknown as { copyTextureToBuffer: (texture: Storage3DTexture, x: number, y: number, width: number, height: number, face: number) => Promise<Uint8Array> }).copyTextureToBuffer(state.volumeTexture, 0, 0, state.size, state.size, half);
      const tslToRawReport = passReport(maxTextureError(tslToTexture, state.size, half, true), maxTextureError(tslToVolume, state.size, half, true), maxBufferError(tslToBuffer, state.size, half, true));
      return { size: state.size, rawToTSL: rawToTSLReport, tslToRaw: tslToRawReport, nativeBufferValidated: rawToTSLReport.passed && tslToRawReport.passed, gpuErrors };
    } catch (error) {
      gpuErrors.push(error instanceof Error ? error.message : String(error));
      const failed = passReport(Infinity, Infinity, Infinity);
      return { size: state.size, rawToTSL: failed, tslToRaw: failed, nativeBufferValidated: false, gpuErrors };
    }
  };

  const resize = async (size: number): Promise<void> => {
    checkSize(size);
    if (state.disposed) throw new Error('Interop probe has been disposed.');
    state.texture.setSize(size, size, size);
    state.volumeTexture.setSize(size, size, size);
    state.buffer.dispose();
    state.size = size;
    state.buffer = makeBuffer(size);
    Object.assign(state, makeNodes(state));
    state.initialized = false;
    if (renderer.hasInitialized()) await ensureReady();
  };

  return {
    get texture() { return state.texture; },
    get volumeTexture() { return state.volumeTexture; },
    get storageNode() { return state.nodes; },
    run,
    resize,
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      state.texture.dispose();
      state.volumeTexture.dispose();
      state.buffer.dispose();
    },
  };
}
