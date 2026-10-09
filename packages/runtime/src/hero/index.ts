// Fine hero overlay (P13-H1, work/specs/P8-hero-vdb.md): brick packing and upload. The core entry exports the upload and the type;
// the CPU packer is for the loaders (import subpath) and test pages.
export { packFineBricks, reduceFineLattice, HERO_EMPTY, BRICK_VOXELS, BRICK_TEXELS, POOL_XY, POOL_SLAB_BRICKS, POOL_SLAB_BYTES, type FineBricks, type PackFineOptions } from './bricks';
export { uploadFineBricks, type GpuFineOverlay } from './overlay';
