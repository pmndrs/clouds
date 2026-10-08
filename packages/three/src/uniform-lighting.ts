// Lighting without a sky library: plain sun and ambient values presented to the runtime as a (synthetic) atmosphere.
// The runtime reads sun radiance from the transmittance LUT and ambient from the sky-view LUT, so a 1x1 transmittance
// texel holding the sun radiance and a 1xN sky-view column (upper half = ambientTop, lower half = ambientBottom) give
// exactly those values. Aerial perspective is off.
import { ATMOSPHERE_UNIFORM_BYTES, ATMOSPHERE_UNIFORM_FLOATS, createAtmosphereBindGroup, createAtmosphereSampler, writeAtmosphereUniforms, type AtmosphereUniformValues } from '@clouds/runtime';
import { toHalfBits } from './interop';

export type RGB = [number, number, number];
export interface UniformLightingValues {
  /** Unit vector toward the sun (world, y up). */
  sunDirection: [number, number, number];
  /** Sun illuminance at the clouds, linear RGB (what a DirectionalLight.intensity * colour means). */
  sunRadiance: RGB;
  /** Mean sky radiance of the upper and lower hemisphere, same units. */
  ambientTop: RGB;
  ambientBottom: RGB;
}
export const DEFAULT_UNIFORM_LIGHTING: UniformLightingValues = {
  sunDirection: [0.3, 0.8, 0.5],
  sunRadiance: [40, 38, 34],
  ambientTop: [6, 8, 12],
  ambientBottom: [2, 2.4, 1.6],
};

const SKY_ROWS = 64;

export interface UniformLighting {
  readonly layout: GPUBindGroupLayout;
  readonly bindGroup: GPUBindGroup;
  /** Live values; mutate freely, uploaded on the next update(). */
  readonly values: UniformLightingValues;
  /** Feeds CloudFrame.sunDirection. */
  readonly sunDirection: number[];
  update(): void;
  dispose(): void;
}

export function createUniformLighting(device: GPUDevice, layout: GPUBindGroupLayout, initial: Partial<UniformLightingValues> = {}): UniformLighting {
  const values: UniformLightingValues = { ...DEFAULT_UNIFORM_LIGHTING, ...initial };
  const sunDirection = [...values.sunDirection];
  const sampler = createAtmosphereSampler(device);
  const uniformBuffer = device.createBuffer({ label: 'uniform lighting', size: ATMOSPHERE_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
  const transmittance = device.createTexture({ label: 'uniform lighting sun', size: [1, 1], format: 'rgba16float', usage });
  const skyView = device.createTexture({ label: 'uniform lighting ambient', size: [1, SKY_ROWS], format: 'rgba16float', usage });
  const ap = device.createTexture({ label: 'uniform lighting ap', dimension: '3d', size: [1, 1, 1], format: 'rgba16float', usage });
  const bindGroup = createAtmosphereBindGroup(device, layout, {
    uniforms: uniformBuffer, transmittance: transmittance.createView(), skyView: skyView.createView(), aerialPerspective: ap.createView({ dimension: '3d' }), sampler,
  });
  const atmosphere: AtmosphereUniformValues = {
    sunDirection, luminanceScale: 1, sunColor: [1, 1, 1], bottomRadiusKm: 6360, topRadiusKm: 6460,
    planetCenter: [0, 0, 0], flat: true, cameraUp: [0, 1, 0], skyViewHeightKm: 6360,
    apKmPerSlice: 8, apDepthSlices: 32, apEnabled: false, viewRotProj: new Float32Array(16),
  };
  const uniformData = new Float32Array(ATMOSPHERE_UNIFORM_FLOATS);
  const half = new Uint16Array(SKY_ROWS * 4);
  let key = '';

  const update = () => {
    for (let i = 0; i < 3; i++) sunDirection[i] = values.sunDirection[i];
    const next = JSON.stringify([values.sunRadiance, values.ambientTop, values.ambientBottom]);
    if (next !== key) {
      key = next;
      const sun = new Uint16Array([...values.sunRadiance.map(toHalfBits), toHalfBits(1)]);
      device.queue.writeTexture({ texture: transmittance }, sun, { bytesPerRow: 8 }, [1, 1]);
      for (let r = 0; r < SKY_ROWS; r++) {
        const c = r < SKY_ROWS / 2 ? values.ambientTop : values.ambientBottom;
        half[r * 4] = toHalfBits(c[0]); half[r * 4 + 1] = toHalfBits(c[1]); half[r * 4 + 2] = toHalfBits(c[2]); half[r * 4 + 3] = toHalfBits(1);
      }
      device.queue.writeTexture({ texture: skyView }, half, { bytesPerRow: 8 }, [1, SKY_ROWS]);
    }
    writeAtmosphereUniforms(uniformData, atmosphere);
    device.queue.writeBuffer(uniformBuffer, 0, uniformData.buffer, uniformData.byteOffset, uniformData.byteLength);
  };
  update();
  return { layout, bindGroup, values, sunDirection, update, dispose() { uniformBuffer.destroy(); transmittance.destroy(); skyView.destroy(); ap.destroy(); } };
}
