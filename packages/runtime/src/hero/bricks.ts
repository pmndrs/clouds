/**
 * CPU brick packer for the fine hero overlay (work/specs/P8-hero-vdb.md section 4.1). Turns a dense fine lattice into the brick pool
 * (rgba8, bricks of 10^3 texels: 8^3 payload + a one-voxel apron, 32 x 32 bricks per slab) and the indirection grid (one r32uint per
 * 8^3 fine voxels: the brick slot, or HERO_EMPTY).
 *
 * The lattice covers the whole volume on the fine grid (texture axes x, map row, up; x fastest). Aprons and the payload past the
 * lattice's last voxel are filled from the lattice clamped to its edge, which is what a dense texture's clamp-to-edge filtering
 * reads at the volume faces, so sampling through the pool equals the dense trilinear (the H1 ramp test).
 */
export const HERO_EMPTY = 0xffffffff;
export const BRICK_VOXELS = 8;
export const BRICK_TEXELS = 10;
export const POOL_BRICKS_XY = 32;
export const POOL_SLAB_BRICKS = POOL_BRICKS_XY * POOL_BRICKS_XY;
export const POOL_XY = POOL_BRICKS_XY * BRICK_TEXELS;
/** Bytes of one slab (320 x 320 x 10 rgba8 = 4 MB). */
export const POOL_SLAB_BYTES = POOL_XY * POOL_XY * BRICK_TEXELS * 4;

export interface FineBricks {
  /** Fine voxel size in metres. */
  fineVoxel: number;
  /** Indirection grid size: ceil(fine dims / 8). */
  cells: [number, number, number];
  /** Brick slot per cell (x fastest), HERO_EMPTY where the cell has no brick. */
  indir: Uint32Array<ArrayBuffer>;
  /** Bricks in the pool. */
  count: number;
  /** The pool, one 4 MB slab per 1,024 bricks: slab-local texel (x, y, z) at ((z * 320 + y) * 320 + x) * 4. */
  slabs: Uint8Array<ArrayBuffer>[];
}

export interface PackFineOptions {
  /**
   * A cell gets a brick when any fine voxel within `margin` voxels of it (payload plus that border) has a profile > 0. Default 1 (the
   * apron: every cell whose samples could read a non-zero voxel). Cells without a brick fall back to the coarse field, so callers whose
   * coarse field is a reduction of this lattice pass ceil(1.5 * coarse / fine) to keep its filtered halo out of empty cells.
   */
  margin?: number;
  /** Give every cell a brick (cost and seam tests). */
  all?: boolean;
  /** Return only these cells' bricks: `keep(cellIndex)` false leaves the cell empty (tests). */
  keep?: (cell: number) => boolean;
}

