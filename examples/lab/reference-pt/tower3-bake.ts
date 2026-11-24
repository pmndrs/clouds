// P2.7a: tower3, the tower2 bake (tower2-bake.ts, kept as it is) reworked to follow the Houdini cumulus recipe (work/logs/P2-6c.md) where it differs.
//   lobes:   three wide overlapping bodies instead of one column of nine: a congestus core (x 0, 2.3 km tall) and two lower flanks (x -760 and
//            +720, 0.8 and 0.62 km tall). Each body is filled with many level-0 ellipsoids (radius 0.45..0.75 x the body's envelope radius at
//            that height, centres anywhere inside 0.55 of it), so the lobes overlap at random heights and no tiers form.
//   level 1: replicated on the surface (children of every level-0 lobe, biased outward and up), kept only where they poke out of the level-0
//            union; radius 0.28..0.5 x parent (about 60..200 m, Houdini's first rung).
//   level 2: only on upward-facing level-1 lobes (about 25..90 m); off by default (?towerLevels=2), the 50 m push pass covers that scale.
//   surface: the Houdini billowy stage as an SDF push along the normal: three passes at 340 / 130 / 50 m features, 75 / 34 / 15 m push, each a
//            Worley dome (rounded caps with creased valleys between cells) blended 0.8 with fbm, domain-warped so they roll, and weighted to
//            up-facing surfaces (weight 0.45 on undersides, 1 on tops).
//   wisps:   the Houdini wispy stage as advection: the whole field is read at p - v(p), v a mostly horizontal 2-octave flow noise at 90 m (up to
//            ~130 m low down and on undersides, ~20 m on the tops, so lit ridges stay crisp).
//   density: crisp ramp (10 m) on up-facing upper surfaces, wide (75 m) on undersides and low down, fbm erosion on the soft parts, ragged soft
//            base instead of a flat slab; interior fbm as tower2.
//   fringe:  (P2.8a, ?towerFringe=1, off by default) a soft low-density layer outside the dense body, so edges have thin material for the
//            sunward silver lining: density up to ~0.35 at the surface falling to 0 over ~60 m on the sides and ~100 m low down / underneath,
//            only ~8 m on clearly up-facing upper surfaces (lit ridges stay crisp); its width and strength are broken up by 70 m fbm so it is patchy,
//            not a uniform halo.
import type { DensityGrid, V3 } from './bake';
import { TOWER_BASE } from './tower-bake';

export const TOWER3_SEED = 23;

/** c, r: bounding centre and radius (r = nominal radius x the largest axis scale); s: axis scales; rot: turn about y (radians). */
export interface Tower3Lobe { c: V3; r: number; s: V3; rot: number; level: number }

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A body: centre on the base, height, envelope radius at the bottom and top (horizontal), lean (x, z offset at the top), lobe count, flatness. */
interface Body { x: number; z: number; h: number; rBot: number; rTop: number; lean: [number, number]; n: number; flat: number }

const BODIES: Body[] = [
  { x: 0, z: 0, h: 2300, rBot: 620, rTop: 360, lean: [120, 60], n: 44, flat: 0.95 },      // congestus core
  { x: -760, z: 120, h: 800, rBot: 560, rTop: 330, lean: [-80, 0], n: 26, flat: 0.8 },    // left flank (the shoulder)
  { x: 720, z: -110, h: 620, rBot: 520, rTop: 300, lean: [60, 0], n: 22, flat: 0.78 },    // right flank
];

