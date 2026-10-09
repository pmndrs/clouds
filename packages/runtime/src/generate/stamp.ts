// GPU stamping of authored cloud assets into a generated (or empty) cloudscape region, in the spirit of Guerrilla's Atlas
// compositing (nubis-sources.md section 2): authored voxel clouds are placed into one dense world grid with a transform, merged,
// and carved by cutouts; the SDF is then rebuilt for the result. No three imports.
//
//   stampCloud(device, encoder, target, asset, { position, yaw, scale, mode })   NVDF of the target only (cheap, bounded to the stamp's box)
//   createSdfRebuilder(device, target, { sliceDepth }).generate(encoder, maxJobs)  the target's SDF from its NVDF (whole volume, amortizable)
//
// Stamp any number of assets, then rebuild the SDF once. The target must be a generator output (createVolumeGenerator(...).volume)
// or createEmptyCloudVolume(...): its NVDF needs STORAGE_BINDING | COPY_SRC and its SDF COPY_DST.
//
// Fine heroes (P13-H3, work/specs/P8-hero-vdb.md section 4.3): an asset with `.fine` stamped with mode 'replace' at scale 1 is snapped
// (box min corner on the target's voxel lattice, yaw to a quarter turn) so the coarse stamp is an exact copy, and its fine bricks are
// re-bricked on the GPU into `target.fine` (created or grown here; the target owns it). Texels the stamp did not write keep the previous
// brick or take the target's coarse profile; G and B always come from the stamped coarse field. Call `setVolume` after fine stamps so the
// runtime binds the new overlay.
import type { GpuCloudVolume } from '../resources';
import { BRICK_TEXELS, HERO_EMPTY, POOL_SLAB_BRICKS, POOL_SLAB_BYTES, POOL_XY } from '../hero/bricks';
import type { GpuFineOverlay } from '../hero/overlay';
import { EDT_X_WGSL, SDF_WGSL, edtLineWGSL } from './shaders';
import { createGeneratorScratch, PARAM_BYTES, rangeChunks, type GeneratorScratch } from './volume-generator';

export type StampMode = 'max' | 'replace' | 'cutout';

export interface StampOptions {
  /** Where the asset volume's centre goes, in the target volume's own metres along world axes (x, y-up, z): 0..extentMeters. */
  position: [number, number, number];
  /** Rotation about the vertical axis in radians, three.js sense (positive turns +x toward -z). Default 0. */
  yaw?: number;
  /** Uniform size multiplier of the asset. Default 1. */
  scale?: number;
  /**
   * max: where the asset is denser than the target it takes over all channels (a union of clouds).
   * replace: the asset overwrites the target wherever it has density and within `clearMargin` metres of its surface (clears the target there).
   * cutout: wherever the asset has density the target is emptied (carves a hole in the shape of the asset).
   * Default 'max'.
   */
  mode?: StampMode;
  /** replace only: metres around the asset's surface (its SDF, scaled) in which the target is emptied. Default 48; use a huge value to clear the asset's whole box. */
  clearMargin?: number;
  /** Multiplies the asset's density scale (NVDF B) before writing, clamped to 1. max/replace only. Default 1. */
  densityScale?: number;
  /** Overrides the asset's detail type (NVDF G, 0 wispy .. 1 billowy). max/replace only. Default: keep the asset's. */
  detailType?: number;
  /** Attach a GPU timestamp query to the stamp's compute pass. */
  timestamps?: (label: string) => GPUComputePassTimestampWrites | undefined;
}

export interface StampResult {
  /** Target voxels touched (inclusive min, exclusive max), clamped to the volume. Empty when the stamp misses the volume. */
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  voxels: number;
  /**
   * P13-H3, an asset with a fine layer: the snapped placement actually stamped and the target's bricks after it, or why the fine layer was
   * dropped (coarse only: mode not 'replace', scale != 1, voxel sizes differ).
   */
  fine?: { position: [number, number, number]; yaw: number; bricks: number; added: number; rebuilt: number } | { dropped: string };
}

