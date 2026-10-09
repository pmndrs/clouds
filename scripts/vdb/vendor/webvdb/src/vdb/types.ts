/** Public `.vdb` parser types (docs/SPEC.md §4, docs/PLAN.md Phase 5). */

/** A constant-value cube above leaf resolution (vendor change, see NOTICE). */
export interface VdbTile {
  origin: [number, number, number];
  size: number;
  value: number;
  active: boolean;
}

/** Cheap description of a grid, available without decoding its tree (vendor change, see NOTICE). */
export interface VdbGridDescriptor {
  name: string;
  /** Raw type string, e.g. "Tree_float_5_4_3". */
  gridType: string;
  /** Value type parsed from gridType ("float", "vec3s", ...), or "" when unrecognised. */
  valueType: string;
  /** The grid's `class` metadata ("level set", "fog volume", "staggered", "unknown"), or "". */
  gridClass: string;
  transform: VdbTransformInfo | null;
  indexBBox: VdbBBox | null;
  compression: { zip: boolean; activeMask: boolean; blosc: boolean };
  /** Set when the grid cannot be decoded by this parser (unsupported type, tree layout or transform). */
  unsupported: string | null;
}

export interface VdbFile {
  fileVersion: number;
  grids: VdbGrid[];
  /** Every grid in the file, decoded or not, in file order. */
  descriptors: VdbGridDescriptor[];
}

export interface VdbTransformInfo {
  type: string;
  /** 4x4 row-major index->world affine matrix. */
  matrix: number[];
  voxelSize: [number, number, number];
}

export interface VdbBBox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface VdbLeaf {
  origin: [number, number, number];
  values: Float32Array;
  /** 512-bit active mask as 16 little-endian u32 words. */
  valueMask: Uint32Array;
}

export interface VdbGrid {
  name: string;
  gridType: string;
  transform: VdbTransformInfo;
  metadata: Record<string, unknown>;
  indexBBox: VdbBBox | null;
  activeVoxelCount: bigint;
  background: number;
  /** Constant-value tiles above leaf resolution (lower 8^3 and upper 128^3 nodes). */
  tiles: VdbTile[];
  gridClass: string;
  readValue(ijk: [number, number, number]): { value: number; active: boolean };
  iterLeaves(): Iterable<VdbLeaf>;
}
