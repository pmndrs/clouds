import type { Bounds3, DensityDescriptor, Vec3 } from '@clouds/core';
import { densityPayloadBytes, validateDensityDescriptor } from '@clouds/core';
import type { DenseDensityField } from '@clouds/assets';

/** The only OpenVDB semantic accepted by this adapter. */
export type VdbGridClass = 'fog' | 'level-set';

export interface VdbFogGrid {
  /** OpenVDB grid class. Use `fog`; level sets are intentionally rejected. */
  readonly gridClass: string;
  /** Number of samples in x, y and z. Values use x-fastest order. */
  readonly dimensions: readonly [number, number, number];
  /** Dense source values, including the grid background for inactive voxels. */
  readonly values: ArrayLike<number>;
  /** OpenVDB background value, retained for provenance and conversion checks. */
  readonly background: number;
  /** World-space axis-aligned bounds represented by this dense source. */
  readonly bounds: Bounds3;
  /** Optional column-major index-to-world affine transform from the source grid. */
  readonly indexToWorld?: readonly number[];
  /** Optional source voxel spacing in world units. */
  readonly voxelSize?: Vec3;
}

export interface VdbDensityOptions {
  readonly id?: string;
  readonly revision?: number;
  readonly dimensions?: readonly [number, number, number];
  /** Convenience for a cubic destination grid. Ignored when dimensions is supplied. */
  readonly resolution?: number;
  readonly extinctionScale?: number;
  readonly encoding?: 'r8unorm' | 'r32float';
  /** Input range mapped to [0, 255] for r8unorm. Defaults to [0, 1]. */
  readonly valueRange?: readonly [number, number];
  /** Allow values outside valueRange to be clamped for r8unorm. */
  readonly clampValues?: boolean;
  /** Maximum destination voxel count checked before output allocation. */
  readonly maxVoxels?: number;
  /** Maximum destination payload bytes checked before output allocation. */
  readonly maxPayloadBytes?: number;
  /** Maximum destination dimension on any axis. */
  readonly maxDimension?: number;
}

export interface VdbDensityResult extends DenseDensityField {
  readonly source: 'vdb-fog';
  readonly gridClass: 'fog';
  readonly sourceDimensions: readonly [number, number, number];
  readonly sourceVoxelSize?: Vec3;
  readonly sourceBackground: number;
  readonly sourceIndexToWorld?: readonly number[];
  readonly valueRange: readonly [number, number];
  readonly resampled: boolean;
}

const DEFAULT_MAX_VOXELS = 256 * 256 * 256;
const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_DIMENSION = 4096;
const FLOAT32_MAX = 3.4028234663852886e38;

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`);
  return value;
}

function dimensions(value: readonly [number, number, number], label: string, maxDimension: number): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must have exactly three dimensions.`);
  const output = [positiveInteger(value[0], `${label} x`), positiveInteger(value[1], `${label} y`), positiveInteger(value[2], `${label} z`)] as [number, number, number];
  if (output.some(axis => axis > maxDimension)) throw new Error(`${label} exceeds the configured dimension limit.`);
  return output;
}

function voxelCount(size: readonly [number, number, number], label: string): number {
  const count = size[0] * size[1] * size[2];
  if (!Number.isSafeInteger(count)) throw new Error(`${label} voxel count exceeds the safe integer range.`);
  return count;
}

function normalizeGridClass(value: string): 'fog' {
  if (typeof value !== 'string') throw new Error('VDB grid class is required.');
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (normalized === 'fog' || normalized === 'fog volume' || normalized === 'fogvolume') return 'fog';
  if (normalized === 'level set' || normalized === 'levelset' || normalized === 'sdf' || normalized === 'signed distance') {
    throw new Error('VDB level-set grids are not fog density and cannot be imported.');
  }
  throw new Error(`Unsupported VDB grid class "${value}"; expected a fog volume.`);
}

function checkBounds(bounds: Bounds3): void {
  if (!bounds || !Array.isArray(bounds.min) || !Array.isArray(bounds.max) || bounds.min.length !== 3 || bounds.max.length !== 3) throw new Error('VDB world bounds must contain three-component min and max arrays.');
  for (let axis = 0; axis < 3; axis++) {
    finite(bounds.min[axis], 'VDB bounds');
    finite(bounds.max[axis], 'VDB bounds');
    if (!(bounds.max[axis] > bounds.min[axis])) throw new Error('VDB world bounds must have positive extent on every axis.');
  }
}

