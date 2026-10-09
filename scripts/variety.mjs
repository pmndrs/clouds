#!/usr/bin/env node
// P9-A variety metrics: scores how much the clouds of a generated cloudscape differ from each other ("is the sky a wall of clones?").
//
//   node scripts/variety.mjs --serve                       # default runs: cloudscape-gen cumulus/congestus/stratocumulus + open-water
//   node scripts/variety.mjs --serve --name cells4 --page cloudscape-gen/ --query "preset=cumulus&w_cellScale=4"
//   node scripts/variety.mjs --file fields.json            # re-score a saved field dump, no browser
//
// DATA SOURCE (no image heuristics). A page passes `fields` to installCloudsHarness().ready(): the generated NVDF volume is read back from
// the GPU and reduced per column (thickness, lowest and highest occupied voxel, see readCloudColumns in examples/lab/harness/clouds-contract.ts).
// That column map IS an orthographic top-down view, so every measure below is computed on the field the renderer samples:
//   footprint   Gated on LOBES: 8-connected components of (thickness > 0) are split at thickness saddles (blur, then climb to the local maximum), because at
//               typical coverage the connected components are merged clusters whose size spread comes from how many cells happened to touch, not from the
//               clouds themselves. CV = std/mean of lobe areas, ratio = largest/smallest. Lobes under --min-lobe-area (50 columns) and lobes touching the
//               box edge (clipped by the field) are ignored. The plan-literal numbers on connected components are kept as `connectedFootprint` (info only).
//   base        per-column lowest occupied voxel, in metres. baseSpread = P95-P5 over core columns (thickness >= 8 voxels, rims excluded), the
//               "one condensation level" test. cloudBaseSpread = P90-P10 of each cloud's median base (between-cloud spread), for information.
//   clone       per cloud and view axis (looking along the map rows, then along x) a silhouette from the column maps (for each x: min base to max top
//               over the lobe), cropped, scaled so its width is 64 px (aspect kept), base-aligned on a 64x64 canvas. Score = median over all pairs of
//               different clouds of the zero-mean normalised cross-correlation, mirrored or not (best of both). 1 = same shape, ~0 = unrelated.
//   autocorr    2D autocorrelation of the footprint mask (zero-padded FFT, unbiased), radially averaged. peak = prominence of the highest
//               bump above the first trough inside [0.5, 1.6] x the weather cell spacing (extent / cellScale). A regular lattice of equal cells shows one.
// Screenshots (--shots, default horizon,above) are written next to the JSON for a human; they are not used for scoring.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- thresholds (docs/PLAN-2026-10-variety.md rows 9-B and 9-C)
export const THRESHOLDS = {
  footprintCv: { min: 0.7 },
  footprintRatio: { min: 10 },
  baseSpreadM: { max: 30 },
  autocorrPeak: { max: 0.05 },
  cloneScore: { max: 0.6 },
};

// ---------------------------------------------------------------- field decoding
export const decodeB64 = s => new Uint8Array(Buffer.from(s, 'base64'));
export function decodeFields(f) {
  const [nx, ny, nz] = f.size;
  return { nx, ny, nz, voxel: f.voxel, thickness: decodeB64(f.thickness), baseZ: decodeB64(f.baseZ), topZ: decodeB64(f.topZ), meta: f.meta ?? {} };
}

