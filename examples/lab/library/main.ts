// P9-F: the authored cloud library (assets/clouds/library, grown with Houdini Pyro by scripts/vdb/authoring/sim/library.py),
// stamped Atlas-style into one cloud region: every library cloud appears several times, each with its own yaw, scale and position,
// bases on one condensation level, neighbours allowed to overlap into "frankenclouds".
//
//   ?seed=N          layout seed (default 7)                    ?count=N   instances (default 36)
//   ?spacing=F       minimum gap between footprints as a fraction of their radii sum (default 0.55; lower = more merging)
//   ?repeat=M        minimum distance between two copies of the same library cloud (default 1800 m)
//   ?gen=1           add the GPU generator's cumulus underneath (filler between the stamps; default off)
//   ?only=a,b        stamp only these library clouds            ?quality=  ?exposure=  ?clean=1 (no UI)
//   ?sheet=1         contact-sheet mode: one cloud at a time, isolated and side-lit; bookmarks are the cloud names
//                    (node scripts/gpu/capture.mjs --serve --page library/ --query sheet=1 --shots humilis-a,congestus-a,...)
import { ACESFilmicToneMapping, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend, type CloudQuality } from '@clouds/three';
import {
  CLOUD_PRESETS, createEmptyCloudVolume, createGeneratorScratch, createSdfRebuilder, createVolumeGenerator, encodeProceduralWeatherMap, loadCloudNoise, loadCloudVolume,
  stampCloud, uploadCloudVolume, type GpuCloudVolume,
} from '@clouds/runtime';
import { installCloudsHarness, readCloudColumns } from '../harness/clouds-contract';
import { CameraRig } from '../flagship/controls';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const num = (k: string, d: number) => (query.has(k) ? Number(query.get(k)) : d);
const SHEET = query.get('sheet') === '1';
const CLEAN = query.get('clean') === '1' || SHEET;

interface LibraryEntry {
  name: string; species: string; sizeMeters: [number, number, number]; baseMeters: number; topMeters: number; voxelSizeMeters: number; bytes: number;
  stamp: { detailType?: number; densityScale?: number; scale?: [number, number]; weight?: number };
}

/** Scape region: 512 x 512 x 128 at 12 m = 6.1 km square, 1.5 km tall; floor at 600 m, cloud bases near 680 m. Sheet region: 2 km square at 8 m. */
const FIELD = SHEET
  ? { dims: [256, 256, 200] as [number, number, number], voxel: 8, centre: [0, -2000] as const, floor: 300, level: 40 }
  : { dims: [512, 512, 128] as [number, number, number], voxel: 12, centre: [0, -3400] as const, floor: 600, level: 80 };
const EXTENT = [FIELD.dims[0] * FIELD.voxel, FIELD.dims[2] * FIELD.voxel, FIELD.dims[1] * FIELD.voxel] as const; // world x, y, z

/** Compass: north = -Z. The scape spans z = -6472 .. -328, x = -3072 .. 3072. */
const BOOKMARKS = {
  ground: { pos: [200, 2, -900], sunEl: 42, sunAz: 120, lookAz: 10, pitch: 14 },
  horizon: { pos: [-400, 40, 300], sunEl: 38, sunAz: 105, lookAz: 4, pitch: 4 },
  above: { pos: [0, 2700, 500], sunEl: 40, sunAz: 140, lookAz: 0, pitch: -38 },
} as const;
type BookmarkName = keyof typeof BOOKMARKS;

const mulberry32 = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

interface Instance { name: string; x: number; z: number; yaw: number; scale: number; bottom: number; radius: number }

