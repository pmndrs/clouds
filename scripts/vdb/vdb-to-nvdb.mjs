#!/usr/bin/env node
// fine.vdb -> fine.nvdb through @pmndrs/vdb/tools: parseVdb -> leaves (+ expanded active tiles) -> vdbQuantize('fp8') -> writeNvdb.
//
//   node scripts/vdb/vdb-to-nvdb.mjs fine.vdb fine.nvdb [--grid profile] [--float] [--check-u8 fine.u8 --dims NX NY NZ]
//   node scripts/vdb/vdb-to-nvdb.mjs --decode fine.nvdb dense.u8 --dims NX NY NZ     (decode an existing .nvdb to the dense uint8 lattice)
//
// Default output is an Fp8 fog-volume grid (codec NONE). --check-u8 compares the written .nvdb, read back through
// NvdbFile + vdbReadValueCpu, against a dense uint8 lattice (x fastest, then y, then z; value = round(v * 255))
// over [0, NX) x [0, NY) x [0, NZ) VDB index space, and also requires that nothing is active outside that box.
// Exit code 0 only if every voxel matches. Prints one JSON line with sizes and the parity result.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  NvdbFile, parseVdb, vdbBuildFromLeavesDetailed, vdbQuantizeDetailed, vdbReadValueCpu, writeNvdb, VDB_FLOAT_LEAF_CODEC,
} from '@pmndrs/vdb/tools';

/**
 * Float NanoVDB image of a parsed grid with active constant tiles (Houdini writes uniform 8^3 blocks of 1.0 as tiles) expanded to full
 * leaves, so the file keeps leaf topology (upstream buildFromVdb writes them as NanoVDB tiles). Inactive tiles must equal the background.
 */
function buildFromVdbExpandedTiles(grid) {
  const m = grid.transform.matrix;
  function* leaves() {
    yield* grid.iterLeaves();
    for (const t of grid.iterInactiveTiles()) {
      if (t.value !== grid.background) throw new Error(`inactive tile at ${t.origin} holds ${t.value}, background is ${grid.background}`);
    }
    for (const t of grid.iterTiles()) {
      for (let x = 0; x < t.dim; x += 8) for (let y = 0; y < t.dim; y += 8) for (let z = 0; z < t.dim; z += 8) {
        yield { origin: [t.origin[0] + x, t.origin[1] + y, t.origin[2] + z], values: new Float32Array(512).fill(t.value), valueMask: new Uint32Array(16).fill(0xffffffff) };
      }
    }
  }
  return vdbBuildFromLeavesDetailed(leaves(), VDB_FLOAT_LEAF_CODEC, {
    voxelSize: grid.transform.voxelSize[0], worldOrigin: [m[3], m[7], m[11]], background: grid.background,
    gridName: grid.name ?? 'grid', gridClass: 'FogVolume', collapse: false,
  });
}

function parseArgs(argv) {
  const a = { grid: null, fp8: true, checkU8: null, dims: null, pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--grid') a.grid = argv[++i];
    else if (t === '--fp8') a.fp8 = true;
    else if (t === '--decode') a.decode = true;
    else if (t === '--float') a.fp8 = false;
    else if (t === '--check-u8') a.checkU8 = argv[++i];
    else if (t === '--dims') a.dims = [Number(argv[++i]), Number(argv[++i]), Number(argv[++i])];
    else if (t.startsWith('--')) throw new Error(`unknown option ${t}`);
    else a.pos.push(t);
  }
  if (a.decode && !a.dims) throw new Error('--decode needs --dims NX NY NZ');
  if (a.pos.length !== 2) throw new Error('usage: vdb-to-nvdb.mjs IN.vdb OUT.nvdb [--grid NAME] [--float] [--check-u8 FILE --dims NX NY NZ]');
  if (a.checkU8 && !a.dims) throw new Error('--check-u8 needs --dims NX NY NZ');
  return a;
}

const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

