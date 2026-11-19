// L1: target page for the target-driven authoring loop (docs/archive/PLAN-2026-10-next.md, "Authoring loop").
// Renders ONE candidate cloud from a camera that matches the target photo's framing and sun, so the render can be scored against
// the photo's target card (scripts/targets/card.py, scripts/targets/match.py).  Default target: the hero tower of "Texas afternoon".
//
//   ?src=local/texas-tower/        where candidates live under /clouds/ (default; gitignored sims). Committed picks: targets/texas-tower/
//   ?cand=v00&yaw=0                the candidate and its yaw (deg)          bookmarks: "<cand>@<yaw>", e.g. v03@90, and "sky" (no cloud: the
//                                  plate scripts/targets/match.py segments renders against)
//   ?photo=1                       side by side with the owner's photo (local only; via the compare page's /__photos dev middleware)
//   ?sunel=45&sunaz=-150           sun elevation / azimuth (deg, the sky's convention; the camera looks north, so -150 is behind-left)
//   ?quality=high  ?exposure=0.4  ?clean=1 (no HUD)
//
// MATCHING CAMERA (photo 2000x1336, no EXIF; assumed 46 deg vertical FOV, i.e. a 28 mm full-frame lens): the horizon is hidden by
// trees just above the bottom edge (row ~1320), so the camera pitches up ~22.5 deg.  The tower base row 1094 sits at ~7.5 deg
// elevation, the crown row 470 at ~29.5 deg, the tower centre column ~1495 at ~+18 deg azimuth.  Each candidate is placed so that its
// base and top land on those elevations: front distance d = (H - D/2 tan(top)) / (tan(top) - tan(base)), base altitude = d tan(base).
import { ACESFilmicToneMapping, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend, type CloudQuality } from '@clouds/three';
import { createEmptyCloudVolume, createGeneratorScratch, createSdfRebuilder, loadCloudNoise, loadCloudVolume, stampCloud, uploadCloudVolume, type GpuCloudVolume } from '@clouds/runtime';
import { installCloudsHarness } from '../harness/clouds-contract';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const num = (k: string, d: number) => (query.has(k) ? Number(query.get(k)) : d);
const SRC = query.get('src') ?? 'local/texas-tower/';
const PHOTO = query.get('photo') === '1';
const CLEAN = query.get('clean') === '1';
const deg = Math.PI / 180;

/** The target's framing (see the header). */
const FRAME = { vfov: 46, pitch: 22.5, baseEl: 7.5, topEl: 29.5, az: 18, photo: '_targets/texas-afternoon.jpg' };

interface Candidate { name: string; dims: [number, number, number]; voxelSizeMeters: number; sizeMeters: [number, number, number]; baseMeters: number; topMeters: number }

