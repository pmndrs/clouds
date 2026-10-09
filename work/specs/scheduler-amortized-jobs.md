# Proposal: amortized jobs for `@pmndrs/scheduler`
Status: draft for owner review. Author: S1-spec design agent. Baseline: `@pmndrs/scheduler` 0.2.0 (types read from `dist/index.d.ts`), r3f v10 frame-loop doc.
Consumer: the WebGPU cloud renderer in this repo (`packages/runtime`, `packages/three`).

## 1. Problem and goals

### What exists
The scheduler runs **jobs**: a callback, a phase, `before`/`after`/`priority` ordering, `fps` throttling (at most one call per RAF, `drop` decides timestamp catch-up), `enabled`, pause/resume. A job is a **one-shot call per frame**: it takes whatever time it takes. There is no notion of *cost*, of *work that must be cut into slices*, or of *a budget shared between jobs*.

### What we need
The cloud renderer spreads expensive GPU work across frames by hand, in six places, each with its own cadence logic:

| Work | Slicing today | Rate / cost | Source |
| --- | --- | --- | --- |
| Sky layer trace | 1/16 of pixels per frame (Bayer 4x4) | every frame, biggest pass | P9-C3 |
| Dome (reflection) refresh | 1/16 per frame | 15-30 Hz would do | P9-C3 "For S1" |
| Light grid rebuild | 8 z-slice groups, swap when all 8 done | on change | `light-grid.ts` |
| Shadow map | 1/24 of the rows, double rate on first fill / sun jump | only while stale; 0.32 ms per refresh frame | P10-A |
| Sky weather bake | 32-row tiles, 65 frames per window | on weather change; 0.37-0.51 ms worst tile | P9-B2 |
| Evolution regeneration | ~1.3 generation jobs per frame over 1.2 s, every 1.5 s | 0.65 ms worst job, ~0.2 ms average | P6-A |

Owner budget model (`docs/PLAN-2026-10-next.md`): steady cloud cost about **20% of the frame at the target rate**, and background work must never spike a frame by more than **10% of the frame** (1.7 ms at 60 fps, 3.3 ms at 30 fps). Today each module enforces this alone, by constants tuned on one laptop (e.g. `bakeRows = 32` because 64-row tiles reached 1.1 ms inside a full frame). Nothing arbitrates when three of them land on the same frame, and nothing adapts when the device is slower.

The owner's idea ("freeze until observed", `docs/research/cloud-motion-ideas.md`): most of the time nobody studies the clouds, so animation and regeneration can pause, and resume when the camera is still and the clouds are on screen.

### Goals
1. **Time-sliced, resumable jobs.** A job is split into slices; the scheduler decides how many *work units* each job may do this frame so the sum fits a per-frame ms budget.
2. **Own rates.** Each job has its own target rate (`fps`, reusing the existing option) and may be demand-driven (only while "stale").
3. **Budget shared by priority**, with defined behaviour under pressure (defer, then degrade, then drop) and starvation protection.
4. **GPU-time feedback.** Use measured ms per unit, returned late by timestamp queries, to size the next slices, without the scheduler knowing anything about GPUs.
5. **Gates.** Pause jobs when they are off-screen or the camera is moving fast (an *observation gate*), resuming cleanly.
6. **Fits the existing model**: phases, `priority`, `fps`, `enabled`, `before`/`after`, roots. No second scheduler.

### Non-goals
- Not a general task queue or worker pool. No threads, no `requestIdleCallback` replacement.
- No GPU knowledge in the scheduler. It never sees a device, an encoder or a timestamp query; it sees numbers a host feeds it.
- No preemption inside a slice. A slice is the atomic unit; it runs to completion.
- No hard real-time guarantees. The budget is a controller target, not a fence.
- Not replacing `useFrame` for ordinary per-frame callbacks. Plain jobs behave exactly as today.

## 2. API sketch

Design rule: an amortized job is a normal job with extra optional fields. `register` keeps its signature; a callback registered with `work` options is an *amortized job*.

