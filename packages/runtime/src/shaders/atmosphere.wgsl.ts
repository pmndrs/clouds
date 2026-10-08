/**
 * Lighting from @pmndrs/sky's physical atmosphere, sampled from its LUTs. No three imports.
 *
 * What the sky stores (see work/reports/P1-02.md for file:line references into the sky source):
 * - All LUTs hold quantities per unit sun illuminance (ILLUMINANCE_IS_ONE). The sky's exposure
 *   `luminanceScale` (default 40) multiplies them, and `sunColor` (default white) tints them.
 * - Transmittance LUT (rgba16float, 256x64 by default): Bruneton (r, mu) map, no sub-UV correction.
 *   x = (d - dMin) / (dMax - dMin), y = rho / H. Radii in km.
 * - Sky-view LUT (rgba16float, 192x108): Hillaire horizon-packed (viewZenithCos, lightViewCos) map with
 *   sub-UV correction. Valid for the camera altitude and the camera's local up it was baked at.
 * - Aerial perspective LUT (rgba16float 3D, 32^3): x,y = screen uv (v down, row 0 = top of the frustum),
 *   z = sqrt(distKm / (kmPerSlice * depthSlices)). rgb = in-scatter, a = 1 - mean transmittance.
 *
 * World frame: metres, y-up. `flat` (the sky's default): altitude = worldPos.y, local up = +Y.
 * Planet mode (`sky.update(camera, { planetCenter })`): radius = |worldPos - planetCenter|, up = radial.
 *
 * Units out: sunRadianceAt = sun illuminance (what three's DirectionalLight.intensity means, `luminanceScale * T`);
 * skyAmbient = cosine-weighted mean sky radiance over each hemisphere (= irradiance / pi), same scale.
 *
 * Bindings (group `g`): 0 uniform Atmosphere, 1 transmittance LUT, 2 sky-view LUT, 3 AP LUT (3D), 4 linear clamp sampler.
 * Use createAtmosphereBindGroupLayout() from atmosphere.ts for the matching layout.
 */
