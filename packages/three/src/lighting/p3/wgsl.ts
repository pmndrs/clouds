/**
 * Group-2 bindings for the designated directional light's geometry shadow.
 *
 * Binding 0 is 80 bytes: mat4x4<f32> + vec4<f32>(bias, width, height,
 * enabled). Binding 1 is the native depth texture from
 * `light.shadow.map.depthTexture`. Three's shadow matrix supplies normalized
 * WebGPU clip coordinates; y is flipped here exactly once, as in
 * `ShadowNode.setupShadowCoord`.
 */
export const DIRECTIONAL_SHADOW_WGSL = /* wgsl */ `
struct DirectionalShadowParams {
  matrix: mat4x4<f32>,
  bias: f32,
  width: f32,
  height: f32,
  enabled: f32,
};

@group(2) @binding(0) var<uniform> directionalShadow: DirectionalShadowParams;
@group(2) @binding(1) var directionalShadowMap: texture_depth_2d;

fn directionalShadowPCF(coord: vec3<f32>, pixel: vec2<i32>, size: vec2<i32>) -> f32 {
  let radius = vec2<i32>(1, 1);
  var lit = 0.0;
  // Keep the geometry bridge independent of Three's sampler state. A small
  // fixed PCF kernel is stable for the cloud compute pass and uses only
  // textureLoad, which works with the native depth texture view.
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let samplePixel = clamp(pixel + vec2<i32>(ox, oy), vec2<i32>(0), size - radius);
      let depth = textureLoad(directionalShadowMap, samplePixel, 0);
      lit += step(coord.z + directionalShadow.bias, depth);
    }
  }
  return lit / 9.0;
}

fn sceneShadowAt(world: vec3<f32>) -> f32 {
  if (directionalShadow.enabled < 0.5) { return 1.0; }
  let projected = directionalShadow.matrix * vec4<f32>(world, 1.0);
  if (projected.w == 0.0) { return 1.0; }

  var coord = projected.xyz / projected.w;
  // Three's WebGPU ShadowNode flips the projected y before sampling.
  coord.y = 1.0 - coord.y;
  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z < 0.0 || coord.z > 1.0) {
    return 1.0;
  }

  let size = vec2<i32>(i32(directionalShadow.width), i32(directionalShadow.height));
  if (any(size <= vec2<i32>(0))) { return 1.0; }
  let pixel = vec2<i32>(clamp(floor(coord.xy * vec2<f32>(directionalShadow.width, directionalShadow.height)), vec2<f32>(0.0), vec2<f32>(directionalShadow.width, directionalShadow.height) - 1.0));
  return directionalShadowPCF(coord, pixel, size);
}
`;
