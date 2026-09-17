import type { Bounds3, Vec3 } from '@clouds/core';

/** Options for the bounded, deterministic cloud residency window. */
export interface WorldOptions {
  /** Signed integer used by the world-space cell hash. */
  readonly seed?: number;
  /** Width and depth of one world cell, in metres. */
  readonly cellSize?: number;
  /** Number of cells retained on either side of the camera cell. */
  readonly radius?: number;
  /** Fraction of cells enabled by the deterministic coverage mask. */
  readonly coverage?: number;
}

export interface WorldCell {
  readonly cellX: number;
  readonly cellZ: number;
  readonly bounds: Bounds3;
  readonly atlasIndex: number;
  readonly extinctionScale: number;
  readonly active: boolean;
}

export interface WorldSnapshot {
  readonly originCell: readonly [number, number];
  readonly gridMin: readonly [number, number];
  readonly side: number;
  readonly cellSize: number;
  readonly bounds: Bounds3;
  readonly cells: readonly WorldCell[];
  readonly revision: number;
}

export interface CloudWorld {
  update(cameraPosition: Vec3): WorldSnapshot;
  readonly snapshot: WorldSnapshot;
}

const DEFAULT_SEED = 17;
const DEFAULT_CELL_SIZE = 2_200;
const DEFAULT_RADIUS = 4;
const DEFAULT_COVERAGE = 0.75;
const MAX_RADIUS = 8;
const HASH_SCALE = 1 / 0x1_0000_0000;

/*
 * The world hash intentionally takes signed cell coordinates. Bitwise integer
 * operations give a stable 32-bit result for negative coordinates as well as
 * positive coordinates, and avoid a stateful PRNG whose output would depend on
 * which part of the world happened to be generated first.
 */
function hashCell(cellX: number, cellZ: number, seed: number, stream: number): number {
  let h = Math.imul(cellX | 0, 0x1f123bb5);
  h = Math.imul(h ^ Math.imul(cellZ | 0, 0x5f356495), 0x27d4eb2d);
  h = Math.imul(h ^ Math.imul(seed | 0, 0x165667b1), 0x85ebca6b);
  h = Math.imul(h ^ Math.imul(stream | 0, 0x9e3779b9), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) * HASH_SCALE;
}

function normalizeOptions(options: WorldOptions | undefined): Required<WorldOptions> {
  const source = options ?? {};
  const seed = source.seed ?? DEFAULT_SEED;
  const cellSize = source.cellSize ?? DEFAULT_CELL_SIZE;
  const radius = source.radius ?? DEFAULT_RADIUS;
  const coverage = source.coverage ?? DEFAULT_COVERAGE;

  if (!Number.isSafeInteger(seed)) throw new Error('World seed must be a safe integer.');
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('World cellSize must be finite and positive.');
  if (!Number.isSafeInteger(radius) || radius < 0 || radius > MAX_RADIUS) {
    throw new Error(`World radius must be a safe integer between 0 and ${MAX_RADIUS}.`);
  }
  if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1) {
    throw new Error('World coverage must be finite and between 0 and 1.');
  }
  return { seed, cellSize, radius, coverage };
}

function keyFor(cellX: number, cellZ: number): string {
  return `${cellX},${cellZ}`;
}

function freezeBounds(min: Vec3, max: Vec3): Bounds3 {
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) });
}

function createCell(cellX: number, cellZ: number, options: Required<WorldOptions>): WorldCell {
  const { cellSize, seed, coverage } = options;
  const occupancy = hashCell(cellX, cellZ, seed, 0);
  const jitterX = (hashCell(cellX, cellZ, seed, 1) - 0.5) * 0.3 * cellSize;
  const jitterZ = (hashCell(cellX, cellZ, seed, 2) - 0.5) * 0.3 * cellSize;
  const centerX = (cellX + 0.5) * cellSize + jitterX;
  const centerZ = (cellZ + 0.5) * cellSize + jitterZ;

  // The first half of the atlas is broad formations and the second half is
  // towers. The atlas choice is metadata only; the GPU owner supplies the
  // actual atlas and can map these eight stable slots to its preferred forms.
  const atlasIndex = Math.min(7, Math.floor(hashCell(cellX, cellZ, seed, 3) * 8));
  const halfWidth = (0.3 + hashCell(cellX, cellZ, seed, 4) * 0.3) * cellSize;
  const halfDepth = (0.3 + hashCell(cellX, cellZ, seed, 5) * 0.3) * cellSize;
  const bottom = 800 + hashCell(cellX, cellZ, seed, 6) * 300;
  const top = 1_800 + hashCell(cellX, cellZ, seed, 7) * 1_200;

  const bounds = freezeBounds(
    [centerX - halfWidth, bottom, centerZ - halfDepth],
    [centerX + halfWidth, top, centerZ + halfDepth],
  );
  const extinctionScale = 0.012 + hashCell(cellX, cellZ, seed, 8) * 0.01;
  return Object.freeze({
    cellX,
    cellZ,
    bounds,
    atlasIndex,
    extinctionScale: Math.min(0.022, extinctionScale),
    active: occupancy < coverage,
  });
}

