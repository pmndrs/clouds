// Phase 3 demo: a 40 s scripted flight over plains through a streaming, GPU-generated cumulus field, built with @clouds/three.
//
//   ?t=<s>       jump to time t (simulated deterministically: the stream is stepped in 1/60 s frames from 0, time is frozen after)
//   ?play=1      real-time playback from page ready (the flight runs once, then holds its last pose)
//   ?bookmark=t0..t40 | swapA | swapB   (the capture harness applies bookmarks; swapA/swapB bracket a forced window swap at a fixed pose)
//   ?preset= ?seed= ?quality= ?jobs= (generation jobs per frame) ?border= (coverage fade at the window edge, fraction) ?heading= (compass degrees)
//   ?x0= ?z0= (start position)  ?exposure=  ?probe=1 (print where clouds are along the flight line, for placing the path)
// Lines tagged `// INTEGRATION` are what clouds cost this scene; the streaming cloudscape is content, tagged `// CONTENT`.
import { ACESFilmicToneMapping, CanvasTexture, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, RepeatWrapping, Scene, SRGBColorSpace } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend, type CloudQuality } from '@clouds/three'; // INTEGRATION
import { CLOUD_PRESETS, createStreamingCloudscape, loadCloudNoise, type CloudPresetName, type StreamingUpdate } from '@clouds/runtime'; // CONTENT
import { installCloudsHarness } from '../harness/clouds-contract';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const num = (k: string, d: number) => (query.has(k) ? Number(query.get(k)) : d);

// ---------------------------------------------------------------- the flight
const DURATION = 40;
const BASE_Y = num('base', 600);           // metres: the volume's floor (cloud bases sit a little above it)
const HEADING = num('heading', 0);         // compass degrees, north = -Z
const START: [number, number] = [num('x0', 0), num('z0', 0)];
const LATERAL = num('lat', 50);            // metres to the right of the line, phased in between t = 24 and 32 (steers the descent into a gap)
const SUN = { elevation: num('sunEl', 38), azimuth: num('sunAz', 110) };

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Piecewise smooth interpolation through (t, value) keys. */
const keyed = (keys: [number, number][]) => (t: number) => {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * smooth(keys[i - 1][0], keys[i][0], t);
  return keys[keys.length - 1][1];
};
// Altitude: on the ground, climb through the layer (bases ~640 m, tops ~900-1000 m), cruise above the tops, descend through a gap.
const altitude = keyed([[0, 2], [6, 6], [10, 160], [14, 560], [19, 1060], [24, 1200], [30, 1200], [35, 820], [40, 360]]);
const lookUp = (t: number) => 38 * (1 - smooth(0, 10, t));       // degrees of extra upward gaze early on
// Ground speed: standing start, 120 m/s from t = 10. Integrated once on a 1/60 s table.
const STEP = 1 / 60;
const distanceTable = (() => {
  const a = new Float64Array(Math.ceil(DURATION / STEP) + 2);
  for (let i = 1; i < a.length; i++) a[i] = a[i - 1] + 120 * smooth(0, 10, (i - 0.5) * STEP) * STEP;
  return a;
})();
const distanceAt = (t: number) => { const f = Math.min(Math.max(t, 0), DURATION) / STEP, i = Math.floor(f); return distanceTable[i] + (distanceTable[i + 1] - distanceTable[i]) * (f - i); };
interface Pose { x: number; y: number; z: number; yaw: number; pitch: number }
const heading = (HEADING * Math.PI) / 180, fwd = [Math.sin(heading), -Math.cos(heading)];
function poseAt(t: number): Pose {
  const s = distanceAt(t), y = altitude(t);
  const dy = (altitude(t + 0.05) - altitude(t - 0.05)) / 0.1, v = Math.max(1, (distanceAt(t + 0.05) - distanceAt(t - 0.05)) / 0.1);
  const fpa = (Math.atan2(dy, v) * 180) / Math.PI;                  // flight-path angle
  const cruiseDip = -16 * smooth(18, 24, t) * (1 - smooth(28, 33, t));
  const lat = LATERAL * smooth(24, 32, t);
  return { x: START[0] + fwd[0] * s - fwd[1] * lat, z: START[1] + fwd[1] * s + fwd[0] * lat, y, yaw: heading + 0.04 * Math.sin(t * 0.5), pitch: (fpa * 0.85 + lookUp(t) + cruiseDip) * Math.PI / 180 };
}

