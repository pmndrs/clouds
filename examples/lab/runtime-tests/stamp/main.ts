// P4-C: GPU stamping of authored clouds (Parkouring, Stormbird, houdini-test) plus a cutout tunnel into a generated cumulus region,
// rendered through @clouds/three. Also checks SDF conservativeness against a CPU EDT after stamping, and the stamp resampling against a CPU
// reference, and reports per-stamp GPU cost.
// ?empty=1 uses an empty region instead of the generated cumulus. ?bookmark=<name> picks the start view.
import { ACESFilmicToneMapping, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend } from '@clouds/three';
import {
  CLOUD_PRESETS, createEmptyCloudVolume, createGeneratorScratch, createSdfRebuilder, createVolumeGenerator, encodeProceduralWeatherMap, loadCloudNoise, loadCloudVolume,
  signedDistanceCpu, stampCloud, uploadCloudVolume, type CloudVolumeAsset, type GpuCloudVolume, type StampOptions, type StampResult,
} from '@clouds/runtime';
import { fromHalfBits } from '../../../../packages/runtime/src/half';
import { installCloudsHarness } from '../../harness/clouds-contract';
import { CameraRig } from '../../flagship/controls';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const failures: string[] = [];
const notes: string[] = [];
const check = (ok: boolean, msg: string) => { notes.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) { failures.push(msg); console.warn('FAIL', msg); } };

type V3 = [number, number, number];
const VOXEL = 8;
// 384 x 384 x 96 at 8 m: 3.07 km square, 768 m tall (the 1.5x houdini-test cloud is 730 m tall).
const DIMS: V3 = [384, 384, 96];
const EXTENT: V3 = [DIMS[0] * VOXEL, DIMS[2] * VOXEL, DIMS[1] * VOXEL];
/** World position (metres) of the region's min corner. Compass: north = -Z. */
const REGION_POS: V3 = [-EXTENT[0] / 2, 150, -3300];