function makeSnapshot(
  originX: number,
  originZ: number,
  options: Required<WorldOptions>,
  previousCells: ReadonlyMap<string, WorldCell>,
  revision: number,
): { snapshot: WorldSnapshot; cellsByKey: Map<string, WorldCell> } {
  const side = options.radius * 2 + 1;
  const gridMinX = originX - options.radius;
  const gridMinZ = originZ - options.radius;
  const cells = new Array<WorldCell>(side * side);
  const cellsByKey = new Map<string, WorldCell>();

  // X is the fastest varying coordinate, matching the texture and brick
  // conventions used elsewhere in the package.
  let index = 0;
  for (let z = 0; z < side; z++) {
    const cellZ = gridMinZ + z;
    for (let x = 0; x < side; x++) {
      const cellX = gridMinX + x;
      const key = keyFor(cellX, cellZ);
      const cell = previousCells.get(key) ?? createCell(cellX, cellZ, options);
      cells[index++] = cell;
      cellsByKey.set(key, cell);
    }
  }

  // A cell can extend by .75 cell from its grid-cell origin (.5 centre + .15
  // jitter + .6 half extent). The additional .05 margin keeps the enclosing
  // bounds conservative in the presence of floating-point roundoff.
  const margin = 0.3 * options.cellSize;
  const bounds = freezeBounds(
    [(gridMinX * options.cellSize) - margin, 0, (gridMinZ * options.cellSize) - margin],
    [((gridMinX + side) * options.cellSize) + margin, 3_000, ((gridMinZ + side) * options.cellSize) + margin],
  );
  const snapshot: WorldSnapshot = Object.freeze({
    originCell: Object.freeze([originX, originZ] as [number, number]),
    gridMin: Object.freeze([gridMinX, gridMinZ] as [number, number]),
    side,
    cellSize: options.cellSize,
    bounds,
    cells: Object.freeze(cells),
    revision,
  });
  return { snapshot, cellsByKey };
}

/**
 * Create a bounded cloud world. Cell descriptors are generated from signed
 * global coordinates, so moving the residency window never changes a retained
 * cell's shape, placement, atlas slot, or optical scale.
 */
export function createCloudWorld(options?: WorldOptions): CloudWorld {
  const normalized = normalizeOptions(options);
  let originX = 0;
  let originZ = 0;
  let revision = 0;
  let state = makeSnapshot(originX, originZ, normalized, new Map(), revision);
  let currentSnapshot = state.snapshot;
  let currentCells = state.cellsByKey;

  function update(cameraPosition: Vec3): WorldSnapshot {
    if (!Array.isArray(cameraPosition) || cameraPosition.length !== 3 || !cameraPosition.every(Number.isFinite)) {
      throw new Error('Camera position must contain three finite numbers.');
    }
    const nextX = Math.floor(cameraPosition[0] / normalized.cellSize);
    const nextZ = Math.floor(cameraPosition[2] / normalized.cellSize);
    if (!Number.isSafeInteger(nextX) || !Number.isSafeInteger(nextZ)) {
      throw new Error('Camera position is outside the supported safe world coordinate range.');
    }
    if (nextX === originX && nextZ === originZ) return currentSnapshot;

    revision += 1;
    state = makeSnapshot(nextX, nextZ, normalized, currentCells, revision);
    originX = nextX;
    originZ = nextZ;
    currentSnapshot = state.snapshot;
    currentCells = state.cellsByKey;
    return currentSnapshot;
  }

  return {
    update,
    get snapshot() { return currentSnapshot; },
  };
}

/** Defaults are exported for consumers that want to display residency settings. */
export const CLOUD_WORLD_DEFAULTS = Object.freeze({
  seed: DEFAULT_SEED,
  cellSize: DEFAULT_CELL_SIZE,
  radius: DEFAULT_RADIUS,
  coverage: DEFAULT_COVERAGE,
});
