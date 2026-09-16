import {
  BackSide,
  Color,
  Mesh,
  MeshBasicNodeMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three/webgpu';
import {
  Fn,
  Loop,
  clamp,
  dot,
  float,
  floor,
  fract,
  mix,
  normalize,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
  positionWorld,
  positionLocal,
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

/** A color/radiance value accepted by the lightweight layer. */
export type CloudLayerColor = number | Color | Vector3 | readonly [number, number, number];

/** Options for {@link createCloudLayer}. Distances are in scene world units. */
export interface CloudLayerOptions {
  /** Radius of the dome. Larger values make the horizon layer feel farther away. */
  readonly radius?: number;
  /** Height of the dome's apex. The dome center is `height - radius`. */
  readonly height?: number;
  /** Radial and vertical tessellation. Defaults are deliberately modest for a far layer. */
  readonly segments?: number;
  readonly rings?: number;
  /** World-space frequency of the projected cloud pattern. */
  readonly cloudScale?: number;
  /** Horizontal cloud advection in world units per second. */
  readonly wind?: readonly [number, number];
  /** Fraction of the noise field occupied by cloud. */
  readonly coverage?: number;
  /** Multiplier for the resulting alpha. */
  readonly density?: number;
  readonly sunDirection?: readonly [number, number, number] | Vector3;
  readonly sunColor?: CloudLayerColor;
  readonly ambientColor?: CloudLayerColor;
  /** Transparent objects are sorted after opaque scene geometry; this controls their local order. */
  readonly renderOrder?: number;
}

export interface CloudLayer {
  readonly mesh: Mesh<SphereGeometry, MeshBasicNodeMaterial>;
  /** Advance the deterministic animation clock. The host owns the render loop. */
  update(timeSeconds: number): void;
  /** Dispose the material, geometry and uniforms owned by this layer. */
  dispose(): void;
  setCoverage(value: number): void;
  setDensity(value: number): void;
  setWind(value: readonly [number, number]): void;
  setSunDirection(value: readonly [number, number, number] | Vector3): void;
  setSunColor(value: CloudLayerColor): void;
  setAmbientColor(value: CloudLayerColor): void;
}

const DEFAULT_SUN_DIRECTION = new Vector3(-0.36, 0.86, 0.28).normalize();

function finitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be finite and greater than zero.`);
  return value;
}

function unitDirection(value: readonly [number, number, number] | Vector3): Vector3 {
  const result = value instanceof Vector3 ? value.clone() : new Vector3(value[0], value[1], value[2]);
  if (result.lengthSq() < 1e-12 || !result.toArray().every(Number.isFinite)) {
    throw new Error('Cloud layer sunDirection must be a finite, non-zero vector.');
  }
  return result.normalize();
}

function colorVector(value: CloudLayerColor, fallback: Vector3): Vector3 {
  if (value instanceof Vector3) return value.clone();
  if (value instanceof Color) return new Vector3(value.r, value.g, value.b);
  if (typeof value === 'number') {
    const color = new Color(value);
    return new Vector3(color.r, color.g, color.b);
  }
  return new Vector3(value[0], value[1], value[2]);
}

function finiteUnitInterval(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1.`);
  return value;
}

/**
 * Creates an independent, low-cost high-cloud layer.
 *
 * The mesh is the inside of a transparent upper hemisphere. Fragment coordinates
 * project the animated procedural field from world XZ, so the layer follows the
 * scene's world scale and does not require a texture, voxel source, React or a
 * second renderer. `depthTest` remains enabled and `depthWrite` is disabled, so
 * opaque scene geometry hides clouds in front of it while the caller's background
 * remains visible through empty cloud regions.
 */