try {
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = num('exposure', 0.4);
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;display:flex;background:#000';
  document.body.appendChild(wrap);
  wrap.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = `flex:1;min-width:0;height:100%`;
  if (PHOTO) {
    const img = document.createElement('img');
    img.style.cssText = 'flex:1;min-width:0;height:100%;object-fit:contain;background:#000';
    wrap.appendChild(img);
    void fetch('/__photos/index.json').then(r => r.json()).then((ix: { items: { folder: string; file: string; path: string }[] }) => {
      const it = ix.items.find(i => `${i.folder}/${i.file}` === FRAME.photo);
      if (it) img.src = `/@fs${it.path}`;
    }).catch(() => undefined);
  }
  await renderer.init();
  renderer.setPixelRatio(1);
  const scene = new Scene();
  const camera = new PerspectiveCamera(FRAME.vfov, 1, 1, 600000);
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 15, latitude: 31, north: '-Z', mirrorBelowHorizon: true });
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

  const cache = new Map<string, { asset: GpuCloudVolume; info: Candidate }>();
  const getCandidate = async (name: string) => {
    let c = cache.get(name);
    if (!c) {
      const url = `/clouds/${SRC}${name}/`;
      const m = (await (await fetch(`${url}manifest.json`)).json()) as Candidate;
      c = { asset: uploadCloudVolume(device, await loadCloudVolume(url)), info: { ...m, name } };
      cache.set(name, c);
    }
    return c;
  };

  const info = { cand: '', yaw: 0, baseAltitude: 0, distance: 0, buildMs: 0, region: [0, 0, 0] as number[] };
  let shown: GpuCloudVolume | undefined;
  /** Stamps the candidate (yawed) into a fresh region placed so its base and crown land on the photo's elevations, then aims the camera. */
  const show = async (name: string, yawDeg: number) => {
    const t0 = performance.now();
    if (name === 'sky') {
      // the sky plate: same camera and sun with an empty region (the scorer segments renders against it)
      const region = createEmptyCloudVolume(device, [8, 8, 8], 30, 'target empty');
      await clouds.setVolume(region, { position: [0, 20000, -50000] });
      shown?.destroy(); shown = region;
      Object.assign(info, { cand: 'sky', yaw: 0, buildMs: performance.now() - t0 });
      aim();
      return;
    }
    const { asset, info: c } = await getCandidate(name);
    const vs = c.voxelSizeMeters;
    const [sx, sz, sy] = c.sizeMeters;                       // manifest sizeMeters = [x, row, up]
    const H = c.topMeters - c.baseMeters;
    const span = Math.ceil(Math.hypot(sx, sz) / vs) + 4;      // any yaw fits
    const up = Math.ceil(sy / vs) + 4;
    const dims: [number, number, number] = [span, span, up];
    const region = createEmptyCloudVolume(device, dims, vs, 'target region');
    const scratch = createGeneratorScratch(device, dims, 'target');
    const enc = device.createCommandEncoder({ label: 'target stamp' });
    stampCloud(device, enc, region, asset, { position: [(span * vs) / 2, 2 * vs + sy / 2, (span * vs) / 2], yaw: yawDeg * deg, scale: 1, mode: 'max' });
    device.queue.submit([enc.finish()]);
    const rebuild = createSdfRebuilder(device, region, { scratch });
    const enc2 = device.createCommandEncoder({ label: 'target sdf' });
    rebuild.generate(enc2);
    device.queue.submit([enc2.finish()]);
    await device.queue.onSubmittedWorkDone();
    rebuild.destroy(); scratch.destroy();
    // placement: the yawed footprint's depth toward the camera is about the mean of the two sides
    const depth = Math.abs(sx * Math.sin(yawDeg * deg)) + Math.abs(sz * Math.cos(yawDeg * deg));
    const tb = Math.tan(FRAME.baseEl * deg), tt = Math.tan(FRAME.topEl * deg);
    const d = Math.max(500, (H - (depth / 2) * tt) / (tt - tb));     // ground distance from the camera to the near base edge
    const baseAlt = d * tb;
    const dc = d + depth / 2;                                         // to the cloud's centre
    const az = FRAME.az * deg;                                        // camera looks north (-z); the cloud sits to the right
    const cx = Math.sin(az) * dc, cz = -Math.cos(az) * dc;
    // region floor: the asset's base (baseMeters above its box floor) sits on baseAlt; the stamp put the box floor at 2 voxels
    await clouds.setVolume(region, { position: [cx, baseAlt - 2 * vs - c.baseMeters, cz] });
    shown?.destroy();
    shown = region;
    aim();
    Object.assign(info, { cand: name, yaw: yawDeg, baseAltitude: baseAlt, distance: d, buildMs: performance.now() - t0, region: dims });
  };

  function aim() {
    sky.setSunDirection({ elevation: num('sunel', 45), azimuth: num('sunaz', -150) });
    camera.position.set(0, 2, 0);
    const p = FRAME.pitch * deg;
    camera.lookAt(0, 2 + Math.sin(p) * 100, -Math.cos(p) * 100);
  }

  const resize = () => {
    const w = PHOTO ? Math.floor(innerWidth / 2) : innerWidth;
    renderer.setSize(w, innerHeight, false);
    camera.aspect = w / innerHeight; camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  const hud = document.createElement('pre');
  hud.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:4px 6px;background:#0008;color:#fff;font:12px monospace;pointer-events:none';
  if (!CLEAN) document.body.appendChild(hud);
  let frame = 0;
  const frameTimes: number[] = [];
  let last = performance.now();
  renderer.setAnimationLoop(now => {
    const dt = (now - last) / 1000; last = now;
    if (frame > 30) { frameTimes.push(dt * 1000); if (frameTimes.length > 240) frameTimes.shift(); }
    sky.update(camera);
    void sky.updateAerialPerspective();
    post.render();
    if (!CLEAN && frame % 15 === 0) hud.textContent = `target ${FRAME.photo}  cand ${info.cand} yaw ${info.yaw}  base ${info.baseAltitude.toFixed(0)} m at ${(info.distance / 1000).toFixed(1)} km  build ${info.buildMs.toFixed(0)} ms`;
    frame++;
    harness.frame();
  });

  const parse = (b: string): [string, number] => { const [n, y] = b.split('@'); return [n, Number(y ?? 0)]; };
  await show(query.get('cand') ?? 'v00', num('yaw', 0));
  const pct = (p: number) => { const s = [...frameTimes].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  harness.ready({
    bookmark: b => { const [n, y] = parse(b); return show(n, y); },
    report: () => ({
      gpuMs: clouds.timings, frameMs: { p50: pct(0.5), p95: pct(0.95) }, renderSize: [renderer.domElement.width, renderer.domElement.height],
      cloudsReady: clouds.isReady, target: { ...info, frame: FRAME, src: SRC },
    }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
