// In-browser .vdb import (P4-H): drop a .vdb on the page (or ?url=) and get a Nubis cloud, no Houdini or Python.
//   ?url=<path>        load a file served by the dev server, e.g. /@fs/<abs path>/ParkouringCloud.vdb (see README note in work/reports/P4-H.md)
//   ?mode=auto|pack|fog|sdf   ?voxel=8   ?scale=<world scale>   ?width=<metres>   ?iso=0.05   ?grid=<name>   ?seed=1
//   ?fine=4|2          also build a fine hero layer at that voxel size (P13-H4); the "fine" picker re-imports, "download fine.nvdb" exports it
//   ?compare=parkouring       after import, read the NVDF back and compare with /clouds/<name>/nvdf.bin (reported in __clouds.report().compare)
//   ?quality=high  ?haze=1  ?exposure=0.35
// Without ?width / ?scale, a cloud narrower than 600 m (a typical artist VDB in real-world units) is scaled to 1500 m wide.
import { ACESFilmicToneMapping, PerspectiveCamera, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend } from '@clouds/three';
import { exportFineNvdb, inspectVdb, importVdb, loadCloudNoise, VdbImportError, type FineProfile, type GpuCloudVolume, type VdbImportInfo, type VdbImportMode, type VdbImportOptions } from '@clouds/runtime';
import { installCloudsHarness } from '../harness/clouds-contract';
import { CLOUD_BASE_HEIGHT, CLOUD_BOX, FOCUS_BOX, INSIDE_POINT, bookmarkTime, isBookmarkName, resolveBookmark, sunVector, type BookmarkName } from '../flagship/bookmarks';
import { CameraRig } from '../flagship/controls';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const BOOKMARKS: BookmarkName[] = ['ground', 'edge', 'backlit', 'above'];

/** Read a volume's NVDF back to the CPU (tight rgba8, x fastest, then row, then slice). */
async function readbackNvdf(device: GPUDevice, volume: GpuCloudVolume): Promise<Uint8Array> {
  const [w, h, d] = volume.dims;
  const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
  const buffer = device.createBuffer({ size: bytesPerRow * h * d, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture: volume.nvdf }, { buffer, bytesPerRow, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: d });
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const padded = new Uint8Array(buffer.getMappedRange());
  const out = new Uint8Array(w * h * d * 4);
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) out.set(padded.subarray((z * h + y) * bytesPerRow, (z * h + y) * bytesPerRow + w * 4), (z * h + y) * w * 4);
  buffer.unmap(); buffer.destroy();
  return out;
}

interface CompareResult { against: string; dimsMatch: boolean; cropOffsetMatch: boolean; withinTwo: [number, number, number]; exact: [number, number, number]; maxDiff: [number, number, number]; occupancyMismatch: number; voxels: number }

async function compareToAsset(device: GPUDevice, volume: GpuCloudVolume, info: VdbImportInfo, name: string): Promise<CompareResult> {
  const base = `/clouds/${name}/`;
  const meta = await (await fetch(base + 'cloud.json')).json() as { dims: number[]; cropOffset: number[] };
  const ref = new Uint8Array(await (await fetch(base + 'nvdf.bin')).arrayBuffer());
  const got = await readbackNvdf(device, volume);
  const dimsMatch = meta.dims.every((v, i) => v === volume.dims[i]);
  const result: CompareResult = { against: name, dimsMatch, cropOffsetMatch: meta.cropOffset.every((v, i) => v === info.cropOffset[i]), withinTwo: [0, 0, 0], exact: [0, 0, 0], maxDiff: [0, 0, 0], occupancyMismatch: 0, voxels: dimsMatch ? ref.length / 4 : 0 };
  if (!dimsMatch) return result;
  const n = ref.length / 4;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const diff = Math.abs(got[i * 4 + c] - ref[i * 4 + c]);
      if (diff <= 2) result.withinTwo[c]++;
      if (diff === 0) result.exact[c]++;
      if (diff > result.maxDiff[c]) result.maxDiff[c] = diff;
    }
    if ((got[i * 4] > 0) !== (ref[i * 4] > 0)) result.occupancyMismatch++;
  }
  for (let c = 0; c < 3; c++) { result.withinTwo[c] /= n; result.exact[c] /= n; }
  return result;
}

