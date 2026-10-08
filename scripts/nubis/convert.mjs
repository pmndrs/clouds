#!/usr/bin/env node
// Nubis voxel cloud pack converter. Deterministic; no dependencies.
//   node scripts/nubis/convert.mjs [--pack <full-pack-dir>] [--no-check]
// Writes assets/clouds/{parkouring,stormbird,noise}/. See assets/clouds/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeTga } from './tga.mjs';
import {
  GRID, VOXEL_M, MARGIN, SDF_MIN, SDF_MAX, encodeSdfR16, decodeSdfR16, occupiedBounds, cropVolume, profileSdf, mipChain,
} from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(root, 'assets/nubis-voxel-clouds');
const OUT = path.join(root, 'assets/clouds');
const DEFAULT_PACK = '/Users/dex/Developer/WebGPUClouds/artifacts/research/nubis-pack/extracted/Nubis Voxel Clouds Pack';
const CLOUDS = [
  { id: 'parkouring', dir: 'ParkouringCloud' },
  { id: 'stormbird', dir: 'StormbirdCloud' },
];
const num = (i) => String(i).padStart(3, '0');

function loadSlices(dir, pattern, count, w, h) {
  const vol = new Uint8Array(w * h * count * 4);
  for (let i = 0; i < count; i++) {
    const t = decodeTga(fs.readFileSync(path.join(dir, pattern.replace('%', num(i + 1)))));
    if (t.width !== w || t.height !== h) throw new Error(`unexpected slice size ${t.width}x${t.height}`);
    vol.set(t.data, i * w * h * 4);
  }
  return vol;
}
const write = (p, data) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
};

function convertCloud({ id, dir }) {
  const [nx, ny, nz] = GRID;
  const nvdf = loadSlices(path.join(SRC, 'NVDFs/Examples', dir, 'TGA'), 'modeling_data.%.tga', nz, nx, ny);
  const b = occupiedBounds(nvdf, GRID, MARGIN);
  const sdf = profileSdf(nvdf, GRID, VOXEL_M);
  const nvdfCrop = cropVolume(nvdf, GRID, 4, b.cropMin, b.cropDims);
  const sdfCrop = cropVolume(encodeSdfR16(sdf), GRID, 1, b.cropMin, b.cropDims);
  const outDir = path.join(OUT, id);
  write(path.join(outDir, 'nvdf.bin'), nvdfCrop);
  write(path.join(outDir, 'sdf.bin'), new Uint8Array(sdfCrop.buffer, sdfCrop.byteOffset, sdfCrop.byteLength));
  const [cx, cy, cz] = b.cropDims;
  const meta = {
    name: id,
    source: `assets/nubis-voxel-clouds/NVDFs/Examples/${dir}/TGA/modeling_data.*.tga`,
    dims: b.cropDims,
    voxelSizeMeters: VOXEL_M,
    layout: 'x fastest, then y (map row, +Y = up in the source image), then z (slice, up); texel (x,y,z) at ((z*dims[1]+y)*dims[0]+x)',
    sourceGrid: GRID,
    cropOffset: b.cropMin,
    occupiedMin: b.occupiedMin,
    occupiedMax: b.occupiedMax,
    margin: MARGIN,
    boundsMeters: {
      note: 'source axes: x = map column, y = map row, z = up; origin = corner of source grid voxel (0,0,0)',
      min: b.cropMin.map((v) => v * VOXEL_M),
      max: b.cropMin.map((v, i) => (v + b.cropDims[i]) * VOXEL_M),
      size: b.cropDims.map((v) => v * VOXEL_M),
    },
    nvdf: {
      file: 'nvdf.bin', format: 'rgba8unorm', bytes: nvdfCrop.byteLength,
      channels: { r: 'dimensional profile (0 none, 1 full cloud)', g: 'detail type (0 wispy, 1 billowy)', b: 'density scale', a: 'unused' },
    },
    sdf: {
      file: 'sdf.bin', format: 'r16unorm little-endian', bytes: sdfCrop.byteLength,
      encoding: { minMeters: SDF_MIN, maxMeters: SDF_MAX, decode: 'meters = minMeters + v * (maxMeters - minMeters)', rounding: 'down' },
      source: 'exact 3D EDT of (profile > 0), full 512x512x64 grid, signed (negative inside), surface at half a voxel from the nearest centres',
      outsideCrop: 'treat as far / empty (distance >= margin*voxel from the occupied bounds, except at the grid floor/ceiling where the grid ends)',
    },
  };
  fs.writeFileSync(path.join(outDir, 'cloud.json'), JSON.stringify(meta, null, 2) + '\n');
  return { id, nvdf, sdf, meta, bytes: nvdfCrop.byteLength + sdfCrop.byteLength };
}