const STAMP_WGSL = /* wgsl */ `
struct S {
  bmin: vec4<i32>,    // xyz bounds min (target voxel), w mode (0 max, 1 replace, 2 cutout)
  bsize: vec4<u32>,   // xyz bounds size
  adims: vec4<f32>,   // asset dims (x, row, up), w density scale
  pos: vec4<f32>,     // stamp centre (x, y-up, z) metres, w detail override (-1 none)
  rot: vec4<f32>,     // cos(yaw), sin(yaw), 1 / scale, asset voxel size
  tvox: vec4<f32>,    // target voxel size, replace clear margin (m), scale
}
@group(0) @binding(0) var<uniform> S0: S;
@group(0) @binding(1) var assetTex: texture_3d<f32>;
@group(0) @binding(2) var assetSampler: sampler;
@group(0) @binding(3) var prevTex: texture_3d<f32>;     // copy of the target NVDF over the stamp's bounds, at origin 0
@group(0) @binding(4) var outTex: texture_storage_3d<rgba8unorm, write>;
@group(0) @binding(5) var assetSdf: texture_3d<f32>;      // asset SDF in metres, positive outside

@compute @workgroup_size(8, 8, 4)
fn stampMain(@builtin(global_invocation_id) g: vec3<u32>) {
  if (any(g >= S0.bsize.xyz)) { return; }
  let tv = S0.bmin.xyz + vec3<i32>(g);
  // Target voxel centre, world axes (x, y-up, z) relative to the target volume: texture (x, row, up) -> (x, up, row).
  let c = (vec3<f32>(tv) + 0.5) * S0.tvox.x;
  let rel = vec3<f32>(c.x, c.z, c.y) - S0.pos.xyz;
  // Inverse yaw (three.js rotation.y: x' = x cos + z sin, z' = -x sin + z cos).
  let co = S0.rot.x; let si = S0.rot.y;
  let u = vec3<f32>(co * rel.x - si * rel.z, rel.y, si * rel.x + co * rel.z) * S0.rot.z;
  let a = vec3<f32>(u.x, u.z, u.y) / S0.rot.w + S0.adims.xyz * 0.5;   // asset texel coordinates (x, row, up)
  let mode = S0.bmin.w;
  let inside = all(a >= vec3<f32>(0.0)) && all(a <= S0.adims.xyz);
  if (!inside) { return; }
  let s = textureSampleLevel(assetTex, assetSampler, a / S0.adims.xyz, 0.0);
  let prev = textureLoad(prevTex, vec3<i32>(g), 0);
  let sp = round(s.r * 255.0) / 255.0;
  if (mode == 2) {
    if (sp > 0.0) { textureStore(outTex, tv, vec4<f32>(0.0, 1.0, 1.0, 1.0)); }
    return;
  }
  let detail = select(s.g, S0.pos.w, S0.pos.w >= 0.0);
  let scale = min(s.b * S0.adims.w, 1.0);
  if (mode == 1) {
    if (sp > 0.0) { textureStore(outTex, tv, vec4<f32>(sp, detail, scale, 1.0)); return; }
    let dist = textureSampleLevel(assetSdf, assetSampler, a / S0.adims.xyz, 0.0).r * S0.tvox.z;
    if (dist < S0.tvox.y) { textureStore(outTex, tv, vec4<f32>(0.0, 1.0, 1.0, 1.0)); }
    return;
  }
  if (sp > prev.r) { textureStore(outTex, tv, vec4<f32>(sp, detail, scale, 1.0)); }
}
`;

/** The occupancy of the SDF rebuild: NVDF profile > 0 is inside -> the class bit of the field buffer. One thread, two voxels. */
const SEED_WGSL = /* wgsl */ `
struct Params { dims: vec3<u32>, step: i32, zStart: u32, zCount: u32, margin: f32, maxDist: f32 }
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var nvdf: texture_3d<f32>;
@group(0) @binding(2) var<storage, read_write> fld: array<u32>;
@compute @workgroup_size(8, 8, 4)
fn seedMain(@builtin(global_invocation_id) g: vec3<u32>) {
  let x0 = g.x * 2u;
  if (x0 >= P.dims.x || g.y >= P.dims.y || g.z >= P.zCount) { return; }
  let z = P.zStart + g.z;
  var o = 0u;
  for (var s = 0u; s < 2u; s++) {
    if (x0 + s < P.dims.x && textureLoad(nvdf, vec3<i32>(i32(x0 + s), i32(g.y), i32(z)), 0).r > 0.0) { o = o | (0x8000u << (16u * s)); }
  }
  let rowWords = ((P.dims.x * 2u + 255u) / 256u) * 64u;
  fld[(z * P.dims.y + g.y) * rowWords + g.x] = o;
}
`;

const STAMP_SLOT = 256, STAMP_SLOTS = 256;
interface StampKit { layout: GPUBindGroupLayout; pipeline: GPUComputePipeline; sampler: GPUSampler }
interface TargetKit { params: GPUBuffer; prev: GPUTexture | null; slot: number; assetViews: WeakMap<GPUTexture, GPUTextureView>; sdfViews: WeakMap<GPUTexture, GPUTextureView> }
const kits = new WeakMap<GPUDevice, StampKit>();
const targets = new WeakMap<GPUTexture, TargetKit>();

function stampKit(device: GPUDevice): StampKit {
  let kit = kits.get(device);
  if (kit) return kit;
  const C = GPUShaderStage.COMPUTE;
  const layout = device.createBindGroupLayout({
    label: 'stamp', entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 96 } },
      { binding: 1, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 2, visibility: C, sampler: { type: 'filtering' } },
      { binding: 3, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 4, visibility: C, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '3d' } },
      { binding: 5, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } },
    ],
  });
  const pipeline = device.createComputePipeline({
    label: 'stamp', layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module: device.createShaderModule({ label: 'stamp', code: STAMP_WGSL }), entryPoint: 'stampMain' },
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
  kit = { layout, pipeline, sampler };
  kits.set(device, kit);
  return kit;
}

/**
 * Resample `asset` (an uploaded authored cloud, texture axes (x, map row, up)) into `target`'s NVDF with the given transform.
 * Each target voxel in the transformed box is mapped back into the asset and sampled trilinearly. Encoded into `encoder`; the
 * caller submits. The target's SDF is stale afterwards: run a `createSdfRebuilder` once after the last stamp.
 * Stamps are applied in encoding order. Up to 256 stamps per target may be encoded between submits.
 */
