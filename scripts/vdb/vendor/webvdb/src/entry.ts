// Bundle entry for scripts/vdb/vdb-to-nvdb.mjs: the pieces of WebVDB the hero converter needs.
import { buildFromLeavesDetailed, FLOAT_LEAF_CODEC } from "./nanovdb/index.js";
import { uniformTransform } from "./nanovdb/build-from-vdb.js";
import type { VdbGrid, VdbLeaf } from "./vdb/types.js";
import type { BuiltGrid } from "./nanovdb/index.js";

export { parseVdb } from "./vdb/index.js";
export { buildFromVdb, buildFromVdbDetailed, buildFromDense, quantize, quantizeDetailed, writeNvdb } from "./nanovdb/index.js";
export { readValue, readLeafQuantum } from "./cpu/read-value.js";
export { NanoVDBFile } from "./nvdb-file.js";

/**
 * Like buildFromVdbDetailed, but active constant tiles (Houdini writes uniform 8^3 blocks of 1.0 as tiles) are expanded to
 * full leaves instead of being dropped. Inactive tiles must equal the background. Ours (not upstream).
 */
export function buildFromVdbTiled(grid: VdbGrid, opts: { gridName?: string } = {}): BuiltGrid {
  const { voxelSize, translation } = uniformTransform(grid.transform);
  function* leaves(): Iterable<VdbLeaf> {
    yield* grid.iterLeaves();
    for (const t of grid.tiles) {
      if (!t.active) {
        if (t.value !== grid.background) throw new Error(`inactive tile at ${t.origin} holds ${t.value}, background is ${grid.background}`);
        continue;
      }
      if (t.size % 8 !== 0) throw new Error(`tile size ${t.size} is not a multiple of the leaf size`);
      for (let x = 0; x < t.size; x += 8) for (let y = 0; y < t.size; y += 8) for (let z = 0; z < t.size; z += 8) {
        yield {
          origin: [t.origin[0] + x, t.origin[1] + y, t.origin[2] + z],
          values: new Float32Array(512).fill(t.value),
          valueMask: new Uint32Array(16).fill(0xffffffff),
        };
      }
    }
  }
  return buildFromLeavesDetailed(leaves(), FLOAT_LEAF_CODEC, {
    voxelSize, worldOrigin: translation, background: grid.background,
    gridName: opts.gridName ?? grid.name ?? "grid", gridClass: "FogVolume",
  });
}