/** Decode `nvdbPath` and compare with the dense uint8 lattice. Returns { voxels, mismatches, activeOutside, firstMismatch }. */
export function checkAgainstLattice(nvdbPath, u8Path, dims) {
  const [nx, ny, nz] = dims;
  const u8 = readFileSync(u8Path);
  if (u8.length !== nx * ny * nz) throw new Error(`${u8Path}: ${u8.length} bytes, expected ${nx * ny * nz}`);
  const file = NvdbFile.fromArrayBuffer(toArrayBuffer(readFileSync(nvdbPath)));
  const img = file.gridImage(0);
  let mismatches = 0;
  let firstMismatch = null;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      const row = nx * (y + ny * z);
      for (let x = 0; x < nx; x++) {
        const got = Math.round(vdbReadValueCpu(img, [x, y, z]).value * 255);
        if (got !== u8[row + x]) {
          mismatches++;
          firstMismatch ??= { ijk: [x, y, z], expected: u8[row + x], got };
        }
      }
    }
  }
  // Nothing may be stored outside the lattice box (the voxels just outside must read as background 0).
  let activeOutside = 0;
  for (const ijk of [[-1, 0, 0], [nx, 0, 0], [0, -1, 0], [0, ny, 0], [0, 0, -1], [0, 0, nz]]) {
    const r = vdbReadValueCpu(img, ijk);
    if (r.value !== 0) activeOutside++;
  }
  return { voxels: nx * ny * nz, mismatches, activeOutside, firstMismatch };
}

/** Decode a .nvdb to a dense uint8 lattice (x fastest, then y, then z) over [0,NX) x [0,NY) x [0,NZ). */
export function decodeToU8(nvdbPath, dims) {
  const [nx, ny, nz] = dims;
  const file = NvdbFile.fromArrayBuffer(toArrayBuffer(readFileSync(nvdbPath)));
  const img = file.gridImage(0);
  const u8 = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    u8[x + nx * (y + ny * z)] = Math.round(vdbReadValueCpu(img, [x, y, z]).value * 255);
  }
  return u8;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.decode) {
    writeFileSync(a.pos[1], decodeToU8(a.pos[0], a.dims));
    console.log(JSON.stringify({ decoded: a.pos[0], out: a.pos[1], dims: a.dims }));
    return;
  }
  const [inPath, outPath] = a.pos;
  const t0 = performance.now();
  const vdb = parseVdb(toArrayBuffer(readFileSync(inPath)));
  const grid = a.grid ? vdb.grids.find((g) => g.name === a.grid) : vdb.grids[0];
  if (!grid) throw new Error(`grid ${a.grid ?? '(first)'} not found; have: ${vdb.grids.map((g) => g.name).join(', ')}`);
  // Houdini stores uniform 8^3 blocks as active constant tiles; buildFromVdbTiled expands them to leaves (plain buildFromVdb would drop them).
  const floatImage = buildFromVdbExpandedTiles(grid).image;
  const built = a.fp8 ? vdbQuantizeDetailed(floatImage, 'fp8') : null;
  const image = built ? built.image : floatImage;
  const nvdb = writeNvdb([image]);
  writeFileSync(outPath, new Uint8Array(nvdb));
  const out = {
    in: inPath, out: outPath, grid: grid.name, codec: 'none', gridType: a.fp8 ? 'Fp8' : 'Float',
    tiles: [...grid.iterTiles()].length + [...grid.iterInactiveTiles()].length, activeVoxels: Number(grid.activeVoxelCount), indexBBox: grid.indexBBox, voxelSize: grid.transform.voxelSize[0],
    nodeCounts: built ? built.nodeCounts : null, floatImageBytes: floatImage.byteLength, imageBytes: image.byteLength, fileBytes: nvdb.byteLength,
    seconds: Number(((performance.now() - t0) / 1000).toFixed(2)),
  };
  if (a.checkU8) {
    const t1 = performance.now();
    out.parity = checkAgainstLattice(outPath, a.checkU8, a.dims);
    out.parity.seconds = Number(((performance.now() - t1) / 1000).toFixed(2));
    out.parity.exact = out.parity.mismatches === 0 && out.parity.activeOutside === 0;
  }
  console.log(JSON.stringify(out));
  if (out.parity && !out.parity.exact) process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(`vdb-to-nvdb: ${e.message}`); process.exit(1); });
}
