// Minimal @clouds/three scene, written like the P2 spec's target usage. Lines tagged `// INTEGRATION` are the whole cost of adding clouds.
import { ACESFilmicToneMapping, PerspectiveCamera, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds } from '@clouds/three'; // INTEGRATION
import { installCloudsHarness } from '../harness/clouds-contract';
import { BOOKMARK_NAMES, bookmarkTime, isBookmarkName, placeCloud, resolveBookmark, sunVector } from '../flagship/bookmarks';
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

  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);
  resize();

  let bookmark = 'ground', time = bookmarkTime('ground');
  const applyBookmark = (name: string) => {
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
  for (const name of BOOKMARK_NAMES) { const b = document.createElement('button'); b.textContent = name; b.onclick = () => applyBookmark(name); bar.appendChild(b); }
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