export function atmosphereWgsl(group: number): string {
  return /* wgsl */ `
struct Atmosphere {
  sunDirection: vec3<f32>, luminanceScale: f32,   // unit vector toward the sun (world), sky exposure
  sunColor: vec3<f32>, bottomRadiusKm: f32,
  planetCenter: vec3<f32>, topRadiusKm: f32,      // planetCenter in world metres (planet mode only)
  cameraUp: vec3<f32>, skyViewHeightKm: f32,      // local up and planet-centred radius the sky-view LUT was baked at
  apKmPerSlice: f32, apDepthSlices: f32, flatWorld: f32, apEnabled: f32,
  viewRotProj: mat4x4<f32>,                       // camera projection * view with translation removed (AP camera)
}
@group(${group}) @binding(0) var<uniform> atmosphere: Atmosphere;
@group(${group}) @binding(1) var atmTransmittanceLut: texture_2d<f32>;
@group(${group}) @binding(2) var atmSkyViewLut: texture_2d<f32>;
@group(${group}) @binding(3) var atmAerialPerspective: texture_3d<f32>;
@group(${group}) @binding(4) var atmSampler: sampler;

struct SkyAmbientResult { upper: vec3<f32>, lower: vec3<f32> }

const ATM_PI = 3.14159265358979;
const ATM_AMBIENT_V = 8;
const ATM_AMBIENT_AZIMUTHS = 8;

// ---- frame -------------------------------------------------------------------------------------
fn atmLocalUp(worldPos: vec3<f32>) -> vec3<f32> {
  if (atmosphere.flatWorld > 0.5) { return vec3<f32>(0.0, 1.0, 0.0); }
  return normalize(worldPos - atmosphere.planetCenter);
}
// Planet-centred radius in km, clamped to the atmosphere shell like the LUT's own mapping.
fn atmRadiusKm(worldPos: vec3<f32>) -> f32 {
  var r: f32;
  if (atmosphere.flatWorld > 0.5) {
    r = atmosphere.bottomRadiusKm + worldPos.y * 0.001;
  } else {
    r = length(worldPos - atmosphere.planetCenter) * 0.001;
  }
  return clamp(r, atmosphere.bottomRadiusKm, atmosphere.topRadiusKm);
}
// Cosine of the zenith angle of the planet's horizon seen from radius r (0 on the ground, negative above it).
fn atmHorizonCos(r: f32) -> f32 {
  let k = atmosphere.bottomRadiusKm / r;
  return -sqrt(max(0.0, 1.0 - k * k));
}

// ---- transmittance LUT: Bruneton (r, mu) -> uv (LutTransmittanceParamsToUv) -----------------------
fn atmTransmittanceUv(r: f32, mu: f32) -> vec2<f32> {
  let bot = atmosphere.bottomRadiusKm;
  let top = atmosphere.topRadiusKm;
  let H = sqrt(max(0.0, top * top - bot * bot));
  let rho = sqrt(max(0.0, r * r - bot * bot));
  let disc = r * r * (mu * mu - 1.0) + top * top;
  let d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  let dMin = top - r;
  let dMax = rho + H;
  return vec2<f32>((d - dMin) / max(dMax - dMin, 1e-20), rho / max(H, 1e-20));
}
// Fraction of sunlight (per channel) reaching worldPos; 0 once the sun is below the planet's horizon there.
fn atmTransmittanceToSun(worldPos: vec3<f32>) -> vec3<f32> {
  let r = atmRadiusKm(worldPos);
  let mu = clamp(dot(atmosphere.sunDirection, atmLocalUp(worldPos)), -1.0, 1.0);
  if (mu < atmHorizonCos(r)) { return vec3<f32>(0.0); }
  return textureSampleLevel(atmTransmittanceLut, atmSampler, atmTransmittanceUv(r, mu), 0.0).rgb;
}
// Direct sun illuminance at worldPos in the sky's exposure units (matches createSun({physical:true}) colour * intensity).
fn sunRadianceAt(worldPos: vec3<f32>) -> vec3<f32> {
  return atmTransmittanceToSun(worldPos) * atmosphere.luminanceScale * atmosphere.sunColor;
}

// ---- sky-view LUT: (viewZenithCos, lightViewCos) -> uv (SkyViewLutParamsToUv) ---------------------
fn atmSkyViewUv(viewZenithCos: f32, lightViewCos: f32, dims: vec2<f32>) -> vec2<f32> {
  let bot = atmosphere.bottomRadiusKm;
  let h = max(atmosphere.skyViewHeightKm, bot + 0.01);
  let beta = acos(clamp(sqrt(max(h * h - bot * bot, 0.0)) / h, -1.0, 1.0));
  let zenithHorizonAngle = ATM_PI - beta;
  let vzAcos = acos(clamp(viewZenithCos, -1.0, 1.0));
  var uvY: f32;
  if (viewZenithCos < atmHorizonCos(h)) {
    // ray hits the planet: ground branch
    uvY = sqrt(max((vzAcos - zenithHorizonAngle) / max(beta, 1e-6), 0.0)) * 0.5 + 0.5;
  } else {
    uvY = (1.0 - sqrt(max(1.0 - vzAcos / max(zenithHorizonAngle, 1e-6), 0.0))) * 0.5;
  }
  let uvX = sqrt(saturate(-lightViewCos * 0.5 + 0.5));
  // fromUnitToSubUvs
  return vec2<f32>((uvX + 0.5 / dims.x) * (dims.x / (dims.x + 1.0)), (uvY + 0.5 / dims.y) * (dims.y / (dims.y + 1.0)));
}
fn atmSkyRadiance(viewZenithCos: f32, lightViewCos: f32) -> vec3<f32> {
  let dims = vec2<f32>(textureDimensions(atmSkyViewLut, 0));
  return textureSampleLevel(atmSkyViewLut, atmSampler, atmSkyViewUv(viewZenithCos, lightViewCos, dims), 0.0).rgb;
}

// Cosine-weighted mean sky radiance of each hemisphere around the local up, in the sky's exposure units.
// Integrated in the LUT's own (u, v) space, whose v axis already packs texels toward the horizon: nodes are midpoints in v
// (weight |cos t| sin t dt/dv, from the inverse map in uvToSkyViewLutParams) and in azimuth over [0, pi] (the LUT is
// mirror-symmetric about the sun's vertical plane). ATM_AMBIENT_V nodes per hemisphere x ATM_AMBIENT_AZIMUTHS azimuths.
// Uniform spacing in sin^2 of the zenith angle misses the bright horizon band and reads 5-15 % low; this does not.
// The LUT is the camera's: the result does not vary with worldPos in flat mode, and is approximate for a planet-mode
// point far from the camera. It is constant per frame, so evaluate it once per frame (one thread), not per pixel.
fn atmHemisphereMean(v0: f32, v1: f32, zha: f32, beta: f32, dims: vec2<f32>) -> vec3<f32> {
  var acc = vec3<f32>(0.0);
  let dv = (v1 - v0) / f32(ATM_AMBIENT_V);
  for (var i = 0; i < ATM_AMBIENT_V; i++) {
    let v = v0 + (f32(i) + 0.5) * dv;
    var theta: f32; var dtheta: f32;
    if (v < 0.5) { let a = 1.0 - 2.0 * v; theta = zha * (1.0 - a * a); dtheta = zha * 4.0 * a; }
    else { let b = 2.0 * v - 1.0; theta = zha + beta * b * b; dtheta = beta * 4.0 * b; }
    let weight = abs(cos(theta)) * sin(theta) * dtheta * dv;
    let uvY = (v + 0.5 / dims.y) * (dims.y / (dims.y + 1.0));
    var row = vec3<f32>(0.0);
    for (var j = 0; j < ATM_AMBIENT_AZIMUTHS; j++) {
      let cosPhi = cos((f32(j) + 0.5) * ATM_PI / f32(ATM_AMBIENT_AZIMUTHS));
      let uvX = (sqrt(saturate(-cosPhi * 0.5 + 0.5)) + 0.5 / dims.x) * (dims.x / (dims.x + 1.0));
      row += textureSampleLevel(atmSkyViewLut, atmSampler, vec2<f32>(uvX, uvY), 0.0).rgb;
    }
    acc += row * (weight / f32(ATM_AMBIENT_AZIMUTHS));
  }
  return acc * 2.0;
}
fn skyAmbient(worldPos: vec3<f32>) -> SkyAmbientResult {
  let dims = vec2<f32>(textureDimensions(atmSkyViewLut, 0));
  let bot = atmosphere.bottomRadiusKm;
  let h = max(atmosphere.skyViewHeightKm, bot + 0.01);
  let beta = acos(clamp(sqrt(max(h * h - bot * bot, 0.0)) / h, -1.0, 1.0));
  let zha = ATM_PI - beta;
  // v at which the view ray is exactly horizontal (zenith angle pi/2); 0.5 when the camera is on the ground.
  var v90 = 0.5;
  if (zha > 0.5 * ATM_PI + 1e-4) { v90 = 0.5 * (1.0 - sqrt(max(0.0, 1.0 - 0.5 * ATM_PI / zha))); }
  let k = atmosphere.luminanceScale * atmosphere.sunColor;
  var result: SkyAmbientResult;
  result.upper = atmHemisphereMean(0.0, v90, zha, beta, dims) * k;
  result.lower = atmHemisphereMean(v90, 1.0, zha, beta, dims) * k;
  return result;
}

// ---- aerial perspective ----------------------------------------------------------------------------
// uv: screen uv of the pixel, v down (v = 0.5 - 0.5 * ndc.y). distance: metres along the ray.
// Returns (in-scatter rgb in exposure units, 1 - transmittance) for a surface at that distance.
fn atmAerialPerspectiveAt(uv: vec2<f32>, distance: f32) -> vec4<f32> {
  let w = sqrt(saturate(distance * 0.001 / (atmosphere.apKmPerSlice * atmosphere.apDepthSlices)));
  let ap = textureSampleLevel(atmAerialPerspective, atmSampler, vec3<f32>(uv, w), 0.0);
  return vec4<f32>(ap.rgb * atmosphere.luminanceScale * atmosphere.sunColor, ap.a);
}
// Premultiplied cloud radiance in, premultiplied out: rgb * apT + inscatter * (1 - transmittance).
fn applyAerialPerspectiveUv(color: vec3<f32>, transmittance: f32, uv: vec2<f32>, distance: f32) -> vec3<f32> {
  if (atmosphere.apEnabled < 0.5) { return color; }
  let ap = atmAerialPerspectiveAt(uv, distance);
  return color * (1.0 - ap.a) + ap.rgb * (1.0 - transmittance);
}
// Same, from a world-space view direction (needs the AP camera's matrices in the uniform).
fn applyAerialPerspective(color: vec3<f32>, transmittance: f32, viewDir: vec3<f32>, distance: f32) -> vec3<f32> {
  let clip = atmosphere.viewRotProj * vec4<f32>(viewDir, 0.0);
  if (clip.w <= 1e-6) { return color; }
  let ndc = clip.xy / clip.w;
  return applyAerialPerspectiveUv(color, transmittance, vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5), distance);
}
`;
}

