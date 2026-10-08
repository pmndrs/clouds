// Reusable open-water scene module: a camera-following polar grid displaced by a Gerstner sum, shaded as a physical (ior 1.33) node material.
// Lighting is all from the scene: IBL reflection of scene.environment (the sky), the sky's sun light for the glint, plus a sun-driven scatter term.
// Detail LOD is per wave: waves smaller than the pixel footprint fade out and their lost slope variance is folded into roughness (no shimmer, no aliasing).
import { BufferAttribute, BufferGeometry, DirectionalLight, Vector3, type Object3D, type PerspectiveCamera, type Scene } from 'three';
import { bakeDetailTile } from './detail';
import { MeshPhysicalNodeMaterial, Mesh, type WebGPURenderer } from 'three/webgpu';
import {
  Fn, If, texture, vec2, positionGeometry, cameraViewMatrix, clamp, cos, dot, float, length, max, normalize, positionWorld, cameraPosition, pow, sin, smoothstep, uniform, vec3, vec4,
} from 'three/tsl';

/** The pieces of @pmndrs/sky this module reads. Kept structural so any Sky instance fits. */
export interface OceanSky { readonly sunElevation: number; readonly sunAzimuth: number }

export interface OceanSettings {
  /** Amplitude multiplier for all waves (1 = moderate open sea). */
  waveScale: number;
  /** Horizontal Gerstner displacement, 0 = pure sine, ~1 = sharp crests. */
  choppiness: number;
  /** Wind heading in degrees, direction the waves travel (0 = +X, 90 = +Z). */
  windDirection: number;
  /** Time multiplier. */
  speed: number;
  /** Base surface roughness before footprint-driven widening (0.02 = glassy). */
  roughness: number;
  /** Water body colour (linear), lit by the sky through the diffuse term. */
  waterColor: [number, number, number];
  /** Scatter tint (linear) added on thin crests when the sun is behind them. */
  scatterColor: [number, number, number];
  scatterStrength: number;
}

export interface OceanOptions extends Partial<OceanSettings> {
  /** The sun helper from sky.createSun() (or any DirectionalLight). Default: first DirectionalLight in the scene. */
  sun?: { light: DirectionalLight; target: Object3D } | DirectionalLight;
  /** Grid radius in metres. Default 150 km. */
  radius?: number;
  /** Rings in the polar grid. */
  rings?: number;
  segments?: number;
  /** Number of long analytic waves in the fragment sum (quality knob, max 12). */
  waves?: number;
  /** Water level (y). */
  level?: number;
}

export interface Ocean {
  readonly mesh: Mesh;
  readonly settings: OceanSettings;
  /** Seconds of wave time so far (scaled by settings.speed). */
  readonly time: number;
  update(dt: number, camera: PerspectiveCamera): void;
  /** CPU surface height (y, world) at world x, z for the current time: use it to keep a camera above a swell crest. Matches the vertex waves. */
  heightAt(x: number, z: number): number;
  dispose(): void;
}

const GRAVITY = 9.81;
const WAVE_COUNT = 12; // long analytic waves (geometry + fragment); small detail comes from baked slope tiles
const VERTEX_WAVES = 12;
const LAMBDA_MAX = 220, LAMBDA_MIN = 9;
const TILE_A = 24, TILE_B = 3.2; // metres per tile

interface Wave { k: number; dx: number; dz: number; omega: number; amp: number; phase: number }

/** Deterministic wave set; directions spread around the wind (wider for short waves), geometric wavelengths, slope ~ gentle power law. */
function buildWaves(): Wave[] {
  let s = 1337;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const waves: Wave[] = [];
  for (let i = 0; i < WAVE_COUNT; i++) {
    const t = i / (WAVE_COUNT - 1);
    const lambda = LAMBDA_MAX * Math.pow(LAMBDA_MIN / LAMBDA_MAX, t) * (0.92 + 0.16 * rnd());
    const k = (2 * Math.PI) / lambda;
    const spread = 0.3 + 0.5 * t; // radians
    const ang = (rnd() * 2 - 1) * spread + (rnd() * 2 - 1) * spread * 0.5;
    const slope = 0.045 * Math.pow(lambda / 6, 0.05); // a*k; long swell stays ~2 m
    waves.push({ k, dx: Math.cos(ang), dz: Math.sin(ang), omega: Math.sqrt(GRAVITY * k), amp: slope / k, phase: rnd() * Math.PI * 2 });
  }
  return waves;
}

