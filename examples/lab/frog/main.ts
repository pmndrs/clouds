// A3: the owner's Frog cloud, authored in Houdini with the cloud-shape nodes (scripts/vdb/authoring/frog.py), rendered from the
// camera that matches the photo (artifacts/research/cloud-photos/Frog Cloud/DSC00589-Pano.jpg, local only).
//
//   ?src=local/frog/        the converted cloud under /clouds/ (frog.py writes assets/clouds/local/frog/, gitignored)
//   ?photo=1                side by side with the owner's photo (local only, via the compare page's /__photos dev middleware)
//   ?sunel=49&sunaz=180     sun elevation / azimuth (deg, the sky's convention; the camera looks north (-z), 180 = straight behind)
//   ?exposure=  ?quality=high  ?clean=1 (no HUD)
//   bookmarks: photo (the matched camera), right (from the right, 90 deg around the main body), far (pulled back 2x), above
//
// MATCHING CAMERA (frog.py CAMERA): the photo is 1600 x 1392 at 0.0304 deg/px, a pinhole with f = 1800 px, its bottom edge ~2 deg
// above the horizon, so the camera at the origin pitches up 23.1 deg with a vertical FOV of 2 atan(696/1800) = 42.3 deg.  The VDB
// is authored in this camera's world (metres, y up, camera at the origin looking along -z), so the cloud is placed at the
// converter's houdini.cropMinWorld with no further fitting.  Sun: 2022-07-29 16:28 CDT north of Austin is ~49 deg high in the WSW;
// the camera faced away from it (deep blue sky), so the default puts it straight behind the camera.
import { ACESFilmicToneMapping, PerspectiveCamera, Scene, Vector3 } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend, type CloudQuality } from '@clouds/three';
import { loadCloudNoise, loadCloudVolume } from '@clouds/runtime';
import { installCloudsHarness } from '../harness/clouds-contract';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const num = (k: string, d: number) => (query.has(k) ? Number(query.get(k)) : d);
const SRC = query.get('src') ?? 'local/frog/';
const PHOTO = query.get('photo') === '1';
const CLEAN = query.get('clean') === '1';
const deg = Math.PI / 180;
const CAM = { width: 1600, height: 1392, f: 1800, pitch: 23.1, photo: 'Frog Cloud/DSC00589-Pano.jpg' };
const VFOV = 2 * Math.atan(CAM.height / 2 / CAM.f) / deg;
const ASPECT = CAM.width / CAM.height;

interface CloudMeta { dims: [number, number, number]; voxelSizeMeters: number; houdini: { cropMinWorld: [number, number, number] } }

try {
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = num('exposure', 0.5);
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;gap:0;background:#000';
  document.body.appendChild(wrap);
  wrap.appendChild(renderer.domElement);
  let img: HTMLImageElement | undefined;
  if (PHOTO) {
    img = document.createElement('img');
    wrap.appendChild(img);
    void fetch('/__photos/index.json').then(r => r.json()).then((ix: { items: { folder: string; file: string; path: string }[] }) => {
      const it = ix.items.find(i => `${i.folder}/${i.file}` === CAM.photo);
      if (it && img) img.src = `/@fs${it.path}`;
    }).catch(() => undefined);
  }
  await renderer.init();
  renderer.setPixelRatio(1);
  const scene = new Scene();
  const camera = new PerspectiveCamera(VFOV, ASPECT, 1, 600000);
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 16.5, latitude: 30.5, north: '-Z', mirrorBelowHorizon: true });
  sky.attach(scene);
  const sun = sky.createSun({ physical: true });
  sun.attach(scene);
  await sky.compileAsync();
  const clouds = new Clouds(renderer, { sky, quality: (query.get('quality') as CloudQuality) ?? 'high' });
  const post = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  post.outputNode = clouds.node(scenePass.getTextureNode(), scenePass);
  const device = sharedBackend(renderer).device;
  device.addEventListener('uncapturederror', e => harness.fail((e as GPUUncapturedErrorEvent).error.message));
  await clouds.setNoise(await loadCloudNoise('/clouds/noise/'));

  const url = `/clouds/${SRC}`;
  const meta = (await (await fetch(`${url}cloud.json`)).json()) as CloudMeta;
  const asset = await loadCloudVolume(url);
  const vs = meta.voxelSizeMeters;
  const [ex, ez, ey] = [meta.dims[0] * vs, meta.dims[1] * vs, meta.dims[2] * vs];
  const min = meta.houdini.cropMinWorld;
  // Clouds.setVolume takes the base centre; the VDB lives in the camera's world, so its crop min corner is the volume's min corner.
  await clouds.setVolume(asset, { position: [min[0] + ex / 2, min[1], min[2] + ez / 2] });
  const centre = new Vector3(min[0] + ex / 2, min[1] + ey / 2, min[2] + ez / 2);

  let view = 'photo';
  const aim = (name: string) => {
    view = name;
    sky.setSunDirection({ elevation: num('sunel', 49), azimuth: num('sunaz', 180) });
    const p = CAM.pitch * deg;
    if (name === 'photo') {
      camera.position.set(0, 2, 0);
      camera.lookAt(0, 2 + Math.sin(p) * 100, -Math.cos(p) * 100);
    } else if (name === 'far') {
      camera.position.set(0, 2, 4500);
      camera.lookAt(centre.x, centre.y * 0.8, centre.z);
    } else if (name === 'right') {
      const d = Math.hypot(centre.x, centre.z);
      camera.position.set(centre.x + d, 2, centre.z);
      camera.lookAt(centre.x, centre.y * 0.9, centre.z);
    } else if (name === 'above') {
      camera.position.set(centre.x, centre.y + 4000, centre.z + 6000);
      camera.lookAt(centre);
    } else throw new Error(`unknown bookmark ${name}`);
    camera.updateMatrixWorld();
  };
  aim(query.get('view') ?? 'photo');

  const resize = () => {
    // keep the photo's aspect: fit a 1600:1392 box (two of them side by side with ?photo=1)
    const cols = PHOTO ? 2 : 1;
    const h = Math.min(innerHeight, Math.floor(innerWidth / cols / ASPECT));
    const w = Math.floor(h * ASPECT);
    renderer.setSize(w, h, false);
    renderer.domElement.style.cssText = `width:${w}px;height:${h}px`;
    if (img) img.style.cssText = `width:${w}px;height:${h}px;object-fit:fill`;
    camera.aspect = ASPECT; camera.updateProjectionMatrix();
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
    if (!CLEAN && frame % 15 === 0) hud.textContent = `frog ${SRC} view ${view}  dims ${meta.dims.join('x')} @ ${vs} m  sun ${num('sunel', 49)}/${num('sunaz', 180)}`;
    frame++;
    harness.frame();
  });
  const pct = (q: number) => { const s = [...frameTimes].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
  harness.ready({
    bookmark: b => aim(b),
    report: () => ({
      gpuMs: clouds.timings, frameMs: { p50: pct(0.5), p95: pct(0.95) }, renderSize: [renderer.domElement.width, renderer.domElement.height],
      cloudsReady: clouds.isReady, frog: { src: SRC, dims: meta.dims, voxel: vs, minCorner: min, view, camera: { ...CAM, vfov: VFOV } },
    }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
