import type { Texture, WebGPURenderer } from 'three/webgpu';

/** Pinned r186 boundary. Native resources remain owned by their Three wrappers. */
export function sharedBackend(renderer: WebGPURenderer) {
  const backend = renderer.backend as unknown as {
    isWebGPUBackend?: boolean;
    device: GPUDevice;
    get(resource: object): { texture?: GPUTexture };
  };
  if (!renderer.hasInitialized() || !backend.isWebGPUBackend || !backend.device) {
    throw new Error('Clouds requires an initialized Three WebGPU renderer.');
  }
  return {
    device: backend.device,
    texture(texture: Texture): GPUTexture {
      const native = backend.get(texture).texture;
      if (!native) throw new Error(`GPU texture is not initialized: ${texture.name}`);
      return native;
    },
  };
}
