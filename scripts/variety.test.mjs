import { describe, expect, it } from 'vitest';
import { labelComponents, peakProminence, radialAutocorr, scoreFields, THRESHOLDS } from './variety.mjs';

const N = 256, NZ = 64, VOXEL = 8;
const b64 = a => Buffer.from(a).toString('base64');
/** A field of elliptical domes. `clouds`: { cx, cy, rx, ry, h, base, power } with columns of thickness h * (1 - d^2)^power. */
function field(clouds, meta = {}) {
  const thickness = new Uint8Array(N * N), baseZ = new Uint8Array(N * N).fill(255), topZ = new Uint8Array(N * N).fill(255);
  for (const c of clouds) {
    for (let y = Math.max(0, Math.floor(c.cy - c.ry)); y <= Math.min(N - 1, Math.ceil(c.cy + c.ry)); y++) for (let x = Math.max(0, Math.floor(c.cx - c.rx)); x <= Math.min(N - 1, Math.ceil(c.cx + c.rx)); x++) {
      const d2 = ((x - c.cx) / c.rx) ** 2 + ((y - c.cy) / c.ry) ** 2;
      if (d2 >= 1) continue;
      const t = Math.round(c.h * (1 - d2) ** (c.power ?? 0.5)); if (t < 1) continue;
      const i = y * N + x; thickness[i] = Math.min(NZ - c.base, t); baseZ[i] = c.base; topZ[i] = c.base + thickness[i] - 1;
    }
  }
  return { size: [N, N, NZ], voxel: VOXEL, thickness: b64(thickness), baseZ: b64(baseZ), topZ: b64(topZ), meta: { extentMeters: N * VOXEL, ...meta } };
}
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

describe('variety metrics', () => {
  it('labels 8-connected components and flags the box edge', () => {
    const m = new Uint8Array(16 * 16); m[0] = 1; m[17] = 1; m[5 * 16 + 8] = 1;
    const { comps } = labelComponents(m, 16, 16);
    expect(comps.map(c => c.area).sort()).toEqual([1, 2]);
    expect(comps.filter(c => c.edge).length).toBe(1);
  });

  it('finds a bump in the autocorrelation of a regular lattice, none in a random field', () => {
    const lattice = new Uint8Array(N * N), noise = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      lattice[y * N + x] = ((x % 40) - 20) ** 2 + ((y % 40) - 20) ** 2 < 81 ? 1 : 0;
      noise[y * N + x] = rnd() < 0.3 ? 1 : 0;
    }
    const a = radialAutocorr(lattice, N, N, 80), b = radialAutocorr(noise, N, N, 80);
    expect(a.r[0]).toBeCloseTo(1, 1);
    expect(peakProminence(a.r, 20, 64).prominence).toBeGreaterThan(0.2);
    expect(peakProminence(b.r, 20, 64).prominence).toBeLessThan(0.05);
  });

  it('scores a lattice of identical domes as cloned, and varied clouds as different', () => {
    const clones = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) clones.push({ cx: 32 + i * 64, cy: 32 + j * 64, rx: 22, ry: 22, h: 30, base: 4 });
    const varied = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const r = 8 + rnd() * 24, wide = 0.5 + rnd() * 1.8;
      varied.push({ cx: 32 + i * 64 + (rnd() - 0.5) * 12, cy: 32 + j * 64 + (rnd() - 0.5) * 12, rx: Math.min(30, r * wide), ry: Math.min(30, r / wide + 4), h: 6 + rnd() * 50, base: Math.floor(rnd() * 24), power: 0.2 + rnd() * 1.2 });
    }
    const a = scoreFields(field(clones, { weather: { cellScale: 4 } }));
    const b = scoreFields(field(varied, { weather: { cellScale: 4 } }));
    expect(a.measures.cloneScore).toBeGreaterThan(0.9);
    expect(b.measures.cloneScore).toBeLessThan(a.measures.cloneScore - 0.15);
    expect(a.measures.footprintCv).toBeLessThan(0.2);
    expect(b.measures.footprintCv).toBeGreaterThan(a.measures.footprintCv + 0.3);
    expect(a.measures.baseSpreadM).toBe(0);
    expect(b.measures.baseSpreadM).toBeGreaterThan(THRESHOLDS.baseSpreadM.max);
    expect(a.measures.autocorrPeak).toBeGreaterThan(THRESHOLDS.autocorrPeak.max); // regular lattice at the cell spacing: fails
    expect(a.pass).toBe(false);
  });
});
