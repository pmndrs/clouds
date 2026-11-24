// P2.6a: the P2.4a tower (tower-bake.ts, kept as it is) plus the variance a Houdini cloud rig adds after the lobe stage. Same nine level-0
// placements (so the silhouette stays comparable), then:
//   lobes:   levels 0-1 are ellipsoids (random axis scales 0.8..1.25, random turn about y); children have jittered radii (0.28..0.62 x parent),
//            jittered depth and come in clumps (2-3 cluster directions per parent, biased up and outward, plus a few free ones).
//   level 3: small lobes (0.32..0.48 x parent) only on upward-facing level-2 lobes: fine cauliflower on the tops and sun sides.
//   surface: domain-warped billow displacement (|noise|: rounded bulges, sharp creases) in 3 octaves (120 / 48 / 20 m), weighted to upward
//            normals and height; low down and on downward normals it fades into fbm erosion of the density over a wide, soft ramp (wisps).
//   density: crisp ramp (w 10 m) on the billowed tops, wide (90 m) underneath; interior modulated by low-frequency fbm (0.6..1) and a slight
//            rise with depth; flat soft base (60 m smoothstep).
import type { DensityGrid, V3 } from './bake';
import { TOWER_BASE } from './tower-bake';

export const TOWER2_SEED = 11;

/** c, r: bounding centre and radius (r = nominal radius x the largest axis scale); s: axis scales; rot: turn about y (radians). */
export interface Tower2Lobe { c: V3; r: number; s: V3; rot: number; level: number }

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function tower2Lobes(seed = TOWER2_SEED, levels = 3): Tower2Lobe[] {
  const rand = rng(seed);
  const B = TOWER_BASE;
  const j = (v: number, a = 120) => v + (rand() - 0.5) * a;
  const L0: [number, number, number, number][] = [
    [350, 180, 0, 550], [850, 150, -150, 430], [-300, 160, 150, 500], [-850, 140, -50, 420], [-500, 520, 100, 400],
    [380, 720, 60, 500], [280, 1250, 120, 450], [170, 1750, 170, 400], [110, 2160, 200, 350],
  ];
  const ellip = (low: boolean): V3 => low
    ? [0.95 + rand() * 0.3, 0.7 + rand() * 0.15, 0.95 + rand() * 0.3]    // feet: wider than tall
    : [0.8 + rand() * 0.4, 0.85 + rand() * 0.4, 0.8 + rand() * 0.4];
  const out: Tower2Lobe[] = L0.map(([x, y, z, r]) => ({ c: [j(x), B + y, j(z)] as V3, r: r * (0.9 + rand() * 0.2), s: ellip(y < 300), rot: rand() * Math.PI, level: 0 }));
  const centroid: V3 = [0, 0, 0];
  for (const s of out) for (let a = 0; a < 3; a++) centroid[a] += s.c[a] / out.length;
  const unit = (): V3 => { for (;;) { const v: V3 = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1]; const l = Math.hypot(...v); if (l > 0.05 && l <= 1) return v.map(x => x / l) as V3; } };
  const norm = (v: V3): V3 => { const l = Math.hypot(...v) || 1; return v.map(x => x / l) as V3; };
  /** A point on the parent's (ellipsoid) surface along dir, times f. */
  const onSurface = (p: Tower2Lobe, dir: V3, f: number): V3 => {
    const cr = Math.cos(p.rot), sr = Math.sin(p.rot);
    const lx = cr * dir[0] + sr * dir[2], lz = -sr * dir[0] + cr * dir[2], ly = dir[1];   // into the parent's frame
    const nominal = p.r / Math.max(...p.s);
    const sx = lx * p.s[0], sy = ly * p.s[1], sz = lz * p.s[2];
    const wx = cr * sx - sr * sz, wz = sr * sx + cr * sz;                                 // back to world
    return [p.c[0] + wx * nominal * f, p.c[1] + sy * nominal * f, p.c[2] + wz * nominal * f];
  };
  let parents = out.map(s => ({ s, from: [centroid[0], s.c[1], centroid[2]] as V3 }));
  const counts: [number, number][] = [[6, 10], [5, 8], [3, 5]];
  for (let level = 1; level <= levels; level++) {
    const next: typeof parents = [];
    const [lo, hi] = counts[level - 1];
    for (const { s, from } of parents) {
      const outward = norm([s.c[0] - from[0], s.c[1] - from[1], s.c[2] - from[2]]);
      if (level === 3 && outward[1] < 0.15) continue;   // level 3 only on upward-facing lobes
      const n = lo + Math.floor(rand() * (hi - lo + 1));
      const clusters: V3[] = [];
      const nc = 2 + Math.floor(rand() * 2);
      for (let c = 0; c < nc; c++) {
        let d: V3;
        for (let tries = 0; ; tries++) {
          const u = unit();
          d = norm([u[0] + outward[0] * 0.7, u[1] + 0.9 + outward[1] * 0.7, u[2] + outward[2] * 0.7]);
          if (d[1] > -0.1 || tries > 20) break;
        }
        clusters.push(d);
      }
      for (let i = 0; i < n; i++) {
        let dir: V3;
        if (rand() < 0.8) {
          const k = clusters[Math.floor(rand() * clusters.length)];
          const u = unit();
          dir = norm([k[0] + u[0] * 0.45, k[1] + u[1] * 0.45, k[2] + u[2] * 0.45]);
        } else {
          const u = unit();
          dir = norm([u[0] + outward[0] * 0.6, u[1] + 0.9 + outward[1] * 0.6, u[2] + outward[2] * 0.6]);
        }
        if (dir[1] < -0.3) dir = norm([dir[0], -0.3, dir[2]]);
        const nominalParent = s.r / Math.max(...s.s);
        const rf = level === 3 ? 0.32 + rand() * 0.16 : 0.28 + Math.pow(rand(), 1.4) * 0.34;
        const r = nominalParent * rf;
        const c = onSurface(s, dir, 0.72 + rand() * 0.2);
        const scl: V3 = level === 1 ? ellip(false) : [1, 1, 1];
        const child: Tower2Lobe = { c, r: r * Math.max(...scl), s: scl, rot: rand() * Math.PI, level };
        out.push(child);
        next.push({ s: child, from: s.c });
      }
    }
    parents = next;
  }
  return out;
}

