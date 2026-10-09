// Takram pane: @takram/three-clouds + @takram/three-atmosphere (WebGL, GLSL) through postprocessing's EffectComposer, on its own WebGLRenderer and canvas.
// Their atmosphere lives in ECEF (a WGS84 globe), so the local scene (x east, y up, z south, metres, ground at y = 0) is placed on the ellipsoid with `worldToECEFMatrix`.
// Assets come from the npm packages (no CDN): the atmosphere LUTs, weather/shape/turbulence textures. Their spatiotemporal blue noise (stbn.bin) is NOT in the package: see `makeStbn`.
import {
  Data3DTexture, DataTexture, HalfFloatType, LinearFilter, LinearMipMapLinearFilter, Mesh, Matrix3, Matrix4, MeshBasicMaterial, NearestFilter, NoColorSpace, PerspectiveCamera, PlaneGeometry,
  RedFormat, RepeatWrapping, Scene, TextureLoader, UnsignedByteType, Uniform, Vector3, WebGLRenderer, type Texture,
} from 'three';
import { Effect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import {
  AerialPerspectiveEffect, IRRADIANCE_TEXTURE_HEIGHT, IRRADIANCE_TEXTURE_WIDTH, SCATTERING_TEXTURE_DEPTH, SCATTERING_TEXTURE_HEIGHT, SCATTERING_TEXTURE_WIDTH, TRANSMITTANCE_TEXTURE_HEIGHT, TRANSMITTANCE_TEXTURE_WIDTH,
} from '@takram/three-atmosphere';
import { CLOUD_SHAPE_DETAIL_TEXTURE_SIZE, CLOUD_SHAPE_TEXTURE_SIZE, CloudsEffect } from '@takram/three-clouds';
import { DataTextureLoader, Ellipsoid, Geodetic, parseFloat16Array, parseUint8Array, STBN_TEXTURE_DEPTH, STBN_TEXTURE_HEIGHT, STBN_TEXTURE_WIDTH } from '@takram/three-geospatial';
import { GROUND_HEX, forwardOf, mapCoverage, sunVector, type Pane, type PaneStats, type ViewState } from '../shared';

// Package assets, resolved by vite `?url` imports (the packages do not export their asset folders, so these are relative paths into node_modules).
import transmittanceUrl from '../../../../node_modules/@takram/three-atmosphere/assets/transmittance.bin?url';
import scatteringUrl from '../../../../node_modules/@takram/three-atmosphere/assets/scattering.bin?url';
import irradianceUrl from '../../../../node_modules/@takram/three-atmosphere/assets/irradiance.bin?url';
import higherOrderUrl from '../../../../node_modules/@takram/three-atmosphere/assets/higher_order_scattering.bin?url';
import localWeatherUrl from '../../../../node_modules/@takram/three-clouds/assets/local_weather.png?url';
import shapeUrl from '../../../../node_modules/@takram/three-clouds/assets/shape.bin?url';
import shapeDetailUrl from '../../../../node_modules/@takram/three-clouds/assets/shape_detail.bin?url';
import turbulenceUrl from '../../../../node_modules/@takram/three-clouds/assets/turbulence.png?url';
const URLS = { transmittance: transmittanceUrl, scattering: scatteringUrl, irradiance: irradianceUrl, higherOrder: higherOrderUrl, localWeather: localWeatherUrl, shape: shapeUrl, shapeDetail: shapeDetailUrl, turbulence: turbulenceUrl };

/** Where the local scene sits on the globe: latitude 35 N, longitude 139.7 E (any midlatitude works), ground at ellipsoid height 0. */
const SITE = new Geodetic((139.7 * Math.PI) / 180, (35 * Math.PI) / 180, 0);
/** Exposure calibration relative to ours (measured clear-sky luminance, see the P8-A report). */
export const TAKRAM_EXPOSURE = 7.5;

class ExposureEffect extends Effect {
  constructor() {
    super('ExposureEffect', 'uniform float k; void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) { outputColor = vec4(inputColor.rgb * k, inputColor.a); }', { uniforms: new Map([['k', new Uniform(1)]]) });
  }
  set k(v: number) { this.uniforms.get('k')!.value = v; }
}

/**
 * Stand-in for Takram's spatiotemporal blue noise (128 x 128 x 64, R8): the real stbn.bin ships only in their repository (Git LFS), not in the npm package, and we do not download it.
 * Each slice is independent white noise, high-pass filtered (white minus a wrapped gaussian, sigma 1.4 px) and rank-transformed to a uniform histogram: blue in space, white in time.
 * True STBN is also optimised across slices, so Takram's temporal accumulation converges a little less cleanly here. `?stbn=<url>` loads a real stbn.bin instead.
 */
function makeStbn(): Data3DTexture {
  const w = STBN_TEXTURE_WIDTH, h = STBN_TEXTURE_HEIGHT, d = STBN_TEXTURE_DEPTH, n = w * h, data = new Uint8Array(n * d);
  let seed = 0x9e3779b9;
  const rand = () => { seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39) | 0; seed ^= seed >>> 12; return ((seed >>> 0) % 1000003) / 1000003; };
  const radius = 5, kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * 1.4 * 1.4)));
  const ksum = kernel.reduce((x, y) => x + y, 0);
  const white = new Float32Array(n), tmp = new Float32Array(n), blur = new Float32Array(n), hp = new Float32Array(n);
  for (let z = 0; z < d; z++) {
    for (let i = 0; i < n; i++) white[i] = rand();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let k = -radius; k <= radius; k++) a += white[y * w + ((x + k + w) % w)] * kernel[k + radius]; tmp[y * w + x] = a / ksum; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let k = -radius; k <= radius; k++) a += tmp[((y + k + h) % h) * w + x] * kernel[k + radius]; blur[y * w + x] = a / ksum; }
    for (let i = 0; i < n; i++) hp[i] = white[i] - blur[i];
    const order = Uint32Array.from({ length: n }, (_, i) => i).sort((p, q) => hp[p] - hp[q]);
    for (let r = 0; r < n; r++) data[z * n + order[r]] = Math.floor((r / (n - 1)) * 255);
  }
  const t = new Data3DTexture(data, w, h, d);
  t.format = RedFormat; t.type = UnsignedByteType; t.minFilter = NearestFilter; t.magFilter = NearestFilter; t.wrapS = t.wrapT = t.wrapR = RepeatWrapping; t.needsUpdate = true;
  return t;
}

