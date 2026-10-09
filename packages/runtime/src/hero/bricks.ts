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
  const used = options.all ? new Uint8Array(nCells).fill(1) : markCells(rgba, 4, dims, cells, options.margin ?? 1);
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

/** Cells (x fastest) with a voxel of `data[i * stride] > 0` within `m` voxels of their 8^3 payload: 8c - m <= i < 8c + 8 + m per axis. */
function markCells(data: Uint8Array, stride: number, dims: readonly [number, number, number], cells: readonly [number, number, number], m: number): Uint8Array {
  const [nx, ny, nz] = dims, [cx, cy, cz] = cells;
  const used = new Uint8Array(cx * cy * cz);
  const lo = (i: number) => Math.max(0, Math.ceil((i - 7 - m) / 8)), hi = (i: number, cn: number) => Math.min(cn - 1, Math.floor((i + m) / 8));
  // Per row (y, z): the x cells its set voxels reach, then OR that row mask into the (y, z) cell rows the row reaches.
  const xm = new Uint8Array(cx);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    const row = (z * ny + y) * nx;
    let any = false, last = -1;
    for (let x = 0; x < nx; x++) {
      if (!data[(row + x) * stride]) continue;
      if (!any) { xm.fill(0); any = true; }
      // Cells for x; a run of set voxels marks lo(first)..hi(last), so only the run ends matter.
      if (x !== last + 1) for (let c = lo(x); c <= hi(x, cx); c++) xm[c] = 1;
      else xm[hi(x, cx)] = 1;
      last = x;
    }
    if (!any) continue;
    for (let c2 = lo(z); c2 <= hi(z, cz); c2++) for (let c1 = lo(y); c1 <= hi(y, cy); c1++) {
      const o = (c2 * cy + c1) * cx;
      for (let c0 = 0; c0 < cx; c0++) used[o + c0] |= xm[c0];
    }
  }
  return used;
}

/**
 * A fine profile packed into bricks, R only (P13-H3): the loaders' form. `profile` holds 1,000 bytes per brick (texel (tx, ty, tz) at
 * tx + 10 ty + 100 tz, payload plus apron, clamped at the lattice faces like `packFineBricks`), `cellOf` each brick's cell index. G and B
 * are filled on the GPU from the coarse NVDF at upload (`uploadFineProfile`), so the CPU never touches four bytes per texel.
 */
export interface FineProfileBricks {
  fineVoxel: number;
  /** Fine lattice dims, texture axes. */
  dims: [number, number, number];
  cells: [number, number, number];
  indir: Uint32Array<ArrayBuffer>;
  count: number;
  profile: Uint8Array<ArrayBuffer>;
  cellOf: Uint32Array<ArrayBuffer>;
}

/**
 * Pack a dense fine profile lattice (uint8, texture axes, x fastest) into R-only bricks. A cell gets a brick when a set voxel lies within
 * `margin` voxels of it; loaders pass ceil(1.5 * coarse / fine) (3 at 4 m under 8 m) so the coarse field's filtered halo never shows in an
 * empty cell next to a brick (P13-H1 note).
 */
export function packFineProfile(profile: Uint8Array, dims: readonly [number, number, number], fineVoxel: number, margin = 1): FineProfileBricks {
  const [nx, ny, nz] = dims;
  if (profile.length < nx * ny * nz) throw new Error(`packFineProfile: lattice has ${profile.length} bytes, dims need ${nx * ny * nz}`);
  const cells: [number, number, number] = [Math.ceil(nx / 8), Math.ceil(ny / 8), Math.ceil(nz / 8)];
  const [cx, cy, cz] = cells;
  const used = markCells(profile, 1, dims, cells, margin);
  const indir = new Uint32Array(cx * cy * cz).fill(HERO_EMPTY);
  let count = 0;
  for (let i = 0; i < used.length; i++) if (used[i]) indir[i] = count++;
  if (count > POOL_SLAB_BRICKS * 204) throw new Error(`packFineProfile: ${count} bricks, over the pool limit (204 slabs)`);
  const out = new Uint8Array(count * 1000), cellOf = new Uint32Array(count);
  const clampIdx = (c: number, n: number, o: Int32Array) => { for (let t = 0; t < BRICK_TEXELS; t++) o[t] = Math.min(n - 1, Math.max(0, c * 8 - 1 + t)); };
  const ix = new Int32Array(BRICK_TEXELS), iy = new Int32Array(BRICK_TEXELS), iz = new Int32Array(BRICK_TEXELS);
  for (let c2 = 0; c2 < cz; c2++) for (let c1 = 0; c1 < cy; c1++) for (let c0 = 0; c0 < cx; c0++) {
    const cell = (c2 * cy + c1) * cx + c0, s = indir[cell];
    if (s === HERO_EMPTY) continue;
    cellOf[s] = cell;
    clampIdx(c0, nx, ix); clampIdx(c1, ny, iy); clampIdx(c2, nz, iz);
    let o = s * 1000;
    for (let tz = 0; tz < BRICK_TEXELS; tz++) for (let ty = 0; ty < BRICK_TEXELS; ty++) {
      const row = (iz[tz] * ny + iy[ty]) * nx;
      for (let tx = 0; tx < BRICK_TEXELS; tx++) out[o++] = profile[row + ix[tx]];
    }
  }
  return { fineVoxel, dims: [nx, ny, nz], cells, indir, count, profile: out, cellOf };
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
