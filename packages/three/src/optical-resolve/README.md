# Optical resolve

`createOpticalResolve(renderer)` owns one full-resolution `StorageTexture`
with an explicit `rgba16float` format. `render` accepts a low-resolution
`(Lrgb,Talpha)` cloud texture, full-resolution linear scene color, and a
`depth32float` scene depth texture. It dispatches an 8 × 8 compute pass and
stores `L + T * sceneColor` in the output.

The pass gathers four low-resolution texels with their bilinear weights. Each
tap is compared against the full-resolution scene depth sampled at that low
texel's centre, using linear eye depth and the supplied camera near/far
planes. Disparate taps are rejected to stop cloud color crossing a foreground
silhouette. If no tap remains, the resolve emits `L=0,T=1`; this can leave a
small missing edge until a higher-resolution cloud sample is available.

The resolve does not render a scene or alter the caller's render target/MRT.
`measureGpu` is an opt-in timestamp query and returns `null` when the device
does not expose timestamp queries. The reconstruction lab's
`runOpticalGpuChecks` helper exercises conservation, empty-transmittance,
foreground-edge rejection, all-rejected fallback, and input-resource reuse on
an actual WebGPU device.
