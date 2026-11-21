// P2.4a proof of concept: ONE cumulus tower built the Houdini way (fill a shape with spheres, smooth-union them, add noise), baked on the GPU
// into a dense world grid for the card page's direct-volume route. A design probe, not a feature.
//
//   level 0: 9 big spheres (r 350..550 m): a tower stacked up and stepping to one side, a lower wider shoulder, a foot; centres just above BASE.
//   level 1: each spawns 6..10 children of 0.5 r on its surface, biased up and outward from the body's centre.
//   level 2: each level-1 sphere spawns 5..8 children of 0.5 r the same way (outward = away from its parent).
// SDF = smooth union (polynomial smin, k = 0.2 x the added sphere's radius; spheres go in by level, so the added one is the smaller) + two
// octaves of value noise (25 m @ 250 m, 8 m @ 70 m, faded out toward the base). Density = saturate(-sdf / w), w = mix(80, 12, saturate(h / 600))
// widened back to 80 where the (smin-blended) SDF gradient points down; times a 60 m smoothstep above BASE (flat soft base).
import type { DensityGrid, V3 } from './bake';

export const TOWER_BASE = 1500;   // m
export const TOWER_SEED = 7;

export interface TowerSphere { c: V3; r: number; level: number }

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The sphere hierarchy, ordered by level. */
export function towerSpheres(seed = TOWER_SEED, levels = 2): TowerSphere[] {
  const rand = rng(seed);
  const B = TOWER_BASE;
  const j = (v: number) => v + (rand() - 0.5) * 80;
  // [x, height of centre above base, z, r]. Tower on +x stepping toward -x/+z as it rises; shoulder on -x; feet wide and low.
  const L0: [number, number, number, number][] = [
    [350, 180, 0, 550],       // tower foot
    [850, 150, -150, 430],    // right foot
    [-300, 160, 150, 500],    // shoulder foot
    [-850, 140, -50, 420],    // far-left shoulder
    [-500, 520, 100, 400],    // shoulder top
    [380, 720, 60, 500],      // tower 1
    [280, 1250, 120, 450],    // tower 2
    [170, 1750, 170, 400],    // tower 3
    [110, 2160, 200, 350],    // tower crown (top ~ 2510 m above base)
  ];
  const out: TowerSphere[] = L0.map(([x, y, z, r]) => ({ c: [j(x), B + y, j(z)] as V3, r, level: 0 }));
  const centroid: V3 = [0, 0, 0];
  for (const s of out) for (let a = 0; a < 3; a++) centroid[a] += s.c[a] / out.length;
  const unit = (): V3 => { for (;;) { const v: V3 = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1]; const l = Math.hypot(...v); if (l > 0.05 && l <= 1) return v.map(x => x / l) as V3; } };
  const norm = (v: V3): V3 => { const l = Math.hypot(...v) || 1; return v.map(x => x / l) as V3; };
  let parents = out.map(s => ({ s, from: [centroid[0], s.c[1], centroid[2]] as V3 }));   // level 0: outward = horizontal, away from the body
  const counts: [number, number][] = [[6, 10], [5, 8], [4, 6]];
  for (let level = 1; level <= levels; level++) {
    const next: typeof parents = [];
    const [lo, hi] = counts[level - 1];
    for (const { s, from } of parents) {
      const outward = norm([s.c[0] - from[0], s.c[1] - from[1], s.c[2] - from[2]]);
      const n = lo + Math.floor(rand() * (hi - lo + 1));
      for (let i = 0; i < n; i++) {
        let dir: V3;
        for (let tries = 0; ; tries++) {
          const u = unit();
          dir = norm([u[0] + outward[0] * 0.6, u[1] + 0.9 + outward[1] * 0.6, u[2] + outward[2] * 0.6]);
          if (dir[1] > -0.15 || tries > 20) break;
        }
        const r = s.r * 0.5;
        const dist = s.r * (0.78 + rand() * 0.12);   // centre 0.78..0.9 r_parent out: the child (0.5 r_parent) bulges 0.28..0.4 r_parent past the surface
        const c: V3 = [s.c[0] + dir[0] * dist, s.c[1] + dir[1] * dist, s.c[2] + dir[2] * dist];
        const child = { c, r, level };
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
@group(0) @binding(1) var<storage, read> spheres: array<vec4<f32>>;
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

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= tb.dims)) { return; }
  let k = gid.z + tb.zOffset;
  let p = tb.origin + (vec3<f32>(f32(gid.x), f32(gid.y), f32(k)) + 0.5) * tb.voxel;
  var d = 1e9;
  var g = vec3<f32>(0.0, 1.0, 0.0);
  for (var i = 0u; i < tb.count; i++) {
    let s = spheres[i];
    let v = p - s.xyz;
    let len = length(v);
    let a = len - s.w;
    let kk = 0.2 * s.w;
    if (a >= d + kk) { continue; }
    let ga = v / max(len, 1e-3);
    if (d >= 1e8) { d = a; g = ga; continue; }
    let h = clamp(0.5 + 0.5 * (d - a) / kk, 0.0, 1.0);
    d = mix(d, a, h) - kk * h * (1.0 - h);
    g = mix(g, ga, h);
  }
  let hb = p.y - tb.base;
  let noiseFade = clamp(hb / 400.0, 0.0, 1.0);
  d += noiseFade * (25.0 * vnoise(p / 250.0) + 8.0 * vnoise(p / 70.0 + vec3(17.3, 5.1, 9.7)));
  var w = mix(80.0, 12.0, clamp(hb / 600.0, 0.0, 1.0));
  let down = clamp(-normalize(g).y, 0.0, 1.0);
  w = mix(w, 80.0, down);
  let dens = clamp(-d / w, 0.0, 1.0) * smoothstep(0.0, 60.0, hb);
  outDensity[gid.x + tb.dims.x * (gid.y + tb.dims.y * gid.z)] = dens;
}
`;

/** Bakes the tower into a world grid (x fastest, then y, then z), density in [0, 1]. */
export async function bakeTower(device: GPUDevice, voxel = 8, levels = 2): Promise<{ grid: DensityGrid; spheres: TowerSphere[]; perLevel: number[] }> {
  const t0 = performance.now();
  const spheres = towerSpheres(TOWER_SEED, levels);
  const perLevel = [0, 0, 0, 0];
  for (const s of spheres) perLevel[s.level]++;
  const margin = 80;
  const lo: V3 = [Infinity, TOWER_BASE - 2 * voxel, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const s of spheres) for (const a of [0, 1, 2]) { if (a !== 1) lo[a] = Math.min(lo[a], s.c[a] - s.r - margin); hi[a] = Math.max(hi[a], s.c[a] + s.r + margin); }
  const min = lo.map(v => Math.floor(v / voxel) * voxel) as V3;
  const res = [0, 1, 2].map(a => Math.ceil((hi[a] - min[a]) / voxel)) as V3;
  const [nx, ny, nz] = res;
  const max: V3 = [min[0] + nx * voxel, min[1] + ny * voxel, min[2] + nz * voxel];
  const sphereData = new Float32Array(spheres.length * 4);
  spheres.forEach((s, i) => sphereData.set([...s.c, s.r], i * 4));
  const sphereBuf = device.createBuffer({ label: 'tower spheres', size: sphereData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(sphereBuf, 0, sphereData);
  const pipeline = await device.createComputePipelineAsync({ label: 'tower bake', layout: 'auto', compute: { module: device.createShaderModule({ label: 'tower bake', code: WGSL }), entryPoint: 'main' } });
  const density = new Float32Array(nx * ny * nz);
  const slabZ = Math.max(1, Math.min(nz, Math.floor((64 << 20) / (nx * ny * 4))));
  const params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const out = device.createBuffer({ size: nx * ny * slabZ * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const staging = device.createBuffer({ size: nx * ny * slabZ * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: sphereBuf } }, { binding: 2, resource: { buffer: out } }] });
  for (let z0 = 0; z0 < nz; z0 += slabZ) {
    const zs = Math.min(slabZ, nz - z0);
    const p = new ArrayBuffer(48), f = new Float32Array(p), u = new Uint32Array(p);
    f.set(min, 0); f[3] = voxel;
    u[4] = nx; u[5] = ny; u[6] = zs; u[7] = z0;
    u[8] = spheres.length; f[9] = TOWER_BASE;
    device.queue.writeBuffer(params, 0, p);
    const enc = device.createCommandEncoder({ label: 'tower bake' });
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
  for (const b of [params, out, staging, sphereBuf]) b.destroy();
  let densityMax = 0, occupied = 0;
  for (let i = 0; i < density.length; i++) { const d = density[i]; if (d > densityMax) densityMax = d; if (d > 0) occupied++; }
  return { grid: { resolution: res, min, max, voxel, density, densityMax, occupancy: occupied / density.length, ms: performance.now() - t0 }, spheres, perLevel };
}
