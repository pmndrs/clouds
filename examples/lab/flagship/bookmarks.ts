import type { Vector3Tuple } from 'three';

/**
 * PLACEHOLDER cloud volume, in metres, y up, ground at y = 0. P1 swaps this for the real cloud bounds
 * (the NVDF volume placement); bookmarks below derive everything from it.
 */
export const CLOUD_REGION = { size: [4096, 512, 4096] as Vector3Tuple, center: [0, 1750, 0] as Vector3Tuple };
export const CLOUD_BOX = { min: [-400, 1500, -400] as Vector3Tuple, max: [400, 2000, 400] as Vector3Tuple };

export const BOOKMARK_NAMES = ['ground', 'edge', 'inside', 'above', 'backlit'] as const;
export type BookmarkName = (typeof BOOKMARK_NAMES)[number];

export interface Bookmark { position: Vector3Tuple; target: Vector3Tuple; timeOfDay: number }

const center = (): Vector3Tuple => CLOUD_BOX.min.map((v, i) => (v + CLOUD_BOX.max[i]) / 2) as Vector3Tuple;
const halfWidth = () => (CLOUD_BOX.max[0] - CLOUD_BOX.min[0]) / 2;
const base = () => CLOUD_BOX.min[1];
const top = () => CLOUD_BOX.max[1];

export function isBookmarkName(name: string): name is BookmarkName { return (BOOKMARK_NAMES as readonly string[]).includes(name); }

/** Time of day for a bookmark, needed first so the caller can read the sun and pass `sunHorizontal` to `resolveBookmark`. */
export function bookmarkTime(name: BookmarkName): number { return name === 'backlit' ? 17.6 : 14; }

/** `sunHorizontal` = unit (x, z) direction towards the sun; only `backlit` uses it (camera on the far side of the cloud from the sun). */
export function resolveBookmark(name: BookmarkName, sunHorizontal: [number, number] = [0, 1]): Bookmark {
  const c = center(), hw = halfWidth(), timeOfDay = bookmarkTime(name);
  switch (name) {
    case 'ground': return { position: [0, 2, c[2] - 6.5 * hw], target: [c[0], 1100, c[2]], timeOfDay };
    case 'edge': return { position: [0, base() + 150, c[2] - hw - 250], target: [0, c[1], c[2] - hw + 100], timeOfDay };
    case 'inside': return { position: [c[0], c[1], c[2]], target: [c[0] + 300, c[1] + 20, c[2] + 300], timeOfDay };
    case 'above': return { position: [0, top() + 1000, c[2] - 10 * hw], target: c, timeOfDay };
    case 'backlit': return { position: [c[0] - sunHorizontal[0] * 7 * hw, 50, c[2] - sunHorizontal[1] * 7 * hw], target: [c[0], 900, c[2]], timeOfDay };
  }
}
