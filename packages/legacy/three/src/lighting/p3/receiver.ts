import {
  NodeMaterial,
  Storage3DTexture,
  Vector3,
  Vector4,
  type Texture,
} from 'three/webgpu';
import {
  Fn,
  If,
  float,
  positionWorld,
  renderGroup,
  texture3D,
  uniform,
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

/** The fixed vertical extent used by the cloud light cache. */
export const CLOUD_CACHE_Y_MIN = 0;
export const CLOUD_CACHE_Y_MAX = 4000;
// Rasterized geometry on the y=0 plane can arrive as a tiny negative value
// after a -PI/2 rotation. Keep that boundary stable without opening a useful
// out-of-bounds region; the sampled coordinate is clamped below.
const CLOUD_CACHE_BOUNDARY_EPSILON = 0.01;

type ShadowValue = Node<'float'>;
type ShadowNodeHook = ((shadow: ShadowValue) => ShadowValue) & (() => ShadowValue);

interface AttachedMaterial {
  previous: NodeMaterial['receivedShadowNode'];
  hook: ShadowNodeHook;
}

// A material hook is shared by every view using that material. Stacking runtime
// hooks would multiply unrelated caches and retain disposed textures when
// runtimes are removed out of order. Require an explicit detach/attach handoff.
const materialOwners = new WeakMap<NodeMaterial, object>();

/**
 * A bounded cloud receiver for Three's NodeMaterial shadow hook.
 *
 * The cache is addressed in world space. The x/z bounds are supplied by
 * `setBounds`; y is always [0, 4000], matching the cloud light-cache dispatch.
 * Coordinates outside the box return unit transmittance. The hook wraps an
 * existing `receivedShadowNode`, so a material's own shadow customization is
 * evaluated first.
 *
 * There is intentionally one cache and one hook for a fixture. Attach this to
 * the materials that receive the designated sun's shadows. Three evaluates a
 * material hook for every shadow source, so this API is only well-defined for
 * a scene with one receiving directional light (the fixture's sun).
 */
export function createCloudShadowReceiver(lightCache: Storage3DTexture) {
  if (!lightCache || lightCache.is3DTexture !== true) {
    throw new Error('Cloud shadow receiver requires a 3D light cache texture.');
  }

  // Storage3DTexture is also exposed as a sampled texture by the WebGPU
  // backend. `texture3D` gives the receiver a texture_3d<f32> binding while
  // the same object remains usable by the cache compute pass.
  const cache = texture3D(lightCache as unknown as Texture);
  const boundsLo = uniform(new Vector4(-1, CLOUD_CACHE_Y_MIN, -1, 0)).setGroup(renderGroup);
  const boundsHi = uniform(new Vector4(1, CLOUD_CACHE_Y_MAX, 1, 0)).setGroup(renderGroup);
  const enabled = uniform(0, 'float').setGroup(renderGroup);
  const attached = new Map<NodeMaterial, AttachedMaterial>();
  const owner = {};
  let disposed = false;

  const cloudTransmittance = Fn(() => {
    const world = positionWorld;
    const inside = world.x
      .greaterThanEqual(boundsLo.x)
      .and(world.x.lessThanEqual(boundsHi.x))
      .and(world.y.greaterThanEqual(float(CLOUD_CACHE_Y_MIN - CLOUD_CACHE_BOUNDARY_EPSILON)))
      .and(world.y.lessThanEqual(float(CLOUD_CACHE_Y_MAX + CLOUD_CACHE_BOUNDARY_EPSILON)))
      .and(world.z.greaterThanEqual(boundsLo.z))
      .and(world.z.lessThanEqual(boundsHi.z));
    const result = float(1).toVar('cloudShadowTransmittance');
    If(enabled.greaterThan(0.5).and(inside), () => {
      const size = boundsHi.sub(boundsLo).xyz;
      const uvw = world.sub(boundsLo.xyz).div(size).clamp(0, 1);
      result.assign(cache.sample(uvw).r);
    });
    return result;
  });

  function ensureAlive() {
    if (disposed) throw new Error('Cloud shadow receiver has been disposed.');
  }

  function attach(material: NodeMaterial) {
    ensureAlive();
    if (!material || typeof material !== 'object') throw new Error('A NodeMaterial is required.');
    if (attached.has(material)) return material;
    if (materialOwners.has(material)) throw new Error('This material already has a cloud shadow receiver. Detach it before assigning another runtime, or use a separate material per view.');

    const previous = material.receivedShadowNode;
    const hook = ((shadow: ShadowValue) => {
      // The public type in @types/three omits the argument even though Three's
      // ShadowNode invokes the callback with the current shadow node.
      const customized = previous
        ? (previous as unknown as (value: ShadowValue) => ShadowValue)(shadow)
        : shadow;
      return customized.mul(cloudTransmittance());
    }) as ShadowNodeHook;
    attached.set(material, { previous, hook });
    materialOwners.set(material, owner);
    material.receivedShadowNode = hook as unknown as NodeMaterial['receivedShadowNode'];
    material.needsUpdate = true;
    return material;
  }

  function detach(material: NodeMaterial) {
    ensureAlive();
    const record = attached.get(material);
    if (!record) return material;
    // If somebody replaced the hook while it was attached, preserve their
    // replacement rather than clobbering a later material customization.
    if (material.receivedShadowNode === (record.hook as unknown as NodeMaterial['receivedShadowNode'])) {
      material.receivedShadowNode = record.previous;
      material.needsUpdate = true;
    }
    attached.delete(material);
    if (materialOwners.get(material) === owner) materialOwners.delete(material);
    return material;
  }

  return {
    setBounds(min: Vector3, max: Vector3) {
      ensureAlive();
      const values = [...min.toArray(), ...max.toArray()];
      if (!values.every(Number.isFinite) || min.x >= max.x || min.z >= max.z) {
        throw new Error('Cloud shadow receiver bounds must be finite with positive x/z extent.');
      }
      boundsLo.value.set(min.x, CLOUD_CACHE_Y_MIN, min.z, 0);
      boundsHi.value.set(max.x, CLOUD_CACHE_Y_MAX, max.z, 0);
      return this;
    },
    setEnabled(value: boolean) {
      ensureAlive();
      enabled.value = value ? 1 : 0;
      return this;
    },
    attach,
    detach,
    get attachedCount() { return attached.size; },
    dispose() {
      if (disposed) return;
      for (const material of attached.keys()) {
        const record = attached.get(material);
        if (record && material.receivedShadowNode === (record.hook as unknown as NodeMaterial['receivedShadowNode'])) {
          material.receivedShadowNode = record.previous;
          material.needsUpdate = true;
        }
        if (materialOwners.get(material) === owner) materialOwners.delete(material);
      }
      attached.clear();
      disposed = true;
    },
  };
}
