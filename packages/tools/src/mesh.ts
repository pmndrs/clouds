import type { DensityDescriptor } from '@clouds/core';
import { densityPayloadBytes, validateDensityDescriptor } from '@clouds/core';
import type { DenseDensityField } from '@clouds/assets';

export interface StaticTriangleMesh {
  /** Three consecutive finite numbers per vertex. */
  readonly positions: ArrayLike<number>;
  /** Optional triangle indices. If omitted, positions are interpreted as non-indexed triangles. */
  readonly indices?: ArrayLike<number>;
}

export interface MeshDensityOptions {
  readonly id?: string;
  readonly revision?: number;
  readonly dimensions?: readonly [number, number, number];
  /** Convenience for a cubic grid. Ignored when dimensions is supplied. */
  readonly resolution?: number;
  /** World-space metres added on every side of the transformed mesh bounds. */
  readonly padding: number;
  /** World-space metres over which density fades from the surface to full interior. */
  readonly softness: number;
  readonly extinctionScale?: number;
  /** Column-major affine transform applied before bounds and voxel tests. */
  readonly transform?: readonly number[];
  readonly maxTriangles?: number;
  /** Upper bound checked before copying caller-provided vertices. */
  readonly maxVertices?: number;
}

export interface MeshDensityResult extends DenseDensityField {
  readonly source: 'mesh-occupancy';
  readonly triangleCount: number;
  readonly transformedBounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };
}

interface Triangle { readonly a: readonly [number, number, number]; readonly b: readonly [number, number, number]; readonly c: readonly [number, number, number] }

const RAY: readonly [number, number, number] = [1, 0.3713906763541037, 0.163287991791046];
const DEFAULT_MAX_TRIANGLES = 1_000_000;
const DEFAULT_MAX_VERTICES = 3_000_000;

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return value;
}

function normalizeDimensions(options: MeshDensityOptions): readonly [number, number, number] {
  const dimensions = options.dimensions ?? [options.resolution ?? 32, options.resolution ?? 32, options.resolution ?? 32];
  if (dimensions.length !== 3 || dimensions.some(d => !Number.isSafeInteger(d) || d < 1 || d > 256)) {
    throw new Error('Mesh density dimensions must be positive safe integers between 1 and 256.');
  }
  return [dimensions[0], dimensions[1], dimensions[2]];
}

function transformPoint(source: readonly [number, number, number], matrix: readonly number[] | undefined): [number, number, number] {
  if (!matrix) return [source[0], source[1], source[2]];
  const x = source[0], y = source[1], z = source[2];
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const nx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const ny = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const nz = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  if (w !== 0 && w !== 1) return [nx / w, ny / w, nz / w];
  return [nx, ny, nz];
}

function checkTransform(matrix: readonly number[] | undefined): void {
  if (matrix === undefined) return;
  if (matrix.length !== 16 || matrix.some(value => !Number.isFinite(value))) throw new Error('Mesh transform must be a finite column-major 4x4 matrix.');
  if (matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1) throw new Error('Mesh transform must be affine.');
}

function makeTriangles(mesh: StaticTriangleMesh, transform: readonly number[] | undefined, maxTriangles: number, maxVertices: number): Triangle[] {
  if (!mesh || !mesh.positions || mesh.positions.length % 3 !== 0) throw new Error('Mesh positions must contain complete xyz vertices.');
  const vertexCount = mesh.positions.length / 3;
  if (vertexCount < 3) throw new Error('Mesh must contain at least one triangle.');
  if (!Number.isSafeInteger(vertexCount) || vertexCount > maxVertices) throw new Error('Mesh vertex count exceeds the configured limit.');
  const indexCount = mesh.indices === undefined ? vertexCount : mesh.indices.length;
  if (!Number.isSafeInteger(indexCount) || indexCount % 3 !== 0 || indexCount < 3) throw new Error('Mesh indices must contain complete triangles.');
  const triangleCount = indexCount / 3;
  if (triangleCount > maxTriangles) throw new Error('Mesh triangle count exceeds the configured limit.');
  const vertices: [number, number, number][] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const p: [number, number, number] = [finite(Number(mesh.positions[i * 3]), 'Mesh position'), finite(Number(mesh.positions[i * 3 + 1]), 'Mesh position'), finite(Number(mesh.positions[i * 3 + 2]), 'Mesh position')];
    vertices[i] = transformPoint(p, transform);
    vertices[i].forEach(value => finite(value, 'Transformed mesh position'));
  }
  const triangles: Triangle[] = new Array(triangleCount);
  for (let i = 0; i < triangleCount; i++) {
    const ia = mesh.indices === undefined ? i * 3 : Number(mesh.indices[i * 3]);
    const ib = mesh.indices === undefined ? i * 3 + 1 : Number(mesh.indices[i * 3 + 1]);
    const ic = mesh.indices === undefined ? i * 3 + 2 : Number(mesh.indices[i * 3 + 2]);
    for (const index of [ia, ib, ic]) if (!Number.isSafeInteger(index) || index < 0 || index >= vertexCount) throw new Error('Mesh index is outside the position array.');
    triangles[i] = { a: vertices[ia], b: vertices[ib], c: vertices[ic] };
  }
  return triangles;
}