// ---- TS side: uniform layout, bind group layout (renderer-agnostic) -----------------------------------

/** Floats in the Atmosphere uniform (144 bytes). Offsets match the WGSL struct. */
export const ATMOSPHERE_UNIFORM_FLOATS = 36;
export const ATMOSPHERE_UNIFORM_BYTES = ATMOSPHERE_UNIFORM_FLOATS * 4;

/** Plain values for the Atmosphere uniform. Units: radii in km, planetCenter in world metres. */
export interface AtmosphereUniformValues {
  sunDirection: ArrayLike<number>;
  luminanceScale: number;
  sunColor: ArrayLike<number>;
  bottomRadiusKm: number;
  topRadiusKm: number;
  /** World-space centre of the planet (metres). Ignored when `flat`. */
  planetCenter: ArrayLike<number>;
  /** The sky's flat-world convention: altitude = y, up = +Y. */
  flat: boolean;
  /** Camera local up the sky-view LUT was baked against. */
  cameraUp: ArrayLike<number>;
  /** Planet-centred radius in km the sky-view LUT was baked at. */
  skyViewHeightKm: number;
  apKmPerSlice: number;
  apDepthSlices: number;
  apEnabled: boolean;
  /** Column-major projection * view-without-translation of the camera that built the AP LUT. */
  viewRotProj: ArrayLike<number>;
}

