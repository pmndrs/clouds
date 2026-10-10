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

export const BOOKMARK_NAMES = ['ground', 'edge', 'inside', 'above', 'backlit', 'shadow', 'frontlit', 'side', 'horizon', 'up30', 'photo', 'detail'] as const;
export type BookmarkName = (typeof BOOKMARK_NAMES)[number];

/** Horizontal field of view in degrees for the calibration framings (48 = 40 mm on full frame, 20 = 105 mm); other bookmarks keep the default lens. */
export const BOOKMARK_HFOV: Partial<Record<BookmarkName, number>> = { photo: 48, detail: 20 };

export interface Bookmark { position: Vector3Tuple; target: Vector3Tuple; timeOfDay: number }

/** World min corner for an asset: centred on x = z = 0, base at CLOUD_BASE_HEIGHT. Updates CLOUD_BOX and INSIDE_POINT. */
export function placeCloud(asset: CloudVolumeAsset, baseHeight: number = CLOUD_BASE_HEIGHT): Vector3Tuple {
  const [w, h, d] = asset.dims, v = asset.voxelSizeMeters;
  const min: Vector3Tuple = [-(w * v) / 2, baseHeight, -(h * v) / 2];
  const max: Vector3Tuple = [min[0] + w * v, min[1] + d * v, min[2] + h * v];
  CLOUD_BOX.min = min; CLOUD_BOX.max = max;
  const lo = [w, h, d], hi = [-1, -1, -1];
  // V2: a direct asset's R is its raw density (non-zero far into the thin fringe); its A holds the framing mask (the fog asset's occupancy).
  const occ = asset.direct ? 3 : 0;
  for (let i = 0; i < w * h * d; i++) {
    if (asset.nvdf[i * 4 + occ] === 0) continue;
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
/** Time of day that puts the sun about 30 degrees above the horizon (lat 40). */
export const FRONTLIT_TIME = 16.5;

export function bookmarkTime(name: BookmarkName): number { return name === 'backlit' ? 17.6 : name === 'frontlit' ? FRONTLIT_TIME : 14; }

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
    // C1 calibration framings at fixed distances (not scaled by the cloud): side-on at 4 km, horizon view at 10 km.
    case 'side': return { position: ring(95, 4000, c[1]), target: c, timeOfDay };
    // 30 degrees of elevation from the ground to the cloud centre (distance follows the cloud altitude).
    case 'up30': return { position: ring(35, Math.max(100, (c[1] - 2) / Math.tan(Math.PI / 6)), 2), target: c, timeOfDay };
    // C1 photo / detail: camera on the ground, sun 70 degrees to the left of the view and a little ahead (side/back-lit from upper left, like the owner's photos).
    // photo: cloud silhouette fills ~50% of the frame (the 0.62 corrects the bounding box being wider than the silhouette); detail: frame spans ~60% of the cloud width, aimed at the sunlit upper third.
    case 'photo': case 'detail': {
      const hfov = (BOOKMARK_HFOV[name]! * Math.PI) / 180, a = (20 * Math.PI) / 180;
      const v90: [number, number] = [-sunH[1], sunH[0]];
      const vx = Math.cos(a) * v90[0] + Math.sin(a) * sunH[0], vz = Math.cos(a) * v90[1] + Math.sin(a) * sunH[1];
      const vl = Math.hypot(vx, vz), v: [number, number] = [vx / vl, vz / vl];
      const px = -v[1], pz = v[0]; // screen-right (horizontal)
      let lo = Infinity, hi = -Infinity;
      for (const x of [FOCUS_BOX.min[0], FOCUS_BOX.max[0]]) for (const z of [FOCUS_BOX.min[2], FOCUS_BOX.max[2]]) { const t = x * px + z * pz; lo = Math.min(lo, t); hi = Math.max(hi, t); }
      const width = hi - lo, tanH = Math.tan(hfov / 2);
      const dist = name === 'photo' ? 0.62 * width / (2 * 0.5 * tanH) : (0.6 * width) / (2 * tanH);
      const tgt: Vector3Tuple = name === 'photo' ? c : [c[0], FOCUS_BOX.min[1] + 0.8 * (FOCUS_BOX.max[1] - FOCUS_BOX.min[1]), c[2]];
      return { position: [tgt[0] - v[0] * dist, 2, tgt[2] - v[1] * dist], target: tgt, timeOfDay };
    }
    case 'horizon': return { position: ring(35, 10000, 60), target: c, timeOfDay };
    case 'frontlit': return { position: ring(0, 1.15 * r, 2), target: c, timeOfDay };
    case 'edge': return { position: ring(95, 2.1 * r, c[1] - 0.1 * r), target: c, timeOfDay };
    case 'shadow': {
      // The sun ray through the cloud centre meets the ground at S, offset away from the sun by height / tan(elevation).
      // The camera stands in the shadow, on its sun-side half, and looks along the shadow axis (away from the sun) across the
      // far soft edge, which lies about one cloud radius further on. Camera height 25 m, aimed at the ground at the far edge.
      const tanEl = Math.max(0.15, sun[1] / hl);
      const off = c[1] / tanEl;
      const s0: [number, number] = [c[0] - sunH[0] * off, c[2] - sunH[1] * off];
      return { position: [s0[0] + sunH[0] * 0.35 * r, 25, s0[1] + sunH[1] * 0.35 * r], target: [s0[0] - sunH[0] * 1.9 * r, 0, s0[1] - sunH[1] * 1.9 * r], timeOfDay };
    }
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
