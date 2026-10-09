// X1: the noise and weather textures of the two procedural shapers. Nothing here is shipped with the runtime: the page passes URLs.
//   Sky Pro: baseShape64.bin (gzip, 'NZZ1' header, 64^3 RGBA8 Perlin-Worley with mips; tidewater/public/clouds, MIT, DRG Software Solutions LLC),
//            and the weather map baked here with Sky Pro's own kernels (periodic Perlin fbm, then the 64^2 maxima for the empty-cell skip).
//   Takram:  shape.bin (128^3 R8), shape_detail.bin (32^3 R8), local_weather.png (512^2 RGBA), turbulence.png (128^2 RGBA) from
//            @takram/three-clouds/assets (MIT, Copyright (c) 2024 Shota Matsuda).
import type { SkyProShape } from './settings';

async function fetchOk(url: string): Promise<Response> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`procedural clouds: ${url} HTTP ${r.status}`);
  return r;
}

/** Sky Pro's baked 64^3 shape noise (SkyProClouds.js _loadNoise): gzip'd, 16 byte header ('NZZ1', version, channels, dims, mip count) + RGBA8 mips. */
export async function loadSkyProNoise(device: GPUDevice, url: string): Promise<GPUTexture> {
  const res = await fetchOk(url);
  const data = new Uint8Array(await new Response(res.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== 0x315a5a4e) throw new Error('procedural clouds: bad Sky Pro noise blob');
  const dims = [view.getUint16(6, true), view.getUint16(8, true), view.getUint16(10, true)];
  const mips = view.getUint8(12);
  const tex = device.createTexture({ label: 'proc skypro noise', dimension: '3d', size: dims, mipLevelCount: mips, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  let offset = 16;
  for (let m = 0; m < mips; m++) {
    const d = dims.map(x => Math.max(1, x >> m));
    device.queue.writeTexture({ texture: tex, mipLevel: m }, data, { offset, bytesPerRow: d[0] * 4, rowsPerImage: d[1] }, d);
    offset += d[0] * d[1] * d[2] * 4;
  }
  return tex;
}

async function loadRaw3d(device: GPUDevice, url: string, size: number, label: string): Promise<GPUTexture> {
  const data = new Uint8Array(await (await fetchOk(url)).arrayBuffer());
  if (data.byteLength !== size ** 3) throw new Error(`procedural clouds: ${url} is ${data.byteLength} bytes, expected ${size ** 3}`);
  const tex = device.createTexture({ label, dimension: '3d', size: [size, size, size], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: tex }, data, { bytesPerRow: size, rowsPerImage: size }, [size, size, size]);
  return tex;
}

async function loadPng(device: GPUDevice, url: string, label: string): Promise<GPUTexture> {
  const blob = await (await fetchOk(url)).blob();
  // The channels are data (one coverage per layer, a displacement): no premultiplication, no colour conversion.
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const tex = device.createTexture({ label, size: [bitmap.width, bitmap.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex, premultipliedAlpha: false }, [bitmap.width, bitmap.height]);
  bitmap.close();
  return tex;
}

export interface TakramTextureUrls { shape: string; shapeDetail: string; localWeather: string; turbulence: string }
export interface TakramTextures { shape: GPUTexture; shapeDetail: GPUTexture; localWeather: GPUTexture; turbulence: GPUTexture }
export async function loadTakramTextures(device: GPUDevice, urls: TakramTextureUrls): Promise<TakramTextures> {
  const [shape, shapeDetail, localWeather, turbulence] = await Promise.all([
    loadRaw3d(device, urls.shape, 128, 'proc takram shape'), loadRaw3d(device, urls.shapeDetail, 32, 'proc takram shape detail'),
    loadPng(device, urls.localWeather, 'proc takram local weather'), loadPng(device, urls.turbulence, 'proc takram turbulence'),
  ]);
  return { shape, shapeDetail, localWeather, turbulence };
}

// Sky Pro weather.wgsl (procedural fbm coverage) and weather-bounds.wgsl, as in SkyProClouds.js WEATHER_WGSL and _buildKernels.
// MIT, Copyright (c) 2026 DRG Software Solutions LLC.
const WEATHER_WGSL = /* wgsl */ `
struct WeatherParams { mass: vec4<f32>, detail: vec4<f32>, weather: vec4<f32> }
@group(0) @binding(0) var<uniform> W: WeatherParams;
@group(0) @binding(1) var outMap: texture_storage_2d<rgba8unorm, write>;
fn scHash33(cell: vec3<u32>) -> vec3<u32> {
  var p = cell * 1664525u + 1013904223u;
  p.x += p.y * p.z; p.y += p.z * p.x; p.z += p.x * p.y;
  p = p ^ (p >> vec3<u32>(16u));
  p.x += p.y * p.z; p.y += p.z * p.x; p.z += p.x * p.y;
  return p;
}
fn scGradient(cell: vec3<i32>, period: i32, offset: vec3<f32>) -> f32 {
  let wrapped = vec3<u32>(((cell % vec3<i32>(period)) + vec3<i32>(period)) % vec3<i32>(period));
  let h = (scHash33(wrapped).x >> 24u) & 15u;
  let u = select(offset.y, offset.x, h < 8u);
  let v = select(select(offset.z, offset.x, h == 12u || h == 14u), offset.y, h < 4u);
  return select(-u, u, (h & 1u) == 0u) + select(-v, v, (h & 2u) == 0u);
}
fn scPerlin(p: vec3<f32>, period: i32) -> f32 {
  let cell = vec3<i32>(floor(p)); let fr = fract(p); let w = fr * fr * fr * (fr * (fr * 6.0 - 15.0) + 10.0);
  return mix(mix(mix(scGradient(cell, period, fr), scGradient(cell + vec3<i32>(1, 0, 0), period, fr - vec3(1.0, 0.0, 0.0)), w.x),
    mix(scGradient(cell + vec3<i32>(0, 1, 0), period, fr - vec3(0.0, 1.0, 0.0)), scGradient(cell + vec3<i32>(1, 1, 0), period, fr - vec3(1.0, 1.0, 0.0)), w.x), w.y),
    mix(mix(scGradient(cell + vec3<i32>(0, 0, 1), period, fr - vec3(0.0, 0.0, 1.0)), scGradient(cell + vec3<i32>(1, 0, 1), period, fr - vec3(1.0, 0.0, 1.0)), w.x),
    mix(scGradient(cell + vec3<i32>(0, 1, 1), period, fr - vec3(0.0, 1.0, 1.0)), scGradient(cell + vec3<i32>(1, 1, 1), period, fr - vec3(1.0, 1.0, 1.0)), w.x), w.y), w.z);
}
fn scFbm(uv: vec2<f32>, profile: vec4<f32>) -> f32 {
  var frequency = max(1.0, round(profile.x)); var weight = 0.5;
  var sum = 0.0; var weights = 0.0;
  for (var i = 0u; i < u32(profile.y); i++) {
    sum += scPerlin(vec3(uv, profile.z * 13.37 + 0.5) * frequency, i32(frequency)) * weight;
    weights += weight; weight *= 0.5; frequency *= 2.0;
  }
  return sum / max(weights, 0.001) * 0.5 + 0.5;
}
@compute @workgroup_size(8, 8)
fn weather(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(outMap);
  if (any(id.xy >= size)) { return; }
  let uv = vec2<f32>(id.xy) / vec2<f32>(size);
  let mass = clamp((scFbm(uv, W.mass) - 0.5) * W.mass.w + 0.5, 0.0, 1.0);
  let detail = (scFbm(uv, W.detail) * 2.0 - 1.0) * W.detail.w;
  textureStore(outMap, id.xy, vec4(clamp(mass + detail + W.weather.x - 0.5, 0.0, 1.0), 0.0, 0.0, 1.0));
}
`;
const BOUNDS_WGSL = /* wgsl */ `
@group(0) @binding(0) var srcMap: texture_2d<f32>;
@group(0) @binding(1) var outMap: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(8, 8)
fn bounds(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(outMap);
  if (any(id.xy >= size)) { return; }
  let sourceSize = vec2<i32>(textureDimensions(srcMap));
  let scale = vec2<f32>(sourceSize) / vec2<f32>(size);
  // both bilinear neighbours at cell boundaries, including the repeat seam
  let lo = vec2<i32>(floor(vec2<f32>(id.xy) * scale - 0.5));
  let hi = vec2<i32>(ceil(vec2<f32>(id.xy + 1u) * scale - 0.5));
  var maximum = 0.0;
  for (var y = lo.y; y <= hi.y; y++) {
    for (var x = lo.x; x <= hi.x; x++) {
      let p = ((vec2<i32>(x, y) % sourceSize) + sourceSize) % sourceSize;
      maximum = max(maximum, textureLoad(srcMap, p, 0).r);
    }
  }
  textureStore(outMap, id.xy, vec4(min(1.0, maximum + 1.0 / 255.0), 0.0, 0.0, 1.0));
}
`;

export interface SkyProWeather { map: GPUTexture; bounds: GPUTexture; key: string }
/** Bake Sky Pro's weather map (resolution^2) and its 64^2 maxima. One-off (on load or when the weather settings change), about 1 ms. */
export function bakeSkyProWeather(device: GPUDevice, s: SkyProShape): SkyProWeather {
  const res = s.weatherResolution;
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;
  const map = device.createTexture({ label: 'proc skypro weather', size: [res, res], format: 'rgba8unorm', usage });
  const bounds = device.createTexture({ label: 'proc skypro weather bounds', size: [64, 64], format: 'rgba8unorm', usage });
  const ubuf = device.createBuffer({ label: 'proc skypro weather params', size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ubuf, 0, new Float32Array([...s.weatherMass, ...s.weatherDetail, s.weatherCoverage, 0, 0, 0]));
  const wp = device.createComputePipeline({ label: 'proc skypro weather', layout: 'auto', compute: { module: device.createShaderModule({ label: 'proc skypro weather', code: WEATHER_WGSL }), entryPoint: 'weather' } });
  const bp = device.createComputePipeline({ label: 'proc skypro weather bounds', layout: 'auto', compute: { module: device.createShaderModule({ label: 'proc skypro weather bounds', code: BOUNDS_WGSL }), entryPoint: 'bounds' } });
  const enc = device.createCommandEncoder({ label: 'proc skypro weather' });
  const pass = enc.beginComputePass({ label: 'proc skypro weather' });
  pass.setPipeline(wp);
  pass.setBindGroup(0, device.createBindGroup({ layout: wp.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: map.createView() }] }));
  pass.dispatchWorkgroups(Math.ceil(res / 8), Math.ceil(res / 8));
  pass.end();
  const pass2 = enc.beginComputePass({ label: 'proc skypro weather bounds' });
  pass2.setPipeline(bp);
  pass2.setBindGroup(0, device.createBindGroup({ layout: bp.getBindGroupLayout(0), entries: [{ binding: 0, resource: map.createView() }, { binding: 1, resource: bounds.createView() }] }));
  pass2.dispatchWorkgroups(8, 8);
  pass2.end();
  device.queue.submit([enc.finish()]);
  ubuf.destroy();
  return { map, bounds, key: skyProWeatherKey(s) };
}
export const skyProWeatherKey = (s: SkyProShape) => [...s.weatherMass, ...s.weatherDetail, s.weatherCoverage, s.weatherResolution].join(',');