function convertNoise() {
  const n = 128;
  const vol = loadSlices(path.join(SRC, 'Noise/Examples/TGA'), 'NubisVoxelCloudNoise.%.tga', n, n, n);
  const chain = mipChain(vol, [n, n, n]);
  const total = chain.reduce((s, m) => s + m.data.length, 0);
  const all = new Uint8Array(total);
  let off = 0;
  const mips = chain.map((m) => { all.set(m.data, off); const e = { dims: m.dims, byteOffset: off, bytes: m.data.length }; off += m.data.length; return e; });
  const outDir = path.join(OUT, 'noise');
  write(path.join(outDir, 'noise.bin'), all);
  fs.writeFileSync(path.join(outDir, 'noise.json'), JSON.stringify({
    name: 'nubis-voxel-cloud-noise',
    source: 'assets/nubis-voxel-clouds/Noise/Examples/TGA/NubisVoxelCloudNoise.*.tga',
    dims: [n, n, n], format: 'rgba8unorm', mipLevels: mips.length,
    layout: 'mip0..mipN concatenated; each mip x fastest, then y, then z (slice index - 1, up); 2x2x2 box filter with wrap',
    mips, bytes: total,
    tilingMeters: 100,
    channels: { r: 'low-frequency Curly-Alligator (wispy)', g: 'high-frequency Curly-Alligator', b: 'low-frequency Alligator (billowy)', a: 'high-frequency Alligator' },
  }, null, 2) + '\n');
  return total;
}

// Voxel-size check against the pack's 8-bit field_data SDF (R: 0..1 -> -256..4096 m).
function checkAgainstPack(packDir, c, own) {
  const dir = path.join(packDir, 'NVDFs/Examples', c.dir, 'TGA');
  const [nx, ny, nz] = GRID;
  const pk = loadSlices(dir, 'field_data.%.tga', nz, nx, ny);
  const sdf = own.sdf; // full-grid float metres before encoding; recompute via decode of quantised value
  const diffs = [];
  let far = 0, signBad = 0, signBadFloor = 0;
  const q = (SDF_MAX - SDF_MIN) / 255;
  for (let i = 0; i < nx * ny * nz; i++) {
    const p = SDF_MIN + (pk[i * 4] / 255) * (SDF_MAX - SDF_MIN);
    if (Math.abs(p) >= 200) continue;
    diffs.push(Math.abs(sdf[i] - p));
    if (Math.abs(sdf[i]) > q) {
      far++;
      if ((sdf[i] < 0) !== (p < 0)) { signBad++; if (((i / (nx * ny)) | 0) < 2) signBadFloor++; }
    }
  }
  diffs.sort((a, b) => a - b);
  return { samples: diffs.length, median: diffs[diffs.length >> 1], p90: diffs[Math.floor(diffs.length * 0.9)], beyondQuantum: far, signMismatch: signBad, signMismatchAtGridFloor: signBadFloor, quantum: q };
}

const args = process.argv.slice(2);
const t0 = Date.now();
const results = CLOUDS.map(convertCloud);
const noiseBytes = convertNoise();
for (const r of results) console.log(`${r.id}: dims ${r.meta.dims.join('x')} offset ${r.meta.cropOffset.join(',')} -> ${r.bytes} bytes`);
console.log(`noise: ${noiseBytes} bytes`);
if (!args.includes('--no-check')) {
  const pi = args.indexOf('--pack');
  const pack = pi >= 0 ? args[pi + 1] : DEFAULT_PACK;
  if (fs.existsSync(pack)) {
    for (let i = 0; i < CLOUDS.length; i++) {
      // r.sdf is full-grid metres (float) from the EDT
      const c = checkAgainstPack(pack, CLOUDS[i], results[i]);
      console.log(`check ${CLOUDS[i].id} @${VOXEL_M} m: n=${c.samples} median|d|=${c.median.toFixed(2)} m p90=${c.p90.toFixed(2)} m, sign mismatch ${c.signMismatch}/${c.beyondQuantum} (beyond one ${c.quantum.toFixed(1)} m quantum; ${c.signMismatchAtGridFloor} on z<2)`);
    }
  } else console.log('full pack not found; skipping voxel-size check');
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
