// A small calm pool (the onsen): a disc of physical water with a few slow analytic ripples. Reflects the sky through three's IBL and, optionally,
// extra radiance such as `dir => clouds.reflection(dir)` (rgb = radiance added, a = what the environment shows through it), like the ocean module.
import { CircleGeometry, type Scene } from 'three';
import { LightingNode, Mesh, MeshPhysicalNodeMaterial } from 'three/webgpu';
import { cameraViewMatrix, cameraWorldMatrix, normalize, normalView, positionViewDirection, positionWorld, uniform, vec3, vec4, cos, float, dot, vec2 } from 'three/tsl';

export interface PoolOptions {
  x: number; z: number; /** Water surface height. */ level: number; radius: number;
  /** Water body colour (linear). Default a milky mineral turquoise. */
  color?: [number, number, number];
  /** Ripple slope multiplier (1 = a barely moving hot spring). */
  ripple?: number;
  reflection?: (dir: any) => any;
}
export interface Pool { readonly mesh: Mesh; update(dt: number): void; dispose(): void }

/** Applies `env * T + rgb` to the specular IBL radiance, after three's own EnvironmentNode has written it. */
class ReflectionLighting extends LightingNode {
  constructor(private readonly env: any, private readonly reflection: (dir: any) => any) { super(); }
  setup(builder: any): null {
    this.env?.setup(builder);
    const dir = positionViewDirection.negate().reflect(normalView).normalize().transformDirection(cameraWorldMatrix);
    const c = this.reflection(dir);
    const radiance = builder.context.radiance;
    radiance.assign(radiance.mul(c.a).add(c.rgb));
    return null;
  }
}

export function createPool(scene: Scene, o: PoolOptions): Pool {
  const material = new MeshPhysicalNodeMaterial({ ior: 1.333, metalness: 0, roughness: 0.035 });
  if (o.reflection) {
    const hook = o.reflection, base = material.setupEnvironment.bind(material);
    material.setupEnvironment = (builder: any) => new ReflectionLighting(base(builder), hook) as any;
  }
  const uTime = uniform(0);
  const gain = o.ripple ?? 1;
  // Ripple slopes: a handful of crossing sine waves (wavenumber, heading, slope amplitude, speed), summed analytically.
  const waves = [[2.6, 0.4, 0.010, 0.7], [4.1, 2.1, 0.008, 0.9], [6.3, 3.9, 0.007, 1.2], [9.4, 1.0, 0.006, 1.5], [13.7, 5.2, 0.004, 1.9], [3.3, 4.6, 0.009, 0.6]] as const;
  const p = vec2(positionWorld.x, positionWorld.z);
  let sx: any = float(0), sz: any = float(0);
  for (const [k, ang, a, w] of waves) {
    const d = vec2(Math.cos(ang), Math.sin(ang));
    const c = cos(dot(d, p).mul(k).sub(uTime.mul(w)).add(ang * 3)).mul(a * gain);
    sx = sx.add(c.mul(d.x)); sz = sz.add(c.mul(d.y));
  }
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(normalize(vec3(sx.negate(), 1, sz.negate())), 0)).xyz);
  material.colorNode = vec3(...(o.color ?? [0.03, 0.15, 0.15]));
  const mesh = new Mesh(new CircleGeometry(o.radius, 96).rotateX(-Math.PI / 2), material);
  mesh.position.set(o.x, o.level, o.z);
  mesh.receiveShadow = true;
  mesh.name = 'onsen pool';
  scene.add(mesh);
  return { mesh, update(dt) { uTime.value += dt; }, dispose() { scene.remove(mesh); mesh.geometry.dispose(); material.dispose(); } };
}
