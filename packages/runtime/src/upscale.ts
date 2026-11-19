// U2: render levels. The sky layer (and the procedural trace that runs in it) renders at a reduced internal size and @pmndrs/upscaler's
// temporal path (FSR2/3-style, the owner's library, raw-WebGPU entry `@pmndrs/upscaler/core`) brings it to the composite's size; the composite
// then merges the upscaled cloud over the scene at full size, so the scene depth still occludes the clouds per output pixel.
//
// Inputs the upscaler gets (docs/engine-contract.md of the upscaler), all at the internal size, written by one small render pass here:
// - colour: the layer's two premultiplied parts merged (front over back; rgb = radiance, a = transmittance). Only valid while nothing is drawn
//   between them, i.e. without a voxel box (densityModel 'procedural'); the runtime keeps the old path otherwise.
// - depth (depth32float, written with frag_depth): one representative distance per pixel, the opacity-weighted mean distance of the cloud along
//   the ray (the layer's depth.z, C2), converted to view depth and to a standard [0, 1] perspective depth with this module's own near / far
//   (UPSCALE_NEAR / UPSCALE_FAR, passed to the upscaler with it). The far plane where the ray saw no cloud.
// - velocity (rg16float): NDC delta current - previous, y up, of that representative point. The previous position includes the clouds' own
//   motion since the last frame (the wind offset's change times the model's cloud speed: the same displacement C2's resolve follows), so wind
//   is a motion vector, not a shading change. Clear sky moves with the camera only (a point at UPSCALE_FAR).
// No sub-pixel jitter: the layer's output is its own temporally resolved history (16-frame amortisation), not a fresh render under this
// frame's offset, so the upscaler runs with `jitter: false` (it still reprojects, rectifies, accumulates and sharpens; see the contract's
// "Jitter" section). No three imports.
import { UpscalerCore, type UpscalePath } from '@pmndrs/upscaler/core';
import type { GpuTimer } from './gpu-timer';

/** Render levels (work/compass, "Render levels"): the internal size of the cloud pass and whether the upscaler is the output path. */
export type CloudRenderLevel = 'cinematic' | 'desktop' | 'laptop';
/** Near / far (m) of the representative cloud depth handed to the upscaler (not the scene camera's: the depth texture is ours). */
export const UPSCALE_NEAR = 1;
export const UPSCALE_FAR = 400000;

const PREP_WGSL = /* wgsl */ `
struct Prep {
  invViewProj: mat4x4<f32>,
  prevViewProj: mat4x4<f32>,
  cameraPos: vec4<f32>,     // w: 1 when the previous matrix is valid
  forward: vec4<f32>,       // camera forward (unit), w unused
  motion: vec4<f32>,        // the clouds' world displacement since the last frame (m), w unused
  nearFar: vec4<f32>,       // near, far, render width, render height
  opts: vec4<f32>,          // x: depth mode (0 the cloud's representative depth, 1 every pixel at the far plane), y: colour scale (rgb), zw 0
}
@group(0) @binding(0) var<uniform> U: Prep;
@group(0) @binding(1) var front: texture_2d<f32>;
@group(0) @binding(2) var back: texture_2d<f32>;
@group(0) @binding(3) var dist: texture_2d<f32>;

struct VOut { @builtin(position) pos: vec4<f32> }
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return VOut(vec4(p * 2.0 - 1.0, 0.0, 1.0));
}
struct FOut {
  @location(0) color: vec4<f32>,
  @location(1) velocity: vec4<f32>,
  @builtin(frag_depth) depth: f32,
}
fn unproject(uv: vec2<f32>) -> vec3<f32> {
  let ndc = vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 1.0, 1.0);
  let w = U.invViewProj * ndc;
  return w.xyz / w.w;
}
@fragment fn fs(v: VOut) -> FOut {
  let px = vec2<i32>(v.pos.xy);
  let uv = v.pos.xy / U.nearFar.zw;
  let f = textureLoad(front, px, 0);
  let b = textureLoad(back, px, 0);
  let d = textureLoad(dist, px, 0);
  var o: FOut;
  // Non-finite inputs never reach the upscaler (a NaN in its history or its exposure reduction would stay there).
  let c = vec4(f.rgb + f.a * b.rgb, f.a * b.a);
  o.color = select(vec4(0.0, 0.0, 0.0, 1.0), vec4(max(c.rgb, vec3(0.0)) * U.opts.y, saturate(c.a)), all(abs(c) < vec4(65000.0)));
  let near = U.nearFar.x; let far = U.nearFar.y;
  let dir = normalize(unproject(uv) - U.cameraPos.xyz);
  // The representative distance: the opacity-weighted mean over the whole ray (d.z), else the first part's mean (d.x), else none.
  var t = select(d.x, d.z, d.z > 0.0);
  if (!(abs(t) < 1.0e7)) { t = 0.0; }
  let cloud = t > 0.0 && o.color.a < 0.999;
  var shift = U.motion.xyz;
  if (!cloud) { t = far * 0.5; shift = vec3(0.0); }
  let p = U.cameraPos.xyz + dir * t;
  let viewZ = clamp(dot(p - U.cameraPos.xyz, U.forward.xyz), near, far);
  // Standard WebGPU perspective depth: 0 at near, 1 at far.
  o.depth = select(1.0, saturate(far * (viewZ - near) / (viewZ * (far - near))), cloud && U.opts.x < 0.5);
  var vel = vec2(0.0);
  if (U.cameraPos.w > 0.5) {
    let prev = U.prevViewProj * vec4(p - shift, 1.0);
    if (prev.w > 1e-4) {
      let cur = vec2(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
      vel = cur - prev.xy / prev.w;
    }
  }
  o.velocity = vec4(select(vec2(0.0), clamp(vel, vec2(-4.0), vec2(4.0)), all(abs(vel) < vec2(1.0e6))), 0.0, 0.0);
  return o;
}
`;

