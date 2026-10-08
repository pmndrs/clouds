// Phase 6 demo: realtime cloud evolution. A 4 km cumulus field forms, drifts, merges and dissipates; the NVDF + SDF are regenerated every few
// seconds in amortized GPU jobs into a back volume (double-buffered) and swapped in, with the box translated smoothly by the wind.
//
//   ?timeScale=<n>   simulated seconds per real second (default 10; life cycles are ~10 min of simulated time, so 60 s of demo = one cycle)
//   ?t=<s>           demo seconds (sim time = t * timeScale). Frozen there: the field is generated once, completely (deterministic captures).
//   ?step=1          deterministic playback: from ?t (default 0) the clock advances 1/60 s of demo time per rendered frame, whatever the wall time
//   ?play=1          with ?t: play in real time from t instead of freezing.  Without ?t the page plays in real time from 0.
//   ?bookmark=ground|above|horizon|top   ?preset= ?seed= ?life=<sim s> ?wind=<x>,<z> (m/s sim) ?cadence=<real s between generations> ?border=
//   ?evolve=0        regenerate nothing after the first field (A/B for the added cost)   ?inplace=0 use setVolume for swaps (the old path)
//   ?diff=1          record the mean |delta| between consecutive frames (320x180 downscale) and the swap frames;  ?dumpFrames=1 also returns JPEGs of frames around swaps
//   ?quality= ?exposure= ?sunEl= ?sunAz= ?k=<near>,<far>
// Lines tagged `// INTEGRATION` are what clouds cost this scene; the evolving cloudscape is content, tagged `// CONTENT`.
import { ACESFilmicToneMapping, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend, type CloudQuality } from '@clouds/three'; // INTEGRATION
import { CLOUD_PRESETS, createEvolvingCloudscape, loadCloudNoise, type CloudPresetName, type EvolveUpdate } from '@clouds/runtime'; // CONTENT
import { installCloudsHarness } from '../harness/clouds-contract';
import { CameraRig } from '../flagship/controls';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const num = (k: string, d: number) => (query.has(k) ? Number(query.get(k)) : d);

const BOOKMARKS = {
  // The box is centred on the origin (x, z in [-2048, 2048]); clouds sit 300 m (base) .. ~800 m (tops) above the ground.
  ground: { pos: [0, 2, 1500], sunEl: 50, sunAz: 150, lookAz: 0, pitch: 30 },
  above: { pos: [0, 1500, 2600], sunEl: 42, sunAz: 150, lookAz: 0, pitch: -30 },
  horizon: { pos: [0, 40, 2300], sunEl: 38, sunAz: 150, lookAz: 0, pitch: 6 },
  top: { pos: [0, 2600, 0], sunEl: 42, sunAz: 150, lookAz: 0, pitch: -89 },
} as const;
type BookmarkName = keyof typeof BOOKMARKS;
const NAMES = Object.keys(BOOKMARKS) as BookmarkName[];
const isName = (n: string): n is BookmarkName => n in BOOKMARKS;

const DIMS: [number, number, number] = [512, 512, 64], VOXEL = 8, BASE_Y = num('base', 300);
const BOX_CENTRE: [number, number] = [num('ox', 0), num('oz', 0)];   // the runtime's volume position is the base centre of the box
const presetName = (CLOUD_PRESETS[query.get('preset') as CloudPresetName] ? query.get('preset') : 'cumulus') as CloudPresetName;
const TIME_SCALE = num('timeScale', 10);
const STEP = 1 / 60;

