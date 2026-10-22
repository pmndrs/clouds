// Cloud shadows for three materials (P10-B). The runtime's shadow map (two r32float cascades of sun-ray optical depth, P10-A) is copied
// into three StorageTextures once per frame, and `cloudShadow(positionNode)` is the TSL port of the runtime's `cloudShadowTau` lookup
// plus the soft optical-depth-to-light curve the composite uses. 1 = sunlit, 0 = fully shadowed.
import { FloatType, NearestFilter, RedFormat, Vector4 } from 'three';
import { StorageTexture } from 'three/webgpu';
import * as TSL from 'three/tsl';
import type { CloudRuntime } from '@clouds/runtime';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;
// The TSL helpers are used loosely typed here (mixed int/float vector maths), like the rest of the adapter's node code.
const { Fn, float, floor, ivec2, max, min, mix, mod, select, positionWorld, renderGroup, saturate, texture, uniform, vec2, exp } = TSL as unknown as Record<string, AnyNode>;

export interface CloudShadowTextures {
  readonly near: StorageTexture;
  readonly far: StorageTexture;
}

export interface CloudShadowState {
  /** TSL: sun visibility 0..1 at a world position (default `positionWorld`). */
  node(positionNode?: AnyNode): AnyNode;
  readonly textures: CloudShadowTextures;
  /** Per frame, after the runtime encoded: refresh the uniforms. Returns the GPU copies still to record (textures backed by three). */
  update(runtime: CloudRuntime): void;
  dispose(): void;
}

export function createCloudShadow(runtime: CloudRuntime): CloudShadowState {
  const N = runtime.shadowMap.resolution;
  const make = (name: string) => {
    const t = new StorageTexture(N, N);
    t.type = FloatType; t.format = RedFormat; t.minFilter = t.magFilter = NearestFilter; t.generateMipmaps = false; t.name = name;
    return t;
  };
  const textures: CloudShadowTextures = { near: make('cloud shadow near'), far: make('cloud shadow far') };
  // renderGroup: these are written every frame from the adapter's updateBefore; in the default per-object group a uniform that only a light's shadowNode reads was never re-uploaded.
  const uSun = uniform(new Vector4(0, 1, 0, 0)).setGroup(renderGroup);    // xyz sun, w plane height
  const uNear = uniform(new Vector4(0, 0, 8, 0)).setGroup(renderGroup);   // window min cell xy, cell size, window size (0 = absent)
  const uFar = uniform(new Vector4(0, 0, 64, 0)).setGroup(renderGroup);
  const uMisc = uniform(new Vector4(0, 16, 0.6, 0)).setGroup(renderGroup); // valid, blend cells, strength
  const uAdv = uniform(new Vector4(0, 0, 0, 0)).setGroup(renderGroup);     // SH1: xy = how far the clouds have moved since the map's snapshot (m)
  
  // (tau, weight) of one cascade at plane point q.
  const cascade = (tex: StorageTexture, c: AnyNode, q: AnyNode) => {
    const u: AnyNode = q.div(max(c.z, float(1e-3))).sub(0.5);
    const b: AnyNode = floor(u);
    const f: AnyNode = u.sub(b);
    const rel: AnyNode = b.sub(c.xy);
    const i0: AnyNode = ivec2(mod(b, float(N))), i1: AnyNode = ivec2(mod(b.add(1), float(N)));
    const load = (x: AnyNode, y: AnyNode): AnyNode => (texture(tex) as AnyNode).load(ivec2(x, y)).x;
    const tau = mix(mix(load(i0.x, i0.y), load(i1.x, i0.y), f.x), mix(load(i0.x, i1.y), load(i1.x, i1.y), f.x), f.y);
    const e: AnyNode = min(min(rel.x, rel.y), min(c.w.sub(2).sub(rel.x), c.w.sub(2).sub(rel.y)));
    const inside: AnyNode = e.greaterThanEqual(0).and(c.w.greaterThanEqual(2));
    return vec2(select(inside, tau, float(0)), select(inside, saturate(e.div(max(uMisc.y, float(1)))), float(0)));
  };

  const node = (positionNode: AnyNode = positionWorld) => Fn(() => {
    const p = positionNode;
    const q = p.xz.add(uSun.xz.mul(uSun.w.sub(p.y).div(max(uSun.y, float(1e-3))))).sub(uAdv.xy);
    const nr = cascade(textures.near, uNear, q);
    const fr = cascade(textures.far, uFar, q);
    const tau = nr.x.mul(nr.y).add(float(1).sub(nr.y).mul(fr.x).mul(fr.y));
    const soft = exp(tau.negate()).mul(0.8).add(exp(tau.mul(-0.25)).mul(0.2));
    return mix(float(1), mix(float(1), soft, uMisc.z), uMisc.x);
  })();

  return {
    node, textures,
    update(rt) {
      const sm = rt.shadowMap, p = sm.params;
      (uSun.value as Vector4).set(p[0], p[1], p[2], p[3]);
      (uNear.value as Vector4).set(p[4], p[5], p[6], p[7]);
      (uFar.value as Vector4).set(p[8], p[9], p[10], p[11]);
      (uMisc.value as Vector4).set(sm.info.valid ? 1 : 0, p[13], rt.settings.shadowStrength, 0);
      (uAdv.value as Vector4).set(p[28], p[29], 0, 0);
    },
    dispose() { textures.near.dispose(); textures.far.dispose(); },
  };
}
