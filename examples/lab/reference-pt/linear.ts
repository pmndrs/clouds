// P0.3: linear (scene-referred) readbacks for the reference page, so frames compare before ACES + sRGB.
//  - readRgba16f: an rgba16float texture (the runtime's composite output, the scene's HDR target) to float32 RGBA, row 0 = top.
//  - composite: what three-bridge's quad computes before three's tone mapping: scene.rgb * cloud.a + cloud.rgb.
//  - LinearStore: holds the last frame for capture.mjs, which pulls it out over CDP in base64 chunks (a 1600x900 RGBA f32 frame is 23 MB).

const halfTable = (() => {
  const t = new Float32Array(65536);
  for (let b = 0; b < 65536; b++) {
    const e = (b >> 10) & 31, m = b & 1023, s = b >> 15 ? -1 : 1;
    t[b] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return t;
})();

/** Reads an rgba16float texture (COPY_SRC) back as float32 RGBA, w * h * 4, row 0 = the texture's first row (the top of the frame). */
export async function readRgba16f(device: GPUDevice, texture: GPUTexture): Promise<{ width: number; height: number; data: Float32Array }> {
  if (texture.format !== 'rgba16float') throw new Error(`readRgba16f: ${texture.label || 'texture'} is ${texture.format}`);
  const w = texture.width, h = texture.height, bpr = Math.ceil((w * 8) / 256) * 256;
  const buf = device.createBuffer({ label: 'p0.3 linear readback', size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const halves = new Uint16Array(buf.getMappedRange());
  const out = new Float32Array(w * h * 4);
  const rowHalves = bpr / 2;
  for (let y = 0; y < h; y++) {
    const src = y * rowHalves, dst = y * w * 4;
    for (let i = 0; i < w * 4; i++) out[dst + i] = halfTable[halves[src + i]];
  }
  buf.unmap(); buf.destroy();
  return { width: w, height: h, data: out };
}

/**
 * The bridge's composite before tone mapping: rgb = scene.rgb * cloud.a + cloud.rgb (cloud = premultiplied radiance, a = transmittance).
 * Output a = 1 - transmittance (the runtime's own coverage). Same size required (ultra's outputScale is 1).
 */
export function composite(scene: Float32Array, cloud: Float32Array): Float32Array {
  if (scene.length !== cloud.length) throw new Error(`composite: scene ${scene.length} vs cloud ${cloud.length} floats (outputScale below 1 is not handled)`);
  const out = new Float32Array(scene.length);
  for (let i = 0; i < scene.length; i += 4) {
    const t = cloud[i + 3];
    out[i] = scene[i] * t + cloud[i];
    out[i + 1] = scene[i + 1] * t + cloud[i + 1];
    out[i + 2] = scene[i + 2] * t + cloud[i + 2];
    out[i + 3] = 1 - t;
  }
  return out;
}

export interface LinearFrame {
  view: string;
  /** What the frame holds: 'radiance' (rgb linear, PT accumulator / samples or the runtime composite), 'alpha' (rgb = opacity). */
  kind: 'radiance' | 'alpha';
  width: number;
  height: number;
  /** RGBA float32, row 0 = top. a: 1 for the PT, the runtime's coverage (1 - transmittance) for runtime frames, the opacity for masks. */
  data: Float32Array;
  meta: Record<string, unknown>;
}

/** Summary returned to the caller of readLinear (the data stays in the page until fetched with chunk()). */
export function describe(f: LinearFrame) {
  let r = 0, g = 0, b = 0, finite = 0;
  for (let i = 0; i < f.data.length; i += 4) {
    const x = f.data[i], y = f.data[i + 1], z = f.data[i + 2];
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) { r += x; g += y; b += z; finite++; }
  }
  const n = Math.max(1, finite);
  return { view: f.view, kind: f.kind, width: f.width, height: f.height, channels: 4, byteLength: f.data.byteLength, nonFinite: f.width * f.height - finite, meanRgb: [r / n, g / n, b / n], meta: f.meta };
}

/** Base64 of bytes [offset, offset + length) of the frame's float32 data (little-endian, as the GPU wrote it). */
export async function chunk(f: LinearFrame, offset: number, length: number): Promise<string> {
  const bytes = new Uint8Array(f.data.buffer as ArrayBuffer,f.data.byteOffset + offset, Math.max(0, Math.min(length, f.data.byteLength - offset)));
  const url: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes]));
  });
  return url.slice(url.indexOf(',') + 1);
}
