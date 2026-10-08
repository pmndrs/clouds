// Reusable terrain scene module: a procedural valley heightfield baked into three nested half-float tiles (47 m / 10 m / 4 m texels) and drawn as
// one static polar grid (vertex spacing ~1.3% of range, so distance LOD is built in). The vertex shader samples the tiles; the fragment shader
// rebuilds the normal from baked slopes and tints by slope and height (meadow, forest, rock, alpine). Lighting is three's own (the sky's sun
// light and IBL), plus a heightfield sun shadow that replaces the light's shadow node so ridges shade the valley at golden hour.
// Cloud shadows need nothing here: the clouds composite darkens any opaque pixel through its alpha.
import { BufferAttribute, BufferGeometry, DataTexture, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, OrthographicCamera, PlaneGeometry, RenderTarget, RepeatWrapping, RGBAFormat, UnsignedByteType, Vector3, Scene as ThreeScene, type DirectionalLight, type Object3D, type Scene } from 'three';
import { Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { Fn, abs, clamp, float, max, min, mix, normalize, positionGeometry, positionLocal, positionWorld, smoothstep, sqrt, texture, uniform, vec2, vec3, vec4, cameraPosition, cameraViewMatrix, length } from 'three/tsl';
import { bakeTile, createHeightfield, type BakedTile, type Heightfield, type TerrainShape, type TileSpec } from './heightfield';

export { createHeightfield } from './heightfield';
export type { Heightfield, TerrainShape } from './heightfield';

export interface TerrainOptions {
  /** The sun helper from sky.createSun() (or a DirectionalLight): its direction drives the heightfield shadow. */
  sun: { light: DirectionalLight; target: Object3D } | DirectionalLight;
  shape?: Partial<TerrainShape>;
  /** Grid radius in metres around the origin (the coarse tile covers it). Default 24 km. */
  radius?: number;
  /** Radial growth per ring; lower is denser. Default 1.013. */
  ringRatio?: number;
  segments?: number;
  /** Nested tiles, coarse to fine. Defaults are sized for a ~24 km valley with the vantage at the origin. */
  tiles?: TileSpec[];
  /** Steps of the heightfield sun-shadow march (0 disables the shadow). It is baked into per-tile textures whenever the sun moves. Default 24. */
  shadowSteps?: number;
}

export interface Terrain {
  readonly mesh: Mesh;
  readonly field: Heightfield;
  /** CPU height (m) at world x, z. */
  heightAt(x: number, z: number): number;
  /** Call once per frame: follows the sun light. */
  update(): void;
  dispose(): void;
}

const DEFAULT_TILES: TileSpec[] = [
  { cx: 0, cz: 0, half: 24000, res: 1024 },
  { cx: 0, cz: -2500, half: 5000, res: 1024 },
  { cx: 0, cz: -150, half: 450, res: 512 },
];

function polarGrid(rings: number, segments: number, r0: number, radius: number): BufferGeometry {
  const pos = new Float32Array(((rings + 1) * segments + 1) * 3);
  const ratio = Math.pow(radius / r0, 1 / rings);
  let o = 3;
  for (let r = 0; r <= rings; r++) {
    const rr = r0 * Math.pow(ratio, r);
    for (let a = 0; a < segments; a++) { const th = (a / segments) * Math.PI * 2; pos[o++] = Math.cos(th) * rr; pos[o++] = 0; pos[o++] = Math.sin(th) * rr; }
  }
  const idx: number[] = [];
  for (let a = 0; a < segments; a++) idx.push(0, 1 + ((a + 1) % segments), 1 + a);
  for (let r = 0; r < rings; r++) {
    const b0 = 1 + r * segments, b1 = 1 + (r + 1) * segments;
    for (let a = 0; a < segments; a++) { const a1 = (a + 1) % segments; idx.push(b0 + a, b0 + a1, b1 + a, b0 + a1, b1 + a1, b1 + a); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** 256^2 tileable value-noise fBm in the four channels (different seeds), sampled with mipmaps at several world scales for patches, crowns and normal detail. */
function bakeNoise(): DataTexture {
  const N = 256, data = new Uint8Array(N * N * 4);
  for (let ch = 0; ch < 4; ch++) {
    let seed = 1234 + ch * 7919;
    const grids = [8, 16, 32, 64].map(P => { const g = new Float32Array(P * P); for (let i = 0; i < g.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; g[i] = seed / 4294967296; } return { P, g }; });
    const weights = [0.5, 0.3, 0.14, 0.06];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = 0;
      grids.forEach(({ P, g }, o) => {
        const fx = (x / N) * P, fy = (y / N) * P, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
        const u = tx * tx * (3 - 2 * tx), w = ty * ty * (3 - 2 * ty);
        const a = g[(iy % P) * P + (ix % P)], b = g[(iy % P) * P + ((ix + 1) % P)], c = g[((iy + 1) % P) * P + (ix % P)], d = g[((iy + 1) % P) * P + ((ix + 1) % P)];
        v += weights[o] * (a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w);
      });
      data[(y * N + x) * 4 + ch] = Math.max(0, Math.min(255, Math.round((v - 0.5) * 1.8 * 255 + 128)));
    }
  }
  const t = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping; t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

export function createTerrain(renderer: WebGPURenderer, scene: Scene, options: TerrainOptions): Terrain {
  const field = createHeightfield(options.shape);
  const radius = options.radius ?? 24000, r0 = 0.6, ratio = options.ringRatio ?? 1.013;
  const rings = Math.ceil(Math.log(radius / r0) / Math.log(ratio));
  const tiles: BakedTile[] = (options.tiles ?? DEFAULT_TILES).map(t => bakeTile(field, t));
  const noiseTex = bakeNoise();
  /** Noise (four channels, 0..1) at world xz with one tile every `period` metres. */
  const noise = (p: any, period: number) => texture(noiseTex, p.div(period));

  // ---- tile sampling (TSL) ----
  const tileUv = (t: BakedTile, p: any) => p.sub(vec2(t.cx - t.half, t.cz - t.half)).div(2 * t.half);
  const tileWeight = (t: BakedTile, p: any) => smoothstep(0.72, 0.96, max(abs(p.x.sub(t.cx)), abs(p.y.sub(t.cz))).div(t.half)); // 0 inside the tile, 1 at its edge
  /** (height, dh/dx, dh/dz) at world xz, the finer tiles fading in over the outer part of their footprint. */
  const blendTiles = (p: any, count: number) => {
    let acc: any = null;
    for (const t of tiles.slice(0, count)) {
      const s = texture(t.texture, tileUv(t, p)).level(float(0));
      const v = vec3(s.x.add(s.y), s.z, s.w);
      acc = acc ? mix(v, acc, tileWeight(t, p)) : v;
    }
    return acc;
  };
  const sampleTerrain = (p: any) => {
    const acc = blendTiles(p, tiles.length);
    // Features finer than the tiles' texels (pool basin, viewing rise) are added analytically: height and slope of amp * (1 - smoothstep(a, b, r)).
    let h = acc.x, gx = acc.y, gz = acc.z;
    for (const k of field.bumps) {
      const d = p.sub(vec2(k.x, k.z)), r = length(d).max(1e-4), t = clamp(r.sub(k.a).div(k.b - k.a), 0, 1);
      h = h.add(float(k.amp).mul(float(1).sub(t.mul(t).mul(float(3).sub(t.mul(2))))));
      const dr = float(-k.amp * 6 / (k.b - k.a)).mul(t).mul(float(1).sub(t)).div(r); // d/dr of the bump, over r to scale the offset vector
      gx = gx.add(dr.mul(d.x)); gz = gz.add(dr.mul(d.y));
    }
    return vec3(h, gx, gz);
  };

  // ---- sun shadow: marched over the baked tiles into one shadow texture per tile whenever the sun moves; receivers sample and blend them ----
  const uSunDir = uniform(new Vector3(0, 1, 0));
  const steps = options.shadowSteps ?? 24;
  const shadowTargets = tiles.map(t => { const rt = new RenderTarget(t.res, t.res, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false }); rt.texture.minFilter = rt.texture.magFilter = LinearFilter; rt.texture.generateMipmaps = false; return rt; });
  /** Visibility of the sun (0..1) from world position `q0` (x, y, z): a march along the sun direction with a soft-shadow cone (penumbra ~1.4 degrees). */
  const march = (q0: any) => {
    const res = float(1).toVar();
    let t = 3;
    for (let i = 0; i < steps; i++, t *= 1.45) {
      const q = q0.add(uSunDir.mul(t));
      const ground = blendTiles(q.xz, t < 200 ? 3 : t < 900 ? 2 : 1).x; // finer tiles only where the ray is near the surface
      res.assign(min(res, clamp(q.y.sub(ground).add(1).mul(40 / t), 0, 1)));
    }
    return smoothstep(float(0), float(1), res);
  };
  const bakeScene = new ThreeScene(), bakeCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bakeMeshes = tiles.map(t => {
    const m = new MeshBasicNodeMaterial();
    m.colorNode = Fn(() => {
      const xz = vec2(t.cx - t.half, t.cz - t.half).add(positionLocal.xy.mul(0.5).add(0.5).mul(2 * t.half)); // v grows with +z, like the height tiles
      const g = blendTiles(xz, 3);
      return vec4(march(vec3(xz.x, g.x.add(1.5), xz.y)), 0, 0, 1);
    })();
    m.depthTest = false; m.depthWrite = false;
    const mesh = new Mesh(new PlaneGeometry(2, 2), m); mesh.frustumCulled = false; mesh.visible = false; bakeScene.add(mesh);
    return mesh;
  });
  const bakedSun = new Vector3(0, -2, 0);
  const rebakeShadows = () => {
    const saved = renderer.getRenderTarget();
    tiles.forEach((_, i) => { bakeMeshes.forEach((m, j) => { m.visible = i === j; }); renderer.setRenderTarget(shadowTargets[i]); renderer.render(bakeScene, bakeCamera); });
    renderer.setRenderTarget(saved);
    bakedSun.copy(uSunDir.value as Vector3);
  };
  /** Shadow (0..1) at world xz, blended across tiles like the heights. */
  const sampleShadow = (p: any) => {
    let acc: any = null;
    tiles.forEach((t, i) => { const v = texture(shadowTargets[i].texture, tileUv(t, p)).level(float(0)).x; acc = acc ? mix(v, acc, tileWeight(t, p)) : v; });
    return acc;
  };
  const shadowNode = Fn(() => sampleShadow(positionWorld.xz))();

  // ---- material ----
  const material = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  material.positionNode = Fn(() => {
    const p = positionGeometry.xz;
    return vec3(p.x, sampleTerrain(p).x, p.y);
  })();
  const terr = sampleTerrain(positionWorld.xz); // (height, slope x, slope z), once for the whole fragment
  const near = float(1).sub(smoothstep(float(60), float(900), length(cameraPosition.sub(positionWorld)))); // small-scale detail fades before it can alias
  const xz = positionWorld.xz;
  const nLow = noise(xz, 24), nHigh = noise(xz, 6); // normal detail: ~3 m and ~0.8 m features
  const worldNormal = normalize(vec3(terr.y.negate().add(nLow.x.sub(0.5).add(nHigh.x.sub(0.5).mul(0.5)).mul(near).mul(0.25)), 1, terr.z.negate().add(nLow.y.sub(0.5).add(nHigh.y.sub(0.5).mul(0.5)).mul(near).mul(0.25))));
  const albedo = Fn(() => {
    const steep = sqrt(terr.y.mul(terr.y).add(terr.z.mul(terr.z)));
    const h = positionWorld.y;
    const nPatch = noise(xz, 5200), nField = noise(xz, 360), nCrown = noise(xz, 14), nCrown2 = noise(xz, 3.2), nRock = noise(xz, 560);
    const patch = nPatch.x, patchFine = nField.x;                                          // forest clearings
    const speck = nCrown.y.sub(0.5).add(nCrown2.y.sub(0.5).mul(0.5)).mul(near).mul(2);      // individual tree crowns
    const rockMask = smoothstep(float(0.75), float(1.1), steep.add(speck.mul(0.06))).max(smoothstep(float(1050), float(1600), h));
    const forestMask = smoothstep(float(25), float(90), h).mul(float(1).sub(smoothstep(float(900), float(1300), h))).mul(float(1).sub(rockMask))
      .mul(smoothstep(float(0.04), float(0.22), patch.add(patchFine.mul(0.2))));
    // valley-floor patchwork (paddies and fields), blending to its mean colour with distance so it cannot alias
    const cell = xz.div(85).add(vec2(nField.y, nField.z).sub(0.5).mul(1.2)).floor();
    const rnd = (k: number) => cell.x.mul(127.1 + k).add(cell.y.mul(311.7 - k)).sin().mul(43758.5453).fract();
    const patchwork = mix(mix(vec3(0.07, 0.15, 0.03), vec3(0.2, 0.2, 0.05), rnd(0)), vec3(0.12, 0.085, 0.04), smoothstep(float(0.72), float(1.0), rnd(7)));
    const meadow = mix(vec3(0.09, 0.14, 0.03), vec3(0.16, 0.17, 0.04), patchFine);
    const flat = float(1).sub(smoothstep(float(0.02), float(0.1), steep)).mul(float(1).sub(smoothstep(float(30), float(70), h)));
    const fields = mix(meadow, mix(vec3(0.12, 0.15, 0.04), patchwork, float(1).sub(smoothstep(float(1500), float(6000), length(cameraPosition.sub(positionWorld))))), flat);
    const forest = mix(vec3(0.012, 0.03, 0.01), vec3(0.026, 0.055, 0.016), speck.mul(0.5).add(0.5)).mul(speck.mul(0.35).add(1));
    const rock = mix(vec3(0.12, 0.105, 0.09), vec3(0.2, 0.18, 0.15), nRock.w);
    return mix(mix(fields, forest, forestMask), rock, rockMask);
  })();
  material.colorNode = albedo;
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz);

  const mesh = new Mesh(polarGrid(rings, options.segments ?? 640, r0, radius), material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);

  // ---- sun ----
  let light: DirectionalLight | null = null, target: Object3D | null = null;
  const o = options.sun;
  if ('light' in o) { light = o.light; target = o.target; } else { light = o; target = o.target; }
  if (steps > 0) {
    renderer.shadowMap.enabled = true;
    light.castShadow = true;
    (light.shadow as unknown as { shadowNode: unknown }).shadowNode = shadowNode;
  }
  const tmp = new Vector3();
  return {
    mesh, field,
    heightAt: (x, z) => field.height(x, z),
    update() {
      if (!light || !target) return;
      (uSunDir.value as Vector3).copy(tmp.copy(light.position).sub(target.position).normalize());
      if (steps > 0 && (uSunDir.value as Vector3).dot(bakedSun) < 0.9999995) rebakeShadows();
    },
    dispose() {
      scene.remove(mesh); mesh.geometry.dispose(); material.dispose(); noiseTex.dispose();
      for (const t of tiles) t.texture.dispose();
      for (const rt of shadowTargets) rt.dispose();
    },
  };
}
