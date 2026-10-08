import type { Vec3 } from '@clouds/core';

/** Largest value representable by a WGSL `u32`. */
export const U32_MAX = 0xffff_ffff;

/*
 * The epsilon is measured in world units.  It is deliberately relative to
 * the largest value used by this decision, so a boundary that is exactly on a
 * sample lattice is treated as being reached a little earlier.  That makes
 * an accidentally rounded tie conservative: the next index can be earlier,
 * but never later than the first sample at the face.
 */
const RELATIVE_FACE_EPSILON = 1e-6;

function validateArguments(
  samplePosition: Vec3,
  ray: Vec3,
  cellSize: number,
  ds: number,
  currentIndex: number,
): void {
  if (![...samplePosition, ...ray].every(Number.isFinite)) {
    throw new Error('Traversal sample position and ray must be finite.');
  }
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error('Traversal cellSize must be finite and positive.');
  }
  if (!Number.isFinite(ds) || ds <= 0) {
    throw new Error('Traversal ds must be finite and positive.');
  }
  if (!Number.isSafeInteger(currentIndex) || currentIndex < 0 || currentIndex > U32_MAX) {
    throw new Error('Traversal currentIndex must be a u32.');
  }
}

/**
 * Distance from a point to the next face in one signed axis direction.
 *
 * A point exactly on a face while travelling towards the lower cell has a
 * zero distance face.  Keeping that result is important: the point is already
 * on the boundary, so no sample before the face can be skipped.  In
 * particular, advancing to the next lower face would incorrectly skip the
 * first sample in the neighbouring cell.
 */
function nextFaceDistance(position: number, direction: number, cellSize: number): number {
  if (direction === 0) return Infinity;
  const cell = Math.floor(position / cellSize);
  const face = direction > 0 ? (cell + 1) * cellSize : cell * cellSize;
  return Math.max(0, (face - position) / direction);
}

function faceEpsilon(samplePosition: Vec3, faceDistance: number, cellSize: number, ds: number): number {
  const scale = Math.max(
    cellSize,
    ds,
    Math.abs(samplePosition[0]),
    Math.abs(samplePosition[2]),
    faceDistance,
  );
  return scale * RELATIVE_FACE_EPSILON;
}

function incrementClamped(currentIndex: number, advance: number): number {
  if (currentIndex >= U32_MAX) return U32_MAX;
  const room = U32_MAX - currentIndex;
  return currentIndex + Math.min(room, advance);
}

/**
 * Return the first fixed-lattice sample at or after the next XZ cell face.
 *
 * `samplePosition` is the midpoint for `currentIndex`.  The returned index is
 * always greater than `currentIndex` (unless the u32 range is exhausted), and
 * every omitted midpoint is strictly before the selected face.  Y is ignored
 * intentionally because the bounded P2 mask is a horizontal-cell mask.
 */
export function nextCellSampleIndex(
  samplePosition: Vec3,
  ray: Vec3,
  cellSize: number,
  ds: number,
  currentIndex: number,
): number {
  validateArguments(samplePosition, ray, cellSize, ds, currentIndex);

  const xDistance = nextFaceDistance(samplePosition[0], ray[0], cellSize);
  const zDistance = nextFaceDistance(samplePosition[2], ray[2], cellSize);
  const faceDistance = Math.min(xDistance, zDistance);
  // A ray with no horizontal component never leaves its current cell.
  if (!Number.isFinite(faceDistance)) return incrementClamped(currentIndex, 1);

  // floor((distance - epsilon) / ds) counts lattice offsets strictly before
  // the face; +1 selects the first offset that is not before it.
  const skipped = Math.max(0, Math.floor((faceDistance - faceEpsilon(samplePosition, faceDistance, cellSize, ds)) / ds));
  return incrementClamped(currentIndex, Math.max(1, skipped + 1));
}

/**
 * Raw WGSL source for the bounded horizontal-cell traversal helper.
 *
 * Keep this source self-contained so a caller can interpolate it into a raw
 * compute shader.  It mirrors `nextCellSampleIndex` above.
 */
export const TRAVERSAL_WGSL = /* wgsl */ `
const TRAVERSAL_F32_MAX: f32 = 3.402823466e+38;
const TRAVERSAL_U32_MAX: u32 = 4294967295u;
const TRAVERSAL_RELATIVE_EPSILON: f32 = 1e-6;

fn traversalNextFaceDistance(position: f32, direction: f32, cellSize: f32) -> f32 {
  if (direction == 0.0) {
    return TRAVERSAL_F32_MAX;
  }
  let cell = floor(position / cellSize);
  let face = select(cell * cellSize, (cell + 1.0) * cellSize, direction > 0.0);
  return max(0.0, (face - position) / direction);
}

fn nextCellSampleIndex(
  samplePosition: vec3f,
  ray: vec3f,
  cellSize: f32,
  ds: f32,
  currentIndex: u32,
) -> u32 {
  let xDistance = traversalNextFaceDistance(samplePosition.x, ray.x, cellSize);
  let zDistance = traversalNextFaceDistance(samplePosition.z, ray.z, cellSize);
  let faceDistance = min(xDistance, zDistance);
  if (faceDistance >= TRAVERSAL_F32_MAX) {
    if (currentIndex == TRAVERSAL_U32_MAX) {
      return TRAVERSAL_U32_MAX;
    }
    return currentIndex + 1u;
  }

  let scale = max(cellSize, max(ds, max(abs(samplePosition.x), max(abs(samplePosition.z), faceDistance))));
  let epsilon = scale * TRAVERSAL_RELATIVE_EPSILON;
  let skipped = max(0.0, floor((faceDistance - epsilon) / ds));
  // Test before converting: a very large ds/face ratio can exceed u32.
  if (skipped >= f32(TRAVERSAL_U32_MAX - 1u)) {
    return TRAVERSAL_U32_MAX;
  }
  let advance = max(1u, u32(skipped) + 1u);
  let room = TRAVERSAL_U32_MAX - currentIndex;
  return currentIndex + min(room, advance);
}
`;

// Explicit alias for callers that name the helper after the function rather
// than the traversal module.
export const NEXT_CELL_SAMPLE_INDEX_WGSL = TRAVERSAL_WGSL;
