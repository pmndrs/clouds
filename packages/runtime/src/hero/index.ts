// Fine hero overlay (P13-H1/H3, work/specs/P8-hero-vdb.md): brick packing, the fine.nvdb reader and upload. The core entry exports the upload
// and the types; the CPU packers are re-exported from the import subpath for tools and test pages.
export { packFineBricks, packFineProfile, reduceFineLattice, HERO_EMPTY, BRICK_VOXELS, BRICK_TEXELS, POOL_XY, POOL_SLAB_BRICKS, POOL_SLAB_BYTES, type FineBricks, type FineProfileBricks, type PackFineOptions } from './bricks';
export { decodeFineNvdb } from './nvdb';
export { uploadFineBricks, uploadFineProfile, type GpuFineOverlay } from './overlay';
