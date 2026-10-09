// P13-H3: fine heroes loaded from fine.nvdb and stamped (work/specs/P8-hero-vdb.md sections 4.3 and 5.4).
//
// Volumes:
//   direct   disney-fine as loaded (loadCloudVolume -> uploadCloudVolume: 8 m coarse + the 4 m bricks)
//   region   a generated cumulus region with disney-fine stamped three times (replace): A at yaw 0, B at yaw 90 deg, C at 180 deg overlapping B
// Each renders with the fine layer (`fine`) or with `fineDistance = 0` (`coarse`), so the A/B is the same asset, same frame.
// Checks at load (fail the page):
//   exact     two stamps into an empty target (yaw 0 and 90 deg): the target's coarse NVDF over each box equals the hero's (rotated), and
//             every hero fine voxel reads the same profile through the target overlay as through the hero's own (R exact, G/B <= 1/255 inside)
//   sdf       region after the stamps and the SDF rebuild: the GPU SDF never overshoots the CPU EDT of the stamped coarse mask (P4-C check),
//             and every fine voxel with a profile > 0 lies in a coarse voxel with profile > 0 (so the coarse SDF bounds the fine field too)
// Bookmarks: <direct|region>-<fine|coarse>@<far|near|close>, and cost-<...> (same view; GPU medians in the report).
import { createEmptyCloudVolume, createGeneratorScratch, createSdfRebuilder, createVolumeGenerator, CLOUD_PRESETS, encodeProceduralWeatherMap, loadCloudNoise, loadCloudVolume, signedDistanceCpu, stampCloud, uploadCloudVolume, type CloudQuality, type CloudVolumeAsset, type GpuCloudVolume, type StampResult } from '@clouds/runtime';
import { fromHalfBits } from '../../../../packages/runtime/src/half';
import { installCloudsHarness } from '../../harness/clouds-contract';
import { createStage } from '../hero-fine/stage';

type V3 = [number, number, number];
const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const notes: string[] = [];
const failures: string[] = [];
const check = (ok: boolean, msg: string) => { notes.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); console.log(ok ? 'PASS' : 'FAIL', msg); };
const EMPTY = 0xffffffff;

