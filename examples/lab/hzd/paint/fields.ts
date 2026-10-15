// The weather-map painter's model (editor.ts): the five NDF fields as float layers at the map's resolution, the brush operations, and the
// conversions to the NDF texture (rolled: the map's centre is the world origin) and to the authored-map PNGs (assets/clouds/ndf/README.md).
//   Map pixel (px, py) is the world column x = ((px + 0.5) / n - 0.5) * tileMeters, z = ((py + 0.5) / n - 0.5) * tileMeters: up is north (-z),
//   right is east (+x), as the authored PNGs are. The map tiles, so every operation wraps.
// Pure (no DOM, no GPU), so it is unit-tested (fields.test.ts).

export const CHANNELS = ['coverage', 'topType', 'bottomType', 'minHeight', 'maxHeight', 'influence', 'storm'] as const;
export type Channel = (typeof CHANNELS)[number];
export type Targets = Partial<Record<Channel, number>>;

export type BrushOp = 'paint' | 'raise' | 'lower' | 'smooth' | 'smudge' | 'noise' | 'restore';

export interface Brush {
  op: BrushOp;
  /** Radius in map pixels. */
  radius: number;
  /** 0 = a soft cosine falloff from the centre, 1 = a hard disc. */
  hardness: number;
  /** 0..1 per dab. */
  strength: number;
  /** The noise brush's grain: cells per map side of its first octave. */
  noiseCells: number;
  noiseSeed: number;
}

/** The per-dab amount of raise / lower at strength 1 (a stroke lays dabs every quarter radius). */
export const RAISE_STEP = 0.06;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const wrap = (i: number, n: number) => ((i % n) + n) % n;

/** Brush falloff at d = distance / radius (0..1). */
export function falloff(d: number, hardness: number): number {
  if (d >= 1) return 0;
  const h = Math.min(Math.max(hardness, 0), 0.999);
  if (d <= h) return 1;
  const t = (d - h) / (1 - h);
  return 0.5 + 0.5 * Math.cos(Math.PI * t);
}

export class MapFields {
  readonly n: number;
  readonly data: Record<Channel, Float32Array>;
  constructor(n: number, init?: Partial<Record<Channel, Float32Array | number>>) {
    this.n = n;
    const make = (c: Channel, d: number) => {
      const v = init?.[c];
      if (v instanceof Float32Array) { if (v.length !== n * n) throw new Error(`${c}: ${v.length} values for a ${n}^2 map`); return v.slice(); }
      return new Float32Array(n * n).fill(typeof v === 'number' ? v : d);
    };
    this.data = { coverage: make('coverage', 0), topType: make('topType', 1), bottomType: make('bottomType', 0), minHeight: make('minHeight', 0), maxHeight: make('maxHeight', 1), influence: make('influence', 0), storm: make('storm', 0) };
  }
  clone(): MapFields { return new MapFields(this.n, this.data); }
  copyFrom(o: MapFields, channels: readonly Channel[] = CHANNELS) { for (const c of channels) this.data[c].set(o.data[c]); }
  at(c: Channel, x: number, y: number): number { return this.data[c][wrap(y, this.n) * this.n + wrap(x, this.n)]; }
  /** Bilinear, wrapping; (x, y) in pixel units with pixel centres at +0.5. */
  sample(c: Channel, x: number, y: number): number {
    const fx = x - 0.5, fy = y - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const a = this.at(c, x0, y0), b = this.at(c, x0 + 1, y0), d = this.at(c, x0, y0 + 1), e = this.at(c, x0 + 1, y0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
  }
}

/** Periodic value-noise fBM over the map (4 octaves from `cells` cells per side), 0..1. Periodic so the noise brush wraps without a seam. */
export function mapNoise(u: number, v: number, cells: number, seed: number): number {
  let sum = 0, norm = 0, amp = 1, c = Math.max(1, Math.round(cells));
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(u * c, v * c, c, seed + o * 131);
    norm += amp; amp *= 0.5; c *= 2;
  }
  return sum / norm;
}
function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const h = (i: number, j: number) => hash(wrap(i, period), wrap(j, period), seed);
  const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/** The region a dab touches, in unwrapped pixel coordinates (wrap each before indexing). */