try {
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = num('exposure', 0.35);
  document.body.style.cssText = 'margin:0;overflow:hidden';
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
  scene.add(new Mesh(new PlaneGeometry(400000, 400000).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x2f3a28, roughness: 1 })));

  const clouds = new Clouds(renderer, { sky, quality: (query.get('quality') as CloudQuality) ?? 'high' }); // INTEGRATION
  if (query.has('k')) { const [kn, kf] = query.get('k')!.split(',').map(Number); clouds.settings.temporalNear = kn; clouds.settings.temporalFar = kf ?? kn; }
  const post = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera); // INTEGRATION
  post.outputNode = clouds.node(scenePass.getTextureNode(), scenePass); // INTEGRATION
  await clouds.setNoise(await loadCloudNoise('/clouds/noise/')); // INTEGRATION
  { const s = clouds.settings; s.windVelocity[0] = s.windVelocity[1] = s.windVelocity[2] = 0; }   // the detail noise is anchored to the clouds (generator), not scrolled

  // ---- GPU timestamps around the generation jobs (the cost of evolution, measured on the device) ----
  const device = sharedBackend(renderer).device; // CONTENT
  const canTime = device.features.has('timestamp-query');
  const QN = 1024;
  const qs = canTime ? device.createQuerySet({ type: 'timestamp', count: QN }) : null;
  const qResolve = canTime ? device.createBuffer({ size: QN * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null;
  const qRead: GPUBuffer[] = canTime ? [0, 1, 2, 3].map(() => device.createBuffer({ size: QN * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })) : [];
  const qBusy = [false, false, false, false];
  let qUsed = 0, qRing = 0;
  const genGpu: { frame: number; ms: number }[] = [];
  let frame = 0;
  const timestamps = canTime ? (_label: string): GPUComputePassTimestampWrites | undefined => {
    if (qUsed + 2 > QN) return undefined;
    const w = { querySet: qs!, beginningOfPassWriteIndex: qUsed, endOfPassWriteIndex: qUsed + 1 };
    qUsed += 2;
    return w;
  } : undefined;
  const resolveGenTimes = () => {          // after the frame's jobs were submitted: resolve and read back what they used
    if (!canTime || qUsed === 0) return;
    const slot = qRing++ % qRead.length;
    if (qBusy[slot]) { qUsed = 0; return; }
    const n = qUsed, f = frame; qUsed = 0; qBusy[slot] = true;
    const enc = device.createCommandEncoder({ label: 'generation timestamps' });
    enc.resolveQuerySet(qs!, 0, n, qResolve!, 0);
    enc.copyBufferToBuffer(qResolve!, 0, qRead[slot], 0, n * 8);
    device.queue.submit([enc.finish()]);
    void qRead[slot].mapAsync(GPUMapMode.READ, 0, n * 8).then(() => {
      const t = new BigUint64Array(qRead[slot].getMappedRange(0, n * 8).slice(0));
      let ns = 0n; for (let i = 0; i + 1 < n; i += 2) if (t[i + 1] > t[i]) ns += t[i + 1] - t[i];
      genGpu.push({ frame: f, ms: Number(ns) / 1e6 });
      qRead[slot].unmap();
    }).catch(() => {}).finally(() => { qBusy[slot] = false; });
  };

  // ---- the evolving field (CONTENT) ----
  const wind = (query.get('wind') ?? '2,1').split(',').map(Number) as [number, number];
  const evolution = createEvolvingCloudscape(device, { // CONTENT
    preset: presetName, dims: DIMS, voxelSize: VOXEL, seed: num('seed', 7), lifeSeconds: num('life', 600), wind,
    cadence: num('cadence', 1.5), generationShare: num('share', 0.8), border: num('border', 0.06), sliceDepth: 4, timestamps,
  });
  const inPlace = query.get('inplace') !== '0';
  const evolveOn = query.get('evolve') !== '0';
  let setVolumeCalls = 0, swapVolumeCalls = 0;
  const HALF = [DIMS[0] * VOXEL / 2, DIMS[1] * VOXEL / 2];
  /** The adapter's setVolume takes the box's base centre; the runtime's own swapVolume/setVolumePosition take its min corner. */
  const centreOf = (off: readonly [number, number]): [number, number, number] => [BOX_CENTRE[0] + off[0], BASE_Y, BOX_CENTRE[1] + off[1]];
  const cornerOf = (off: readonly [number, number]): [number, number, number] => [BOX_CENTRE[0] + off[0] - HALF[0], BASE_Y, BOX_CENTRE[1] + off[1] - HALF[1]];
  const show = (u: EvolveUpdate) => { // INTEGRATION: a same-size swap that keeps the temporal history and the light grid (runtime P6-A hook), else a full setVolume
    const t0 = performance.now();
    if (inPlace && clouds.core.swapVolume(u.volume, { position: cornerOf(u.offset) })) swapVolumeCalls++;
    else { void clouds.setVolume(u.volume, { position: centreOf(u.offset) }); setVolumeCalls++; }
    return performance.now() - t0;
  };

  // ---- clock ----
  const hasT = query.has('t');
  const stepMode = query.get('step') === '1';
  const live = !hasT || query.get('play') === '1' || stepMode;
  let demoT = num('t', 0);                  // demo seconds
  const simT = () => demoT * TIME_SCALE;
  let update = await evolution.start(simT());
  show(update);

  // ---- camera, HUD, bookmarks ----
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);
  resize();
  let bookmark: BookmarkName = isName(query.get('bookmark') ?? '') ? (query.get('bookmark') as BookmarkName) : 'above';
  const applyBookmark = (name: string) => {
    if (!isName(name)) throw new Error(`unknown bookmark: ${name}`);
    bookmark = name;
    const b = BOOKMARKS[name];
    sky.setSunDirection({ elevation: num('sunEl', b.sunEl), azimuth: num('sunAz', b.sunAz) });
    const az = (b.lookAz * Math.PI) / 180, pitch = (b.pitch * Math.PI) / 180;
    const d = [Math.sin(az) * Math.cos(pitch), Math.sin(pitch), -Math.cos(az) * Math.cos(pitch)];
    rig.set([...b.pos], [b.pos[0] + d[0] * 100, b.pos[1] + d[1] * 100, b.pos[2] + d[2] * 100]);
  };
  const hud = document.createElement('pre');
  hud.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:4px 6px;background:#0008;color:#fff;font:12px monospace;pointer-events:none';
  document.body.appendChild(hud);
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;right:8px;top:8px;display:flex;gap:4px';
  document.body.appendChild(bar);
  for (const name of NAMES) { const b = document.createElement('button'); b.textContent = name; b.onclick = () => applyBookmark(name); bar.appendChild(b); }

  // ---- measurement ----
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const quant = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  const frameTimes: number[] = [], playFrames: number[] = [], sceneGpu: number[] = [];
  const swaps: { frame: number; demoT: number; simT: number; contentT: number; ms: number }[] = [];
  const passHistory: { frame: number; lightGrid: number; reduce: number; clouds: number; swap: boolean }[] = [];
  const gpuMs = () => { const c = clouds.timings; const sum = Object.values(c).reduce((x, y) => x + y, 0); const grid = (c.lightGrid ?? 0) + (c.lightGridReduce ?? 0);
    return { scene: mean(sceneGpu), ...c, cloudsTotal: sum, cloudsMarch: sum - grid, total: mean(sceneGpu) + sum }; };
  // frame-to-frame difference: 320x180 downscale of the canvas, mean |delta| over RGB in 0..255
  const diffOn = query.get('diff') === '1', dump = query.get('dumpFrames') === '1';
  const small = document.createElement('canvas'); small.width = 320; small.height = 180;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  const big = document.createElement('canvas'); big.width = 640; big.height = 360;
  const bctx = big.getContext('2d')!;
  let prevPix: Uint8ClampedArray | null = null;
  const diffs: { frame: number; d: number; swap: boolean }[] = [];
  const ring: { frame: number; url: string }[] = [];
  const keep: { frame: number; url: string; tag: string }[] = [];
  let swapFrameMarks: number[] = [];

  let last = performance.now(), busy = false;
  renderer.setAnimationLoop(now => {
    const rawDt = Math.min(0.25, (now - last) / 1000); last = now;
    const dt = stepMode ? STEP : rawDt;
    if (frame > 30) frameTimes.push(rawDt * 1000);
    if (frameTimes.length > 600) frameTimes.shift();
    let swapped = false;
    if (live) {
      demoT += dt;
      if (frame > 30) playFrames.push(rawDt * 1000);
    }
    if (live && evolveOn) {
      update = evolution.update(simT(), dt);
      resolveGenTimes();
      if (update.swapped) {
        const ms = show(update);
        swapped = true; swapFrameMarks.push(frame);
        swaps.push({ frame, demoT, simT: simT(), contentT: update.contentTime, ms });
      }
    }
    if (live) {                                  // the wind drift between swaps: a uniform write only (the box moves by the remainder of the snapped advection)
      clouds.core.setVolumePosition(cornerOf([wind[0] * simT() - update.advection[0], wind[1] * simT() - update.advection[1]])); // INTEGRATION
    }
    rig.update(dt);
    camera.near = Math.min(50, Math.max(0.2, camera.position.y * 0.05));
    camera.updateProjectionMatrix();
    sky.update(camera); // INTEGRATION (the sky needs this anyway)
    void sky.updateAerialPerspective(); // INTEGRATION (the sky needs this anyway)
    post.render();
    const l = clouds.lastTimings;
    passHistory.push({ frame, lightGrid: l.lightGrid ?? 0, reduce: l.lightGridReduce ?? 0, clouds: Object.values(l).reduce((x, y) => x + y, 0), swap: swapped });
    if (passHistory.length > 20000) passHistory.shift();
    if (diffOn && frame > 30) {
      sctx.drawImage(renderer.domElement, 0, 0, 320, 180);
      const px = sctx.getImageData(0, 0, 320, 180).data;
      if (prevPix) { let s = 0; for (let i = 0; i < px.length; i += 4) s += Math.abs(px[i] - prevPix[i]) + Math.abs(px[i + 1] - prevPix[i + 1]) + Math.abs(px[i + 2] - prevPix[i + 2]); diffs.push({ frame, d: s / (px.length / 4 * 3), swap: swapped }); }
      prevPix = px;
      if (dump) {
        bctx.drawImage(renderer.domElement, 0, 0, 640, 360);
        ring.push({ frame, url: big.toDataURL('image/jpeg', 0.85) }); if (ring.length > 4) ring.shift();
        if (swapped) for (const r of ring) keep.push({ ...r, tag: `pre${frame - r.frame}` });
        else if (swapFrameMarks.length && frame - swapFrameMarks[swapFrameMarks.length - 1] <= 3) keep.push({ frame, url: ring[ring.length - 1].url, tag: `post${frame - swapFrameMarks[swapFrameMarks.length - 1]}` });
      }
    }
    if (!busy) {
      busy = true;
      renderer.resolveTimestampsAsync('render').then(ms => { if (typeof ms === 'number' && ms > 0) { sceneGpu.push(ms); if (sceneGpu.length > 60) sceneGpu.shift(); } }).catch(() => {}).finally(() => { busy = false; });
    }
    if (frame++ % 10 === 0) {
      const g = gpuMs();
      hud.textContent = `evolution  t ${demoT.toFixed(1)} s  x${TIME_SCALE}  sim ${(simT() / 60).toFixed(1)} min  ${live ? (stepMode ? 'stepping' : 'playing') : 'frozen'}  swaps ${evolution.stats.swaps}${evolution.generating ? '  generating' : ''}\n` +
        `frame p50 ${quant(frameTimes, 0.5).toFixed(2)} p95 ${quant(frameTimes, 0.95).toFixed(2)} ms  ${renderer.domElement.width}x${renderer.domElement.height}  ${presetName}  life ${num('life', 600)} s  wind ${wind.join(',')} m/s\n` +
        `generation GPU ${mean(genGpu.slice(-120).map(x => x.ms)).toFixed(3)} ms/frame avg  content t ${update.contentTime.toFixed(0)} s  box offset ${update.offset.map(v => v.toFixed(1)).join(', ')} m\n` +
        Object.entries(g).map(([k, v]) => `${k.padEnd(14)} ${v.toFixed(2)}`).join('\n');
    }
    harness.frame();
  });
  applyBookmark(bookmark);

  harness.ready({
    bookmark: name => applyBookmark(name),
    report: () => {
      const gp = genGpu.map(x => x.ms), nz = gp.filter(x => x > 0);
      const nonSwap = diffs.filter(d => !d.swap).map(d => d.d), swapD = diffs.filter(d => d.swap).map(d => d.d);
      const near = diffs.filter(d => swapFrameMarks.some(m => d.frame >= m - 2 && d.frame <= m + 4));
      const gridSwap = passHistory.filter(h => swaps.some(s => h.frame >= s.frame && h.frame <= s.frame + 4)).map(h => h.lightGrid + h.reduce);
      const gridOther = passHistory.filter(h => !swaps.some(s => h.frame >= s.frame - 4 && h.frame <= s.frame + 12) && h.frame > 60).map(h => h.lightGrid + h.reduce);
      return {
        gpuMs: gpuMs(), frameMs: { p50: quant(frameTimes, 0.5), p95: quant(frameTimes, 0.95) }, renderSize: [renderer.domElement.width, renderer.domElement.height],
        bookmark, demoT, simT: simT(), timeScale: TIME_SCALE, frames: frame, cloudsReady: clouds.isReady, mode: stepMode ? 'step' : live ? 'play' : 'frozen',
        playback: playFrames.length ? { frames: playFrames.length, p50: quant(playFrames, 0.5), p95: quant(playFrames, 0.95), p99: quant(playFrames, 0.99), max: Math.max(...playFrames), ratioP95P50: quant(playFrames, 0.95) / quant(playFrames, 0.5), over25ms: playFrames.filter(x => x > 25).length } : null,
        evolution: { swaps: evolution.stats.swaps, swapVolumeCalls, setVolumeCalls, memoryMB: evolution.memoryBytes / 1048576, worstEncodeSubmitMs: evolution.stats.worstEncodeMs, generations: evolution.stats.generations.slice(-6),
          genGpuMsPerFrame: { frames: gp.length, mean: mean(gp), meanOverActiveFrames: mean(nz), max: Math.max(0, ...gp), p95: quant(gp, 0.95), activeFrames: nz.length }, swapEvents: swaps.slice(-12) },
        lightGridMs: { swapFrames: { mean: mean(gridSwap), max: Math.max(0, ...gridSwap) }, otherFrames: { mean: mean(gridOther), max: Math.max(0, ...gridOther) } },
        diff: diffOn ? { frames: diffs.length, medianNonSwap: quant(nonSwap, 0.5), meanNonSwap: mean(nonSwap), p95NonSwap: quant(nonSwap, 0.95), maxNonSwap: Math.max(0, ...nonSwap), swapFrames: swapD, aroundSwaps: near, perSwapMeanDelta: swapD.length ? mean(swapD) : null } : null,
        dumped: dump ? keep.map(k => ({ frame: k.frame, tag: k.tag, url: k.url })) : undefined,
      };
    },
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
