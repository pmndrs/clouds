/**
 * V2 direct density: the VDB's own density, marched as-is (native resolution, one trilinear fetch; no dimensional profile, erosion,
 * wispy/billowy noise or up-rez). Concatenate after COMMON_WGSL + volumeWgsl(0) + DENSITY_WGSL (for DensityInputs); the march calls
 * it in place of cloudDensity when marchWgsl(..., directDensity = true). The density texture is bound at the hero pool's binding
 * (`heroPool`, VOLUME_DIRECT_BINDING in volume.wgsl.ts): a direct volume has no fine overlay.
 *
 * The texture holds density / densityRef (scripts/vdb/vdb_to_direct.py), so sigma = x * frame.extinction with the runtime's extinction
 * = CloudSettings.directDensity * densityRef = directDensity (1/m) per unit of VDB density. The same normalised value, clamped to 1,
 * is the asset's NVDF R channel, which the light grid, shadow map and dome integrate (B = 1), so every pass sees the same density.
 * y (the march's in-scatter weight for the Nubis lighting, 'profile * density scale' on the NVDF path) is saturate(x): the Nubis
 * lighting has no profile to read here, the density stands in for it ('octave' lighting does not use it).
 */
export const DIRECT_DENSITY_WGSL = /* wgsl */ `
fn cloudDensityDirect(p: vec3<f32>, rayDistance: f32, inputs: DensityInputs) -> vec2<f32> {
  if (!insideVolume(p)) { return vec2(0.0); }
  let d = max(textureSampleLevel(heroPool, clampSampler, volumeUvw(p), 0.0).r, 0.0);
  return vec2(d, min(d, 1.0));
}
`;
