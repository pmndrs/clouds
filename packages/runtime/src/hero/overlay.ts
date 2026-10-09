import { BRICK_TEXELS, POOL_SLAB_BRICKS, POOL_SLAB_BYTES, POOL_XY, type FineBricks, type FineProfileBricks } from './bricks';

/** A fine hero overlay on the GPU (work/specs/P8-hero-vdb.md section 4.1), bound with its volume as `GpuCloudVolume.fine`. */
export interface GpuFineOverlay {
  /** r32uint 3D, one texel per 8^3 fine voxels (texture axes x, map row, up): brick slot or 0xffffffff. */
  indir: GPUTexture;
  /** rgba8unorm 3D, [320, 320, 10 * slabs]: bricks of 10^3 texels (8^3 payload + apron). */
  pool: GPUTexture;
  /** Fine voxel size in metres. */
  fineVoxel: number;
  cells: [number, number, number];
  /** Pool texture size in texels. */
  poolSize: [number, number, number];
  bricks: number;
  /** GPU bytes of the pool and the indirection. */
  bytes: number;
  /** P13-H3: a CPU copy of the indirection (cell -> slot), read by the fine stamp to find the hero's bricks. */
  indirData?: Uint32Array;
  destroy(): void;
}

const USAGE = () => GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;

function createOverlay(device: GPUDevice, cells: [number, number, number], indirData: Uint32Array<ArrayBuffer>, count: number, fineVoxel: number, label: string, storage: boolean): GpuFineOverlay {
  const [cx, cy, cz] = cells;
  const indir = device.createTexture({ label: `${label} indirection`, dimension: '3d', format: 'r32uint', size: cells, usage: USAGE() });
  device.queue.writeTexture({ texture: indir }, indirData, { bytesPerRow: cx * 4, rowsPerImage: cy }, cells);
  const slabs = Math.max(1, Math.ceil(count / POOL_SLAB_BRICKS));
  const poolSize: [number, number, number] = [POOL_XY, POOL_XY, BRICK_TEXELS * slabs];
  const pool = device.createTexture({ label: `${label} brick pool`, dimension: '3d', format: 'rgba8unorm', size: poolSize, usage: USAGE() | (storage ? GPUTextureUsage.STORAGE_BINDING : 0) });
  return {
    indir, pool, fineVoxel, cells: [cx, cy, cz], poolSize, bricks: count, indirData,
    bytes: cx * cy * cz * 4 + slabs * POOL_SLAB_BYTES,
    destroy() { indir.destroy(); pool.destroy(); },
  };
}

/** Upload packed bricks: one writeTexture per 4 MB slab plus the indirection grid. The caller owns the result. */
export function uploadFineBricks(device: GPUDevice, b: FineBricks, label = 'hero'): GpuFineOverlay {
  const o = createOverlay(device, b.cells, b.indir, b.count, b.fineVoxel, label, false);
  b.slabs.forEach((slab, i) => device.queue.writeTexture({ texture: o.pool, origin: [0, 0, i * BRICK_TEXELS] }, slab, { bytesPerRow: POOL_XY * 4, rowsPerImage: POOL_XY }, [POOL_XY, POOL_XY, BRICK_TEXELS]));
  return o;
}