export function tower3Lobes(seed = TOWER3_SEED, levels = 2): Tower3Lobe[] {
  const rand = rng(seed);
  const B = TOWER_BASE;
  const unit = (): V3 => { for (;;) { const v: V3 = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1]; const l = Math.hypot(...v); if (l > 0.05 && l <= 1) return v.map(x => x / l) as V3; } };
  const norm = (v: V3): V3 => { const l = Math.hypot(...v) || 1; return v.map(x => x / l) as V3; };
  const out: Tower3Lobe[] = [];
  const axisAt = (b: Body, t: number): V3 => [b.x + b.lean[0] * t, B + b.h * t, b.z + b.lean[1] * t];
  // Level 0: lobes anywhere inside each body's envelope; the top of the body is a dome (radius shrinks faster near the top).
  for (const b of BODIES) {
    for (let i = 0; i < b.n; i++) {
      const t = Math.pow(rand(), 0.9) * 0.92;
      const R = (b.rBot + (b.rTop - b.rBot) * t) * Math.sqrt(1 - Math.pow(t / 1.05, 6));
      const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * 0.55 * R;
      const ax = axisAt(b, t);
      const c: V3 = [ax[0] + Math.cos(a) * rr, ax[1], ax[2] + Math.sin(a) * rr];
      const nominal = R * (0.45 + rand() * 0.3);
      const s: V3 = [0.85 + rand() * 0.35, b.flat * (0.8 + rand() * 0.3), 0.85 + rand() * 0.35];
      out.push({ c, r: nominal * Math.max(...s), s, rot: rand() * Math.PI, level: 0 });
    }
  }
  const L0 = out.slice();
  /** Approximate union SDF of the given lobes (spheres of the nominal radius times the mean axis scale). */
  const unionD = (p: V3, set: Tower3Lobe[]) => {
    let d = Infinity;
    for (const s of set) { const nr = (s.r / Math.max(...s.s)) * (s.s[0] + s.s[1] + s.s[2]) / 3; d = Math.min(d, Math.hypot(p[0] - s.c[0], p[1] - s.c[1], p[2] - s.c[2]) - nr); }
    return d;
  };
  const onSurface = (p: Tower3Lobe, dir: V3, f: number): V3 => {
    const cr = Math.cos(p.rot), sr = Math.sin(p.rot);
    const lx = cr * dir[0] + sr * dir[2], lz = -sr * dir[0] + cr * dir[2], ly = dir[1];
    const nominal = p.r / Math.max(...p.s);
    const sx = lx * p.s[0], sy = ly * p.s[1], sz = lz * p.s[2];
    const wx = cr * sx - sr * sz, wz = sr * sx + cr * sz;
    return [p.c[0] + wx * nominal * f, p.c[1] + sy * nominal * f, p.c[2] + wz * nominal * f];
  };
  /** The body axis point nearest a lobe (for its outward direction). */
  const axisFrom = (c: V3): V3 => {
    let best: V3 = [0, B, 0], bd = Infinity;
    for (const b of BODIES) {
      const t = Math.min(1, Math.max(0, (c[1] - B) / b.h));
      const a = axisAt(b, t);
      const dd = Math.hypot(c[0] - a[0], c[2] - a[2]) / (b.rBot + (b.rTop - b.rBot) * t);
      if (dd < bd) { bd = dd; best = [a[0], Math.min(c[1], a[1]) - 200, a[2]]; }
    }
    return best;
  };
  // Level 1: replicate on the surface; keep a child only if it pokes out of the level-0 union.
  const L1: { s: Tower3Lobe; out: V3 }[] = [];
  if (levels >= 1) for (const s of L0) {
    const from = axisFrom(s.c);
    const outward = norm([s.c[0] - from[0], s.c[1] - from[1], s.c[2] - from[2]]);
    const n = 9 + Math.floor(rand() * 6);
    for (let i = 0; i < n; i++) {
      const u = unit();
      let dir = norm([u[0] + outward[0] * 0.8, u[1] + outward[1] * 0.8 + 0.25, u[2] + outward[2] * 0.8]);
      if (dir[1] < -0.45) dir = norm([dir[0], -0.45, dir[2]]);
      const nominalParent = s.r / Math.max(...s.s);
      const r = nominalParent * (0.28 + Math.pow(rand(), 1.3) * 0.22);
      const c = onSurface(s, dir, 0.85 + rand() * 0.12);
      if (c[1] < B - 0.3 * r) continue;
      if (unionD(c, L0) < -0.55 * r) continue;
      const scl: V3 = [0.9 + rand() * 0.25, 0.85 + rand() * 0.25, 0.9 + rand() * 0.25];
      const child: Tower3Lobe = { c, r: r * Math.max(...scl), s: scl, rot: rand() * Math.PI, level: 1 };
      out.push(child);
      L1.push({ s: child, out: norm([c[0] - s.c[0], c[1] - s.c[1], c[2] - s.c[2]]) });
    }
  }
  // Level 2: only on upward-facing level-1 lobes.
  if (levels >= 2) for (const { s, out: o } of L1) {
    if (o[1] < 0.1) continue;
    const n = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const u = unit();
      const dir = norm([u[0] + o[0] * 0.9, u[1] + o[1] * 0.9 + 0.3, u[2] + o[2] * 0.9]);
      const r = s.r * (0.35 + rand() * 0.15);
      const c = onSurface(s, dir, 0.8 + rand() * 0.15);
      if (unionD(c, L0) < -0.6 * r) continue;
      out.push({ c, r, s: [1, 1, 1], rot: 0, level: 2 });
    }
  }
  return out;
}

