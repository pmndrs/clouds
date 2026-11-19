// Renderer-agnostic GPU pass timer. Takes only a GPUDevice. No three imports.
// Usage per frame: beginFrame(); pass descriptors get passTimestampWrites(name); endFrame(encoder);
// the caller submits the encoder. Readback is non-blocking through a ring of buffers; results lag 2-3 frames.

// Numeric WebGPU flag values so the module also loads where the GPUBufferUsage / GPUMapMode globals do not exist (tests).
const COPY_SRC = 0x04, COPY_DST = 0x08, MAP_READ = 0x01, QUERY_RESOLVE = 0x200;
const MAP_MODE_READ = 0x1;

export interface GpuTimerOptions {
  /** Max named passes timed per frame. Extra names are ignored. Default 16. */
  maxPasses?: number;
  /** Readback buffers in the ring. Default 3. */
  ringSize?: number;
  /** Frames in each rolling average. Default 60. */
  window?: number;
}

type SlotState = 'free' | 'submitted' | 'mapping';
interface Slot { readback: GPUBuffer; state: SlotState; names: string[] }

export class GpuTimer {
  /** False when the device lacks `timestamp-query`; every method is then a no-op. */
  readonly enabled: boolean;
  private readonly maxPasses: number;
  private readonly window: number;
  private readonly querySet?: GPUQuerySet;
  private readonly resolveBuffer?: GPUBuffer;
  private readonly slots: Slot[] = [];
  private readonly history = new Map<string, number[]>();
  private readonly lastMs = new Map<string, number>();
  private current?: Slot;
  private names: string[] = [];
  private cursor = 0;

  constructor(device: GPUDevice, options: GpuTimerOptions = {}) {
    this.maxPasses = options.maxPasses ?? 16;
    this.window = options.window ?? 60;
    this.enabled = device.features.has('timestamp-query');
    if (!this.enabled) return;
    const count = this.maxPasses * 2;
    const bytes = count * 8;
    this.querySet = device.createQuerySet({ type: 'timestamp', count });
    this.resolveBuffer = device.createBuffer({ size: bytes, usage: QUERY_RESOLVE | COPY_SRC, label: 'GpuTimer resolve' });
    for (let i = 0; i < (options.ringSize ?? 3); i++) {
      this.slots.push({ readback: device.createBuffer({ size: bytes, usage: MAP_READ | COPY_DST, label: `GpuTimer readback ${i}` }), state: 'free', names: [] });
    }
  }

  /** Start a frame. Also starts the readback of frames submitted since the last call (so call it after the previous submit). */
  beginFrame(): void {
    if (!this.enabled) return;
    for (const slot of this.slots) if (slot.state === 'submitted') this.startMap(slot);
    this.current = this.slots.find(s => s.state === 'free');
    this.names = [];
    this.cursor = 0;
  }

  /** Timestamp writes for the next pass, or undefined if disabled, out of slots, or every ring buffer is still in flight. */
  passTimestampWrites(name: string): GPUComputePassTimestampWrites | undefined {
    if (!this.enabled || !this.current || this.cursor >= this.maxPasses) return undefined;
    const i = this.cursor++;
    this.names.push(name);
    return { querySet: this.querySet!, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 };
  }

  /**
   * U2: one named span over several passes the caller does not open itself (a library's own compute passes): encode an empty compute pass with
   * `begin` before them and one with `end` after them.
   */
  spanTimestampWrites(name: string): { begin: GPUComputePassTimestampWrites; end: GPUComputePassTimestampWrites } | undefined {
    const w = this.passTimestampWrites(name);
    if (!w) return undefined;
    return { begin: { querySet: w.querySet, beginningOfPassWriteIndex: w.beginningOfPassWriteIndex }, end: { querySet: w.querySet, endOfPassWriteIndex: w.endOfPassWriteIndex } };
  }

  /** Record the resolve + copy into `encoder`. The caller must submit the encoder. */
  endFrame(encoder: GPUCommandEncoder): void {
    const slot = this.current;
    if (!this.enabled || !slot || this.cursor === 0) { this.current = undefined; return; }
    const bytes = this.cursor * 2 * 8;
    encoder.resolveQuerySet(this.querySet!, 0, this.cursor * 2, this.resolveBuffer!, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer!, 0, slot.readback, 0, bytes);
    slot.names = this.names;
    slot.state = 'submitted';
    this.current = undefined;
  }

  private startMap(slot: Slot): void {
    slot.state = 'mapping';
    const bytes = slot.names.length * 2 * 8;
    slot.readback.mapAsync(MAP_MODE_READ, 0, bytes).then(() => {
      const t = new BigUint64Array(slot.readback.getMappedRange(0, bytes).slice(0));
      slot.readback.unmap();
      slot.names.forEach((name, i) => {
        const begin = t[i * 2], end = t[i * 2 + 1];
        if (end < begin) return;
        this.push(name, Number(end - begin) / 1e6);
      });
      slot.state = 'free';
    }, () => { slot.state = 'free'; });
  }

  private push(name: string, ms: number): void {
    let h = this.history.get(name);
    if (!h) this.history.set(name, h = []);
    h.push(ms);
    if (h.length > this.window) h.shift();
    this.lastMs.set(name, ms);
  }

  /** Rolling-average ms per named pass. */
  averages(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, h] of this.history) out[name] = h.reduce((a, b) => a + b, 0) / h.length;
    return out;
  }

  /** Most recent ms per named pass. */
  last(): Record<string, number> { return Object.fromEntries(this.lastMs); }

  dispose(): void {
    this.querySet?.destroy();
    this.resolveBuffer?.destroy();
    for (const s of this.slots) s.readback.destroy();
  }
}
