import { describe, expect, it } from 'vitest';
import { densityPayloadBytes, homogeneousTransmittance, type DensityDescriptor } from './index';
const density: DensityDescriptor = { id: 'reference', revision: 0, dimensions: [256,256,256], bounds: { min: [-1,-1,-1], max: [1,1,1] }, extinctionScale: 1, encoding: 'r16float' };
describe('density contract', () => {
  it('accounts for encoded payload before allocation', () => expect(densityPayloadBytes(density)).toBe(32 * 1024 * 1024));
  it('rejects unsafe or malformed allocations', () => {
    expect(() => densityPayloadBytes({...density, dimensions: [1e9,1e9,1e9]})).toThrow();
    expect(() => densityPayloadBytes({...density, dimensions: [0,2,2]})).toThrow();
    expect(() => densityPayloadBytes({...density, bounds: {min:[0,0,0],max:[0,1,1]}})).toThrow();
  });
  it('rejects incomplete metadata from untyped asset input', () => {
    for (const invalid of [null, {...density, id: 42}, {...density, dimensions: [2,2]}, {...density, bounds: {min: [0,0], max:[1,1,1]}}]) {
      expect(() => densityPayloadBytes(invalid as unknown as DensityDescriptor)).toThrow();
    }
  });
  it('preserves optical thickness under reciprocal scale changes', () => {
    expect(homogeneousTransmittance(0.2, 10)).toBeCloseTo(homogeneousTransmittance(0.1, 20));
    expect(homogeneousTransmittance(0, 100)).toBe(1);
    expect(() => homogeneousTransmittance(-1, 1)).toThrow();
  });
});
