import { EdgesGeometry, LineBasicMaterial, LineSegments, SphereGeometry, TorusGeometry, type BufferGeometry, type Object3D } from 'three/webgpu';
import { convertMeshToDensity, type MeshDensityResult, type StaticTriangleMesh } from '../../../../packages/tools/src/mesh';

export type MeshBenchShape = 'sphere' | 'torus';

export interface MeshBenchOptions {
  readonly shape: MeshBenchShape;
  readonly resolution: 16 | 32;
  readonly softness: number;
  readonly extinctionScale?: number;
}

export interface MeshBenchResult {
  readonly shape: MeshBenchShape;
  readonly geometry: BufferGeometry;
  readonly field: MeshDensityResult;
  readonly wireframe: LineSegments;
  readonly triangleCount: number;
  readonly dispose: () => void;
}

function geometryFor(shape: MeshBenchShape): BufferGeometry {
  // Deliberately coarse meshes keep this interactive and make the conversion
  // boundary visible. Both primitives are closed, with the torus providing a
  // concave test surface and a hole through the volume.
  return shape === 'sphere'
    ? new SphereGeometry(1.25, 16, 10)
    : new TorusGeometry(1.05, 0.38, 8, 20);
}

function staticMesh(geometry: BufferGeometry): StaticTriangleMesh {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!position || position.itemSize !== 3) throw new Error('Mesh benchmark geometry has no xyz position attribute.');
  // Parametric meshes keep seam and pole vertices separate for UVs and
  // normals. Weld by position for the position-only watertight converter.
  const unique: number[] = [], remap = new Uint32Array(position.count), vertices = new Map<string, number>();
  for (let i = 0; i < position.count; i++) {
    const values = [Number(position.getX(i)), Number(position.getY(i)), Number(position.getZ(i))];
    const key = values.map(value => String(Math.round(value * 100000))).join(',');
    let target = vertices.get(key);
    if (target === undefined) { target = unique.length / 3; vertices.set(key, target); unique.push(...values); }
    remap[i] = target;
  }
  const sourceIndices = index?.array ?? Uint32Array.from({ length: position.count }, (_, i) => i);
  const indices = new Uint32Array(sourceIndices.length);
  for (let i = 0; i < sourceIndices.length; i++) indices[i] = remap[Number(sourceIndices[i])];
  return { positions: unique, indices };
}

export function createMeshBench(options: MeshBenchOptions): MeshBenchResult {
  if (options.shape !== 'sphere' && options.shape !== 'torus') throw new Error('Unknown mesh benchmark shape.');
  if (options.resolution !== 16 && options.resolution !== 32) throw new Error('Mesh benchmark resolution must be 16 or 32.');
  if (!Number.isFinite(options.softness) || options.softness < 0 || options.softness > 1) throw new Error('Mesh benchmark falloff must be between 0 and 1 metre.');
  const geometry = geometryFor(options.shape);
  const field = convertMeshToDensity(staticMesh(geometry), {
    id: `mesh-bench-${options.shape}`,
    revision: 1,
    resolution: options.resolution,
    padding: 0.12,
    softness: options.softness,
    extinctionScale: options.extinctionScale ?? 0.025,
    maxTriangles: 2000,
    maxVertices: 2000,
  });
  const wireframe = new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial({ color: 0xffc65c, transparent: true, opacity: 0.7 }));
  wireframe.visible = true;
  wireframe.renderOrder = 2;
  const dispose = () => { wireframe.removeFromParent(); wireframe.geometry.dispose(); (wireframe.material as LineBasicMaterial).dispose(); geometry.dispose(); };
  return { shape: options.shape, geometry, field, wireframe, triangleCount: field.triangleCount, dispose };
}

export function meshBenchInput(result: MeshBenchResult): Object3D { return result.wireframe; }
