// CPU heightfield for the terrain module: a meandering valley (the axis winds along x, floor ~14 m, north = -Z) walled by ridged spurs, plus a
// terrace for the onsen at the origin. One pure function so CPU placement (camera, rocks, pool) and the baked GPU tiles always agree.
import { DataTexture, LinearFilter, ClampToEdgeWrapping, RGBAFormat, HalfFloatType, DataUtils } from 'three';

export interface TerrainShape {
  seed: number;
  /** Valley floor height (m). */
  floor: number;
  /** Valley axis z at x = 0 and its meander amplitude (m). */
  axisZ: number;
  meander: number;
  /** Flat valley-floor half width (m) before the walls rise. */
  floorHalfWidth: number;
  /** Wall profile per side: height above the floor = rise * (1 - exp(-s / reach)) + tail * (s - tailStart)+, s = distance beyond the flat floor; then soft-capped. */
  near: { rise: number; reach: number; tail: number; tailStart: number; cap: number };
  far: { rise: number; reach: number; tail: number; tailStart: number; cap: number };
  /** Terrace (flat shelf the onsen sits on): centre, optional absolute height (default: the hillside there + 10 m), flat radius and blend radius (m). */
  terrace: { x: number; z: number; height?: number; flat: number; blend: number; /** Extra drop (m) of the ground beyond the north lip: the overlook. */ drop: number };
  /** A low rise (the viewing spot): centre, radius and height above the terrace. */
  perch: { x: number; z: number; radius: number; height: number };
  /** Pool basin: centre, radius, depth (m). */
  pool: { x: number; z: number; radius: number; depth: number };
}

export const DEFAULT_SHAPE: TerrainShape = {
  seed: 5, floor: 14, axisZ: -2300, meander: 600, floorHalfWidth: 380,
  near: { rise: 700, reach: 1100, tail: 0.22, tailStart: 2400, cap: 1500 },
  far: { rise: 820, reach: 1250, tail: 0.2, tailStart: 2800, cap: 2200 },
  terrace: { x: 0, z: 6, flat: 15, blend: 34, drop: 45 },
  perch: { x: 0.4, z: 11, radius: 7.5, height: 3.4 },
  pool: { x: -3.2, z: -2.2, radius: 3.8, depth: 1.2 },
};

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function makeNoise(seed: number) {
  const hash = (ix: number, iy: number) => {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296 * 2 - 1;
  };
  /** Value noise in [-1, 1], quintic-smooth. */
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return noise;
}

export interface Heightfield {
  readonly shape: TerrainShape;
  /** Terrain height (m) at world x, z. */
  height(x: number, z: number): number;
  /** The same without terrace and pool (what the valley would be). */
  base(x: number, z: number): number;
  /** `height` without the pool basin: what is baked into the tiles (a 1.5 m basin is finer than their texels; the shader subtracts `basin` analytically). */
  bakedHeight(x: number, z: number): number;
  /** Small radial features finer than the tiles' texels (the pool basin, the viewing rise): added analytically on the GPU, `amp * (1 - smoothstep(a, b, distance))`. */
  readonly bumps: readonly { x: number; z: number; a: number; b: number; amp: number }[];
  /** Water level of the onsen pool. */
  readonly poolLevel: number;
  /** Terrace height at its centre. */
  readonly terraceHeight: number;
}