// ---------------------------------------------------------------- connected components (8-connected)
export function labelComponents(mask, nx, ny) {
  const labels = new Int32Array(nx * ny).fill(-1);
  const comps = [];
  const stack = new Int32Array(nx * ny);
  for (let i0 = 0; i0 < nx * ny; i0++) {
    if (!mask[i0] || labels[i0] >= 0) continue;
    const id = comps.length;
    const c = { id, area: 0, minX: nx, maxX: 0, minY: ny, maxY: 0, edge: false, pixels: [] };
    let sp = 0; stack[sp++] = i0; labels[i0] = id;
    while (sp) {
      const i = stack[--sp], x = i % nx, y = (i - x) / nx;
      c.area++; c.pixels.push(i);
      if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x; if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y;
      if (x === 0 || y === 0 || x === nx - 1 || y === ny - 1) c.edge = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
        const j = yy * nx + xx;
        if (mask[j] && labels[j] < 0) { labels[j] = id; stack[sp++] = j; }
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

/**
 * Splits connected footprints into lobes: the thickness map is box-blurred (radius `blur` voxels, three passes ~ gaussian) and every column climbs its steepest
 * neighbour to a local maximum; one lobe per maximum. This is the "cell" level, where a merged cluster of cumulus is still several clouds.
 */
export function lobeSegments(f, comps, blur = 5) {
  const { nx, ny } = f;
  let a = Float32Array.from(f.thickness), b = new Float32Array(nx * ny);
  const pass = (src, dst, horizontal) => {
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      let acc = 0, n = 0;
      for (let d = -blur; d <= blur; d++) { const xx = horizontal ? x + d : x, yy = horizontal ? y : y + d; if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue; acc += src[yy * nx + xx]; n++; }
      dst[y * nx + x] = acc / (2 * blur + 1);
    }
  };
  for (let k = 0; k < 3; k++) { pass(a, b, true); pass(b, a, false); }
  const climb = new Int32Array(nx * ny).fill(-2);
  const better = (j, i) => a[j] > a[i] || (a[j] === a[i] && j < i);
  const top = i => {
    const path = [];
    for (;;) {
      if (climb[i] >= -1 && climb[i] !== -2) { const r = climb[i]; for (const p of path) climb[p] = r; return r; }
      path.push(i);
      const x = i % nx, y = (i - x) / nx; let best = i;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
        const j = yy * nx + xx; if (f.thickness[j] && better(j, best)) best = j;
      }
      if (best === i) { for (const p of path) climb[p] = i; return i; }
      i = best;
    }
  };
  const segs = new Map();
  for (const c of comps) for (const i of c.pixels) {
    const r = top(i), x = i % nx, y = (i - x) / nx;
    let s = segs.get(r);
    if (!s) { s = { id: segs.size, area: 0, minX: nx, maxX: 0, minY: ny, maxY: 0, edge: false, pixels: [] }; segs.set(r, s); }
    s.area++; s.pixels.push(i);
    if (x < s.minX) s.minX = x; if (x > s.maxX) s.maxX = x; if (y < s.minY) s.minY = y; if (y > s.maxY) s.maxY = y;
    if (x === 0 || y === 0 || x === nx - 1 || y === ny - 1) s.edge = true;
  }
  return [...segs.values()];
}

const sum = a => a.reduce((x, y) => x + y, 0);
export const mean = a => (a.length ? sum(a) / a.length : 0);
export const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
export function quantile(a, q) {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort(); const p = q * (s.length - 1), lo = Math.floor(p), hi = Math.ceil(p);
  return s[lo] + (s[hi] - s[lo]) * (p - lo);
}

// ---------------------------------------------------------------- footprint statistics
export function footprintStats(comps, { minArea = 2, voxel = 8 } = {}) {
  const used = comps.filter(c => !c.edge && c.area >= minArea);
  const areas = used.map(c => c.area);
  const m = mean(areas);
  const min = areas.length ? Math.min(...areas) : 0, max = areas.length ? Math.max(...areas) : 0;
  const diam = a => 2 * Math.sqrt((a * voxel * voxel) / Math.PI);
  return {
    components: comps.length, usedComponents: used.length, edgeComponents: comps.filter(c => c.edge).length, ignoredSmall: comps.filter(c => !c.edge && c.area < minArea).length,
    cv: m ? std(areas) / m : 0, ratio: min ? max / min : 0,
    areaColumns: { min, max, mean: m, median: quantile(areas, 0.5) },
    diameterM: { min: diam(min), median: diam(quantile(areas, 0.5) || 0), max: diam(max) },
  };
}

// ---------------------------------------------------------------- base altitude
export function baseStats(f, comps, { minArea = 25, coreThickness = 8 } = {}) {
  const used = comps.filter(c => !c.edge && c.area >= minArea);
  const medians = [], core = [];
  for (const c of used) {
    const bases = c.pixels.map(i => f.baseZ[i] * f.voxel);
    medians.push(quantile(bases, 0.5));
    for (const i of c.pixels) if (f.thickness[i] >= coreThickness) core.push(f.baseZ[i] * f.voxel);
  }
  return {
    clouds: used.length, coreColumns: core.length,
    baseSpreadM: core.length ? quantile(core, 0.95) - quantile(core, 0.05) : 0,
    coreBaseM: { p5: quantile(core, 0.05), median: quantile(core, 0.5), p95: quantile(core, 0.95) },
    cloudBaseSpreadM: medians.length ? quantile(medians, 0.9) - quantile(medians, 0.1) : 0,
    cloudBaseMedianM: { min: Math.min(...medians), median: quantile(medians, 0.5), max: Math.max(...medians) },
  };
}

// ---------------------------------------------------------------- clone score
export const CANVAS = 64;
/** Silhouette of one component seen along `axis` ('y': along the map rows, columns of constant x; 'x': the transpose), rendered into a CANVAS^2 float image. */
export function silhouette(f, c, axis) {
  const lo = new Map(), hi = new Map();
  for (const i of c.pixels) {
    const x = i % f.nx, y = (i - x) / f.nx, k = axis === 'y' ? x : y;
    const b = f.baseZ[i], t = f.topZ[i];
    if (!lo.has(k) || b < lo.get(k)) lo.set(k, b);
    if (!hi.has(k) || t > hi.get(k)) hi.set(k, t);
  }
  const k0 = axis === 'y' ? c.minX : c.minY, k1 = axis === 'y' ? c.maxX : c.maxY;
  const W = k1 - k0 + 1;
  let z0 = Infinity, z1 = -Infinity;
  for (const k of lo.keys()) { z0 = Math.min(z0, lo.get(k)); z1 = Math.max(z1, hi.get(k)); }
  const s = CANVAS / W; // canvas px per source voxel; the cloud's base sits on the canvas floor
  const img = new Float32Array(CANVAS * CANVAS);
  for (let py = 0; py < CANVAS; py++) for (let px = 0; px < CANVAS; px++) {
    let acc = 0;
    for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
      const k = Math.floor(k0 + (px + (sx + 0.5) / 2) / s);
      const z = z0 + (CANVAS - 1 - py + (sy + 0.5) / 2) / s; // floor of the canvas = the cloud's lowest voxel
      if (lo.has(k) && z >= lo.get(k) && z < hi.get(k) + 1) acc += 0.25;
    }
    img[py * CANVAS + px] = acc;
  }
  return { img, widthVoxels: W, heightVoxels: z1 - z0 + 1, clipped: (z1 - z0 + 1) * s > CANVAS };
}
const zeroMeanUnit = img => {
  const m = mean(img); const o = new Float32Array(img.length); let n = 0;
  for (let i = 0; i < img.length; i++) { o[i] = img[i] - m; n += o[i] * o[i]; }
  n = Math.sqrt(n) || 1; for (let i = 0; i < o.length; i++) o[i] /= n;
  return o;
};
const mirror = img => { const o = new Float32Array(img.length); for (let y = 0; y < CANVAS; y++) for (let x = 0; x < CANVAS; x++) o[y * CANVAS + x] = img[y * CANVAS + CANVAS - 1 - x]; return o; };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
/** Median over pairs of the best (mirrored or not) normalised cross-correlation. `sils` are float images. */
export function pairwiseNcc(sils) {
  const a = sils.map(zeroMeanUnit), b = a.map(mirror);
  const scores = [];
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) scores.push(Math.max(dot(a[i], a[j]), dot(a[i], b[j])));
  return scores;
}
export function cloneScore(f, comps, { minWidth = 10, maxClouds = 80 } = {}) {
  const used = comps.filter(c => !c.edge && c.maxX - c.minX + 1 >= minWidth && c.maxY - c.minY + 1 >= minWidth).sort((p, q) => q.area - p.area).slice(0, maxClouds);
  const all = [], sheet = [];
  for (const axis of ['y', 'x']) {
    const sils = used.map(c => silhouette(f, c, axis));
    all.push(...pairwiseNcc(sils.map(s => s.img)));
    if (axis === 'y') sheet.push(...sils.map(s => s.img));
  }
  return { clouds: used.length, pairs: all.length, median: all.length ? quantile(all, 0.5) : NaN, p90: quantile(all, 0.9), p10: quantile(all, 0.1), sheet };
}