export interface SkyUpscaleEncodeArgs {
  /** The sky layer's resolved targets at the internal size (front colour, back colour, depth words: x mean of the front part, z of the ray, w spread). */
  front: GPUTexture; back: GPUTexture; dist: GPUTexture;
  /** Output size (the composite's). */
  displayWidth: number; displayHeight: number;
  path: UpscalePath;
  sharpness: number;
  /**
   * The upscaler's conditioning exposure (it multiplies the colour before its invertible tonemap c / (1 + max c) and divides it back out).
   * 0 = its auto exposure. The cloud colour is premultiplied and mostly black (clear sky), so auto exposure runs at its 8x cap and the tonemap
   * is far from linear: interpolating across a cloud edge in tonemapped space darkens the in-between colour against the linearly
   * interpolated transmittance (a dark rim) and steepens the edge (stair steps). A small fixed exposure keeps the tonemap near linear.
   */
  exposure?: number;
  /**
   * Multiplies the colour before the upscaler (the caller divides it back out). With the upscaler's auto exposure, which tops out at 8x on the
   * mostly black cloud colour, 1/64 makes its effective conditioning 1/8: its tonemap stays near linear across a cloud edge (see `exposure`)
   * without its fixed-exposure mode. Default 1.
   */
  colorScale?: number;
  /** 'cloud' (default): the representative cloud depth; 'flat': every pixel at the far plane (no depth edges for the upscaler's disocclusion test). */
  depthMode?: 'cloud' | 'flat';
  inverseViewProjection: ArrayLike<number>;
  viewProjection: ArrayLike<number>;
  cameraPosition: ArrayLike<number>;
  /** The clouds' world displacement since the last frame (m). */
  cloudMotion: ArrayLike<number>;
  /** Drop the upscaler's history this frame (the layer cut its own). */
  reset: boolean;
  deltaTime: number;
  timer?: GpuTimer;
}

export interface SkyUpscale {
  /** True once the upscaler's pipelines for the requested path are compiled (until then the caller composites the layer as before). */
  readonly ready: boolean;
  /** Encode the prep pass and the upscale; returns the display-size output (rgba16float, premultiplied cloud + transmittance) or null when not ready. */
  encode(encoder: GPUCommandEncoder, a: SkyUpscaleEncodeArgs): GPUTexture | null;
  /** The upscaler's live settings (sharpness, locks, ...), for tooling. */
  readonly core: UpscalerCore;
  dispose(): void;
}