const BOOKMARK_TIMES: Record<string, number> = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`t${i * 5}`, i * 5]));
BOOKMARK_TIMES.swapA = 20; BOOKMARK_TIMES.swapB = 20;
const NAMES = Object.keys(BOOKMARK_TIMES);

const WINDOW = { dims: [512, 512, 64] as [number, number, number], voxel: 8 };
const JOBS_PER_FRAME = num('jobs', 2);
const presetName = (CLOUD_PRESETS[query.get('preset') as CloudPresetName] ? query.get('preset') : 'cumulus') as CloudPresetName;

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
  camera.rotation.order = 'YXZ';
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 14, latitude: 40, north: '-Z', mirrorBelowHorizon: true });
  sky.attach(scene);
  const sun = sky.createSun({ physical: true });
  sun.attach(scene);
  sky.setSunDirection(SUN);
  await sky.compileAsync();

  // Ground: a patchwork of fields (a canvas texture, tiled) so motion over it reads.
  const TILE = 1600; // metres per texture repeat
  const ground = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d')!;
    let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const cell = 64;
    for (let y = 0; y < 512; y += cell) for (let x = 0; x < 512; x += cell) {
      const l = 0.17 + rnd() * 0.12, h = 62 + rnd() * 46;
      g.fillStyle = `hsl(${h} ${28 + rnd() * 22}% ${l * 100}%)`; g.fillRect(x, y, cell, cell);
      for (let k = 0; k < 40; k++) { g.fillStyle = `hsla(${h + rnd() * 20} 30% ${l * 100 + (rnd() - 0.5) * 14}% / 0.5)`; g.fillRect(x + rnd() * cell, y + rnd() * cell, 2 + rnd() * 6, 2 + rnd() * 6); }
    }
    const tex = new CanvasTexture(c); tex.wrapS = tex.wrapT = RepeatWrapping; tex.colorSpace = SRGBColorSpace; tex.anisotropy = 8;
    const size = 160000; tex.repeat.set(size / TILE, size / TILE);
    const m = new Mesh(new PlaneGeometry(size, size).rotateX(-Math.PI / 2), new MeshStandardMaterial({ map: tex, roughness: 1 }));
    scene.add(m);
    return m;
  })();

  const clouds = new Clouds(renderer, { sky, quality: (query.get('quality') as CloudQuality) ?? 'high' }); // INTEGRATION
  const post = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera); // INTEGRATION
  post.outputNode = clouds.node(scenePass.getTextureNode(), scenePass); // INTEGRATION
  await clouds.setNoise(await loadCloudNoise('/clouds/noise/')); // INTEGRATION

  // ---- streaming cloudscape (CONTENT): generated around the camera, regenerated ahead of it as it moves ----
  const device = sharedBackend(renderer).device; // CONTENT
  const seed = num('seed', 7);
  const stream = createStreamingCloudscape(device, { preset: presetName, dims: WINDOW.dims, voxelSize: WINDOW.voxel, seed, jobsPerFrame: JOBS_PER_FRAME, border: num('border', 0), sliceDepth: 4 }); // CONTENT
  const swaps: { simT: number; frame: number; setVolumeMs: number; centre: [number, number]; before: number; after: number[] }[] = [];
  let frame = 0, shownCentre: [number, number] = [0, 0];
  const show = (u: StreamingUpdate, simT: number) => { // INTEGRATION (the whole swap: one setVolume call; the volume stays owned by the streamer)
    const t0 = performance.now();
    void clouds.setVolume(u.volume, { position: [u.centre[0], BASE_Y, u.centre[1]] });
    shownCentre = u.centre;
    return performance.now() - t0;
  };
  const frameTimes: number[] = [];
  const recentMedian = () => { const r = frameTimes.slice(-30).sort((a, b) => a - b); return r.length ? r[r.length >> 1] : 0; };

  // ---- simulation state ----
  const play = query.get('play') === '1';
  let simT = 0;
  let yawOverride: number | null = null;   // swapA/swapB look across the flight line (east), where both windows cover the whole view
  const pose = () => { const p = poseAt(simT); if (yawOverride !== null) p.yaw = yawOverride; return p; };
  const applyCamera = () => {
    const p = pose();
    camera.position.set(p.x, p.y, p.z);
    camera.rotation.set(p.pitch, -p.yaw, 0);
    camera.near = Math.min(50, Math.max(0.2, p.y * 0.05));
    camera.updateProjectionMatrix();
    ground.position.set(Math.round(p.x / TILE) * TILE, 0, Math.round(p.z / TILE) * TILE);
    // Deterministic noise drift: wind is a function of simulated time, not of wall time.
    const s = clouds.settings; s.windVelocity[0] = s.windVelocity[1] = s.windVelocity[2] = 0;
    s.windOffset[0] = 3 * simT; s.windOffset[1] = 0; s.windOffset[2] = 1.5 * simT;
  };
  /** One simulation step: advance time, feed the streamer, swap the volume when a window finished. */
  const step = (dt: number, advance = true) => {
    if (advance) simT = Math.min(DURATION, simT + dt);
    const p = pose();
    const u = stream.update(p.x, p.z, dt);
    if (u.swapped) {
      const ms = show(u, simT);
      swaps.push({ simT, frame, setVolumeMs: ms, centre: u.centre, before: recentMedian(), after: [] });
    }
    return u;
  };
  const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
  const idle = async () => { for (let i = 0; i < 2000 && stream.generating; i++) await nextFrame(); };
  /** Jump to time t. Forward: step the stream in 1/60 s increments (swaps happen where the flight makes them due). Backward: restart there. */
  const seek = async (t: number) => {
    if (t < simT) { simT = t; const p = pose(); show(await stream.start(p.x, p.z), simT); }
    while (simT < t - 1e-9) step(Math.min(STEP, t - simT));
    applyCamera();
    await idle();
    applyCamera();
  };

  // ---- first window ----
  {
    const p = poseAt(0);
    const first = await stream.start(p.x, p.z);
    show(first, 0);
  }

  let probeLines: string[] | undefined;
  // ---- probe: where are the clouds along the flight line? (a tool for placing the path; not used by the demo) ----
  if (query.get('probe') === '1') {
    const out: string[] = [];
    const readColumns = async () => {
      const vol = stream.current.volume, [W, H, D] = vol.dims;
      const bpr = W * 4, buf = device.createBuffer({ size: bpr * H * D, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: vol.nvdf }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: H }, { width: W, height: H, depthOrArrayLayers: D });
      device.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const data = new Uint8Array(buf.getMappedRange().slice(0)); buf.unmap(); buf.destroy();
      const c = stream.current.centre, ox = c[0] - W * WINDOW.voxel / 2, oz = c[1] - H * WINDOW.voxel / 2;
      return { c, column: (wx: number, wz: number): [number, number] => {          // lowest/highest occupied height above the volume floor, or [-1, -1]
        const x = Math.floor((wx - ox) / WINDOW.voxel), y = Math.floor((wz - oz) / WINDOW.voxel);
        if (x < 0 || y < 0 || x >= W || y >= H) return [-2, -2];
        let lo = -1, hi = -1;
        for (let z = 0; z < D; z++) if (data[((z * H + y) * W + x) * 4] > 0) { if (lo < 0) lo = z * WINDOW.voxel; hi = z * WINDOW.voxel; }
        return [lo, hi];
      } };
    };
    for (const at of [0, 12, 22, 33]) {
      await seek(at);
      const { c, column } = await readColumns();
      out.push(`--- window at t=${at}, centre ${c.map(v => v.toFixed(0)).join(',')}`);
      for (let t = Math.max(0, at - 6); t <= Math.min(DURATION, at + 8); t += 1) {
        const p = poseAt(t), [lo, hi] = column(p.x, p.z);
        out.push(`t=${t} (${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}) column cloud (above floor ${BASE_Y}): ${lo === -2 ? 'outside window' : lo < 0 ? '-' : `${lo}..${hi} m (abs ${BASE_Y + lo}..${BASE_Y + hi})`}`);
      }
      if (at === 33) for (let lat = -800; lat <= 800; lat += 100) {
        let n = 0, line = '';
        for (let t = 30; t <= 40; t += 0.5) {
          const p = poseAt(t), fr = [Math.cos(heading), Math.sin(heading)], x = p.x + fr[0] * lat, z = p.z + fr[1] * lat;
          const [lo, hi] = column(x, z);
          const inCloud = lo >= 0 && p.y >= BASE_Y + lo - 40 && p.y <= BASE_Y + hi + 40;
          if (inCloud) n++; line += inCloud ? '#' : lo >= 0 ? '+' : '.';
        }
        out.push(`lateral ${lat}: in-cloud samples ${n}  [${line}]`);
      }
    }
    probeLines = out;
  }

  // ---- HUD, bookmarks UI ----
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);
  resize();
  const hud = document.createElement('pre');
  hud.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:4px 6px;background:#0008;color:#fff;font:12px monospace;pointer-events:none';
  document.body.appendChild(hud);
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;right:8px;top:8px;display:flex;gap:4px;flex-wrap:wrap;max-width:60vw;justify-content:flex-end';
  document.body.appendChild(bar);

  let bookmark = 'start';
  const applyBookmark = async (name: string) => {
    if (!(name in BOOKMARK_TIMES)) throw new Error(`unknown bookmark: ${name}`);
    bookmark = name;
    yawOverride = name.startsWith('swap') ? Math.PI / 2 : null;
    if (name === 'swapB') {
      // Same pose as swapA; a new window centred 700 m ahead of the camera replaces the shown one, so the picture should not change.
      await seek(BOOKMARK_TIMES[name]);
      const p = pose();
      stream.requestWindow(p.x + fwd[0] * 700, p.z + fwd[1] * 700);   // along the flight line, so the view across it stays inside both windows
      await idle();
      await nextFrame();
      return;
    }
    await seek(BOOKMARK_TIMES[name]);
    if (name === 'swapA') await idle();
  };
  for (const name of NAMES) { const b = document.createElement('button'); b.textContent = name; b.onclick = () => { void applyBookmark(name); }; bar.appendChild(b); }

  // ---- measurement ----
  const sceneGpu: number[] = [];
  const playFrames: number[] = [];
  const slowFrames: { simT: number; frame: number; ms: number; cloudsGpuMs: number }[] = [];
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const quant = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  const gpuMs = () => { const c = clouds.timings; const sum = Object.values(c).reduce((x, y) => x + y, 0); return { scene: mean(sceneGpu), ...c, cloudsTotal: sum, total: mean(sceneGpu) + sum }; };
  let busy = false, last = performance.now(), playStart = -1;
  const passHistory: { frame: number; lightGrid: number; clouds: number }[] = [];   // latest GPU ms per frame (lags 2-3 frames)
  const swapGpu = () => swaps.map(sw => {
    const win = passHistory.filter(h => h.frame >= sw.frame && h.frame <= sw.frame + 10), pre = passHistory.filter(h => h.frame < sw.frame && h.frame >= sw.frame - 30).map(h => h.lightGrid).sort((a, b) => a - b);
    return { simT: sw.simT, lightGridPeakMs: Math.max(0, ...win.map(h => h.lightGrid)), cloudsPeakMs: Math.max(0, ...win.map(h => h.clouds)), lightGridBeforeMedianMs: pre.length ? pre[pre.length >> 1] : 0 };
  });

  renderer.setAnimationLoop(now => {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    if (frame > 30) {
      frameTimes.push(dt * 1000); if (frameTimes.length > 600) frameTimes.shift();
      for (const s of swaps) if (s.after.length < 4 && s.frame < frame) s.after.push(dt * 1000);
    }
    if (play && playStart >= 0 && simT < DURATION) { step(dt); playFrames.push(dt * 1000); if (dt > 0.02) slowFrames.push({ simT: +simT.toFixed(2), frame, ms: +(dt * 1000).toFixed(1), cloudsGpuMs: +(passHistory[passHistory.length - 1]?.clouds ?? 0).toFixed(2) }); }
    else step(0, false);                                    // time frozen: generation in flight still finishes
    applyCamera();
    { const l = clouds.lastTimings; passHistory.push({ frame, lightGrid: l.lightGrid ?? 0, clouds: Object.values(l).reduce((x, y) => x + y, 0) }); if (passHistory.length > 6000) passHistory.shift(); }
    sky.update(camera); // INTEGRATION (the sky needs this anyway)
    void sky.updateAerialPerspective(); // INTEGRATION (the sky needs this anyway)
    post.render();
    if (!busy) {
      busy = true;
      renderer.resolveTimestampsAsync('render').then(ms => { if (typeof ms === 'number' && ms > 0) { sceneGpu.push(ms); if (sceneGpu.length > 60) sceneGpu.shift(); } }).catch(() => {}).finally(() => { busy = false; });
    }
    if (frame++ % 10 === 0) {
      const g = gpuMs(), p = pose();
      hud.textContent = `plains flight  t ${simT.toFixed(1)} s  pos ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}  window @ ${shownCentre[0].toFixed(0)}, ${shownCentre[1].toFixed(0)}  swaps ${swaps.length}${stream.generating ? '  generating' : ''}\n` +
        `frame p50 ${quant(frameTimes, 0.5).toFixed(2)} p95 ${quant(frameTimes, 0.95).toFixed(2)} ms  ${renderer.domElement.width}x${renderer.domElement.height}  ${presetName}  seed ${seed}\n` +
        Object.entries(g).map(([k, v]) => `${k.padEnd(12)} ${v.toFixed(2)}`).join('\n');
    }
    harness.frame();
  });

  if (query.has('t')) await seek(Math.min(DURATION, Math.max(0, Number(query.get('t')))));
  else applyCamera();
  harness.ready({
    bookmark: name => applyBookmark(name),
    report: () => ({
      gpuMs: gpuMs(), frameMs: { p50: quant(frameTimes, 0.5), p95: quant(frameTimes, 0.95) }, renderSize: [renderer.domElement.width, renderer.domElement.height],
      bookmark, simT, frames: frame, cloudsReady: clouds.isReady, pose: pose(), windowCentre: shownCentre,
      playback: play ? { frames: playFrames.length, p50: quant(playFrames, 0.5), p95: quant(playFrames, 0.95), p99: quant(playFrames, 0.99), max: Math.max(0, ...playFrames), over20ms: playFrames.filter(x => x > 20).length, over25ms: playFrames.filter(x => x > 25).length, slowFrames } : null,
      probe: probeLines,
      swapEvents: swaps,
      swapGpu: swapGpu(),
      stream: { windows: stream.stats.windows, jobsPerFrame: JOBS_PER_FRAME, worstEncodeSubmitMs: stream.stats.worstEncodeMs, generations: stream.stats.generations },
    }),
  });
  if (play) playStart = performance.now();
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
