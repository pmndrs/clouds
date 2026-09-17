import { describe, expect, it } from 'vitest';
import { DirectionalLight, MeshStandardNodeMaterial, Storage3DTexture, Vector3 } from 'three/webgpu';
import { float } from 'three/tsl';
import {
  createCloudShadowReceiver,
  getDirectionalShadowSnapshot,
  packDirectionalShadowValues,
  DIRECTIONAL_SHADOW_WGSL,
} from './index';

describe('P3 directional shadow bridge', () => {
  it('packs Three matrix values column-major with map metadata', () => {
    const light = new DirectionalLight();
    light.shadow.matrix.makeTranslation(2, 3, 4);
    const values = packDirectionalShadowValues(light, 256, 128);
    expect(Array.from(values.slice(0, 4))).toEqual([1, 0, 0, 0]);
    expect(Array.from(values.slice(12, 16))).toEqual([2, 3, 4, 1]);
    expect(Array.from(values.slice(16))).toEqual([0, 256, 128, 1]);
    expect(packDirectionalShadowValues(light, 0, 128)[19]).toBe(0);
  });

  it('attaches and detaches without losing an existing material hook', () => {
    const cache = new Storage3DTexture(4, 4, 4);
    const material = new MeshStandardNodeMaterial();
    const previous = () => float(0.75);
    material.receivedShadowNode = previous;
    const receiver = createCloudShadowReceiver(cache);

    receiver.setBounds(new Vector3(-10, 0, -20), new Vector3(30, 4000, 40));
    receiver.setEnabled(true);
    receiver.attach(material);
    expect(receiver.attachedCount).toBe(1);
    expect(material.receivedShadowNode).not.toBe(previous);
    receiver.detach(material);
    expect(receiver.attachedCount).toBe(0);
    expect(material.receivedShadowNode).toBe(previous);

    receiver.attach(material);
    receiver.dispose();
    expect(receiver.attachedCount).toBe(0);
    expect(material.receivedShadowNode).toBe(previous);
    material.dispose();
    cache.dispose();
  });

  it('returns an illuminated fallback for a missing map and exports the WGSL contract', () => {
    const light = new DirectionalLight();
    const snapshot = getDirectionalShadowSnapshot({ shadowMap: { enabled: true } } as never, light);
    expect(snapshot.texture).toBeNull();
    expect(snapshot.values[19]).toBe(0);
    expect(DIRECTIONAL_SHADOW_WGSL).toContain('@group(2) @binding(0)');
    expect(DIRECTIONAL_SHADOW_WGSL).toContain('fn sceneShadowAt(');
    expect(DIRECTIONAL_SHADOW_WGSL).toContain('textureLoad(directionalShadowMap');
  });
});

