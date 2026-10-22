/**
 * PF1: the HZD weather map's bounds grid (empty-space skipping). One compute pass reads the NDF (the served map: generated, painted, uploaded or a
 * weather-state lerp) and writes, for each of HZD_BOUNDS_GRID^2 cells of one map tile, the largest coverage and the lowest base and highest top
 * height over the cell's texels, the bilinear neighbours the trace's filtered reads can reach (and one more for rounding) and a margin of
 * `margin` texels (the fractus trail looks upwind for a body). The words go into the profile-table buffer after the tables (shaper.wgsl.ts); the
 * trace's `procCellIsEmpty` reads them. The pass costs one load of the map (about 0.05 ms at 1024^2); the model re-runs it when the map changes.
 */
import { HZD_BOUNDS_GRID, HZD_LUT_WORDS } from './shaper.wgsl';

const BOUNDS_WGSL = /* wgsl */ `
struct U { grid: u32, lutWords: u32, margin: i32, pad: u32 }
@group(0) @binding(0) var ndf: texture_2d_array<f32>;
@group(0) @binding(1) var<storage, read_write> out: array<u32>;
@group(0) @binding(2) var<uniform> Q: U;
fn byteOf(v: f32) -> u32 { return u32(clamp(round(v * 255.0), 0.0, 255.0)); }
@compute @workgroup_size(8, 8)
fn bounds(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= Q.grid || id.y >= Q.grid) { return; }
  let size = vec2<i32>(textureDimensions(ndf));
  let g = i32(Q.grid);
  let lo = (vec2<i32>(id.xy) * size) / g - vec2(2 + Q.margin);
  let hi = ((vec2<i32>(id.xy) + vec2(1)) * size + vec2(g - 1)) / g + vec2(1 + Q.margin);
  var maxCov = 0u; var minH = 255u; var maxH = 0u;
  for (var y = lo.y; y <= hi.y; y++) {
    for (var x = lo.x; x <= hi.x; x++) {
      let c = ((vec2(x, y) % size) + size) % size;
      let a = textureLoad(ndf, c, 0, 0);
      let b = textureLoad(ndf, c, 1, 0);
      maxCov = max(maxCov, byteOf(a.r));
      minH = min(minH, byteOf(b.r));
      maxH = max(maxH, byteOf(b.g));
    }
  }
  out[Q.lutWords + id.y * Q.grid + id.x] = maxCov | (minH << 8u) | (maxH << 16u);
}
`;

export interface HzdBounds {
  /** Recompute the grid from `ndf` (a 2-layer 2D array: coverage in layer 0 R, min / max height in layer 1 R / G) into `lut`'s bounds words. */
  run(ndf: GPUTexture, lut: GPUBuffer, marginTexels: number): void;
  dispose(): void;
}

export function createHzdBounds(device: GPUDevice): HzdBounds {
  let pipeline: GPUComputePipeline | null = null;
  const uniform = device.createBuffer({ label: 'hzd bounds', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  return {
    run(ndf, lut, marginTexels) {
      pipeline ??= device.createComputePipeline({ label: 'hzd bounds', layout: 'auto', compute: { module: device.createShaderModule({ label: 'hzd bounds', code: BOUNDS_WGSL }), entryPoint: 'bounds' } });
      device.queue.writeBuffer(uniform, 0, new Int32Array([HZD_BOUNDS_GRID, HZD_LUT_WORDS, Math.max(0, Math.round(marginTexels)), 0]));
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: ndf.createView({ dimension: '2d-array' }) },
        { binding: 1, resource: { buffer: lut } },
        { binding: 2, resource: { buffer: uniform } },
      ] });
      const encoder = device.createCommandEncoder({ label: 'hzd bounds' });
      const pass = encoder.beginComputePass({ label: 'hzd bounds' });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(HZD_BOUNDS_GRID / 8, HZD_BOUNDS_GRID / 8);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    dispose() { uniform.destroy(); },
  };
}

/** CPU mirror of the pass for one cell (tests): the same footprint and the same bytes. `cov`, `minH`, `maxH` are size^2 byte arrays. */
export function hzdBoundsCell(size: number, cov: Uint8Array, minH: Uint8Array, maxH: Uint8Array, cx: number, cy: number, margin = 0): [number, number, number] {
  const g = HZD_BOUNDS_GRID;
  let c = 0, lo = 255, hi = 0;
  const x0 = Math.trunc(cx * size / g) - 2 - margin, x1 = Math.trunc(((cx + 1) * size + g - 1) / g) + 1 + margin;
  const y0 = Math.trunc(cy * size / g) - 2 - margin, y1 = Math.trunc(((cy + 1) * size + g - 1) / g) + 1 + margin;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (((y % size) + size) % size) * size + (((x % size) + size) % size);
    c = Math.max(c, cov[i]); lo = Math.min(lo, minH[i]); hi = Math.max(hi, maxH[i]);
  }
  return [c, lo, hi];
}
