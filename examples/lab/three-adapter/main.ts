// Minimal @clouds/three scene, written like the P2 spec's target usage. Lines tagged `// INTEGRATION` are the whole cost of adding clouds.
import { ACESFilmicToneMapping, CylinderGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, SphereGeometry, type Vector3Tuple } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds } from '@clouds/three'; // INTEGRATION
import { installCloudsHarness } from '../harness/clouds-contract';
import { BOOKMARK_NAMES, CLOUD_BOX, bookmarkTime, isBookmarkName, placeCloud, resolveBookmark, sunVector } from '../flagship/bookmarks';
import { CameraRig } from '../flagship/controls';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
try {
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = query.has('exposure') ? Number(query.get('exposure')) : 0.35;
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  renderer.setPixelRatio(1);
  const scene = new Scene();
  const camera = new PerspectiveCamera(70, 1, 1, 1500000);
  const rig = new CameraRig(camera, renderer.domElement);
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: bookmarkTime('ground'), latitude: 40, north: '-Z' });
  sky.attach(scene);
  sky.createGround({ mode: 'plane', size: 8000000, color: 0x34461f, roughness: 1 }).attach(scene);
  sky.createSun({ physical: true }).attach(scene);
  await sky.compileAsync();
  const clouds = new Clouds(renderer, { sky: query.get('uniform') === '1' ? undefined : sky, quality: (query.get('quality') as 'high') ?? 'high' }); // INTEGRATION (?uniform=1 drops the sky: uniform lighting mode)
  const asset = await clouds.load({ volume: '/clouds/parkouring/', position: [0, 500, 0] }); // INTEGRATION
  placeCloud(asset); // bookmark framing only (CLOUD_BOX / INSIDE_POINT); not part of the integration
  const post = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera); // INTEGRATION
  const colour = query.get('haze') === '1' ? sky.applyHaze(scenePass.getTextureNode(), { scenePass }) : scenePass.getTextureNode(); // INTEGRATION (haze optional)
  post.outputNode = clouds.node(colour, scenePass); // INTEGRATION
  for (const [key, value] of query) if (key.startsWith('s.') && key.slice(2) in clouds.settings) (clouds.settings as unknown as Record<string, number>)[key.slice(2)] = Number(value);

  // ?objects=1: depth-sorting test. A tower piercing the cloud, a sphere in front of it and a sphere behind it, on the ground bookmark's sight line.
  const OBJECT_BOOKMARKS = ['objects', 'pierce', 'front', 'behind'] as const;
  const objectView = (name: string): { position: Vector3Tuple; target: Vector3Tuple } | null => {
    if (!objectsOn || !(OBJECT_BOOKMARKS as readonly string[]).includes(name)) return null;
    const g = resolveBookmark('ground', sunVector(sky.sunAzimuth, sky.sunElevation));
    const c = CLOUD_BOX.min.map((v, i) => (v + CLOUD_BOX.max[i]) / 2);
    const dx = c[0] - g.position[0], dz = c[2] - g.position[2], d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d;
    const at = (t: number, y: number): Vector3Tuple => [g.position[0] + ux * t, y, g.position[2] + uz * t];
    const tower = at(d, 0), front = at(d * 0.45, 330), behind = at(d + 650, g.position[1] + ((c[1] - g.position[1]) * (d + 650)) / d).map((v, i) => v + (i === 0 ? -uz : i === 2 ? ux : 0) * 300) as Vector3Tuple; // same elevation angle as the cloud centre
    if (name === 'pierce') { const p = at(d - 300, 100); return { position: [p[0] - uz * 150, p[1], p[2] + ux * 150], target: [tower[0], 850, tower[2]] }; }
    if (name === 'front') return { position: g.position, target: front };
    if (name === 'behind') return { position: g.position, target: behind };
    return { position: g.position, target: [c[0], 760, c[2]] };
  };
  const objectsOn = query.get('objects') === '1';
  if (objectsOn) {
    const g = resolveBookmark('ground', sunVector(sky.sunAzimuth, sky.sunElevation));
    const c = CLOUD_BOX.min.map((v, i) => (v + CLOUD_BOX.max[i]) / 2);
    const dx = c[0] - g.position[0], dz = c[2] - g.position[2], d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d;
    const add = (geo: SphereGeometry | CylinderGeometry, color: number, x: number, y: number, z: number) => {
      const m = new Mesh(geo, new MeshStandardMaterial({ color, roughness: 0.6 }));
      m.position.set(x, y, z); scene.add(m);
    };
    add(new CylinderGeometry(22, 30, 1300, 24), 0x8a8f98, c[0], 650, c[2]); // tower: ground to 1300 m, through the cloud (500..908 m)
    add(new SphereGeometry(45, 48, 24), 0xff7a1a, g.position[0] + ux * d * 0.45, 330, g.position[2] + uz * d * 0.45); // in front of the cloud
    add(new SphereGeometry(160, 48, 24), 0xd01a6a, c[0] + ux * 650 - uz * 300, g.position[1] + ((c[1] - g.position[1]) * (d + 650)) / d, c[2] + uz * 650 + ux * 300); // behind the cloud
  }

  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);
  resize();

  let bookmark = 'ground', time = bookmarkTime('ground');
  const applyBookmark = (name: string) => {
    const ov = objectView(name);
    if (ov) { bookmark = name; time = bookmarkTime('ground'); sky.setTimeOfDay(time); rig.set(ov.position, ov.target); return; }
    if (!isBookmarkName(name)) throw new Error(`unknown bookmark: ${name}`);
    bookmark = name; time = bookmarkTime(name); sky.setTimeOfDay(time);
    const b = resolveBookmark(name, sunVector(sky.sunAzimuth, sky.sunElevation));
    rig.set(b.position, b.target);
  };
  const hud = document.createElement('pre');
  hud.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;color:#fff;font:12px monospace;text-shadow:0 0 3px #000;pointer-events:none';
  document.body.appendChild(hud);
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;right:8px;top:8px;display:flex;gap:4px';
  for (const name of objectsOn ? [...BOOKMARK_NAMES, ...OBJECT_BOOKMARKS] : BOOKMARK_NAMES) { const b = document.createElement('button'); b.textContent = name; b.onclick = () => applyBookmark(name); bar.appendChild(b); }
  document.body.appendChild(bar);

  const frameTimes: number[] = [], sceneGpu: number[] = [];
  let last = performance.now(), frame = 0, busy = false;
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pct = (p: number) => { const s = [...frameTimes].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  const gpuMs = () => ({ scene: mean(sceneGpu), ...clouds.timings });
  renderer.setAnimationLoop(now => {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    if (frame > 30) { frameTimes.push(dt * 1000); if (frameTimes.length > 240) frameTimes.shift(); }
    rig.update(dt);
    camera.near = Math.min(200, Math.max(0.5, camera.position.y * 0.002)); // altitude-proportional near plane, as the flagship
    camera.updateProjectionMatrix();
    sky.update(camera); // INTEGRATION (the sky needs this anyway)
    void sky.updateAerialPerspective(); // INTEGRATION (the sky needs this anyway)
    post.render();
    if (!busy) {
      busy = true;
      renderer.resolveTimestampsAsync('render').then(ms => { if (typeof ms === 'number' && ms > 0) { sceneGpu.push(ms); if (sceneGpu.length > 60) sceneGpu.shift(); } }).catch(() => {}).finally(() => { busy = false; });
    }
    if (frame++ % 10 === 0) hud.textContent = `frame ${pct(0.5).toFixed(2)} ms  clouds ${clouds.isReady ? 'on' : 'loading'}\n${Object.entries(gpuMs()).map(([k, v]) => `${k.padEnd(10)} ${v.toFixed(2)}`).join('\n')}`;
    harness.frame();
  });
  applyBookmark('ground');
  harness.ready({
    bookmark: name => applyBookmark(name),
    report: () => ({ gpuMs: gpuMs(), frameMs: { p50: pct(0.5), p95: pct(0.95) }, renderSize: [renderer.domElement.width, renderer.domElement.height], bookmark, timeOfDay: time, haze: query.get('haze') === '1', frames: frame, cloudsReady: clouds.isReady }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