const dabBox = (cx: number, cy: number, r: number) => ({ x0: Math.floor(cx - r), x1: Math.ceil(cx + r), y0: Math.floor(cy - r), y1: Math.ceil(cy + r) });

/**
 * One brush dab at (cx, cy) (pixel units) on `channels`.
 *   paint    each channel toward its target
 *   raise / lower   add / subtract RAISE_STEP x strength
 *   smooth   toward a box blur of the area (radius / 5)
 *   smudge   drag the values along (dx, dy), the stroke's motion since the last dab
 *   noise    toward target x the periodic fBM (breaks up plateaus: painted plateaus become slabs, W1)
 *   restore  toward `base` (the map the session started from)
 */
export function dab(f: MapFields, b: Brush, cx: number, cy: number, channels: readonly Channel[], targets: Targets, opts: { base?: MapFields; dx?: number; dy?: number } = {}): void {
  const n = f.n, r = Math.max(0.5, b.radius), s = clamp01(b.strength);
  const { x0, x1, y0, y1 } = dabBox(cx, cy, r);
  for (const c of channels) {
    const d = f.data[c];
    const t = targets[c] ?? 0;
    // Smooth and smudge read a snapshot of the area, so a dab does not read its own writes.
    let snap: Float32Array | null = null, sw = 0, pad = 0;
    if (b.op === 'smooth' || b.op === 'smudge') {
      pad = b.op === 'smooth' ? Math.max(1, Math.round(r / 5)) : Math.ceil(Math.hypot(opts.dx ?? 0, opts.dy ?? 0)) + 2;
      sw = x1 - x0 + 1 + 2 * pad;
      const sh = y1 - y0 + 1 + 2 * pad;
      snap = new Float32Array(sw * sh);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) snap[y * sw + x] = d[wrap(y0 - pad + y, n) * n + wrap(x0 - pad + x, n)];
      if (b.op === 'smooth') snap = boxBlur(snap, sw, sh, pad);
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const w = falloff(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r, b.hardness) * s;
        if (w <= 0) continue;
        const i = wrap(y, n) * n + wrap(x, n);
        const v = d[i];
        let out = v;
        switch (b.op) {
          case 'paint': out = v + (t - v) * w; break;
          case 'raise': out = v + RAISE_STEP * w; break;
          case 'lower': out = v - RAISE_STEP * w; break;
          case 'smooth': out = v + (snap![(y - y0 + pad) * sw + (x - x0 + pad)] - v) * w; break;
          case 'smudge': {
            // Bilinear read of the snapshot at (x, y) - (dx, dy).
            const sx = x - x0 + pad - (opts.dx ?? 0), sy = y - y0 + pad - (opts.dy ?? 0);
            const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
            const g = (u: number, q: number) => snap![Math.min(Math.max(q, 0), snap!.length / sw - 1) * sw + Math.min(Math.max(u, 0), sw - 1)];
            const src = (g(ix, iy) * (1 - fx) + g(ix + 1, iy) * fx) * (1 - fy) + (g(ix, iy + 1) * (1 - fx) + g(ix + 1, iy + 1) * fx) * fy;
            out = v + (src - v) * w;
            break;
          }
          case 'noise': out = v + (t * mapNoise((wrap(x, n) + 0.5) / n, (wrap(y, n) + 0.5) / n, b.noiseCells, b.noiseSeed) - v) * w; break;
          case 'restore': out = opts.base ? v + (opts.base.data[c][i] - v) * w : v; break;
        }
        d[i] = clamp01(out);
      }
    }
  }
}

