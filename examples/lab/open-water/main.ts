// Phase 2 demo: open water and sky with clouds, built like an end user would with @clouds/three. Lines tagged `// INTEGRATION` are
// everything clouds cost this scene; the cloudscape itself (GPU-generated field, see "cloudscape") is content, tagged `// CONTENT`.
import { ACESFilmicToneMapping, PerspectiveCamera, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend } from '@clouds/three'; // INTEGRATION
import { createVolumeGenerator, encodeProceduralWeatherMap, loadCloudNoise, type VolumeGenerator } from '@clouds/runtime'; // CONTENT
import { installCloudsHarness } from '../harness/clouds-contract';
import { createOcean } from '../scenes/ocean';
import { CameraRig } from '../flagship/controls';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);

/** Sun by elevation/azimuth (compass, north = -Z); the camera looks along `lookAz` from `height` metres. The cloud field lies to the north (-Z). */
const BOOKMARKS = {
  shore: { pos: [0, 2, 0], sunEl: 34, sunAz: 120, lookAz: 20, pitch: 8 },
  horizon: { pos: [0, 25, 400], sunEl: 45, sunAz: 200, lookAz: 350, pitch: 1 },
  sunset: { pos: [0, 4, 300], sunEl: 4, sunAz: 355, lookAz: 355, pitch: 5 },
  flight: { pos: [0, 300, -1000], sunEl: 40, sunAz: 150, lookAz: 0, pitch: 0 },
} as const;
type BookmarkName = keyof typeof BOOKMARKS;
const NAMES = Object.keys(BOOKMARKS) as BookmarkName[];
const isName = (n: string): n is BookmarkName => n in BOOKMARKS;

// Cloudscape: 512 x 512 x 64 voxels at 8 m = 4.1 km square, 512 m tall, base 150 m, centred 2.3 km north of the origin.
const FIELD = { dims: [512, 512, 64] as [number, number, number], voxel: 8, base: 150, centre: [0, -2300] as const };
const JOBS_PER_FRAME = Number(query.get('jobs') ?? 2);

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
  const ocean = createOcean(renderer, scene, sky, { sun });
  ocean.mesh.visible = query.get('ocean') !== '0';
  const clouds = new Clouds(renderer, { sky, quality: (query.get('quality') as 'high') ?? 'high' }); // INTEGRATION
  const post = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera); // INTEGRATION
  post.outputNode = clouds.node(scenePass.getTextureNode(), scenePass); // INTEGRATION

  // ---- cloudscape: generated on the GPU at startup, a few jobs per frame; the scene renders without clouds until it is done ----
  const device = sharedBackend(renderer).device; // CONTENT
  const cloudPos: [number, number, number] = [FIELD.centre[0], FIELD.base, FIELD.centre[1]];
  const gen: { current?: VolumeGenerator; frames: number; startMs: number; doneMs: number; gpuSubmitMs: number; source: string } = { frames: 0, startMs: 0, doneMs: 0, gpuSubmitMs: 0, source: 'none' };
  await clouds.setNoise(await loadCloudNoise('/clouds/noise/')); // INTEGRATION
  if (query.get('cloud')) {
    await clouds.load({ volume: `/clouds/${query.get('cloud')}/`, position: [0, 500, -400] }); // asset fallback (also loads the noise)
    gen.source = `asset:${query.get('cloud')}`;
  } else {
    const encoder = device.createCommandEncoder();
    const weather = encodeProceduralWeatherMap(device, encoder, { size: [FIELD.dims[0], FIELD.dims[1]], seed: Number(query.get('seed') ?? 7), scale: Number(query.get('wscale') ?? 12), coverageLo: Number(query.get('lo') ?? 0.5), coverageHi: Number(query.get('hi') ?? 0.64) });
    device.queue.submit([encoder.finish()]);
    gen.current = createVolumeGenerator(device, { dims: FIELD.dims, voxelSize: FIELD.voxel, weather, sliceDepth: 4, params: { useMapHeights: false, baseDefault: Number(query.get('base') ?? 0.08), topMin: Number(query.get('tmin') ?? 0.18), topMax: Number(query.get('tmax') ?? 0.5) } }); // CONTENT
    gen.startMs = performance.now(); gen.source = 'generated';
  }
  const stepGeneration = () => {
    const g = gen.current;
    if (!g) return;
    const t = performance.now();
    const encoder = device.createCommandEncoder({ label: 'cloud generation' });
    g.generate(encoder, JOBS_PER_FRAME);
    device.queue.submit([encoder.finish()]);
    gen.gpuSubmitMs += performance.now() - t; gen.frames++;
    if (g.done) {
      gen.doneMs = performance.now() - gen.startMs;
      // The runtime takes the generator's GpuCloudVolume (caller-owned, so `g` stays alive); the adapter's setVolume() still rejects it, so go through `core`.
      void clouds.core.setVolume(g.volume, { position: [cloudPos[0] - (FIELD.dims[0] * FIELD.voxel) / 2, cloudPos[1], cloudPos[2] - (FIELD.dims[1] * FIELD.voxel) / 2] }).then(() => ready()); // CONTENT (the capture harness waits for the clouds)
      gen.current = undefined;
    }
  };

  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);
  resize();

  let bookmark: BookmarkName = isName(query.get('bookmark') ?? '') ? (query.get('bookmark') as BookmarkName) : 'shore';
  const applyBookmark = (name: string) => {
    if (!isName(name)) throw new Error(`unknown bookmark: ${name}`);
    bookmark = name;
    const b = BOOKMARKS[name];
    sky.setSunDirection({ elevation: b.sunEl, azimuth: b.sunAz });
    const az = (b.lookAz * Math.PI) / 180, pitch = (b.pitch * Math.PI) / 180;
    const d = [Math.sin(az) * Math.cos(pitch), Math.sin(pitch), -Math.cos(az) * Math.cos(pitch)];
    rig.set([...b.pos], [b.pos[0] + d[0] * 100, b.pos[1] + d[1] * 100, b.pos[2] + d[2] * 100]);
  };
  const hud = document.createElement('pre');
  hud.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:4px 6px;background:#0008;color:#fff;font:12px monospace;pointer-events:none';
  document.body.appendChild(hud);
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;right:8px;top:8px;display:flex;gap:4px';
  for (const name of NAMES) { const b = document.createElement('button'); b.textContent = name; b.onclick = () => applyBookmark(name); bar.appendChild(b); }
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
    harness.frame();
  });
  applyBookmark(bookmark);
  const ready = () => harness.ready({
    bookmark: name => applyBookmark(name),
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
