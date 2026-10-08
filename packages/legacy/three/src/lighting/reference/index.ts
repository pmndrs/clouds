import type { Bounds3, Vec3 } from '@clouds/core';

/**
 * WGSL reference helpers for opaque, axis-aligned cloud shadow occlusion.
 *
 * The functions intentionally operate on world-space rays and bounded boxes;
 * callers choose the directional-light origin and direction. Keep this source
 * in sync with `intersectBox` and `boxOccludes` below.
 */
export const REFERENCE_SHADOW_WGSL = /* wgsl */ `
const BOX_RAY_NEG_INF: f32 = -3.402823466e+38;
const BOX_RAY_POS_INF: f32 = 3.402823466e+38;

fn boxSlab(origin: f32, direction: f32, lo: f32, hi: f32) -> vec2<f32> {
  // A zero direction leaves the ray parallel to this pair of faces. It is
  // unconstrained when the origin is inside the slab and misses otherwise.
  if (direction == 0.0) {
    if (origin < lo || origin > hi) {
      return vec2<f32>(1.0, -1.0);
    }
    return vec2<f32>(BOX_RAY_NEG_INF, BOX_RAY_POS_INF);
  }

  let t0 = (lo - origin) / direction;
  let t1 = (hi - origin) / direction;
  return vec2<f32>(min(t0, t1), max(t0, t1));
}

fn boxInterval(
  origin: vec3<f32>,
  direction: vec3<f32>,
  lo: vec3<f32>,
  hi: vec3<f32>,
) -> vec2<f32> {
  let x = boxSlab(origin.x, direction.x, lo.x, hi.x);
  if (x.x > x.y) {
    return vec2<f32>(1.0, -1.0);
  }
  let y = boxSlab(origin.y, direction.y, lo.y, hi.y);
  if (y.x > y.y) {
    return vec2<f32>(1.0, -1.0);
  }
  let z = boxSlab(origin.z, direction.z, lo.z, hi.z);
  if (z.x > z.y) {
    return vec2<f32>(1.0, -1.0);
  }

  let near = max(x.x, max(y.x, z.x));
  let far = min(x.y, min(y.y, z.y));
  if (near > far) {
    return vec2<f32>(1.0, -1.0);
  }
  return vec2<f32>(near, far);
}

fn boxOccludes(
  origin: vec3<f32>,
  direction: vec3<f32>,
  lo: vec3<f32>,
  hi: vec3<f32>,
) -> bool {
  // A zero-length direction has no positive ray segment to occlude.
  if (all(direction == vec3<f32>(0.0))) {
    return false;
  }
  let interval = boxInterval(origin, direction, lo, hi);
  // Strictness excludes a single touching point (including an outward ray
  // launched exactly on a box face) while preserving entering boundary hits.
  return interval.y > max(interval.x, 0.0);
}
`;

type Interval = readonly [number, number];

function canonicalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

function slabInterval(origin: number, direction: number, lo: number, hi: number): Interval | null {
  if (direction === 0) {
    return origin < lo || origin > hi ? null : [-Infinity, Infinity];
  }

  const t0 = (lo - origin) / direction;
  const t1 = (hi - origin) / direction;
  return t0 <= t1
    ? [canonicalizeZero(t0), canonicalizeZero(t1)]
    : [canonicalizeZero(t1), canonicalizeZero(t0)];
}

/**
 * Intersects an infinite line with a world-space axis-aligned box.
 *
 * The returned values are ray parameters for `origin + direction * t`; the
 * direction does not need to be normalized. `null` means the line misses.
 */
export function intersectBox(
  origin: Vec3,
  direction: Vec3,
  bounds: Bounds3,
): readonly [number, number] | null {
  const x = slabInterval(origin[0], direction[0], bounds.min[0], bounds.max[0]);
  if (x === null) return null;
  const y = slabInterval(origin[1], direction[1], bounds.min[1], bounds.max[1]);
  if (y === null) return null;
  const z = slabInterval(origin[2], direction[2], bounds.min[2], bounds.max[2]);
  if (z === null) return null;

  const near = Math.max(x[0], y[0], z[0]);
  const far = Math.min(x[1], y[1], z[1]);
  return near <= far ? [near, far] : null;
}

/** Returns whether an opaque box occupies a positive-length segment forward from the origin. */
export function boxOccludes(origin: Vec3, direction: Vec3, bounds: Bounds3): boolean {
  if (direction[0] === 0 && direction[1] === 0 && direction[2] === 0) return false;
  const interval = intersectBox(origin, direction, bounds);
  return interval !== null && interval[1] > Math.max(interval[0], 0);
}
