import { FRAME_WGSL } from './frame.wgsl';
import { lightGridWgsl } from './light-grid.wgsl';

export const COMPOSITE_LIGHT_GRID_BINDING = 7;
/**
 * Distant sky layer: front colour, depth, back colour at this binding, +1, +2 (always bound; frame.skyEnabled gates the merge,
 * so with the layer off the output is bit-identical). The layer is split at the voxel box (sky-layer.wgsl.ts): front = the cloud
 * between the camera and the box, back = the cloud beyond it, both premultiplied, so the merge is front over voxel over back.
 */
export const COMPOSITE_SKY_BINDING = 9;

/**
 * Depth-aware upsample of the near and far march outputs to output resolution, merged front to back
 * (rgb = near.rgb + near.a * far.rgb, a = near.a * far.a). Per-pass bindings are group 1:
 * 0 Frame, 1 scene depth, 2/3 near colour/depth, 4 output (rgba16float), 5/6 far colour/depth
 * (depth textures are rgba16float x DEPTH_PACK, see march.wgsl.ts: x = mean cloud distance or 0, y = the distance the ray was marched to, z = scene distance).
 * Output is what the caller blends: scene * a + rgb.
 *
 * Cloud shadows: for opaque-depth pixels the sun ray is intersected with the volume box and the light grid (summed sun
 * optical depth, already times densityScale) is read just inside the entry point. shadow = mix(1, 0.8 exp(-tau) + 0.2 exp(-tau/4),
 * shadowStrength) is folded into a, so scene * a + rgb darkens the surface. Sky pixels are never shadowed.
 *
 * A tap whose march ended before this pixel's own march would have (min of volume exit, scene, pass limit) was cut short by a
 * nearer surface and carries no information about this pixel: it is skipped. A tap whose cloud lies behind this pixel's
 * surface is replaced by "no cloud". A pixel whose ray misses the volume box accepts every tap (box edges are not surfaces).
 */
