import { createNoiseMipChain, type MorphologyNoiseResources } from '../sources/morphology-noise';

/** Owned raw WebGPU textures; no dependence on Three's 3D mip generation. */
export function uploadMorphologyResources(device: GPUDevice, noise: MorphologyNoiseResources) {
  const textures: GPUTexture[] = [];
  let bytes = 0;
  function upload(data: Uint8Array, size: number, dimension: 2 | 3, label: string) {
    const mips = createNoiseMipChain(data, size, dimension);
    bytes += mips.reduce((sum, mip) => sum + mip.data.byteLength, 0);
    const texture = device.createTexture({
      label, dimension: dimension === 3 ? '3d' : '2d',
      size: [size, size, dimension === 3 ? size : 1],
      format: 'rgba8unorm', mipLevelCount: mips.length,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    textures.push(texture);
    mips.forEach((mip, mipLevel) => device.queue.writeTexture(
      { texture, mipLevel }, mip.data as Uint8Array<ArrayBuffer>,
      { bytesPerRow: mip.width * 4, rowsPerImage: mip.height },
      [mip.width, mip.height, mip.depth],
    ));
    return texture;
  }
  try {
    const weather = upload(noise.weather, noise.weatherResolution, 2, 'cloud-morphology-weather');
    const shape = upload(noise.shape, noise.volumeResolution, 3, 'cloud-morphology-shape');
    const detail = upload(noise.detail, noise.volumeResolution, 3, 'cloud-morphology-erosion');
    const sampler = device.createSampler({
      addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat',
      minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear',
    });
    return {
      entries: [
        { binding: 10, resource: weather.createView() },
        { binding: 11, resource: shape.createView() },
        { binding: 12, resource: detail.createView() },
        { binding: 13, resource: sampler },
      ] satisfies GPUBindGroupEntry[],
      bytes,
      dispose() { textures.forEach(texture => texture.destroy()); },
    };
  } catch (error) {
    textures.forEach(texture => texture.destroy());
    throw error;
  }
}