```ts
// ---- additions to JobOptions (all optional; absent => unchanged behaviour) ----
interface JobOptions {
  // ...existing: id, phase, before, after, priority, fps, drop, enabled

  /** Marks this as an amortized job and describes its work. */
  work?: WorkOptions;
  /** Evaluated before the job is considered. false => job is idle this frame (not "behind"). */
  when?: (state: FrameTimingState) => boolean;
}

interface WorkOptions {
  /** Share of the frame budget this job may take per frame at most (ms). Hard cap per slice grant. */
  budgetMs?: number;
  /** Prior cost per unit in ms, used until measurements exist. Default: 0.25 * budgetMs. */
  costHintMs?: number;
  /** Largest and smallest grant, in units. min defaults to 1. A job is never granted 0 unless gated. */
  maxUnits?: number;
  minUnits?: number;
  /** Total units of one cycle if known (rows, slices, tiles). Enables progress and "cycle done" accounting. */
  totalUnits?: number;
  /** Behaviour when the job cannot get its minimum this frame. Default 'defer'. */
  pressure?: 'defer' | 'degrade' | 'drop';
  /** Max consecutive frames a deferred job may be skipped before it is force-granted minUnits. Default 8. */
  starvationFrames?: number;
  /** Observation gate (section 6). */
  observe?: ObserveGate;
}

/** What the callback receives, beside the normal (state, delta). */
interface SliceContext {
  /** Units this call may do. 1..maxUnits. Do at most this many; fewer is fine. */
  units: number;
  /** Ms the scheduler expects those units to cost (units * estimate). Informational. */
  expectedMs: number;
  /** Progress of the current cycle if totalUnits was given: units already reported done. */
  done: number;
  /** Set when the previous cycle was abandoned (gate closed, reset()), so the job restarts clean. */
  restarted: boolean;
  /** Pressure level this frame: 0 none, 1 deferred others, 2 degraded. Jobs may lower quality at >=2. */
  pressure: 0 | 1 | 2;
  /** Ticket identifying this slice for GPU-time feedback (section 5). */
  ticket: SliceTicket;
}

type SliceResult =
  | void                                   // treated as { done: ctx.units, state: 'continue' }
  | number                                  // units actually done (state 'continue')
  | { done?: number; state?: 'continue' | 'complete' | 'idle'; };
//   complete: cycle finished; job becomes idle until `invalidate`d (or its `fps` timer re-arms it)
//   idle:     nothing to do right now (not stale); costs 0 until woken

/** Generator form: each `yield` is a slice boundary; the scheduler resumes it with a grant. */
type WorkGenerator = Generator<SliceYield | void, void, SliceContext>;
interface SliceYield { done?: number }       // units completed since the last yield

interface WorkJobControls extends FrameControls {
  /** Request a new cycle (data became stale). Wakes an 'idle'/'complete' job. */
  wake(): void;
  /** Abandon the current cycle; next slice gets restarted = true. Generators are re-created. */
  reset(): void;
  /** Feed a measurement for a past slice (section 5). */
  report(ticket: SliceTicket, ms: number): void;
  /** The host marks the current cycle recorded (e.g. after its GPU work is encoded); the job goes 'complete' until wake(). */
  complete(): void;
  readonly stats: WorkStats;
}
interface WorkStats {
  estimateMsPerUnit: number; lastGrantUnits: number; lastGrantMs: number;
  deferredFrames: number; starved: number; cyclesCompleted: number; gated: boolean;
}
```

Registration, plain function form:

```ts
const off = scheduler.register(
  (state, delta, slice: SliceContext) => {
    const rows = Math.min(slice.units, rowsLeft);
    bakeRows(nextRow, rows);                // does the work for `rows` units
    nextRow += rows; rowsLeft -= rows;
    return rowsLeft === 0 ? { done: rows, state: 'complete' } : rows;
  },
  { id: 'cloud:weather-bake', phase: 'amortize', priority: 5, fps: 60,
    work: { budgetMs: 0.5, costHintMs: 0.01, totalUnits: 512, maxUnits: 128, pressure: 'defer' } },
);
```

