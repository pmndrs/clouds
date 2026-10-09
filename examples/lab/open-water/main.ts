// Phase 2 demo: open water and sky with clouds, built like an end user would with @clouds/three. Lines tagged `// INTEGRATION` are
// everything clouds cost this scene; the cloudscape itself (GPU-generated field, see "cloudscape") is content, tagged `// CONTENT`.
import { ACESFilmicToneMapping, PerspectiveCamera, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass, vec4 } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend, type CloudQuality } from '@clouds/three'; // INTEGRATION
import { CLOUD_PRESETS, type NvdfParams, createVolumeGenerator, encodeProceduralWeatherMap, loadCloudNoise, type CloudPresetName, type VolumeGenerator } from '@clouds/runtime'; // CONTENT
import { installCloudsHarness, readCloudColumns } from '../harness/clouds-contract';
import { createOcean } from '../scenes/ocean';
import { CameraRig } from '../flagship/controls';
import { attachProceduralSky } from '../scenes/procedural-sky';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);

/** Sun by elevation/azimuth (compass, north = -Z); the camera looks along `lookAz` from `height` metres. The cloud field lies to the north (-Z). */
const BOOKMARKS = {
  shore: { pos: [0, 2, 0], sunEl: 34, sunAz: 120, lookAz: 20, pitch: 8 },
  horizon: { pos: [0, 25, 400], sunEl: 45, sunAz: 200, lookAz: 350, pitch: 1 },
  sunset: { pos: [0, 4, 300], sunEl: 4, sunAz: 355, lookAz: 355, pitch: 5 },
  cruise: { pos: [0, 300, 900], sunEl: 40, sunAz: 150, lookAz: 90, pitch: -14 }, // open sea from 300 m: shows the detail-tile crosshatch if it comes back
  flight: { pos: [0, 300, -1000], sunEl: 40, sunAz: 150, lookAz: 0, pitch: 0 },
} as const;
type BookmarkName = keyof typeof BOOKMARKS;
const NAMES = Object.keys(BOOKMARKS) as BookmarkName[];
const isName = (n: string): n is BookmarkName => n in BOOKMARKS;

// Cloudscape: 512 x 512 x 64 voxels at 8 m = 4.1 km square, 512 m tall, base 150 m, centred 2.3 km north of the origin.
const FIELD = { dims: [512, 512, 64] as [number, number, number], voxel: 8, base: 150, centre: [0, -2300] as const };
// ?hud=0 hides the debug text, ?clean=1 hides all UI (hud and bookmark buttons). ?sky=0 turns the distant sky layer off. ?model=hybrid|procedural (X3): a procedural sky, see scenes/procedural-sky.ts. ?quality=auto|low|medium|high|ultra.
const SHOW_HUD = query.get('hud') !== '0' && query.get('clean') !== '1', SHOW_UI = query.get('clean') !== '1';
const SKY_LAYER = query.get('sky') !== '0';
const JOBS_PER_FRAME = Number(query.get('jobs') ?? 2);
// X4: in ?model=hybrid the procedural sky replaces the sky layer, so nothing continues the generated field past its box. With the layer's seamless
// border 0 the clouds at the walls were cut flat (the cut face shows their interior: X3's blocky "spike" at the south-east corner in `cruise`). Hybrid
// fades the field's coverage out over the outer HYBRID_FADE metres instead, and the procedural field fades in over the same band (boxCarve): a cross-fade.
const HYBRID = query.get('model') === 'hybrid';
const HYBRID_FADE = Number(query.get('fade') ?? 400);