/** Polar grid: rings grow geometrically from r0 to radius so spacing is ~constant in screen space. Centred on the origin. */
function buildGrid(rings: number, segments: number, r0: number, radius: number): BufferGeometry {
  const pos = new Float32Array(((rings + 1) * segments + 1) * 3);
  const ratio = Math.pow(radius / r0, 1 / rings);
  let o = 3; // vertex 0 = centre
  for (let r = 0; r <= rings; r++) {
    const rr = r0 * Math.pow(ratio, r);
    for (let a = 0; a < segments; a++) {
      const th = (a / segments) * Math.PI * 2;
      pos[o++] = Math.cos(th) * rr; pos[o++] = 0; pos[o++] = Math.sin(th) * rr;
    }
  }
  const idx: number[] = [];
  for (let a = 0; a < segments; a++) idx.push(0, 1 + ((a + 1) % segments), 1 + a); // centre fan
  for (let r = 0; r < rings; r++) {
    const b0 = 1 + r * segments, b1 = 1 + (r + 1) * segments;
    for (let a = 0; a < segments; a++) {
      const a1 = (a + 1) % segments;
      idx.push(b0 + a, b0 + a1, b1 + a, b0 + a1, b1 + a1, b1 + a);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export function createOcean(renderer: WebGPURenderer, scene: Scene, sky: OceanSky, options: OceanOptions = {}): Ocean {
  const settings: OceanSettings = {
    waveScale: 1, choppiness: 0.75, windDirection: 20, speed: 1, roughness: 0.04,
    waterColor: [0.004, 0.028, 0.04], scatterColor: [0.02, 0.35, 0.28], scatterStrength: 1.2,
    ...options,
  };
  const radius = options.radius ?? 150000;
  const level = options.level ?? 0;
  const waves = buildWaves();

  const uTime = uniform(0);
  const uWaveScale = uniform(settings.waveScale);
  const uChop = uniform(settings.choppiness);
  const uWind = uniform(0); // radians
  const uRough = uniform(settings.roughness);
  const uPixelAngle = uniform(0.0015); // radians per pixel (vertical)
  const uSunDir = uniform(new Vector3(0, 1, 0));
  const uSunE = uniform(new Vector3(0, 0, 0)); // light colour x intensity
  const uWater = uniform(new Vector3(...settings.waterColor));
  const uScatter = uniform(new Vector3(...settings.scatterColor));
  const uScatterK = uniform(settings.scatterStrength);
  const uCamXZ = uniform(new Vector3());

  const tileA = bakeDetailTile(256, 1, 14, 0.07, 0.7, 11), tileB = bakeDetailTile(256, 2, 26, 0.17, 0.9, 29);
  const uDetail = uniform(1);

  // Wind rotation applied to (dx, dz) in-shader so windDirection is live; per-wave constants stay JS literals.
  const cw = cos(uWind), sw = sin(uWind);

  /** Sum waves[from, to): returns displacement (xyz), slope (xz) and lost slope variance. `fade(lambda)` is the per-wave weight node. */
  const waveSum = (x: any, z: any, from: number, to: number, fade: (lambda: number) => any) => {
    const dy = float(0).toVar(), dxs = float(0).toVar(), dzs = float(0).toVar(), sx = float(0).toVar(), sz = float(0).toVar();
    let lost: any = float(0);
    for (let i = from; i < to; i++) {
      const w = waves[i];
      const wt = fade((2 * Math.PI) / w.k).toVar();
      const full = uWaveScale.mul(w.amp).mul(w.k);
      lost = lost.add(full.mul(full).mul(0.5).mul(float(1).sub(wt.mul(wt))));
      // waves below the pixel footprint contribute only their lost variance; skip their trig entirely
      If(wt.greaterThan(0.002), () => {
        const dX = cw.mul(w.dx).sub(sw.mul(w.dz)), dZ = sw.mul(w.dx).add(cw.mul(w.dz));
        const phi = float(w.k).mul(dX.mul(x).add(dZ.mul(z))).sub(uTime.mul(w.omega)).add(w.phase);
        const a = uWaveScale.mul(w.amp).mul(wt);
        const sn = sin(phi), cs = cos(phi);
        dy.addAssign(a.mul(sn));
        const h = a.mul(cs).mul(uChop);
        dxs.addAssign(h.mul(dX)); dzs.addAssign(h.mul(dZ));
        const ak = a.mul(w.k);
        sx.addAssign(ak.mul(cs).mul(dX)); sz.addAssign(ak.mul(cs).mul(dZ));
      });
    }
    return { dy, dxs, dzs, sx, sz, lost };
  };

  // ---- vertex: long waves displace the grid, faded by grid spacing at that range (~7% of radius) ----
  const material = new MeshPhysicalNodeMaterial({ ior: 1.333, metalness: 0, side: 0 });
  material.positionNode = Fn(() => {
    const wx = positionGeometry.x.add(uCamXZ.x), wz = positionGeometry.z.add(uCamXZ.z);
    const r = length(positionGeometry.xz);
    const spacing = max(r.mul(0.07), 0.3);
    const v = waveSum(wx, wz, 0, VERTEX_WAVES, lam => smoothstep(spacing.mul(5), spacing.mul(14), float(lam)));
    return vec3(positionGeometry.x.add(v.dxs), v.dy, positionGeometry.z.add(v.dzs));
  })();

  // ---- fragment: all waves, per-wave footprint fade, analytic normal ----
  const surfaceVec = Fn(() => {
    const dist = length(cameraPosition.sub(positionWorld));
    const footprint = dist.mul(uPixelAngle);
    // rest-position phase coordinates (exact linear interpolation of the grid), not the displaced position
    const wx = positionGeometry.x.add(uCamXZ.x), wz = positionGeometry.z.add(uCamXZ.z);
    const v = waveSum(wx, wz, 0, Math.min(WAVE_COUNT, options.waves ?? WAVE_COUNT), lam => smoothstep(footprint.mul(2), footprint.mul(7), float(lam)));
    // detail layers: slope tiles rotated by the wind and scrolled along it; two taps of the fine tile (rotated, different scale) break up repetition
    const rot = (p: any, c: any, sn: any) => vec2(p.x.mul(c).add(p.y.mul(sn)), p.y.mul(c).sub(p.x.mul(sn)));
    const p = vec2(wx, wz);
    const pr = rot(p, cw, sw);
    const wtA = smoothstep(footprint, footprint.mul(4), float(TILE_A / 5));
    const wtB = smoothstep(footprint, footprint.mul(4), float(TILE_B / 8));
    const sA = texture(tileA.texture, pr.div(TILE_A).add(vec2(uTime.mul(0.11), 0))).xy.mul(wtA);
    const sB1 = texture(tileB.texture, pr.div(TILE_B).add(vec2(uTime.mul(0.6), uTime.mul(0.05)))).xy.mul(wtB);
    const c2 = cos(0.6), s2 = sin(0.6);
    const sB2 = texture(tileB.texture, rot(pr.div(TILE_B * 1.37), float(c2), float(s2)).add(vec2(uTime.mul(-0.45), uTime.mul(0.2)))).xy.mul(wtB);
    // slopes are in the tile frame (+x = wind); rotate back to world
    const dsl = sA.add(sB1).add(sB2.mul(0.8)).mul(uDetail);
    const dw = vec2(dsl.x.mul(cw).sub(dsl.y.mul(sw)), dsl.x.mul(sw).add(dsl.y.mul(cw)));
    const varLost = float(tileA.variance).mul(float(1).sub(wtA.mul(wtA))).add(float(tileB.variance * 1.64).mul(float(1).sub(wtB.mul(wtB))));
    return vec4(v.sx.add(dw.x), v.sz.add(dw.y), v.lost.add(varLost), v.dy);
  })();
  const s = { n: normalize(vec3(surfaceVec.x.negate(), 1, surfaceVec.y.negate())), lost: surfaceVec.z, height: surfaceVec.w };
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(s.n, 0)).xyz);
  const r0 = uRough.mul(uRough);
  material.roughnessNode = clamp(pow(r0.mul(r0).add(s.lost.mul(0.3)), 0.25), 0.04, 0.6);
  material.colorNode = vec3(uWater);

  // Scatter: sun light seen through thin crests, stronger looking toward the sun, vanishing when the sun is down.
  material.emissiveNode = Fn(() => {
    const V = normalize(cameraPosition.sub(positionWorld));
    const sunUp = clamp(uSunDir.y.mul(4), 0, 1);
    const crest = clamp(s.height.mul(0.5).div(uWaveScale.mul(1.2)).add(0.5), 0, 1);
    const toward = pow(clamp(dot(V.negate(), uSunDir).mul(0.5).add(0.5), 0, 1), 3);
    const facing = pow(clamp(float(1).sub(dot(s.n, V)), 0, 1), 2);
    return uScatter.mul(uSunE).mul(uScatterK).mul(sunUp).mul(crest.mul(crest).mul(0.7).add(0.3)).mul(toward.mul(0.8).add(facing.mul(0.2))).mul(0.02);
  })();

  const mesh = new Mesh(buildGrid(options.rings ?? 220, options.segments ?? 512, 0.5, radius), material);
  mesh.frustumCulled = false;
  mesh.name = 'ocean';
  mesh.position.y = level;
  scene.add(mesh);

  const tmp = new Vector3(), tmp2 = new Vector3();
  let sunLight: DirectionalLight | null = null, sunTarget: Object3D | null = null;
  const resolveSun = () => {
    const o = options.sun;
    if (o && 'light' in o) { sunLight = o.light; sunTarget = o.target; }
    else if (o) { sunLight = o; sunTarget = o.target; }
    else scene.traverse(c => { if (!sunLight && (c as DirectionalLight).isDirectionalLight) { sunLight = c as DirectionalLight; sunTarget = sunLight.target; } });
  };
  let time = 0;

  const ocean: Ocean = {
    mesh, settings,
    get time() { return time; },
    update(dt, camera) {
      time += dt * settings.speed;
      uTime.value = time;
      uWaveScale.value = settings.waveScale; uChop.value = settings.choppiness; uRough.value = settings.roughness;
      uWind.value = (settings.windDirection * Math.PI) / 180;
      (uWater.value as Vector3).set(...settings.waterColor);
      (uScatter.value as Vector3).set(...settings.scatterColor); uScatterK.value = settings.scatterStrength;
      mesh.position.set(camera.position.x, level, camera.position.z);
      (uCamXZ.value as Vector3).set(camera.position.x, 0, camera.position.z);
      const h = renderer.getDrawingBufferSize(tmp2 as never) as unknown as { y: number };
      uPixelAngle.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, h.y);
      if (!sunLight) resolveSun();
      if (sunLight) {
        tmp.copy(sunLight.position).sub((sunTarget ?? sunLight.target).position).normalize();
        (uSunDir.value as Vector3).copy(tmp);
        const e = sunLight.intensity;
        (uSunE.value as Vector3).set(sunLight.color.r * e, sunLight.color.g * e, sunLight.color.b * e);
      } else {
        // fall back to the sky's own sun angles
        const el = (sky.sunElevation * Math.PI) / 180, az = (sky.sunAzimuth * Math.PI) / 180;
        (uSunDir.value as Vector3).set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
      }
    },
    heightAt(x, z) {
      const wind = (settings.windDirection * Math.PI) / 180, c = Math.cos(wind), sn = Math.sin(wind);
      let h = 0;
      for (let i = 0; i < VERTEX_WAVES; i++) {
        const w = waves[i];
        const dX = c * w.dx - sn * w.dz, dZ = sn * w.dx + c * w.dz;
        h += settings.waveScale * w.amp * Math.sin(w.k * (dX * x + dZ * z) - time * w.omega + w.phase);
      }
      return level + h;
    },
    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
      tileA.texture.dispose(); tileB.texture.dispose();
    },
  };
  return ocean;
}
