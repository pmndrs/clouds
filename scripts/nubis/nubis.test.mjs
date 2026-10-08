import { describe, expect, it } from 'vitest';
import { decodeTga, encodeTga } from './tga.mjs';
import { signedDistance, squaredDistanceToMask } from './edt.mjs';
import { encodeSdfR16, decodeSdfR16, occupiedBounds, cropVolume, mipChain } from './lib.mjs';

function image(w, h, f) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
}

describe('tga', () => {
  const img = image(7, 5, (x, y) => [x * 30, y * 50, (x + y) % 3 === 0 ? 255 : 7, x === y ? 255 : 9]);
  it('round-trips raw', () => {
    const d = decodeTga(encodeTga(img, { rle: false }));
    expect([d.width, d.height]).toEqual([7, 5]);
    expect(Array.from(d.data)).toEqual(Array.from(img.data));
  });
  it('round-trips RLE with runs and literals', () => {
    const flat = image(300, 2, (x, y) => (x < 200 ? [10, 20, 30, 255] : [x & 255, y, 1, 2]));
    const d = decodeTga(encodeTga(flat, { rle: true }));
    expect(Array.from(d.data)).toEqual(Array.from(flat.data));
  });
  it('flips top-left-origin files to bottom-up rows', () => {
    const raw = encodeTga(img, { rle: false });
    // Reverse row order in the file and set the top-left bit: same image.
    const body = raw.subarray(18);
    const rows = [];
    for (let y = 0; y < 5; y++) rows.push(body.subarray(y * 28, (y + 1) * 28));
    const out = new Uint8Array(raw.length);
    out.set(raw.subarray(0, 18));
    rows.reverse().forEach((r, i) => out.set(r, 18 + i * 28));
    out[17] = 0x20;
    expect(Array.from(decodeTga(out).data)).toEqual(Array.from(img.data));
  });
  it('rejects truncated RLE', () => {
    const e = encodeTga(image(8, 8, () => [1, 2, 3, 4]), { rle: true });
    expect(() => decodeTga(e.subarray(0, 20))).toThrow();
  });
});

describe('edt', () => {
  it('matches brute force on random mask (anisotropic)', () => {
    const dims = [9, 7, 5], vox = [1, 2, 3];
    let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const mask = new Uint8Array(9 * 7 * 5).map(() => (rnd() < 0.08 ? 1 : 0));
    const pts = []; mask.forEach((m, i) => m && pts.push([i % 9, ((i / 9) | 0) % 7, (i / 63) | 0]));
    const d2 = squaredDistanceToMask(mask, dims, vox);
    for (let i = 0; i < mask.length; i++) {
      const p = [i % 9, ((i / 9) | 0) % 7, (i / 63) | 0];
      let best = Infinity;
      for (const q of pts) best = Math.min(best, ((p[0] - q[0]) * 1) ** 2 + ((p[1] - q[1]) * 2) ** 2 + ((p[2] - q[2]) * 3) ** 2);
      expect(d2[i]).toBeCloseTo(best, 3);
    }
  });
  it('sphere: signed distance within one voxel of analytic, negative inside', () => {
    const n = 48, c = 23.5, r = 14, dims = [n, n, n];
    const mask = new Uint8Array(n ** 3);
    for (let i = 0; i < mask.length; i++) {
      const x = i % n, y = ((i / n) | 0) % n, z = (i / (n * n)) | 0;
      mask[i] = Math.hypot(x - c, y - c, z - c) <= r ? 1 : 0;
    }
    const sdf = signedDistance(mask, dims, [1, 1, 1]);
    let maxErr = 0;
    for (let i = 0; i < mask.length; i++) {
      const x = i % n, y = ((i / n) | 0) % n, z = (i / (n * n)) | 0;
      const ref = Math.hypot(x - c, y - c, z - c) - r;
      maxErr = Math.max(maxErr, Math.abs(sdf[i] - ref));
      if (Math.abs(ref) > 1.5) expect(Math.sign(sdf[i])).toBe(Math.sign(ref));
    }
    expect(maxErr).toBeLessThan(1.1);
  });
  it('box: exact distance to a box (axis faces, corners) with voxel scale', () => {
    const dims = [40, 40, 40], v = 8;
    const mask = new Uint8Array(40 ** 3);
    const lo = 15, hi = 24; // inclusive voxel range of the box
    for (let i = 0; i < mask.length; i++) {
      const x = i % 40, y = ((i / 40) | 0) % 40, z = (i / 1600) | 0;
      mask[i] = x >= lo && x <= hi && y >= lo && y <= hi && z >= lo && z <= hi ? 1 : 0;
    }
    const sdf = signedDistance(mask, dims, [v, v, v]);
    const idx = (x, y, z) => (z * 40 + y) * 40 + x;
    const half = v / 2;
    expect(sdf[idx(hi + 5, 20, 20)]).toBeCloseTo(5 * v - half, 3); // face
    expect(sdf[idx(hi + 3, hi + 4, 20)]).toBeCloseTo(Math.hypot(3, 4) * v - half, 3); // edge
    expect(sdf[idx(hi + 2, hi + 3, hi + 6)]).toBeCloseTo(Math.hypot(2, 3, 6) * v - half, 3); // corner
    expect(sdf[idx(hi, 20, 20)]).toBeCloseTo(-(1 * v - half), 3); // innermost... one voxel from outside
    expect(sdf[idx(20, 20, 20)]).toBeCloseTo(-(Math.min(20 - (lo - 1), hi + 1 - 20) * v - half), 3);
  });
});

describe('lib', () => {
  it('encodes r16 over -256..4096 rounding down', () => {
    const u = encodeSdfR16(new Float32Array([-256, 0, 4096, 5000, -999, 100]));
    expect(u[0]).toBe(0); expect(u[2]).toBe(65535); expect(u[3]).toBe(65535); expect(u[4]).toBe(0);
    const back = decodeSdfR16(u);
    expect(back[1]).toBeLessThanOrEqual(0); expect(0 - back[1]).toBeLessThan(0.07);
    expect(back[5]).toBeLessThanOrEqual(100);
  });
  it('bounds + crop keep the right voxels and clamp the margin', () => {
    const dims = [20, 20, 10];
    const v = new Uint8Array(20 * 20 * 10 * 4);
    const set = (x, y, z) => { v[((z * 20 + y) * 20 + x) * 4] = 255; v[((z * 20 + y) * 20 + x) * 4 + 1] = 77; };
    set(5, 6, 0); set(8, 9, 2);
    const b = occupiedBounds(v, dims, 3);
    expect(b.cropMin).toEqual([2, 3, 0]);
    expect(b.cropMax).toEqual([11, 12, 5]);
    expect(b.cropDims).toEqual([10, 10, 6]);
    const c = cropVolume(v, dims, 4, b.cropMin, b.cropDims);
    expect(c[((0 * 10 + 3) * 10 + 3) * 4 + 1]).toBe(77);
    expect(c[((2 * 10 + 6) * 10 + 6) * 4 + 1]).toBe(77);
  });
  it('mip chain is complete and wraps/averages', () => {
    const n = 4, d = new Uint8Array(n ** 3 * 4);
    for (let i = 0; i < n ** 3; i++) d[i * 4] = i % 2 ? 100 : 0;
    const chain = mipChain(d, [n, n, n]);
    expect(chain.map((m) => m.dims[0])).toEqual([4, 2, 1]);
    expect(chain[1].data[0]).toBe(50);
    expect(chain[2].data[0]).toBe(50);
  });
});