function checkTransform(transform: readonly number[] | undefined): readonly number[] | undefined {
  if (transform === undefined) return undefined;
  if (transform.length !== 16 || transform.some(value => !Number.isFinite(value))) throw new Error('VDB indexToWorld must be a finite column-major 4x4 matrix.');
  if (transform[3] !== 0 || transform[7] !== 0 || transform[11] !== 0 || transform[15] !== 1) throw new Error('VDB indexToWorld must be affine.');
  const scale = Math.max(1, ...transform.map(value => Math.abs(value)));
  const tolerance = scale * 1e-10;
  if (Math.abs(transform[1]) > tolerance || Math.abs(transform[2]) > tolerance || Math.abs(transform[4]) > tolerance || Math.abs(transform[6]) > tolerance || Math.abs(transform[8]) > tolerance || Math.abs(transform[9]) > tolerance) throw new Error('VDB indexToWorld rotation/shear is unsupported by the axis-aligned dense contract.');
  if (transform[0] <= tolerance || transform[5] <= tolerance || transform[10] <= tolerance) throw new Error('VDB indexToWorld must have positive axis-aligned spacing.');
  return [...transform];
}

function checkVoxelSize(voxelSize: Vec3 | undefined): Vec3 | undefined {
  if (voxelSize === undefined) return undefined;
  const result = [finite(voxelSize[0], 'VDB voxel size'), finite(voxelSize[1], 'VDB voxel size'), finite(voxelSize[2], 'VDB voxel size')] as [number, number, number];
  if (result.some(value => value <= 0)) throw new Error('VDB voxel size must be positive.');
  return result;
}

function sourceIndex(values: readonly [number, number, number], x: number, y: number, z: number): number {
  return x + y * values[0] + z * values[0] * values[1];
}

function sampleTrilinear(values: ArrayLike<number>, source: readonly [number, number, number], x: number, y: number, z: number): number {
  const sx = source[0] === 1 ? 0 : Math.max(0, Math.min(source[0] - 1, x));
  const sy = source[1] === 1 ? 0 : Math.max(0, Math.min(source[1] - 1, y));
  const sz = source[2] === 1 ? 0 : Math.max(0, Math.min(source[2] - 1, z));
  const x0 = Math.floor(sx), y0 = Math.floor(sy), z0 = Math.floor(sz);
  const x1 = Math.min(source[0] - 1, x0 + 1), y1 = Math.min(source[1] - 1, y0 + 1), z1 = Math.min(source[2] - 1, z0 + 1);
  const fx = sx - x0, fy = sy - y0, fz = sz - z0;
  const c000 = Number(values[sourceIndex(source, x0, y0, z0)]);
  const c100 = Number(values[sourceIndex(source, x1, y0, z0)]);
  const c010 = Number(values[sourceIndex(source, x0, y1, z0)]);
  const c110 = Number(values[sourceIndex(source, x1, y1, z0)]);
  const c001 = Number(values[sourceIndex(source, x0, y0, z1)]);
  const c101 = Number(values[sourceIndex(source, x1, y0, z1)]);
  const c011 = Number(values[sourceIndex(source, x0, y1, z1)]);
  const c111 = Number(values[sourceIndex(source, x1, y1, z1)]);
  const c00 = c000 + (c100 - c000) * fx;
  const c10 = c010 + (c110 - c010) * fx;
  const c01 = c001 + (c101 - c001) * fx;
  const c11 = c011 + (c111 - c011) * fx;
  return (c00 + (c10 - c00) * fy) + ((c01 + (c11 - c01) * fy) - (c00 + (c10 - c00) * fy)) * fz;
}

/**
 * Convert a normalized OpenVDB fog grid (expanded with its background) into
 * the same dense field consumed by the renderer. This is an offline adapter:
 * parsing `.vdb` bytes belongs to the native Python/Houdini bridge.
 */
