// TypeScript port of the pack-fitted mapping in scripts/vdb/nvdf_math.py (P4-B): profile / detail type / density scale from the
// depth below the cloud surface and the height fraction, for artist VDBs that carry only a density field or a level set.
// Constants are the same as the Python PACK_FIT; keep them in sync. Pure math, no GPU, no three.

export const PACK_FIT = {
  profile: { d0: 1.4, D: 66.0, g: 1.05, base: 0.1, baseH: 0.22, sigma: 0.64, corrVox: 3.0 },
  detail: { lo: 0.1, hi: 0.75, depthShift: 0.25, depthRef: 32.0 },
  scale: { s0: 0.04, s1: 0.75, h1: 0.6 },
} as const;

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / Math.max(e1 - e0, 1e-9));
  return t * t * (3 - 2 * t);
}

/** Fitted Nubis profile: sat((d_eff - d0) / D)^g * baseLift(h), d_eff = depth * exp(sigma * noise). */
export function packProfile(depth: number, hfrac: number, noise: number): number {
  const q = PACK_FIT.profile;
  const dEff = Math.max(depth, 0) * Math.exp(q.sigma * noise);
  const core = Math.pow(clamp01((dEff - q.d0) / q.D), q.g);
  const lift = q.base + (1 - q.base) * smoothstep(0, q.baseH, hfrac);
  return core * lift;
}

/** Detail type: wispy at the cloud base, billowy at the top; deeper voxels read a little more wispy. */
export function packDetail(depth: number, hfrac: number): number {
  const q = PACK_FIT.detail;
  return smoothstep(q.lo, q.hi, hfrac - q.depthShift * clamp01(depth / q.depthRef));
}

/** Density scale rising with height: thin sheets at the base, dense towers at the top. */
export function packScale(hfrac: number): number {
  const q = PACK_FIT.scale;
  return q.s0 + (q.s1 - q.s0) * smoothstep(0, q.h1, hfrac);
}

/** float -> unorm8 as nvdf_math.quantize_unorm8: floor(x * 255 + 0.5), clamped. */
export function quantizeUnorm8(x: number): number {
  const v = Math.floor(x * 255 + 0.5);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Per-slice height fraction 0..1 over the occupied slice range of the mask (texture z). `mask` is x-fastest, dims (nx, ny, nz). */
export function heightFractions(mask: ArrayLike<number>, dims: readonly [number, number, number]): Float32Array {
  const [nx, ny, nz] = dims, layer = nx * ny;
  const occupied = (z: number): boolean => {
    for (let i = z * layer, e = i + layer; i < e; i++) if (mask[i]) return true;
    return false;
  };
  let z0 = -1, z1 = -1;
  for (let z = 0; z < nz; z++) if (occupied(z)) { z0 = z; break; }
  for (let z = nz - 1; z >= 0; z--) if (occupied(z)) { z1 = z; break; }
  if (z0 < 0) { z0 = 0; z1 = nz - 1; }
  const out = new Float32Array(nz);
  for (let z = 0; z < nz; z++) out[z] = clamp01((z - z0) / Math.max(z1 - z0, 1));
  return out;
}

/** Separable gaussian blur, kernel truncated at 4 sigma and renormalised at the edges. x-fastest, dims (nx, ny, nz). */
export function gaussianBlur(a: Float32Array, dims: readonly [number, number, number], sigma: number): Float32Array {
  if (sigma <= 0) return a;
  const radius = Math.max(1, Math.ceil(4 * sigma));
  const kernel = new Float64Array(radius + 1);
  for (let i = 0; i <= radius; i++) kernel[i] = Math.exp(-0.5 * (i / sigma) ** 2);
  let norm = kernel[0];
  for (let i = 1; i <= radius; i++) norm += 2 * kernel[i];
  const kernelN = kernel.map(w => w / norm);
  const [nx, ny, nz] = dims;
  let src = a;
  const axes: [number, number, number][] = [[1, nx, ny * nz], [nx, ny, nx * nz], [nx * ny, nz, nx * ny]]; // stride, length, line count (by axis)
  for (let axis = 0; axis < 3; axis++) {
    const dst = new Float32Array(a.length);
    const [stride, n] = axes[axis];
    // iterate every line along the axis
    const outerA = axis === 0 ? ny * nz : axis === 1 ? nx * nz : nx * ny;
    for (let line = 0; line < outerA; line++) {
      let base: number;
      if (axis === 0) base = line * nx;
      else if (axis === 1) { const x = line % nx, z = Math.floor(line / nx); base = z * nx * ny + x; }
      else base = line; // x + y*nx, z = 0
      const first = Math.min(radius, n), last = Math.max(first, n - radius);
      for (let i = 0; i < n; i++) {
        if (i >= first && i < last) { // interior: the full kernel fits, weights are pre-normalised
          let sum = kernelN[0] * src[base + i * stride];
          for (let j = 1; j <= radius; j++) sum += kernelN[j] * (src[base + (i - j) * stride] + src[base + (i + j) * stride]);
          dst[base + i * stride] = sum;
          continue;
        }
        let sum = 0, wsum = 0;
        const lo = Math.max(0, i - radius), hi = Math.min(n - 1, i + radius);
        for (let j = lo; j <= hi; j++) { const w = kernel[Math.abs(j - i)]; sum += w * src[base + j * stride]; wsum += w; }
        dst[base + i * stride] = sum / wsum;
      }
    }
    src = dst;
  }
  return src;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic zero-mean unit-variance low-frequency noise (gaussian-blurred white noise), the same construction as
 * nvdf_math.smooth_noise. The generator differs (numpy PCG64 there, mulberry32 + Box-Muller here), so values differ for a seed;
 * the statistics match.
 */
export function smoothNoise(dims: readonly [number, number, number], corrVox: number, seed = 1): Float32Array {
  const n = dims[0] * dims[1] * dims[2];
  const rnd = mulberry32(seed * 2654435761 + 12345);
  const white = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u = Math.max(rnd(), 1e-12), v = rnd(), r = Math.sqrt(-2 * Math.log(u));
    white[i] = r * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) white[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  const b = gaussianBlur(white, dims, corrVox);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += b[i];
  mean /= n;
  let varSum = 0;
  for (let i = 0; i < n; i++) varSum += (b[i] - mean) ** 2;
  const inv = 1 / Math.max(Math.sqrt(varSum / n), 1e-9);
  for (let i = 0; i < n; i++) b[i] = (b[i] - mean) * inv;
  return b;
}
