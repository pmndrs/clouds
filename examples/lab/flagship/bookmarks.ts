import type { Vector3Tuple } from 'three';
import type { CloudVolumeAsset } from '@clouds/runtime';

/** World placement: the volume is centred at x = z = 0 with its base this high above the ground (y = 0). */
export const CLOUD_BASE_HEIGHT = 500;

/** Axis-aligned bounds of the loaded cloud in world metres (y up). Set by `placeCloud`. */
export const CLOUD_BOX = { min: [-432, 500, -432] as Vector3Tuple, max: [432, 908, 432] as Vector3Tuple };
/** A point deep inside the cloud (profile > 0.5), set by `placeCloud`. */
/** Tight bounds of the occupied voxels (profile > 0), used to frame the bookmarks; the volume box has margins around it. */
export const FOCUS_BOX = { min: [-432, 500, -432] as Vector3Tuple, max: [432, 908, 432] as Vector3Tuple };
export const INSIDE_POINT: Vector3Tuple = [0, 700, 0];

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
/** Half the largest extent of the occupied core: the framing distances scale with it so every cloud fills about the same share of the frame. */
const radius = () => Math.max(...FOCUS_BOX.max.map((v, i) => (v - FOCUS_BOX.min[i]) / 2));
const top = () => FOCUS_BOX.max[1];

export function isBookmarkName(name: string): name is BookmarkName { return (BOOKMARK_NAMES as readonly string[]).includes(name); }

/** Time of day for a bookmark, needed first so the caller can read the sun and pass it to `resolveBookmark`. */
export function bookmarkTime(name: BookmarkName): number { return name === 'backlit' ? 17.6 : 14; }

/** Unit vector toward the sun from compass azimuth and elevation (degrees); north = -Z so east = +X. */
export function sunVector(azimuthDeg: number, elevationDeg: number): Vector3Tuple {
  const az = (azimuthDeg * Math.PI) / 180, el = (elevationDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

/** Rotate the horizontal unit vector (x, z) by `deg` about +Y (positive = towards +X from +Z). */
function rotate(h: [number, number], deg: number): [number, number] {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [h[0] * c + h[1] * s, -h[0] * s + h[1] * c];
}

/**
 * `sun` = unit vector toward the sun. The camera sits on a ring around the cloud at a horizontal angle from the sun azimuth:
 * `ground` and `above` are mostly front-lit (sun behind or beside the camera), `edge` is side-lit, `backlit` looks at the cloud
 * with the sun 15 degrees above the view direction, behind it.
 */
export function resolveBookmark(name: BookmarkName, sun: Vector3Tuple = [0, 0.7, 0.7]): Bookmark {
  const c = center(), r = radius(), timeOfDay = bookmarkTime(name);
  const hl = Math.hypot(sun[0], sun[2]) || 1;
  const sunH: [number, number] = [sun[0] / hl, sun[2] / hl];
  const ring = (deg: number, dist: number, y: number): Vector3Tuple => {
    const d = rotate(sunH, deg);
    return [c[0] + d[0] * dist, y, c[2] + d[1] * dist];
  };
  switch (name) {
    case 'ground': return { position: ring(35, 1.45 * r, 2), target: c, timeOfDay };
    case 'edge': return { position: ring(95, 2.1 * r, c[1] - 0.1 * r), target: c, timeOfDay };
    case 'inside': return { position: [...INSIDE_POINT], target: [INSIDE_POINT[0] + 300, INSIDE_POINT[1] + 20, INSIDE_POINT[2] + 300], timeOfDay };
    case 'above': return { position: ring(55, 1.5 * r, top() + 1.0 * r), target: c, timeOfDay };
    case 'backlit': {
      // View direction = the sun's azimuth, 15 degrees below the sun's elevation; the camera is behind the cloud's centre along it.
      const elev = Math.asin(sun[1]) - (15 * Math.PI) / 180;
      const dist = 2.6 * r;
      // camera = target - viewDir * dist, with viewDir = (sunH * cos(elev), sin(elev)) pointing towards the sun.
      const v: Vector3Tuple = [-sunH[0] * Math.cos(elev), -Math.sin(elev), -sunH[1] * Math.cos(elev)];
      return { position: [c[0] + v[0] * dist, Math.max(20, c[1] + v[1] * dist), c[2] + v[2] * dist], target: c, timeOfDay };
    }
  }
}