export function createHeightfield(overrides: Partial<TerrainShape> = {}): Heightfield {
  const shape = { ...DEFAULT_SHAPE, ...overrides };
  const n = makeNoise(shape.seed);
  const n2 = makeNoise(shape.seed + 101);
  const ridged = (x: number, y: number, octaves: number, lac: number, gain: number) => {
    let sum = 0, amp = 0.5, w = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      let r = 1 - Math.abs(n2(x, y)); r *= r; r *= w;
      w = Math.min(1, Math.max(0, r * 1.6));
      sum += r * amp; norm += amp;
      x = x * lac + 17.3; y = y * lac - 9.1; amp *= gain;
    }
    return sum / norm;
  };
  const fbm = (x: number, y: number, octaves: number) => {
    let sum = 0, amp = 0.5, norm = 0;
    for (let i = 0; i < octaves; i++) { sum += n(x, y) * amp; norm += amp; x = x * 2.03 + 5.2; y = y * 2.03 - 3.7; amp *= 0.5; }
    return sum / norm;
  };

  const base = (x: number, z: number) => {
    // Domain warp so the walls are not a clean function of the axis distance.
    const wx = x + 420 * fbm(x / 2300, z / 2300, 3), wz = z + 420 * fbm(x / 2300 + 7.3, z / 2300 + 3.1, 3);
    const zc = shape.axisZ + shape.meander * Math.sin(wx / 3300 + 0.6) + shape.meander * 0.42 * Math.sin(wx / 1250 + 2.0);
    const d = wz - zc; // > 0 on our (south) side
    const near = d > 0;
    const prof = near ? shape.near : shape.far;
    const sd = Math.max(0, Math.abs(d) - shape.floorHalfWidth);
    const t = sd / 2200;
    const rise = prof.rise * (1 - Math.exp(-sd / prof.reach)) + prof.tail * Math.max(0, sd - prof.tailStart);
    const cap = prof.cap;
    const E = cap * (1 - Math.exp(-rise / cap)); // height above the floor
    // Spurs run down the walls (noise elongated across the axis); crests and gullies come from sharper ridged noise at two scales.
    const wall = smooth(0, 0.4, t);
    const r = ridged(wx / 1700, d / 3600, 6, 2.07, 0.5);
    let spur = 0.3 + 1.05 * smooth(0.08, 0.85, r);
    if (near) spur = 0.85 + (spur - 0.85) * 0.3; // our own flank is a calm shoulder; the drama is across the valley
    const fine = ridged(wx / 520 + 3.1, wz / 520 - 1.7, 4, 2.1, 0.5);
    let h = shape.floor + E * (1 - wall) + E * wall * spur;
    h += wall * E * (near ? 0.04 : 0.13) * (fine - 0.45);
    h += wall * (14 * fbm(x / 140, z / 140, 3) + 40 * fbm(x / 600, z / 600, 2)) * Math.min(1, E / 200);
    h += (1 - wall) * (5 * fbm(x / 400, z / 400, 3));
    return h;
  };

  const terraceHeight = shape.terrace.height ?? base(shape.terrace.x, shape.terrace.z) + 10;
  const poolLevel = terraceHeight - 0.45;
  const height = (x: number, z: number) => {
    let h = base(x, z);
    const tr = shape.terrace, dt = Math.hypot(x - tr.x, z - tr.z);
    const w = 1 - smooth(tr.flat, tr.blend, dt);
    const lip = smooth(tr.z - 2, tr.z - 22, z) * (1 - smooth(tr.blend, tr.blend * 4, dt)); // the overlook side: the hillside falls away beyond the lip
    const hb = h - tr.drop * lip;
    h = w > 0 ? hb + (terraceHeight + 0.18 * fbm(x / 6, z / 6, 2) * smooth(4, 20, dt) - hb) * w : hb;
    return h;
  };
  const pe = shape.perch, po = shape.pool;
  const bumps = [{ x: po.x, z: po.z, a: po.radius - 0.9, b: po.radius + 1.3, amp: -po.depth }, { x: pe.x, z: pe.z, a: pe.radius * 0.35, b: pe.radius, amp: pe.height }];
  const bumpHeight = (x: number, z: number) => bumps.reduce((h, k) => h + k.amp * (1 - smooth(k.a, k.b, Math.hypot(x - k.x, z - k.z))), 0);
  return { shape, height: (x, z) => height(x, z) + bumpHeight(x, z), bakedHeight: height, base, bumps, poolLevel, terraceHeight };
}

export interface TileSpec { cx: number; cz: number; half: number; res: number }

export interface BakedTile extends TileSpec { texture: DataTexture }

/** Bakes one tile: RGBA half float = (height hi, height lo, dh/dx, dh/dz). hi + lo is a ~20 bit height, so bilinear sums stay smooth at kilometre altitudes. */
export function bakeTile(field: Heightfield, spec: TileSpec): BakedTile {
  const { cx, cz, half, res } = spec;
  const cell = (2 * half) / res;
  const h = new Float32Array(res * res);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) h[j * res + i] = field.bakedHeight(cx - half + (i + 0.5) * cell, cz - half + (j + 0.5) * cell);
  const data = new Uint16Array(res * res * 4);
  const at = (i: number, j: number) => h[Math.min(res - 1, Math.max(0, j)) * res + Math.min(res - 1, Math.max(0, i))];
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const v = h[j * res + i];
    const hi = DataUtils.fromHalfFloat(DataUtils.toHalfFloat(v));
    const o = (j * res + i) * 4;
    data[o] = DataUtils.toHalfFloat(v); data[o + 1] = DataUtils.toHalfFloat(v - hi);
    data[o + 2] = DataUtils.toHalfFloat((at(i + 1, j) - at(i - 1, j)) / (2 * cell));
    data[o + 3] = DataUtils.toHalfFloat((at(i, j + 1) - at(i, j - 1)) / (2 * cell));
  }
  const texture = new DataTexture(data, res, res, RGBAFormat, HalfFloatType);
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { ...spec, texture };
}
