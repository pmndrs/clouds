// W2 weather states (NE22 p.77-78: "weather states are whole cloudscapes of NDFs that transitions move between"). A state is a small set of NDF
// parameters: the generator settings it overrides (heights, recipe knobs), additive coverage and type biases, and the cirrus layer's cover.
// A transition lerps the served NDF between two states' maps (ProceduralClouds.setWeather) and these numbers alongside it.
import type { HzdNdfSettings } from '../settings';
import { mixf } from './blend';

export interface WeatherState {
  name: string;
  about: string;
  /** Overrides on the base HzdNdfSettings (the generator); anything else keeps the bench's value. Keep the seed so the cloud layout morphs rather than swaps. */
  ndf: Partial<HzdNdfSettings>;
  /** Added to the generated coverage (+-0.5, hzd15 s38-42) and top type (+-1) in the compose pass. */
  coverageBias: number;
  typeBias: number;
  /** The cirrus layer's cover (0..1) and veil (cirrostratus sheet, 0..1). */
  cirrusCoverage: number;
  cirrusVeil: number;
}

export const WEATHER_STATES: WeatherState[] = [
  { name: 'clear', about: 'fair weather: a few small flat-based cumulus, thin wisps of cirrus',
    ndf: { maxHeight: 0.55 }, coverageBias: -0.22, typeBias: 0, cirrusCoverage: 0.15, cirrusVeil: 0 },
  { name: 'cumulus', about: 'the default sky: scattered cumulus bodies, cirrus on the high layer',
    ndf: {}, coverageBias: 0, typeBias: 0, cirrusCoverage: 0.4, cirrusVeil: 0.05 },
  { name: 'towering', about: 'building convection: more and taller bodies, thick tops',
    ndf: { maxHeight: 1 }, coverageBias: 0.12, typeBias: 0.25, cirrusCoverage: 0.3, cirrusVeil: 0 },
  { name: 'stratocumulus', about: 'a broken low deck: flatter tops, wide coverage',
    ndf: { maxHeight: 0.5, heightVariation: 0.1 }, coverageBias: 0.22, typeBias: -0.5, cirrusCoverage: 0.25, cirrusVeil: 0.1 },
  { name: 'overcast', about: 'a grey stratus lid with a cirrostratus sheet above',
    ndf: { maxHeight: 0.35, heightVariation: 0.08 }, coverageBias: 0.45, typeBias: -0.75, cirrusCoverage: 0.6, cirrusVeil: 0.6 },
];
export const WEATHER_BY_NAME: Record<string, WeatherState> = Object.fromEntries(WEATHER_STATES.map(s => [s.name, s]));

/** Smootherstep: zero slope at both ends so a transition starts and ends without a visible change of speed. */
export const ease = (t: number) => { const x = t < 0 ? 0 : t > 1 ? 1 : t; return x * x * x * (x * (x * 6 - 15) + 10); };

export interface WeatherFrame {
  from: WeatherState;
  to: WeatherState;
  /** 0..1, eased. */
  t: number;
  /** The lerped numbers (the cirrus layer; the NDF biases are lerped per texel on the GPU by the same amounts). */
  coverageBias: number;
  typeBias: number;
  cirrusCoverage: number;
  cirrusVeil: number;
}

/**
 * The scheduler: a manual `go(state, seconds)` and an optional automatic cycle (`auto`: after `hold` seconds in a state, move to the next
 * in `order`). Pure and time-driven: call `update(dt)` each frame. A `go` during a transition is queued and starts when it lands (the served
 * map is a lerp of two maps, so a third state cannot enter mid-way without a jump).
 */
export class WeatherScheduler {
  from: WeatherState;
  to: WeatherState;
  /** Linear progress 0..1 of the current transition (1 = settled in `to`). */
  progress = 1;
  duration = 20;
  auto = false;
  /** Seconds a state holds before the automatic cycle moves on. */
  hold = 40;
  order: WeatherState[];
  queued: { state: WeatherState; seconds: number } | null = null;
  private held = 0;
  constructor(start: WeatherState = WEATHER_STATES[1], order: WeatherState[] = WEATHER_STATES) { this.from = this.to = start; this.order = order; }

  /** Start moving to `state` over `seconds` (queued if a transition is under way). */
  go(state: WeatherState, seconds = this.duration): void {
    if (this.progress < 1) { this.queued = { state, seconds }; return; }
    this.queued = null;
    if (state === this.to) return;
    this.from = this.to; this.to = state; this.duration = Math.max(seconds, 0); this.progress = this.duration > 0 ? 0 : 1; this.held = 0;
  }
  /** Jump to a fixed point of a transition (frozen captures). */
  set(from: WeatherState, to: WeatherState, progress: number): void { this.from = from; this.to = to; this.progress = progress; this.queued = null; this.held = 0; }

  update(dt: number): void {
    if (this.progress < 1) {
      this.progress = this.duration > 0 ? Math.min(1, this.progress + dt / this.duration) : 1;
      if (this.progress >= 1 && this.queued) { const q = this.queued; this.go(q.state, q.seconds); }
      return;
    }
    if (!this.auto) return;
    this.held += dt;
    if (this.held >= this.hold) this.go(this.order[(this.order.indexOf(this.to) + 1) % this.order.length], this.duration);
  }
  get moving() { return this.progress < 1; }
  frame(): WeatherFrame {
    const t = ease(this.progress), a = this.from, b = this.to;
    return { from: a, to: b, t, coverageBias: mixf(a.coverageBias, b.coverageBias, t), typeBias: mixf(a.typeBias, b.typeBias, t),
      cirrusCoverage: mixf(a.cirrusCoverage, b.cirrusCoverage, t), cirrusVeil: mixf(a.cirrusVeil, b.cirrusVeil, t) };
  }
}
