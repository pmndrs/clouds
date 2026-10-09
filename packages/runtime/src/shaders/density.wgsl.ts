/**
 * Up-rezzed voxel cloud density: a line-for-line port of GetVoxelCloudDensitySamples + GetUprezzedVoxelCloudDensity
 * from assets/nubis-voxel-clouds/Code Fragments/VoxelCloudSampler.cg.
 * Needs COMMON_WGSL and volumeWgsl(0) concatenated before it. The signature is fixed by work/specs/P1-runtime.md.
 *
 * Deviations from the Decima source: the world is y-up, so the NVDF (x, row, up) is addressed as (x, z, y) by
 * volumeUvw, and noise is sampled at `(p - wind) * noiseScale` with a horizontal (xz) wind. The reflection-dome
 * branch is not ported. The `fineDetailMipDistanceScale` constant (not published) is passed in.
 *
 * P13-H1: `cloudDensityFine` is the march's entry. Within `hero.fineDistance` of the camera it reads the fine hero overlay
 * (sampleModelingHero) and scales the erosion noise by `hero.fineErosion` inside fine bricks (1 = Nubis). With no fine data bound
 * fineDistance is 0 and it is exactly `cloudDensity`. Deviation from the P8 spec: the switch is that function, not a
 * `DensityInputs.fine` field, because other modules (the sky layer, the parity page) construct DensityInputs positionally.
 */
export const DENSITY_WGSL = /* wgsl */ `
// wispyBias and detailBias are art knobs; 0 = the Nubis sampler (the parity page passes 0).
struct DensityInputs { wind: vec3<f32>, mipDistanceScale: f32, baseMip: f32, hfDetails: u32, wispyBias: f32, detailBias: f32 }

// x = full up-rezzed density (0..1, before extinction scaling), y = profile * density scale (cheap).
fn cloudDensity(p: vec3<f32>, rayDistance: f32, inputs: DensityInputs) -> vec2<f32> {
  let hFrac = saturate((p.y - cloudVolume.minCorner.y) / max(cloudVolume.extent.y, 1.0));
  return cloudDensityShaped(p, rayDistance, inputs, sampleModeling(p, inputs.baseMip), hFrac);
}

fn cloudDensityFine(p: vec3<f32>, rayDistance: f32, inputs: DensityInputs) -> vec2<f32> {
  if (rayDistance < hero.fineDistance) {
    let m = sampleModelingHero(p, inputs.baseMip);
    let hFrac = saturate((p.y - cloudVolume.minCorner.y) / max(cloudVolume.extent.y, 1.0));
    // fineErosion scales the noise composite inside fine bricks: folded into detailBias, noise * (1 + bias) * fineErosion.
    var fi = inputs;
    if (m.w > 0.0) { fi.detailBias = (1.0 + inputs.detailBias) * hero.fineErosion - 1.0; }
    return cloudDensityShaped(p, rayDistance, fi, m.xyz, hFrac);
  }
  return cloudDensity(p, rayDistance, inputs);
}

// The up-rez itself, given the modeling triple (profile, detail type, density scale) and the height fraction in the volume.
// The voxel march feeds it the NVDF; the distant sky layer feeds it an analytic vertical profile (sky-layer.wgsl.ts).
fn cloudDensityShaped(p: vec3<f32>, rayDistance: f32, inputs: DensityInputs, modeling: vec3<f32>, hFrac: f32) -> vec2<f32> {
  let profile = modeling.x;
  // Art bias (0 = Nubis): the detail type goes wispy toward the cloud base (Schneider SY s37).
  let type_ = modeling.y * (1.0 - inputs.wispyBias * (1.0 - hFrac) * (1.0 - hFrac));
  let densityScale = modeling.z;
  if (!(profile > 0.0)) { return vec2(0.0); }
  let hf = inputs.hfDetails != 0u;

  // GetUprezzedVoxelCloudDensity
  let mip = log2(1.0 + abs(rayDistance * inputs.mipDistanceScale)) + inputs.baseMip;
  let n = textureSampleLevel(cloudNoise, repeatSampler, (p - inputs.wind) * cloudVolume.noiseScale, mip);

  let wispy = mix(n.r, n.g, profile);
  let billowy = mix(n.b * 0.3, n.a * 0.3, sqrt(sqrt(profile)));
  var noiseComposite = mix(wispy, billowy, type_);

  if (hf) {
    let tg = abs(abs(n.g * 2.0 - 1.0) * 2.0 - 1.0);
    let ta = abs(abs(n.a * 2.0 - 1.0) * 2.0 - 1.0);
    let tg2 = tg * tg;
    let hhf = saturate(mix(1.0 - tg2 * tg2, ta * ta, type_));
    noiseComposite = mix(hhf, noiseComposite, valueRemap(rayDistance, 50.0, 150.0, 0.9, 1.0));
  }

  // Q-1 art bias (0 = Nubis): deeper erosion, so the billows cut further into the profile shell.
  noiseComposite = saturate(noiseComposite * (1.0 + inputs.detailBias));
  var d = valueErosion(profile, noiseComposite);
  let ds2 = saturate(densityScale) * saturate(densityScale);
  let poweredScale = ds2 * ds2;
  d = d * poweredScale;
  d = pow(d, mix(0.3, 0.6, max(EPSILON, poweredScale)));
  if (hf) {
    let f = fractionFromValue(rayDistance, 50.0, 150.0);
    d = pow(d, mix(0.5, 1.0, f)) * mix(0.666, 1.0, f);
  }
  // Scale down close to the camera so the viewer can see inside and animated noise artifacts are hidden.
  return vec2(d * valueRemap(rayDistance, 10.0, 120.0, 0.25, 1.0), profile * densityScale);
}
`;
