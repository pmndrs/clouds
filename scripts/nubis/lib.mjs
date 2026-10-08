import { signedDistance } from './edt.mjs';

export const SDF_MIN = -256; // metres, maps to 0
export const SDF_MAX = 4096; // metres, maps to 1
export const GRID = [512, 512, 64];
export const VOXEL_M = 8;
export const MARGIN = 8;

// Encode metres -> r16 unorm over [-256, 4096], rounded down (decoded value never overshoots).
export function encodeSdfR16(sdf) {
  const out = new Uint16Array(sdf.length);
  const k = 65535 / (SDF_MAX - SDF_MIN);
  for (let i = 0; i < sdf.length; i++) {
    const v = Math.floor((sdf[i] - SDF_MIN) * k + 1e-6);
    out[i] = v < 0 ? 0 : v > 65535 ? 65535 : v;
  }
  return out;
}
export function decodeSdfR16(u16) {
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) out[i] = SDF_MIN + (u16[i] / 65535) * (SDF_MAX - SDF_MIN);
  return out;
}

// Occupied bounds (profile > 0) of an RGBA8 volume, grown by `margin` and clamped to the grid.
export function occupiedBounds(rgba, dims, margin = MARGIN) {
  const [nx, ny, nz] = dims;
  const lo = [nx, ny, nz], hi = [-1, -1, -1];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (rgba[((z * ny + y) * nx + x) * 4] > 0) {
      if (x < lo[0]) lo[0] = x; if (x > hi[0]) hi[0] = x;
      if (y < lo[1]) lo[1] = y; if (y > hi[1]) hi[1] = y;
      if (z < lo[2]) lo[2] = z; if (z > hi[2]) hi[2] = z;
    }
  }
  if (hi[0] < 0) throw new Error('empty volume');
  const min = lo.map((v, i) => Math.max(0, v - margin));
  const max = hi.map((v, i) => Math.min(dims[i] - 1, v + margin)); // inclusive
  return { occupiedMin: lo, occupiedMax: hi, cropMin: min, cropMax: max, cropDims: max.map((v, i) => v - min[i] + 1) };
}

export function cropVolume(src, dims, bytesPer, min, cdims) {
  const [nx, ny] = dims;
  const [cx, cy, cz] = cdims;
  const Ctor = src.constructor;
  const out = new Ctor(cx * cy * cz * bytesPer);
  for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) {
    const s = (((z + min[2]) * ny + (y + min[1])) * nx + min[0]) * bytesPer;
    out.set(src.subarray(s, s + cx * bytesPer), ((z * cy + y) * cx) * bytesPer);
  }
  return out;
}

// SDF in metres from profile > 0, computed on the full grid (so the crop sees correct distances).
export function profileSdf(rgba, dims, voxel = VOXEL_M) {
  const n = dims[0] * dims[1] * dims[2];
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = rgba[i * 4] > 0 ? 1 : 0;
  return signedDistance(mask, dims, [voxel, voxel, voxel], SDF_MAX);
}

// Full mip chain of a cubic-or-not RGBA8 volume, 2x2x2 box filter with wrap-around addressing
// (for even sizes this is the plain 8-texel average; odd sizes wrap the +1 neighbour).
// Returns array of {dims, data}. Rounds half up.
export function boxMipWrap(data, dims) {
  const [nx, ny, nz] = dims;
  const dx = Math.max(1, nx >> 1), dy = Math.max(1, ny >> 1), dz = Math.max(1, nz >> 1);
  const out = new Uint8Array(dx * dy * dz * 4);
  for (let z = 0; z < dz; z++) for (let y = 0; y < dy; y++) for (let x = 0; x < dx; x++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const sx = (x * 2 + i) % nx, sy = (y * 2 + j) % ny, sz = (z * 2 + k) % nz;
        sum += data[((sz * ny + sy) * nx + sx) * 4 + c];
      }
      out[((z * dy + y) * dx + x) * 4 + c] = (sum + 4) >> 3;
    }
  }
  return { dims: [dx, dy, dz], data: out };
}
export function mipChain(data, dims) {
  const chain = [{ dims, data }];
  let cur = chain[0];
  while (cur.dims[0] > 1 || cur.dims[1] > 1 || cur.dims[2] > 1) {
    cur = boxMipWrap(cur.data, cur.dims);
    chain.push(cur);
  }
  return chain;
}