export function stampCloud(device: GPUDevice, encoder: GPUCommandEncoder, target: GpuCloudVolume, asset: GpuCloudVolume, options: StampOptions): StampResult {
  const needs = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC;
  if ((target.nvdf.usage & needs) !== needs) throw new Error('stampCloud: target NVDF needs STORAGE_BINDING | COPY_SRC (use a generator volume or createEmptyCloudVolume)');
  const kit = stampKit(device);
  let tk = targets.get(target.nvdf);
  if (!tk) {
    tk = { params: device.createBuffer({ label: 'stamp params', size: STAMP_SLOT * STAMP_SLOTS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), prev: null, slot: 0, assetViews: new WeakMap(), sdfViews: new WeakMap() };
    targets.set(target.nvdf, tk);
    // Freed with the target (the volume's destroy is the caller's; the helper textures follow its NVDF texture's lifetime loosely).
    const destroy = target.destroy;
    target.destroy = () => { tk!.params.destroy(); tk!.prev?.destroy(); targets.delete(target.nvdf); destroy.call(target); };
  }
  const [tw, th, td] = target.dims;
  const [aw, ah, ad] = asset.dims;
  const scale = options.scale ?? 1;
  let yaw = options.yaw ?? 0, co = Math.cos(yaw), si = Math.sin(yaw);
  const mode = options.mode ?? 'max';
  let position = options.position;
  const fineWhy = !asset.fine ? '' : mode !== 'replace' ? `mode '${mode}' (fine heroes need 'replace')` : Math.abs(scale - 1) > 1e-6 ? 'scale != 1'
    : asset.voxelSize !== target.voxelSize ? 'asset and target voxel sizes differ' : !asset.fine.indirData ? 'the overlay has no CPU indirection' : '';
  const fine = asset.fine && !fineWhy ? asset.fine : undefined;
  if (asset.fine && fineWhy && !warned.has(fineWhy)) { warned.add(fineWhy); console.warn(`stampCloud: fine hero layer dropped, coarse only: ${fineWhy}`); }
  if (fine) {
    // Quarter-turn yaw, box min corner on the target lattice: every target voxel centre lands on an asset texel centre (exact copy).
    const q = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
    yaw = q * Math.PI / 2; co = [1, 0, -1, 0][q]; si = [0, 1, 0, -1][q];
    const h = [aw, ad, ah].map(n => n * asset.voxelSize * 0.5);   // world x, y-up, z
    if (q & 1) [h[0], h[2]] = [h[2], h[0]];
    position = position.map((p, i) => Math.round((p - h[i]) / target.voxelSize) * target.voxelSize + h[i]) as [number, number, number];
  }

  // Bounds: the asset box (centred on `position`, scaled, yawed) as a target-voxel AABB.
  const half = [aw * asset.voxelSize * 0.5 * scale, ad * asset.voxelSize * 0.5 * scale, ah * asset.voxelSize * 0.5 * scale]; // world x, y-up, z
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < 8; k++) {
    const x = k & 1 ? half[0] : -half[0], y = k & 2 ? half[1] : -half[1], z = k & 4 ? half[2] : -half[2];
    // forward yaw: x' = x cos + z sin, z' = -x sin + z cos
    const w = [position[0] + x * co + z * si, position[1] + y, position[2] - x * si + z * co];
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], w[i]); hi[i] = Math.max(hi[i], w[i]); }
  }
  const vs = target.voxelSize;
  // World (x, y, z) -> texture (x, row = z, up = y).
  const tmin = [lo[0], lo[2], lo[1]].map(v => Math.max(0, Math.floor(v / vs) - 1));
  const tmax = [hi[0], hi[2], hi[1]].map((v, i) => Math.min([tw, th, td][i], Math.ceil(v / vs) + 1));
  const size = [0, 1, 2].map(i => Math.max(0, tmax[i] - tmin[i]));
  const voxels = size[0] * size[1] * size[2];
  const result: StampResult = { boundsMin: tmin as [number, number, number], boundsMax: tmax as [number, number, number], voxels };
  if (voxels === 0) return result;

  if (!tk.prev) tk.prev = device.createTexture({ label: 'stamp prev', dimension: '3d', format: 'rgba8unorm', size: { width: tw, height: th, depthOrArrayLayers: td }, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  let assetView = tk.assetViews.get(asset.nvdf);
  if (!assetView) { assetView = asset.nvdf.createView({ dimension: '3d' }); tk.assetViews.set(asset.nvdf, assetView); }

  let sdfView = tk.sdfViews.get(asset.sdf);
  if (!sdfView) { sdfView = asset.sdf.createView({ dimension: '3d' }); tk.sdfViews.set(asset.sdf, sdfView); }

  const slot = tk.slot++ % STAMP_SLOTS;
  const data = new ArrayBuffer(96);
  const i32 = new Int32Array(data), u32 = new Uint32Array(data), f32 = new Float32Array(data);
  i32.set([tmin[0], tmin[1], tmin[2], mode === 'max' ? 0 : mode === 'replace' ? 1 : 2], 0);
  u32.set(size, 4);
  f32.set([aw, ah, ad, options.densityScale ?? 1], 8);
  f32.set([position[0], position[1], position[2], options.detailType ?? -1], 12);
  f32.set([co, si, 1 / scale, asset.voxelSize], 16);
  f32.set([vs, Math.min(options.clearMargin ?? 48, 1e9), scale, 0], 20);
  device.queue.writeBuffer(tk.params, slot * STAMP_SLOT, data);

  encoder.copyTextureToTexture({ texture: target.nvdf, origin: { x: tmin[0], y: tmin[1], z: tmin[2] } }, { texture: tk.prev }, { width: size[0], height: size[1], depthOrArrayLayers: size[2] });
  const bind = device.createBindGroup({
    label: 'stamp', layout: kit.layout,
    entries: [
      { binding: 0, resource: { buffer: tk.params, size: 96 } }, { binding: 1, resource: assetView }, { binding: 2, resource: kit.sampler },
      { binding: 3, resource: tk.prev.createView() }, { binding: 4, resource: target.nvdf.createView() }, { binding: 5, resource: sdfView },
    ],
  });
  const pass = encoder.beginComputePass({ label: `stamp ${mode}`, timestampWrites: options.timestamps?.('stamp') });
  pass.setPipeline(kit.pipeline);
  pass.setBindGroup(0, bind, [slot * STAMP_SLOT]);
  pass.dispatchWorkgroups(Math.ceil(size[0] / 8), Math.ceil(size[1] / 8), Math.ceil(size[2] / 4));
  pass.end();
  if (fine) result.fine = stampFine(device, encoder, target, asset, fine, position, yaw, co, si, Math.min(options.clearMargin ?? 48, 1e9), assetView, sdfView);
  else if (fineWhy) result.fine = { dropped: fineWhy };
  return result;
}

const warned = new Set<string>();

// One thread per texel of a target brick that the hero touches (P13-H3). `owned` replays the coarse stamp's decision for the target voxel
// that holds the texel (the hero wrote it, or cleared it within clearMargin): owned texels read the hero's fine profile through its
// indirection and pool (exact, the placement is snapped), the others keep the previous brick or take the target's coarse profile.
// G and B come from the stamped target NVDF.
const REBRICK_WGSL = /* wgsl */ `
struct P {
  tcells: vec4<u32>,   // target cells xyz, job count
  tdims: vec4<u32>,    // target fine dims xyz, dispatch groups x
  hdims: vec4<u32>,    // hero fine dims xyz, ratio
  adims: vec4<f32>,    // hero coarse dims xyz, hero fine voxel
  pos: vec4<f32>,      // stamp centre (x, y-up, z) metres, target voxel
  rot: vec4<f32>,      // cos, sin, asset voxel, clear margin
}
@group(0) @binding(0) var<uniform> P0: P;
@group(0) @binding(1) var<storage, read> jobs: array<vec4<u32>>;   // target slot, target cell, previous slot (or empty)
@group(0) @binding(2) var heroIndir: texture_3d<u32>;
@group(0) @binding(3) var heroPool: texture_3d<f32>;
@group(0) @binding(4) var heroNvdf: texture_3d<f32>;
@group(0) @binding(5) var heroSdf: texture_3d<f32>;
@group(0) @binding(6) var targetNvdf: texture_3d<f32>;
@group(0) @binding(7) var oldPool: texture_3d<f32>;
@group(0) @binding(8) var smp: sampler;
@group(0) @binding(9) var outPool: texture_storage_3d<rgba8unorm, write>;
fn slotOrigin(s: u32) -> vec3<u32> { return vec3<u32>(s % 32u, (s / 32u) % 32u, s / 1024u) * 10u; }
// Target metres (texture axes) -> asset-local metres (world axes, inverse yaw).
fn toAsset(c: vec3<f32>) -> vec3<f32> {
  let rel = vec3<f32>(c.x, c.z, c.y) - P0.pos.xyz;
  return vec3<f32>(P0.rot.x * rel.x - P0.rot.y * rel.z, rel.y, P0.rot.y * rel.x + P0.rot.x * rel.z);
}
@compute @workgroup_size(64)
fn rebrickMain(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let i = (wg.y * P0.tdims.w + wg.x) * 64u + li;
  if (i >= P0.tcells.w * 1000u) { return; }
  let job = jobs[i / 1000u];
  let t = i % 1000u;
  let tt = vec3<u32>(t % 10u, (t / 10u) % 10u, t / 100u);
  let cell = vec3<u32>(job.y % P0.tcells.x, (job.y / P0.tcells.x) % P0.tcells.y, job.y / (P0.tcells.x * P0.tcells.y));
  let f = clamp(vec3<i32>(cell * 8u + tt) - 1, vec3<i32>(0), vec3<i32>(P0.tdims.xyz) - 1);
  let ratio = i32(P0.hdims.w);
  // The coarse stamp's decision for the target voxel holding this texel (same arithmetic as stampMain).
  let u = toAsset((vec3<f32>(f / ratio) + 0.5) * P0.pos.w);
  let a = vec3<f32>(u.x, u.z, u.y) / P0.rot.z + P0.adims.xyz * 0.5;
  var owned = false;
  if (all(a >= vec3<f32>(0.0)) && all(a <= P0.adims.xyz)) {
    let sp = round(textureSampleLevel(heroNvdf, smp, a / P0.adims.xyz, 0.0).r * 255.0);
    owned = sp > 0.0 || textureSampleLevel(heroSdf, smp, a / P0.adims.xyz, 0.0).r < P0.rot.w;
  }
  var out: vec4<f32>;
  if (!owned && job.z != 0xffffffffu) {
    out = textureLoad(oldPool, slotOrigin(job.z) + tt, 0);
  } else {
    let fc = vec3<f32>(f) + 0.5;
    let coarse = textureSampleLevel(targetNvdf, smp, fc / (vec3<f32>(P0.tdims.xyz)), 0.0);
    // Not owned: the coarse profile, zero where the coarse voxel holding the texel is empty, so fine occupancy stays inside coarse
    // occupancy (the SDF bound) although the pool filters the coarse field a second time.
    var r = select(0.0, coarse.r, textureLoad(targetNvdf, f / ratio, 0).r > 0.0);
    if (owned) {
      let uf = toAsset(fc * P0.adims.w);
      let h = vec3<i32>(floor(vec3<f32>(uf.x, uf.z, uf.y) / P0.adims.w + vec3<f32>(P0.hdims.xyz) * 0.5));
      r = 0.0;
      if (all(h >= vec3<i32>(0)) && all(h < vec3<i32>(P0.hdims.xyz))) {
        let s = textureLoad(heroIndir, vec3<u32>(h) / 8u, 0).r;
        if (s != 0xffffffffu) { r = textureLoad(heroPool, slotOrigin(s) + 1u + vec3<u32>(h) % 8u, 0).r; }
      }
    }
    out = vec4<f32>(r, coarse.g, coarse.b, 1.0);
  }
  textureStore(outPool, slotOrigin(job.x) + tt, out);
}
`;

const rebrickKits = new WeakMap<GPUDevice, { pipeline: GPUComputePipeline; sampler: GPUSampler; empty: GPUTexture }>();
const ownedFine = new WeakSet<GpuCloudVolume>();

/** The fine half of a snapped 'replace' stamp: grow `target.fine` and encode the re-brick pass after the coarse stamp. */
function stampFine(device: GPUDevice, encoder: GPUCommandEncoder, target: GpuCloudVolume, asset: GpuCloudVolume, hero: GpuFineOverlay,
  position: [number, number, number], yaw: number, co: number, si: number, clearMargin: number, assetView: GPUTextureView, sdfView: GPUTextureView) {
  const fv = hero.fineVoxel, ratio = Math.round(asset.voxelSize / fv);
  const tf = target.dims.map(d => d * ratio) as [number, number, number];
  const tc = tf.map(d => Math.ceil(d / 8)) as [number, number, number];
  const hf = asset.dims.map(d => d * ratio) as [number, number, number];
  const prev = target.fine;
  if (prev && (prev.fineVoxel !== fv || prev.cells.some((c, i) => c !== tc[i]) || !prev.indirData)) throw new Error('stampCloud: the target already has a fine overlay with another fine voxel size or layout');
  const indir = prev ? Uint32Array.from(prev.indirData!) : new Uint32Array(tc[0] * tc[1] * tc[2]).fill(HERO_EMPTY);
  // Hero fine box (texture axes, voxel units) -> target fine box, through the snapped transform (exact up to float noise).
  const toTarget = (lo: number[], hi: number[]) => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 8; k++) {
      const g = [k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]];
      const x = (g[0] - hf[0] / 2) * fv, y = (g[2] - hf[2] / 2) * fv, z = (g[1] - hf[1] / 2) * fv;   // world axes
      const P = [position[0] + x * co + z * si, position[1] + y, position[2] - x * si + z * co];
      const t = [P[0] / fv, P[2] / fv, P[1] / fv];
      for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], Math.round(t[i])); mx[i] = Math.max(mx[i], Math.round(t[i])); }
    }
    return [mn, mx];
  };
  const cellIndex = (c: number[]) => (c[2] * tc[1] + c[1]) * tc[0] + c[0];
  const job = new Map<number, number>();   // target cell -> previous slot (HERO_EMPTY for a new brick)
  const visit = (lo: number[], hi: number[], fn: (cell: number) => void) => {
    const c0 = lo.map(v => Math.max(0, Math.floor(v / 8))), c1 = hi.map((v, i) => Math.min(tc[i] - 1, Math.floor((v - 1) / 8)));
    for (let z = c0[2]; z <= c1[2]; z++) for (let y = c0[1]; y <= c1[1]; y++) for (let x = c0[0]; x <= c1[0]; x++) fn(cellIndex([x, y, z]));
  };
  // Cells under a hero brick's payload get a brick.
  const [hcx, hcy, hcz] = hero.cells;
  for (let z = 0; z < hcz; z++) for (let y = 0; y < hcy; y++) for (let x = 0; x < hcx; x++) {
    if (hero.indirData![(z * hcy + y) * hcx + x] === HERO_EMPTY) continue;
    const [lo, hi] = toTarget([x * 8, y * 8, z * 8], [Math.min(hf[0], x * 8 + 8), Math.min(hf[1], y * 8 + 8), Math.min(hf[2], z * 8 + 8)]);
    visit(lo, hi, cell => job.set(cell, indir[cell]));
  }
  // Existing bricks whose texels (apron included) overlap the hero box are rebuilt: the coarse field changed under them.
  const [blo, bhi] = toTarget([0, 0, 0], hf);
  visit(blo.map(v => v - 1), bhi.map(v => v + 1), cell => { if (indir[cell] !== HERO_EMPTY) job.set(cell, indir[cell]); });
  const prevCount = prev?.bricks ?? 0;
  let count = prevCount, added = 0;
  const jobs = new Uint32Array(Math.max(1, job.size) * 4);
  let j = 0;
  for (const [cell, old] of job) {
    if (old === HERO_EMPTY) { indir[cell] = count++; added++; }
    jobs.set([indir[cell], cell, old, 0], j++ * 4);
  }
  if (count > POOL_SLAB_BRICKS * 204) throw new Error(`stampCloud: ${count} fine bricks, over the pool limit (204 slabs)`);

  // The grown overlay: a new indirection and pool, the old pool's slabs copied in, the touched bricks re-built.
  const slabs = Math.max(1, Math.ceil(count / POOL_SLAB_BRICKS));
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
  const indirTex = device.createTexture({ label: 'stamp fine indirection', dimension: '3d', format: 'r32uint', size: tc, usage });
  device.queue.writeTexture({ texture: indirTex }, indir, { bytesPerRow: tc[0] * 4, rowsPerImage: tc[1] }, tc);
  const poolSize: [number, number, number] = [POOL_XY, POOL_XY, BRICK_TEXELS * slabs];
  const pool = device.createTexture({ label: 'stamp fine pool', dimension: '3d', format: 'rgba8unorm', size: poolSize, usage: usage | GPUTextureUsage.STORAGE_BINDING });
  if (prev) encoder.copyTextureToTexture({ texture: prev.pool }, { texture: pool }, prev.poolSize);
  let kit = rebrickKits.get(device);
  if (!kit) {
    kit = {
      pipeline: device.createComputePipeline({ label: 'stamp fine rebrick', layout: 'auto', compute: { module: device.createShaderModule({ label: 'stamp fine rebrick', code: REBRICK_WGSL }), entryPoint: 'rebrickMain' } }),
      sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' }),
      empty: device.createTexture({ label: 'stamp fine empty pool', dimension: '3d', format: 'rgba8unorm', size: [1, 1, 1], usage: GPUTextureUsage.TEXTURE_BINDING }),
    };
    rebrickKits.set(device, kit);
  }
  if (job.size) {
    const total = job.size * 1000, groups = Math.ceil(total / 64), gx = Math.min(groups, 65535), gy = Math.ceil(groups / gx);
    const params = new ArrayBuffer(96);
    new Uint32Array(params, 0, 12).set([...tc, job.size, ...tf, gx, ...hf, ratio]);
    new Float32Array(params, 48, 12).set([...asset.dims, fv, ...position, target.voxelSize, co, si, asset.voxelSize, clearMargin]);
    const uni = device.createBuffer({ label: 'stamp fine params', size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uni, 0, params);
    const jobBuf = device.createBuffer({ label: 'stamp fine jobs', size: jobs.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(jobBuf, 0, jobs);
    const pass = encoder.beginComputePass({ label: 'stamp fine rebrick' });
    pass.setPipeline(kit.pipeline);
    pass.setBindGroup(0, device.createBindGroup({
      layout: kit.pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: uni } }, { binding: 1, resource: { buffer: jobBuf } },
        { binding: 2, resource: hero.indir.createView() }, { binding: 3, resource: hero.pool.createView() },
        { binding: 4, resource: assetView }, { binding: 5, resource: sdfView }, { binding: 6, resource: target.nvdf.createView({ dimension: '3d' }) },
        { binding: 7, resource: (prev?.pool ?? kit.empty).createView() }, { binding: 8, resource: kit.sampler }, { binding: 9, resource: pool.createView() },
      ],
    }));
    pass.dispatchWorkgroups(gx, gy);
    pass.end();
  }
  // The previous overlay's textures are still read by the commands above; they are released with the garbage collector.
  target.fine = {
    indir: indirTex, pool, fineVoxel: fv, cells: tc, poolSize, bricks: count, indirData: indir,
    bytes: tc[0] * tc[1] * tc[2] * 4 + slabs * POOL_SLAB_BYTES,
    destroy() { indirTex.destroy(); pool.destroy(); },
  };
  if (!ownedFine.has(target)) {
    ownedFine.add(target);
    const destroy = target.destroy;
    target.destroy = () => { target.fine?.destroy(); destroy.call(target); };
  }
  return { position, yaw, bricks: count, added, rebuilt: job.size - added };
}