/** Separable box blur (radius r) of a w x h block, edges clamped. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += src[y * w + Math.min(Math.max(x + i, 0), w - 1)];
    tmp[y * w + x] = s * k;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += tmp[Math.min(Math.max(y + i, 0), h - 1) * w + x];
    out[y * w + x] = s * k;
  }
  return out;
}

/** Dab centres along a stroke segment, spaced `spacing` pixels apart, carrying the leftover distance between calls. */
export function strokePoints(from: [number, number], to: [number, number], spacing: number, carry: number): { points: [number, number][]; carry: number } {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const points: [number, number][] = [];
  let d = spacing - carry;
  while (d <= len) {
    const t = len > 0 ? d / len : 0;
    points.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
    d += spacing;
  }
  return { points, carry: len - (d - spacing) };
}

/**
 * The linear gradient tool: each channel toward its target with weight 1 at `a` falling smoothly to 0 at `b` (1 behind `a`, 0 past `b`), times
 * strength. Writes `f` from `src` (the map before the drag), so it can be re-run as the drag moves.
 */
export function gradient(f: MapFields, src: MapFields, a: [number, number], b: [number, number], channels: readonly Channel[], targets: Targets, strength: number): void {
  const n = f.n, gx = b[0] - a[0], gy = b[1] - a[1], g2 = Math.max(gx * gx + gy * gy, 1e-6), s = clamp01(strength);
  for (const c of channels) {
    const d = f.data[c], o = src.data[c], t = targets[c] ?? 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = clamp01(((x + 0.5 - a[0]) * gx + (y + 0.5 - a[1]) * gy) / g2);
      const w = (1 - u * u * (3 - 2 * u)) * s;
      const i = y * n + x;
      d[i] = o[i] + (t - o[i]) * w;
    }
  }
}

/** Whole-channel operations. */
export function fill(f: MapFields, channels: readonly Channel[], targets: Targets) { for (const c of channels) f.data[c].fill(clamp01(targets[c] ?? 0)); }
export function invert(f: MapFields, channels: readonly Channel[]) { for (const c of channels) { const d = f.data[c]; for (let i = 0; i < d.length; i++) d[i] = 1 - d[i]; } }
export function blurAll(f: MapFields, channels: readonly Channel[], radius: number) {
  const n = f.n, r = Math.max(1, Math.round(radius));
  for (const c of channels) {
    const d = f.data[c], tmp = new Float32Array(d.length), k = 1 / (2 * r + 1);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let s = 0; for (let i = -r; i <= r; i++) s += d[y * n + wrap(x + i, n)]; tmp[y * n + x] = s * k; }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let s = 0; for (let i = -r; i <= r; i++) s += tmp[wrap(y + i, n) * n + x]; d[y * n + x] = s * k; }
  }
}
/** Multiply each channel by mix(1, fBM x 2, amount): break up what is there without moving it. */
export function addNoise(f: MapFields, channels: readonly Channel[], amount: number, cells: number, seed: number) {
  const n = f.n;
  for (const c of channels) {
    const d = f.data[c];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      d[i] = clamp01(d[i] * (1 + amount * (2 * mapNoise((x + 0.5) / n, (y + 0.5) / n, cells, seed) - 1)));
    }
  }
}

// --- Conversions ---

const toByte = (v: number) => Math.round(clamp01(v) * 255);

/**
 * The NDF texture's fields (procedural setNdf / uploadHzdNdf), rolled by half a map so the map's centre lands on the world origin (the NDF's texel
 * 0 is at world 0, the authored PNG's centre is). The top is kept at least 1/255 above the base, as the image path does.
 */
export function toNdfFields(f: MapFields): { coverage: Uint8Array; topType: Uint8Array; bottomType: Uint8Array; minHeight: Uint8Array; maxHeight: Uint8Array; influence: Uint8Array; storm: Uint8Array } {
  const n = f.n, h = n >> 1;
  const out = { coverage: new Uint8Array(n * n), topType: new Uint8Array(n * n), bottomType: new Uint8Array(n * n), minHeight: new Uint8Array(n * n), maxHeight: new Uint8Array(n * n), influence: new Uint8Array(n * n), storm: new Uint8Array(n * n) };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const src = ((y + h) % n) * n + ((x + h) % n), dst = y * n + x;
    for (const c of CHANNELS) out[c][dst] = toByte(f.data[c][src]);
    out.maxHeight[dst] = Math.max(out.maxHeight[dst], Math.min(out.minHeight[dst] + 1, 255));
  }
  return out;
}