async function readTexture(device: GPUDevice, tex: GPUTexture, bytesPerTexel: number): Promise<ArrayBuffer> {
  const w = tex.width, h = tex.height, d = tex.depthOrArrayLayers, row = w * bytesPerTexel, bpr = Math.ceil(row / 256) * 256;
  const buffer = device.createBuffer({ size: bpr * h * d, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer, bytesPerRow: bpr, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: d });
  device.queue.submit([enc.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const padded = new Uint8Array(buffer.getMappedRange());
  const out = new Uint8Array(row * h * d);
  for (let r = 0; r < h * d; r++) out.set(padded.subarray(r * bpr, r * bpr + row), r * row);
  buffer.unmap(); buffer.destroy();
  return out.buffer;
}

/** CPU view of a fine overlay: profile/G/B at a fine voxel (texture axes), or null where the cell has no brick. */
async function readOverlay(device: GPUDevice, v: GpuCloudVolume) {
  const fine = v.fine!;
  const pool = new Uint8Array(await readTexture(device, fine.pool, 4));
  const [cx, cy] = fine.cells, [px, py] = fine.poolSize;
  return (x: number, y: number, z: number): [number, number, number] | null => {
    const s = fine.indirData![((z >> 3) * cy + (y >> 3)) * cx + (x >> 3)];
    if (s === EMPTY) return null;
    const o = [(s % 32) * 10 + 1 + (x & 7), (Math.floor(s / 32) % 32) * 10 + 1 + (y & 7), Math.floor(s / 1024) * 10 + 1 + (z & 7)];
    const i = ((o[2] * py + o[1]) * px + o[0]) * 4;
    return [pool[i], pool[i + 1], pool[i + 2]];
  };
}

try {
  const quality = (query.get('quality') ?? 'high') as CloudQuality;
  const stage = await createStage({ quality, timeOfDay: 14, deterministic: query.get('deterministic') === '1' });
  const { device, runtime } = stage;
  device.addEventListener('uncapturederror', e => harness.fail((e as GPUUncapturedErrorEvent).error.message));
  const fineDistance = runtime.settings.fineDistance;

  // ---- the hero: the shipped loader path ----
  const t0 = performance.now();
  const asset: CloudVolumeAsset = await loadCloudVolume('/clouds/disney-fine/');
  const loadWallMs = performance.now() - t0;
  const fa = asset.fine!;
  const hero = uploadCloudVolume(device, asset);
  await device.queue.onSubmittedWorkDone();
  const ratio = asset.voxelSizeMeters / fa.voxelSizeMeters;
  notes.push(`disney-fine: coarse ${asset.dims.join('x')} @ ${asset.voxelSizeMeters} m, fine ${fa.dims.join('x')} @ ${fa.voxelSizeMeters} m, ${fa.leaves} leaves -> ${hero.fine!.bricks} bricks (margin ${Math.ceil(1.5 * ratio)}), pool+indirection ${(hero.fine!.bytes / 1048576).toFixed(1)} MB (payload ${(hero.fine!.bricks * 4000 / 1048576).toFixed(1)} MB); loader CPU ${fa.loadMs.toFixed(1)} ms (decode + pack), wall ${loadWallMs.toFixed(0)} ms incl. fetch`);

  // ---- exact: two stamps into an empty target ----
  const [aw, ah, ad] = asset.dims, v = asset.voxelSizeMeters;
  const EDIMS: V3 = [240, 140, 72];
  const empty = createEmptyCloudVolume(device, EDIMS, v, 'hero-stamp exact');
  // Unsnapped requests (the stamp snaps them): A at yaw 0.1 rad -> 0, B at 1.4 rad -> 90 deg.
  const reqs: { position: V3; yaw: number }[] = [
    { position: [aw * v / 2 + 13, ad * v / 2 + 21, ah * v / 2 + 37], yaw: 0.1 },
    { position: [aw * v + 64 + ah * v / 2 + 5, ad * v / 2 + 30, aw * v / 2 + 50], yaw: 1.4 },
  ];
  const exactResults: StampResult[] = [];
  {
    const enc = device.createCommandEncoder();
    for (const r of reqs) exactResults.push(stampCloud(device, enc, empty, hero, { ...r, mode: 'replace' }));
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  {
    const heroRead = await readOverlay(device, hero), tgtRead = await readOverlay(device, empty);
    const tn = new Uint8Array(await readTexture(device, empty.nvdf, 4));
    let coarseBad = 0, fineBad = 0, gbBad = 0, nGb = 0, n = 0, set = 0;
    const interior = (x: number, y: number, z: number) => {
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= aw || Y >= ah || Z >= ad || !asset.nvdf[((Z * ah + Y) * aw + X) * 4]) return false;
      }
      return true;
    };
    for (const [k, res] of exactResults.entries()) {
      const f = res.fine && 'position' in res.fine ? res.fine : null;
      check(!!f, `exact stamp ${k}: fine layer stamped (${JSON.stringify(res.fine)})`);
      if (!f) continue;
      const q = Math.round(f.yaw / (Math.PI / 2)) & 3, co = [1, 0, -1, 0][q], si = [0, 1, 0, -1][q];
      // Texture coords (x, row, up) at voxel size s, centre c (asset-local, voxel units, texture axes) -> target texture coords.
      const map = (c: number[], s: number, dims: readonly number[]): V3 => {
        const x = (c[0] + 0.5 - dims[0] / 2) * s, y = (c[2] + 0.5 - dims[2] / 2) * s, z = (c[1] + 0.5 - dims[1] / 2) * s;
        const P = [f.position[0] + x * co + z * si, f.position[1] + y, f.position[2] - x * si + z * co];
        return [Math.round(P[0] / s - 0.5), Math.round(P[2] / s - 0.5), Math.round(P[1] / s - 0.5)];
      };
      for (let z = 0; z < ad; z++) for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
        const t = map([x, y, z], v, asset.dims);
        const a = asset.nvdf[((z * ah + y) * aw + x) * 4], b = tn[((t[2] * EDIMS[1] + t[1]) * EDIMS[0] + t[0]) * 4];
        if (a !== b) coarseBad++;
      }
      const [fx, fy, fz] = fa.dims;
      for (let z = 0; z < fz; z++) for (let y = 0; y < fy; y++) for (let x = 0; x < fx; x++) {
        const t = map([x, y, z], fa.voxelSizeMeters, fa.dims);
        const h = heroRead(x, y, z), g = tgtRead(t[0], t[1], t[2]);
        const hr = h ? h[0] : 0, gr = g ? g[0] : 0;
        n++; if (hr) set++;
        if (hr !== gr) fineBad++;
        // G/B: the stamp writes the hero's G/B where its coarse profile is set and clears (G = B = 1) elsewhere, so they agree where every
        // coarse tap of the trilinear is set (3^3 coarse voxels around the texel's own).
        if (h && g && hr && interior(Math.floor(x / ratio), Math.floor(y / ratio), Math.floor(z / ratio))) {
          nGb++;
          if (Math.abs(h[1] - g[1]) > 1 || Math.abs(h[2] - g[2]) > 1) gbBad++;
        }
      }
    }
    check(coarseBad === 0, `exact: coarse NVDF stamped at the snapped placement equals the hero's, R over both boxes (${coarseBad} mismatches)`);
    check(fineBad === 0 && set > 0, `exact: every hero fine voxel reads the same profile through the stamped overlay (${n} voxels, ${set} set, ${fineBad} mismatches)`);
    check(gbBad === 0 && nGb > 0, `exact: G/B of the stamped bricks within 1/255 of the hero's inside the cloud (${nGb} voxels, ${gbBad} over)`);
    notes.push(`exact stamps: ${exactResults.map(r => JSON.stringify(r.fine)).join('; ')}`);
  }
  empty.destroy();

  // ---- region: generated cumulus + three stamps, SDF rebuild ----
  const DIMS: V3 = [320, 288, 96];
  const preset = CLOUD_PRESETS.cumulus;
  const kz = 64 / DIMS[2];
  const params = { ...preset.params, seed: 7, topFraction: (preset.params.topFraction ?? 0.8) * kz, baseDefault: (preset.params.baseDefault ?? 0.08) * kz, baseLift: 0.1 * kz };
  const scratch = createGeneratorScratch(device, DIMS, 'hero-stamp');
  const enc0 = device.createCommandEncoder();
  const weather = encodeProceduralWeatherMap(device, enc0, { ...preset.weather, coverageLo: 0.66, coverageHi: 0.98, size: [DIMS[0], DIMS[1]], seed: 7 });
  device.queue.submit([enc0.finish()]);
  const gen = createVolumeGenerator(device, { dims: DIMS, voxelSize: v, weather, params, scratch });
  { const enc = device.createCommandEncoder(); gen.generate(enc); device.queue.submit([enc.finish()]); await device.queue.onSubmittedWorkDone(); }
  const region = gen.volume;
  const base = ad * v / 2;
  const stamps = [
    { name: 'A', position: [700, base, 1100] as V3, yaw: 0 },
    { name: 'B', position: [1750, base + 40, 1000] as V3, yaw: Math.PI / 2 },
    { name: 'C', position: [1900, base + 80, 1500] as V3, yaw: Math.PI },
  ];
  const regionResults: StampResult[] = [];
  const stampMs: number[] = [];
  for (const s of stamps) {
    const enc = device.createCommandEncoder();
    const t = performance.now();
    regionResults.push(stampCloud(device, enc, region, hero, { position: s.position, yaw: s.yaw, mode: 'replace' }));
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    stampMs.push(performance.now() - t);
  }
  notes.push(`region stamps: ${regionResults.map((r, i) => `${stamps[i].name} ${JSON.stringify(r.fine)} ${stampMs[i].toFixed(0)} ms`).join('; ')}; region pool ${(region.fine!.bytes / 1048576).toFixed(1)} MB`);
  const rebuilder = createSdfRebuilder(device, region, { scratch });
  { const enc = device.createCommandEncoder(); rebuilder.generate(enc); device.queue.submit([enc.finish()]); await device.queue.onSubmittedWorkDone(); }
  {
    const N = DIMS[0] * DIMS[1] * DIMS[2];
    const nv = new Uint8Array(await readTexture(device, region.nvdf, 4));
    const sdf = new Uint16Array(await readTexture(device, region.sdf, 2));
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) mask[i] = nv[i * 4] > 0 ? 1 : 0;
    const cpu = signedDistanceCpu(mask, DIMS, v);
    let over = 0, maxOver = -Infinity, flips = 0;
    for (let i = 0; i < N; i++) {
      const g = fromHalfBits(sdf[i]);
      const e = Math.abs(g) - Math.abs(cpu[i]);
      if (e > maxOver) maxOver = e;
      if (e > 0) over++;
      if (g * cpu[i] < 0) flips++;
    }
    check(over === 0 && flips === 0, `sdf: GPU SDF never overshoots the CPU EDT of the stamped coarse mask (${N} voxels, max over ${maxOver.toFixed(3)} m, ${over} over, ${flips} sign flips)`);
    // Fine occupancy inside coarse occupancy: every brick payload texel with R > 0.
    const rd = await readOverlay(device, region);
    const [cx, cy, cz] = region.fine!.cells;
    let fineSet = 0, outside = 0;
    for (let c2 = 0; c2 < cz; c2++) for (let c1 = 0; c1 < cy; c1++) for (let c0 = 0; c0 < cx; c0++) {
      if (region.fine!.indirData![(c2 * cy + c1) * cx + c0] === EMPTY) continue;
      for (let z = c2 * 8; z < Math.min(c2 * 8 + 8, DIMS[2] * ratio); z++) for (let y = c1 * 8; y < Math.min(c1 * 8 + 8, DIMS[1] * ratio); y++) for (let x = c0 * 8; x < Math.min(c0 * 8 + 8, DIMS[0] * ratio); x++) {
        if (!rd(x, y, z)![0]) continue;
        fineSet++;
        if (!mask[(Math.floor(z / ratio) * DIMS[1] + Math.floor(y / ratio)) * DIMS[0] + Math.floor(x / ratio)]) outside++;
      }
    }
    check(fineSet > 0 && outside === 0, `sdf: fine occupancy inside coarse occupancy after the stamps (${fineSet} fine voxels set, ${outside} in empty coarse voxels)`);
  }
  rebuilder.destroy(); scratch.destroy();

  // ---- views ----
  await runtime.setNoise(await loadCloudNoise('/clouds/noise/'));
  const DIRECT_POS: V3 = [-aw * v / 2, 500, -ah * v / 2];
  const REGION_POS: V3 = [-DIMS[0] * v / 2, 300, -DIMS[1] * v / 2];
  // A dense surface point on the hero's +x flank at mid height and on its top, near the middle (profile >= 100 so wisps are skipped).
  const dense = (x: number, y: number, z: number) => asset.nvdf[((z * ah + y) * aw + x) * 4] >= 100;
  let top: V3 = [0, 0, 0], flank: V3 = [0, 0, 0], bestX = -1, bestZ = -1;
  const zm = Math.floor(ad * 0.4);
  for (let y = Math.floor(ah * 0.3); y < ah * 0.7; y++) for (let x = aw - 1; x > bestX; x--) if (dense(x, y, zm)) { bestX = x; flank = [(x + 1.5) * v, (zm + 0.5) * v, (y + 0.5) * v]; break; }
  for (let y = Math.floor(ah * 0.35); y < ah * 0.65; y++) for (let x = Math.floor(aw * 0.35); x < aw * 0.65; x++) for (let z = ad - 1; z > bestZ; z--) if (dense(x, y, z)) { bestZ = z; top = [(x + 0.5) * v, (z + 1.5) * v, (y + 0.5) * v]; break; }
  notes.push(`views: flank ${flank.join(',')} top ${top.join(',')} (box-local metres)`);
  const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const centre: V3 = [aw * v / 2, ad * v / 2, ah * v / 2];
  const viewsFor = (min: V3) => ({
    far: { pos: add(min, add(centre, [1500, -150, 900])), target: add(min, centre) },
    near: { pos: add(min, add(flank, [420, 60, 140])), target: add(min, flank) },
    close: { pos: add(min, add(flank, [130, 25, 45])), target: add(min, add(flank, [0, 10, 0])) },
    top: { pos: add(min, add(top, [160, 70, 120])), target: add(min, top) },
  });
  // Region placement of stamp A's box min corner (snapped).
  const fa0 = regionResults[0].fine && 'position' in regionResults[0].fine ? regionResults[0].fine.position : stamps[0].position;
  const aMin: V3 = [REGION_POS[0] + fa0[0] - aw * v / 2, REGION_POS[1] + fa0[1] - ad * v / 2, REGION_POS[2] + fa0[2] - ah * v / 2];
  const VIEWS = { direct: viewsFor(DIRECT_POS), region: { ...viewsFor(aMin), far: { pos: [REGION_POS[0] + 1300, 700, REGION_POS[2] + DIMS[1] * v + 900] as V3, target: [REGION_POS[0] + 1300, 650, REGION_POS[2] + 1100] as V3 } } };
  let current = '', bound: GpuCloudVolume | null = null;
  const apply = async (name: string) => {
    const m = /^(cost-)?(direct|region)-(fine|coarse)(?:@(far|near|close|top))?$/.exec(name);
    if (!m) throw new Error(`unknown bookmark ${name}`);
    const vol = m[2] === 'direct' ? hero : region;
    if (bound !== vol) { await runtime.setVolume(vol, { position: m[2] === 'direct' ? DIRECT_POS : REGION_POS }); bound = vol; }
    runtime.settings.fineDistance = m[3] === 'fine' ? fineDistance : 0;
    const view = VIEWS[m[2] as 'direct'][(m[4] ?? 'near') as 'near'];
    stage.sky.setSunDirection({ elevation: 35, azimuth: 235 });
    stage.rig.set(view.pos, view.target);
    stage.resetSamples();
    current = name;
  };
  await apply(query.get('bookmark') ?? 'direct-fine@near');
  const hud = document.getElementById('hud')!;
  if (query.get('hud') === '0') hud.style.display = 'none';
  let frames = 0;
  stage.start(() => {
    if (frames++ % 15 === 0) hud.textContent = `${current}  fineDistance ${runtime.settings.fineDistance} m\n` + Object.entries(stage.gpuMedian()).map(([k, x]) => `${k.padEnd(12)} ${x.toFixed(3)}`).join('\n') + '\n' + notes.join('\n');
    harness.frame();
  });
  const summary = { notes, loader: { loadMs: fa.loadMs, wallMs: loadWallMs, leaves: fa.leaves, bricks: hero.fine!.bricks, bytes: hero.fine!.bytes }, region: regionResults.map(r => r.fine), stampMs };
  console.log(JSON.stringify(summary));
  if (failures.length) harness.fail(`hero-stamp checks failed: ${failures.join(' | ')}`);
  else harness.ready({
    bookmark: name => apply(name),
    report: () => ({ gpuMs: stage.gpuMedian(), frameMs: stage.frameMs(), renderSize: [innerWidth, innerHeight], bookmark: current, quality: runtime.quality, ...summary }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