/** Seeded layout: shuffled rounds of the library (each cloud `stamp.weight` times per round) dealt `count` times; rejection-sampled positions, partial overlap allowed. */
function layout(lib: LibraryEntry[], count: number, seed: number, spacing: number, repeatGap: number): Instance[] {
  const rnd = mulberry32(seed * 9973 + 17);
  const deck: LibraryEntry[] = [];
  while (deck.length < count) {
    const round = lib.flatMap(e => Array<LibraryEntry>(Math.max(1, Math.round(e.stamp.weight ?? 1))).fill(e));
    for (let i = round.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [round[i], round[j]] = [round[j], round[i]]; }
    deck.push(...round);
  }
  deck.length = count;
  // big ones first, so the small ones fill the gaps
  deck.sort((a, b) => b.sizeMeters[0] * b.sizeMeters[1] - a.sizeMeters[0] * a.sizeMeters[1]);
  const placed: Instance[] = [];
  for (const e of deck) {
    const [s0, s1] = e.stamp.scale ?? [0.75, 1.3];
    let scale = s0 + (s1 - s0) * rnd();
    const maxScale = (EXTENT[1] - FIELD.level - FIELD.voxel * 2) / e.sizeMeters[2];
    scale = Math.min(scale, maxScale);
    const yaw = rnd() * Math.PI * 2;
    const radius = 0.5 * Math.hypot(e.sizeMeters[0], e.sizeMeters[1]) * scale;   // the yawed box always fits inside this
    const core = 0.35 * (e.sizeMeters[0] + e.sizeMeters[1]) * scale;              // typical footprint radius, for spacing
    let best: Instance | undefined, bestGap = -Infinity;
    for (let tries = 0; tries < 300; tries++) {
      const x = radius + rnd() * (EXTENT[0] - 2 * radius), z = radius + rnd() * (EXTENT[2] - 2 * radius);
      let gap = Infinity;
      // copies of the same cloud keep `repeatGap` metres apart, so no two twins sit side by side
      for (const p of placed) gap = Math.min(gap, Math.hypot(p.x - x, p.z - z) / (p.name === e.name ? Math.max(repeatGap, spacing * (p.radius + core)) : spacing * (p.radius + core)));
      if (gap >= 1) { best = { name: e.name, x, z, yaw, scale, bottom: 0, radius: core }; bestGap = gap; break; }
      if (gap > bestGap) { bestGap = gap; best = { name: e.name, x, z, yaw, scale, bottom: 0, radius: core }; }
    }
    if (!best || bestGap < 0.6) continue; // no room left: drop it rather than pile it onto another
    best.bottom = FIELD.level + (rnd() - 0.5) * 16 - e.baseMeters * scale; // the asset box floor, so its flat base sits on the level
    placed.push(best);
  }
  return placed;
}