export function createSkyUpscale(device: GPUDevice): SkyUpscale {
  const core = new UpscalerCore({ device });
  const module = device.createShaderModule({ label: 'cloud upscale prep', code: PREP_WGSL });
  const pipeline = device.createRenderPipeline({
    label: 'cloud upscale prep', layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }, { format: 'rg16float' }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'always' },
  });
  const uniform = device.createBuffer({ label: 'cloud upscale prep', size: 64 * 2 + 16 * 5, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const u = new Float32Array(16 * 2 + 4 * 5);
  const prevVP = new Float32Array(16);
  let prevValid = false;
  let targets: { w: number; h: number; color: GPUTexture; velocity: GPUTexture; depth: GPUTexture } | null = null;
  let group: GPUBindGroup | null = null;
  const groupKey: unknown[] = [null, null, null, null];
  let config = '';
  let preparing: Promise<void> | null = null;
  let readyKey = '';
  let disposed = false;
  const exposureTex = device.createTexture({ label: 'cloud upscale exposure', size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  let exposureValue = 0;

  const ensureTargets = (w: number, h: number) => {
    if (targets && targets.w === w && targets.h === h) return;
    targets?.color.destroy(); targets?.velocity.destroy(); targets?.depth.destroy();
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    targets = {
      w, h,
      color: device.createTexture({ label: 'cloud upscale colour', size: [w, h], format: 'rgba16float', usage }),
      velocity: device.createTexture({ label: 'cloud upscale velocity', size: [w, h], format: 'rg16float', usage }),
      depth: device.createTexture({ label: 'cloud upscale depth', size: [w, h], format: 'depth32float', usage }),
    };
    group = null;
  };

  return {
    get ready() { return !!config && readyKey === config && core.isReady; },
    core,
    encode(encoder, a) {
      if (disposed) return null;
      const w = a.front.width, h = a.front.height;
      const key = `${a.displayWidth}x${a.displayHeight}/${w}x${h}/${a.path}`;
      if (key !== config) {
        // configure() reallocates the output and drops the history; prepare() compiles the path's pipelines (async).
        config = key;
        core.configure({ displayWidth: a.displayWidth, displayHeight: a.displayHeight, renderWidth: w, renderHeight: h, path: a.path, jitter: false });
        const p = preparing = core.prepare().then(() => { if (preparing === p) readyKey = key; }, e => { console.error('cloud upscaler prepare failed', e); });
        prevValid = false;
      }
      if (readyKey !== config || !core.isReady) return null;
      ensureTargets(w, h);
      const t = targets!;
      // Uniforms: this frame's inverse view-projection, last frame's view-projection, the camera, its forward axis, the cloud motion.
      u.set(Array.from(a.inverseViewProjection).slice(0, 16), 0);
      u.set(prevVP, 16);
      const inv = a.inverseViewProjection;
      const cam = a.cameraPosition;
      const wv = inv[11] + inv[15];
      let fx = (inv[8] + inv[12]) / wv - cam[0], fy = (inv[9] + inv[13]) / wv - cam[1], fz = (inv[10] + inv[14]) / wv - cam[2];
      const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      const valid = prevValid && !a.reset;
      u[32] = cam[0]; u[33] = cam[1]; u[34] = cam[2]; u[35] = valid ? 1 : 0;
      u[36] = fx; u[37] = fy; u[38] = fz; u[39] = 0;
      u[40] = a.cloudMotion[0]; u[41] = a.cloudMotion[1]; u[42] = a.cloudMotion[2]; u[43] = 0;
      u[44] = UPSCALE_NEAR; u[45] = UPSCALE_FAR; u[46] = w; u[47] = h;
      u[48] = a.depthMode === 'flat' ? 1 : 0; u[49] = a.colorScale ?? 1; u[50] = 0; u[51] = 0;
      device.queue.writeBuffer(uniform, 0, u);
      prevVP.set(Array.from(a.viewProjection).slice(0, 16)); prevValid = true;
      if (!group || groupKey[0] !== a.front || groupKey[1] !== a.back || groupKey[2] !== a.dist) {
        groupKey[0] = a.front; groupKey[1] = a.back; groupKey[2] = a.dist;
        group = device.createBindGroup({ label: 'cloud upscale prep', layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: a.front.createView() },
          { binding: 2, resource: a.back.createView() },
          { binding: 3, resource: a.dist.createView() },
        ] });
      }
      // The prep pass and the upscaler's own compute passes are timed as one span ('upscale'), with an empty compute pass on each side (a
      // render pass's own timestamps read 40-50 ms on Metal: they overlap the work before it).
      const span = a.timer?.spanTimestampWrites('upscale');
      if (span) encoder.beginComputePass({ label: 'cloud upscale begin', timestampWrites: span.begin }).end();
      const pass = encoder.beginRenderPass({
        label: 'cloud upscale prep',
        colorAttachments: [
          { view: t.color.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } },
          { view: t.velocity.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
        ],
        depthStencilAttachment: { view: t.depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
      core.settings.sharpness = Math.min(1, Math.max(0, a.sharpness));
      // A fixed exposure goes in as the app-supplied exposure texture (1x1, cleared to the value when it changes), with the upscaler's auto
      // exposure left on underneath: its own fixed mode (autoExposure false) lost the device ("Insufficient Memory") within a few frames when
      // started while the sky was still empty, in every run (U2 report).
      const ex = a.exposure ?? 0;
      core.settings.autoExposure = true;
      if (ex > 0 && ex !== exposureValue) {
        exposureValue = ex;
        encoder.beginRenderPass({ label: 'cloud upscale exposure', colorAttachments: [{ view: exposureTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: ex, g: ex, b: ex, a: 1 } }] }).end();
      }
      core.encode(encoder, { color: t.color, depth: t.depth, velocity: t.velocity, deltaTime: a.deltaTime, reset: a.reset, ...(ex > 0 ? { exposureTexture: exposureTex } : {}) }, { near: UPSCALE_NEAR, far: UPSCALE_FAR, perspective: true });
      if (span) encoder.beginComputePass({ label: 'cloud upscale end', timestampWrites: span.end }).end();
      return core.output;
    },
    dispose() {
      disposed = true;
      core.dispose();
      targets?.color.destroy(); targets?.velocity.destroy(); targets?.depth.destroy(); targets = null;
      uniform.destroy(); exposureTex.destroy();
    },
  };
}
