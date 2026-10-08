// IEEE 754 binary16 conversion for GPU uploads.

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** Round-to-nearest-even float32 → float16 bits. */
export function toHalfBits(value: number): number {
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  let e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - e;
    let half = mant >>> shift;
    const rem = mant & ((1 << shift) - 1), mid = 1 << (shift - 1);
    if (rem > mid || (rem === mid && (half & 1))) half++;
    return sign | half;
  }
  let half = (e << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (half & 1))) half++;
  return sign | half;
}

export function fromHalfBits(h: number): number {
  const sign = h & 0x8000 ? -1 : 1, exp = (h >>> 10) & 0x1f, mant = h & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

/** float32 → float16 bits whose value is never greater than the input (conservative distances). */
export function toHalfBitsRoundDown(value: number): number {
  let h = toHalfBits(value);
  if (fromHalfBits(h) > value) {
    // step one ulp toward -infinity
    if (h === 0x0000) h = 0x8001;
    else if (h & 0x8000) h++;
    else h--;
  }
  return h;
}
