import { WEATHER_WGSL } from './shaders';

export interface ProceduralWeatherOptions {
  /** Map size in pixels. Match the volume's (x, map row) dims for 1:1 sampling. */
  size: [number, number];
  seed?: number;
  /** fBm frequency across the whole map. Default 4. */
  scale?: number;
  /** Coverage ramps from 0 at `coverageLo` to 1 at `coverageHi` of the fBm value. Defaults 0.42 / 0.8 (a wide ramp: coverage stays a smooth, peaked field). */
  coverageLo?: number;
  coverageHi?: number;
  /** Width (fraction of the map) of the fade to zero at the borders. Default 0.08. */
  border?: number;
  /** 0..1: blend from plain fBm (0) to one dome per Worley cell (1). Default 0. */
  cellular?: number;
  /** Worley cells across the map when `cellular` > 0. Default 6. */
  cellScale?: number;
}

const pipelines = new WeakMap<GPUDevice, GPUComputePipeline>();

/**
 * Encode a procedural weather map: rgba8unorm, R coverage, G cloud type (0 wispy/stratiform .. 1 billowy/cumuliform),
 * B base height, A top height (both fractions of the volume height). fBm for coverage and heights, Worley for type.
 * The caller submits the encoder. The result is usable as `weather` for createVolumeGenerator.
 */
export function encodeProceduralWeatherMap(device: GPUDevice, encoder: GPUCommandEncoder, options: ProceduralWeatherOptions): GPUTexture {
  const [w, h] = options.size;
  let pipeline = pipelines.get(device);
  if (!pipeline) {
    pipeline = device.createComputePipeline({
      label: 'weather map', layout: 'auto',
      compute: { module: device.createShaderModule({ label: 'weather map', code: WEATHER_WGSL }), entryPoint: 'weatherMain' },
    });
    pipelines.set(device, pipeline);
  }
  const texture = device.createTexture({
    label: 'weather map', size: { width: w, height: h }, format: 'rgba8unorm',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
  });
  const data = new ArrayBuffer(48);
  const u = new Uint32Array(data), f = new Float32Array(data);
  u[0] = w; u[1] = h;
  f[2] = options.seed ?? 1; f[3] = options.scale ?? 4;
  f[4] = options.coverageLo ?? 0.42; f[5] = options.coverageHi ?? 0.8; f[6] = options.border ?? 0.08; f[7] = options.cellular ?? 0; f[8] = options.cellScale ?? 6;
  const uniforms = device.createBuffer({ label: 'weather params', size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniforms, 0, data);
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: texture.createView() }],
  });
  const pass = encoder.beginComputePass({ label: 'weather map' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
  pass.end();
  // The uniform buffer is only read by this pass; destroy after submission completes.
  device.queue.onSubmittedWorkDone().then(() => uniforms.destroy(), () => {});
  return texture;
}
