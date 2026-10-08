import {
  densityPayloadBytes,
  validateDensityDescriptor,
  type DensityDescriptor,
} from '@clouds/core';

/** The renderer-independent dense field contract. X is the fastest axis. */
export interface DenseDensityField {
  readonly descriptor: DensityDescriptor;
  readonly data: Uint8Array;
}

export interface DenseAssetLimits {
  /** Maximum dimension on any axis. This is checked before payload allocation. */
  readonly maxDimension?: number;
  /** Maximum payload bytes accepted by the decoder or encoder. */
  readonly maxPayloadBytes?: number;
  /** Maximum UTF-8 bytes allowed for the asset id. */
  readonly maxIdBytes?: number;
}

export const DENSE_ASSET_VERSION = 1;
export const DENSE_ASSET_HEADER_BYTES = 96;
export const DEFAULT_MAX_DENSE_DIMENSION = 4096;
export const DEFAULT_MAX_DENSE_PAYLOAD_BYTES = 256 * 1024 * 1024;
export const DEFAULT_MAX_DENSE_ID_BYTES = 1024;

const MAGIC = [0x43, 0x4c, 0x44, 0x41] as const; // CLDA
const TEXT_ENCODER = new TextEncoder();

function limits(options: DenseAssetLimits = {}) {
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DENSE_DIMENSION;
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_DENSE_PAYLOAD_BYTES;
  const maxIdBytes = options.maxIdBytes ?? DEFAULT_MAX_DENSE_ID_BYTES;
  if (!Number.isSafeInteger(maxDimension) || maxDimension < 1 || maxDimension > 0xffff_ffff) throw new Error('maxDimension must be a positive uint32.');
  if (!Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 1 || maxPayloadBytes > 0xffff_ffff) throw new Error('maxPayloadBytes must be a positive uint32.');
  if (!Number.isSafeInteger(maxIdBytes) || maxIdBytes < 1 || maxIdBytes > 0xffff_ffff) throw new Error('maxIdBytes must be a positive uint32.');
  return { maxDimension, maxPayloadBytes, maxIdBytes };
}

function validateField(field: DenseDensityField, options: DenseAssetLimits = {}): number {
  if (!field || typeof field !== 'object') throw new Error('Density field must be an object.');
  validateDensityDescriptor(field.descriptor);
  const { maxDimension, maxPayloadBytes, maxIdBytes } = limits(options);
  if (!(field.data instanceof Uint8Array)) throw new Error('Density field data must be a Uint8Array.');
  if (field.descriptor.dimensions.some(d => d > maxDimension)) throw new Error('Density dimension exceeds the configured asset limit.');
  const idBytes = TEXT_ENCODER.encode(field.descriptor.id);
  if (idBytes.byteLength === 0 || idBytes.byteLength > maxIdBytes) throw new Error('Density id exceeds the configured asset limit.');
  if (field.descriptor.revision > 0xffff_ffff) throw new Error('Density revision exceeds the portable uint32 range.');
  const expectedBytes = densityPayloadBytes(field.descriptor);
  if (expectedBytes > maxPayloadBytes) throw new Error('Density payload exceeds the configured asset limit.');
  if (expectedBytes > 0xffff_ffff) throw new Error('Density payload exceeds the portable uint32 range.');
  if (field.data.byteLength !== expectedBytes) throw new Error(`Density payload length ${field.data.byteLength} does not match ${expectedBytes}.`);
  return expectedBytes;
}

/**
 * Encode a validated dense field into the portable CLDA v1 format.
 *
 * The fixed metadata header and all numeric fields are little endian. The
 * payload is an uninterpreted byte string whose length is determined by the
 * descriptor encoding; r8unorm is the runtime's first-class path.
 */
export function encodeDenseAsset(field: DenseDensityField, options: DenseAssetLimits = {}): Uint8Array {
  const payloadBytes = validateField(field, options);
  const { maxIdBytes } = limits(options);
  const idBytes = TEXT_ENCODER.encode(field.descriptor.id);
  if (idBytes.byteLength > maxIdBytes) throw new Error('Density id exceeds the configured asset limit.');
  const totalBytes = DENSE_ASSET_HEADER_BYTES + idBytes.byteLength + payloadBytes;
  if (!Number.isSafeInteger(totalBytes)) throw new Error('Dense asset size exceeds the safe integer range.');
  const output = new Uint8Array(totalBytes);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  MAGIC.forEach((value, index) => view.setUint8(index, value));
  view.setUint16(4, DENSE_ASSET_VERSION, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, DENSE_ASSET_HEADER_BYTES, true);
  view.setUint32(12, idBytes.byteLength, true);
  view.setUint32(16, payloadBytes, true);
  view.setUint32(20, field.descriptor.revision, true);
  field.descriptor.dimensions.forEach((value, index) => view.setUint32(24 + index * 4, value, true));
  field.descriptor.bounds.min.forEach((value, index) => view.setFloat64(36 + index * 8, value, true));
  field.descriptor.bounds.max.forEach((value, index) => view.setFloat64(60 + index * 8, value, true));
  view.setFloat64(84, field.descriptor.extinctionScale, true);
  view.setUint8(92, field.descriptor.encoding === 'r8unorm' ? 1 : field.descriptor.encoding === 'r16float' ? 2 : 3);
  // Bytes 93..95 are reserved and remain zero for forward compatibility.
  output.set(idBytes, DENSE_ASSET_HEADER_BYTES);
  output.set(field.data, DENSE_ASSET_HEADER_BYTES + idBytes.byteLength);
  return output;
}