/** Pack a dense fine lattice (`rgba`, dims in texture axes, R = profile, G/B as in the NVDF) into bricks. */
export function packFineBricks(rgba: Uint8Array, dims: readonly [number, number, number], fineVoxel: number, options: PackFineOptions = {}): FineBricks {
  const [nx, ny, nz] = dims;
  if (rgba.length < nx * ny * nz * 4) throw new Error(`packFineBricks: lattice has ${rgba.length} bytes, dims need ${nx * ny * nz * 4}`);
  const cells: [number, number, number] = [Math.ceil(nx / 8), Math.ceil(ny / 8), Math.ceil(nz / 8)];
  const [cx, cy, cz] = cells;
  const nCells = cx * cy * cz;
  const used = new Uint8Array(nCells);
  if (options.all) used.fill(1);
  else {
    const m = options.margin ?? 1;
    // Cells c with 8c - m <= i < 8c + 8 + m, per axis.
    const range = (n: number, cn: number) => {
      const lo = new Int32Array(n), hi = new Int32Array(n);
      for (let i = 0; i < n; i++) { lo[i] = Math.max(0, Math.ceil((i - 7 - m) / 8)); hi[i] = Math.min(cn - 1, Math.floor((i + m) / 8)); }
      return [lo, hi];
    };
    const [xl, xh] = range(nx, cx), [yl, yh] = range(ny, cy), [zl, zh] = range(nz, cz);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
      const row = (z * ny + y) * nx;
      for (let x = 0; x < nx; x++) {
        if (!rgba[(row + x) * 4]) continue;
        for (let c2 = zl[z]; c2 <= zh[z]; c2++) for (let c1 = yl[y]; c1 <= yh[y]; c1++) for (let c0 = xl[x]; c0 <= xh[x]; c0++) used[(c2 * cy + c1) * cx + c0] = 1;
      }
    }
  }
  const indir = new Uint32Array(nCells).fill(HERO_EMPTY);
  let count = 0;
  for (let i = 0; i < nCells; i++) if (used[i] && (!options.keep || options.keep(i))) indir[i] = count++;
  const slabCount = Math.ceil(count / POOL_SLAB_BRICKS);
  if (slabCount * BRICK_TEXELS > 2048) throw new Error(`packFineBricks: ${count} bricks need ${slabCount} slabs, over the 3D texture depth limit (204)`);
  const slabs = Array.from({ length: slabCount }, () => new Uint8Array(POOL_SLAB_BYTES));
  // Clamped lattice index per brick texel, per axis: texel t of cell c reads fine voxel clamp(8c - 1 + t).
  const clampIdx = (c: number, n: number, out: Int32Array) => { for (let t = 0; t < BRICK_TEXELS; t++) out[t] = Math.min(n - 1, Math.max(0, c * 8 - 1 + t)); };
  const ix = new Int32Array(BRICK_TEXELS), iy = new Int32Array(BRICK_TEXELS), iz = new Int32Array(BRICK_TEXELS);
  const src = new Uint32Array(rgba.buffer, rgba.byteOffset, (rgba.byteOffset & 3) === 0 ? nx * ny * nz : 0);
  for (let c2 = 0; c2 < cz; c2++) for (let c1 = 0; c1 < cy; c1++) for (let c0 = 0; c0 < cx; c0++) {
    const s = indir[(c2 * cy + c1) * cx + c0];
    if (s === HERO_EMPTY) continue;
    clampIdx(c0, nx, ix); clampIdx(c1, ny, iy); clampIdx(c2, nz, iz);
    const slab = slabs[Math.floor(s / POOL_SLAB_BRICKS)];
    const dst = new Uint32Array(slab.buffer);
    const bx = (s % POOL_BRICKS_XY) * BRICK_TEXELS, by = (Math.floor(s / POOL_BRICKS_XY) % POOL_BRICKS_XY) * BRICK_TEXELS;
    for (let tz = 0; tz < BRICK_TEXELS; tz++) for (let ty = 0; ty < BRICK_TEXELS; ty++) {
      const srcRow = (iz[tz] * ny + iy[ty]) * nx, dstRow = (tz * POOL_XY + by + ty) * POOL_XY + bx;
      if (src.length) for (let tx = 0; tx < BRICK_TEXELS; tx++) dst[dstRow + tx] = src[srcRow + ix[tx]];
      else for (let tx = 0; tx < BRICK_TEXELS; tx++) slab.set(rgba.subarray((srcRow + ix[tx]) * 4, (srcRow + ix[tx]) * 4 + 4), (dstRow + tx) * 4);
    }
  }
  return { fineVoxel, cells, indir, count, slabs };
}

/**
 * The coarse lattice of a fine one by the P8 reduction rule (spec section 4.3): R = mean of the `ratio`^3 fine profiles, at least 1/255 when
 * any of them is > 0 (so coarse occupancy covers the fine one and the coarse SDF stays a lower bound); G and B are the plain means.
 * Fine dims are padded up to a multiple of `ratio` with zeros.
 */
export function reduceFineLattice(rgba: Uint8Array, dims: readonly [number, number, number], ratio: number): { rgba: Uint8Array<ArrayBuffer>; dims: [number, number, number] } {
  const [nx, ny, nz] = dims;
  const out: [number, number, number] = [Math.ceil(nx / ratio), Math.ceil(ny / ratio), Math.ceil(nz / ratio)];
  const res = new Uint8Array(out[0] * out[1] * out[2] * 4);
  const n = ratio ** 3;
  for (let z = 0; z < out[2]; z++) for (let y = 0; y < out[1]; y++) for (let x = 0; x < out[0]; x++) {
    let r = 0, g = 0, b = 0, any = false;
    for (let dz = 0; dz < ratio; dz++) for (let dy = 0; dy < ratio; dy++) for (let dx = 0; dx < ratio; dx++) {
      const fx = x * ratio + dx, fy = y * ratio + dy, fz = z * ratio + dz;
      if (fx >= nx || fy >= ny || fz >= nz) continue;
      const i = ((fz * ny + fy) * nx + fx) * 4;
      r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; if (rgba[i]) any = true;
    }
    const o = ((z * out[1] + y) * out[0] + x) * 4;
    res[o] = any ? Math.max(1, Math.round(r / n)) : 0; res[o + 1] = Math.round(g / n); res[o + 2] = Math.round(b / n); res[o + 3] = 255;
  }
  return { rgba: res, dims: out };
}
