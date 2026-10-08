// Automatic quality (P5-C): pick a starting tier from what the adapter tells us, then keep the cloud passes inside a GPU time budget by
// moving the render scale. Pure logic, no GPU objects, so it is unit-tested (auto-quality.test.ts). `createCloudRuntime(device, { quality: 'auto' })`
// wires it to the GpuTimer; the controller itself only sees milliseconds.
import type { CloudQuality } from './runtime';

const TIERS: readonly CloudQuality[] = ['mobile', 'low', 'medium', 'high', 'ultra'];

/** What the picker needs to know about the device. All optional: unknown values simply do not vote. */
export interface TierInputs {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  /** A software adapter (WARP, SwiftShader, llvmpipe). */
  isFallback?: boolean;
  limits?: { maxTextureDimension2D?: number; maxTextureDimension3D?: number; maxComputeWorkgroupStorageSize?: number; maxStorageBufferBindingSize?: number; maxBufferSize?: number };
  features?: Iterable<string>;
  /** Expected output size in pixels (a 4K display asks a lot more of the GPU than 1080p). */
  pixels?: number;
  /** The device is a phone or tablet (touch + a mobile user agent). */
  mobile?: boolean;
}
export interface TierPick { tier: CloudQuality; reasons: string[]; timestampQuery: boolean }

const match = (text: string, words: readonly string[]) => words.some(w => text.includes(w));
const clampTier = (i: number) => TIERS[Math.max(0, Math.min(TIERS.indexOf('high'), i))];

/**
 * Starting tier. Never 'ultra' (that is an explicit opt-in). The rules, in order, are cheap heuristics: a software adapter or a
 * mobile-class GPU gets 'mobile'/'low', integrated and old discrete GPUs 'medium', everything else 'high', then one step down
 * for outputs above ~4 MP and, when the texture limits are mobile-class, a cap at 'low'. The dynamic scale takes it from there.
 */
export function selectTier(i: TierInputs): TierPick {
  const reasons: string[] = [];
  const vendor = (i.vendor ?? '').toLowerCase(), arch = (i.architecture ?? '').toLowerCase();
  const text = `${vendor} ${arch} ${(i.device ?? '').toLowerCase()} ${(i.description ?? '').toLowerCase()}`;
  const features = new Set(i.features ?? []);
  let tier = TIERS.indexOf('high');
  if (i.isFallback || match(text, ['swiftshader', 'llvmpipe', 'warp', 'software', 'basic render'])) { tier = TIERS.indexOf('mobile'); reasons.push('software adapter'); }
  else if (match(text, ['qualcomm', 'adreno', 'arm', 'mali', 'immortalis', 'powervr', 'imagination', 'xclipse', 'broadcom', 'videocore'])) { tier = TIERS.indexOf('mobile'); reasons.push(`mobile GPU (${vendor || arch})`); }
  else if (vendor.includes('apple') || arch.includes('apple') || arch.includes('metal')) {
    if (i.mobile) { tier = TIERS.indexOf('low'); reasons.push('Apple GPU on a phone or tablet'); }
    else reasons.push('Apple GPU');
  }
  else if (vendor.includes('intel')) {
    // Arc / Xe-HPG are discrete-class; everything else here is an integrated part.
    if (match(text, ['xe-hpg', 'arc', 'battlemage', 'alchemist'])) reasons.push('Intel Arc');
    else { tier = TIERS.indexOf('medium'); reasons.push('Intel integrated GPU'); }
  }
  else if (match(text, ['pascal', 'maxwell', 'kepler', 'gcn', 'polaris', 'vega', 'gen-9', 'gen-8'])) { tier = TIERS.indexOf('medium'); reasons.push(`older architecture (${arch})`); }
  else if (vendor || arch) reasons.push(`${vendor || arch} discrete-class GPU`);
  else reasons.push('adapter unknown');
  if (i.mobile && tier > TIERS.indexOf('low')) { tier = TIERS.indexOf('low'); reasons.push('mobile device'); }
  const l = i.limits;
  if (l?.maxTextureDimension2D !== undefined && l.maxTextureDimension2D <= 8192 && tier > TIERS.indexOf('low')) { tier = TIERS.indexOf('low'); reasons.push(`maxTextureDimension2D ${l.maxTextureDimension2D}`); }
  if (l?.maxBufferSize !== undefined && l.maxBufferSize < 1 << 30 && tier > TIERS.indexOf('low')) { tier = TIERS.indexOf('low'); reasons.push(`maxBufferSize ${(l.maxBufferSize / 1048576).toFixed(0)} MB`); }
  if (l?.maxTextureDimension3D !== undefined && l.maxTextureDimension3D < 2048) { tier = Math.min(tier, TIERS.indexOf('mobile')); reasons.push(`maxTextureDimension3D ${l.maxTextureDimension3D}`); }
  if (i.pixels !== undefined && i.pixels > 5_000_000 && tier > TIERS.indexOf('mobile')) { tier -= 1; reasons.push(`${(i.pixels / 1e6).toFixed(1)} MP output`); }
  return { tier: clampTier(tier), reasons, timestampQuery: features.has('timestamp-query') };
}

