// The bench's views, motions and qualities (as the vanilla bench had them), and the view helpers both the UI and the URL use.
import { BOOKMARKS, type Bookmark, type ViewState } from '../../compare/shared';
import type { RefView } from '../refs';

/** The views: the compare bookmarks plus the two framings the H-reports used. */
export const VIEWS: Record<string, Bookmark & { about: string }> = {
  ground: { ...BOOKMARKS.ground, position: [0, 250, 0], about: 'from 250 m above the ground, looking north (sun 40° in the south-east), so the cloud shadows on the ground show; the altitude slider takes it back to 2 m' },
  gp7: { ...BOOKMARKS.ground, pitch: 25, about: 'GPU Pro 7 Fig 4.13-4.16 framing: the ground view tilted up 25° (the H-reports\' gp7 captures)' },
  horizon: { ...BOOKMARKS.horizon, about: 'from 40 m, nearly level: the horizon rows and the ring' },
  sunset: { ...BOOKMARKS.sunset, about: 'into a sun 4° high' },
  dusk: { ...BOOKMARKS.dusk, about: 'a 3° sun from the side (west), looking north' },
  afterglow: { ...BOOKMARKS.afterglow, about: 'the sun 1° below the horizon: clouds above about 0.5 km still lit from below' },
  above: { ...BOOKMARKS.above, about: 'from 3 km, inside the 1.5-5 km layer, looking slightly down' },
  storm: { ...BOOKMARKS.ground, lookAz: 337, pitch: 14, sunAz: 290, sunEl: 35, about: 'STORM1: from the ground toward the storm area (4.5 km west, 10.5 km north) with the sun to the side; add storm=1 for the storm settings and fov=70 for F1\'s framing' },
  high: { ...BOOKMARKS.ground, position: [0, 4300, 0], pitch: -6, about: 'from 4.3 km, near the tops, pitch -6° (the H-reports\' high captures)' },
};
/** STORM1: the storm preset (URL storm=1): the storm on from the map's storm area, hag's anvil terms, the anvil cirrus and the storm lighting. Explicit hz_ keys win. */
export const STORM_PRESET: Record<string, unknown> = {
  stormStrength: 1, stormSource: 'map', anvilFlatten: 1, anvilDensityFix: 0.5, anvilCirrus: 0.0016, stormDensity: 1.6, stormDark: 0.7,
};
export const VIEW_NAMES = Object.keys(VIEWS);
export const MOTIONS: [string, number][] = [['frozen', 0], ['slow', 0.25], ['normal', 1], ['fast', 4], ['time-lapse', 20]];
export const QUALITIES = ['mobile', 'low', 'medium', 'high', 'ultra'] as const;
export const REF_MODES = ['off', 'side', 'pip'] as const;
export type RefMode = (typeof REF_MODES)[number];
export const PIP: Record<string, number> = { s: 0.25, m: 0.36, l: 0.5 };
/** The sidebar's width, which side-by-side leaves out of the split (as the vanilla bench). */
export const SIDEBAR = 266;

/** Sets the view's camera and sun from a named view (coverage, exposure and fov stay). */
export function applyBookmark(view: ViewState, name: string): void {
  const b = VIEWS[name];
  if (!b) throw new Error(`unknown view: ${name}`);
  view.position = [...b.position]; view.lookAz = b.lookAz; view.pitch = b.pitch; view.sunEl = b.sunEl; view.sunAz = b.sunAz;
}

/** A reference's approximate starting view: its bookmark, then its overrides. */
export function applyRefView(view: ViewState, v: RefView): void {
  applyBookmark(view, v.from);
  if (v.sunEl !== undefined) view.sunEl = v.sunEl;
  if (v.sunAz !== undefined) view.sunAz = v.sunAz;
  if (v.lookAz !== undefined) view.lookAz = v.lookAz;
  if (v.pitch !== undefined) view.pitch = v.pitch;
  if (v.posy !== undefined) view.position[1] = v.posy;
  if (v.coverage !== undefined) view.coverage = v.coverage;
  if (v.fov !== undefined) view.fov = v.fov;
}

/** Time of day -> sun, from a simple solar model (latitude 30° N, late spring: declination +15°). */
export function solar(h: number): { el: number; az: number } {
  const rad = Math.PI / 180, lat = 30 * rad, dec = 15 * rad, H = (h - 12) * 15 * rad;
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
  const A = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat));
  return { el: el / rad, az: (A / rad + 180 + 360) % 360 };
}
