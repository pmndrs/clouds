// Phase 4 showcase: an onsen on a mountainside at golden hour, looking over a misty valley, built with @clouds/three the way an end user would.
// Lines tagged `// INTEGRATION` are everything clouds cost this scene (the dozen lines that make the sky, haze and valley fog appear);
// the authored/generated cloudscape is content, tagged `// CONTENT`.
//
//   ?time=<hours>   solar time of day (default 18.6, golden hour)     ?bookmark=vantage|valley|sunset
//   ?terrain=0      hide the terrain (A/B for its GPU cost)           ?drift=0  freeze the camera drift
//   ?quality=       cloud quality                                      ?exposure=  tone-mapping exposure     ?haze=  aerial-perspective distance scale
//   ?hud=0 hides the debug text, ?clean=1 hides all UI (hud and bookmark buttons)   ?drift=0 also freezes the camera; ?fogdrift=0 freezes the valley fog's slow flow
//   ?skylayer=1     enable the distant procedural sky layer (P3-C1)    ?seed=  cloud seed     ?reflect=0  no cloud reflection in the pool
import { ACESFilmicToneMapping, IcosahedronGeometry, Mesh, PerspectiveCamera, Scene, type BufferGeometry } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshStandardNodeMaterial, RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { mix, mx_noise_float, normalWorld, pass, positionLocal, smoothstep, vec3 } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend, type CloudQuality } from '@clouds/three'; // INTEGRATION
import {
  CLOUD_PRESETS, createGeneratorScratch, createSdfRebuilder, createVolumeGenerator, encodeProceduralWeatherMap, loadCloudNoise, loadCloudVolume, stampCloud, uploadCloudVolume,
  type CloudVolumeAsset, type StampOptions,
} from '@clouds/runtime'; // CONTENT
import { installCloudsHarness } from '../harness/clouds-contract';
import { createPool } from '../scenes/terrain/pool';
import { createTerrain } from '../scenes/terrain';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const num = (k: string, d: number) => (query.has(k) ? Number(query.get(k)) : d);

/** Camera bookmarks. `eye` is x, height above the ground, z (z grows south), `az` a compass heading (north = -Z, valley ahead), `time` shifts the sun from the default golden hour. */
const BOOKMARKS = {
  vantage: { eye: [0.4, 2.2, 11], az: 6, pitch: 1, dTime: 0 },
  valley: { eye: [1, 2.2, 10], az: -12, pitch: -14, dTime: 0 },
  sunset: { eye: [-1, 1.7, 11.5], az: -22, pitch: 0, dTime: 0.45 },
} as const;
type BookmarkName = keyof typeof BOOKMARKS;
const NAMES = Object.keys(BOOKMARKS) as BookmarkName[];
const isName = (n: string): n is BookmarkName => n in BOOKMARKS;
const TIME = num('time', 18.6);
const SHOW_HUD = query.get('hud') !== '0' && query.get('clean') !== '1', SHOW_UI = query.get('clean') !== '1';

// Cloud region (CONTENT): 512 x 512 x 112 voxels at 12 m = 6.1 km square, 1344 m tall, centred over the valley north of the terrace; its floor is at y = 0.
const FIELD = { dims: [512, 512, 112] as [number, number, number], voxel: 12, centre: [0, -4600] as const };
const EXTENT = [FIELD.dims[0] * FIELD.voxel, FIELD.dims[2] * FIELD.voxel, FIELD.dims[1] * FIELD.voxel] as const;
const MIN = [FIELD.centre[0] - EXTENT[0] / 2, 0, FIELD.centre[1] - EXTENT[2] / 2] as const;