export interface AutoQualityOptions {
  /** GPU time (ms) the cloud passes (march, resolve, composite, dome, sky layer; not the amortized light grid) should take per frame. Default 3. */
  budgetMs: number;
  /** Render scale range. Default 0.5..1. */
  minScale: number;
  maxScale: number;
  /** The cost is the median of this many frames' samples (per-frame pass times jump around by 2x on an idle GPU, so a mean chases noise). Default 30. */
  window: number;
  /** Fewest samples taken after a scale change before the next decision (the timer lags the encode by 2-3 frames, `skip`, which are dropped). Default 14. */
  minSamples: number;
  skip: number;
  /** Cost above budget * `over` shrinks the scale; cost below budget * `under` (and a predicted fit) lets it grow. Defaults 1.08 and 0.8 (an idle GPU's clock drift alone moves a small pass's time by 10-20 percent). */
  over: number;
  under: number;
}
export const AUTO_QUALITY_DEFAULTS: AutoQualityOptions = { budgetMs: 3, minScale: 0.5, maxScale: 1, window: 30, minSamples: 14, skip: 3, over: 1.08, under: 0.8 };

export interface AutoQualityInfo {
  tier: CloudQuality;
  /** Why this tier was picked. */
  reasons: readonly string[];
  /** Render scale in effect (CloudSettings.renderScale). */
  scale: number;
  /** Smoothed measured cost of the controlled passes, ms. 0 until measured. */
  costMs: number;
  budgetMs: number;
  /** False without timestamp-query: the tier is fixed at the pick and the scale stays at maxScale. */
  measured: boolean;
  /** Scale changes so far. */
  changes: number;
}

/**
 * Dynamic resolution controller. Cost is modelled as proportional to scale squared (a pass's pixels); the real exponent is lower because
 * part of the cost is per output pixel (composite) or fixed, which only makes the shrink step too small (it converges from above) and the
 * grow step too cautious (the prediction overshoots), so it does not overshoot into oscillation. The cost estimate is the median of the
 * samples since the last change (at most `window`), so spikes and the bimodal frame times of an idle GPU do not move it. Hysteresis: shrink
 * when over budget, grow only when under `under` x budget AND the predicted cost at the new scale fits; a grow that is soon undone caps the
 * scale for a while. Decisions need `minSamples` fresh samples, i.e. one every ~15-20 frames at most.
 */
export class DynamicScale {
  readonly options: AutoQualityOptions;
  scale: number;
  changes = 0;
  private samples: number[] = [];
  private frames = 0;
  private sinceChange = 0;
  private sinceDecision = 0;
  private underStreak = 0;
  private lastGrow = -1e9;
  private ceiling = Infinity;
  private ceilingUntil = 0;
  private _cost = 0;

  constructor(options: Partial<AutoQualityOptions> = {}) {
    this.options = { ...AUTO_QUALITY_DEFAULTS, ...options };
    this.scale = this.options.maxScale;
  }

  /** The current cost estimate, ms (median of the recent samples; 0 before the first). */
  get costMs(): number { return this._cost; }
  setBudget(ms: number): void { this.options.budgetMs = Math.max(0.05, ms); }