const WGSL = /* wgsl */ `
struct TB {
  origin: vec3<f32>, voxel: f32,
  dims: vec3<u32>, zOffset: u32,
  count: u32, base: f32, _a: f32, _b: f32,
}
@group(0) @binding(0) var<uniform> tb: TB;
@group(0) @binding(1) var<storage, read> lobes: array<vec4<f32>>;   // 2 per lobe: (c, r bound), (scale.xyz, rot)
@group(0) @binding(2) var<storage, read_write> outDensity: array<f32>;

fn hash3(i: vec3<i32>) -> f32 {
  var h = (u32(i.x) * 73856093u) ^ (u32(i.y) * 19349663u) ^ (u32(i.z) * 83492791u);
  h = (h ^ (h >> 16u)) * 0x7feb352du; h = (h ^ (h >> 15u)) * 0x846ca68bu; h = h ^ (h >> 16u);
  return f32(h) / 4294967295.0 * 2.0 - 1.0;
}
fn vnoise(p: vec3<f32>) -> f32 {
  let i = vec3<i32>(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), u.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), u.x), u.y);
  let b = mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), u.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), u.x), u.y);
  return mix(a, b, u.z);
}
// Billow: rounded bulges with sharp creases between them, about 0..1.
fn billow(p: vec3<f32>) -> f32 { return abs(vnoise(p)) * 1.6; }
fn fbm3(p: vec3<f32>) -> f32 { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.03 + vec3(3.1, 7.7, 1.3)) + 0.15 * vnoise(p * 4.1 + vec3(9.2, 2.4, 5.8)); }

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= tb.dims)) { return; }
  let k = gid.z + tb.zOffset;
  let p = tb.origin + (vec3<f32>(f32(gid.x), f32(gid.y), f32(k)) + 0.5) * tb.voxel;
  var d = 1e9;
  var g = vec3<f32>(0.0, 1.0, 0.0);
  for (var i = 0u; i < tb.count; i++) {
    let L = lobes[2u * i];
    let v = p - L.xyz;
    let len = length(v);
    let kk = 0.2 * L.w;
    if (len - L.w >= d + kk) { continue; }   // the bounding sphere is outside the blend band
    let E = lobes[2u * i + 1u];
    var a: f32;
    var ga: vec3<f32>;
    if (E.x == 1.0 && E.y == 1.0 && E.z == 1.0) {
      a = len - L.w;
      ga = v / max(len, 1e-3);
    } else {
      let cr = cos(E.w); let sr = sin(E.w);
      let lv = vec3(cr * v.x + sr * v.z, v.y, -sr * v.x + cr * v.z);
      let rr = (L.w / max(E.x, max(E.y, E.z))) * E.xyz;
      let k0 = length(lv / rr);
      let k1 = length(lv / (rr * rr));
      a = k0 * (k0 - 1.0) / max(k1, 1e-6);   // iq's ellipsoid bound
      let gl = lv / (rr * rr);
      ga = normalize(vec3(cr * gl.x - sr * gl.z, gl.y, sr * gl.x + cr * gl.z) + vec3(1e-6));
    }
    if (d >= 1e8) { d = a; g = ga; continue; }
    let h = clamp(0.5 + 0.5 * (d - a) / kk, 0.0, 1.0);
    d = mix(d, a, h) - kk * h * (1.0 - h);
    g = mix(g, ga, h);
  }
  let hb = p.y - tb.base;
  let n = normalize(g + vec3(0.0, 1e-4, 0.0));
  // up: 1 on tops and upper sides, 0 on undersides; height: 0 at the base, 1 from 500 m up.
  let up = smoothstep(-0.35, 0.45, n.y);
  let height = smoothstep(60.0, 500.0, hb);
  let crisp = up * height;
  // Domain warp so the billows don't line up on the lattice.
  let wq = p / 300.0;
  let warp = vec3(vnoise(wq + vec3(1.7, 9.2, 3.3)), vnoise(wq + vec3(8.3, 2.8, 6.1)), vnoise(wq + vec3(4.4, 7.1, 0.9))) * 60.0;
  let q = p + warp;
  if (d < 140.0) {   // only near the surface (the displacement is at most ~70 m)
    let bil = 34.0 * billow(q / 120.0) + 16.0 * billow(q / 48.0 + vec3(17.3, 5.1, 9.7)) + 7.0 * billow(q / 20.0 + vec3(2.9, 11.4, 6.6));
    // Outward bulges where crisp; on the soft parts a gentler, plain-noise wobble.
    d -= crisp * (bil - 18.0) + (1.0 - crisp) * 18.0 * vnoise(q / 90.0 + vec3(5.5, 1.2, 8.8));
  }
  // Ramp width: crisp (10 m) on billowed tops, wide (90 m) underneath and low down.
  let w = mix(90.0, 10.0, crisp);
  var dens = clamp(-d / w, 0.0, 1.0);
  // Soft parts: fbm erosion of the density (wisps and holes in the thin outer shell).
  let soft = 1.0 - crisp;
  let ero = fbm3(q / 70.0) * 0.5 + 0.5;
  dens = clamp((dens - soft * 0.55 * ero) / max(1.0 - soft * 0.55 * ero, 0.05), 0.0, 1.0);
  // Interior variation: low-frequency fbm (0.6..1) with a slight rise with depth below the surface.
  let inner = 0.6 + 0.4 * clamp(fbm3(p / 260.0 + vec3(13.0, 4.0, 7.0)) * 0.9 + 0.55, 0.0, 1.0);
  let depth = clamp(-d / 300.0, 0.0, 1.0);
  dens *= mix(1.0, inner, smoothstep(0.0, 1.0, clamp(-d / 60.0, 0.0, 1.0))) * (0.9 + 0.1 * depth);
  dens *= smoothstep(0.0, 60.0, hb);
  outDensity[gid.x + tb.dims.x * (gid.y + tb.dims.y * gid.z)] = dens;
}
`;

