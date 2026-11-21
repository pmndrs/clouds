// The bench's URL: what a link opens (view, reference, quality, clean) and what the page writes back, with the settings under the compare
// page's prefixes. The same keys and rules as the vanilla bench had, so old links open the same sky. Pure: tested in url.test.ts.
import { DEFAULT_COVERAGE, type ViewState } from '../../compare/shared';
import { HZD_REF_BY_ID } from '../refs';
import { PREFIX, type SourceId } from '../tune';
import { isProceduralStyle, type ProceduralStyle } from '../../../../packages/runtime/src/procedural/styles';
import { LAYOUT_PRESETS, QUALITIES, REF_MODES, STORM_PRESET, VIEWS, VIEW_NAMES, applyBookmark, applyRefView, type RefMode } from './views';

export interface RefState { id: string; mode: RefMode; pip: 's' | 'm' | 'l'; corner: 'bl' | 'br'; page: boolean; follows: boolean }
export type Sources = Record<SourceId, Record<string, unknown>>;

export interface StartState { quality: string; clean: boolean; viewName: string; view: ViewState; ref: RefState; style: ProceduralStyle }

const SETTING_PREFIXES = Object.entries(PREFIX) as [SourceId, string][];
/** Settings the bench reads from the URL itself (not passed to the pane), so their starting values are the code defaults. */
export const isSettingKey = (k: string) => SETTING_PREFIXES.some(([, p]) => k.startsWith(p)) || k === 'cirrus' || k === 'phase' || k === 'vlight' || k === 'level';

/** The pane's own query: everything but the settings, with the quality. */
export function paneQuery(query: URLSearchParams, quality: string): URLSearchParams {
  const q = new URLSearchParams([...query].filter(([k]) => !isSettingKey(k)));
  q.set('quality', quality);
  return q;
}

export function readStart(query: URLSearchParams): StartState {
  const quality = (QUALITIES as readonly string[]).includes(query.get('quality') ?? '') ? query.get('quality')! : 'ultra';
  const view: ViewState = { position: [0, 2, 0], lookAz: 0, pitch: 7, fov: 50, sunAz: 150, sunEl: 40, coverage: DEFAULT_COVERAGE, exposure: 1 };
  const viewName = VIEW_NAMES.includes(query.get('view') ?? '') ? query.get('view')! : VIEW_NAMES.includes(query.get('bookmark') ?? '') ? query.get('bookmark')! : 'ground';
  applyBookmark(view, viewName);
  // A link with a reference and no view (the lab index's chips) opens at the reference's starting view.
  const r = HZD_REF_BY_ID.get(query.get('ref') ?? '');
  if (r?.view && !query.has('view') && !query.has('bookmark') && query.get('refview') !== '0') applyRefView(view, r.view);
  const num = (k: string, d: number) => (query.has(k) && query.get(k) !== '' && Number.isFinite(Number(query.get(k))) ? Number(query.get(k)) : d);
  view.sunEl = num('sunel', view.sunEl); view.sunAz = num('sunaz', view.sunAz); view.lookAz = num('lookaz', view.lookAz); view.pitch = num('pitch', view.pitch);
  view.fov = num('fov', view.fov); view.coverage = num('coverage', view.coverage); view.exposure = num('exposure', view.exposure);
  view.position[1] = num('posy', view.position[1]);
  const p = (query.get('pos') ?? '').split(',').map(Number);
  if (p.length === 3 && p.every(Number.isFinite)) view.position = [p[0], p[1], p[2]];
  const ref: RefState = {
    id: HZD_REF_BY_ID.has(query.get('ref') ?? '') ? query.get('ref')! : '',
    mode: (REF_MODES as readonly string[]).includes(query.get('refmode') ?? '') ? (query.get('refmode') as RefMode) : 'off',
    pip: (['s', 'm', 'l'] as const).find(s => s === query.get('pip')) ?? 'm',
    corner: query.get('corner') === 'br' ? 'br' : 'bl',
    page: query.get('refpage') === '1',
    follows: query.get('refview') !== '0',
  };
  // S1: the look (procedural/styles.ts); unknown names open the default.
  const style = isProceduralStyle(query.get('style')) ? (query.get('style') as ProceduralStyle) : 'horizon';
  return { quality, clean: query.get('clean') === '1', viewName, view, ref, style };
}

export function parseLike(old: unknown, raw: string): unknown {
  if (typeof old === 'number') return Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  if (typeof old === 'boolean') return raw === '1' || raw === 'true';
  if (typeof old === 'string') return raw;
  if (Array.isArray(old)) { const a = raw.split(',').map(Number); return a.length === old.length && a.every(Number.isFinite) ? a : undefined; }
  return undefined;
}