try {
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = num('exposure', 0.4);
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  renderer.setPixelRatio(1);
  const scene = new Scene();
  const camera = new PerspectiveCamera(SHEET ? 40 : 60, 1, 0.5, 600000);
  const rig = new CameraRig(camera, renderer.domElement);
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 14, latitude: 40, north: '-Z', mirrorBelowHorizon: true });
  sky.attach(scene);
  const sun = sky.createSun({ physical: true });
  sun.attach(scene);
  await sky.compileAsync();
  const ground = new Mesh(new PlaneGeometry(400000, 400000).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x2f3a28, roughness: 1 }));
  scene.add(ground);
  const clouds = new Clouds(renderer, { sky, quality: (query.get('quality') as CloudQuality) ?? 'high' });
  const post = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  post.outputNode = clouds.node(scenePass.getTextureNode(), scenePass);
  const device = sharedBackend(renderer).device;
  device.addEventListener('uncapturederror', e => harness.fail((e as GPUUncapturedErrorEvent).error.message));
  await clouds.setNoise(await loadCloudNoise('/clouds/noise/'));

  // ---- the library
  const index = (await (await fetch('/clouds/library/index.json')).json()) as { clouds: LibraryEntry[] };
  const only = query.get('only')?.split(',');
  const lib = index.clouds.filter(c => !only || only.includes(c.name));
  if (!lib.length) throw new Error('library is empty (run scripts/vdb/authoring/sim/library.py)');
  const gpu = new Map<string, GpuCloudVolume>();
  await Promise.all(lib.map(async e => { gpu.set(e.name, uploadCloudVolume(device, await loadCloudVolume(`/clouds/library/${e.name}/`))); }));
  const byName = new Map(lib.map(e => [e.name, e]));

  const info = { buildMs: 0, instances: [] as Instance[], current: '' };
  let volume: GpuCloudVolume | undefined;
  let genKeep: { destroy(): void } | undefined;
  /** Builds a region holding `instances` (all stamped in one encoder, SDF rebuilt once) and swaps it in. */
  const build = async (instances: Instance[], withGenerator: boolean) => {
    const t0 = performance.now();
    const scratch = createGeneratorScratch(device, FIELD.dims, 'library');
    let target: GpuCloudVolume;
    const enc = device.createCommandEncoder({ label: 'library stamps' });
    let gen: ReturnType<typeof createVolumeGenerator> | undefined;
    if (withGenerator) {
      const preset = CLOUD_PRESETS.cumulus, H = EXTENT[1];
      const params = { ...preset.params, seed: num('seed', 7), baseDefault: FIELD.level / H, topFraction: (FIELD.level + 300) / H, baseLift: 0.0 };
      const weatherOpts = { ...preset.weather, coverageLo: num('lo', 0.72), coverageHi: num('hi', 0.98), size: [FIELD.dims[0], FIELD.dims[1]] as [number, number], seed: num('seed', 7) };
      const e0 = device.createCommandEncoder();
      const weather = encodeProceduralWeatherMap(device, e0, weatherOpts);
      device.queue.submit([e0.finish()]);
      gen = createVolumeGenerator(device, { dims: FIELD.dims, voxelSize: FIELD.voxel, weather, params, scratch });
      gen.generate(enc);
      target = gen.volume;
    } else {
      target = createEmptyCloudVolume(device, FIELD.dims, FIELD.voxel, 'library region');
    }
    for (const it of instances) {
      const e = byName.get(it.name)!;
      stampCloud(device, enc, target, gpu.get(it.name)!, {
        position: [it.x, it.bottom + (e.sizeMeters[2] * it.scale) / 2, it.z], yaw: it.yaw, scale: it.scale, mode: 'max',
        detailType: e.stamp.detailType, densityScale: e.stamp.densityScale,
      });
    }
    device.queue.submit([enc.finish()]);
    const rebuild = createSdfRebuilder(device, target, { scratch });
    const enc2 = device.createCommandEncoder({ label: 'library sdf' });
    rebuild.generate(enc2);
    device.queue.submit([enc2.finish()]);
    await device.queue.onSubmittedWorkDone();
    rebuild.destroy(); if (!gen) scratch.destroy();
    await clouds.setVolume(target, { position: [FIELD.centre[0], FIELD.floor, FIELD.centre[1]] });
    const old = genKeep;
    volume = target; genKeep = gen ?? target;
    old?.destroy();
    info.buildMs = performance.now() - t0;
    info.instances = instances;
  };

  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);
  resize();

  const look = (pos: readonly number[], azDeg: number, pitchDeg: number) => {
    const az = (azDeg * Math.PI) / 180, pitch = (pitchDeg * Math.PI) / 180;
    const d = [Math.sin(az) * Math.cos(pitch), Math.sin(pitch), -Math.cos(az) * Math.cos(pitch)];
    rig.set([...pos], [pos[0] + d[0] * 100, pos[1] + d[1] * 100, pos[2] + d[2] * 100]);
  };
  let bookmark = '';
  const applyBookmark = async (name: string) => {
    if (SHEET) {
      // one cloud, centred, side-lit from the east (camera looks north), framed to fit
      const e = byName.get(name);
      if (!e) throw new Error(`unknown library cloud: ${name}`);
      bookmark = name; info.current = name;
      const [w, , h] = e.sizeMeters;
      await build([{ name, x: EXTENT[0] / 2, z: EXTENT[2] / 2, yaw: 0, scale: 1, bottom: FIELD.level - e.baseMeters, radius: 0 }], false);
      const half = Math.tan((camera.fov * Math.PI) / 360);
      const dist = Math.max((h / 2) / half, (w / 2) / (half * camera.aspect)) * 1.25 + e.sizeMeters[1] / 2;
      const cy = FIELD.floor + FIELD.level + h / 2;
      sky.setSunDirection({ elevation: num('sunel', 22), azimuth: num('sunaz', 90) });
      look([FIELD.centre[0], cy, FIELD.centre[1] + dist], 0, 0);
      return;
    }
    if (!(name in BOOKMARKS)) throw new Error(`unknown bookmark: ${name}`);
    bookmark = name;
    const b = BOOKMARKS[name as BookmarkName];
    sky.setSunDirection({ elevation: num('sunel', b.sunEl), azimuth: num('sunaz', b.sunAz) });
    look(b.pos, b.lookAz, b.pitch);
  };

  const hud = document.createElement('pre');
  hud.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:4px 6px;background:#0008;color:#fff;font:12px monospace;pointer-events:none';
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;right:8px;top:8px;display:flex;flex-wrap:wrap;gap:4px;max-width:60vw;justify-content:flex-end';
  for (const name of SHEET ? lib.map(e => e.name) : Object.keys(BOOKMARKS)) { const b = document.createElement('button'); b.textContent = name; b.onclick = () => void applyBookmark(name); bar.appendChild(b); }
  if (!CLEAN) { document.body.appendChild(hud); document.body.appendChild(bar); }

  const frameTimes: number[] = [];
  let last = performance.now(), frame = 0;
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pct = (p: number) => { const s = [...frameTimes].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  const gpuMs = () => { const c = clouds.timings; return { ...c, cloudsTotal: Object.values(c).reduce((x, y) => x + y, 0) }; };
  renderer.setAnimationLoop(now => {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    if (frame > 30) { frameTimes.push(dt * 1000); if (frameTimes.length > 240) frameTimes.shift(); }
    rig.update(dt);
    camera.near = Math.min(50, Math.max(0.2, camera.position.y * 0.05));
    camera.updateProjectionMatrix();
    sky.update(camera);
    void sky.updateAerialPerspective();
    post.render();
    if (frame++ % 10 === 0 && !CLEAN) {
      const g = gpuMs();
      hud.textContent = `library  ${lib.length} clouds, ${info.instances.length} instances  frame p50 ${pct(0.5).toFixed(2)} ms  ${renderer.domElement.width}x${renderer.domElement.height}\n` +
        `clouds ${clouds.isReady ? 'on' : 'building'}  build ${info.buildMs.toFixed(0)} ms  gpu ${g.cloudsTotal.toFixed(2)} ms`;
    }
    harness.frame();
  });

  if (SHEET) await applyBookmark(query.get('bookmark') ?? lib[0].name);
  else {
    await build(layout(lib, num('count', 36), num('seed', 7), num('spacing', 0.55), num('repeat', 1800)), query.get('gen') === '1');
    await applyBookmark(query.get('bookmark') ?? 'ground');
  }
  harness.ready({
    bookmark: name => applyBookmark(name),
    fields: () => readCloudColumns(device, volume!.nvdf, FIELD.dims, FIELD.voxel, { page: 'library', seed: num('seed', 7), instances: info.instances.length, library: lib.length, extentMeters: EXTENT[0], baseMeters: FIELD.floor }),
    report: () => ({
      gpuMs: gpuMs(), frameMs: { p50: pct(0.5), p95: pct(0.95), mean: mean(frameTimes) }, renderSize: [renderer.domElement.width, renderer.domElement.height], bookmark, frames: frame, cloudsReady: clouds.isReady,
      library: { clouds: lib.length, megabytes: lib.reduce((s, e) => s + e.bytes, 0) / 1048576 },
      build: { ms: info.buildMs, instances: info.instances.length, perCloud: Object.fromEntries(lib.map(e => [e.name, info.instances.filter(i => i.name === e.name).length])), current: info.current },
    }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