function bytesOf(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new Error('Dense asset input must be an ArrayBuffer or ArrayBufferView.');
}

function abortError(): Error {
  try { return new DOMException('The operation was aborted.', 'AbortError'); }
  catch { return Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }); }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

export interface DecodeDenseAssetOptions extends DenseAssetLimits {
  readonly signal?: AbortSignal;
}

/** Decode CLDA v1 after validating every size and descriptor field. */
export function decodeDenseAsset(input: ArrayBuffer | ArrayBufferView, options: DecodeDenseAssetOptions = {}): DenseDensityField {
  assertNotAborted(options.signal);
  const bytes = bytesOf(input);
  const { maxDimension, maxPayloadBytes, maxIdBytes } = limits(options);
  if (bytes.byteLength < DENSE_ASSET_HEADER_BYTES) throw new Error('Dense asset is truncated before its fixed header.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < MAGIC.length; i++) if (view.getUint8(i) !== MAGIC[i]) throw new Error('Invalid dense asset magic.');
  const version = view.getUint16(4, true);
  if (version !== DENSE_ASSET_VERSION) throw new Error(`Unsupported dense asset version ${version}.`);
  if (view.getUint16(6, true) !== 0 || view.getUint8(93) !== 0 || view.getUint8(94) !== 0 || view.getUint8(95) !== 0) throw new Error('Dense asset contains unsupported header flags.');
  const headerBytes = view.getUint32(8, true);
  const idBytes = view.getUint32(12, true);
  const payloadBytes = view.getUint32(16, true);
  if (headerBytes !== DENSE_ASSET_HEADER_BYTES) throw new Error('Unsupported dense asset header size.');
  if (idBytes < 1 || idBytes > maxIdBytes) throw new Error('Dense asset id length exceeds the configured limit.');
  if (payloadBytes > maxPayloadBytes) throw new Error('Dense asset payload exceeds the configured limit.');
  const dimensions: [number, number, number] = [view.getUint32(24, true), view.getUint32(28, true), view.getUint32(32, true)];
  if (dimensions.some(d => d < 1 || d > maxDimension)) throw new Error('Dense asset dimension exceeds the configured limit.');
  const encodingValue = view.getUint8(92);
  const encoding = encodingValue === 1 ? 'r8unorm' : encodingValue === 2 ? 'r16float' : encodingValue === 3 ? 'r32float' : undefined;
  if (!encoding) throw new Error(`Unsupported dense asset encoding value ${encodingValue}.`);
  const descriptor: DensityDescriptor = {
    id: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(DENSE_ASSET_HEADER_BYTES, DENSE_ASSET_HEADER_BYTES + idBytes)),
    revision: view.getUint32(20, true),
    dimensions,
    bounds: {
      min: [view.getFloat64(36, true), view.getFloat64(44, true), view.getFloat64(52, true)],
      max: [view.getFloat64(60, true), view.getFloat64(68, true), view.getFloat64(76, true)],
    },
    extinctionScale: view.getFloat64(84, true),
    encoding,
  };
  validateDensityDescriptor(descriptor);
  const expectedBytes = densityPayloadBytes(descriptor);
  if (payloadBytes !== expectedBytes) throw new Error(`Dense asset payload length ${payloadBytes} does not match ${expectedBytes}.`);
  const payloadOffset = DENSE_ASSET_HEADER_BYTES + idBytes;
  if (payloadOffset > bytes.byteLength || payloadBytes > bytes.byteLength - payloadOffset) throw new Error('Dense asset payload is truncated.');
  if (bytes.byteLength !== payloadOffset + payloadBytes) throw new Error('Dense asset contains trailing bytes.');
  assertNotAborted(options.signal);
  // Copy only after all untrusted lengths and descriptor values have passed validation.
  return { descriptor, data: bytes.slice(payloadOffset, payloadOffset + payloadBytes) };
}

export interface FetchDenseAssetOptions extends DecodeDenseAssetOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly requestInit?: RequestInit;
}

async function readBoundedResponse(response: Response, cap: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) throw new Error('Dense asset response has an invalid Content-Length.');
    if (length > cap) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('Dense asset response exceeds the configured transport limit.');
    }
  }
  if (!response.body) {
    throw new Error('Dense asset response has no bounded readable body.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      assertNotAborted(signal);
      const next = await reader.read();
      assertNotAborted(signal);
      if (next.done) break;
      if (next.value.byteLength > cap - total) throw new Error('Dense asset response exceeds the configured transport limit.');
      const chunk = new Uint8Array(next.value);
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output.buffer;
}

/** Browser fetch loader. The caller owns the URL, Request and AbortController. */
export async function fetchDenseAsset(input: RequestInfo | URL, options: FetchDenseAssetOptions = {}): Promise<DenseDensityField> {
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== 'function') throw new Error('A fetch implementation is required in this environment.');
  assertNotAborted(options.signal);
  const response = await fetcher(input, { ...options.requestInit, signal: options.signal });
  if (!response.ok) throw new Error(`Dense asset request failed with HTTP ${response.status}.`);
  const { maxPayloadBytes, maxIdBytes } = limits(options);
  const transportCap = DENSE_ASSET_HEADER_BYTES + maxIdBytes + maxPayloadBytes;
  const buffer = await readBoundedResponse(response, transportCap, options.signal);
  assertNotAborted(options.signal);
  return decodeDenseAsset(buffer, options);
}

export const loadDenseAsset = fetchDenseAsset;

export type { Bounds3, DensityDescriptor, Vec3 } from '@clouds/core';
