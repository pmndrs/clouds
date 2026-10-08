// Reading a parsed VDB float grid onto a cubic target lattice. No dense copy of the source is made: leaf voxels and constant
// tiles are scattered straight into the (small) target array with the same tent filter as scripts/vdb/nvdf_math.resample_matrix
// (radius max(1, ratio) source voxels, so downsampling area-averages and upsampling is linear; rows normalised).
//
// Axes here are the VDB's own ("hou" axes: X, Y up, Z). Target arrays are laid out (jy * nz + jz) * nx + jx, which is exactly
// the runtime texture order (x fastest, then map row = VDB Z, then slice = VDB Y).
import type { VdbGrid } from '../../vendor/vdb-web-tools/src/index';

export type Vec3 = [number, number, number];

/** Active voxel bounds in VDB index space, max exclusive. */
export interface IndexBounds { min: Vec3; max: Vec3 }

/** Active-voxel bounds of a grid (leaf masks plus active tiles), or null when nothing is active. */
export function activeBounds(grid: VdbGrid): IndexBounds | null {
  const mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const leaf of grid.iterLeaves()) {
    const m = leaf.valueMask;
    for (let w = 0; w < 16; w++) {
      let bits = m[w];
      while (bits) {
        const bit = 31 - Math.clz32(bits & -bits);
        bits &= bits - 1;
        const off = (w << 5) | bit;
        const x = leaf.origin[0] + (off >> 6), y = leaf.origin[1] + ((off >> 3) & 7), z = leaf.origin[2] + (off & 7);
        if (x < mn[0]) mn[0] = x; if (x + 1 > mx[0]) mx[0] = x + 1;
        if (y < mn[1]) mn[1] = y; if (y + 1 > mx[1]) mx[1] = y + 1;
        if (z < mn[2]) mn[2] = z; if (z + 1 > mx[2]) mx[2] = z + 1;
      }
    }
  }
  for (const t of grid.tiles) {
    if (!t.active) continue;
    for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], t.origin[a]); mx[a] = Math.max(mx[a], t.origin[a] + t.size); }
  }
  return mx[0] > mn[0] ? { min: mn, max: mx } : null;
}

/** Target lattice for a source region: ratio = target voxel / source voxel per axis; the lattice is anchored at source index 0. */
export interface LatticePlan {
  /** Source index range [lo, hi) that is read. */
  lo: Vec3; hi: Vec3;
  ratio: Vec3;
  /** Global target index of target element 0, and the element counts, per VDB axis. */
  origin: Vec3; dims: Vec3;
}

export function planLattice(lo: Vec3, hi: Vec3, ratio: Vec3, maxVoxels = 400_000_000): LatticePlan {
  const origin: Vec3 = [0, 0, 0], dims: Vec3 = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    origin[a] = Math.floor(lo[a] / ratio[a] + 1e-9);
    dims[a] = Math.ceil(hi[a] / ratio[a] - 1e-9) - origin[a];
  }
  if (dims[0] * dims[1] * dims[2] > maxVoxels) {
    throw new Error(`VDB import: the target lattice would be ${dims.join(' x ')} voxels (over ${maxVoxels}); use a larger voxelSize or a smaller worldScale / targetWidthMeters.`);
  }
  return { lo, hi, ratio, origin, dims };
}

class AxisTable {
  readonly K: number;
  readonly j0: Int32Array;   // first target index (relative to the lattice origin) per source index
  readonly w: Float64Array;  // K weights per source index
  readonly norm: Float64Array; // sum of weights per target index
  constructor(readonly lo: number, readonly hi: number, readonly ratio: number, readonly a: number, readonly count: number) {
    const n = hi - lo, r = Math.max(1, ratio);
    const first = new Int32Array(n);
    let K = 1;
    for (let i = 0; i < n; i++) {
      const c = lo + i + 0.5;
      const jmin = Math.floor((c - r) / ratio - 0.5) + 1, jmax = Math.ceil((c + r) / ratio - 0.5) - 1;
      first[i] = jmin - a;
      K = Math.max(K, jmax - jmin + 1);
    }
    this.K = K;
    this.j0 = first;
    this.w = new Float64Array(n * K);
    this.norm = new Float64Array(count);
    for (let i = 0; i < n; i++) {
      const c = lo + i + 0.5;
      for (let k = 0; k < K; k++) {
        const j = first[i] + k;
        if (j < 0 || j >= count) continue;
        const w = Math.max(0, 1 - Math.abs((j + a + 0.5) * ratio - c) / r);
        this.w[i * K + k] = w;
        this.norm[j] += w;
      }
    }
  }
}

/**
 * Resample `grid` onto the plan's lattice. Unset voxels read as the grid background; output = background + filtered (value - background),
 * times `valueScale` (use the world scale for distance fields).
 */
