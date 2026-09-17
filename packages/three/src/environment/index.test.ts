import { describe, expect, it, vi } from 'vitest';
import { Vector3, WebGPUCoordinateSystem, type WebGPURenderer } from 'three/webgpu';

const { createCloudscapeMock } = vi.hoisted(() => ({ createCloudscapeMock: vi.fn() }));
vi.mock('../cloudscape', () => ({ createCloudscape: createCloudscapeMock }));
vi.mock('../gpu/backend', () => ({
  sharedBackend: () => ({ device: {}, texture: () => ({}) }),
}));

import { createCloudscapeEnvironment } from './index';
import { createCloudWorld } from '../world';
import { createCloudscapeAtlas } from '../sources/cloudscape-atlas';

function settings() {
  return {
    sunRadiance: new Vector3(1, 2, 3), ambientRadiance: new Vector3(4, 5, 6), hazeColor: new Vector3(7, 8, 9),
    hazeDensity: 0.1, hazeStrength: 0.2, density: 0.3, stepMetres: 24, maxSteps: 320, detail: 0.16,
    skipEmpty: true, distanceFade: true, earlyTermination: true, cachedLighting: true, shadows: true, geometryShadows: true, constantLight: false,
    sunDirection: new Vector3(0, 1, 0), casterMin: new Vector3(1, 2, 3), casterMax: new Vector3(4, 5, 6),
  };
}

function renderer(): WebGPURenderer {
  return {
    coordinateSystem: WebGPUCoordinateSystem,
    xr: { enabled: false },
    hasInitialized: () => true,
    backend: { isWebGPUBackend: true, device: {} },
    initRenderTarget: vi.fn(),
    getRenderTarget: () => null,
    getMRT: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setMRT: vi.fn(),
    setRenderTarget: vi.fn(),
    copyTextureToTexture: vi.fn(),
  } as unknown as WebGPURenderer;
}

describe('cloudscape environment capture contract', () => {
  it('owns an independent runtime, copies settings, and disables distance fading', () => {
    const sourceSettings = settings();
    const captureSettings = settings();
    const cloudscape = {
      settings: captureSettings,
      output: {},
      resize: vi.fn(),
      compile: vi.fn(async () => {}),
      render: vi.fn(),
      dispose: vi.fn(),
    };
    createCloudscapeMock.mockReturnValueOnce(cloudscape);
    const capture = createCloudscapeEnvironment(renderer(), createCloudscapeAtlas(4), createCloudWorld({ radius: 0 }).snapshot, {
      cubeSize: 4,
      probePosition: [12, 350, -8],
      settingsSource: { settings: sourceSettings },
    });

    expect(capture.probePosition.toArray()).toEqual([12, 350, -8]);
    expect(capture.cloudscape).toBe(cloudscape);
    expect(capture.cloudscape.settings.distanceFade).toBe(false);
    expect(capture.cloudscape.settings.sunRadiance.toArray()).toEqual(sourceSettings.sunRadiance.toArray());
    expect(capture.cloudscape.settings.sunRadiance).not.toBe(sourceSettings.sunRadiance);
    expect(capture.needsRefresh).toBe(true);
    capture.syncSunDirection([1, 2, 3]);
    expect(capture.cloudscape.settings.sunDirection.toArray()).toEqual(new Vector3(1, 2, 3).toArray());
    expect(() => capture.attach({ environment: null } as never)).toThrow(/refresh/i);
    capture.dispose();
    capture.dispose();
    expect(cloudscape.dispose).toHaveBeenCalledTimes(1);
    expect(() => capture.syncSunDirection([0, 1, 0])).toThrow(/disposed/i);
  });
});
