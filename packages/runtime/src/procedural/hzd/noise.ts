// H1 (S2): bake the HZD noise set (procedural/hzd/noise.wgsl.ts) on the GPU. One-off at load: about 2 M shape texels, a few ms on a desktop GPU.
import { hzdMipWgsl, hzdNoiseBakeWgsl, HZD_CURL_BAKE_WGSL } from './noise.wgsl';

export interface HzdNoiseOptions {
  /** 'rgba8unorm' (default: HZD shipped RGBA8, n3.md §7b) or 'rgba16float' (the SD8 variant: no 8-bit banding in the remap chain). */
  format?: 'rgba8unorm' | 'rgba16float';
  seed?: number;
  /** Edge lengths (defaults 128 / 32 / 128, as HZD 2015 s31-33). Powers of two. */
  shapeSize?: number;
  detailSize?: number;
  curlSize?: number;
  /** H5 (ours): scale of the R channel's coarse carving remaps (10, 20 cells) and fine dilating remaps (85, 165 cells), 1 = the Nubis tool;
   *  and the smooth-min width of R's Worley terms (0 = hard F1 as the tool). */
  carve?: number;
  fine?: number;
  smooth?: number;
  /** H5 (ours): sub-samples per texel edge of the shape bake (1 = point sampled as the tool; 2 = a 2x2x2 box prefilter against aliasing). */
  supersample?: number;
  /** Extra usage (e.g. COPY_SRC for a debug read-back). */
  usage?: number;
}
export interface HzdNoise {
  /** 128^3 RGBA: R Perlin-Worley, G/B/A Worley fBMs (gains 1, 1.7, 2.3). Full mip chain. */
  shape: GPUTexture;
  /** 32^3 RGBA: R/G/B Worley fBMs of rising frequency, A = 1. Full mip chain. */
  detail: GPUTexture;
  /** 128^2 rgba16float: the curl vector (signed, about +-1), A = 1. */
  curl: GPUTexture;
  format: GPUTextureFormat;
  /** The options the set was baked with (format, carve, fine, smooth): a different key re-bakes. */
  key: string;
  destroy(): void;
}

/** The re-bake key of a set of options. */
export const hzdNoiseKey = (o: HzdNoiseOptions) => [o.format ?? 'rgba8unorm', o.seed ?? 1, o.carve ?? 1, o.fine ?? 1, o.smooth ?? 0, o.supersample ?? 1].join(',');

const mipCount = (n: number) => Math.floor(Math.log2(n)) + 1;

export function bakeHzdNoise(device: GPUDevice, o: HzdNoiseOptions = {}): HzdNoise {
  const format = o.format ?? 'rgba8unorm';
  const seed = o.seed ?? 1;
  const extra = o.usage ?? 0;
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | extra;
  const make3d = (label: string, n: number) => device.createTexture({ label, dimension: '3d', size: [n, n, n], mipLevelCount: mipCount(n), format, usage });
  const shapeSize = o.shapeSize ?? 128, detailSize = o.detailSize ?? 32, curlSize = o.curlSize ?? 128;
  const shape = make3d('hzd noise shape', shapeSize);
  const detail = make3d('hzd noise detail', detailSize);
  const curl = device.createTexture({ label: 'hzd noise curl', size: [curlSize, curlSize], format: 'rgba16float', usage });

  const bake = device.createShaderModule({ label: 'hzd noise bake', code: hzdNoiseBakeWgsl(format) });
  const curlModule = device.createShaderModule({ label: 'hzd curl bake', code: HZD_CURL_BAKE_WGSL });
  const mipModule = device.createShaderModule({ label: 'hzd noise mip', code: hzdMipWgsl(format) });
  const pipe = (module: GPUShaderModule, entryPoint: string) => device.createComputePipeline({ label: `hzd ${entryPoint}`, layout: 'auto', compute: { module, entryPoint } });
  const shapeP = pipe(bake, 'shape'), detailP = pipe(bake, 'detail'), curlP = pipe(curlModule, 'curl'), mipP = pipe(mipModule, 'mip');

  const buffers: GPUBuffer[] = [];
  const params = (size: number) => {
    const b = device.createBuffer({ label: 'hzd bake params', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const data = new ArrayBuffer(32);
    new Uint32Array(data, 0, 2).set([seed, size]);
    new Float32Array(data, 8, 3).set([o.carve ?? 1, o.fine ?? 1, o.smooth ?? 0]);
    new Uint32Array(data, 20, 1).set([Math.max(1, Math.round(o.supersample ?? 1))]);
    device.queue.writeBuffer(b, 0, data);
    buffers.push(b);
    return b;
  };
  const enc = device.createCommandEncoder({ label: 'hzd noise bake' });
  const run = (p: GPUComputePipeline, buffer: GPUBuffer, view: GPUTextureView, groups: [number, number, number]) => {
    const pass = enc.beginComputePass({ label: p.label });
    pass.setPipeline(p);
    pass.setBindGroup(0, device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: view }] }));
    pass.dispatchWorkgroups(...groups);
    pass.end();
  };
  run(shapeP, params(shapeSize), shape.createView({ baseMipLevel: 0, mipLevelCount: 1 }), [shapeSize / 4, shapeSize / 4, shapeSize / 4]);
  run(detailP, params(detailSize), detail.createView({ baseMipLevel: 0, mipLevelCount: 1 }), [detailSize / 4, detailSize / 4, detailSize / 4]);
  run(curlP, params(curlSize), curl.createView(), [Math.ceil(curlSize / 8), Math.ceil(curlSize / 8), 1]);
  for (const tex of [shape, detail]) {
    for (let m = 1; m < tex.mipLevelCount; m++) {
      const n = Math.max(1, tex.width >> m);
      const pass = enc.beginComputePass({ label: 'hzd noise mip' });
      pass.setPipeline(mipP);
      pass.setBindGroup(0, device.createBindGroup({ layout: mipP.getBindGroupLayout(0), entries: [
        { binding: 0, resource: tex.createView({ baseMipLevel: m - 1, mipLevelCount: 1 }) },
        { binding: 1, resource: tex.createView({ baseMipLevel: m, mipLevelCount: 1 }) },
      ] }));
      pass.dispatchWorkgroups(Math.ceil(n / 4), Math.ceil(n / 4), Math.ceil(n / 4));
      pass.end();
    }
  }
  device.queue.submit([enc.finish()]);
  void device.queue.onSubmittedWorkDone().then(() => { for (const b of buffers) b.destroy(); });
  return { shape, detail, curl, format, key: hzdNoiseKey(o), destroy() { shape.destroy(); detail.destroy(); curl.destroy(); } };
}
