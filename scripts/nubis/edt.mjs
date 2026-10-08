// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher), separable, anisotropic-capable.

const INF = 1e20;

// 1D squared-distance transform of f (length n, spacing h) into out; v/z are scratch.
function dt1d(f, n, h, out, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    const fq = f[q] + q * h * q * h;
    let s;
    for (;;) {
      const p = v[k];
      s = (fq - (f[p] + p * h * p * h)) / (2 * h * (q - p));
      if (s <= z[k]) k--; else break;
    }
    k++;
    v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q * h) k++;
    const d = (q - v[k]) * h;
    out[q] = d * d + f[v[k]];
  }
}

// Squared distance (in world units^2) from every voxel centre to the nearest voxel with mask != 0.
// mask: Uint8Array x-fastest. voxel: [hx,hy,hz]. Returns Float32Array.
export function squaredDistanceToMask(mask, dims, voxel = [1, 1, 1], target = 1) {
  const [nx, ny, nz] = dims;
  const g = new Float32Array(nx * ny * nz);
  for (let i = 0; i < g.length; i++) g[i] = (mask[i] ? 1 : 0) === target ? 0 : INF;
  const m = Math.max(nx, ny, nz);
  const f = new Float64Array(m), out = new Float64Array(m), z = new Float64Array(m + 1);
  const v = new Int32Array(m);
  // x
  for (let zi = 0; zi < nz; zi++) for (let yi = 0; yi < ny; yi++) {
    const base = (zi * ny + yi) * nx;
    for (let x = 0; x < nx; x++) f[x] = g[base + x];
    dt1d(f, nx, voxel[0], out, v, z);
    for (let x = 0; x < nx; x++) g[base + x] = out[x];
  }
  // y
  for (let zi = 0; zi < nz; zi++) for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) f[y] = g[(zi * ny + y) * nx + x];
    dt1d(f, ny, voxel[1], out, v, z);
    for (let y = 0; y < ny; y++) g[(zi * ny + y) * nx + x] = out[y];
  }
  // z
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    for (let zi = 0; zi < nz; zi++) f[zi] = g[(zi * ny + y) * nx + x];
    dt1d(f, nz, voxel[2], out, v, z);
    for (let zi = 0; zi < nz; zi++) g[(zi * ny + y) * nx + x] = out[zi];
  }
  return g;
}

// Signed distance in world units, negative inside (mask != 0). The surface sits half a voxel
// beyond the outermost inside / outermost outside centres, so |d| is reduced by half a voxel
// (mean voxel edge) on each side. Where there is no inside (or no outside) voxel at all the
// distance is +/- maxDist.
export function signedDistance(mask, dims, voxel = [1, 1, 1], maxDist = 1e9) {
  const half = 0.5 * Math.min(voxel[0], voxel[1], voxel[2]);
  const dOut = squaredDistanceToMask(mask, dims, voxel, 1); // distance to nearest inside voxel
  const dIn = squaredDistanceToMask(mask, dims, voxel, 0); // distance to nearest outside voxel
  const sdf = new Float32Array(mask.length);
  for (let i = 0; i < sdf.length; i++) {
    if (mask[i]) sdf[i] = -Math.min(maxDist, Math.max(0, Math.sqrt(dIn[i]) - half));
    else sdf[i] = Math.min(maxDist, Math.max(0, Math.sqrt(dOut[i]) - half));
  }
  return sdf;
}
