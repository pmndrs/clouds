// W2 weather in the bench: one scheduler (packages/runtime/src/procedural/weather), driven from the sky's update job, pushing the transition into the
// runtime (proc.setWeather: a lerp of two generated maps, composed on the GPU a few times a second) and the cirrus layer's cover.
//   URL: ?wx=overcast            start settled in a state
//        ?wxfrom=clear&wx=overcast&wxt=0.5   frozen half way through a transition (linear progress; captures)
//        ?wxauto=1&wxdur=20&wxhold=40         the automatic cycle
//   Bookmark variant: high@wx:clear:overcast:0.5 (frozen), high@wx:overcast (settled)
import { createStore, useStore } from 'zustand';
import { WEATHER_BY_NAME, WeatherScheduler } from '../../../../packages/runtime/src/procedural/weather/states';
import type { BenchRuntime } from './store';

export interface WeatherUi {
  active: boolean;
  from: string;
  to: string;
  progress: number;
  auto: boolean;
  duration: number;
  hold: number;
  frozen: boolean;
}

const sched = new WeatherScheduler(WEATHER_BY_NAME.cumulus);
export const weather = createStore<WeatherUi>(() => ({ active: false, from: 'cumulus', to: 'cumulus', progress: 1, auto: false, duration: 20, hold: 40, frozen: false }));
export const useWeather = <T,>(sel: (s: WeatherUi) => T): T => useStore(weather, sel);
export const weatherScheduler = sched;

let lastRt: BenchRuntime | null = null;
let pushedT = NaN, pushedTo = '', pushedFrom = '', pushedActive = false, lastUi = 0;

const mirror = () => weather.setState({ from: sched.from.name, to: sched.to.name, progress: sched.progress, auto: sched.auto, duration: sched.duration, hold: sched.hold });

/** Go to a state over `seconds` (the current duration by default). Starting the first time engages the weather (the neutral 'cumulus' is the base map). */
export function weatherGo(name: string, seconds?: number): void {
  const st = WEATHER_BY_NAME[name];
  if (!st) throw new Error(`unknown weather state: ${name}`);
  weather.setState({ active: true, frozen: false });
  sched.go(st, seconds ?? weather.getState().duration);
  mirror();
}
export function weatherOff(): void { weather.setState({ active: false, frozen: false }); }
export function weatherAuto(on: boolean): void { sched.auto = on; mirror(); }
export function weatherSetDuration(s: number): void { sched.duration = s; mirror(); }
export function weatherSetHold(s: number): void { sched.hold = s; mirror(); }
/** Freeze at a point of a transition (linear progress 0..1). */
export function weatherFreeze(from: string, to: string, progress: number): void {
  const a = WEATHER_BY_NAME[from], b = WEATHER_BY_NAME[to];
  if (!a || !b) throw new Error(`unknown weather state: ${!a ? from : to}`);
  sched.set(a, b, progress); weather.setState({ active: true, frozen: true }); mirror();
}

/** The URL and bookmark entry points. */
export function weatherFromQuery(q: URLSearchParams): void {
  if (q.has('wxdur')) sched.duration = Number(q.get('wxdur'));
  if (q.has('wxhold')) sched.hold = Number(q.get('wxhold'));
  const to = q.get('wx');
  if (!to) return;
  const from = q.get('wxfrom'), t = q.get('wxt');
  if (from || t !== null) weatherFreeze(from ?? 'cumulus', to, t === null ? 1 : Number(t));
  else weatherFreeze(to, to, 1);
  if (q.get('wxauto') === '1') { sched.auto = true; weather.setState({ frozen: false }); }
}
export function weatherBookmark(args: string[]): void {
  if (args.length === 1) weatherFreeze(args[0], args[0], 1);
  else weatherFreeze(args[0], args[1], args[2] === undefined ? 1 : Number(args[2]));
}

/** Per frame (the sky's update job). Cheap when nothing moves: the runtime is only called when the eased position moved by 1/512 or a state changed. */
export function weatherTick(dt: number, rt: BenchRuntime): void {
  lastRt = rt;
  const ui = weather.getState();
  if (!ui.active) {
    if (pushedActive) { rt.proc.setWeather(null); pushedActive = false; pushedT = NaN; }
    return;
  }
  if (!ui.frozen) sched.update(Math.min(dt, 0.25));
  const f = sched.frame();
  const dirty = !pushedActive || f.from.name !== pushedFrom || f.to.name !== pushedTo || !(Math.abs(f.t - pushedT) < 1 / 512);
  if (dirty) {
    pushedActive = true; pushedFrom = f.from.name; pushedTo = f.to.name; pushedT = f.t;
    rt.proc.setWeather({ from: { ndf: f.from.ndf, coverageBias: f.from.coverageBias, typeBias: f.from.typeBias }, to: { ndf: f.to.ndf, coverageBias: f.to.coverageBias, typeBias: f.to.typeBias }, t: f.t });
    rt.sources.cirrus.coverage = f.cirrusCoverage; rt.sources.cirrus.veil = f.cirrusVeil;
  }
  // The panel mirrors the scheduler at about 10 Hz (React never re-renders per frame).
  const now = performance.now();
  if (now - lastUi > 100 && (sched.moving || ui.progress !== sched.progress || ui.to !== sched.to.name)) { lastUi = now; mirror(); }
}

/** Scripting hook (captures, console): window.__weather.go('overcast', 12), .freeze('clear', 'overcast', 0.5), .off(), .state(). */
(window as unknown as { __weather: unknown }).__weather = { go: weatherGo, freeze: weatherFreeze, off: weatherOff, auto: weatherAuto, state: () => ({ ...weather.getState(), progress: sched.progress }) };

/** Cost of one compose (ms of GPU wall time per setWeather step, queue drained after each): window.__weather.cost(40). */
async function composeCost(n = 40): Promise<{ msPerCompose: number; first: number }> {
  const rt = lastRt, dev = (rt?.renderer as unknown as { backend?: { device?: GPUDevice } } | undefined)?.backend?.device;
  if (!rt || !dev) throw new Error('no runtime / device');
  const a = { ndf: {}, coverageBias: 0, typeBias: 0 }, b = { ndf: { maxHeight: 0.35 }, coverageBias: 0.4, typeBias: -0.7 };
  rt.proc.setWeather({ from: a, to: b, t: 0 }); await dev.queue.onSubmittedWorkDone();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { rt.proc.setWeather({ from: a, to: b, t: (i + 1) / (n + 1) }); await dev.queue.onSubmittedWorkDone(); }
  const per = (performance.now() - t0) / n;
  return { msPerCompose: per, first: 0 };
}
(window as unknown as { __weather: Record<string, unknown> }).__weather.cost = composeCost;