try {
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = query.has('exposure') ? Number(query.get('exposure')) : 0.35;
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  renderer.setPixelRatio(1);
  const device = sharedBackend(renderer).device;
  const scene = new Scene();
  const camera = new PerspectiveCamera(70, 1, 1, 1500000);
  const rig = new CameraRig(camera, renderer.domElement);
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: bookmarkTime('ground'), latitude: 40, north: '-Z' });
  sky.attach(scene);
  sky.createGround({ mode: 'plane', size: 8000000, color: 0x34461f, roughness: 1 }).attach(scene);
  sky.createSun({ physical: true }).attach(scene);
  await sky.compileAsync();
  const clouds = new Clouds(renderer, { sky, quality: (query.get('quality') as 'high') ?? 'high' });
  await clouds.setNoise(await loadCloudNoise('/clouds/noise/'));
  const post = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const colour = query.get('haze') === '1' ? sky.applyHaze(scenePass.getTextureNode(), { scenePass }) : scenePass.getTextureNode();
  post.outputNode = clouds.node(colour, scenePass);

  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);
  resize();

  // ---- overlay
  const css = (el: HTMLElement, text: string) => { el.style.cssText = text; return el; };
  const hud = css(document.createElement('pre'), 'position:fixed;left:8px;top:8px;margin:0;color:#fff;font:12px/1.35 monospace;text-shadow:0 0 3px #000,0 0 3px #000;pointer-events:none;max-width:60vw;white-space:pre-wrap');
  const err = css(document.createElement('div'), 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);max-width:70vw;padding:14px 18px;background:rgba(120,20,20,.88);color:#fff;font:14px/1.4 system-ui;border-radius:6px;display:none;white-space:pre-wrap');
  const hint = css(document.createElement('div'), 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);padding:18px 26px;border:2px dashed rgba(255,255,255,.7);color:#fff;font:16px system-ui;text-shadow:0 0 4px #000;border-radius:8px;pointer-events:none;text-align:center');
  hint.innerHTML = 'Drop a <b>.vdb</b> file here<br><span style="font-size:12px;opacity:.8">or use ?url=/@fs/&lt;path&gt;.vdb &nbsp; (ZIP, none and lz4 Blosc; float grids)</span>';
  const bar = css(document.createElement('div'), 'position:fixed;right:8px;top:8px;display:flex;gap:4px;align-items:center');
  document.body.append(hud, err, hint, bar);
  const picker = document.createElement('input');
  picker.type = 'file'; picker.accept = '.vdb'; picker.style.cssText = 'color:#fff;font:12px monospace;max-width:170px';
  picker.onchange = () => { const f = picker.files?.[0]; if (f) void loadFile(f); };
  bar.append(picker);
  // Fine hero layer (P13-H4): off, 4 m or 2 m under the 8 m volume; changing it re-imports the current file.
  const fineSel = document.createElement('select');
  for (const [v, label] of [['', 'fine: off'], ['4', 'fine: 4 m'], ['2', 'fine: 2 m']]) { const o = document.createElement('option'); o.value = v; o.textContent = label; fineSel.append(o); }
  fineSel.value = query.get('fine') ?? '';
  fineSel.onchange = () => { if (lastBuffer) void loadBuffer(lastBuffer, sourceName, 0); };
  const download = document.createElement('button');
  download.textContent = 'download fine.nvdb'; download.disabled = true;
  download.onclick = () => {
    if (!lastFine) return;
    const t = performance.now();
    const { buffer, leaves } = exportFineNvdb(lastFine);
    pageMs.exportMs = performance.now() - t;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }));
    a.download = `${sourceName.replace(/\.vdb$/i, '') || 'hero'}-fine-${lastFine.voxelSize}m.nvdb`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    console.log(`exported fine.nvdb: ${buffer.byteLength} bytes, ${leaves} leaves`);
  };
  bar.append(fineSel, download);
  for (const name of BOOKMARKS) { const b = document.createElement('button'); b.textContent = name; b.onclick = () => applyBookmark(name); bar.appendChild(b); }
  addEventListener('dragover', e => { e.preventDefault(); hint.style.borderColor = '#7cf'; });
  addEventListener('dragleave', () => { hint.style.borderColor = 'rgba(255,255,255,.7)'; });
  addEventListener('drop', e => { e.preventDefault(); hint.style.borderColor = 'rgba(255,255,255,.7)'; const f = e.dataTransfer?.files[0]; if (f) void loadFile(f); });

  // ---- bookmarks from the imported bounds
  let bookmark: BookmarkName = 'ground', time = bookmarkTime('ground');
  const applyBookmark = (name: string) => {
    if (!isBookmarkName(name)) throw new Error(`unknown bookmark: ${name}`);
    bookmark = name; time = bookmarkTime(name); sky.setTimeOfDay(time);
    const b = resolveBookmark(name, sunVector(sky.sunAzimuth, sky.sunElevation));
    rig.set(b.position, b.target);
  };
  /** Volume box centred on x = z = 0 with its base at CLOUD_BASE_HEIGHT; the focus box is the occupied voxels (texture x, row, up -> world x, z, y). */
  const frameBounds = (info: VdbImportInfo) => {
    const [w, h, d] = info.dims, v = info.voxelSizeMeters;
    const min: [number, number, number] = [-(w * v) / 2, CLOUD_BASE_HEIGHT, -(h * v) / 2];
    CLOUD_BOX.min = min; CLOUD_BOX.max = [min[0] + w * v, min[1] + d * v, min[2] + h * v];
    const lo = info.occupiedMin, hi = info.occupiedMax.map(c => c + 1);
    FOCUS_BOX.min = [min[0] + lo[0] * v, min[1] + lo[2] * v, min[2] + lo[1] * v];
    FOCUS_BOX.max = [min[0] + hi[0] * v, min[1] + hi[2] * v, min[2] + hi[1] * v];
    for (let a = 0; a < 3; a++) INSIDE_POINT[a] = (FOCUS_BOX.min[a] + FOCUS_BOX.max[a]) / 2;
  };

  // ---- loading
  let volume: GpuCloudVolume | null = null;
  let lastInfo: VdbImportInfo | null = null, lastError: string | null = null, lastCompare: CompareResult | null = null;
  let pageMs: Record<string, number> = {}, sourceName = '', optionsUsed: VdbImportOptions = {};
  let lastBuffer: ArrayBuffer | null = null, lastFine: FineProfile | null = null;
  let frame = 0;
  const num = (k: string): number | undefined => (query.has(k) && query.get(k) !== '' ? Number(query.get(k)) : undefined);
  const importOptions = (ab: ArrayBuffer): VdbImportOptions => {
    const o: VdbImportOptions = { voxelSize: num('voxel') ?? 8, mode: (query.get('mode') as VdbImportMode | null) ?? 'auto' };
    if (fineSel.value) o.fineVoxelSize = Number(fineSel.value);
    for (const k of ['iso', 'seed', 'margin', 'smooth', 'profileGain', 'scaleGain', 'profileNoise'] as const) { const v = num(k); if (v !== undefined) o[k] = v; }
    if (query.has('grid')) o.grid = query.get('grid')!;
    const width = num('width'), scale = num('scale');
    if (width !== undefined) o.targetWidthMeters = width;
    else if (scale !== undefined) o.worldScale = scale;
    else {
      const native = inspectVdb(ab, o).nativeWidth;
      if (native > 0 && native < 600) o.targetWidthMeters = 1500;
    }
    return o;
  };

  const show = (info: VdbImportInfo | null) => {
    const lines: string[] = [];
    lines.push(`${sourceName || 'no file'}${lastInfo ? `  (${(info!.fileBytes / 1048576).toFixed(1)} MB, file version ${info!.fileVersion})` : ''}`);
    if (info) {
      const t = info.timings, f = (n?: number) => (n === undefined ? '-' : n.toFixed(0));
      lines.push(`mode ${info.mode}  base grid "${info.baseGrid}"  world scale ${info.worldScale.toFixed(4)}  source width ${info.sourceWidthMeters.toFixed(0)} m`);
      lines.push(`grids: ${info.grids.map(g => `${g.name} [${g.gridClass || g.valueType}${g.voxelSize ? `, ${g.voxelSize[0].toPrecision(3)}` : ''}, ${g.compression}${g.unsupported ? ', UNSUPPORTED' : ''}] ${g.role}`).join(' | ')}`);
      lines.push(`volume ${info.dims.join('x')} @ ${info.voxelSizeMeters} m = ${info.sizeMeters.map(v => v.toFixed(0)).join(' x ')} m (x,y-up,z), ${(100 * info.occupiedFraction).toFixed(1)}% occupied`);
      if (info.fine) lines.push(`fine ${info.fine.dims.join('x')} @ ${info.fine.voxelSizeMeters} m, ${(100 * info.fine.occupiedFraction).toFixed(1)}% occupied, ${info.fine.bricks} bricks, ${(info.fine.gpuBytes / 1048576).toFixed(1)} MB GPU`);
      lines.push(`import ms: read ${f(pageMs.readMs)}  parse ${f(t.parseMs)}  resample ${f(t.resampleMs)}  channels ${f(t.channelsMs)}  upload ${f(t.uploadMs)}  gpu sdf ${f(t.sdfGpuMs)}${t.fineMs !== undefined ? `  fine ${f(t.fineMs)}` : ''}  = ${f(t.totalMs)}${pageMs.firstFrameMs ? `  (first frame +${f(pageMs.firstFrameMs)})` : ''}`);
      for (const n of info.notes) lines.push(`note: ${n}`);
      if (lastCompare) lines.push(`vs assets/clouds/${lastCompare.against}: dims ${lastCompare.dimsMatch}, crop ${lastCompare.cropOffsetMatch}; within 2/255 R/G/B ${lastCompare.withinTwo.map(v => (100 * v).toFixed(3)).join('/')}%`);
    }
    hud.textContent = lines.join('\n') + `\nframe ${pct(0.5).toFixed(2)} ms  ${Object.entries(gpuMs()).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  ')}`;
  };

  async function loadBuffer(ab: ArrayBuffer, name: string, readMs: number): Promise<void> {
    sourceName = name; lastError = null; lastCompare = null; err.style.display = 'none'; hint.style.display = 'none';
    hud.textContent = `importing ${name} ...`;
    try {
      optionsUsed = importOptions(ab);
      const t0 = performance.now();
      lastBuffer = ab;
      const { volume: next, info, fine } = await importVdb(device, ab, optionsUsed);
      lastFine = fine ?? null; download.disabled = !fine;
      const prev = volume;
      await clouds.setVolume(next, { position: [0, CLOUD_BASE_HEIGHT, 0] });
      volume = next; lastInfo = info;
      prev?.destroy();
      frameBounds(info);
      applyBookmark(bookmark);
      const f0 = frame;
      pageMs = { readMs, importWallMs: performance.now() - t0, firstFrameMs: 0 };
      await new Promise<void>(resolve => { const poll = () => (frame >= f0 + 3 ? resolve() : requestAnimationFrame(poll)); poll(); });
      pageMs.firstFrameMs = performance.now() - t0 - (pageMs.importWallMs ?? 0);
      if (query.has('compare')) lastCompare = await compareToAsset(device, next, info, query.get('compare')!);
    } catch (e) {
      lastError = e instanceof VdbImportError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
      err.textContent = lastError; err.style.display = 'block';
      console.warn('vdb import failed (shown on the page):', e instanceof Error ? e.message : e); // warn, not error: an unsupported file is an expected outcome, not a page fault
    }
  }
  async function loadFile(file: File): Promise<void> {
    const t = performance.now();
    const ab = await file.arrayBuffer();
    await loadBuffer(ab, file.name, performance.now() - t);
  }
  async function loadUrl(url: string): Promise<void> {
    const t = performance.now();
    const res = await fetch(url);
    if (!res.ok) { lastError = `fetch ${url}: ${res.status}${res.status === 403 ? ' (vite fs.allow: the file must be inside the repo checkout that serves the page)' : ''}`; err.textContent = lastError; err.style.display = 'block'; hint.style.display = 'none'; return; }
    const ab = await res.arrayBuffer();
    await loadBuffer(ab, decodeURIComponent(url.split('/').pop() ?? url), performance.now() - t);
  }

  // ---- frame loop
  const frameTimes: number[] = [], sceneGpu: number[] = [];
  let last = performance.now(), busy = false;
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pct = (p: number) => { const s = [...frameTimes].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  const gpuMs = () => ({ scene: mean(sceneGpu), ...clouds.timings });
  renderer.setAnimationLoop(now => {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    if (frame > 30) { frameTimes.push(dt * 1000); if (frameTimes.length > 240) frameTimes.shift(); }
    rig.update(dt);
    camera.near = Math.min(200, Math.max(0.5, camera.position.y * 0.002));
    camera.updateProjectionMatrix();
    sky.update(camera);
    void sky.updateAerialPerspective();
    post.render();
    if (!busy) {
      busy = true;
      renderer.resolveTimestampsAsync('render').then(ms => { if (typeof ms === 'number' && ms > 0) { sceneGpu.push(ms); if (sceneGpu.length > 60) sceneGpu.shift(); } }).catch(() => {}).finally(() => { busy = false; });
    }
    if (frame++ % 10 === 0) show(lastInfo);
    harness.frame();
  });
  applyBookmark('ground');

  const url = query.get('url');
  if (url) await loadUrl(url);
  harness.ready({
    bookmark: name => applyBookmark(name),
    report: () => ({
      gpuMs: gpuMs(), frameMs: { p50: pct(0.5), p95: pct(0.95) }, renderSize: [renderer.domElement.width, renderer.domElement.height], bookmark, timeOfDay: time, frames: frame, cloudsReady: clouds.isReady,
      source: sourceName, options: optionsUsed, import: lastInfo, pageMs, error: lastError, compare: lastCompare,
    }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