// ---------------------------------------------------------------- autocorrelation of the footprint
function fft1(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
function fft2(re, im, n, inverse) {
  const rr = new Float64Array(n), ri = new Float64Array(n);
  for (let y = 0; y < n; y++) { rr.set(re.subarray(y * n, y * n + n)); ri.set(im.subarray(y * n, y * n + n)); fft1(rr, ri, inverse); re.set(rr, y * n); im.set(ri, y * n); }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) { rr[y] = re[y * n + x]; ri[y] = im[y * n + x]; }
    fft1(rr, ri, inverse);
    for (let y = 0; y < n; y++) { re[y * n + x] = rr[y]; im[y * n + x] = ri[y]; }
  }
}
/** Radially averaged, unbiased, normalised autocovariance of a binary mask: r[k] for lag k voxels (r[0] = 1). */
export function radialAutocorr(mask, nx, ny, maxLag) {
  let n = 1; while (n < 2 * Math.max(nx, ny)) n <<= 1;
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  let on = 0;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (mask[y * nx + x]) { re[y * n + x] = 1; on++; }
  const m = on / (nx * ny);
  if (m === 0 || m === 1) return { r: new Float64Array(maxLag + 1), mean: m };
  fft2(re, im, n, false);
  for (let i = 0; i < n * n; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
  fft2(re, im, n, true);
  const sums = new Float64Array(maxLag + 1), cnt = new Float64Array(maxLag + 1), v = m * (1 - m);
  for (let dy = -maxLag; dy <= maxLag; dy++) for (let dx = -maxLag; dx <= maxLag; dx++) {
    const k = Math.round(Math.hypot(dx, dy)); if (k > maxLag) continue;
    const overlap = (nx - Math.abs(dx)) * (ny - Math.abs(dy));
    const raw = re[((dy + n) % n) * n + ((dx + n) % n)] / (n * n);
    sums[k] += (raw / overlap - m * m) / v; cnt[k]++;
  }
  return { r: sums.map((s, k) => s / cnt[k]), mean: m };
}
/** Prominence of the highest bump above the first trough, searched in [loLag, hiLag]; 0 when the profile just decays. */
export function peakProminence(r, loLag, hiLag) {
  const s = Float64Array.from(r, (_, k) => (r[Math.max(0, k - 1)] + r[k] + r[Math.min(r.length - 1, k + 1)]) / 3);
  let trough = -1;
  for (let k = 1; k < s.length - 1; k++) if (s[k] <= s[k - 1] && s[k] < s[k + 1] && k <= hiLag) { trough = k; break; }
  if (trough < 0) return { prominence: 0, lag: null };
  let best = -Infinity, at = null;
  for (let k = Math.max(trough, Math.floor(loLag)); k <= Math.min(s.length - 1, Math.ceil(hiLag)); k++) if (s[k] > best) { best = s[k]; at = k; }
  const prominence = at === null ? 0 : Math.max(0, best - Math.min(...s.slice(trough, at + 1)));
  return { prominence, lag: at, troughLag: trough };
}
export function autocorrStats(f, cellSpacingM) {
  const maxLag = Math.floor(Math.min(f.nx, f.ny) / 3);
  const { r, mean: m } = radialAutocorr(Array.from(f.thickness, t => (t > 0 ? 1 : 0)), f.nx, f.ny, maxLag);
  const s = cellSpacingM ? cellSpacingM / f.voxel : null;
  const found = s ? peakProminence(r, 0.5 * s, 1.6 * s) : { prominence: NaN, lag: null };
  return { coverage: m, cellSpacingM: cellSpacingM ?? null, peak: found.prominence, peakLagM: found.lag === null ? null : found.lag * f.voxel, peakLagOverSpacing: found.lag && s ? found.lag / s : null, profile: Array.from(r.filter((_, k) => k % 2 === 0), v => +v.toFixed(3)) };
}

// ---------------------------------------------------------------- scoring
export function scoreFields(raw, opts = {}) {
  const f = decodeFields(raw);
  const mask = Uint8Array.from(f.thickness, t => (t > 0 ? 1 : 0));
  const { comps } = labelComponents(mask, f.nx, f.ny);
  const lobes = lobeSegments(f, comps, opts.blur ?? 5);
  const extent = f.meta.extentMeters ?? f.nx * f.voxel;
  const cellScale = opts.cellScale ?? f.meta.weather?.cellScale;
  const cellSpacingM = opts.cellSpacingM ?? (cellScale ? extent / cellScale : undefined);
  const connected = footprintStats(comps, { minArea: opts.minArea ?? 2, voxel: f.voxel });
  const footprint = footprintStats(lobes, { minArea: opts.minLobeArea ?? 50, voxel: f.voxel });
  const base = baseStats(f, comps);
  const clone = cloneScore(f, lobes);
  const auto = autocorrStats(f, cellSpacingM);
  const measures = { footprintCv: footprint.cv, footprintRatio: footprint.ratio, baseSpreadM: base.baseSpreadM, autocorrPeak: auto.peak, cloneScore: clone.median };
  const verdict = {};
  for (const [k, t] of Object.entries(THRESHOLDS)) {
    const v = measures[k];
    verdict[k] = Number.isNaN(v) ? 'n/a' : ('min' in t ? v >= t.min : v <= t.max) ? 'pass' : 'FAIL';
  }
  const sheet = clone.sheet; delete clone.sheet;
  return { measures, verdict, pass: Object.values(verdict).every(v => v === 'pass' || v === 'n/a'), coverage: auto.coverage, footprint, connectedFootprint: connected, base, clone, autocorr: auto, _debug: { f, comps: lobes, sheet } };
}

// ---------------------------------------------------------------- debug images (PNG, no dependencies)
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function encodePng(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** Left: footprint coloured per cloud (grey = touches the box edge and is ignored), base height as brightness. Right: silhouette contact sheet of the largest clouds. */
export function debugImage({ f, comps, sheet }) {
  const cols = 8, rows = Math.max(1, Math.ceil(Math.min(sheet.length, 64) / cols)), sw = cols * (CANVAS + 2), W = f.nx + sw, H = Math.max(f.ny, rows * (CANVAS + 2));
  const rgb = new Uint8Array(W * H * 3).fill(20);
  const hue = id => { const h = (id * 137.508) % 360, c = 0.85, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = 0.1, [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6]; return [r + m, g + m, b + m]; };
  for (const c of comps) {
    const [r, g, b] = c.edge ? [0.5, 0.5, 0.5] : hue(c.id);
    for (const i of c.pixels) {
      const x = i % f.nx, y = (i - x) / f.nx, k = 0.45 + 0.55 * (1 - f.baseZ[i] / Math.max(1, f.nz)), o = (y * W + x) * 3;
      rgb[o] = r * 255 * k; rgb[o + 1] = g * 255 * k; rgb[o + 2] = b * 255 * k;
    }
  }
  sheet.slice(0, 64).forEach((img, n) => {
    const ox = f.nx + (n % cols) * (CANVAS + 2) + 1, oy = Math.floor(n / cols) * (CANVAS + 2) + 1;
    for (let y = 0; y < CANVAS; y++) for (let x = 0; x < CANVAS; x++) { const o = ((oy + y) * W + ox + x) * 3, v = 40 + img[y * CANVAS + x] * 200; rgb[o] = rgb[o + 1] = rgb[o + 2] = v; }
  });
  return encodePng(rgb, W, H);
}

// ---------------------------------------------------------------- reporting
const fmt = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : String(v));
export function summaryLine(name, r) {
  const m = r.measures, v = r.verdict;
  return `${name.padEnd(26)} ${r.pass ? 'PASS' : 'FAIL'}  CV ${fmt(m.footprintCv)} ${v.footprintCv}  ratio ${fmt(m.footprintRatio, 1)} ${v.footprintRatio}  base ${fmt(m.baseSpreadM, 0)}m ${v.baseSpreadM}  acf ${fmt(m.autocorrPeak, 3)} ${v.autocorrPeak}  clone ${fmt(m.cloneScore)} ${v.cloneScore}   (${r.footprint.usedComponents} lobes in ${r.connectedFootprint.usedComponents} footprints, cover ${fmt(r.coverage * 100, 0)}%)`;
}

// ---------------------------------------------------------------- browser driver (same launch recipe as scripts/gpu/capture.mjs)
const DEFAULT_RUNS = [
  { name: 'cumulus', page: 'cloudscape-gen/', query: 'preset=cumulus' },
  { name: 'congestus', page: 'cloudscape-gen/', query: 'preset=congestus' },
  { name: 'stratocumulus', page: 'cloudscape-gen/', query: 'preset=stratocumulus' },
  { name: 'open-water', page: 'open-water/', query: 'sky=0' },
];

async function main() {
  const argv = process.argv.slice(2);
  const flag = n => argv.includes('--' + n);
  const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
  if (flag('help')) {
    console.log(`--serve              start the vite dev server for the run
--url <base>         use a running server instead (e.g. http://127.0.0.1:5173)
--runs a,b           subset of the default runs (${DEFAULT_RUNS.map(r => r.name).join(', ')})
--name/--page/--query  one custom run, e.g. --name cells4 --page cloudscape-gen/ --query "preset=cumulus&w_cellScale=4"
--file <json>        score a saved field dump ({ size, voxel, thickness, baseZ, topZ, meta }) without a browser
--shots a,b          bookmarks to screenshot per run (default horizon,above; none to skip)
--min-area <n>       connected footprints smaller than n columns are ignored (default 2)
--min-lobe-area <n>  lobes smaller than n columns are ignored in the lobe statistics (default 50, about 64 m across)
--out <dir>          default work/captures/P9-A     --settle <frames> default 90     --timeout <s> default 120`);
    return;
  }
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const out = resolve(root, opt('out', 'work/captures/P9-A'));
  mkdirSync(out, { recursive: true });
  const minArea = Number(opt('min-area', 2)), minLobeArea = Number(opt('min-lobe-area', 50));
  const scratch = resolve(root, 'work/captures/scratch/P9-A');
  const results = {};
  const record = (name, raw, extra = {}) => {
    const r = scoreFields(raw, { minArea, minLobeArea });
    const { _debug, ...pub } = r;
    writeFileSync(join(out, `${name}-coverage.png`), debugImage(_debug));
    results[name] = { ...pub, ...extra };
    console.log(summaryLine(name, r));
  };

  if (opt('file')) {
    record(opt('name', 'file'), JSON.parse(readFileSync(resolve(opt('file')), 'utf8')));
  } else {
    const { CDP } = await import('./gpu/cdp.mjs');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
    const waitFor = async (fn, ms, what) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(150); } throw new Error('Timed out waiting for ' + what); };
    const children = [];
    const cleanup = () => { for (const c of children) try { c.kill('SIGTERM'); } catch { /* gone */ } };
    process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(130); });
    let base = opt('url', 'http://127.0.0.1:5173');
    if (flag('serve')) {
      const port = await freePort();
      const vite = spawn(join(root, 'node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CLOUDS_NO_WATCH: '1' } });
      children.push(vite);
      let log = ''; vite.stdout.on('data', d => { log += d; }); vite.stderr.on('data', d => { log += d; });
      base = `http://127.0.0.1:${port}`;
      await waitFor(async () => (await fetch(base + '/')).ok, 30000, 'vite dev server').catch(e => { console.error(log); throw e; });
    }
    const [width, height] = [1920, 1080];
    const debugPort = await freePort();
    const profile = mkdtempSync(join(tmpdir(), 'variety-chrome-'));
    const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    children.push(spawn(chrome, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--window-size=${width},${height}`, '--headless=new', 'about:blank'], { stdio: 'ignore' }));
    let runs = opt('page') ? [{ name: opt('name', 'custom'), page: opt('page'), query: opt('query', '') }] : DEFAULT_RUNS;
    if (opt('runs')) runs = DEFAULT_RUNS.filter(r => opt('runs').split(',').includes(r.name));
    const shots = (opt('shots', 'horizon,above') || '').split(',').filter(s => s && s !== 'none');
    const settleFrames = Number(opt('settle', 90)), timeoutMs = Number(opt('timeout', 120)) * 1000;
    let failed = false;
    try {
      const page = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t => t.type === 'page'), 15000, 'Chrome');
      const cdp = await CDP.connect(page.webSocketDebuggerUrl);
      await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      for (const run of runs) {
        const url = `${base}/${run.page}${run.query ? '?' + run.query : ''}`;
        try {
          cdp.events.length = 0;
          await cdp.send('Page.navigate', { url });
          const ready = await waitFor(() => cdp.evaluate(`(() => { const c = window.__clouds; if (!c) return null; if (c.error) return { error: String(c.error) }; return c.ready ? { ok: true } : null; })()`), timeoutMs, 'window.__clouds.ready');
          if (ready.error) throw new Error('page error: ' + ready.error);
          await cdp.evaluate(`window.__clouds.settle(${settleFrames})`);
          const hasFields = await cdp.evaluate('typeof window.__clouds.fields === "function"');
          if (!hasFields) throw new Error(`${run.page} does not provide __clouds.fields (pass fields to harness.ready)`);
          const raw = JSON.parse(await cdp.evaluate('window.__clouds.fields().then(f => JSON.stringify(f))'));
          mkdirSync(scratch, { recursive: true }); writeFileSync(join(scratch, `${run.name}-fields.json`), JSON.stringify(raw)); // re-score later with --file
          const shotFiles = [];
          for (const shot of shots) {
            try {
              await cdp.evaluate(`window.__clouds.bookmark(${JSON.stringify(shot)})`);
              await cdp.evaluate(`window.__clouds.settle(${settleFrames})`);
              const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
              const file = `${run.name}-${shot}.jpg`; writeFileSync(join(out, file), Buffer.from(data, 'base64')); shotFiles.push(file);
            } catch (e) { console.error(`  (no ${shot} shot for ${run.name}: ${e.message.split('\n')[0]})`); }
          }
          record(run.name, raw, { url: `${run.page}${run.query ? '?' + run.query : ''}`, screenshots: shotFiles });
        } catch (e) { failed = true; results[run.name] = { error: e.message }; console.error(`${run.name}: ERROR ${e.message}`); }
      }
      cdp.close();
    } finally {
      cleanup();
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    if (failed) { writeFileSync(join(out, 'variety.json'), JSON.stringify({ thresholds: THRESHOLDS, results }, null, 2)); process.exitCode = 1; return; }
  }
  const stripped = JSON.stringify({ thresholds: THRESHOLDS, generatedAt: new Date().toISOString(), results }, null, 2);
  writeFileSync(join(out, 'variety.json'), stripped);
  const lines = Object.entries(results).map(([n, r]) => summaryLine(n, r));
  writeFileSync(join(out, 'variety.txt'), `thresholds: ${JSON.stringify(THRESHOLDS)}\n${lines.join('\n')}\n`);
  console.log('wrote', join(out, 'variety.json').slice(root.length + 1));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