export const COMPOSITE_WGSL = /* wgsl */ `
${FRAME_WGSL}
@group(1) @binding(2) var nearColor: texture_2d<f32>;
@group(1) @binding(3) var nearDepth: texture_2d<f32>;
@group(1) @binding(4) var outputTex: texture_storage_2d<rgba16float, write>;
@group(1) @binding(5) var farColor: texture_2d<f32>;
@group(1) @binding(6) var farDepth: texture_2d<f32>;
${lightGridWgsl(1, COMPOSITE_LIGHT_GRID_BINDING)}
@group(1) @binding(${COMPOSITE_SKY_BINDING}) var skyColor: texture_2d<f32>;
@group(1) @binding(${COMPOSITE_SKY_BINDING + 1}) var skyDepth: texture_2d<f32>;
@group(1) @binding(${COMPOSITE_SKY_BINDING + 2}) var skyBack: texture_2d<f32>;

fn cloudShadow(p: vec3<f32>) -> f32 {
  let sun = frame.sunDir;
  if (frame.shadowStrength <= 0.0 || sun.y <= 0.0) { return 1.0; }
  let iv = volumeRayInterval(p, sun);
  if (iv.x > iv.y || iv.y <= 0.0) { return 1.0; }
  // Enter the box, then step one voxel in so the trilinear tap is not half clamped to the zero outside.
  let t = min(max(iv.x, 0.0) + 1.5 * cloudVolume.voxelSize, 0.5 * (max(iv.x, 0.0) + iv.y));
  let tau = lightGridSample(p + sun * t).x * frame.lightDensityScale;
  let soft = 0.8 * exp(-tau) + 0.2 * exp(-tau * 0.25);
  return mix(1.0, soft, frame.shadowStrength);
}

fn tapResult(colorTex: texture_2d<f32>, depthTex: texture_2d<f32>, tap: vec2<i32>, sceneT: f32, pixelEnd: f32, strict: bool) -> vec4<f32> {
  // w < 0 marks a skipped tap
  let d = textureLoad(depthTex, tap, 0).xy * DEPTH_PACK;
  if (strict && d.y < pixelEnd * 0.97 - 1.0) { return vec4(0.0, 0.0, 0.0, -1.0); }
  var c = textureLoad(colorTex, tap, 0);
  if (d.x > 0.0 && d.x > sceneT * 1.02 + 1.0) { c = vec4(0.0, 0.0, 0.0, 1.0); }
  return c;
}

fn upsample(colorTex: texture_2d<f32>, depthTex: texture_2d<f32>, uv: vec2<f32>, sceneT: f32, pixelEnd: f32) -> vec4<f32> {
  let size = vec2<f32>(textureDimensions(colorTex));
  let m = uv * size - 0.5;
  let b = floor(m);
  let f = m - b;
  let hi = vec2<i32>(size) - vec2<i32>(1);
  var acc = vec4(0.0);
  var wsum = 0.0;
  for (var i = 0; i < 4; i++) {
    let o = vec2<f32>(f32(i & 1), f32(i >> 1));
    let w = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y);
    let tap = clamp(vec2<i32>(b + o), vec2<i32>(0), hi);
    let r = tapResult(colorTex, depthTex, tap, sceneT, pixelEnd, true);
    if (r.a >= 0.0) { acc += r * w; wsum += w; }
  }
  if (wsum > 1e-4) { return acc / wsum; }
  return tapResult(colorTex, depthTex, clamp(vec2<i32>(round(m)), vec2<i32>(0), hi), sceneT, pixelEnd, false);
}

// Distant sky layer: merged per tap (front over the voxel result over back), then bilinear. Interpolating front and back
// separately would leave cross terms where a cloud moves between the two textures across adjacent texels (rays that just graze
// the box split there, their neighbours do not): 0.5c over 0.5c is not c. Per-tap merging makes both assignments identical.
fn mergeSky(voxel: vec4<f32>, uv: vec2<f32>, sceneT: f32) -> vec4<f32> {
  let size = vec2<f32>(textureDimensions(skyColor));
  let m = uv * size - 0.5;
  let b = floor(m);
  let f = m - b;
  let hi = vec2<i32>(size) - vec2<i32>(1);
  var acc = vec4(0.0);
  var wsum = 0.0;
  var nearest = vec4(0.0);
  for (var i = 0; i < 4; i++) {
    let o = vec2<f32>(f32(i & 1), f32(i >> 1));
    let w = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y);
    let tap = clamp(vec2<i32>(b + o), vec2<i32>(0), hi);
    let d = textureLoad(skyDepth, tap, 0).xy;
    var front = textureLoad(skyColor, tap, 0);
    var back = textureLoad(skyBack, tap, 0);
    if (d.x > 0.0 && d.x > sceneT * 1.02 + 1.0) { front = vec4(0.0, 0.0, 0.0, 1.0); back = front; }
    let c = vec4(front.rgb + front.a * (voxel.rgb + voxel.a * back.rgb), front.a * voxel.a * back.a);
    if (i == 0 || ((f.x >= 0.5) == (o.x > 0.5) && (f.y >= 0.5) == (o.y > 0.5))) { nearest = c; }
    if (d.y < sceneT * 0.97 - 1.0) { continue; }   // this tap's rays stopped at a nearer surface than this pixel's
    acc += c * w; wsum += w;
  }
  if (wsum > 1e-4) { return acc / wsum; }
  return nearest;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(vec2<f32>(gid.xy) >= frame.outputSize)) { return; }
  let uv = (vec2<f32>(gid.xy) + 0.5) / frame.outputSize;
  let sceneT = sceneDistance(textureLoad(sceneDepth, vec2<i32>(gid.xy), 0), uv);

  let origin = frame.cameraPos;
  let dir = normalize(unprojectDepth(uv, 1.0) - origin);
  let interval = volumeRayInterval(origin, dir);
  let hit = interval.x <= interval.y;
  let volumeEnd = select(0.0, min(interval.y, sceneT), hit);   // 0 disables the tap rejection
  let split = frame.splitDistance;

  // A ray that misses the voxel box has no voxel cloud: the march traced exactly nothing there, so skip the upsamples (P5-B).
  var result = vec4(0.0, 0.0, 0.0, 1.0);
  if (hit) {
    let near = upsample(nearColor, nearDepth, uv, sceneT, min(volumeEnd, split));
    result = near;
    // The far layer only matters where the near layer lets light through and the ray reaches past the split.
    if (near.a > 0.004 && volumeEnd > split) {
      let far = upsample(farColor, farDepth, uv, sceneT, volumeEnd);
      result = vec4(near.rgb + near.a * far.rgb, near.a * far.a);
    }
  }
  if (sceneT < FAR_T) { result.a *= cloudShadow(origin + dir * sceneT); }
  if (frame.skyEnabled > 0.5) {
    // Distant sky layer (sky-layer.wgsl.ts): the part in front of the voxel box over the voxel result over the part behind it.
    result = mergeSky(result, uv, sceneT);
  }
  textureStore(outputTex, vec2<i32>(gid.xy), result);
}
`;