try {
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = Number(query.get('exposure') ?? 0.35);
  document.body.style.cssText = 'margin:0;overflow:hidden';
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  renderer.setPixelRatio(1);
  const device = sharedBackend(renderer).device;
  device.addEventListener('uncapturederror', e => { harness.fail((e as GPUUncapturedErrorEvent).error.message); });
  const hasTs = device.features.has('timestamp-query');

  // ---- GPU timing of one batch of encoded work ----
  class PassTimes {
    private qs = device.createQuerySet({ type: 'timestamp', count: 512 });
    private resolve = device.createBuffer({ size: 256 * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    private read = device.createBuffer({ size: 256 * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    private labels: string[] = [];
    writes = (label: string): GPUComputePassTimestampWrites | undefined => {
      if (!hasTs || this.labels.length >= 256) return undefined;
      const i = this.labels.length; this.labels.push(label);
      return { querySet: this.qs, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 };
    };
    finish(encoder: GPUCommandEncoder) {
      if (!this.labels.length) return;
      encoder.resolveQuerySet(this.qs, 0, this.labels.length * 2, this.resolve, 0);
      encoder.copyBufferToBuffer(this.resolve, 0, this.read, 0, this.labels.length * 16);
    }
    async collect() {
      const n = this.labels.length;
      const byLabel: Record<string, number> = {}; const each: number[] = []; let total = 0;
      if (n) {
        await this.read.mapAsync(GPUMapMode.READ, 0, n * 16);
        const t = new BigUint64Array(this.read.getMappedRange(0, n * 16).slice(0));
        this.read.unmap();
        this.labels.forEach((l, i) => { const ms = Number(t[i * 2 + 1] - t[i * 2]) / 1e6; byLabel[l] = (byLabel[l] ?? 0) + ms; each.push(ms); total += ms; });
      }
      this.qs.destroy(); this.resolve.destroy(); this.read.destroy();
      return { total, byLabel, each };
    }
  }
  /** Texture to a tightly packed ArrayBuffer (rows are padded to 256 B for the copy and unpadded here). */
  async function readTexture(tex: GPUTexture, bytesPerTexel: number): Promise<ArrayBuffer> {
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

  // ---- stamp placement helpers (region-local metres, world axes x, y-up, z) ----
  interface Stamp { name: string; asset: CloudVolumeAsset; gpu: GpuCloudVolume; opts: StampOptions & { position: V3 }; centroid: V3 }
  /** Asset texel coordinate (x, row, up) -> region-local world position under a stamp's transform. */
  const texelToLocal = (asset: CloudVolumeAsset, o: StampOptions, t: V3): V3 => {
    const s = o.scale ?? 1, yaw = o.yaw ?? 0, vs = asset.voxelSizeMeters;
    const x = (t[0] - asset.dims[0] / 2) * vs * s, y = (t[2] - asset.dims[2] / 2) * vs * s, z = (t[1] - asset.dims[1] / 2) * vs * s;
    return [o.position[0] + x * Math.cos(yaw) + z * Math.sin(yaw), o.position[1] + y, o.position[2] - x * Math.sin(yaw) + z * Math.cos(yaw)];
  };
  /** Density-weighted centroid of an asset in texel coordinates. */
  const centroidOf = (a: CloudVolumeAsset): V3 => {
    const [w, h, d] = a.dims; let sx = 0, sy = 0, sz = 0, sw = 0;
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = a.nvdf[((z * h + y) * w + x) * 4]; if (p) { sx += x * p; sy += y * p; sz += z * p; sw += p; } }
    return [sx / sw, sy / sw, sz / sw];
  };
  const toWorld = (p: V3): V3 => [p[0] + REGION_POS[0], p[1] + REGION_POS[1], p[2] + REGION_POS[2]];

  // ---- assets ----
  const [parkouring, stormbird, houdini] = await Promise.all(['parkouring', 'stormbird', 'houdini-test'].map(n => loadCloudVolume(`/clouds/${n}/`)));
  // A tunnel to cut: a cylinder along the texture x axis, radius 14 voxels (112 m), 96 voxels (768 m) long. Only its NVDF profile is read.
  const tunnelAsset: CloudVolumeAsset = (() => {
    const dims: V3 = [96, 40, 40]; const nvdf = new Uint8Array(dims[0] * dims[1] * dims[2] * 4);
    for (let z = 0; z < 40; z++) for (let y = 0; y < 40; y++) for (let x = 0; x < 96; x++) {
      if (Math.hypot(y + 0.5 - 20, z + 0.5 - 20) <= 14) nvdf.set([255, 255, 255, 255], ((z * 40 + y) * 96 + x) * 4);
    }
    return { name: 'tunnel', dims, voxelSizeMeters: VOXEL, nvdf, sdfMeters: new Float32Array(dims[0] * dims[1] * dims[2]) };
  })();
  const gpuOf = new Map<CloudVolumeAsset, GpuCloudVolume>();
  for (const a of [parkouring, stormbird, houdini, tunnelAsset]) gpuOf.set(a, uploadCloudVolume(device, a));

  // Local centre of each stamp; y is the asset box's bottom at 0 plus its half height, so the 64 m crop margin sits at the floor.
  const lift = (a: CloudVolumeAsset, s: number) => (a.dims[2] * a.voxelSizeMeters * s) / 2;
  const stamps: Stamp[] = [];
  const addStamp = (name: string, asset: CloudVolumeAsset, o: Omit<StampOptions, 'position'> & { at: [number, number] }) => {
    const { at, ...rest } = o;
    const opts = { ...rest, position: [at[0], lift(asset, o.scale ?? 1), at[1]] as V3 };
    stamps.push({ name, asset, gpu: gpuOf.get(asset)!, opts, centroid: centroidOf(asset) });
  };
  // Region-local x, z (metres). The camera looks north (-z) from the south edge; local z grows southward.
  addStamp('parkouring', parkouring, { at: [813, 1506], mode: 'replace' });
  addStamp('stormbird', stormbird, { at: [2342, 1005], yaw: Math.PI / 4, mode: 'replace' });
  addStamp('houdini', houdini, { at: [2350, 2050], scale: 1.5, mode: 'max', densityScale: 1 });
  // The tunnel goes through Stormbird's centre of mass, along the world x axis, at the centroid's height.
  const sb = stamps[1];
  const sbCentre = texelToLocal(sb.asset, sb.opts, sb.centroid);
  addStamp('tunnel', tunnelAsset, { at: [sbCentre[0], sbCentre[2]], mode: 'cutout' });
  stamps[3].opts.position[1] = sbCentre[1];

  // ---- the region ----
  const preset = CLOUD_PRESETS.cumulus;
  const useEmpty = query.get('empty') === '1';
  // The preset is tuned for a 64-slice (512 m) column; this region has 96, so the height fractions shrink by 2/3 to keep the same metres.
  const k = 64 / DIMS[2];
  const params = { ...preset.params, seed: Number(query.get('seed') ?? 7), topFraction: (preset.params.topFraction ?? 0.8) * k, baseDefault: (preset.params.baseDefault ?? 0.08) * k, baseLift: 0.1 * k };
  const scratch = createGeneratorScratch(device, DIMS, 'stamp test');
  let region: GpuCloudVolume;
  const genTimes = new PassTimes();
  let generationMs = 0;
  if (useEmpty) {
    region = createEmptyCloudVolume(device, DIMS, VOXEL);
  } else {
    const enc0 = device.createCommandEncoder();
    // Sparser than the stock preset so the stamped clouds stand out: the cumulus recipe with a higher coverage ramp (override with ?w_coverageLo=&w_coverageHi=).
    const weatherOpts = { ...preset.weather, coverageLo: Number(query.get('w_coverageLo') ?? 0.66), coverageHi: Number(query.get('w_coverageHi') ?? 0.98), size: [DIMS[0], DIMS[1]] as [number, number], seed: Number(query.get('seed') ?? 7) };
    const weather = encodeProceduralWeatherMap(device, enc0, weatherOpts);
    device.queue.submit([enc0.finish()]);
    const gen = createVolumeGenerator(device, { dims: DIMS, voxelSize: VOXEL, weather, params, scratch, timestamps: genTimes.writes });
    const enc = device.createCommandEncoder();
    gen.generate(enc);
    genTimes.finish(enc);
    const t0 = performance.now();
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    generationMs = (await genTimes.collect()).total || performance.now() - t0;
    region = gen.volume;
  }

  // ---- stamp, timing each ----
  interface StampCost { name: string; mode: string; gpuMs: number; wallMs: number; voxels: number; bounds: [V3, V3] }
  const costs: StampCost[] = [];
  const results: StampResult[] = [];
  const doStamp = query.get('stamps') !== '0';   // ?stamps=0: the bare generated region, for before/after captures
  for (const s of doStamp ? stamps : []) {
    const t = new PassTimes();
    const enc = device.createCommandEncoder({ label: `stamp ${s.name}` });
    const r = stampCloud(device, enc, region, s.gpu, { ...s.opts, timestamps: t.writes });
    t.finish(enc);
    const t0 = performance.now();
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    const wall = performance.now() - t0;
    const c = await t.collect();
    results.push(r);
    costs.push({ name: s.name, mode: s.opts.mode ?? 'max', gpuMs: c.total, wallMs: wall, voxels: r.voxels, bounds: [r.boundsMin, r.boundsMax] });
  }

  // ---- SDF rebuild after all stamps: one shot, then amortized ----
  const rebuildTimes = new PassTimes();
  const rebuilder = createSdfRebuilder(device, region, { scratch, timestamps: rebuildTimes.writes });
  {
    const enc = device.createCommandEncoder({ label: 'stamp sdf rebuild' });
    rebuilder.generate(enc);
    rebuildTimes.finish(enc);
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  const rebuildCost = await rebuildTimes.collect();
  // Amortized variant (4 z slices per job): must give a bit-identical SDF.
  const sdfOneShot = new Uint16Array(await readTexture(region.sdf, 2));
  const amTimes = new PassTimes();
  const amortized = createSdfRebuilder(device, region, { scratch, sliceDepth: 4, timestamps: amTimes.writes });
  {
    const enc = device.createCommandEncoder({ label: 'stamp sdf rebuild sliced' });
    amortized.generate(enc);
    amTimes.finish(enc);
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  const amCost = await amTimes.collect();
  const sdfSliced = new Uint16Array(await readTexture(region.sdf, 2));
  let sliceDiff = 0; for (let i = 0; i < sdfOneShot.length; i++) if (sdfOneShot[i] !== sdfSliced[i]) sliceDiff++;
  check(sliceDiff === 0, `sliced SDF rebuild (${amortized.jobsTotal} jobs of 4 z) is bit-identical to one shot (${sliceDiff} differing texels)`);

  // ---- SDF conservativeness vs CPU EDT of the stamped NVDF mask ----
  const N = DIMS[0] * DIMS[1] * DIMS[2];
  interface Stats { n: number; maxOvershoot: number; maxUndershoot: number; medianAbs: number; signFlips: number; overshootVoxels: number }
  const median = (a: Float32Array | number[]) => { const s = Array.from(a).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  function compare(cpu: Float32Array, halfs: Uint16Array, sel?: (i: number) => boolean): Stats {
    const worst: { i: number; e: number; g: number; c: number }[] = [];
    const err: number[] = []; let over = -Infinity, under = 0, flips = 0, nOver = 0, n = 0;
    for (let i = 0; i < cpu.length; i++) {
      if (sel && !sel(i)) continue;
      const g = fromHalfBits(halfs[i]);
      const e = Math.abs(g) - Math.abs(cpu[i]);
      n++; err.push(Math.abs(e)); over = Math.max(over, e); under = Math.min(under, e);
      if (e > 0) { nOver++; if (worst.length < 400) worst.push({ i, e, g, c: cpu[i] }); }
      if (g * cpu[i] < 0) flips++;
    }
    if (worst.length) { worst.sort((a, b) => b.e - a.e); notes.push('worst ' + worst.slice(0, 8).map(w => `[${w.i % DIMS[0]},${Math.floor(w.i / DIMS[0]) % DIMS[1]},${Math.floor(w.i / (DIMS[0] * DIMS[1]))}] gpu ${w.g.toFixed(2)} cpu ${w.c.toFixed(2)}`).join('; ')); }
    return { n, maxOvershoot: over, maxUndershoot: under, medianAbs: median(err), signFlips: flips, overshootVoxels: nOver };
  }
  const fmt = (s: Stats) => `n=${s.n} maxOver=${s.maxOvershoot.toFixed(3)}m maxUnder=${s.maxUndershoot.toFixed(2)}m medianAbs=${s.medianAbs.toFixed(2)}m signFlips=${s.signFlips} overVoxels=${s.overshootVoxels}`;
  const tCheck0 = performance.now();
  const nvdfBytes = new Uint8Array(await readTexture(region.nvdf, 4));
  const mask = new Uint8Array(N); let occupied = 0;
  for (let i = 0; i < N; i++) { mask[i] = nvdfBytes[i * 4] > 0 ? 1 : 0; occupied += mask[i]; }
  const pad = 12;
  const inBox = (i: number) => {
    const x = i % DIMS[0], y = Math.floor(i / DIMS[0]) % DIMS[1], z = Math.floor(i / (DIMS[0] * DIMS[1]));
    for (const r of results) if (r.voxels && x >= r.boundsMin[0] - pad && x < r.boundsMax[0] + pad && y >= r.boundsMin[1] - pad && y < r.boundsMax[1] + pad && z >= r.boundsMin[2] - pad && z < r.boundsMax[2] + pad) return true;
    return false;
  };
  const cpuSdf = signedDistanceCpu(mask, DIMS, VOXEL);
  const sAll = compare(cpuSdf, sdfSliced);
  const sBox = compare(cpuSdf, sdfSliced, inBox);
  const checkMs = performance.now() - tCheck0;
  check(occupied > 0, `stamped region has occupied voxels (${occupied}, ${(100 * occupied / N).toFixed(1)}%)`);
  check(sAll.maxOvershoot <= 0 && sAll.signFlips === 0, `SDF never overshoots the CPU EDT after stamping, whole region: ${fmt(sAll)}`);
  check(sBox.maxOvershoot <= 0 && sBox.signFlips === 0, `SDF never overshoots the CPU EDT inside the stamped boxes (+${pad} voxels): ${fmt(sBox)}`);

  // ---- empty target: all three modes in one encoder, against a CPU composite (inverse transform + trilinear, 8-bit rounded) ----
  const EDIMS: V3 = [192, 192, 80];
  const empty = createEmptyCloudVolume(device, EDIMS, VOXEL, 'empty test');
  const ec: V3 = [EDIMS[0] * VOXEL / 2, 0, EDIMS[1] * VOXEL / 2];
  const eStamps: { asset: CloudVolumeAsset; opts: StampOptions }[] = [
    { asset: parkouring, opts: { position: [ec[0] - 350, lift(parkouring, 1), ec[2] - 250], mode: 'max' } },
    { asset: stormbird, opts: { position: [ec[0] + 150, lift(stormbird, 1.25) + 20, ec[2] + 50], yaw: Math.PI / 6, scale: 1.25, mode: 'max', detailType: 0.9 } },
    { asset: houdini, opts: { position: [ec[0] - 50, lift(houdini, 0.75) + 20, ec[2] + 250], yaw: -Math.PI / 3, scale: 0.75, mode: 'replace', densityScale: 0.5 } },
    { asset: tunnelAsset, opts: { position: [ec[0] + 150, lift(stormbird, 1.25) + 160, ec[2] + 50], yaw: 0.4, mode: 'cutout' } },
  ];
  const eT = new PassTimes();
  const eEnc = device.createCommandEncoder({ label: 'empty stamps' });
  const eRes = eStamps.map(s => stampCloud(device, eEnc, empty, gpuOf.get(s.asset)!, { ...s.opts, timestamps: eT.writes }));
  eT.finish(eEnc);
  device.queue.submit([eEnc.finish()]);
  await device.queue.onSubmittedWorkDone();
  const eCost = await eT.collect();
  const eRebuild = createSdfRebuilder(device, empty);
  { const enc = device.createCommandEncoder(); eRebuild.generate(enc); device.queue.submit([enc.finish()]); await device.queue.onSubmittedWorkDone(); }
  const eN = EDIMS[0] * EDIMS[1] * EDIMS[2];
  const eNvdf = new Uint8Array(await readTexture(empty.nvdf, 4));
  const eHalf = new Uint16Array(await readTexture(empty.sdf, 2));
  const eMask = new Uint8Array(eN); let eOcc = 0;
  for (let i = 0; i < eN; i++) { eMask[i] = eNvdf[i * 4] > 0 ? 1 : 0; eOcc += eMask[i]; }
  check(eOcc > 1000, `empty target gains the stamped clouds (${eOcc} occupied voxels)`);
  const eStats = compare(signedDistanceCpu(eMask, EDIMS, VOXEL), eHalf);
  check(eStats.maxOvershoot <= 0 && eStats.signFlips === 0, `SDF never overshoots the CPU EDT for an empty target + 4 stamps (max, max, replace, cutout): ${fmt(eStats)}`);
  {
    // CPU reference composite. Channels are rounded to 8 bit exactly where the GPU stores them.
    const ref = new Uint8Array(eN * 4);
    for (let i = 0; i < eN; i++) { ref[i * 4 + 1] = 255; ref[i * 4 + 2] = 255; ref[i * 4 + 3] = 255; }
    for (const { asset, opts } of eStamps) {
      const [aw, ah, ad] = asset.dims, vs = VOXEL, yaw = opts.yaw ?? 0, c = Math.cos(yaw), s = Math.sin(yaw), sc = opts.scale ?? 1, mode = opts.mode ?? 'max';
      const tex = (x: number, y: number, z: number, ch: number) => asset.nvdf[((Math.min(ad - 1, Math.max(0, z)) * ah + Math.min(ah - 1, Math.max(0, y))) * aw + Math.min(aw - 1, Math.max(0, x))) * 4 + ch];
      for (let z = 0; z < EDIMS[2]; z++) for (let y = 0; y < EDIMS[1]; y++) for (let x = 0; x < EDIMS[0]; x++) {
        const wx = (x + 0.5) * vs - opts.position[0], wy = (z + 0.5) * vs - opts.position[1], wz = (y + 0.5) * vs - opts.position[2];
        const ux = (c * wx - s * wz) / sc, uz = (s * wx + c * wz) / sc, uy = wy / sc;
        const a: V3 = [ux / vs + aw / 2, uz / vs + ah / 2, uy / vs + ad / 2];
        if (!(a[0] >= 0 && a[1] >= 0 && a[2] >= 0 && a[0] <= aw && a[1] <= ah && a[2] <= ad)) continue;
        const px = a[0] - 0.5, py = a[1] - 0.5, pz = a[2] - 0.5, x0 = Math.floor(px), y0 = Math.floor(py), z0 = Math.floor(pz), fx = px - x0, fy = py - y0, fz = pz - z0;
        const smp = [0, 0, 0];
        for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const w8 = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
          for (let ch = 0; ch < 3; ch++) smp[ch] += tex(x0 + dx, y0 + dy, z0 + dz, ch) * w8;
        }
        const sp = Math.round(smp[0]), o = ((z * EDIMS[1] + y) * EDIMS[0] + x) * 4;
        const detail = opts.detailType === undefined ? Math.round(smp[1]) : Math.round(opts.detailType * 255);
        const dens = Math.round(Math.min(smp[2] / 255 * (opts.densityScale ?? 1), 1) * 255);
        if (mode === 'cutout') { if (sp > 0) ref.set([0, 255, 255, 255], o); }
        else if (mode === 'replace') {
          if (sp > 0) ref.set([sp, detail, dens, 255], o);
          else {
            // Trilinear asset SDF (metres, scaled) against the clear margin.
            let d = 0;
            for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
              const xx = Math.min(aw - 1, Math.max(0, x0 + dx)), yy = Math.min(ah - 1, Math.max(0, y0 + dy)), zz = Math.min(ad - 1, Math.max(0, z0 + dz));
              d += asset.sdfMeters[(zz * ah + yy) * aw + xx] * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
            }
            if (d * sc < (opts.clearMargin ?? 48)) ref.set([0, 255, 255, 255], o);
          }
        }
        else if (sp > ref[o]) ref.set([sp, detail, dens, 255], o);
      }
    }
    // R everywhere; G and B where the voxel is clearly cloud in both (profile > 8/255): at the 1/255 threshold the GPU's fixed-point
    // filter weights and the CPU's float weights flip a few wisp voxels between "cloud" and "empty", and G/B jump to 255 outside.
    const within = [0, 0, 0], count = [0, 0, 0]; let maxDiffR = 0, maxDiffGB = 0;
    for (let i = 0; i < eN; i++) for (let ch = 0; ch < 3; ch++) {
      if (ch > 0 && (eNvdf[i * 4] <= 8 || ref[i * 4] <= 8)) continue;
      const d = Math.abs(eNvdf[i * 4 + ch] - ref[i * 4 + ch]);
      if (ch === 0) maxDiffR = Math.max(maxDiffR, d); else maxDiffGB = Math.max(maxDiffGB, d);
      count[ch]++; if (d <= 2) within[ch]++;
    }
    const frac = within.map((w, ch) => w / count[ch]);
    check(Math.min(...frac) > 0.9999 && maxDiffR <= 255, `GPU stamps match the CPU composite: R/G/B within 2/255 for ${frac.map(f => (100 * f).toFixed(4)).join('% / ')}% of texels (G/B over ${count[1]} cloud voxels; max diff R ${maxDiffR}, G/B ${maxDiffGB} /255)`);
    let refOcc = 0; for (let i = 0; i < eN; i++) if (ref[i * 4] > 0) refOcc++;
    check(Math.abs(refOcc - eOcc) < 0.01 * eOcc, `occupied voxel count GPU ${eOcc} vs CPU composite ${refOcc} (${(100 * (eOcc - refOcc) / refOcc).toFixed(2)}%)`);
  }
  empty.destroy();

  // ---- scene ----
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, 0.5, 600000);
  const rig = new CameraRig(camera, renderer.domElement);
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 14, latitude: 40, north: '-Z', mirrorBelowHorizon: true });
  sky.attach(scene);
  sky.createSun({ physical: true }).attach(scene);
  await sky.compileAsync();
  scene.add(new Mesh(new PlaneGeometry(400000, 400000).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x2f3a28, roughness: 1 })));
  const clouds = new Clouds(renderer, { sky, quality: (query.get('quality') as 'high') ?? 'high' });
  const post = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  post.outputNode = clouds.node(scenePass.getTextureNode(), scenePass);
  await clouds.setNoise(await loadCloudNoise('/clouds/noise/'));
  await clouds.core.setVolume(region, { position: REGION_POS });

  // ---- bookmarks: a view of each stamp (looking at its centroid), the tunnel mouth, an overview and a plan view ----
  interface Bookmark { pos: V3; target: V3; sunEl: number; sunAz: number }
  const bookmarks: Record<string, Bookmark> = {};
  const centreOf = (s: Stamp) => toWorld(texelToLocal(s.asset, s.opts, s.centroid));
  const view = (name: string, s: Stamp, dist: number, azDeg: number, elDeg: number, sunAz = 150) => {
    const c = centreOf(s), az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
    bookmarks[name] = { pos: [c[0] + Math.sin(az) * Math.cos(el) * dist, c[1] + Math.sin(el) * dist, c[2] - Math.cos(az) * Math.cos(el) * dist], target: c, sunEl: 45, sunAz };
  };
  // az: compass bearing of the camera as seen from the cloud (0 = camera north of it, 180 = camera south of it).
  view('parkouring', stamps[0], 1500, 200, 24);
  view('stormbird', stamps[1], 1500, 160, 24);
  view('houdini', stamps[2], 2200, 200, 18);
  {
    // Through the tunnel: from the west end of the tunnel axis looking east, a little back from the mouth.
    const t = stamps[3], c = centreOf(t);
    bookmarks.tunnel = { pos: [c[0] - 640, c[1], c[2]], target: [c[0] + 400, c[1], c[2]], sunEl: 45, sunAz: 150 };
    bookmarks.tunnelSide = { pos: [c[0] - 500, c[1] + 60, c[2] - 800], target: c, sunEl: 45, sunAz: 150 };
  }
  bookmarks.overview = { pos: [0, 120, -300], target: [0, 260, -2000], sunEl: 45, sunAz: 150 };
  bookmarks.plan = { pos: [0, 2600, -1750], target: [0, 0, -1850], sunEl: 55, sunAz: 150 };
  const NAMES = Object.keys(bookmarks);
  let bookmark = NAMES.includes(query.get('bookmark') ?? '') ? query.get('bookmark')! : 'overview';
  const applyBookmark = (name: string) => {
    const b = bookmarks[name]; if (!b) throw new Error(`unknown bookmark: ${name}`);
    bookmark = name;
    sky.setSunDirection({ elevation: b.sunEl, azimuth: b.sunAz });
    rig.set([...b.pos], [...b.target]);
  };

  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);
  resize();
  const hud = document.createElement('pre');
  hud.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:4px 6px;background:#0008;color:#fff;font:12px monospace;pointer-events:none';
  document.body.appendChild(hud);
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;right:8px;top:8px;display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;max-width:60vw';
  for (const name of NAMES) { const b = document.createElement('button'); b.textContent = name; b.onclick = () => applyBookmark(name); bar.appendChild(b); }
  document.body.appendChild(bar);

  const frameTimes: number[] = [];
  let last = performance.now(), frame = 0;
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pct = (p: number) => { const s = [...frameTimes].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  renderer.setAnimationLoop(now => {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    if (frame > 30) { frameTimes.push(dt * 1000); if (frameTimes.length > 240) frameTimes.shift(); }
    rig.update(dt);
    camera.near = Math.min(50, Math.max(0.2, camera.position.y * 0.05));
    camera.updateProjectionMatrix();
    sky.update(camera);
    void sky.updateAerialPerspective();
    post.render();
    if (frame++ % 10 === 0) hud.textContent = `${bookmark}  ${useEmpty ? 'empty' : 'cumulus'} region  frame p50 ${pct(0.5).toFixed(2)} ms\n${notes.filter(n => n.startsWith('FAIL')).join('\n')}`;
    harness.frame();
  });
  applyBookmark(bookmark);

  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const summary = {
    region: { dims: DIMS, voxelSize: VOXEL, kind: useEmpty ? 'empty' : 'cumulus', generationGpuMs: r3(generationMs), occupiedVoxels: occupied },
    timestampQuery: hasTs,
    stamps: stamps.map((s, i) => ({ name: s.name, mode: s.opts.mode, yawDeg: Math.round(((s.opts.yaw ?? 0) * 180) / Math.PI), scale: s.opts.scale ?? 1, positionLocal: s.opts.position.map(Math.round), worldCentroid: centreOf(s).map(Math.round), assetDims: s.asset.dims, boundsVoxels: costs[i]?.bounds, voxels: costs[i]?.voxels, gpuMs: r3(costs[i]?.gpuMs ?? 0), wallMs: r3(costs[i]?.wallMs ?? 0) })),
    sdfRebuild: { oneShotGpuMs: r3(rebuildCost.total), byStage: Object.fromEntries(Object.entries(rebuildCost.byLabel).map(([k2, v]) => [k2, r3(v)])), slicedJobs: amortized.jobsTotal, slicedGpuMs: r3(amCost.total), slicedAvgJobMs: r3(amCost.total / amortized.jobsTotal), slicedWorstJobMs: r3(Math.max(...amCost.each)) },
    emptyTarget: { dims: EDIMS, stampsGpuMs: r3(eCost.total), voxels: eRes.map(r => r.voxels), occupied: eOcc },
    sdfCheck: { all: sAll, stampedBoxes: sBox, empty: eStats, cpuCheckMs: Math.round(checkMs) },
    notes,
  };
  console.log(JSON.stringify(summary));
  if (failures.length) harness.fail(`stamp checks failed: ${failures.join(' | ')} || ${notes.filter(n => n.startsWith('worst')).join(' || ')}`);
  else harness.ready({
    bookmark: name => applyBookmark(name),
    report: () => ({
      gpuMs: { ...clouds.timings, stamp: Object.fromEntries(costs.map(c => [c.name, r3(c.gpuMs)])), sdfRebuild: r3(rebuildCost.total) },
      frameMs: { p50: pct(0.5), p95: pct(0.95), mean: mean(frameTimes) }, renderSize: [renderer.domElement.width, renderer.domElement.height], bookmark, frames: frame, cloudsReady: clouds.isReady, failures, ...summary,
    }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