export function createCloudLayer(options: CloudLayerOptions = {}): CloudLayer {
  const radius = finitePositive(options.radius ?? 240, 'Cloud layer radius');
  const height = options.height ?? 90;
  if (!Number.isFinite(height)) throw new Error('Cloud layer height must be finite.');
  const segments = Math.max(16, Math.floor(options.segments ?? 96));
  const rings = Math.max(8, Math.floor(options.rings ?? 32));
  const cloudScale = finitePositive(options.cloudScale ?? 0.018, 'Cloud layer cloudScale');
  const initialCoverage = finiteUnitInterval(options.coverage ?? 0.53, 'Cloud layer coverage');
  const initialDensity = finiteUnitInterval(options.density ?? 0.74, 'Cloud layer density');
  const initialWind = new Vector2(options.wind?.[0] ?? 0.8, options.wind?.[1] ?? 0.13);
  if (!initialWind.toArray().every(Number.isFinite)) throw new Error('Cloud layer wind must be finite.');

  const sunDirection = unitDirection(options.sunDirection ?? DEFAULT_SUN_DIRECTION);
  const sunColor = colorVector(options.sunColor ?? 0xfff0d0, new Vector3(1, 0.94, 0.82));
  const ambientColor = colorVector(options.ambientColor ?? 0x7189b8, new Vector3(0.44, 0.54, 0.72));

  const clockNode = uniform(0);
  const scaleNode = uniform(cloudScale);
  const windNode = uniform(initialWind.clone());
  const coverageNode = uniform(initialCoverage);
  const densityNode = uniform(initialDensity);
  const sunDirectionNode = uniform(sunDirection.clone());
  const sunColorNode = uniform(sunColor.clone());
  const ambientColorNode = uniform(ambientColor.clone());

  // A deterministic, sinless gradient hash keeps the same cloud arrangement on
  // WebGPU implementations with different floating-point transcendental paths.
  const gradient = Fn<[Node<'vec2'>], Node<'vec2'>>(([i]) => {
    const p = fract(vec3(i.x, i.y, i.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
    p.addAssign(dot(p, p.yzx.add(33.33)));
    return fract(p.xx.add(p.yz).mul(p.zy)).mul(2).sub(1);
  });

  const gradientNoise = Fn<[Node<'vec2'>], Node<'float'>>(([p]) => {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10));
    const a = dot(gradient(i), f);
    const b = dot(gradient(i.add(vec2(1, 0))), f.sub(vec2(1, 0)));
    const c = dot(gradient(i.add(vec2(0, 1))), f.sub(vec2(0, 1)));
    const d = dot(gradient(i.add(vec2(1, 1))), f.sub(vec2(1, 1)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y).mul(1.6);
  });

  const fbm = Fn<[Node<'vec2'>, Node<'vec2'>], Node<'float'>>(([position, drift]) => {
    const p = vec2(position).toVar();
    const result = float(0).toVar();
    const amplitude = float(1).toVar();
    Loop(4, () => {
      result.addAssign(amplitude.mul(gradientNoise(p)));
      amplitude.mulAssign(0.5);
      p.mulAssign(2);
      p.addAssign(drift);
    });
    return result;
  });

  const colorNode = Fn(() => {
    const map = positionWorld.xz.mul(scaleNode).add(windNode.mul(clockNode).mul(scaleNode)).toVar();
    const drift = vec2(clockNode.mul(0.008), clockNode.mul(-0.005));
    const broad = fbm(map.mul(0.72), drift).mul(0.32).add(0.5);
    const detail = gradientNoise(map.mul(2.15).add(drift.mul(1.7))).mul(0.15).add(0.5);
    const shape = broad.mul(0.72).add(detail.mul(0.28)).clamp(0, 1);

    // A soft threshold leaves clean blue gaps while preserving wispy edges.
    // Coverage is monotonic: 0 is empty, 1 fills the broad noise field.
    const threshold = coverageNode.oneMinus().clamp(0, 1);
    const field = smoothstep(threshold, threshold.add(mix(0.18, 0.28, coverageNode)), shape).mul(
      smoothstep(0, 0.01, coverageNode),
    );
    // positionLocal is the outward geometric normal of this unit-centered
    // hemisphere. It is stable when the material is rendered from its BackSide.
    const shellNormal = normalize(positionLocal);
    const horizonLight = smoothstep(0.05, 0.78, shellNormal.y);
    const alpha = field.mul(densityNode).mul(horizonLight).clamp(0, 0.92);

    const sunFacing = dot(shellNormal, sunDirectionNode).clamp(0, 1);
    const silverEdge = field.mul(field.oneMinus()).mul(4).clamp(0, 1);
    const softShadow = mix(0.42, 1, field.mul(0.7).add(0.3));
    const lit = ambientColorNode.mul(0.42).add(sunColorNode.mul(sunFacing.mul(0.72).mul(softShadow)));
    const rim = sunColorNode.mul(silverEdge.mul(0.24));
    return vec4(lit.add(rim), alpha);
  })();

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: BackSide,
    colorNode,
  });
  material.name = 'cloud-layer-material';
  material.fog = false;

  // thetaLength π/2 is the upper hemisphere. The apex is at `height`; placing
  // the center below the camera gives a convincing curved horizon from inside.
  const geometry = new SphereGeometry(radius, segments, rings, 0, Math.PI * 2, 0, Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'cloud-layer';
  mesh.position.y = height - radius;
  mesh.renderOrder = options.renderOrder ?? -100;
  mesh.frustumCulled = false;

  let disposed = false;
  function ensureAlive(): void {
    if (disposed) throw new Error('Cloud layer has been disposed.');
  }
  function update(timeSeconds: number): void {
    ensureAlive();
    if (!Number.isFinite(timeSeconds)) throw new Error('Cloud layer time must be finite.');
    clockNode.value = timeSeconds;
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    mesh.visible = false;
    geometry.dispose();
    material.dispose();
  }

  return {
    mesh,
    update,
    dispose,
    setCoverage(value) { ensureAlive(); coverageNode.value = finiteUnitInterval(value, 'Cloud layer coverage'); },
    setDensity(value) { ensureAlive(); densityNode.value = finiteUnitInterval(value, 'Cloud layer density'); },
    setWind(value) {
      ensureAlive();
      if (!value.every(Number.isFinite)) throw new Error('Cloud layer wind must be finite.');
      windNode.value.set(value[0], value[1]);
    },
    setSunDirection(value) { ensureAlive(); sunDirectionNode.value.copy(unitDirection(value)); },
    setSunColor(value) { ensureAlive(); sunColorNode.value.copy(colorVector(value, sunColor)); },
    setAmbientColor(value) { ensureAlive(); ambientColorNode.value.copy(colorVector(value, ambientColor)); },
  };
}