try {
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = num('exposure', 0.5);
  document.body.style.cssText = 'margin:0;overflow:hidden';
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  renderer.setPixelRatio(1);
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, 0.3, 600000);
  camera.rotation.order = 'YXZ';
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: TIME, latitude: 35, dayOfYear: 200, north: '-Z', mirrorBelowHorizon: true });
  sky.attach(scene);
  const sun = sky.createSun({ physical: true });
  sun.attach(scene);
  sky.setAerialPerspectiveDistanceScale(num('haze', 1.6)); sky.setHazeStrength(num('hazestrength', 1));
  await sky.compileAsync();

  const clouds = new Clouds(renderer, { sky, quality: (query.get('quality') as CloudQuality) ?? 'high' }); // INTEGRATION
  const terrain = createTerrain(renderer, scene, { sun, shadowSteps: num('shadow', 22) });
  if (query.get('cloudshadow') !== '0') clouds.applyShadow(sun.light); // INTEGRATION (P10-B: cloud shadow on the direct sun only, after the terrain installed its heightfield shadow so the two multiply; ?cloudshadow=0 keeps the composite-alpha shadow)
  terrain.mesh.visible = query.get('terrain') !== '0';
  const field = terrain.field;
  const T = field.terraceHeight, pool = field.shape.pool;
  const water = createPool(scene, { x: pool.x, z: pool.z, level: field.poolLevel, radius: pool.radius + 1.2, ripple: num('ripple', 1), reflection: query.get('reflect') === '0' ? undefined : dir => clouds.reflection(dir) }); // INTEGRATION (cloud reflections in the pool)
  water.mesh.visible = query.get('pool') !== '0';
  const post = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera); // INTEGRATION
  post.outputNode = clouds.node(sky.applyHaze(scenePass.getTextureNode(), { scenePass }), scenePass); // INTEGRATION (haze the scene first, then composite the clouds)

  // ---- foreground (CONTENT): rocks ringing the pool, a few boulders framing the terrace ----
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const rockMaterial = new MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const rockNoise = mx_noise_float(positionLocal.mul(2.6));
  const moss = smoothstep(0.55, 0.9, normalWorld.y).mul(rockNoise.mul(0.5).add(0.6)).clamp(0, 1);
  rockMaterial.colorNode = mix(mix(vec3(0.07, 0.062, 0.055), vec3(0.17, 0.15, 0.125), rockNoise.mul(0.5).add(0.5)), vec3(0.04, 0.07, 0.02), moss.mul(0.7));
  const rockGeometry = (): BufferGeometry => {
    const g = new IcosahedronGeometry(1, 4);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    const merged = mergeVertices(g, 1e-4);
    const p = merged.getAttribute('position'), ox = rnd() * 50, oz = rnd() * 50;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + 0.2 * Math.sin(x * 2.1 + ox) * Math.cos(z * 2.4 + oz) + 0.12 * Math.sin(y * 4.3 + x * 3.1 + oz) + 0.05 * Math.sin((x + y + z) * 9 + ox);
      p.setXYZ(i, x * n, Math.max(y * n, -0.5 * n), z * n);
    }
    merged.computeVertexNormals();
    return merged;
  };
  const addRock = (x: number, z: number, size: number, flat = 0.6) => {
    const m = new Mesh(rockGeometry(), rockMaterial);
    m.scale.set(size * (0.9 + rnd() * 0.5), size * flat * (0.8 + rnd() * 0.5), size * (0.9 + rnd() * 0.5));
    m.rotation.y = rnd() * 6.28;
    m.position.set(x, terrain.heightAt(x, z) + size * flat * 0.18, z);
    m.receiveShadow = true;
    scene.add(m);
  };
  const RIM = pool.radius + 0.35;
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rnd() * 0.15, r = RIM + rnd() * 0.5, south = Math.max(0, Math.sin(a)); // sin(a) > 0 faces the camera: keep those low
    addRock(pool.x + Math.cos(a) * r, pool.z + Math.sin(a) * r, (0.22 + rnd() * 0.3) * (1 - 0.5 * south), 0.55);
  }
  for (const [x, z, s] of [[-9.5, -9, 1.0], [8.6, -11, 1.2], [-13, 5, 0.9], [12, 3.5, 1.0], [2.5, -13.5, 0.8], [-3, -12.5, 0.7], [14, -5, 0.8]] as const) addRock(x, z, s, 0.75);

  // ---- cloudscape (CONTENT): generated cumulus + stamped heroes, built once ----
  const device = sharedBackend(renderer).device; // CONTENT
  device.addEventListener('uncapturederror', e => harness.fail((e as GPUUncapturedErrorEvent).error.message));
  const cloudInfo = { buildMs: 0, stamps: 0 };
  const buildClouds = async () => {
    const t0 = performance.now();
    const preset = CLOUD_PRESETS.cumulus, cloudSeed = num('seed', 7);
    const H = FIELD.dims[2] * FIELD.voxel;
    // The preset's height fractions are for a 512 m column; here the layer sits 640-900 m up in a 1152 m column.
    const params = { ...preset.params, seed: cloudSeed, baseDefault: 640 / H, topFraction: 940 / H, baseLift: 0.05 };
    const weatherOpts = { ...preset.weather, coverageLo: num('lo', 0.6), coverageHi: num('hi', 0.98), size: [FIELD.dims[0], FIELD.dims[1]] as [number, number], seed: cloudSeed };
    const scratch = createGeneratorScratch(device, FIELD.dims, 'onsen');
    const enc0 = device.createCommandEncoder();
    const weather = encodeProceduralWeatherMap(device, enc0, weatherOpts);
    device.queue.submit([enc0.finish()]);
    const gen = createVolumeGenerator(device, { dims: FIELD.dims, voxelSize: FIELD.voxel, weather, params, scratch });
    const enc = device.createCommandEncoder({ label: 'onsen cloud region' });
    gen.generate(enc);
    // Heroes: asset box centre in region-local metres; y lifts the box so its bottom sits at `bottom` (world y).
    const load = async (n: string): Promise<{ asset: CloudVolumeAsset; gpu: ReturnType<typeof uploadCloudVolume> }> => { const asset = await loadCloudVolume(`/clouds/heroes/${n}/`); return { asset, gpu: uploadCloudVolume(device, asset) }; };
    const [fog, fair, hero] = await Promise.all([load('valley-fog'), load('fairweather'), load('sim-congestus')]);
    const place = (h: { asset: CloudVolumeAsset; gpu: ReturnType<typeof uploadCloudVolume> }, x: number, z: number, bottom: number, o: Omit<StampOptions, 'position'>) => {
      const s = o.scale ?? 1, half = (h.asset.dims[2] * h.asset.voxelSizeMeters * s) / 2;
      stampCloud(device, enc, gen.volume, h.gpu, { ...o, position: [x - MIN[0], bottom + half, z - MIN[2]] });
      cloudInfo.stamps++;
    };
    // Valley fog: banks laid along the floor of the valley (the lowest point of the heightfield across each x), yawed to follow its axis.
    const axisZ = (x: number) => { let best = -3500, bh = 1e9; for (let z = -7000; z < -1200; z += 25) { const h = field.base(x, z); if (h < bh) { bh = h; best = z; } } return best; };
    const banks: [number, number, number, number][] = [[-2700, 40, 1.5, 0.1], [-1900, -120, 1.7, -0.1], [-900, 90, 1.4, 0.08], [-100, -60, 1.8, 0.0], [700, 140, 1.5, 0.15], [1500, -40, 1.7, -0.1], [2400, 80, 1.5, 0.05], [2900, -140, 1.4, 0.1], [-1400, 700, 1.2, 0.5], [900, -900, 1.3, -0.4]];
    for (const [x, dz, s, jitter] of banks) {
      const z = axisZ(x) + dz, slope = (axisZ(x + 200) - axisZ(x - 200)) / 400;
      place(fog, x, z, field.base(x, z) + 8, { yaw: -Math.atan(slope) + jitter, scale: s, mode: 'max', detailType: 0.8, densityScale: num('fogd', 0.16) });
    }
    // A towering cloud beyond the valley, rising behind the far ridges; fair-weather cumulus floating over the valley and one drifting close.
    place(hero, num('hx', 300), num('hz', -2300), num('hb', 70), { scale: num('hs', 1.55), yaw: 0.4, mode: 'max' }); // the hero: a simulated congestus (656 x 608 x 808 m at scale 1), rising from the valley behind the far ridge
    for (const [x, z, bottom, s, yaw] of [[-1500, -4700, 700, 1.7, 0.5], [1400, -3300, 760, 1.4, 2.2], [-600, -6400, 640, 1.9, 1.1], [-2300, -2400, 820, 1.2, 0.2], [2300, -5600, 700, 1.5, 3.0]] as const) place(fair, x, z, bottom, { scale: s, yaw, mode: 'max' });
    device.queue.submit([enc.finish()]);
    const rebuild = createSdfRebuilder(device, gen.volume, { scratch }); // the SDF must follow the stamps
    const enc2 = device.createCommandEncoder({ label: 'onsen sdf rebuild' });
    rebuild.generate(enc2);
    device.queue.submit([enc2.finish()]);
    await device.queue.onSubmittedWorkDone();
    await clouds.setVolume(gen.volume, { position: [FIELD.centre[0], MIN[1], FIELD.centre[1]] }); // INTEGRATION (the volume stays caller-owned: `gen` stays alive)
    if (query.get('skylayer') === '1') { const l = clouds.core.skyLayer; l.configure({ weather: weatherOpts, shape: params, voxelSize: FIELD.voxel }); l.settings.enabled = true; } // CONTENT (optional distant layer)
    cloudInfo.buildMs = performance.now() - t0;
  };
  await clouds.setNoise(await loadCloudNoise('/clouds/noise/')); // INTEGRATION

  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);
  resize();

  let bookmark: BookmarkName = isName(query.get('bookmark') ?? '') ? (query.get('bookmark') as BookmarkName) : 'vantage';
  const applyBookmark = (name: string) => {
    if (!isName(name)) throw new Error(`unknown bookmark: ${name}`);
    bookmark = name;
    sky.setTimeOfDay(TIME + BOOKMARKS[name].dTime);
  };
  const pose = (t: number) => {
    const b: { eye: number[]; az: number; pitch: number } = { ...BOOKMARKS[bookmark], eye: [...BOOKMARKS[bookmark].eye] }, d = query.get('drift') === '0' ? 0 : 1;
    if (query.has('pos')) { b.eye = query.get('pos')!.split(',').map(Number); b.az = num('az', 0); b.pitch = num('pitch', 0); } // ?pos=x,y,z (relative to the terrace) &az= &pitch=: free camera
    const x = b.eye[0] + d * 0.7 * Math.sin(t * 0.11), y = b.eye[1] + d * 0.1 * Math.sin(t * 0.07 + 1), z = b.eye[2] + d * 0.4 * Math.sin(t * 0.09 + 2);
    camera.position.set(x, terrain.heightAt(x, z) + y, z); // eye heights are above the ground (the viewing spot is a low rise)
    camera.rotation.set(((b.pitch + d * 0.35 * Math.sin(t * 0.05)) * Math.PI) / 180, (-(b.az + d * 1.2 * Math.sin(t * 0.06 + 0.5)) * Math.PI) / 180, 0);
  };

  const hud = document.createElement('pre');
  hud.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:4px 6px;background:#0008;color:#fff;font:12px monospace;pointer-events:none';
  if (!SHOW_HUD) hud.style.display = 'none';
  document.body.appendChild(hud);
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;right:8px;top:8px;display:flex;gap:4px';
  if (!SHOW_UI) bar.style.display = 'none';
  for (const name of NAMES) { const b = document.createElement('button'); b.textContent = name; b.onclick = () => applyBookmark(name); bar.appendChild(b); }
  document.body.appendChild(bar);

  const frameTimes: number[] = [], sceneGpu: number[] = [];
  let last = performance.now(), frame = 0, busy = false;
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pct = (p: number) => { const s = [...frameTimes].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  const gpuMs = () => { const c = clouds.timings; const cloudSum = Object.values(c).reduce((x, y) => x + y, 0); return { scene: mean(sceneGpu), ...c, cloudsTotal: cloudSum, total: mean(sceneGpu) + cloudSum }; };
  const t0 = performance.now();
  renderer.setAnimationLoop(now => {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    if (frame > 30) { frameTimes.push(dt * 1000); if (frameTimes.length > 240) frameTimes.shift(); }
    pose((now - t0) / 1000);
    if (clouds.isReady && query.get('fogdrift') !== '0') { // the whole cloud box flows slowly along the valley with the wind: a uniform write per frame (no re-stamp, no light-grid rebuild), so nothing can pop
      const t = (now - t0) / 1000 + num('driftT', 0);
      clouds.core.setVolumePosition([MIN[0] + 150 * Math.sin(t * 0.017), MIN[1], MIN[2] + 35 * Math.sin(t * 0.011 + 1)]); // INTEGRATION-adjacent; peak speed about 2.5 m/s
    }
    sky.update(camera); // INTEGRATION (the sky needs this anyway)
    void sky.updateAerialPerspective(); // INTEGRATION (the sky needs this anyway)
    terrain.update();
    water.update(dt);
    post.render();
    if (!busy) {
      busy = true;
      renderer.resolveTimestampsAsync('render').then(ms => { if (typeof ms === 'number' && ms > 0) { sceneGpu.push(ms); if (sceneGpu.length > 60) sceneGpu.shift(); } }).catch(() => {}).finally(() => { busy = false; });
    }
    if (frame++ % 10 === 0) {
      const g = gpuMs();
      hud.textContent = `onsen  frame p50 ${pct(0.5).toFixed(2)} p95 ${pct(0.95).toFixed(2)} ms  ${renderer.domElement.width}x${renderer.domElement.height}  sun ${sky.sunElevation.toFixed(1)}°\n` +
        `clouds ${clouds.isReady ? 'on' : 'building'}  terrain ${terrain.mesh.visible ? 'on' : 'off'}\n` +
        Object.entries(g).map(([k, v]) => `${k.padEnd(12)} ${v.toFixed(2)}`).join('\n');
    }
    harness.frame();
  });
  applyBookmark(bookmark);
  if (query.get('clouds') !== '0') await buildClouds();
  harness.ready({
    bookmark: name => applyBookmark(name),
    report: () => ({
      gpuMs: gpuMs(), frameMs: { p50: pct(0.5), p95: pct(0.95) }, renderSize: [renderer.domElement.width, renderer.domElement.height], bookmark, frames: frame, cloudsReady: clouds.isReady,
      sun: { elevation: sky.sunElevation, azimuth: sky.sunAzimuth }, terrain: { visible: terrain.mesh.visible, vertices: terrain.mesh.geometry.getAttribute('position').count }, clouds: cloudInfo,
    }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
