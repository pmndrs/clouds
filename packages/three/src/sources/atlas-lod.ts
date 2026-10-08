import type { CloudscapeAtlas } from './cloudscape-atlas';
export interface CoarseCloudscapeAtlas extends CloudscapeAtlas { readonly tileDimensions: readonly [number, number, number]; }
function index(x: number, y: number, z: number, w: number, h: number): number { return x + y * w + z * w * h; }
/** Downsample each packed tile by two in X/Z while retaining all Y samples. */
export function createCoarseCloudscapeAtlas(source: CloudscapeAtlas): CoarseCloudscapeAtlas {
  if (!source || !(source.data instanceof Uint8Array) || !Array.isArray(source.dimensions) || source.dimensions.length !== 3) throw new Error('Atlas data and dimensions are required.');
  if (!Number.isSafeInteger(source.tileSize) || source.tileSize < 2 || source.tilesPerAxis !== 2 || source.tileCount !== 8) throw new Error('Invalid cloudscape atlas metadata.');
  const [w, h, d] = source.dimensions, tx = w / 2, ty = h / 2, tz = d / 2;
  if (![w, h, d].every(Number.isSafeInteger) || w !== source.tileSize * 2 || h !== source.tileSize * 2 || d !== source.tileSize * 2 || source.data.length !== w * h * d || tx % 2 || tz % 2) throw new Error('Atlas dimensions and payload length are invalid.');
  const ox = tx, oy = h, oz = tz, data = new Uint8Array(ox * oy * oz); let occupied = 0;
  for (let z = 0; z < oz; z++) for (let y = 0; y < oy; y++) for (let x = 0; x < ox; x++) {
    const tileX = Math.floor(x / (tx / 2)), tileZ = Math.floor(z / (tz / 2)), lx = x % (tx / 2), lz = z % (tz / 2), sx = tileX * tx + lx * 2, sz = tileZ * tz + lz * 2;
    const value = Math.round((source.data[index(sx, y, sz, w, h)] + source.data[index(sx + 1, y, sz, w, h)] + source.data[index(sx, y, sz + 1, w, h)] + source.data[index(sx + 1, y, sz + 1, w, h)]) / 4);
    data[index(x, y, z, ox, oy)] = value; if (value) occupied++;
  }
  return { data, dimensions: [ox, oy, oz], tileSize: source.tileSize, tilesPerAxis: 2, tileCount: 8, occupiedFraction: occupied / data.length, tileDimensions: [tx / 2, ty, tz / 2] };
}
