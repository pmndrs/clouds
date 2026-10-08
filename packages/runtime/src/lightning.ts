// Lightning (P6-B): flashes are transient point lights inside the cloud. This file is the CPU side: the flash list, the stroke flicker
// profile and the automatic flash generator. The GPU side is the glow term in march.wgsl.ts (Nubis³ s130), driven by one uniform
// (flash position + radius, flash colour) that the runtime writes every frame. When nothing is flashing the radius is 0 and the
// march's `if (frame.flash.w > 0.0)` is a uniform branch that is not taken: no extra samples, no extra memory traffic.
// Renderer-agnostic: no three imports.

export interface FlashOptions {
  /** World position (metres) of the discharge. */
  position: [number, number, number];
  /** Metres: the glow term reaches this far (Nubis: `pow(1 - d/r, 12)` shaped). Default 600. */
  radius?: number;
  /** Peak brightness as a multiple of the scene's light reference (sun + sky ambient luminance). Default 1. */
  intensity?: number;
  /** Seconds the whole flash lasts (2-4 strokes plus the continuing glow between them). Default 0.3. */
  duration?: number;
  /** Linear RGB tint, multiplied by intensity. Default a cold white-blue. */
  color?: [number, number, number];
  /** Number of return strokes, 1-6. Default: 2-4 from the seed. */
  strokes?: number;
  /** Seed for the stroke timing and strengths. Default: derived from the position. */
  seed?: number;
  /** A constant flash that lasts `duration` with no flicker (deterministic captures and look development). */
  steady?: boolean;
}

/** What the march needs this frame; `null` when no flash is active. */
export interface FlashState {
  position: [number, number, number];
  radius: number;
  /** Linear RGB, already multiplied by the intensity envelope. */
  color: [number, number, number];
  /** Envelope 0..1 of the flash this frame (peak 1), for the temporal resolve. */
  level: number;
}

export interface LightningSettings {
  /** Automatic flashes per second (Poisson). 0 = off. Default 0. */
  rate: number;
  /** Where automatic flashes strike: a vertical cylinder (centre x, base y, z; radius; height). Default none, which turns the automatic flashes off. */
  region: { center: [number, number, number]; radius: number; height: number } | null;
  /** Range of the automatic flashes' radius (m), intensity and duration (s). */
  radiusRange: [number, number];
  intensityRange: [number, number];
  durationRange: [number, number];
  color: [number, number, number];
}

export const LIGHTNING_DEFAULTS: LightningSettings = {
  rate: 0, region: null, radiusRange: [450, 900], intensityRange: [0.6, 1.6], durationRange: [0.22, 0.45], color: [0.78, 0.88, 1],
};

interface Stroke { at: number; peak: number; tau: number }
interface ActiveFlash {
  opts: Required<Omit<FlashOptions, 'strokes' | 'seed'>>;
  start: number;               // seconds on the frame clock; NaN until the next update() stamps it
  strokes: Stroke[];
}

function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** Stroke times (s from the start), peaks and decay constants of a flash: 2-4 return strokes over the duration, the strongest near the start. */
export function strokeProfile(duration: number, seed: number, count?: number): Stroke[] {
  const r = rng(Math.floor(seed * 7919) + 17);
  const n = Math.max(1, Math.min(6, count ?? 2 + Math.floor(r() * 3)));
  const out: Stroke[] = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    out.push({ at, peak: i === 0 ? 1 : 0.45 + 0.5 * r(), tau: 0.012 + 0.022 * r() });
    at += (duration * 0.85 / n) * (0.55 + 0.9 * r());
  }
  return out;
}