  /** Feed one frame's measured cost (ms). Returns the render scale to use for the next frame. NaN or non-positive samples are ignored. */
  update(sampleMs: number): number {
    const o = this.options;
    this.frames++;
    if (!(sampleMs > 0) || !Number.isFinite(sampleMs)) return this.scale;
    this.sinceChange++;
    if (this.sinceChange <= o.skip) { if (!this._cost) this._cost = sampleMs; return this.scale; }
    this.samples.push(sampleMs);
    if (this.samples.length > o.window) this.samples.shift();
    const sorted = [...this.samples].sort((a, b) => a - b);
    this._cost = sorted[sorted.length >> 1];
    if (this.samples.length < o.minSamples) return this.scale;
    // One decision per half window while holding, so 'headroom' has to be seen on consecutive decisions before the scale grows.
    if (++this.sinceDecision < Math.ceil(o.minSamples / 2)) return this.scale;
    this.sinceDecision = 0;
    const cost = this._cost, budget = o.budgetMs;
    let next = this.scale;
    if (cost > budget * o.over) {
      // Shrink to the scale that the area model says lands on 95 percent of the budget, by at most 30 percent per decision.
      next = this.scale * Math.max(0.7, Math.min(1, Math.sqrt(budget * 0.95 / cost)));
      if (this.frames - this.lastGrow < o.minSamples * 4) { this.ceiling = this.scale * 0.97; this.ceilingUntil = this.frames + 600; }   // that grow was a mistake
    } else if (cost < budget * o.under && this.scale < o.maxScale && ++this.underStreak >= 2) {
      const cap = this.frames < this.ceilingUntil ? this.ceiling : o.maxScale;
      const up = Math.min(o.maxScale, cap, this.scale * Math.min(1.12, Math.sqrt(budget * 0.92 / cost)));
      if (up > this.scale) next = up;
    }
    if (cost >= budget * o.under) this.underStreak = 0;
    next = Math.min(o.maxScale, Math.max(o.minScale, next));
    if (next !== this.scale && (Math.abs(next - this.scale) >= 0.03 || next === o.minScale || next === o.maxScale)) {
      if (next > this.scale) this.lastGrow = this.frames;
      this.scale = Math.round(next * 100) / 100;
      this.sinceChange = 0; this.sinceDecision = 0; this.underStreak = 0; this.samples.length = 0;
      this.changes++;
    }
    return this.scale;
  }
}

/**
 * Facts about the device for `selectTier`. A GPUDevice's `limits` are what was requested (the defaults: 8192 texels, say, on any desktop
 * GPU), not what the hardware can do, so limits only vote when the `adapter` itself is given (its `limits`, `features` and `info`).
 * `device.adapterInfo` (vendor, architecture) is read when the browser has it.
 */
export function describeDevice(device: { features: Iterable<string>; adapterInfo?: AdapterInfoLike }, extra: { adapter?: { limits: GPUSupportedLimits | Record<string, number>; features: Iterable<string>; info?: AdapterInfoLike }; pixels?: number; mobile?: boolean } = {}): TierInputs {
  const adapter = extra.adapter;
  const info = adapter?.info ?? device.adapterInfo;
  const l = adapter ? (adapter.limits as unknown as Record<string, number>) : undefined;
  let mobile = extra.mobile;
  if (mobile === undefined && typeof navigator !== 'undefined') {
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
    mobile = nav.userAgentData?.mobile ?? (/Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent) || (nav.maxTouchPoints > 1 && /Macintosh/.test(nav.userAgent)));
  }
  return {
    vendor: info?.vendor, architecture: info?.architecture, device: info?.device, description: info?.description, isFallback: info?.isFallbackAdapter,
    limits: l && { maxTextureDimension2D: l.maxTextureDimension2D, maxTextureDimension3D: l.maxTextureDimension3D, maxComputeWorkgroupStorageSize: l.maxComputeWorkgroupStorageSize, maxStorageBufferBindingSize: l.maxStorageBufferBindingSize, maxBufferSize: l.maxBufferSize },
    features: adapter?.features ?? device.features, pixels: extra.pixels, mobile,
  };
}
export interface AdapterInfoLike { vendor?: string; architecture?: string; device?: string; description?: string; isFallbackAdapter?: boolean }

/** The passes whose time is controlled: everything except the sun-driven light grid, which is amortized over many frames and cannot be scaled. */
export const AUTO_QUALITY_PASSES = ['marchNear', 'resolveNear', 'marchFar', 'resolveFar', 'composite', 'dome', 'skyLayer', 'skyResolve'] as const;

/** Sum of the controlled passes in a `GpuTimer.last()` / `averages()` record, ms. */
export function controlledCost(timings: Record<string, number>): number {
  let sum = 0;
  for (const n of AUTO_QUALITY_PASSES) sum += timings[n] ?? 0;
  return sum;
}