Generator form (resumable state is the generator's locals, which fits the cloud passes well):

```ts
scheduler.registerGenerator(function* bake(slice) {
  for (let row = 0; row < 512; ) {
    const n = Math.min(slice.units, 512 - row);
    bakeRows(row, n); row += n;
    slice = (yield { done: n })!;           // scheduler resumes next frame with a fresh grant
  }
  swapWindow();
}, { id: 'cloud:weather-bake', phase: 'amortize', work: { budgetMs: 0.5, totalUnits: 512 } });
```

`registerGenerator` is sugar: it wraps the generator in a function-form job and calls `.next(slice)` once per grant. `return` = `complete`. A thrown error goes to `onError` and ends the cycle (the job is re-armed on `wake()`).

### How it fits existing concepts
- **Phases.** Add a default phase `'amortize'` between `'update'` and `'render'` (`start, input, physics, update, amortize, render, finish`). Jobs in `'update'` and `'physics'` have already moved the camera and the sun, so gates and "stale" tests see current values; the allocator runs once at the head of the phase. Custom phases still work: a work job may live in any phase.
- **Priority.** Same field. Within a phase, higher runs first *and* is served first by the allocator.
- **`fps`.** Same field, same meaning (min interval, at most one call per RAF), with one change in meaning for work jobs: the interval gates *when a new slice may be granted*, not a cycle. A dome refreshed at 20 Hz is `fps: 20, work: { totalUnits: 16 }` for sliced refresh, or one unit per grant.
- **`drop`.** For work jobs `drop: true` (default) means a missed interval is forgotten (the job does not take double grants to catch up). `drop: false` allows up to `maxUnits` catch-up grants and is only meant for simulation-like jobs.
- **`enabled` / pause / resume.** Unchanged. A paused job is not gated, it is just off. The observation gate is separate (section 6) so the two do not fight over one flag.
- **Roots.** Each root has its own budget (`RootOptions.budgetMs`, see 3.1). A job belongs to one root, as now. Multiple Canvases do not steal each other's budget.
- **Demand mode.** In `frameloop="demand"`, a work job with outstanding cycles calls `invalidate()` on its root for the next frame, so a bake finishes without user input. This is the scheduler-level version of our rule "never render only on input".

## 3. Semantics

### 3.1 The budget
Per root, one budget per frame:

```
budgetMs = max(0, frameBudgetMs * spendFraction - nonJobCostMs)
```
`RootOptions` gets `frame?: { targetFps?: number; backgroundFraction?: number; steadyFraction?: number }`. Meaning:

- `targetFps` (default: measured display rate, snapped; or the root's `fps`). `frameBudgetMs = 1000 / targetFps`.
- `spikeFraction` (default 0.10): **upper bound on what amortized jobs may add to any single frame**. This is the owner's "at most 10% of the frame". At 60 fps = 1.67 ms.
- Steady state is the *job authors'* concern (the 20% steady figure covers the always-running render passes, which are not jobs). The scheduler only enforces the spike bound, and *reports* the steady figure in stats.

The budget is in **host-measured milliseconds**. For CPU jobs the scheduler measures with `performance.now()` around the call. For GPU-encoding jobs the cost is not the CPU time of encoding; the host supplies it (section 5). A job declares which with `work.cost: 'cpu' | 'external'` (default `'cpu'`).

### 3.2 Allocation algorithm (once per root per frame, head of the `amortize` phase)
```
candidates = work jobs that are enabled, not gated, `when()` true, interval elapsed, and not 'idle'
sort by (priority desc, then starvation age desc, then registration order)
remaining = budgetMs - pendingMs            // pendingMs: ms already committed by in-flight slices (section 5)
for job in candidates:
    est   = job.estimateMsPerUnit             // EWMA or hint
    want  = clamp(floor(min(job.budgetMs, remaining) / est), 0, job.maxUnits)
    if want >= job.minUnits:   grant(job, want); remaining -= want * est
    else:                      apply job.pressure
```
`minUnits` is never split: a slice that costs more than the whole remaining budget is *not* started (unless starved, below).

### 3.3 Pressure: defer, degrade, drop
When a job cannot get `minUnits`:

- **defer** (default): skip this frame, keep the cycle, increment `deferredFrames`. The job keeps its place and gets priority by age next frame. Right for *correctness-latency* work (weather bake, evolution swap, light grid): it just finishes later.
- **degrade**: grant `minUnits` anyway, set `slice.pressure = 2` so the job can lower quality (fewer march steps in the shadow map, skip a light-grid sub-pass). Charge the overrun to `remaining` (may go negative, which starves lower priorities). Right for work whose *visible* output is wrong if it stalls (sky layer trace).
- **drop**: abandon this frame's slice and the rest of the cycle (`reset()`); the next cycle restarts from the current data. Right for work that is stale by the time it completes (a dome refresh when the sun moved again).

Hysteresis: pressure state changes only after 2 consecutive frames above/below threshold so one slow frame does not flap jobs.

### 3.4 Starvation
A deferred job's age grows by 1 per skipped frame. At `starvationFrames` it is **force-granted `minUnits`** ahead of everyone *within the spike bound x 1.5* (a documented soft overshoot, so a high-priority hog cannot starve a low-priority job forever). Starved grants are counted in `stats.starved`; a nonzero count means the budget is too small for the declared jobs, and the dev build warns once with the job table.

### 3.5 Ordering relative to render
Jobs have two kinds of output: *CPU state* (done by the end of the call) and *recorded GPU work* (executed when the host submits). Three rules:

1. The allocator and all slice callbacks run in `amortize` (or another phase before `render`). Callbacks may **record** work; the host submits it in its own render step. That fits the cloud runtime, which builds one command encoder per frame inside the render node.
2. A job whose slice produces results another job or the renderer reads *this frame* must be ordered with `before`/`after` as now. Cross-frame hand-offs (swap when the cycle completes) must go through the job's own `complete` result, never through shared mutable state read from `render`.
3. `complete` is reported to the host in the same call, so double-buffer swaps happen in the frame after the last slice's *submit*. The host, not the scheduler, knows when GPU work finishes; for GPU jobs `complete` means "all slices recorded", and the swap is a host concern (our `swapVolume` already waits until the encoder is submitted).

### 3.6 Pause and resume
- `pause()` / `enabled=false`: the job is off. Cycle state is kept; resume continues from the same slice.
- **Gate close** (section 6): the cycle is *frozen*, not reset, by default (`observe.onClose: 'freeze'`). A frozen cycle that has been frozen longer than `observe.staleAfterMs` is reset on reopen (`restarted = true`), because its inputs (camera, sun) are old.
- **Grants do not accumulate.** A job paused for 10 s resumes with a normal single grant, not 10 s of catch-up. This is the amortized-work version of `maxDelta`: a root that slept resumes where it left off.
- `reset()` always sets `restarted = true` on the next slice.
- Clean teardown: unregister disposes a suspended generator with `.return()`, so its `finally` blocks run.

## 4. Work units

A *unit* is whatever the job slices by: a row, a tile, a z-slice, 1/16 of the pixels. The scheduler never interprets it; it only multiplies by the estimated ms/unit. Reasons:

- It keeps the allocator renderer-agnostic and unit-free.
- Different jobs have different unit costs; the estimator is per job.
- `totalUnits` + `done` give progress (`stats`, devtools), without the job exposing internals.

Non-uniform units are fine: the estimator learns an average. When cost varies strongly between slices (shadow-map first fill vs. refresh, light-grid outside march), a job may return `{ done, costScale }` hint... **open question 9.5**: whether to allow per-slice cost multipliers or keep the estimator simple and let jobs split into several job ids (`light-grid:slice`, `light-grid:outside`).

## 5. GPU-time feedback

### 5.1 The problem
For a GPU job the CPU cost of encoding is microseconds; the GPU cost is what matters. Timestamp queries resolve **1-3 frames late** (`GpuTimer` has a ring of 3 buffers and "results lag 2-3 frames"), cover **named passes**, not slices, and are absent entirely on some devices. The scheduler must therefore:
- size *future* slices from *past* measurements without waiting,
- not over-grant while measurements are in flight,
- degrade gracefully with no measurements.

### 5.2 Mechanism
Every grant carries a `SliceTicket { jobId, seq, units, frame }`. The job (or its host) records the ticket against its GPU pass names. When the timer reports, the host calls `controls.report(ticket, ms)`. The scheduler needs no GPU concepts:

```ts
// host side, any frame, any later time
timer.onResult(({ passName, ms, frameTag }) => {
  const t = tickets.take(passName, frameTag);
  if (t) job.report(t, ms);
});
```

A convenience, `scheduler.createReporter(jobId)`, returns `(ticket, ms) => void` so a host with several attribution sources can fan in.

### 5.3 Estimator
Per job, ms per unit, measured against *units granted* (not units done), robust to outliers and to lag.

```
sample    = ms / ticket.units
e         = EWMA fast  (alpha 0.25)      // tracks changes in 4-8 samples
s         = EWMA slow  (alpha 0.05)      // long-term mean
estimate  = max(e, s * 0.75)             // do not trust a lucky fast run; lets cost fall slowly
estimate  = min(estimate, p90Window)     // p90 of the last 32 samples caps a single spike's influence
```
Implementation notes:
- **Cold start**: until `n >= 3` samples, `estimate = costHintMs`. If the host never reports (timer unavailable), the estimate stays at the hint, scaled by a **conservative feedback-free fallback**: the host may call `report(ticket, cpuMs)` with CPU encode time and a `scale`, or `work.costHintMs` is treated as a constant. This is the documented "no timer" mode: fixed grants, no adaptation.
- **Lag compensation**: the allocator subtracts `pendingMs` (granted slices without a result yet, each costed at the current estimate) from the budget for *the same job*, bounded to the last 3 frames. This stops the controller grant-burst: if three frames of results are outstanding, a job can't claim three frames of fresh budget it has not yet been charged for. Tickets expire after `ticketTtlFrames` (default 8) and are dropped without a sample.
- **Attribution**: passes shared by several jobs (e.g. `skyLayer` also in the cloud-total) may be reported once per frame; the host is responsible for subtracting known fixed passes. The scheduler offers `report(ticket, ms, { sharedWith })` which splits proportionally to the estimate; this is a convenience, not the recommended path.
- **Contention**: a slice measured inside a full frame costs more than in isolation (P9-B2: a 64-row tile was 0.37 ms alone and 1.1 ms inside a full frame). The estimator learns the in-frame cost because it is fed in-frame timestamps; that is the reason the feedback loop exists. The hint must not be taken from isolated benchmarks.
- **Bounded control**: grants change by at most x2 up or x0.5 down per frame.
- **Frame-level safety net**: independent of per-job estimates, the root keeps `frameMs` (host-reported total GPU or CPU frame time, lagged) and a spike detector: if a frame ran over `budget * 1.5`, the next frame's allocation `remaining` is reduced by the overrun (one-frame debt, capped at 50% of the budget).

Estimator quality is reported through `stats`: `estimateMsPerUnit`, `varianceMs`, `samples`, `lastTicketAgeFrames`.

### 5.4 Pass-name mapping (host contract)
The host registers the mapping once, so reports flow without per-frame glue:

```ts
job.bindMeasure('shadowMap');                     // timer name -> this job
host.timer.listen((name, ms, frameTag) => job.reportByName(name, ms, frameTag));
```
Minimal alternative kept in the proposal: only `report(ticket, ms)`; `bindMeasure` is sugar.

## 6. Visibility and observation gate

```ts
interface ObserveGate {
  /** Job is only active while this returns true each frame (clouds are on screen). */
  visible?: () => boolean;
  /** Close the gate while the camera moves faster than this. Units are the host's; see `speed`. */
  speed?: () => number;                 // current camera motion, host-defined units/s
  maxSpeed?: number;                    // gate closes above this
  openAfterMs?: number;                 // gate reopens this long after speed falls below maxSpeed. Default 250.
  /** What a closed gate means. 'freeze' keeps the cycle; 'reset' restarts. */
  onClose?: 'freeze' | 'reset';
  staleAfterMs?: number;                // reset on reopen if closed longer than this. Default 5000.
  /** Direction: gate *closes the job* when stable ('motion') or when moving ('rest'). Default 'rest'. */
  invert?: boolean;
}
```

- **Gate evaluation** happens once per frame per job before allocation; cost must be near zero (host closures reading cached values).
- **Page/tab visibility**: browsers already stop RAF in a hidden tab; the scheduler additionally exposes `scheduler.visible` (document + IntersectionObserver of the root canvas, optional) as a default for `visible`.
- **Two senses of "observed"** (the owner's idea is the second one):
  1. *Off-screen*: nothing to see; skip everything (rendering too, if the host says so).
  2. *Looked-at*: clouds are on screen *and the camera is still*. Most dynamics (evolution regeneration, weather re-bake) should run *only then*; while the camera moves, the eye does not resolve cloud-internal changes anyway, and spike budget is better spent on the renders. But the opposite also exists: a light-grid or shadow rebuild must complete *during* motion so the lighting does not stutter. So the gate is per job, not global.
- **Freeze and resume**: frozen jobs keep their cycle (generator suspended); on reopen, `openAfterMs` hysteresis prevents flapping at the speed threshold.
- **Never freeze a visible tear**: a job that is mid-swap (double buffers half-built) must declare `onClose: 'freeze'` and the host must keep presenting the old buffer. A job that cannot be frozen safely uses no gate.
- **Hand-off to frameloop**: if every work job is idle/frozen and the root is `demand`, no frames are requested. The clouds themselves animate by jitter and noise and keep a render job, but the *generative* work stops.

Cheap shortcut for hosts: `scheduler.setObserved(rootId, { visible, speed })` sets the default gate for all work jobs of that root; per-job `observe` overrides.

## 7. Our usage

### 7.1 Principles
- The runtime (`packages/runtime`) is renderer-agnostic and encode-only: it knows WebGPU, never three and never the scheduler. It must keep working with no scheduler at all (plain pages, other engines).
- So the runtime exposes a **descriptor list**, a small structural interface, and the host adapter decides whether to drive the jobs with a scheduler or with its own loop.

### 7.2 Runtime exposure (no scheduler import)

```ts
// packages/runtime/src/jobs.ts  (new; types only + tiny helper)
export interface CloudJob {
  /** Stable id, e.g. 'shadow-map', 'light-grid', 'sky-bake', 'dome', 'evolution'. */
  readonly id: string;
  /** Unit label: 'rows' | 'tiles' | 'slices' | 'sixteenths' ... */
  readonly unit: string;
  readonly totalUnits: number;
  /** True when the job has something to do now (stale data, cycle in progress). */
  pending(): boolean;
  /** Natural rate cap in Hz; 0 = every frame. */
  readonly rateHz: number;
  /** GPU pass name(s) the job's timestamps land in. */
  readonly passNames: readonly string[];
  /** Prior cost per unit (ms), measured in-frame. */
  readonly costHintMs: number;
  /** Largest sane slice, and the smallest. */
  readonly maxUnits: number; readonly minUnits: number;
  /** Record up to `units` units into this frame's encoder. Returns units recorded and whether the cycle completed. */
  encode(encoder: GPUCommandEncoder, units: number, timer?: GpuTimer): { done: number; complete: boolean };
  /** Drop the current cycle (inputs changed too much). */
  reset(): void;
  /** Quality hint under pressure (0 none, 2 degraded). Optional. */
  setPressure?(level: 0 | 1 | 2): void;
}
export interface CloudRuntime { /* existing */ readonly jobs: readonly CloudJob[]; }
```

Today every job's slice size is a runtime constant (`bakeRows = 32`, `1/24` rows, `1/16` pixels, `8` slices). With the descriptor, `encode()` takes the number of units from the caller. **Default policy when no scheduler is attached**: the runtime's own `driveJobs(encoder, frame)` grants exactly today's constants, so behaviour without the scheduler is byte-for-byte what it is now. The scheduler path is an upgrade, not a requirement.

### 7.3 The three-js wiring (`@clouds/three`)

```ts
// packages/three/src/schedule.ts
import { Scheduler } from '@pmndrs/scheduler';
import type { CloudRuntime, CloudJob } from '@clouds/runtime';

export function scheduleClouds(runtime: CloudRuntime, scheduler = Scheduler.get(), opts: { rootId?: string; camera: Camera; targetFps?: number } = {} as any) {
  const grants = new Map<string, number>();            // jobId -> units granted this frame
  const lastTickets = new Map<string, SliceTicket[]>();
  const offs: Array<() => void> = [];

  for (const job of runtime.jobs) {
    const ctl = scheduler.register((_s, _d, slice) => {
      grants.set(job.id, slice.units);                  // record the grant; the render node consumes it
      lastTickets.set(job.id, [...(lastTickets.get(job.id) ?? []), slice.ticket].slice(-4));
      job.setPressure?.(slice.pressure);
      return slice.units;                               // provisional; corrected by the encode result
    }, {
      id: `clouds:${job.id}`, phase: 'amortize', priority: PRIORITY[job.id], fps: job.rateHz || undefined,
      when: () => job.pending(),
      work: {
        cost: 'external', costHintMs: job.costHintMs, totalUnits: job.totalUnits,
        minUnits: job.minUnits, maxUnits: job.maxUnits,
        pressure: PRESSURE[job.id], observe: GATE[job.id](opts.camera),
      },
    });
    offs.push(() => scheduler.unregister(`clouds:${job.id}`));
    // measurement fan-in: each timer result -> the job that owns that pass
    runtime.timer.listen((pass, ms, frameTag) => {
      if (job.passNames.includes(pass)) ctl.report(takeTicket(lastTickets, job.id, frameTag), ms);
    });
  }

  // The render node consumes the grants inside its encoder, then clears them.
  return {
    encode(encoder: GPUCommandEncoder, timer: GpuTimer) {
      for (const job of runtime.jobs) {
        const n = grants.get(job.id); if (!n) continue;
        const r = job.encode(encoder, n, timer);
        if (r.complete) completeCycle(job.id); // host tells the scheduler the cycle is recorded (WorkJobControls.complete(), proposed)
      }
      grants.clear();
    },
    dispose() { offs.forEach(f => f()); },
  };
}
```
Where `PRIORITY`, `PRESSURE`, `GATE` are the table:

| Job | Priority | Pressure | Rate | Gate |
| --- | --- | --- | --- | --- |
| `sky-layer` trace | 10 | degrade (lower steps) | every frame | none (visual, must keep up) |
| `light-grid` | 8 | defer | on change, <= 20 Hz per slice | none; must finish during motion |
| `shadow-map` | 6 | defer (degrade steps on pressure 2) | only while stale, 0.32 ms/slice | `visible` |
| `sky-bake` tiles | 5 | defer | on weather change | none (finish; swap atomically) |
| `evolution` | 3 | defer | every 1.5 s, spread over 1.2 s | `visible` and `speed < max` ("freeze until observed") |
| `dome` | 2 | drop | 15-30 Hz | `visible` |

In the render node (`CloudNode` update), the order is: scheduler `amortize` phase has run, grants are set, `schedule.encode(encoder, timer)` is called where the code now calls `runtime.encode`. `runtime.encode` splits into a *fixed* part (march, resolve, composite) and the *jobs* part; with no scheduler, `driveJobs` stands in.

### 7.4 Observation gate in practice
```ts
const gate = (camera: Camera): ObserveGate => {
  const last = new Vector3(); let speed = 0;
  return {
    visible: () => runtime.sky.enabled && cameraSeesCloudShell(camera),
    speed: () => { /* cached, updated once per frame in 'update' */ return speed; },
    maxSpeed: 40,                // m/s; tuned by feel, owner's call
    openAfterMs: 300, onClose: 'freeze', staleAfterMs: 8000,
  };
};
```
Result: with the camera still and clouds in view, the evolution regenerates every 1.5 s as now; once the user moves the camera fast or looks away, regeneration stops after the in-flight slice, saving about 0.2 ms/frame average and removing the 0.65 ms worst-frame job; it resumes 300 ms after the camera settles.

### 7.5 What is *not* a scheduler job
The sky layer's 1/16 *trace* is the dominant steady cost, and it is the same pass as the rest of the frame (it writes the image every frame; its Bayer index is part of the frame uniforms). It is a *stable rate* case, so it must not be made optional. Include it as a `pressure: 'degrade'` job only if it can lower its own work (fewer samples per block, stipple); otherwise it stays in the fixed part of the frame and only its cost is reported to the root as `nonJobCostMs`, which reduces the amortized budget. This is the default recommendation.

## 8. Edge cases

1. **Zero budget frames.** A render spike leaves `remaining <= 0`. Allocation skips everything not starved; starvation floor still applies. Document that the spike bound can be exceeded by at most `minUnits` x estimate of one starved job.
2. **First-ever build.** `light-grid` builds all slices in one step at startup (existing behaviour). Express as `work.firstCycle: 'all'`, or let the job return `units = totalUnits` once with `pressure: 'ignore'`. Open question: should a first cycle be allowed to run all units in one grant?
3. **Timer missing or disabled.** Estimator stays on the hint. Provide `work.fixedUnits` (a host may force constant grants), and flag `stats.openLoop = true`.
4. **Timer results out of order or for dead jobs.** Tickets carry `seq`; stale or unknown tickets are dropped.
5. **Estimate poisoning** by a GC stall, tab switch or shader compile frame. The p90 cap and the x2 bounded step stop a single 50 ms sample from freezing a job. Samples above `20 x estimate` are discarded outright (counted in `stats.rejected`).
6. **Different target rates per root.** A 30 fps Canvas has a 3.3 ms spike budget; the same jobs on a 60 fps Canvas have 1.7 ms. Budgets come from the root, not the job.
7. **Job registered in the middle of a cycle / HMR.** The scheduler already preserves job identity across HMR (`jobStateListeners` by id); generators cannot survive HMR and restart with `restarted = true`.
8. **Unregister while GPU work is in flight.** The scheduler cannot cancel GPU work; the host must keep buffers alive until its tickets expire. Disposal order is the host's responsibility, and `unregister` returns after calling the generator's `return()`.
9. **`frameloop="never"` (manual `advance`).** Work jobs run only during `advance()`; budgets use the supplied timestamps. Deterministic testing: `scheduler.step(t, { measure })` with an injected `measure(ticket) => ms` so tests need no GPU.
10. **Multiple roots sharing one GPU.** Budgets are per root, but the GPU is shared; `scheduler.setSharedBudget('gpu', ms)` could pool them. Out of scope for v1, listed in open questions.
11. **Cycle completion races with a gate close.** `complete` wins if the last slice has already been recorded; the swap is not stranded behind a closed gate.
12. **Re-entrancy.** A slice callback must not call `wake()` on itself in a way that skips the interval; `wake()` marks stale and leaves timing to `fps`.

## 9. Open questions for the owner

1. **Home of the feature.** New phase `'amortize'` in the default list, or opt-in (`scheduler.addPhase('amortize', { before: 'render' })`)? Adding a default phase is a visible change for anyone listing `scheduler.phases`.
2. **One concept or two?** Fold `work` into `JobOptions` (as written), or a sibling `scheduler.registerWork()`? The first keeps `useFrame`'s options object the single source of truth, at the cost of growing a type that most callers use only for `fps` and `priority`. The hook form would be `useFrame(cb, { work: {...} })`; is a generator-accepting `useWork(function*(){...})` wanted?
3. **Budget ownership.** Per root, as proposed, or a single global budget? With two Canvases the answer changes who pays. What should the *default* `spikeFraction` be when the user did not set it, 0.10 or off (no limiting) so existing apps are unaffected?
4. **Cost model.** Is `cost: 'external'` plus `report(ticket, ms)` the right amount of surface, or should the scheduler accept a pluggable `CostSource` (`{ measure(job): ms | undefined }`)? The latter generalises to CPU profilers and WebGL disjoint timers, and keeps GPU concepts entirely out of the package.
5. **Unit cost variance.** Per-slice `costScale` hints versus splitting jobs (see section 4).
6. **Gate default.** Should `observe.visible` default to an `IntersectionObserver` on the root's canvas when the host provides one, or stay explicit? There is also a general demand-mode question: should a fully idle root stop requesting frames, and who owns wake-up from `wake()`?
7. **Generators in the core.** Generators allocate, and a hot frame loop should not. The function form with explicit state avoids that; is the generator sugar acceptable for hot jobs, or should it be a separate entry point that is tree-shakeable?
8. **Fairness inside equal priority.** Round robin by age (as proposed) or weighted by `budgetMs`? Does the owner want an explicit `weight`?
9. **Determinism.** Allocation depends on measured times, so two runs of the same scene differ in slice cadence. For the capture harness we need `scheduler.step(t, { measure })` with fixed costs. Is a deterministic mode an acceptable core feature, or a test-only export?
10. **Naming.** `work`/`units`/`slice` versus `task`/`chunk`/`step`. The scheduler already has `step()` meaning "run a job now"; `slice` avoids that clash, but consider whether the generator form wants `yield*`-friendly helpers (`yield* slice.until(ms)`).

## 10. Suggested implementation order (upstream)
1. `WorkOptions`, allocator, `fps` interaction, function form, `stats`, no estimator (fixed `costHintMs`). Tests with injected costs.
2. `report(ticket, ms)`, estimator, lag compensation, `pendingMs`, spike safety net.
3. Observation gate and freeze/reset semantics.
4. `registerGenerator` sugar and React `useFrame` option pass-through.
5. Our side: `CloudJob` descriptors in the runtime (default driver reproduces today's constants), then `scheduleClouds` in `@clouds/three` behind a flag, compared against the default driver with the capture harness (same frames, same spike statistics).
