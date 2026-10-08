import { type DirectionalLight, type WebGPURenderer } from 'three/webgpu';
import { sharedBackend } from '../../gpu/backend';

/** Number of float32 values in the group-2 directional shadow uniform. */
export const DIRECTIONAL_SHADOW_UNIFORM_FLOATS = 20;
export const DIRECTIONAL_SHADOW_UNIFORM_BYTES = DIRECTIONAL_SHADOW_UNIFORM_FLOATS * 4;

export interface DirectionalShadowSnapshot {
  /** mat4 column-major, then bias, map width, map height, enabled. */
  values: Float32Array<ArrayBuffer>;
  /** Native depth texture, or null when the designated sun has no map. */
  texture: GPUTexture | null;
}

function disabledSnapshot(): DirectionalShadowSnapshot {
  return { values: new Float32Array(new ArrayBuffer(DIRECTIONAL_SHADOW_UNIFORM_BYTES)), texture: null };
}

/**
 * Packs the current Three shadow matrix and map metadata into the WGSL
 * contract. This pure helper intentionally does not update shadow matrices:
 * callers invoke it after `renderer.render`, when Three has rendered the
 * current geometry into `light.shadow.map`.
 */
export function packDirectionalShadowValues(
  light: DirectionalLight,
  width: number,
  height: number,
  enabled = true,
): Float32Array<ArrayBuffer> {
  const values = new Float32Array(new ArrayBuffer(DIRECTIONAL_SHADOW_UNIFORM_BYTES));
  if (!enabled || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return values;
  if (!light.shadow.matrix.elements.every(Number.isFinite)) return values;
  light.shadow.matrix.toArray(values, 0);
  values[16] = Number.isFinite(light.shadow.bias) ? light.shadow.bias : 0;
  values[17] = width;
  values[18] = height;
  values[19] = 1;
  return values;
}

/**
 * Returns the native directional shadow depth map after a Three render.
 *
 * Three's `LightShadow.matrix` is the projection into normalized shadow-map
 * coordinates, with the WebGPU z range already [0, 1]. `sceneShadowAt` flips
 * y once to match Three's `ShadowNode.setupShadowCoord` convention and uses
 * `shadow.bias` in the same normalized-depth comparison. No cloud-cache state
 * is consulted: a moving caster therefore changes this map independently of
 * cache invalidation.
 */
export function getDirectionalShadowSnapshot(
  renderer: WebGPURenderer,
  light: DirectionalLight | null,
): DirectionalShadowSnapshot {
  if (!light || light.castShadow !== true || renderer.shadowMap.enabled === false) return disabledSnapshot();

  const map = light.shadow.map;
  const depthTexture = map?.depthTexture ?? null;
  if (!depthTexture) return disabledSnapshot();

  const image = depthTexture.image as { width?: number; height?: number } | undefined;
  const width = Number(image?.width ?? light.shadow.mapSize.x);
  const height = Number(image?.height ?? light.shadow.mapSize.y);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return disabledSnapshot();

  // Use the backend's resource table rather than reaching into private Three
  // properties. If the map is not initialized yet, treat it as illuminated;
  // this is also what the root's 1x1 fallback texture represents.
  let texture: GPUTexture;
  try {
    texture = sharedBackend(renderer).texture(depthTexture);
  } catch {
    return disabledSnapshot();
  }

  return {
    values: packDirectionalShadowValues(light, width, height),
    texture,
  };
}