/** Bakes tower2 into a world grid (x fastest, then y, then z), density in [0, 1]. */
export async function bakeTower2(device: GPUDevice, voxel = 8, levels = 3): Promise<{ grid: DensityGrid; perLevel: number[] }> {
  const t0 = performance.now();
  const lobes = tower2Lobes(TOWER2_SEED, levels);
  const perLevel = [0, 0, 0, 0];
  for (const s of lobes) perLevel[s.level]++;
  const margin = 120;
  const lo: V3 = [Infinity, TOWER_BASE - 2 * voxel, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const s of lobes) for (const a of [0, 1, 2]) { if (a !== 1) lo[a] = Math.min(lo[a], s.c[a] - s.r - margin); hi[a] = Math.max(hi[a], s.c[a] + s.r + margin); }
  const min = lo.map(v => Math.floor(v / voxel) * voxel) as V3;
  const res = [0, 1, 2].map(a => Math.ceil((hi[a] - min[a]) / voxel)) as V3;
  const [nx, ny, nz] = res;
  const max: V3 = [min[0] + nx * voxel, min[1] + ny * voxel, min[2] + nz * voxel];
  const data = new Float32Array(lobes.length * 8);
  lobes.forEach((s, i) => data.set([...s.c, s.r, ...s.s, s.rot], i * 8));
  const lobeBuf = device.createBuffer({ label: 'tower2 lobes', size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(lobeBuf, 0, data);
  const pipeline = await device.createComputePipelineAsync({ label: 'tower2 bake', layout: 'auto', compute: { module: device.createShaderModule({ label: 'tower2 bake', code: WGSL }), entryPoint: 'main' } });
  const density = new Float32Array(nx * ny * nz);
  const slabZ = Math.max(1, Math.min(nz, Math.floor((16 << 20) / (nx * ny * 4))));   // small slabs: each dispatch stays well under the GPU watchdog
  const params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const out = device.createBuffer({ size: nx * ny * slabZ * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const staging = device.createBuffer({ size: nx * ny * slabZ * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: lobeBuf } }, { binding: 2, resource: { buffer: out } }] });
  for (let z0 = 0; z0 < nz; z0 += slabZ) {
    const zs = Math.min(slabZ, nz - z0);
    const p = new ArrayBuffer(48), f = new Float32Array(p), u = new Uint32Array(p);
    f.set(min, 0); f[3] = voxel;
    u[4] = nx; u[5] = ny; u[6] = zs; u[7] = z0;
    u[8] = lobes.length; f[9] = TOWER_BASE;
    device.queue.writeBuffer(params, 0, p);
    const enc = device.createCommandEncoder({ label: 'tower2 bake' });
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(nx / 8), Math.ceil(ny / 8), Math.ceil(zs / 4));
    pass.end();
    enc.copyBufferToBuffer(out, 0, staging, 0, nx * ny * zs * 4);
    device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ, 0, nx * ny * zs * 4);
    density.set(new Float32Array(staging.getMappedRange(0, nx * ny * zs * 4)), nx * ny * z0);
    staging.unmap();
  }
  for (const b of [params, out, staging, lobeBuf]) b.destroy();
  let densityMax = 0, occupied = 0;
  for (let i = 0; i < density.length; i++) { const d = density[i]; if (d > densityMax) densityMax = d; if (d > 0) occupied++; }
  return { grid: { resolution: res, min, max, voxel, density, densityMax, occupancy: occupied / density.length, ms: performance.now() - t0 }, perLevel };
}