/** The inverse of toNdfFields: NDF texture rows (rgba8, 2 layers: (coverage, topType, bottomType, -), (minHeight, maxHeight, storm, -)) to a map. */
export function fromNdfLayers(n: number, layer0: Uint8Array, layer1: Uint8Array): MapFields {
  const f = new MapFields(n), h = n >> 1;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const src = (y * n + x) * 4, dst = ((y + h) % n) * n + ((x + h) % n);
    f.data.coverage[dst] = layer0[src] / 255; f.data.topType[dst] = layer0[src + 1] / 255; f.data.bottomType[dst] = layer0[src + 2] / 255;
    f.data.minHeight[dst] = layer1[src] / 255; f.data.maxHeight[dst] = layer1[src + 1] / 255; f.data.storm[dst] = layer1[src + 2] / 255;
  }
  return f;
}

/** W2: the influence mask's PNG pixels (R = influence, G and B 0, alpha 255). */
export function toMaskPixels(f: MapFields): Uint8ClampedArray {
  const n = f.n, out = new Uint8ClampedArray(n * n * 4), d = f.data.influence;
  for (let i = 0; i < n * n; i++) { out[i * 4] = toByte(d[i]); out[i * 4 + 3] = 255; }
  return out;
}

/** The authored-map PNGs' pixels (RGBA, n x n, alpha 255): the main map (R coverage, G top type, B bottom type) and the height map (R min, G max, STORM1: B storm area). */
export function toPngPixels(f: MapFields): { main: Uint8ClampedArray; height: Uint8ClampedArray } {
  const n = f.n, main = new Uint8ClampedArray(n * n * 4), height = new Uint8ClampedArray(n * n * 4);
  const d = f.data;
  for (let i = 0; i < n * n; i++) {
    main[i * 4] = toByte(d.coverage[i]); main[i * 4 + 1] = toByte(d.topType[i]); main[i * 4 + 2] = toByte(d.bottomType[i]); main[i * 4 + 3] = 255;
    const lo = toByte(d.minHeight[i]);
    height[i * 4] = lo; height[i * 4 + 1] = Math.max(toByte(d.maxHeight[i]), Math.min(lo + 1, 255)); height[i * 4 + 2] = toByte(d.storm[i]); height[i * 4 + 3] = 255;
  }
  return { main, height };
}

/**
 * Write RGBA image pixels (w x h, image centre = map centre) into `f`'s channels, resampled bilinearly with wrapping as the NDF image path does
 * (ndf.wgsl.ts HZD_NDF_IMAGE_WGSL). `map` names the channel each of R, G, B goes to (null = skip).
 */
export function writeImage(f: MapFields, pixels: Uint8ClampedArray | Uint8Array, w: number, h: number, map: [Channel | null, Channel | null, Channel | null]): void {
  const n = f.n;
  const px = (x: number, y: number, k: number) => pixels[(wrap(y, h) * w + wrap(x, w)) * 4 + k];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const sx = ((x + 0.5) / n) * w - 0.5, sy = ((y + 0.5) / n) * h - 0.5;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0;
    for (let k = 0; k < 3; k++) {
      const c = map[k];
      if (!c) continue;
      const v = (px(x0, y0, k) * (1 - tx) + px(x0 + 1, y0, k) * tx) * (1 - ty) + (px(x0, y0 + 1, k) * (1 - tx) + px(x0 + 1, y0 + 1, k) * tx) * ty;
      f.data[c][y * n + x] = v / 255;
    }
  }
}

/** World metres (x, z) of a map position in pixels, and back. */
export const mapToWorld = (px: number, py: number, n: number, tile: number): [number, number] => [(px / n - 0.5) * tile, (py / n - 0.5) * tile];
export const worldToMap = (x: number, z: number, n: number, tile: number): [number, number] => [(x / tile + 0.5) * n, (z / tile + 0.5) * n];
