import { describe, expect, it } from 'vitest';
import { decodeDenseAsset, encodeDenseAsset, fetchDenseAsset } from './index';

const field = {
  descriptor: {
    id: 'fixture/é', revision: 3, dimensions: [3, 2, 1] as [number, number, number],
    bounds: { min: [-1, 2, -3] as [number, number, number], max: [4, 6, 5] as [number, number, number] },
    extinctionScale: 0.025, encoding: 'r8unorm' as const,
  },
  data: new Uint8Array([0, 20, 255, 1, 2, 3]),
};

describe('portable dense assets', () => {
  it('round trips little-endian metadata, id and x-fastest payload', () => {
    const decoded = decodeDenseAsset(encodeDenseAsset(field));
    expect(decoded.descriptor).toEqual(field.descriptor);
    expect(Array.from(decoded.data)).toEqual(Array.from(field.data));
  });

  it('rejects hostile dimensions and payloads before allocation', () => {
    const bytes = encodeDenseAsset(field);
    const view = new DataView(bytes.buffer);
    view.setUint32(24, 0xffffffff, true);
    expect(() => decodeDenseAsset(bytes)).toThrow(/dimension|payload/i);
    const short = encodeDenseAsset(field).slice(0, bytes.length - 1);
    expect(() => decodeDenseAsset(short)).toThrow(/truncated/i);
    const trailing = new Uint8Array([...encodeDenseAsset(field), 0]);
    expect(() => decodeDenseAsset(trailing)).toThrow(/trailing/i);
    const flags = encodeDenseAsset(field);
    new DataView(flags.buffer).setUint16(6, 1, true);
    expect(() => decodeDenseAsset(flags)).toThrow(/flags/i);
  });

  it('passes the caller signal to fetch and does not create an owned controller', async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const encoded = encodeDenseAsset(field);
    const response = new Response(new Blob([encoded as unknown as BlobPart]), { status: 200 });
    const loaded = await fetchDenseAsset('/fixture.dense', {
      signal: controller.signal,
      fetch: async (_input, init) => { seenSignal = init?.signal ?? undefined; return response; },
    });
    expect(seenSignal).toBe(controller.signal);
    expect(loaded.descriptor.id).toBe(field.descriptor.id);
  });

  it('caps a streaming response before retaining an oversized payload', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(80)); controller.enqueue(new Uint8Array(80)); },
      cancel() { cancelled = true; },
    });
    const response = new Response(stream, { status: 200 });
    await expect(fetchDenseAsset('/oversized', { maxPayloadBytes: 32, maxIdBytes: 1, fetch: async () => response })).rejects.toThrow(/transport limit/i);
    expect(cancelled).toBe(true);
  });

  it('stops a stream when the caller aborts', async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        streamController.enqueue(new Uint8Array(4));
        controller.abort();
      },
    });
    const response = new Response(stream, { status: 200 });
    await expect(fetchDenseAsset('/aborted', { signal: controller.signal, fetch: async () => response })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('cancels an outstanding read even when a custom fetch ignores the signal', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    const pending = fetchDenseAsset('/idle', { signal: controller.signal, fetch: async () => response });
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toBe(true);
  });

  it('rejects declared transport overflow without reading the body', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Length': '4096' } });
    await expect(fetchDenseAsset('/declared', { maxPayloadBytes: 32, maxIdBytes: 1, fetch: async () => response })).rejects.toThrow(/transport limit/i);
    expect(cancelled).toBe(true);
  });

  it('rejects metadata that cannot round trip through uint32', () => {
    expect(() => encodeDenseAsset({ ...field, descriptor: { ...field.descriptor, revision: 2 ** 32 } })).toThrow(/uint32/i);
    expect(() => encodeDenseAsset(field, { maxDimension: 2 ** 32 })).toThrow(/uint32/i);
  });
});