/** The URL's setting overrides, onto the live settings (after the tuner has taken its starting values). */
export function applySettingOverrides(query: URLSearchParams, sources: Sources): void {
  // STORM1: storm=1 sets the storm preset first, so explicit hz_ keys in the same link still win.
  if (query.get('storm') === '1') for (const [k, v] of Object.entries(STORM_PRESET)) if (k in sources.hzd) sources.hzd[k] = v;
  // P2.3a: layout=<name> sets a sky-layout preset (several ndf. and hzd. keys) first, so explicit keys in the same link still win.
  const layout = LAYOUT_PRESETS[query.get('layout') ?? ''];
  if (layout) for (const [sk, v] of Object.entries(layout)) { const i = sk.indexOf('.'); const s = sk.slice(0, i) as SourceId, k = sk.slice(i + 1); if (k in sources[s]) sources[s][k] = v; }
  for (const [k, raw] of query) {
    if (k === 'cirrus') { sources.cirrus.enabled = raw === '1'; continue; }
    if (k === 'phase') { sources.c.phaseModel = raw; continue; }
    // U2: ?level=cinematic|desktop|laptop, the render level (captures); the page writes it back as c_renderLevel.
    if (k === 'level') { if (raw === 'cinematic' || raw === 'desktop' || raw === 'laptop') sources.c.renderLevel = raw; continue; }
    for (const [s, p] of SETTING_PREFIXES) {
      if (!k.startsWith(p)) continue;
      const key = k.slice(p.length);
      if (!(key in sources[s])) continue;
      const v = parseLike(sources[s][key], raw);
      if (v !== undefined) sources[s][key] = v;
    }
  }
  // Motion: the renderer's animSpeed (?motion=0 freezes the clouds, as the H-report captures did with c_animSpeed=0).
  if (query.has('motion') && Number.isFinite(Number(query.get('motion')))) sources.c.animSpeed = Number(query.get('motion'));
}

export interface UrlSnapshot { viewName: string; view: ViewState; ref: RefState; quality: string; clean: boolean; changes: Record<string, unknown>; style?: ProceduralStyle }

/** What the page writes: the view and only what differs from it, the reference, the quality, and every changed setting. */
export function writeQuery(s: UrlSnapshot): URLSearchParams {
  const q = new URLSearchParams();
  const b = VIEWS[s.viewName], view = s.view, ref = s.ref;
  const r = (v: number, k = 10) => String(Math.round(v * k) / k);
  q.set('view', s.viewName);
  if (view.sunEl !== b.sunEl) q.set('sunel', r(view.sunEl));
  if (view.sunAz !== b.sunAz) q.set('sunaz', r(view.sunAz));
  if (view.lookAz !== b.lookAz) q.set('lookaz', r(view.lookAz));
  if (view.pitch !== b.pitch) q.set('pitch', r(view.pitch));
  if (view.position.some((v, i) => Math.abs(v - b.position[i]) > 0.05)) q.set('pos', view.position.map(v => r(v)).join(','));
  if (view.fov !== 50) q.set('fov', r(view.fov));
  if (view.coverage !== DEFAULT_COVERAGE) q.set('coverage', r(view.coverage, 100));
  if (view.exposure !== 1) q.set('exposure', r(view.exposure, 100));
  if (ref.id) q.set('ref', ref.id);
  if (ref.id && ref.mode !== 'off') q.set('refmode', ref.mode);
  if (ref.mode === 'pip' && ref.pip !== 'm') q.set('pip', ref.pip);
  if (ref.mode === 'pip' && ref.corner !== 'bl') q.set('corner', ref.corner);
  if (ref.page) q.set('refpage', '1');
  if (!ref.follows) q.set('refview', '0');
  if (s.quality !== 'ultra') q.set('quality', s.quality);
  if (s.clean) q.set('clean', '1');
  if (s.style && s.style !== 'horizon') q.set('style', s.style);
  for (const [k, v] of Object.entries(s.changes)) {
    const [src, key] = [k.slice(0, k.indexOf('.')) as SourceId, k.slice(k.indexOf('.') + 1)];
    // Six significant digits: Tweakpane's step snapping leaves 0.19999999999999998 for 0.2 (the vanilla bench wrote that into its links).
    const n = (x: unknown) => (typeof x === 'number' ? String(Number(x.toPrecision(6))) : String(x));
    q.set(PREFIX[src] + key, Array.isArray(v) ? v.map(n).join(',') : typeof v === 'boolean' ? (v ? '1' : '0') : n(v));
  }
  return q;
}
