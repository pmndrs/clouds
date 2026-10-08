// CPU exact Euclidean distance transform (Felzenszwalb & Huttenlocher, separable). Port of scripts/nubis/edt.mjs.
// Used as the reference for the GPU jump-flood SDF. Isotropic voxels, no three imports.

const INF = 1e20;

function dt1d(f: Float64Array, n: number, out: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    const fq = f[q] + q * q;
    let s: number;
    for (;;) {
      const p = v[k];
      s = (fq - (f[p] + p * p)) / (2 * (q - p));
      if (s <= z[k]) k--; else break;
    }
    k++;
    v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const d = q - v[k];
    out[q] = d * d + f[v[k]];
  }
}

/** Squared distance, in voxels^2, from every voxel centre to the nearest voxel whose mask equals `target`. x-fastest. */
export function squaredDistanceToMask(mask: ArrayLike<number>, dims: readonly [number, number, number], target: 0 | 1 = 1): Float32Array {
  const [nx, ny, nz] = dims;
  const g = new Float32Array(nx * ny * nz);
  for (let i = 0; i < g.length; i++) g[i] = (mask[i] ? 1 : 0) === target ? 0 : INF;
  const m = Math.max(nx, ny, nz);
  const f = new Float64Array(m), out = new Float64Array(m), z = new Float64Array(m + 1), v = new Int32Array(m);
  for (let zi = 0; zi < nz; zi++) for (let yi = 0; yi < ny; yi++) {
    const base = (zi * ny + yi) * nx;
    for (let x = 0; x < nx; x++) f[x] = g[base + x];
    dt1d(f, nx, out, v, z);
    for (let x = 0; x < nx; x++) g[base + x] = out[x];
  }
  for (let zi = 0; zi < nz; zi++) for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) f[y] = g[(zi * ny + y) * nx + x];
    dt1d(f, ny, out, v, z);
    for (let y = 0; y < ny; y++) g[(zi * ny + y) * nx + x] = out[y];
  }
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    for (let zi = 0; zi < nz; zi++) f[zi] = g[(zi * ny + y) * nx + x];
    dt1d(f, nz, out, v, z);
    for (let zi = 0; zi < nz; zi++) g[(zi * ny + y) * nx + x] = out[zi];
  }
  return g;
}

/**
 * Signed distance in metres, negative inside (mask != 0), same convention as the shipped assets
 * (assets/clouds/README.md): voxel-centre to nearest opposite-state centre minus half a voxel.
 * With no opposite voxel at all the value is +/- maxDist.
 */
export function signedDistanceCpu(mask: ArrayLike<number>, dims: readonly [number, number, number], voxelSize: number, maxDist = 4096): Float32Array {
  const dOut = squaredDistanceToMask(mask, dims, 1);
  const dIn = squaredDistanceToMask(mask, dims, 0);
  const sdf = new Float32Array(dOut.length);
  for (let i = 0; i < sdf.length; i++) {
    if (mask[i]) sdf[i] = -Math.min(maxDist, Math.max(0, Math.sqrt(dIn[i]) - 0.5) * voxelSize);
    else sdf[i] = Math.min(maxDist, Math.max(0, Math.sqrt(dOut[i]) - 0.5) * voxelSize);
  }
  return sdf;
}