function validateWatertight(triangles: readonly Triangle[]): void {
  const vertexKey = (vertex: readonly [number, number, number]) => `${vertex[0]}\u0000${vertex[1]}\u0000${vertex[2]}`;
  const edges = new Map<string, number>();
  for (const triangle of triangles) {
    const ab = cross(triangle.b[0] - triangle.a[0], triangle.b[1] - triangle.a[1], triangle.b[2] - triangle.a[2], triangle.c[0] - triangle.a[0], triangle.c[1] - triangle.a[1], triangle.c[2] - triangle.a[2]);
    if (ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] <= 1e-20) throw new Error('Mesh contains a degenerate triangle.');
    for (const [first, second] of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]] as const) {
      const a = vertexKey(first), b = vertexKey(second);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const count of edges.values()) if (count !== 2) throw new Error('Mesh must be a watertight two-manifold triangle surface.');
}

function cross(ax: number, ay: number, az: number, bx: number, by: number, bz: number): [number, number, number] {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

/** Half-open Möller–Trumbore parity test. The non-axis ray avoids common grid-face ties. */
function pointInside(point: readonly [number, number, number], triangles: readonly Triangle[]): boolean {
  let intersections = 0;
  const epsilon = 1e-10;
  for (const triangle of triangles) {
    const e1x = triangle.b[0] - triangle.a[0], e1y = triangle.b[1] - triangle.a[1], e1z = triangle.b[2] - triangle.a[2];
    const e2x = triangle.c[0] - triangle.a[0], e2y = triangle.c[1] - triangle.a[1], e2z = triangle.c[2] - triangle.a[2];
    const pvec = cross(RAY[0], RAY[1], RAY[2], e2x, e2y, e2z);
    const determinant = e1x * pvec[0] + e1y * pvec[1] + e1z * pvec[2];
    if (Math.abs(determinant) <= epsilon) continue;
    const inverse = 1 / determinant;
    const tx = point[0] - triangle.a[0], ty = point[1] - triangle.a[1], tz = point[2] - triangle.a[2];
    const u = (tx * pvec[0] + ty * pvec[1] + tz * pvec[2]) * inverse;
    if (u < -epsilon || u > 1 + epsilon) continue;
    const qvec = cross(tx, ty, tz, e1x, e1y, e1z);
    const v = (RAY[0] * qvec[0] + RAY[1] * qvec[1] + RAY[2] * qvec[2]) * inverse;
    if (v < -epsilon || u + v > 1 + epsilon) continue;
    const distance = (e2x * qvec[0] + e2y * qvec[1] + e2z * qvec[2]) * inverse;
    if (distance > epsilon) intersections++;
  }
  return (intersections & 1) === 1;
}

function pointSegmentDistanceSquared(point: readonly [number, number, number], a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = point[0] - a[0], apy = point[1] - a[1], apz = point[2] - a[2];
  const length = abx * abx + aby * aby + abz * abz;
  const t = length > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / length)) : 0;
  const dx = apx - t * abx, dy = apy - t * aby, dz = apz - t * abz;
  return dx * dx + dy * dy + dz * dz;
}