const load = <T extends Texture>(make: (done: (t: T) => void) => void): Promise<T> => new Promise(resolve => make(resolve));

export function createTakramPane(canvas: HTMLCanvasElement, query: URLSearchParams, groundGain = 1): Pane {
  // Cloud shadows on the ground (Takram's cascaded beer shadow maps): off by default because ours has none, so the shared ground stays comparable. `?shadows=1` turns them on here and in the Sky Pro pane.
  const SHADOWS = query.get('shadows') === '1';
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: false });
  renderer.setPixelRatio(1);
  renderer.toneMappingExposure = 1;
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 1, 1e6);
  const groundColor = new MeshBasicMaterial({ color: GROUND_HEX }); // MeshBasicMaterial: the render buffer is albedo, AerialPerspectiveEffect lights it (sunLight + skyLight)
  const ground = new Mesh(new PlaneGeometry(4e6, 4e6), groundColor);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0 });
  let clouds: CloudsEffect, ap: AerialPerspectiveEffect, exposureFx: ExposureEffect;
  const worldToECEF = new Matrix4();
  const sunECEF = new Vector3();
  const rot = new Matrix3();
  const origin = SITE.toECEF(new Vector3());
  {
    const east = new Vector3(), north = new Vector3(), up = new Vector3();
    Ellipsoid.WGS84.getEastNorthUpVectors(origin, east, north, up);
    worldToECEF.makeBasis(east, up, north.clone().negate()).setPosition(origin); // world +x east, +y up, -z north
    rot.setFromMatrix4(worldToECEF);
  }

  const cpu: number[] = [];
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const state = { ready: false, frames: 0, cloudsOn: query.get('clouds') !== '0', stbn: 'procedural (high-passed white noise, rank-transformed)' };

  // WebGL GPU timer (EXT_disjoint_timer_query_webgl2), whole composer pass
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  const pending: WebGLQuery[] = [];
  const gpuSamples: number[] = [];
  let active: WebGLQuery | null = null;
  const pollTimers = () => {
    while (pending.length) {
      const q = pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      pending.shift();
      if (!gl.getParameter(timer!.GPU_DISJOINT_EXT)) { gpuSamples.push(Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6); if (gpuSamples.length > 60) gpuSamples.shift(); }
      gl.deleteQuery(q);
    }
  };

  return {
    id: 'takram',
    label: 'Takram: @takram/three-clouds 0.7.6 (WebGL, postprocessing)',
    canvas,
    async init() {
      const half = { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter } as const;
      const lut2d = (url: string, w: number, h: number) => load<DataTexture>(done => new DataTextureLoader(DataTexture, parseFloat16Array, { width: w, height: h, ...half }).load(url, done));
      const lut3d = (url: string, w: number, h: number, d: number) => load<Data3DTexture>(done => new DataTextureLoader(Data3DTexture, parseFloat16Array, { width: w, height: h, depth: d, ...half }).load(url, done));
      const tex2d = (url: string) => load<Texture>(done => { const t = new TextureLoader().load(url, () => { t.minFilter = LinearMipMapLinearFilter; t.magFilter = LinearFilter; t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = NoColorSpace; t.needsUpdate = true; done(t); }); });
      const shape = (url: string, size: number) => load<Data3DTexture>(done => new DataTextureLoader(Data3DTexture, parseUint8Array, { width: size, height: size, depth: size, format: RedFormat, minFilter: LinearFilter, magFilter: LinearFilter, wrapS: RepeatWrapping, wrapT: RepeatWrapping, wrapR: RepeatWrapping, colorSpace: NoColorSpace }).load(url, done));
      const [transmittance, scattering, irradiance, higherOrder, localWeather, shapeTex, shapeDetail, turbulence] = await Promise.all([
        lut2d(URLS.transmittance, TRANSMITTANCE_TEXTURE_WIDTH, TRANSMITTANCE_TEXTURE_HEIGHT),
        lut3d(URLS.scattering, SCATTERING_TEXTURE_WIDTH, SCATTERING_TEXTURE_HEIGHT, SCATTERING_TEXTURE_DEPTH),
        lut2d(URLS.irradiance, IRRADIANCE_TEXTURE_WIDTH, IRRADIANCE_TEXTURE_HEIGHT),
        lut3d(URLS.higherOrder, SCATTERING_TEXTURE_WIDTH, SCATTERING_TEXTURE_HEIGHT, SCATTERING_TEXTURE_DEPTH),
        tex2d(URLS.localWeather),
        shape(URLS.shape, CLOUD_SHAPE_TEXTURE_SIZE),
        shape(URLS.shapeDetail, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE),
        tex2d(URLS.turbulence),
      ]);
      let stbn: Data3DTexture = makeStbn();
      if (query.has('stbn')) { stbn = await load<Data3DTexture>(done => { const l = new DataTextureLoader(Data3DTexture, parseUint8Array, { width: STBN_TEXTURE_WIDTH, height: STBN_TEXTURE_HEIGHT, depth: STBN_TEXTURE_DEPTH, format: RedFormat, minFilter: NearestFilter, magFilter: NearestFilter, wrapS: RepeatWrapping, wrapT: RepeatWrapping, wrapR: RepeatWrapping, colorSpace: NoColorSpace }); l.load(query.get('stbn')!, done); }); state.stbn = query.get('stbn')!; }

      clouds = new CloudsEffect(camera);
      clouds.qualityPreset = (query.get('takram_quality') ?? 'high') as 'low' | 'medium' | 'high' | 'ultra';
      Object.assign(clouds, { localWeatherTexture: localWeather, shapeTexture: shapeTex, shapeDetailTexture: shapeDetail, turbulenceTexture: turbulence, stbnTexture: stbn, irradianceTexture: irradiance, scatteringTexture: scattering, transmittanceTexture: transmittance, higherOrderScatteringTexture: higherOrder });
      ap = new AerialPerspectiveEffect(camera, { sky: true, sun: true, moon: false, sunLight: query.get('takram_light') !== '0', skyLight: query.get('takram_light') !== '0', reconstructNormal: true, albedoScale: groundGain, irradianceTexture: irradiance, scatteringTexture: scattering, transmittanceTexture: transmittance, higherOrderScatteringTexture: higherOrder });
      ap.stbnTexture = stbn;
      const route = () => { ap.overlay = clouds.atmosphereOverlay; ap.shadow = SHADOWS ? clouds.atmosphereShadow : null; ap.shadowLength = clouds.atmosphereShadowLength; };
      clouds.events.addEventListener('change', route);
      exposureFx = new ExposureEffect();
      composer.addPass(new RenderPass(scene, camera));
      const effects = state.cloudsOn ? [clouds, ap] : [ap];
      composer.addPass(new EffectPass(camera, ...effects, exposureFx, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));
      route();
      state.ready = true;
    },
    resize(w, h) { renderer.setSize(w, h, false); composer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
    ready: () => state.ready && state.frames > 3,
    render(view: ViewState, dt: number) {
      if (!state.ready) return;
      const t0 = performance.now();
      camera.fov = view.fov;
      camera.position.set(...view.position);
      const f = forwardOf(view);
      camera.lookAt(view.position[0] + f[0], view.position[1] + f[1], view.position[2] + f[2]);
      camera.near = Math.min(50, Math.max(0.5, camera.position.y * 0.02)); camera.far = 1.2e6;
      camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      ground.position.set(view.position[0], 0, view.position[2]);
      // sun: world direction -> ECEF
      sunECEF.set(...sunVector(view.sunAz, view.sunEl)).applyMatrix3(rot).normalize();
      for (const fx of [clouds, ap]) { fx.worldToECEFMatrix.copy(worldToECEF); fx.sunDirection.copy(sunECEF); }
      clouds.coverage = mapCoverage.takram(view.coverage);
      exposureFx.k = TAKRAM_EXPOSURE * view.exposure;
      if (timer) { pollTimers(); if (!active && pending.length < 4) { active = gl.createQuery(); gl.beginQuery(timer.TIME_ELAPSED_EXT, active!); } }
      composer.render(dt);
      if (timer && active) { gl.endQuery(timer.TIME_ELAPSED_EXT); pending.push(active); active = null; }
      cpu.push(performance.now() - t0); if (cpu.length > 60) cpu.shift();
      state.frames++;
    },
    stats(): PaneStats { return { gpuMs: timer && gpuSamples.length ? { total: mean(gpuSamples) } : null, cpuMs: mean(cpu) }; },
    detail: () => ({ stbn: state.stbn, quality: query.get('takram_quality') ?? 'high', layers: 'default (750/650 m, 1000/1200 m, 7500/500 m)', timer: !!timer, site: 'lat 35 lon 139.7' }),
  };
}
