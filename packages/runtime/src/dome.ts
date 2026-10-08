/** Reflection dome helpers for adapters (no GPU needed). The WGSL side is cloudDomeWgsl() in shaders/dome.wgsl.ts. */

export { cloudDomeWgsl, DOME_OCT_WGSL, DOME_REFRESH_FRAMES } from './shaders/dome.wgsl';

/** The runtime's octahedral reflection dome: rgba16float, rgb = premultiplied radiance (sky exposure units), a = transmittance. */
export interface CloudDome {
  /** Octahedral map, size x size, TEXTURE_BINDING | STORAGE_BINDING. Directions are world-space, y up. */
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly size: number;
  /** World point the dome is seen from, as of the latest refresh. */
  readonly referencePoint: readonly [number, number, number];
  /** Frames since the dome last covered all texels with the current sun: a full refresh takes DOME_REFRESH_FRAMES. */
  readonly refreshFrames: number;
  readonly settings: CloudDomeSettings;
}

export interface CloudDomeSettings {
  /** Refresh the dome in encode(). Turn off when nothing reflects clouds. Default true. */
  enabled: boolean;
  /** Fixed reference point (world metres). null = the camera's x/z at `groundHeight`. */
  referencePoint: [number, number, number] | null;
  /** y of the default reference point. Default 0. */
  groundHeight: number;
  /** Multiplier on the cheap P*S density (the up-rezzed density erodes it, so below 1 matches the main view better). Default 0.6. */
  densityScale: number;
  /** Step cap per ray. Default 96. */
  maxSteps: number;
  /** Minimum step and the step growth per metre of distance. Defaults 8 m, 0.03. */
  stepMin: number;
  stepRel: number;
  /** Rays stop here, metres. Default 12000. */
  maxDistance: number;
}

export function defaultDomeSettings(): CloudDomeSettings {
  return { enabled: true, referencePoint: null, groundHeight: 0, densityScale: 0.6, maxSteps: 96, stepMin: 8, stepRel: 0.03, maxDistance: 12000 };
}

type V3 = readonly [number, number, number];

/** Direction (unit, y up) -> octahedral uv in 0..1. Matches domeOctEncode in WGSL. */
export function domeDirectionToUv(d: V3): [number, number] {
  const l = Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) || 1;
  let x = d[0] / l, z = d[2] / l;
  if (d[1] < 0) {
    const ox = x, oz = z;
    x = (1 - Math.abs(oz)) * (ox >= 0 ? 1 : -1);
    z = (1 - Math.abs(ox)) * (oz >= 0 ? 1 : -1);
  }
  return [x * 0.5 + 0.5, z * 0.5 + 0.5];
}

/** Octahedral uv (0..1) -> unit direction. Matches domeOctDecode in WGSL. */
export function domeUvToDirection(u: number, v: number): [number, number, number] {
  const fx = u * 2 - 1, fz = v * 2 - 1;
  let x = fx, y = 1 - Math.abs(fx) - Math.abs(fz), z = fz;
  if (y < 0) {
    const nx = (1 - Math.abs(z)) * (x >= 0 ? 1 : -1);
    const nz = (1 - Math.abs(x)) * (z >= 0 ? 1 : -1);
    x = nx; z = nz;
  }
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** Texel centre -> direction, for a size x size dome. */
export function domeTexelDirection(x: number, y: number, size: number): [number, number, number] {
  return domeUvToDirection((x + 0.5) / size, (y + 0.5) / size);
}

/** Texel index (continuous, centres at +0.5) of a direction in a size x size dome. */
export function domeDirectionToTexel(d: V3, size: number): [number, number] {
  const [u, v] = domeDirectionToUv(d);
  return [u * size, v * size];
}
