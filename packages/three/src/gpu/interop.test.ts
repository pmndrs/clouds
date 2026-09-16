import { describe, expect, it } from 'vitest';
import type { WebGPURenderer } from 'three/webgpu';
import { createInteropProbe, INTEROP_PROBE_SIZE } from './interop';

function uninitializedRenderer(): WebGPURenderer {
  return { init: async () => {}, hasInitialized: () => false } as unknown as WebGPURenderer;
}

describe('Three/WebGPU interop probe lifecycle', () => {
  it('creates the pinned 16 cubed diagnostic and resizes before GPU initialization', async () => {
    const probe = createInteropProbe(uninitializedRenderer());
    expect(probe.texture.image).toMatchObject({ width: INTEROP_PROBE_SIZE, height: INTEROP_PROBE_SIZE });
    expect(probe.volumeTexture.image).toMatchObject({ width: INTEROP_PROBE_SIZE, height: INTEROP_PROBE_SIZE, depth: INTEROP_PROBE_SIZE });

    await probe.resize(8);
    expect(probe.texture.image).toMatchObject({ width: 8, height: 8 });
    expect(probe.volumeTexture.image).toMatchObject({ width: 8, height: 8, depth: 8 });
    probe.dispose();
    probe.dispose();
    await expect(probe.resize(4)).rejects.toThrow('disposed');
  });

  it('rejects unsupported dimensions and reports a missing WebGPU backend at run time', async () => {
    const renderer = uninitializedRenderer();
    expect(() => createInteropProbe(renderer, 1)).toThrow('between 2 and 256');
    const probe = createInteropProbe(renderer);
    await expect(probe.run()).rejects.toThrow('WebGPU backend');
    probe.dispose();
  });
});
