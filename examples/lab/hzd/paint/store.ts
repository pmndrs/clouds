// The painter's UI state (zustand): what the controls show and what a stroke reads (tool, brush, ticked channels, their values, the view).
// The map itself (five Float32 layers), the stroke in progress and the undo patches are the engine's (engine.ts), not React state.
import { createStore, useStore } from 'zustand';
import { CHANNELS, type Channel } from './fields';
import type { NdfMapEntry } from './plugin';
import { UI_STORE, type Tool } from './constants';

export interface PaintState {
  open: boolean;
  width: number;
  tool: Tool;
  sizeMeters: number;
  strength: number;
  hardness: number;
  noiseCells: number;
  noiseSeed: number;
  ticked: Record<Channel, boolean>;
  targets: Record<Channel, number>;
  viewChannel: Channel;
  display: 'composite' | 'channel';
  contour: boolean;
  overlays: boolean;
  follow: boolean;
  liveMode: 'live' | 'release';
  zoom: number;
  pan: [number, number];
  // Mirrors of the engine's state, for the controls.
  n: number;
  sourceLabel: string;
  edited: boolean;
  owned: boolean;
  busy: string;
  note: string;
  status: string;
  canUndo: boolean;
  canRedo: boolean;
  undoBytes: number;
  topDown: boolean;
  maps: { examples: NdfMapEntry[]; painted: NdfMapEntry[] };
  autosaveTime: number;
  name: string;
  source: string;
}

const ui = (() => { try { return JSON.parse(localStorage.getItem(UI_STORE) ?? '{}') as Record<string, unknown>; } catch { return {}; } })();

export const paint = createStore<PaintState>(() => ({
  open: false,
  width: typeof ui.width === 'number' ? ui.width : Math.min(460, Math.round(innerWidth * 0.36)),
  tool: 'paint',
  sizeMeters: 1500,
  strength: 0.35,
  hardness: 0.2,
  noiseCells: 12,
  noiseSeed: 7,
  ticked: Object.fromEntries(CHANNELS.map(c => [c, c === 'coverage'])) as Record<Channel, boolean>,
  targets: { coverage: 0.55, topType: 1, bottomType: 0, minHeight: 0, maxHeight: 0.6 },
  viewChannel: 'coverage',
  display: ui.display === 'channel' ? 'channel' : 'composite',
  contour: ui.contour !== false,
  overlays: ui.overlays !== false,
  follow: ui.follow === true,
  liveMode: ui.liveMode === 'release' ? 'release' : 'live',
  zoom: 1,
  pan: [0, 0],
  n: 0,
  sourceLabel: '',
  edited: false,
  owned: false,
  busy: '',
  note: '',
  status: ' ',
  canUndo: false,
  canRedo: false,
  undoBytes: 0,
  topDown: false,
  maps: { examples: [], painted: [] },
  autosaveTime: 0,
  name: typeof ui.name === 'string' ? ui.name : '',
  source: 'sky',
}));

export function usePaint<T>(selector: (s: PaintState) => T): T {
  return useStore(paint, selector);
}

/** The view options, the dock's width and the save name persist in this browser (the vanilla painter's key). */
export function saveUi(): void {
  const s = paint.getState();
  try { localStorage.setItem(UI_STORE, JSON.stringify({ width: s.width, liveMode: s.liveMode, display: s.display, contour: s.contour, overlays: s.overlays, follow: s.follow, name: s.name.trim() })); } catch { /* storage off */ }
}
