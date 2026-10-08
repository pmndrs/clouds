// Glue between a @pmndrs/sky Sky and the runtime's atmosphere WGSL (packages/runtime/src/shaders/atmosphere.wgsl.ts).
// Resolves the sky's LUTs to raw GPU texture views once, then writes the uniform each frame with no allocation.
import { Matrix4, type PerspectiveCamera, type Vector3, type WebGPURenderer } from 'three/webgpu';
import type { Sky } from '@pmndrs/sky';
import {
  ATMOSPHERE_UNIFORM_FLOATS, ATMOSPHERE_UNIFORM_BYTES, createAtmosphereBindGroup, createAtmosphereBindGroupLayout, createAtmosphereSampler,
  writeAtmosphereUniforms, type AtmosphereUniformValues,
} from '../../../packages/runtime/src/shaders/atmosphere.wgsl';
import { sharedBackend } from '../../../packages/three/src/gpu/backend';

export interface SkyBridgeOptions {
  /** World-space planet centre in metres, for `sky.update(camera, { planetCenter })`. Omit for the sky's flat convention (y = altitude). */
  planetCenter?: Vector3 | null;
}

export interface SkyBridge {
  readonly device: GPUDevice;
  /** Layout for atmosphereWgsl(group). Share it between passes. */
  readonly layout: GPUBindGroupLayout;
  readonly sampler: GPUSampler;
  readonly uniformBuffer: GPUBuffer;
  /** CPU copy of the uniform, rewritten by update(). */
  readonly data: Float32Array;
  readonly values: AtmosphereUniformValues;
  transmittance: GPUTextureView;
  skyView: GPUTextureView;
  aerialPerspective: GPUTextureView;
  /** Bind group for the current views. Rebuilt only by rebind(). */
  bindGroup: GPUBindGroup;
  /**
   * Copy the sky's current state into the uniform and upload it. Call after sky.update(camera) each frame.
   * `camera` must be the camera passed to sky.update (the AP LUT is built from it).
   */
  update(camera: PerspectiveCamera): void;
  /** Re-resolve the LUT textures (after a Sky quality or LUT size change) and rebuild the bind group. */
  rebind(): void;
  dispose(): void;
}

export function createSkyBridge(renderer: WebGPURenderer, sky: Sky, options: SkyBridgeOptions = {}): SkyBridge {
  const backend = sharedBackend(renderer);
  const device = backend.device;
  const baker = sky.baker as any;
  const layout = createAtmosphereBindGroupLayout(device);
  const sampler = createAtmosphereSampler(device);
  const uniformBuffer = device.createBuffer({ label: 'atmosphere uniform', size: ATMOSPHERE_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const data = new Float32Array(ATMOSPHERE_UNIFORM_FLOATS);

  // Used when the sky was built with enableAerialPerspective: false: 1x1x1 zero volume, apEnabled stays 0.
  const dummy = device.createTexture({ label: 'atmosphere AP dummy', dimension: '3d', size: [1, 1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
  const apLut = baker.aerialPerspectiveLUT ?? null;

  const values: AtmosphereUniformValues = {
    sunDirection: [0, 1, 0], luminanceScale: 1, sunColor: [1, 1, 1],
    bottomRadiusKm: 6360, topRadiusKm: 6460,
    planetCenter: [0, 0, 0], flat: !options.planetCenter, cameraUp: [0, 1, 0], skyViewHeightKm: 6360,
    apKmPerSlice: apLut?.kmPerSlice ?? 8, apDepthSlices: apLut?.resolution?.z ?? 32, apEnabled: !!apLut,
    viewRotProj: new Float32Array(16),
  };
  const sunDir = values.sunDirection as number[];
  const sunColor = values.sunColor as number[];
  const planetCenter = values.planetCenter as number[];
  const cameraUp = values.cameraUp as number[];
  const viewRotProj = values.viewRotProj as Float32Array;
  const scratch = new Matrix4();
  if (options.planetCenter) { planetCenter[0] = options.planetCenter.x; planetCenter[1] = options.planetCenter.y; planetCenter[2] = options.planetCenter.z; }

  let transmittance!: GPUTextureView, skyView!: GPUTextureView, aerialPerspective!: GPUTextureView, bindGroup!: GPUBindGroup;
  const rebind = () => {
    transmittance = backend.texture(baker.transmittanceLUT.texture).createView();
    skyView = backend.texture(baker.skyViewLUT.texture).createView();
    aerialPerspective = apLut ? backend.texture(apLut.texture).createView({ dimension: '3d' }) : dummy.createView({ dimension: '3d' });
    bindGroup = createAtmosphereBindGroup(device, layout, { uniforms: uniformBuffer, transmittance, skyView, aerialPerspective, sampler });
    bridge.transmittance = transmittance; bridge.skyView = skyView; bridge.aerialPerspective = aerialPerspective; bridge.bindGroup = bindGroup;
  };

  const bridge: SkyBridge = {
    device, layout, sampler, uniformBuffer, data, values,
    transmittance: undefined as unknown as GPUTextureView, skyView: undefined as unknown as GPUTextureView, aerialPerspective: undefined as unknown as GPUTextureView,
    bindGroup: undefined as unknown as GPUBindGroup,
    update(camera) {
      const params = baker.atmosphereParams;
      const sun: Vector3 = baker._sunVec ?? baker.sky.sunDirection.value;
      const color: Vector3 = baker.sky.sunColor.value;
      const up: Vector3 = baker.cameraUp;
      sunDir[0] = sun.x; sunDir[1] = sun.y; sunDir[2] = sun.z;
      sunColor[0] = color.x; sunColor[1] = color.y; sunColor[2] = color.z;
      cameraUp[0] = up.x; cameraUp[1] = up.y; cameraUp[2] = up.z;
      values.luminanceScale = baker.sky.luminanceScale.value;
      values.bottomRadiusKm = params.bottomRadius;
      values.topRadiusKm = params.topRadius;
      values.skyViewHeightKm = baker.skyViewLUT.viewHeight;
      // projection * view, with the view translation dropped so a direction maps straight to clip space
      scratch.copy(camera.matrixWorldInverse);
      scratch.elements[12] = 0; scratch.elements[13] = 0; scratch.elements[14] = 0;
      scratch.premultiply(camera.projectionMatrix);
      for (let i = 0; i < 16; i++) viewRotProj[i] = scratch.elements[i];
      writeAtmosphereUniforms(data, values);
      device.queue.writeBuffer(uniformBuffer, 0, data.buffer, data.byteOffset, data.byteLength);
    },
    rebind,
    dispose() { uniformBuffer.destroy(); dummy.destroy(); },
  };
  rebind();
  return bridge;
}
