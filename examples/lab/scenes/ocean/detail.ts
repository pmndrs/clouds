// Tileable slope map for small-scale water detail, baked once on the CPU at init (never rebaked, so no frame stalls).
// Each texel holds the (x, z) surface slope of a sum of integer-wavevector sine waves, so the tile wraps exactly.
import { DataTexture, HalfFloatType, LinearMipmapLinearFilter, LinearFilter, RepeatWrapping, RGBAFormat, DataUtils } from 'three';

export interface DetailTile {
  texture: DataTexture;
  /** Total slope variance of the tile (x plus z), for folding the faded part into roughness. */
  variance: number;
}

/**
 * @param size texels per side (power of two)
 * @param kMin,kMax wavenumber magnitude range in cycles per tile (wavelength = tile / k)
 * @param slopeRms target RMS slope magnitude (both axes)
 * @param spread angular spread around +X, radians (waves travel along the sampled uv's +x; the shader rotates uv by the wind)
 */
export function bakeDetailTile(size: number, kMin: number, kMax: number, slopeRms: number, spread: number, seed: number, waveCount = 160): DetailTile {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const waves: { kx: number; ky: number; a: number; ph: number }[] = [];
  const slope = Math.sqrt(2 / waveCount) * slopeRms; // per-wave slope amplitude (a*k) so RMS total = slopeRms
  for (let i = 0; i < waveCount; i++) {
    const k = kMin * Math.pow(kMax / kMin, rnd());
    const ang = (rnd() * 2 - 1) * spread + (rnd() < 0.5 ? 0 : 0) + (rnd() - 0.5) * 0.35; // travel angle (jittered so the integer lattice does not read as a grid)
    const kx = Math.round(Math.cos(ang) * k), ky = Math.round(Math.sin(ang) * k);
    if (kx === 0 && ky === 0) { i--; continue; }
    waves.push({ kx, ky, a: slope, ph: rnd() * Math.PI * 2 });
  }
  const data = new Uint16Array(size * size * 4);
  const two = (Math.PI * 2) / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sx = 0, sy = 0;
      for (const w of waves) {
        const c = w.a * Math.cos(two * (w.kx * x + w.ky * y) + w.ph);
        const n = Math.hypot(w.kx, w.ky);
        sx += c * (w.kx / n); sy += c * (w.ky / n);
      }
      const o = (y * size + x) * 4;
      data[o] = DataUtils.toHalfFloat(sx); data[o + 1] = DataUtils.toHalfFloat(sy); data[o + 2] = 0; data[o + 3] = DataUtils.toHalfFloat(1);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, HalfFloatType);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 8;
  texture.needsUpdate = true;
  return { texture, variance: waves.length * slope * slope * 0.5 };
}