/** An empty region: no cloud, SDF = +maxDistance everywhere. A valid stamp target. Axes (x, map row, up). */
export function createEmptyCloudVolume(device: GPUDevice, dims: [number, number, number], voxelSize = 8, label = 'empty cloud region', maxDistance = 4096): GpuCloudVolume {
  const [w, h, d] = dims;
  const size: GPUExtent3D = { width: w, height: h, depthOrArrayLayers: d };
  const nvdf = device.createTexture({ label: `${label} nvdf`, dimension: '3d', format: 'rgba8unorm', size, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
  const sdf = device.createTexture({ label: `${label} sdf`, dimension: '3d', format: 'r16float', size, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
  // Outside a cloud the shipped assets hold G = B = 1.
  const nv = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { nv[i * 4 + 1] = 255; nv[i * 4 + 2] = 255; nv[i * 4 + 3] = 255; }
  // Largest finite half <= maxDistance (4096 m is exactly 0x6c00); values above 65504 are not representable.
  const far = Math.min(maxDistance, 65504);
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  f32[0] = far;
  const bits = u32[0];
  const e = ((bits >>> 23) & 0xff) - 127 + 15;
  const halfBits = (e << 10) | ((bits & 0x7fffff) >>> 13); // truncation never rounds up
  const sv = new Uint16Array(w * h).fill(halfBits);
  for (let z = 0; z < d; z++) {
    device.queue.writeTexture({ texture: nvdf, origin: { x: 0, y: 0, z } }, nv, { bytesPerRow: w * 4, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: 1 });
    device.queue.writeTexture({ texture: sdf, origin: { x: 0, y: 0, z } }, sv, { bytesPerRow: w * 2, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: 1 });
  }
  return { nvdf, sdf, dims: [w, h, d], voxelSize, extentMeters: [w * voxelSize, d * voxelSize, h * voxelSize], destroy() { nvdf.destroy(); sdf.destroy(); } };
}

export interface SdfRebuilderOptions {
  /** z slices per job. Default dims.z (one job per stage and step). */
  sliceDepth?: number;
  /** Conservative margin in voxels subtracted from |SDF|. Default 1 (as the generator). */
  marginVoxels?: number;
  /** Ignored: kept for API compatibility (the transform is an exact EDT, so sparse fields need no extra jump-flood rounds). */
  refinePasses?: 0 | 1 | 2;
  /** Ignored: kept for API compatibility (see `refinePasses`). */
  rounds?: number;
  maxDistance?: number;
  /** Share the generator's scratch buffer (the caller must not run both at once). */
  scratch?: GeneratorScratch;
  timestamps?: (label: string) => GPUComputePassTimestampWrites | undefined;
  label?: string;
}

export interface SdfRebuilder {
  readonly jobsTotal: number;
  readonly jobsDone: number;
  readonly done: boolean;
  readonly jobLabels: readonly string[];
  /** GPU memory held by this rebuilder: its parameter buffer, and the scratch field when it owns it (0 when shared). */
  readonly memoryBytes: { scratch: number; params: number; total: number };
  /** Start over (call after more stamps). */
  restart(): void;
  /** Encode up to `maxJobs` further jobs (default all). The target's SDF holds the old result until the last job's copy. */
  generate(encoder: GPUCommandEncoder, maxJobs?: number): { done: boolean; jobsEncoded: number; jobsDone: number; jobsTotal: number };
  destroy(): void;
}

const PARAM_STRIDE = 256;   // PARAM_BYTES: the generator's block (volume-generator.ts); only its first 9 words are filled here

/**
 * Rebuild `target.sdf` from `target.nvdf` (voxel is inside where profile > 0): occupancy, exact separable EDT (x, y, z) in one u16 field,
 * signed distance minus a conservative margin, the same passes as the generator (so it is conservative the same way). Whole volume.
 * Jobs are independent dispatches so they can be spread over frames; the SDF texture is only written by the final copies.
 */
export function createSdfRebuilder(device: GPUDevice, target: GpuCloudVolume, options: SdfRebuilderOptions = {}): SdfRebuilder {
  const [w, h, d] = target.dims;
  const label = options.label ?? 'stamp sdf';
  const margin = options.marginVoxels ?? 1, maxDist = options.maxDistance ?? 4096;
  const sliceDepth = Math.max(1, Math.min(d, options.sliceDepth ?? d));
  const C = GPUShaderStage.COMPUTE;
  const uniformEntry: GPUBindGroupLayoutEntry = { binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 32 } };
  const storage = (binding: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry => ({ binding, visibility: C, buffer: { type } });
  const make = (name: string, code: string, entryPoint: string, entries: GPUBindGroupLayoutEntry[]) => {
    const bgl = device.createBindGroupLayout({ label: name, entries });
    return { bgl, pipeline: device.createComputePipeline({ label: `${label} ${name}`, layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }), compute: { module: device.createShaderModule({ label: name, code }), entryPoint } }) };
  };
  const seedK = make('seed', SEED_WGSL, 'seedMain', [uniformEntry, { binding: 1, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } }, storage(2, 'storage')]);
  const fullUniform: GPUBindGroupLayoutEntry = { ...uniformEntry, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: PARAM_BYTES } };
  const edtX = make('edt-x', EDT_X_WGSL, 'edtX', [fullUniform, storage(1, 'storage')]);
  const edtY = make('edt-y', edtLineWGSL('y', h), 'edtLine', [fullUniform, storage(1, 'storage')]);
  const edtZ = make('edt-z', edtLineWGSL('z', d), 'edtLine', [fullUniform, storage(1, 'storage')]);
  const sdfK = make('sdf', SDF_WGSL, 'sdfMain', [fullUniform, storage(1, 'storage')]);

  const scratch = options.scratch ?? createGeneratorScratch(device, [w, h, d], label);
  if (scratch.dims[0] !== w || scratch.dims[1] !== h || scratch.dims[2] !== d) throw new Error('scratch dims differ from the volume dims');
  const ownsScratch = !options.scratch;
  const field = scratch.field;
  const rowBytes = Math.ceil(w * 2 / 256) * 256;
  const chunks: [number, number][] = [];
  for (let z = 0; z < d; z += sliceDepth) chunks.push([z, Math.min(sliceDepth, d - z)]);
  const ychunks = rangeChunks(h, chunks.length);

  const maxSlots = chunks.length * 5;
  const params = device.createBuffer({ label: `${label} params`, size: maxSlots * PARAM_STRIDE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uni: GPUBufferBinding = { buffer: params, size: PARAM_BYTES };
  const slots = new Uint8Array(maxSlots * PARAM_STRIDE);
  let nSlots = 0;
  const addSlot = (zStart: number, zCount: number, step: number): number => {
    const dv = new DataView(slots.buffer, nSlots * PARAM_STRIDE, PARAM_BYTES);
    dv.setUint32(0, w, true); dv.setUint32(4, h, true); dv.setUint32(8, d, true); dv.setInt32(12, step, true);
    dv.setUint32(16, zStart, true); dv.setUint32(20, zCount, true);
    dv.setFloat32(24, margin, true); dv.setFloat32(28, maxDist, true); dv.setFloat32(32, target.voxelSize, true);
    return nSlots++;
  };
  const fieldBG = (k: { bgl: GPUBindGroupLayout }) => device.createBindGroup({ label: 'edt', layout: k.bgl, entries: [{ binding: 0, resource: uni }, { binding: 1, resource: { buffer: field } }] });
  const seedBG = device.createBindGroup({ label: 'seed', layout: seedK.bgl, entries: [{ binding: 0, resource: { buffer: params, size: 32 } }, { binding: 1, resource: target.nvdf.createView({ dimension: '3d' }) }, { binding: 2, resource: { buffer: field } }] });
  const bgX = fieldBG(edtX), bgY = fieldBG(edtY), bgZ = fieldBG(edtZ), sdfBG = fieldBG(sdfK);

  type Job = { label: string; pipeline: GPUComputePipeline; bind: GPUBindGroup; slot: number; groups: [number, number, number]; copy?: { z0: number; n: number } };
  const jobs: Job[] = [];
  const lines = (n: number) => Math.ceil(n / 64);
  for (const [z0, n] of chunks) jobs.push({ label: 'seed', pipeline: seedK.pipeline, bind: seedBG, slot: addSlot(z0, n, 0), groups: [Math.ceil(w / 16), Math.ceil(h / 8), Math.ceil(n / 4)] });
  for (const [z0, n] of chunks) jobs.push({ label: 'edt-x', pipeline: edtX.pipeline, bind: bgX, slot: addSlot(z0, n, 0), groups: [lines(h * n), 1, 1] });
  for (const [z0, n] of chunks) jobs.push({ label: 'edt-y', pipeline: edtY.pipeline, bind: bgY, slot: addSlot(z0, n, 0), groups: [lines(w * n), 1, 1] });
  for (const [y0, n] of ychunks) jobs.push({ label: 'edt-z', pipeline: edtZ.pipeline, bind: bgZ, slot: addSlot(y0, n, 0), groups: [lines(w * n), 1, 1] });
  for (const [z0, n] of chunks) jobs.push({ label: 'sdf', pipeline: sdfK.pipeline, bind: sdfBG, slot: addSlot(z0, n, 0), groups: [Math.ceil(w / 16), Math.ceil(h / 8), Math.ceil(n / 4)], copy: { z0, n } });
  device.queue.writeBuffer(params, 0, slots.subarray(0, nSlots * PARAM_STRIDE));

  let cursor = 0, destroyed = false;
  return {
    get jobsTotal() { return jobs.length; },
    get jobsDone() { return cursor; },
    get done() { return cursor >= jobs.length; },
    jobLabels: jobs.map(j => j.label),
    memoryBytes: { scratch: ownsScratch ? scratch.bytes : 0, params: maxSlots * PARAM_STRIDE, total: (ownsScratch ? scratch.bytes : 0) + maxSlots * PARAM_STRIDE },
    restart() { cursor = 0; },
    generate(encoder, maxJobs = Infinity) {
      let n = 0;
      while (cursor < jobs.length && n < maxJobs) {
        const j = jobs[cursor++]; n++;
        const pass = encoder.beginComputePass({ label: `${label} ${j.label}`, timestampWrites: options.timestamps?.(j.label) });
        pass.setPipeline(j.pipeline);
        pass.setBindGroup(0, j.bind, [j.slot * PARAM_STRIDE]);
        pass.dispatchWorkgroups(...j.groups);
        pass.end();
        if (j.copy) encoder.copyBufferToTexture({ buffer: field, offset: j.copy.z0 * rowBytes * h, bytesPerRow: rowBytes, rowsPerImage: h }, { texture: target.sdf, origin: { x: 0, y: 0, z: j.copy.z0 } }, { width: w, height: h, depthOrArrayLayers: j.copy.n });
      }
      return { done: cursor >= jobs.length, jobsEncoded: n, jobsDone: cursor, jobsTotal: jobs.length };
    },
    destroy() { if (destroyed) return; destroyed = true; params.destroy(); if (ownsScratch) scratch.destroy(); },
  };
}