// One thread per brick texel: R from the packed profile bytes, G and B from the coarse NVDF (hardware trilinear at the fine texel centre,
// the lattice clamped at its faces like the profile), written into the pool.
const FILL_WGSL = /* wgsl */ `
struct P { cells: vec4<u32>, fdims: vec4<u32>, inv: vec4<f32> }
@group(0) @binding(0) var<uniform> P0: P;
@group(0) @binding(1) var<storage, read> prof: array<u32>;
@group(0) @binding(2) var<storage, read> cellOf: array<u32>;
@group(0) @binding(3) var coarse: texture_3d<f32>;
@group(0) @binding(4) var smp: sampler;
@group(0) @binding(5) var pool: texture_storage_3d<rgba8unorm, write>;
@compute @workgroup_size(64)
fn fillMain(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let i = (wg.y * P0.fdims.w + wg.x) * 64u + li;
  if (i >= P0.cells.w * 1000u) { return; }
  let s = i / 1000u;
  let t = i % 1000u;
  let tt = vec3<u32>(t % 10u, (t / 10u) % 10u, t / 100u);
  let c = cellOf[s];
  let cell = vec3<u32>(c % P0.cells.x, (c / P0.cells.x) % P0.cells.y, c / (P0.cells.x * P0.cells.y));
  let f = clamp(vec3<i32>(cell * 8u + tt) - 1, vec3<i32>(0), vec3<i32>(P0.fdims.xyz) - 1);
  let gb = textureSampleLevel(coarse, smp, (vec3<f32>(f) + 0.5) * P0.inv.xyz, 0.0);
  let r = f32((prof[i >> 2u] >> ((i & 3u) * 8u)) & 255u) / 255.0;
  textureStore(pool, vec3<u32>(s % 32u, (s / 32u) % 32u, s / 1024u) * 10u + tt, vec4<f32>(r, gb.g, gb.b, 1.0));
}
`;

const fillKits = new WeakMap<GPUDevice, { pipeline: GPUComputePipeline; sampler: GPUSampler }>();

/**
 * Upload R-only bricks (P13-H3, the loaders' path) over a coarse volume whose NVDF is `coarse` (dims `coarseDims`, voxel = ratio x the fine
 * voxel, same min corner): the indirection, then one compute pass that writes R and the coarse G/B into the pool. Submits its own command
 * buffer (setup work, never on the frame path). The caller owns the result.
 */
export function uploadFineProfile(device: GPUDevice, b: FineProfileBricks, coarse: GPUTexture, coarseDims: readonly [number, number, number], label = 'hero'): GpuFineOverlay {
  const o = createOverlay(device, b.cells, b.indir, b.count, b.fineVoxel, label, true);
  if (!b.count) return o;
  let kit = fillKits.get(device);
  if (!kit) {
    kit = {
      pipeline: device.createComputePipeline({ label: 'hero brick fill', layout: 'auto', compute: { module: device.createShaderModule({ label: 'hero brick fill', code: FILL_WGSL }), entryPoint: 'fillMain' } }),
      sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }),
    };
    fillKits.set(device, kit);
  }
  const total = b.count * 1000, groups = Math.ceil(total / 64), gx = Math.min(groups, 65535), gy = Math.ceil(groups / gx);
  const ratio = coarseDims.map((d, i) => b.dims[i] / d);
  const params = new ArrayBuffer(48);
  new Uint32Array(params, 0, 8).set([...b.cells, b.count, ...b.dims, gx]);
  new Float32Array(params, 32, 3).set(coarseDims.map((d, i) => 1 / (ratio[i] * d)));
  // Every source is a multiple of 4 bytes (1,000 bytes per brick).
  const buffer = (data: ArrayBufferView<ArrayBuffer>, usage: number) => {
    const buf = device.createBuffer({ label: `${label} fill`, size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buf, 0, data);
    return buf;
  };
  const uni = buffer(new Uint8Array(params), GPUBufferUsage.UNIFORM);
  const prof = buffer(b.profile, GPUBufferUsage.STORAGE), cells = buffer(b.cellOf, GPUBufferUsage.STORAGE);
  const encoder = device.createCommandEncoder({ label: `${label} fill` });
  const pass = encoder.beginComputePass({ label: `${label} brick fill` });
  pass.setPipeline(kit.pipeline);
  pass.setBindGroup(0, device.createBindGroup({
    layout: kit.pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: uni } }, { binding: 1, resource: { buffer: prof } }, { binding: 2, resource: { buffer: cells } },
      { binding: 3, resource: coarse.createView({ dimension: '3d' }) }, { binding: 4, resource: kit.sampler }, { binding: 5, resource: o.pool.createView() },
    ],
  }));
  pass.dispatchWorkgroups(gx, gy);
  pass.end();
  device.queue.submit([encoder.finish()]);
  uni.destroy(); prof.destroy(); cells.destroy();
  return o;
}
