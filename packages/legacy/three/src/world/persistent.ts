import type { Bounds3, Vec3 } from '@clouds/core';
import type { CloudWorld, WorldCell, WorldOptions, WorldSnapshot } from './index';

const DEFAULT_SEED = 17;
const DEFAULT_CELL_SIZE = 2_200;
const DEFAULT_RADIUS = 16;
const DEFAULT_COVERAGE = 0.75;

function hash(x: number, z: number, seed: number, salt: number): number {
  let h = Math.imul(x | 0, 0x45d9f3b);
  h = Math.imul(h ^ Math.imul(z | 0, 0x119de1f3), 0x27d4eb2d);
  h = Math.imul(h ^ Math.imul(seed | 0, 0x165667b1), 0x85ebca6b);
  h = Math.imul(h ^ Math.imul(salt, 0x9e3779b9), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return (h >>> 0) / 0x1_0000_0000;
}
function fade(t: number): number { return t * t * (3 - 2 * t); }
function weatherNoise(x: number, z: number, seed: number, scale = 4, salt = 41): number {
  const gx = Math.floor(x / scale), gz = Math.floor(z / scale);
  const tx = fade(x / scale - gx), tz = fade(z / scale - gz);
  const a = hash(gx, gz, seed, salt), b = hash(gx + 1, gz, seed, salt);
  const c = hash(gx, gz + 1, seed, salt), d = hash(gx + 1, gz + 1, seed, salt);
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}
function validate(options: WorldOptions = {}): Required<WorldOptions> {
  const seed = options.seed ?? DEFAULT_SEED, cellSize = options.cellSize ?? DEFAULT_CELL_SIZE;
  const radius = options.radius ?? DEFAULT_RADIUS, coverage = options.coverage ?? DEFAULT_COVERAGE;
  if (!Number.isInteger(seed) || seed < -2147483648 || seed > 2147483647) throw new Error('World seed must be a signed 32-bit integer.');
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('World cellSize must be finite and positive.');
  if (!Number.isSafeInteger(radius) || radius < 0 || radius > 16) throw new Error('World radius must be a safe integer between 0 and 16.');
  if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1) throw new Error('World coverage must be finite and between 0 and 1.');
  return { seed, cellSize, radius, coverage };
}
function bounds(min: Vec3, max: Vec3): Bounds3 { return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) }); }
function createCell(x: number, z: number, o: Required<WorldOptions>): WorldCell {
  const { cellSize, seed, coverage } = o;
  const cx = (x + 0.5) * cellSize + (hash(x, z, seed, 1) - 0.5) * 0.3 * cellSize;
  const cz = (z + 0.5) * cellSize + (hash(x, z, seed, 2) - 0.5) * 0.3 * cellSize;
  const hx = (0.3 + hash(x, z, seed, 3) * 0.3) * cellSize;
  const hz = (0.3 + hash(x, z, seed, 4) * 0.3) * cellSize;
  const bottom = 700 + hash(x, z, seed, 5) * 500;
  const top = 2400 + hash(x, z, seed, 6) * 1100;
  // Coverage moves a threshold through a continuous regional field. It does
  // not randomly toggle whole cells or merely darken every cloud uniformly.
  const weather = .7 * weatherNoise(x + .5, z + .5, seed) + .3 * weatherNoise(x + .5, z + .5, seed, 9, 43);
  const mask = coverage === 0 ? 0 : coverage === 1 ? 1 : fade(Math.max(0, Math.min(1, (weather - 1 + coverage * 1.18) / .18)));
  return Object.freeze({ cellX: x, cellZ: z, bounds: bounds([cx - hx, bottom, cz - hz], [cx + hx, top, cz + hz]), atlasIndex: Math.min(7, Math.floor(hash(x, z, seed, 8) * 8)), extinctionScale: (0.012 + hash(x, z, seed, 9) * 0.01) * mask, active: mask > 0 });
}
/** Deterministic prototype with a fixed 33x33 window (72.6 km at defaults). */
export function createPersistentCloudWorld(options?: WorldOptions): CloudWorld {
  const o = validate(options), side = o.radius * 2 + 1, min = -o.radius, cells: WorldCell[] = [];
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) cells.push(createCell(min + x, min + z, o));
  const margin = 0.3 * o.cellSize;
  const snapshot: WorldSnapshot = Object.freeze({ originCell: Object.freeze([0, 0] as [number, number]), gridMin: Object.freeze([min, min] as [number, number]), side, cellSize: o.cellSize, bounds: bounds([min * o.cellSize - margin, 0, min * o.cellSize - margin], [(min + side) * o.cellSize + margin, 3500, (min + side) * o.cellSize + margin]), cells: Object.freeze(cells), revision: 0 });
  return { update(cameraPosition: Vec3) { if (!Array.isArray(cameraPosition) || cameraPosition.length !== 3 || !cameraPosition.every(Number.isFinite)) throw new Error('Camera position must contain three finite numbers.'); return snapshot; }, snapshot };
}
