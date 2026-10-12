// The bench's state: one zustand store, readable from React (hooks) and from the frame jobs and the harness (getState). The camera view is a
// mutable object the rig writes every frame; React never re-renders per frame. Controls that show the view re-render on `viewTick`, bumped
// when something other than the rig changes it, and by a 2 Hz check while the camera moves (as the vanilla bench's 500 ms sync).
import { createStore, useStore } from 'zustand';
import type { WebGPURenderer } from 'three/webgpu';
import type { ViewState } from '../../compare/shared';
import type { OursPane } from '../../compare/panes/ours';
import type { Rig } from '../../compare/rig';
import type { Clouds } from '@clouds/three';
import type { ProceduralClouds } from '../../../../packages/runtime/src/procedural';
import { HZD_REF_BY_ID } from '../../hzd/refs';
import type { createHzdTuner } from '../../hzd/tune';
import type { createPainter } from '../../hzd/paint/editor';
import { readStart, writeQuery, type RefState, type Sources } from './url';
import { REF_MODES, VIEWS, applyBookmark, applyRefView, type RefMode } from './views';

export type Tuner = ReturnType<typeof createHzdTuner>;
export type Painter = ReturnType<typeof createPainter>;

/** The sky's objects, once the pane has started on the Canvas's renderer. */
export interface BenchRuntime {
  pane: OursPane;
  clouds: Clouds;
  proc: ProceduralClouds;
  core: Clouds['core'];
  sources: Sources;
  renderer: WebGPURenderer;
  tuner: Tuner;
}

export interface BenchState {
  view: ViewState;
  viewName: string;
  quality: string;
  clean: boolean;
  ref: RefState;
  flip: boolean;
  uiHidden: boolean;
  helpOpen: boolean;
  rt: BenchRuntime | null;
  rig: Rig | null;
  painter: Painter | null;
  /** The painter dock's width on the left (0 when closed). */
  painterInset: number;
  error: string;
  viewTick: number;
  settingsTick: number;
  hud: string;
}

/** The query the page opened with: the sky's settings are read from it once the pane has started (the URL is rewritten as the state changes). */
export const START_QUERY = new URLSearchParams(location.search);
const START = readStart(START_QUERY);

export const bench = createStore<BenchState>(() => ({
  view: START.view,
  viewName: START.viewName,
  quality: START.quality,
  clean: START.clean,
  ref: START.ref,
  flip: false,
  uiHidden: START.clean,
  helpOpen: false,
  rt: null,
  rig: null,
  painter: null,
  painterInset: 0,
  error: '',
  viewTick: 0,
  settingsTick: 0,
  hud: 'starting the HZD sky...',
}));

export function useBench<T>(selector: (s: BenchState) => T): T {
  return useStore(bench, selector);
}

const get = bench.getState, set = bench.setState;

// --- The URL follows the state (debounced 250 ms, as the vanilla bench) ---
let urlTimer = 0;
export function scheduleUrl(): void {
  if (!get().rt) return;   // until the sky is up, the URL still holds the settings the pane has yet to read
  clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => {
    const s = get();
    const q = writeQuery({ viewName: s.viewName, view: s.view, ref: s.ref, quality: s.quality, clean: s.clean, changes: s.rt?.tuner.changes() ?? {} });
    history.replaceState(null, '', `?${q}`);
  }, 250);
}

/** The view changed outside the rig: controls re-read it, the URL follows. */
export function viewChanged(): void {
  set(s => ({ viewTick: s.viewTick + 1 }));
  scheduleUrl();
}

/** A setting changed (tuner, painter, a sidebar control): the temporal history restarts, controls re-read, the URL follows. */
export function settingsChanged(opts: { refreshTuner?: boolean } = {}): void {
  const rt = get().rt;
  if (opts.refreshTuner) rt?.tuner.refresh();
  rt?.core.resetTemporal();
  set(s => ({ settingsTick: s.settingsTick + 1 }));
  scheduleUrl();
}

export function goToView(name: string): void {
  applyBookmark(get().view, name);
  set({ viewName: name });
  viewChanged();
}

/** "back to the view": the view's own camera, keeping the sun. */
export function backToView(): void {
  const v = get().view, sun = { sunEl: v.sunEl, sunAz: v.sunAz };
  applyBookmark(v, get().viewName);
  Object.assign(v, sun);
  viewChanged();
}

// --- The reference ---
export function setRefState(patch: Partial<RefState>): void {
  set(s => ({ ref: { ...s.ref, ...patch } }));
  scheduleUrl();
}

export function setRef(id: string, pickedByHand: boolean): void {
  const s = get();
  const ref = HZD_REF_BY_ID.get(id);
  const next: RefState = { ...s.ref, id: ref ? id : '' };
  if (ref && next.mode === 'off') next.mode = 'side';
  set({ ref: next });
  if (pickedByHand && ref?.view && s.ref.follows) { applyRefView(s.view, ref.view); viewChanged(); }
  scheduleUrl();
}

export function stepRef(d: number, ids: string[]): void {
  const i = ids.indexOf(get().ref.id);
  setRef(ids[(i + d + ids.length) % ids.length], true);
}

export function cycleRefMode(): void {
  const m = get().ref.mode;
  setRefState({ mode: REF_MODES[(REF_MODES.indexOf(m) + 1) % REF_MODES.length] });
}

export function applyRefViewNow(): void {
  const r = HZD_REF_BY_ID.get(get().ref.id);
  if (r?.view) { applyRefView(get().view, r.view); viewChanged(); }
}

export function setUiHidden(hidden: boolean): void {
  set(s => ({ uiHidden: hidden, helpOpen: hidden ? false : s.helpOpen }));
}

/** Captures: "<view>" or "ref:<id>", with @ variants: @sun:el:az @cov:c @exp:e @ref:<id> @mode:off|side|pip. */
export function bookmark(spec: string): void {
  const [head, ...variants] = spec.split('@');
  const view = get().view;
  if (head.startsWith('ref:')) { if (get().ref.mode === 'off') setRefState({ mode: 'side' }); setRef(head.slice(4), true); }
  else { if (!VIEWS[head]) throw new Error(`unknown view: ${head}`); applyBookmark(view, head); set({ viewName: head }); }
  for (const v of variants) {
    const [k, ...a] = v.split(':');
    if (k === 'sun') { view.sunEl = Number(a[0]); if (a[1] !== undefined) view.sunAz = Number(a[1]); }
    else if (k === 'cov') view.coverage = Number(a[0]);
    else if (k === 'exp') view.exposure = Number(a[0]);
    else if (k === 'ref') setRef(a[0], false);
    else if (k === 'mode' && (REF_MODES as readonly string[]).includes(a[0])) setRefState({ mode: a[0] as RefMode });
  }
  get().rt?.core.resetTemporal();
  viewChanged();
}