export function resampleGrid(grid: VdbGrid, plan: LatticePlan, valueScale = 1): Float32Array {
  const [nx, ny, nz] = plan.dims;
  const bg = grid.background;
  const tx = new AxisTable(plan.lo[0], plan.hi[0], plan.ratio[0], plan.origin[0], nx);
  const ty = new AxisTable(plan.lo[1], plan.hi[1], plan.ratio[1], plan.origin[1], ny);
  const tz = new AxisTable(plan.lo[2], plan.hi[2], plan.ratio[2], plan.origin[2], nz);
  const acc = new Float32Array(nx * ny * nz);
  const [lx, ly, lz] = plan.lo, [hx, hy, hz] = plan.hi;

  // Leaf voxels.
  for (const leaf of grid.iterLeaves()) {
    const [ox, oy, oz] = leaf.origin;
    if (ox + 8 <= lx || oy + 8 <= ly || oz + 8 <= lz || ox >= hx || oy >= hy || oz >= hz) continue;
    const vals = leaf.values;
    for (let off = 0; off < 512; off++) {
      const d = vals[off] - bg;
      if (d === 0) continue;
      const ix = ox + (off >> 6), iy = oy + ((off >> 3) & 7), iz = oz + (off & 7);
      if (ix < lx || ix >= hx || iy < ly || iy >= hy || iz < lz || iz >= hz) continue;
      const bx = (ix - lx) * tx.K, by = (iy - ly) * ty.K, bz = (iz - lz) * tz.K;
      const jx0 = tx.j0[ix - lx], jy0 = ty.j0[iy - ly], jz0 = tz.j0[iz - lz];
      for (let kz = 0; kz < tz.K; kz++) {
        const wz = tz.w[bz + kz];
        const jz = jz0 + kz;
        if (wz === 0 || jz < 0 || jz >= nz) continue;
        for (let ky = 0; ky < ty.K; ky++) {
          const wy = ty.w[by + ky] * wz;
          const jy = jy0 + ky;
          if (wy === 0 || jy < 0 || jy >= ny) continue;
          const row = (jy * nz + jz) * nx;
          for (let kx = 0; kx < tx.K; kx++) {
            const wx = tx.w[bx + kx];
            const jx = jx0 + kx;
            if (wx === 0 || jx < 0 || jx >= nx) continue;
            acc[row + jx] += d * wx * wy;
          }
        }
      }
    }
  }

  // Constant tiles: separable box weights per axis.
  if (grid.tiles.length) {
    const boxWeights = (t: AxisTable, i0: number, i1: number, out: Float64Array): [number, number] => {
      out.fill(0);
      let jlo = Infinity, jhi = -Infinity;
      for (let i = Math.max(i0, t.lo); i < Math.min(i1, t.hi); i++) {
        const base = (i - t.lo) * t.K, j0 = t.j0[i - t.lo];
        for (let k = 0; k < t.K; k++) {
          const j = j0 + k, w = t.w[base + k];
          if (w === 0 || j < 0 || j >= t.count) continue;
          out[j] += w;
          if (j < jlo) jlo = j; if (j > jhi) jhi = j;
        }
      }
      return [jlo, jhi];
    };
    const wxs = new Float64Array(nx), wys = new Float64Array(ny), wzs = new Float64Array(nz);
    for (const tile of grid.tiles) {
      const d = tile.value - bg;
      if (d === 0) continue;
      const [ox, oy, oz] = tile.origin, s = tile.size;
      if (ox + s <= lx || oy + s <= ly || oz + s <= lz || ox >= hx || oy >= hy || oz >= hz) continue;
      const [x0, x1] = boxWeights(tx, ox, ox + s, wxs), [y0, y1] = boxWeights(ty, oy, oy + s, wys), [z0, z1] = boxWeights(tz, oz, oz + s, wzs);
      for (let jy = y0; jy <= y1; jy++) {
        const wy = wys[jy] * d;
        for (let jz = z0; jz <= z1; jz++) {
          const wyz = wy * wzs[jz], row = (jy * nz + jz) * nx;
          for (let jx = x0; jx <= x1; jx++) acc[row + jx] += wyz * wxs[jx];
        }
      }
    }
  }

  const out = new Float32Array(nx * ny * nz);
  for (let jy = 0; jy < ny; jy++) {
    for (let jz = 0; jz < nz; jz++) {
      const nyz = ty.norm[jy] * tz.norm[jz], row = (jy * nz + jz) * nx;
      for (let jx = 0; jx < nx; jx++) {
        const n = tx.norm[jx] * nyz;
        out[row + jx] = (bg + (n > 0 ? acc[row + jx] / n : 0)) * valueScale;
      }
    }
  }
  return out;
}