/** Brightness envelope 0..1 at `age` seconds into a flash: the strokes (fast rise, exponential decay) over a dimmer continuing glow that fades by the end. */
export function flashEnvelope(strokes: readonly Stroke[], duration: number, age: number): number {
  if (age < 0 || age > duration) return 0;
  let e = 0;
  for (const s of strokes) {
    const a = age - s.at;
    if (a < 0) continue;
    e = Math.max(e, s.peak * Math.min(1, a / 0.006) * Math.exp(-a / s.tau));
  }
  // continuing current: a dim glow that lasts through the strokes and dies by the end of the flash
  const last = strokes.length ? strokes[strokes.length - 1].at : 0;
  const glow = 0.22 * Math.min(1, age / 0.01) * (1 - Math.min(1, Math.max(0, (age - last) / Math.max(0.05, duration - last))) ** 2);
  return Math.min(1, Math.max(e, glow));
}

export interface Lightning {
  readonly settings: LightningSettings;
  /** Queue a flash; it starts at the next update(). */
  flash(options: FlashOptions): void;
  /** Advance to `now` (seconds, the frame clock) and return the flash to render, or null. Automatic flashes are generated here. */
  update(now: number): FlashState | null;
  /** Drop every flash. */
  clear(): void;
  readonly active: number;
}

export function createLightning(): Lightning {
  const settings: LightningSettings = { ...LIGHTNING_DEFAULTS, radiusRange: [...LIGHTNING_DEFAULTS.radiusRange], intensityRange: [...LIGHTNING_DEFAULTS.intensityRange], durationRange: [...LIGHTNING_DEFAULTS.durationRange], color: [...LIGHTNING_DEFAULTS.color] };
  const flashes: ActiveFlash[] = [];
  let lastNow = NaN, auto = 1, counter = 0;
  const rand = rng(0x9e3779b1);
  const add = (o: FlashOptions) => {
      const duration = Math.max(0.02, o.duration ?? 0.3);
      const seed = o.seed ?? (o.position[0] * 0.013 + o.position[1] * 0.029 + o.position[2] * 0.017 + (counter++) * 3.7);
      flashes.push({
        opts: { position: [...o.position], radius: Math.max(1, o.radius ?? 600), intensity: o.intensity ?? 1, duration, color: o.color ?? settings.color, steady: !!o.steady },
        start: NaN,
        strokes: o.steady ? [{ at: 0, peak: 1, tau: 1e9 }] : strokeProfile(duration, seed, o.strokes),
      });
  };
  return {
    settings,
    get active() { return flashes.length; },
    clear() { flashes.length = 0; },
    flash: add,
    update(now) {
      const dt = Number.isFinite(lastNow) ? Math.max(0, Math.min(0.25, now - lastNow)) : 0;
      lastNow = now;
      // Automatic flashes: Poisson arrivals at `rate` per second inside the region.
      if (settings.rate > 0 && settings.region && dt > 0 && rand() < 1 - Math.exp(-settings.rate * dt)) {
        const g = settings.region;
        const a = rand() * Math.PI * 2, rr = g.radius * Math.sqrt(rand());
        const lerp = (r: [number, number]) => r[0] + (r[1] - r[0]) * rand();
        add({
          position: [g.center[0] + Math.cos(a) * rr, g.center[1] + g.height * (0.25 + 0.65 * rand()), g.center[2] + Math.sin(a) * rr],
          radius: lerp(settings.radiusRange), intensity: lerp(settings.intensityRange), duration: lerp(settings.durationRange), color: settings.color, seed: auto++ * 1.618,
        });
      }
      // The brightest active flash is the one rendered (a uniform holds one); overlapping flashes are rare and the older one is usually the dimmer.
      let best: FlashState | null = null, bestScore = 0;
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        if (Number.isNaN(f.start)) f.start = now;
        const age = now - f.start;
        if (age > f.opts.duration) { flashes.splice(i, 1); continue; }
        const level = f.opts.steady ? 1 : flashEnvelope(f.strokes, f.opts.duration, age);
        const score = level * f.opts.intensity;
        if (score > bestScore || (!best && level > 0)) {
          bestScore = score;
          const k = f.opts.intensity * level;
          best = { position: f.opts.position, radius: f.opts.radius, color: [f.opts.color[0] * k, f.opts.color[1] * k, f.opts.color[2] * k], level };
        }
      }
      return best;
    },
  };
}