export function convertVdbFogGridToDensity(grid: VdbFogGrid, options: VdbDensityOptions = {}): VdbDensityResult {
  if (!grid || typeof grid !== 'object') throw new Error('VDB fog grid is required.');
  const gridClass = normalizeGridClass(grid.gridClass);
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  positiveInteger(maxDimension, 'maxDimension');
  const sourceDimensions = dimensions(grid.dimensions, 'VDB source dimensions', maxDimension);
  const sourceCount = voxelCount(sourceDimensions, 'VDB source');
  if (!grid.values || !Number.isSafeInteger(grid.values.length) || grid.values.length !== sourceCount) throw new Error(`VDB values length must equal ${sourceCount}.`);
  const background = finite(Number(grid.background), 'VDB background');
  checkBounds(grid.bounds);
  const indexToWorld = checkTransform(grid.indexToWorld);
  const sourceVoxelSize = checkVoxelSize(grid.voxelSize);
  for (let i = 0; i < sourceCount; i++) {
    const value = finite(Number(grid.values[i]), 'VDB density value');
    if (options.encoding === 'r32float' && Math.abs(value) > FLOAT32_MAX) throw new Error('VDB density value cannot be represented as r32float.');
  }

  const destinationDimensions = dimensions(options.dimensions ?? [options.resolution ?? sourceDimensions[0], options.resolution ?? sourceDimensions[1], options.resolution ?? sourceDimensions[2]], 'VDB destination dimensions', maxDimension);
  const count = voxelCount(destinationDimensions, 'VDB destination');
  const maxVoxels = options.maxVoxels ?? DEFAULT_MAX_VOXELS;
  positiveInteger(maxVoxels, 'maxVoxels');
  if (count > maxVoxels) throw new Error(`VDB destination has ${count} voxels, above maxVoxels ${maxVoxels}.`);
  const encoding = options.encoding ?? 'r8unorm';
  const bytesPerVoxel = encoding === 'r8unorm' ? 1 : encoding === 'r32float' ? 4 : 0;
  if (!bytesPerVoxel) throw new Error(`Unsupported VDB output encoding "${encoding}".`);
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  positiveInteger(maxPayloadBytes, 'maxPayloadBytes');
  if (count * bytesPerVoxel > maxPayloadBytes) throw new Error('VDB destination payload exceeds the configured byte limit.');

  const valueRange = options.valueRange ?? [0, 1] as const;
  if (valueRange.length !== 2 || !Number.isFinite(valueRange[0]) || !Number.isFinite(valueRange[1]) || !(valueRange[1] > valueRange[0])) throw new Error('VDB valueRange must have finite min and max values with max greater than min.');
  const sourceValueRange: [number, number] = [valueRange[0], valueRange[1]];
  const clampValues = options.clampValues ?? false;
  if (encoding === 'r8unorm' && !clampValues) {
    for (let i = 0; i < sourceCount; i++) if (Number(grid.values[i]) < sourceValueRange[0] || Number(grid.values[i]) > sourceValueRange[1]) throw new Error('VDB density value is outside valueRange; pass clampValues to quantize with clipping.');
  }

  const output = encoding === 'r8unorm' ? new Uint8Array(count) : new Uint8Array(count * 4);
  const outputFloats = encoding === 'r32float' ? new Float32Array(output.buffer) : undefined;
  const sourceSameSize = sourceDimensions[0] === destinationDimensions[0] && sourceDimensions[1] === destinationDimensions[1] && sourceDimensions[2] === destinationDimensions[2];
  const encode = (value: number, index: number) => {
    if (encoding === 'r32float') {
      outputFloats![index] = value;
      return;
    }
    const normalized = (value - sourceValueRange[0]) / (sourceValueRange[1] - sourceValueRange[0]);
    output[index] = Math.round(Math.max(0, Math.min(1, normalized)) * 255);
  };
  for (let z = 0; z < destinationDimensions[2]; z++) for (let y = 0; y < destinationDimensions[1]; y++) for (let x = 0; x < destinationDimensions[0]; x++) {
    const outputIndex = sourceIndex(destinationDimensions, x, y, z);
    const sx = sourceSameSize ? x : ((x + .5) * sourceDimensions[0] / destinationDimensions[0] - .5);
    const sy = sourceSameSize ? y : ((y + .5) * sourceDimensions[1] / destinationDimensions[1] - .5);
    const sz = sourceSameSize ? z : ((z + .5) * sourceDimensions[2] / destinationDimensions[2] - .5);
    encode(sourceSameSize ? Number(grid.values[outputIndex]) : sampleTrilinear(grid.values, sourceDimensions, sx, sy, sz), outputIndex);
  }

  const descriptor: DensityDescriptor = {
    id: options.id ?? 'vdb-fog',
    revision: options.revision ?? 0,
    dimensions: destinationDimensions,
    bounds: { min: [...grid.bounds.min] as [number, number, number], max: [...grid.bounds.max] as [number, number, number] },
    extinctionScale: options.extinctionScale ?? 0.025,
    encoding,
  };
  validateDensityDescriptor(descriptor);
  if (densityPayloadBytes(descriptor) !== output.byteLength) throw new Error('Generated VDB density has an invalid payload length.');
  return {
    descriptor,
    data: output,
    source: 'vdb-fog',
    gridClass,
    sourceDimensions,
    sourceVoxelSize,
    sourceBackground: background,
    sourceIndexToWorld: indexToWorld,
    valueRange: sourceValueRange,
    resampled: !sourceSameSize,
  };
}

export const vdbFogToDensity = convertVdbFogGridToDensity;
