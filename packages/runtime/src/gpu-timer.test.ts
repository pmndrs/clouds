import { describe, expect, it } from 'vitest';
import { GpuTimer } from './gpu-timer';

function mockDevice(features: string[]) {
  const buffers: { data?: BigUint64Array; mapped: boolean }[] = [];
  const device = {
    features: new Set(features),
    createQuerySet: (d: { count: number }) => ({ count: d.count, destroy() {} }),
    createBuffer: () => {
      const b = {
        data: undefined as BigUint64Array | undefined, mapped: false, destroy() {},
        mapAsync: async () => { b.mapped = true; },
        getMappedRange: () => (b.data ?? new BigUint64Array(32)).buffer,
        unmap: () => { b.mapped = false; },
      };
      buffers.push(b);
      return b;
    },
  };
  let resolved = 0;
  const encoder = {
    resolveQuerySet: (_q: unknown, _f: number, count: number) => { resolved = count; },
    copyBufferToBuffer: (_s: unknown, _so: number, dst: { data?: BigUint64Array }) => {
      const t = new BigUint64Array(resolved);
      for (let i = 0; i < resolved; i += 2) { t[i] = 1000n; t[i + 1] = 1000n + BigInt((i / 2 + 1) * 2_000_000); } // pass k takes (k+1)*2 ms
      dst.data = t;
    },
  };
  return { device: device as unknown as GPUDevice, encoder: encoder as unknown as GPUCommandEncoder };
}

describe('GpuTimer', () => {
  it('is a no-op without timestamp-query', () => {
    const { device, encoder } = mockDevice([]);
    const timer = new GpuTimer(device);
    expect(timer.enabled).toBe(false);
    timer.beginFrame();
    expect(timer.passTimestampWrites('a')).toBeUndefined();
    timer.endFrame(encoder);
    expect(timer.averages()).toEqual({});
  });

  it('hands out sequential timestamp slots and reads back ms per pass', async () => {
    const { device, encoder } = mockDevice(['timestamp-query']);
    const timer = new GpuTimer(device, { ringSize: 2 });
    timer.beginFrame();
    expect(timer.passTimestampWrites('march')).toMatchObject({ beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 });
    expect(timer.passTimestampWrites('upsample')).toMatchObject({ beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 });
    timer.endFrame(encoder);
    expect(timer.averages()).toEqual({}); // nothing until the next frame starts the readback
    timer.beginFrame();
    await new Promise(r => setTimeout(r, 0));
    expect(timer.last()).toEqual({ march: 2, upsample: 4 });
    expect(timer.averages().march).toBeCloseTo(2);
  });

  it('skips timing when every ring buffer is in flight and recovers', async () => {
    const { device, encoder } = mockDevice(['timestamp-query']);
    const timer = new GpuTimer(device, { ringSize: 1 });
    timer.beginFrame(); timer.passTimestampWrites('a'); timer.endFrame(encoder);
    timer.beginFrame(); // starts mapping of the only slot
    expect(timer.passTimestampWrites('a')).toBeUndefined();
    await new Promise(r => setTimeout(r, 0));
    timer.beginFrame();
    expect(timer.passTimestampWrites('a')).toBeDefined();
  });

  it('splits one named span into a begin-only and an end-only write (U2)', () => {
    const { device } = mockDevice(['timestamp-query']);
    const timer = new GpuTimer(device);
    timer.beginFrame();
    timer.passTimestampWrites('a');
    const span = timer.spanTimestampWrites('upscale')!;
    expect(span.begin).toMatchObject({ beginningOfPassWriteIndex: 2 });
    expect(span.end).toMatchObject({ endOfPassWriteIndex: 3 });
    expect('endOfPassWriteIndex' in span.begin).toBe(false);
    expect('beginningOfPassWriteIndex' in span.end).toBe(false);
  });

  it('caps passes per frame', () => {
    const { device } = mockDevice(['timestamp-query']);
    const timer = new GpuTimer(device, { maxPasses: 1 });
    timer.beginFrame();
    expect(timer.passTimestampWrites('a')).toBeDefined();
    expect(timer.passTimestampWrites('b')).toBeUndefined();
  });
});