try {
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = Number(query.get('exposure') ?? 0.35);
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  renderer.setPixelRatio(1);
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, 0.5, 600000);
  const rig = new CameraRig(camera, renderer.domElement);
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 14, latitude: 40, north: '-Z', mirrorBelowHorizon: true });
  sky.attach(scene);
  const sun = sky.createSun({ physical: true });
  sun.attach(scene);
  await sky.compileAsync();
  const clouds = new Clouds(renderer, { sky, quality: (query.get('quality') ?? 'high') as CloudQuality }); // INTEGRATION
  const ocean = createOcean(renderer, scene, sky, { sun, reflection: query.get('reflect') === '0' ? undefined : dir => { const r = clouds.reflection(dir); return query.has('refgain') ? vec4(r.rgb.mul(Number(query.get('refgain'))), r.a) : r; } }); // INTEGRATION (cloud reflections on the water)
  // P10-A: ?shadowmap=0 falls back to the light-grid shadow, ?shadowdebug=1|2 outlines the shadow map's contour on the ground | on the cloud base plane, ?sunel= ?sunaz= override the bookmark's sun.
  clouds.core.shadowMap.settings.enabled = query.get('shadowmap') !== '0'; clouds.core.shadowMap.settings.debug = (Number(query.get('shadowdebug') ?? 0) | 0) as 0 | 1 | 2;
  for (const k of Object.keys(clouds.core.shadowMap.settings)) { const v = query.get('sm_' + k); if (v !== null && k !== 'enabled') (clouds.core.shadowMap.settings as unknown as Record<string, number>)[k] = Number(v); } // ?sm_steps=32 ?sm_refreshFrames=16 ...
  ocean.mesh.visible = query.get('ocean') !== '0';
  if (query.get('cloudshadow') !== '0') clouds.applyShadow(sun.light); // INTEGRATION (P10-B: cloud shadow dims the sun glint and direct light; ?cloudshadow=0 keeps the composite-alpha shadow)
  if (query.has('wave')) { ocean.settings.waveScale = Number(query.get('wave')); ocean.settings.choppiness = 0.2; } // ?wave=0.05: near-flat water for judging reflections
  const post = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera); // INTEGRATION
  post.outputNode = clouds.node(scenePass.getTextureNode(), scenePass); // INTEGRATION

  // ---- cloudscape: generated on the GPU at startup, a few jobs per frame; the scene renders without clouds until it is done ----
  const device = sharedBackend(renderer).device; // CONTENT
  const cloudPos: [number, number, number] = [FIELD.centre[0], FIELD.base, FIELD.centre[1]];
  const gen: { weatherOpts?: Parameters<typeof encodeProceduralWeatherMap>[2]; params?: Partial<NvdfParams>; current?: VolumeGenerator; frames: number; startMs: number; doneMs: number; gpuSubmitMs: number; source: string } = { frames: 0, startMs: 0, doneMs: 0, gpuSubmitMs: 0, source: 'none' };
  await clouds.setNoise(await loadCloudNoise('/clouds/noise/')); // INTEGRATION
  if (query.get('cloud')) {
    await clouds.load({ volume: `/clouds/${query.get('cloud')}/`, position: [0, 500, -400] }); // asset fallback (also loads the noise)
    gen.source = `asset:${query.get('cloud')}`;
  } else {
    const encoder = device.createCommandEncoder();
    const preset = CLOUD_PRESETS[(query.get('preset') as CloudPresetName) ?? 'cumulus'] ?? CLOUD_PRESETS.cumulus; // CONTENT
    const seed = Number(query.get('seed') ?? 7);
    const weatherOpts = { ...preset.weather, coverageLo: Number(query.get('lo') ?? 0.56), coverageHi: Number(query.get('hi') ?? 0.9), ...(query.has('cellular') ? { cellular: Number(query.get('cellular')) } : {}), // preset value unless ?cellular= overrides (P7-F fixed the slab look in the generator)
        ...(query.has('cells') ? { cellScale: Number(query.get('cells')) } : {}), // sparser than the preset: fair-weather cumulus with blue sky between, all the way out
       size: [FIELD.dims[0], FIELD.dims[1]] as [number, number], seed, ...(HYBRID ? { border: HYBRID_FADE / (FIELD.dims[0] * FIELD.voxel) } : SKY_LAYER ? { border: 0 } : {}) }; // border 0: one continuous field the sky layer carries to the horizon
    gen.weatherOpts = weatherOpts; gen.params = { ...preset.params, seed };
    const weather = encodeProceduralWeatherMap(device, encoder, weatherOpts);
    device.queue.submit([encoder.finish()]);
    gen.current = createVolumeGenerator(device, { dims: FIELD.dims, voxelSize: FIELD.voxel, weather, sliceDepth: 4, params: { ...preset.params, seed } }); // CONTENT
    gen.startMs = performance.now(); gen.source = 'generated';
  }
  let genVolume: VolumeGenerator['volume'] | undefined;
  const stepGeneration = () => {
    const g = gen.current;
    if (!g) return;
    const t = performance.now();
    const encoder = device.createCommandEncoder({ label: 'cloud generation' });
    g.generate(encoder, JOBS_PER_FRAME);
    device.queue.submit([encoder.finish()]);
    gen.gpuSubmitMs += performance.now() - t; gen.frames++;
    if (g.done) {
      gen.doneMs = performance.now() - gen.startMs; genVolume = g.volume;
      void clouds.setVolume(g.volume, { position: cloudPos }).then(async () => {
        // X3: ?model=hybrid puts the generated field inside a procedural sky (the field replaces it in its box over a 400 m cross-fade, X4; ?proc_boxCarve=0 for the union).
        if (await attachProceduralSky(clouds.core, device, query, { boxCarve: HYBRID_FADE })) { ready(); return; }
        if (SKY_LAYER && gen.weatherOpts) { const l = clouds.core.skyLayer; l.configure({ weather: gen.weatherOpts, shape: gen.params, voxelSize: FIELD.voxel, rimWidth: 0 }); l.settings.enabled = true; for (const k of Object.keys(l.settings)) { const v = query.get('sky_' + k); if (v !== null) (l.settings as unknown as Record<string, number | boolean>)[k] = typeof (l.settings as unknown as Record<string, unknown>)[k] === 'boolean' ? v === '1' : Number(v); } } // INTEGRATION (cloud cover to the horizon)
        skyWait = SKY_LAYER && clouds.core.skyLayer.settings.enabled; if (!skyWait) ready();
      }); // INTEGRATION (the volume stays caller-owned: `g` stays alive; the harness waits for the clouds)
      gen.current = undefined;
    }
  };

  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);
  resize();

  let skyWait = false, readyFired = false;
  let bookmark: BookmarkName = isName(query.get('bookmark') ?? '') ? (query.get('bookmark') as BookmarkName) : 'shore';
  const applyBookmark = (name: string) => {
    if (!isName(name)) throw new Error(`unknown bookmark: ${name}`);
    bookmark = name;
    const b: { pos: number[]; sunEl: number; sunAz: number; lookAz: number; pitch: number } = { ...BOOKMARKS[name], pos: [...BOOKMARKS[name].pos] };
    if (query.has('pos')) b.pos = query.get('pos')!.split(',').map(Number); // ?pos=x,y,z ?az= ?pitch=: free camera for debugging
    if (query.has('az')) b.lookAz = Number(query.get('az'));
    if (query.has('pitch')) b.pitch = Number(query.get('pitch'));
    sky.setSunDirection({ elevation: Number(query.get('sunel') ?? b.sunEl), azimuth: Number(query.get('sunaz') ?? b.sunAz) });
    const az = (b.lookAz * Math.PI) / 180, pitch = (b.pitch * Math.PI) / 180;
    const d = [Math.sin(az) * Math.cos(pitch), Math.sin(pitch), -Math.cos(az) * Math.cos(pitch)];
    rig.set([...b.pos], [b.pos[0] + d[0] * 100, b.pos[1] + d[1] * 100, b.pos[2] + d[2] * 100]);
  };
  const hud = document.createElement('pre');
  hud.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:4px 6px;background:#0008;color:#fff;font:12px monospace;pointer-events:none';
  hud.style.display = SHOW_HUD ? '' : 'none';
  document.body.appendChild(hud);
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;right:8px;top:8px;display:flex;gap:4px';
  for (const name of NAMES) { const b = document.createElement('button'); b.textContent = name; b.onclick = () => applyBookmark(name); bar.appendChild(b); }
  bar.style.display = SHOW_UI ? 'flex' : 'none';
  document.body.appendChild(bar);

  const frameTimes: number[] = [], sceneGpu: number[] = [];
  let last = performance.now(), frame = 0, busy = false;
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pct = (p: number) => { const s = [...frameTimes].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  const gpuMs = () => { const c = clouds.timings; const cloudSum = Object.values(c).reduce((x, y) => x + y, 0); return { scene: mean(sceneGpu), ...c, cloudsTotal: cloudSum, total: mean(sceneGpu) + cloudSum }; };
  renderer.setAnimationLoop(now => {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    if (frame > 30) { frameTimes.push(dt * 1000); if (frameTimes.length > 240) frameTimes.shift(); }
    stepGeneration();
    rig.update(dt);
    camera.position.y = Math.max(camera.position.y, ocean.heightAt(camera.position.x, camera.position.z) + 0.6); // above the swell
    camera.near = Math.min(50, Math.max(0.2, camera.position.y * 0.05));
    camera.updateProjectionMatrix();
    sky.update(camera); // INTEGRATION (the sky needs this anyway)
    void sky.updateAerialPerspective(); // INTEGRATION (the sky needs this anyway)
    ocean.update(dt, camera);
    post.render();
    if (!busy) {
      busy = true;
      renderer.resolveTimestampsAsync('render').then(ms => { if (typeof ms === 'number' && ms > 0) { sceneGpu.push(ms); if (sceneGpu.length > 60) sceneGpu.shift(); } }).catch(() => {}).finally(() => { busy = false; });
    }
    if (frame++ % 10 === 0) {
      const g = gpuMs();
      hud.textContent = `frame p50 ${pct(0.5).toFixed(2)} p95 ${pct(0.95).toFixed(2)} ms  ${renderer.domElement.width}x${renderer.domElement.height}\n` +
        `clouds ${clouds.isReady ? 'on' : gen.current ? `generating ${gen.current.jobsDone}/${gen.current.jobsTotal}` : 'loading'}\n` +
        Object.entries(g).map(([k, v]) => `${k.padEnd(12)} ${v.toFixed(2)}`).join('\n');
    }
    if (skyWait && !readyFired && (clouds.core.skyLayer.info?.frames ?? 0) >= 20) { readyFired = true; ready(); } // the layer needs its first amortization cycle
    harness.frame();
  });
  applyBookmark(bookmark);
  const ready = () => harness.ready({
    bookmark: name => applyBookmark(name),
    fields: () => genVolume ? readCloudColumns(device, genVolume.nvdf, FIELD.dims, FIELD.voxel, { weather: gen.weatherOpts, params: gen.params, extentMeters: FIELD.dims[0] * FIELD.voxel, baseMeters: FIELD.base }) : Promise.reject(new Error('no generated field (asset cloud?)')),
    report: () => ({
      gpuMs: gpuMs(), frameMs: { p50: pct(0.5), p95: pct(0.95) }, renderSize: [renderer.domElement.width, renderer.domElement.height], bookmark, frames: frame, cloudsReady: clouds.isReady,
      generation: { source: gen.source, frames: gen.frames, jobsPerFrame: JOBS_PER_FRAME, wallMs: gen.doneMs, encodeSubmitMsTotal: gen.gpuSubmitMs },
    }),
  });
  if (!gen.current) ready(); // generated clouds call ready() themselves once uploaded
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
