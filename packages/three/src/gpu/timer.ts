/** Opt-in, serialized diagnostic timer. Never maps buffers in the animation path. */
export function createComputeTimer(device: GPUDevice) {
  if (!device.features.has('timestamp-query')) return null;
  const queries = device.createQuerySet({ type: 'timestamp', count: 2 });
  const resolve = device.createBuffer({ size: 256, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  let pending = false, disposed = false;
  return {
    begin(): GPUComputePassTimestampWrites {
      if (disposed || pending) throw new Error('GPU timer is disposed or already in use.');
      pending = true;
      return { querySet: queries, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
    },
    resolve(encoder: GPUCommandEncoder) { encoder.resolveQuerySet(queries, 0, 2, resolve, 0); encoder.copyBufferToBuffer(resolve, 0, readback, 0, 16); },
    async readMilliseconds() {
      try {
        await readback.mapAsync(GPUMapMode.READ);
        const values = new BigUint64Array(readback.getMappedRange());
        return Number(values[1] - values[0]) / 1e6;
      } finally { readback.unmap(); pending = false; }
    },
    dispose() { if (disposed) return; disposed = true; queries.destroy(); resolve.destroy(); readback.destroy(); },
  };
}