const WGSL = /* wgsl */ `
struct TB {
  origin: vec3<f32>, voxel: f32,
  dims: vec3<u32>, zOffset: u32,
  count: u32, base: f32, fringe: f32, _b: f32,
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
fn fbm3(p: vec3<f32>) -> f32 { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.03 + vec3(3.1, 7.7, 1.3)) + 0.15 * vnoise(p * 4.1 + vec3(9.2, 2.4, 5.8)); }
fn vnoise3(p: vec3<f32>) -> vec3<f32> { return vec3(vnoise(p + vec3(1.7, 9.2, 3.3)), vnoise(p + vec3(8.3, 2.8, 6.1)), vnoise(p + vec3(4.4, 7.1, 0.9))); }
// Worley dome: a rounded cap per cell, 1 at the feature point, 0 at a squared distance of 0.75; the creases where caps meet are the valleys.
fn dome(p: vec3<f32>) -> f32 {
  let i = vec3<i32>(floor(p));
  let f = fract(p);
  var f1 = 9.0;
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let o = vec3<i32>(x, y, z);
    let j = i + o;
    let fp = vec3(hash3(j), hash3(j + vec3(31, 17, 59)), hash3(j + vec3(73, 41, 11))) * 0.45 + 0.5;
    let r = vec3<f32>(o) + fp - f;
    f1 = min(f1, dot(r, r));
  } } }
  return sqrt(max(0.0, 1.0 - f1 / 0.75));
}

// The smooth union of the lobes at p: (signed distance, blended gradient).
fn field(p: vec3<f32>) -> vec4<f32> {
  var d = 1e9;
  var g = vec3<f32>(0.0, 1.0, 0.0);
  for (var i = 0u; i < tb.count; i++) {
    let L = lobes[2u * i];
    let v = p - L.xyz;
    let len = length(v);
    let kk = 0.25 * L.w;
    if (len - L.w >= d + kk) { continue; }
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
      a = k0 * (k0 - 1.0) / max(k1, 1e-6);
      let gl = lv / (rr * rr);
      ga = normalize(vec3(cr * gl.x - sr * gl.z, gl.y, sr * gl.x + cr * gl.z) + vec3(1e-6));
    }
    if (d >= 1e8) { d = a; g = ga; continue; }
    let h = clamp(0.5 + 0.5 * (d - a) / kk, 0.0, 1.0);
    d = mix(d, a, h) - kk * h * (1.0 - h);
    g = mix(g, ga, h);
  }
  return vec4(d, normalize(g + vec3(0.0, 1e-4, 0.0)));
}

// One billowy pass: feature size S (m), push amplitude A (m). Worley dome x 0.8 + fbm x 0.2, domain-warped (rolled), centred so it pushes out and in.
fn billowPass(p: vec3<f32>, S: f32, A: f32, seed: vec3<f32>) -> f32 {
  let w = vnoise3(p / (0.6 * S) + seed) * (0.3 * S);
  let q = (p + w) / S + seed;
  let b = 0.8 * dome(q) + 0.2 * (fbm3(q * 1.7) * 0.5 + 0.5);
  return A * 2.0 * (b - 0.55);
}

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= tb.dims)) { return; }
  let k = gid.z + tb.zOffset;
  let p = tb.origin + (vec3<f32>(f32(gid.x), f32(gid.y), f32(k)) + 0.5) * tb.voxel;
  let idx = gid.x + tb.dims.x * (gid.y + tb.dims.y * gid.z);
  let hb = p.y - tb.base;
  // First look: far outside the lobes (beyond the largest push + wisp reach) is empty.
  let f0 = field(p);
  if (f0.x > 300.0) { outDensity[idx] = 0.0; return; }
  // Wisps (advection): read the field at p - v. v is mostly horizontal flow noise at 90 m; strong low down and on undersides, weak on tops.
  let low = 1.0 - smoothstep(80.0, 600.0, hb);
  let under = 1.0 - smoothstep(-0.6, 0.0, f0.y);
  let wAmp = mix(20.0, 130.0, max(low, under));
  let fq = p / 90.0;
  var v = vnoise3(fq + vec3(11.0, 3.0, 7.0)) + 0.5 * vnoise3(fq * 2.1 + vec3(2.0, 13.0, 5.0));
  v.y *= 0.4;
  let pw = p - v * wAmp;
  let f = field(pw);
  var d = f.x;
  let n = f.yzw;
  // Billowy (surface push along the normal), three passes, strongest facing up.
  let upw = mix(0.45, 1.0, smoothstep(-0.4, 0.5, n.y));
  if (d < 200.0) {
    let push = billowPass(pw, 340.0, 75.0, vec3(0.0)) + billowPass(pw, 130.0, 34.0, vec3(17.3, 5.1, 9.7)) + billowPass(pw, 50.0, 15.0, vec3(2.9, 11.4, 6.6));
    d -= upw * push;
  }
  // Ramp: crisp on up-facing upper surfaces, wide on undersides and low down.
  let up = smoothstep(-0.3, 0.45, n.y);
  let crisp = up * smoothstep(80.0, 450.0, hb);
  let w = mix(75.0, 10.0, crisp);
  var dens = clamp(-d / w, 0.0, 1.0);
  // Erosion only where it is soft and low down or facing down (side faces keep their billows).
  let soft = (1.0 - crisp) * max(1.0 - smoothstep(80.0, 600.0, hb), 1.0 - smoothstep(-0.6, 0.0, n.y));
  let ero = fbm3(pw / 60.0 + vec3(4.0, 1.0, 8.0)) * 0.5 + 0.5;
  dens = clamp((dens - soft * 0.65 * ero) / max(1.0 - soft * 0.65 * ero, 0.05), 0.0, 1.0);
  // P2.8a fringe (after the erosion, which would eat it): thin material outside the body (d > 0), wide low down and underneath, narrow on the sides, almost none on lit tops; patchy.
  if (tb.fringe > 0.0 && d > 0.0) {
    let fLow = max(low, 1.0 - smoothstep(-0.6, 0.0, n.y));
    let nf = clamp(fbm3(pw / 70.0 + vec3(21.0, 5.0, 14.0)) * 0.9 + 0.5, 0.0, 1.0);
    let top = smoothstep(0.2, 0.7, n.y) * smoothstep(80.0, 450.0, hb);   // only clearly up-facing upper surfaces stay crisp (sides do not)
    let W = mix(mix(60.0, 100.0, fLow), 8.0, top) * (0.35 + 1.1 * nf);
    let amp = 0.35 * tb.fringe * mix(0.3, 1.0, smoothstep(0.3, 0.7, nf)) * (1.0 - 0.85 * top);
    let t = clamp(1.0 - d / W, 0.0, 1.0);
    dens = max(dens, amp * t * t);
  }
  let inner = 0.6 + 0.4 * clamp(fbm3(p / 260.0 + vec3(13.0, 4.0, 7.0)) * 0.9 + 0.55, 0.0, 1.0);
  let depth = clamp(-d / 300.0, 0.0, 1.0);
  dens *= mix(1.0, inner, smoothstep(0.0, 1.0, clamp(-d / 60.0, 0.0, 1.0))) * (0.9 + 0.1 * depth);
  // Ragged soft base.
  dens *= smoothstep(0.0, 90.0, hb + 45.0 * fbm3(p / 120.0 + vec3(6.0, 2.0, 9.0)) - 20.0);
  outDensity[idx] = dens;
}
`;

