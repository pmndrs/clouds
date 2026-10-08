import { describe, expect, it } from 'vitest';
import {
  LOD_CANONICAL_RESOLUTION,
  OPTICAL_TEST_TOLERANCES,
  LodResidencyController,
  createBlendedField,
  createCanonicalField,
  fixedDiagnosticRays,
  fixedRayErrors,
  integrateBlendedTransmittance,
  integrateTransmittance,
  r8UploadError,
  sampleTrilinear,
  volumeAverage,
  volumeAverageAxes,
} from './reference';

describe('bounded LOD representation reference', () => {
  const canonical = createCanonicalField();
  const coarse16 = volumeAverage(canonical, 16);
  const coarse32 = volumeAverage(canonical, 32);

  it('volume averages 64³ into the requested levels with identical bounds and identity', () => {
    expect(canonical.data).toHaveLength(LOD_CANONICAL_RESOLUTION ** 3);
    expect(coarse16.data).toHaveLength(16 ** 3);
    expect(coarse32.data).toHaveLength(32 ** 3);
    expect(coarse16.descriptor.id).toBe(canonical.descriptor.id);
    expect(coarse16.descriptor.revision).toBe(canonical.descriptor.revision);
    expect(coarse16.descriptor.bounds).toEqual(canonical.descriptor.bounds);
    expect(coarse32.descriptor.bounds).toEqual(canonical.descriptor.bounds);
    expect(canonical.data.some((value) => value > 0)).toBe(true);
    const small = { descriptor: { ...canonical.descriptor, dimensions: [4, 4, 4] as const }, data: Uint8Array.from({ length: 64 }, (_, i) => i) };
    expect([...volumeAverage(small, 2).data]).toEqual([11, 13, 19, 21, 43, 45, 51, 53]);
    for (let z = 0; z < 64; z++) for (let y = 0; y < 64; y++) {
      expect(canonical.data[0 + y * 64 + z * 64 * 64]).toBe(0);
      expect(canonical.data[63 + y * 64 + z * 64 * 64]).toBe(0);
    }
    for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) {
      expect(canonical.data[x + 0 * 64 + z * 64 * 64]).toBe(0);
      expect(canonical.data[x + 63 * 64 + z * 64 * 64]).toBe(0);
    }
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      expect(canonical.data[x + y * 64 + 0 * 64 * 64]).toBe(0);
      expect(canonical.data[x + y * 64 + 63 * 64 * 64]).toBe(0);
    }
  });

  it('samples coarse and fine at the same world coordinates and preserves homogeneous optical depth', () => {
    const homogeneous = { ...canonical, data: new Uint8Array(canonical.data.length).fill(255) };
    const coarse = volumeAverage(homogeneous, 16);
    const ray = fixedDiagnosticRays()[0];
    const expected = Math.exp(-640 * homogeneous.descriptor.extinctionScale);
    for (const weight of [0, 0.25, 0.5, 0.75, 1]) {
      expect(integrateBlendedTransmittance(coarse, homogeneous, weight, ray)).toBeCloseTo(expected, 10);
      expect(sampleTrilinear(coarse, [0, 1_450, 0])).toBeCloseTo(1, 10);
    }
    expect(sampleTrilinear(coarse, [LOD_CANONICAL_RESOLUTION * 100, 1_450, 0])).toBe(0);
  });

  it('reports fixed-ray coarse and mixed errors against the canonical field', () => {
    const errors = fixedRayErrors(coarse16, canonical);
    expect(errors.coarseMaxAbs).toBeGreaterThan(1e-6);
    expect(errors.coarseMaxAbs).toBeLessThanOrEqual(OPTICAL_TEST_TOLERANCES.coarseRayAbs);
    expect(errors.mixedAtHalfMaxAbs).toBeLessThanOrEqual(OPTICAL_TEST_TOLERANCES.mixedRayAbs);
    expect(errors.canonicalValues.every(Number.isFinite)).toBe(true);
    expect(r8UploadError(coarse16, canonical, 0.5)).toBeLessThanOrEqual(1 / 255 + 1e-6);
  });

  it('uses one effective field at every blend endpoint', () => {
    const atCoarse = createBlendedField(coarse16, canonical, 0);
    const atFine = createBlendedField(coarse16, canonical, 1);
    expect(atFine.data).toEqual(canonical.data);
    expect(atCoarse.data).not.toEqual(canonical.data);
    const ray = fixedDiagnosticRays()[0];
    expect(integrateTransmittance(atFine, ray)).toBeCloseTo(integrateTransmittance(canonical, ray), 9);
    expect(integrateTransmittance(atCoarse, ray)).toBeCloseTo(integrateBlendedTransmittance(coarse16, canonical, 0, ray), 3);
  });

  it('keeps coarse fallback while rejecting stale, reordered, and wrong-revision fine loads', () => {
    const controller = new LodResidencyController(canonical, coarse32);
    const first = controller.beginFineRequest();
    const second = controller.beginFineRequest();
    expect(controller.state).toBe('pending');
    expect(controller.resolveFine(first, canonical)).toBe(false);
    expect(controller.state).toBe('pending');
    expect(controller.resolveFine(second, { ...canonical, descriptor: { ...canonical.descriptor, revision: 99 } })).toBe(false);
    expect(controller.state).toBe('pending');
    expect(controller.resolveFine(second, canonical)).toBe(true);
    expect(controller.state).toBe('ready');
    expect(controller.resolveFine(second, canonical)).toBe(false);
    controller.evictFine();
    expect(controller.state).toBe('evicted');
    expect(controller.resolveFine(second, canonical)).toBe(false);
    const cancelled = controller.beginFineRequest();
    expect(controller.rejectFine(cancelled)).toBe(true);
    expect(controller.resolveFine(cancelled, canonical)).toBe(false);
    expect(controller.fine).toBeUndefined();
    const snapshot = controller.update(1_000);
    expect(snapshot.weight).toBe(0);
    expect(snapshot.requested).toBe(true);
  });

  it('exposes projected voxel size with hysteresis around the experimental thresholds', () => {
    const controller = new LodResidencyController(canonical, coarse16);
    const near = controller.update(1_000);
    expect(near.projectedVoxelPixels).toBeGreaterThan(near.weight);
    const token = controller.beginFineRequest();
    expect(controller.resolveFine(token, canonical)).toBe(true);
    expect(controller.update(1_000, 720, Math.PI / 3, 0.5).weight).toBeGreaterThan(0);
    const far = controller.update(50_000);
    expect(far.projectedVoxelPixels).toBeLessThan(1.5);
    expect(far.weight).toBe(0);
  });
});


describe('anisotropic LOD fields', () => {
  it('preserves vertical slices and uses the correct rectangular sampling strides', () => {
    const original = createCanonicalField(4);
    const input = { ...original, data: Uint8Array.from({ length: 64 }, (_, i) => i) };
    const field = volumeAverageAxes(input, [2, 4, 2]);
    expect(field.data.length).toBe(16);
    const [lo, hi] = [field.descriptor.bounds.min, field.descriptor.bounds.max];
    for (let z = 0; z < 2; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
      const expected = Math.round(2 * x + 4 * y + 32 * z + 8.5);
      const point = [lo[0] + (x + .5) * (hi[0] - lo[0]) / 2, lo[1] + (y + .5) * (hi[1] - lo[1]) / 4, lo[2] + (z + .5) * (hi[2] - lo[2]) / 2] as const;
      expect(field.data[x + y * 2 + z * 8]).toBe(expected);
      expect(sampleTrilinear(field, point)).toBeCloseTo(expected / 255, 12);
    }
  });
});
