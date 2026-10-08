// three r186 <-> raw WebGPU boundary (pinned). Native resources stay owned by their three wrappers.
import type { Texture, WebGPURenderer } from 'three/webgpu';

export interface SharedBackend {
  readonly device: GPUDevice;
  /** The GPUTexture behind an initialised three texture. Throws until it is backed. */
  texture(texture: Texture): GPUTexture;
  /** Same, or null while not backed yet. */
  tryTexture(texture: Texture): GPUTexture | null;
}

export function sharedBackend(renderer: WebGPURenderer): SharedBackend {
  const backend = renderer.backend as unknown as {
    isWebGPUBackend?: boolean;
    device: GPUDevice;
    get(resource: object): { texture?: GPUTexture };
  };
  if (!renderer.hasInitialized() || !backend.isWebGPUBackend || !backend.device) {
    throw new Error('@clouds/three requires an initialized three WebGPURenderer (await renderer.init() first).');
  }
  return {
    device: backend.device,
    tryTexture: texture => backend.get(texture).texture ?? null,
    texture(texture) {
      const native = backend.get(texture).texture;
      if (!native) throw new Error(`GPU texture is not initialized: ${texture.name}`);
      return native;
    },
  };
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
/** float32 -> float16 bits (round to nearest, clamps to the finite half range). */
export function toHalfBits(value: number): number {
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  const mant = x & 0x7fffff;
  if (!Number.isFinite(value)) return sign | 0x7bff;
  if (exp >= 31) return sign | 0x7bff;
  if (exp <= 0) {
    if (exp < -10) return sign;
    const m = (mant | 0x800000) >> (1 - exp);
    return sign | ((m + 0x1000) >> 13);
  }
  return sign | (exp << 10) | ((mant + 0x1000) >> 13);
}
