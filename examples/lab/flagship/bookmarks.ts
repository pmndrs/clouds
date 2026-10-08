import type { Vector3Tuple } from 'three';
import type { CloudVolumeAsset } from '@clouds/runtime';

/** World placement: the volume is centred at x = z = 0 with its base this high above the ground (y = 0). */
export const CLOUD_BASE_HEIGHT = 1500;

/** Axis-aligned bounds of the loaded cloud in world metres (y up). Set by `placeCloud`. */
export const CLOUD_BOX = { min: [-432, 1500, -432] as Vector3Tuple, max: [432, 1908, 432] as Vector3Tuple };
/** A point deep inside the cloud (profile > 0.5), set by `placeCloud`. */
/** Tight bounds of the occupied voxels (profile > 0), used to frame the bookmarks; the volume box has margins around it. */
export const FOCUS_BOX = { min: [-432, 1500, -432] as Vector3Tuple, max: [432, 1908, 432] as Vector3Tuple };
export const INSIDE_POINT: Vector3Tuple = [0, 1700, 0];

export const BOOKMARK_NAMES = ['ground', 'edge', 'inside', 'above', 'backlit'] as const;
export type BookmarkName = (typeof BOOKMARK_NAMES)[number];

export interface Bookmark { position: Vector3Tuple; target: Vector3Tuple; timeOfDay: number }

/** World min corner for an asset: centred on x = z = 0, base at CLOUD_BASE_HEIGHT. Updates CLOUD_BOX and INSIDE_POINT. */
export function placeCloud(asset: CloudVolumeAsset): Vector3Tuple {
  const [w, h, d] = asset.dims, v = asset.voxelSizeMeters;
  const min: Vector3Tuple = [-(w * v) / 2, CLOUD_BASE_HEIGHT, -(h * v) / 2];
  const max: Vector3Tuple = [min[0] + w * v, min[1] + d * v, min[2] + h * v];
  CLOUD_BOX.min = min; CLOUD_BOX.max = max;
  const lo = [w, h, d], hi = [-1, -1, -1];
  for (let i = 0; i < w * h * d; i++) {
    if (asset.nvdf[i * 4] === 0) continue;
    const c = [i % w, Math.floor(i / w) % h, Math.floor(i / (w * h))];
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], c[a]); hi[a] = Math.max(hi[a], c[a] + 1); }
  }
  // texture (x, row, slice) -> world (x, z, y)
  FOCUS_BOX.min = [min[0] + lo[0] * v, min[1] + lo[2] * v, min[2] + lo[1] * v];
  FOCUS_BOX.max = [min[0] + hi[0] * v, min[1] + hi[2] * v, min[2] + hi[1] * v];
  // Pick the voxel with profile > 0.5 and a deep SDF that is closest to the box centre.
  const cx = w / 2, cy = h / 2, cz = d / 2;
  let best = -1, bestScore = Infinity;
  for (let i = 0; i < w * h * d; i++) {
    if (asset.nvdf[i * 4] <= 128 || asset.sdfMeters[i] > -40) continue;
    const x = i % w, y = Math.floor(i / w) % h, z = Math.floor(i / (w * h));
    const score = (x - cx) ** 2 + (y - cy) ** 2 + (1.5 * (z - cz)) ** 2;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  if (best < 0) for (let i = 0; i < w * h * d && best < 0; i++) if (asset.nvdf[i * 4] > 128) best = i;
  const x = best % w, y = Math.floor(best / w) % h, z = Math.floor(best / (w * h));
  // texture (x, row, slice) -> world (x, z, y)
  INSIDE_POINT[0] = min[0] + (x + 0.5) * v; INSIDE_POINT[1] = min[1] + (z + 0.5) * v; INSIDE_POINT[2] = min[2] + (y + 0.5) * v;
  return min;
}

const center = (): Vector3Tuple => FOCUS_BOX.min.map((v, i) => (v + FOCUS_BOX.max[i]) / 2) as Vector3Tuple;
const halfWidth = () => Math.max(FOCUS_BOX.max[0] - FOCUS_BOX.min[0], FOCUS_BOX.max[2] - FOCUS_BOX.min[2]) / 2;
const base = () => FOCUS_BOX.min[1];
const top = () => FOCUS_BOX.max[1];

export function isBookmarkName(name: string): name is BookmarkName { return (BOOKMARK_NAMES as readonly string[]).includes(name); }

/** Time of day for a bookmark, needed first so the caller can read the sun and pass `sunHorizontal` to `resolveBookmark`. */
export function bookmarkTime(name: BookmarkName): number { return name === 'backlit' ? 17.6 : 14; }

/** `sunHorizontal` = unit (x, z) direction towards the sun; only `backlit` uses it (camera on the far side of the cloud from the sun). */
export function resolveBookmark(name: BookmarkName, sunHorizontal: [number, number] = [0, 1]): Bookmark {
  const c = center(), hw = halfWidth(), timeOfDay = bookmarkTime(name);
  switch (name) {
    case 'ground': return { position: [c[0], 2, c[2] - 3.4 * hw], target: c, timeOfDay };
    case 'edge': return { position: [c[0], c[1] - 0.2 * hw, c[2] - 2.4 * hw], target: c, timeOfDay };
    case 'inside': return { position: [...INSIDE_POINT], target: [INSIDE_POINT[0] + 300, INSIDE_POINT[1] + 20, INSIDE_POINT[2] + 300], timeOfDay };
    case 'above': return { position: [c[0], top() + 1.2 * hw, c[2] - 2.6 * hw], target: c, timeOfDay };
    case 'backlit': return { position: [c[0] - sunHorizontal[0] * 3.4 * hw, 50, c[2] - sunHorizontal[1] * 3.4 * hw], target: c, timeOfDay };
  }
}
