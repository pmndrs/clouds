# P1 bounded reference renderer

Internal preview API; public packaging is P5. `createReferenceCloud(renderer, field, occluderBounds)` requires an initialized Three r186 WebGPU renderer. The caller owns the renderer, scene and perspective camera; the cloud instance owns its density/occupancy textures, offscreen scene target, optical/composite storage textures, uniform/timing buffers and output material.

1. Create a `DenseDensityField` from the source module or supply the same validated `r8unorm` payload contract.
2. Call `resize(width, height)` for the internal resolution.
3. Call `render(scene, camera)` after updating the camera and scene. Its offscreen Three render, raw WGSL dispatch and TSL output quad share one device/queue. There is no readback or wait on this path.
4. `setField` replaces density and occupancy resources. Changing bounds changes the physical path length; extinction remains inverse metres unless the caller adjusts it.
5. `dispose` releases only owned resources, is idempotent, and prevents further work.

Density values live at texel centres. World bounds are axis-aligned metres. Both generated and synthetic authored inputs use the same sampling/integration code. Output `optical` contains linear HDR cloud radiance in RGB and transmittance in A; output `output` contains `radiance + transmittance * sceneColor`. Tone mapping happens on the final Three quad. Direct sampling of `optical` must preserve transmittance semantics, not treat it as ordinary opacity.

The marcher uses midpoint segments, exponential segment transmittance, single-scattering directional light with a fixed phase function, and a simple ambient fill. The 8³-voxel occupancy bricks include a one-voxel trilinear halo. Empty occupancy returns zero **at the same sample positions** as the full march; it does not yet jump the ray across bricks. No speedup is promised.

## Reference limitations

- One dense bounded volume, conventional WebGPU 0..1 perspective depth; reverse-Z and orthographic cameras are unsupported here.
- Opaque scene depth stops the volume march. Interleaved transparency/refraction is not handled.
- Cloud self-shadow uses direct secondary sampling. The opaque caster is an analytical world-aligned box matching the demo mesh. Cloud shadows attenuate the reference ground receiver at world Y=0. These are required capability proofs, not arbitrary material/geometry shadow support.
- The generated source is a CPU baseline with lobed shapes/noise and empty boundary guards. It is not a Nubis port, GPU generation system, VDB importer or sparse residency system.
- `readOptical`, `readComposite` and `measureGpu` are serialized diagnostics; callers must pause their render loop while using them. GPU timing includes the raw compute pass only, combining cloud integration, reference shadows and compute composition. It excludes opaque rendering and the display quad. GPU timestamps are optional.
- The reference stores no history. Multiple volume overlap, world coverage, production atmosphere/environment integration and FSR follow in later phases.