/** Bakes tower3 into a world grid (x fastest, then y, then z), density in [0, 1]. */
export async function bakeTower3(device: GPUDevice, voxel = 8, levels = 1, fringe = 0): Promise<{ grid: DensityGrid; perLevel: number[] }> {
  const t0 = performance.now();
  const lobes = tower3Lobes(TOWER3_SEED, levels);
  const perLevel = [0, 0, 0];
  for (const s of lobes) perLevel[s.level]++;
  const margin = fringe > 0 ? 260 : 160;   // the fringe reaches up to ~145 m past the pushed surface
  const lo: V3 = [Infinity, TOWER_BASE - 2 * voxel, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const s of lobes) for (const a of [0, 1, 2]) { if (a !== 1) lo[a] = Math.min(lo[a], s.c[a] - s.r - margin); hi[a] = Math.max(hi[a], s.c[a] + s.r + margin); }
  const min = lo.map(v => Math.floor(v / voxel) * voxel) as V3;
  const res = [0, 1, 2].map(a => Math.ceil((hi[a] - min[a]) / voxel)) as V3;
  const [nx, ny, nz] = res;
  const max: V3 = [min[0] + nx * voxel, min[1] + ny * voxel, min[2] + nz * voxel];
  const data = new Float32Array(lobes.length * 8);
  lobes.forEach((s, i) => data.set([...s.c, s.r, ...s.s, s.rot], i * 8));
  const lobeBuf = device.createBuffer({ label: 'tower3 lobes', size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(lobeBuf, 0, data);
  const pipeline = await device.createComputePipelineAsync({ label: 'tower3 bake', layout: 'auto', compute: { module: device.createShaderModule({ label: 'tower3 bake', code: WGSL }), entryPoint: 'main' } });
  const density = new Float32Array(nx * ny * nz);
  const slabZ = Math.max(1, Math.min(nz, Math.floor((8 << 20) / (nx * ny * 4))));   // small slabs: each dispatch stays well under the GPU watchdog
  const params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const out = device.createBuffer({ size: nx * ny * slabZ * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const staging = device.createBuffer({ size: nx * ny * slabZ * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: lobeBuf } }, { binding: 2, resource: { buffer: out } }] });
  for (let z0 = 0; z0 < nz; z0 += slabZ) {
    const zs = Math.min(slabZ, nz - z0);
    const p = new ArrayBuffer(48), f = new Float32Array(p), u = new Uint32Array(p);
    f.set(min, 0); f[3] = voxel;
    u[4] = nx; u[5] = ny; u[6] = zs; u[7] = z0;
    u[8] = lobes.length; f[9] = TOWER_BASE; f[10] = fringe;
    device.queue.writeBuffer(params, 0, p);
    const enc = device.createCommandEncoder({ label: 'tower3 bake' });
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
