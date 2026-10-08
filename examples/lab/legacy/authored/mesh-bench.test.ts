import { describe, expect, it } from 'vitest';
import { createMeshBench } from './mesh-bench';

describe('authored mesh testbench', () => {
  it('converts a closed sphere into a bounded dense field with metadata', () => {
    const result = createMeshBench({ shape: 'sphere', resolution: 16, softness: 0.08 });
    try {
      expect(result.triangleCount).toBeGreaterThan(100);
      expect(result.field.source).toBe('mesh-occupancy');
      expect(result.field.descriptor.dimensions).toEqual([16, 16, 16]);
      expect(result.field.data.some(value => value === 255)).toBe(true);
      expect(result.field.data.some(value => value === 0)).toBe(true);
    } finally { result.dispose(); }
  });

  it('keeps the concave torus hole empty after conversion', () => {
    const result = createMeshBench({ shape: 'torus', resolution: 16, softness: 0 });
    try {
      const [width, height] = result.field.descriptor.dimensions;
      const center = 8 + 8 * width + 8 * width * height;
      expect(result.field.data[center]).toBe(0);
      expect(result.field.data.some(value => value > 0)).toBe(true);
    } finally { result.dispose(); }
  });

  it('rejects unbounded benchmark settings', () => {
    expect(() => createMeshBench({ shape: 'sphere', resolution: 64 as 16, softness: 0 })).toThrow(/resolution/i);
    expect(() => createMeshBench({ shape: 'torus', resolution: 32, softness: -0.1 })).toThrow(/falloff/i);
  });
});