/** Fill `out` (length >= ATMOSPHERE_UNIFORM_FLOATS) in place. No allocation. */
export function writeAtmosphereUniforms(out: Float32Array, v: AtmosphereUniformValues): Float32Array {
  out[0] = v.sunDirection[0]; out[1] = v.sunDirection[1]; out[2] = v.sunDirection[2]; out[3] = v.luminanceScale;
  out[4] = v.sunColor[0]; out[5] = v.sunColor[1]; out[6] = v.sunColor[2]; out[7] = v.bottomRadiusKm;
  out[8] = v.planetCenter[0]; out[9] = v.planetCenter[1]; out[10] = v.planetCenter[2]; out[11] = v.topRadiusKm;
  out[12] = v.cameraUp[0]; out[13] = v.cameraUp[1]; out[14] = v.cameraUp[2]; out[15] = v.skyViewHeightKm;
  out[16] = v.apKmPerSlice; out[17] = v.apDepthSlices; out[18] = v.flat ? 1 : 0; out[19] = v.apEnabled ? 1 : 0;
  for (let i = 0; i < 16; i++) out[20 + i] = v.viewRotProj[i];
  return out;
}

export interface AtmosphereBindingResources {
  uniforms: GPUBuffer;
  transmittance: GPUTextureView;
  skyView: GPUTextureView;
  aerialPerspective: GPUTextureView;
  sampler: GPUSampler;
}

/** Explicit layout for atmosphereWgsl(group). Visibility is compute + fragment. */
export function createAtmosphereBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  const v = GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT;
  return device.createBindGroupLayout({
    label: 'atmosphere',
    entries: [
      { binding: 0, visibility: v, buffer: { type: 'uniform' } },
      { binding: 1, visibility: v, texture: { sampleType: 'float', viewDimension: '2d' } },
      { binding: 2, visibility: v, texture: { sampleType: 'float', viewDimension: '2d' } },
      { binding: 3, visibility: v, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 4, visibility: v, sampler: { type: 'filtering' } },
    ],
  });
}

/** Linear, clamp-to-edge: what the sky samples its own LUTs with. */
export function createAtmosphereSampler(device: GPUDevice): GPUSampler {
  return device.createSampler({ label: 'atmosphere', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
}

export function createAtmosphereBindGroup(device: GPUDevice, layout: GPUBindGroupLayout, r: AtmosphereBindingResources): GPUBindGroup {
  return device.createBindGroup({
    label: 'atmosphere',
    layout,
    entries: [
      { binding: 0, resource: { buffer: r.uniforms } },
      { binding: 1, resource: r.transmittance },
      { binding: 2, resource: r.skyView },
      { binding: 3, resource: r.aerialPerspective },
      { binding: 4, resource: r.sampler },
    ],
  });
}