function pointTriangleDistanceSquared(point: readonly [number, number, number], triangle: Triangle): number {
  // A compact point-to-triangle distance implementation using the Voronoi regions.
  const abx = triangle.b[0] - triangle.a[0], aby = triangle.b[1] - triangle.a[1], abz = triangle.b[2] - triangle.a[2];
  const acx = triangle.c[0] - triangle.a[0], acy = triangle.c[1] - triangle.a[1], acz = triangle.c[2] - triangle.a[2];
  const apx = point[0] - triangle.a[0], apy = point[1] - triangle.a[1], apz = point[2] - triangle.a[2];
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;
  const bpx = point[0] - triangle.b[0], bpy = point[1] - triangle.b[1], bpz = point[2] - triangle.b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return pointSegmentDistanceSquared(point, triangle.a, triangle.b);
  const cpx = point[0] - triangle.c[0], cpy = point[1] - triangle.c[1], cpz = point[2] - triangle.c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return pointSegmentDistanceSquared(point, triangle.a, triangle.c);
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return pointSegmentDistanceSquared(point, triangle.b, triangle.c);
  const normal = cross(abx, aby, abz, acx, acy, acz);
  const normalLengthSquared = normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2;
  if (normalLengthSquared === 0) return Math.min(pointSegmentDistanceSquared(point, triangle.a, triangle.b), pointSegmentDistanceSquared(point, triangle.a, triangle.c));
  const distance = (apx * normal[0] + apy * normal[1] + apz * normal[2]);
  return distance * distance / normalLengthSquared;
}

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

/** Convert an indexed or non-indexed watertight triangle mesh into a dense r8 field. */
export function convertMeshToDensity(mesh: StaticTriangleMesh, options: MeshDensityOptions): MeshDensityResult {
  if (!options || typeof options !== 'object') throw new Error('Mesh density options are required.');
  const padding = finite(options.padding, 'Mesh padding');
  const softness = finite(options.softness, 'Mesh softness');
  if (padding < 0 || softness < 0) throw new Error('Mesh padding and softness must be nonnegative.');
  const dimensions = normalizeDimensions(options);
  checkTransform(options.transform);
  const maxTriangles = options.maxTriangles ?? DEFAULT_MAX_TRIANGLES;
  if (!Number.isSafeInteger(maxTriangles) || maxTriangles < 1) throw new Error('maxTriangles must be a positive safe integer.');
  const maxVertices = options.maxVertices ?? Math.min(DEFAULT_MAX_VERTICES, maxTriangles * 3);
  if (!Number.isSafeInteger(maxVertices) || maxVertices < 3) throw new Error('maxVertices must be a positive safe integer.');
  const triangles = makeTriangles(mesh, options.transform, maxTriangles, maxVertices);
  validateWatertight(triangles);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const triangle of triangles) for (const vertex of [triangle.a, triangle.b, triangle.c]) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], vertex[axis]); max[axis] = Math.max(max[axis], vertex[axis]);
  }
  for (let axis = 0; axis < 3; axis++) { min[axis] -= padding; max[axis] += padding; if (!(max[axis] > min[axis])) throw new Error('Mesh bounds must have positive extent on every axis.'); }
  const count = dimensions[0] * dimensions[1] * dimensions[2];
  const data = new Uint8Array(count);
  const span: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  for (let z = 0; z < dimensions[2]; z++) for (let y = 0; y < dimensions[1]; y++) for (let x = 0; x < dimensions[0]; x++) {
    const point: [number, number, number] = [min[0] + (x + 0.5) * span[0] / dimensions[0], min[1] + (y + 0.5) * span[1] / dimensions[1], min[2] + (z + 0.5) * span[2] / dimensions[2]];
    if (!pointInside(point, triangles)) continue;
    let density = 1;
    if (softness > 0) {
      let nearestSquared = Infinity;
      for (const triangle of triangles) nearestSquared = Math.min(nearestSquared, pointTriangleDistanceSquared(point, triangle));
      density = smoothstep(Math.sqrt(nearestSquared) / softness);
    }
    data[x + y * dimensions[0] + z * dimensions[0] * dimensions[1]] = Math.round(density * 255);
  }
  const descriptor: DensityDescriptor = {
    id: options.id ?? 'mesh-density', revision: options.revision ?? 0,
    dimensions: [dimensions[0], dimensions[1], dimensions[2]],
    bounds: { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] },
    extinctionScale: options.extinctionScale ?? 0.025, encoding: 'r8unorm',
  };
  if (descriptor.revision > 0xffff_ffff) throw new Error('Mesh density revision exceeds the portable uint32 range.');
  validateDensityDescriptor(descriptor);
  if (data.byteLength !== densityPayloadBytes(descriptor)) throw new Error('Generated mesh density has an invalid payload length.');
  return { descriptor, data, source: 'mesh-occupancy', triangleCount: triangles.length, transformedBounds: { min, max } };
}

export const meshToDensity = convertMeshToDensity;
