import { createWeatherSource } from '../coverage/weather';
import type { Bounds3, DensityDescriptor, Vec3 } from '@clouds/core';

/**
 * A deliberately small, CPU-only reference for one formation.  The field is
 * a diagnostic fixture; it is not a streaming format or a production LOD.
 */
export const LOD_BOUNDS: Bounds3 = {
  min: [-320, 650, -280],
  max: [320, 2_450, 280],
};
export const LOD_CANONICAL_RESOLUTION = 64;
export const LOD_COARSE_RESOLUTIONS = [16, 32] as const;
export const LOD_SOURCE_ID = 'lod-weather-17-formation-0';
export const LOD_REVISION = 1;

/** Tolerances are declared before the tests and shown in the browser report. */
export const OPTICAL_TEST_TOLERANCES = {
  sameBoundsMetres: 1e-9,
  homogeneousTransmittanceAbs: 1e-10,
  fineEndpointAbs: 1e-9,
  // The 16³ level intentionally exposes a measurable quality cost. These
  // are diagnostic acceptance bounds, not a claim that this is production
  // quality; the browser reports the measured values beside them.
  coarseRayAbs: 0.25,
  mixedRayAbs: 0.13,
} as const;

export type LodField = {
  readonly descriptor: DensityDescriptor;
  readonly data: Uint8Array;
};

export type Ray = {
  readonly origin: Vec3;
  readonly direction: Vec3;
  readonly maxDistance: number;
};

function index(x: number, y: number, z: number, size: number): number {
  return x + y * size + z * size * size;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash3(x: number, y: number, z: number): number {
  let value = Math.imul(x | 0, 0x45d9f3b);
  value = Math.imul(value ^ Math.imul(y | 0, 0x119de1f3), 0x45d9f3b);
  value = Math.imul(value ^ Math.imul(z | 0, 0x27d4eb2d), 0x165667b1);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function shapeNoise(x: number, y: number, z: number): number {
  const gx = x * 5.25, gy = y * 4.5, gz = z * 5.25;
  const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz);
  const tx = gx - x0, ty = gy - y0, tz = gz - z0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), sz = tz * tz * (3 - 2 * tz);
  const c = (dx: number, dy: number, dz: number) => hash3(x0 + dx, y0 + dy, z0 + dz);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), sx);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), sx);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), sx);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), sx);
  return lerp(lerp(x00, x10, sy), lerp(x01, x11, sy), sz);
}

function descriptor(resolution: number): DensityDescriptor {
  return {
    id: LOD_SOURCE_ID,
    revision: LOD_REVISION,
    dimensions: [resolution, resolution, resolution],
    bounds: { min: [...LOD_BOUNDS.min] as Vec3, max: [...LOD_BOUNDS.max] as Vec3 },
    // A useful diagnostic optical depth over roughly 1.8 km of cloud.
    extinctionScale: 0.0024,
    encoding: 'r8unorm',
  };
}

function validateResolution(resolution: number): void {
  if (!Number.isSafeInteger(resolution) || resolution < 1 || resolution > LOD_CANONICAL_RESOLUTION) {
    throw new RangeError(`LOD resolution must be an integer from 1 to ${LOD_CANONICAL_RESOLUTION}.`);
  }
  if (LOD_CANONICAL_RESOLUTION % resolution !== 0) {
    throw new RangeError(`LOD resolution ${resolution} must divide ${LOD_CANONICAL_RESOLUTION}.`);
  }
}

/** Weather plus a vertical profile produces the fixed canonical formation. */
export function createCanonicalField(resolution = LOD_CANONICAL_RESOLUTION): LodField {
  validateResolution(resolution);
  const weather = createWeatherSource({ seed: 17, scaleMetres: 1_800 });
  const data = new Uint8Array(resolution ** 3);
  const width = LOD_BOUNDS.max[0] - LOD_BOUNDS.min[0];
  const height = LOD_BOUNDS.max[1] - LOD_BOUNDS.min[1];
  const depth = LOD_BOUNDS.max[2] - LOD_BOUNDS.min[2];
  for (let z = 0; z < resolution; z++) {
    const pz = LOD_BOUNDS.min[2] + (z + 0.5) * depth / resolution;
    for (let y = 0; y < resolution; y++) {
      const py = LOD_BOUNDS.min[1] + (y + 0.5) * height / resolution;
      for (let x = 0; x < resolution; x++) {
        const px = LOD_BOUNDS.min[0] + (x + 0.5) * width / resolution;
        const source = weather.sample(px, pz, { coverage: 0.86, density: 1.15 });
        const relativeY = (py - source.baseMetres) / Math.max(1, source.topMetres - source.baseMetres);
        const profile = smoothstep(0.02, 0.16, relativeY) * (1 - smoothstep(0.7, 1, relativeY));
        const localX = (px - (LOD_BOUNDS.min[0] + LOD_BOUNDS.max[0]) * 0.5) / width + 0.5;
        const localY = (py - LOD_BOUNDS.min[1]) / height;
        const localZ = (pz - (LOD_BOUNDS.min[2] + LOD_BOUNDS.max[2]) * 0.5) / depth + 0.5;
        // A bounded lobe envelope makes this one formation rather than a slab
        // clipped by the diagnostic box. Weather still controls existence;
        // this envelope supplies the broad 3D identity shared by every LOD.
        const lobeA = 1 - smoothstep(0.52, 1.1, ((localX - 0.44) / 0.43) ** 2 + ((localY - 0.48) / 0.62) ** 2 + ((localZ - 0.5) / 0.42) ** 2);
        const lobeB = 1 - smoothstep(0.48, 1.05, ((localX - 0.7) / 0.27) ** 2 + ((localY - 0.6) / 0.42) ** 2 + ((localZ - 0.43) / 0.3) ** 2);
        const envelope = Math.max(0, Math.max(lobeA, lobeB));
        // Keep every face empty so rays enter and leave a formation cleanly;
        // this prevents the study box itself from becoming a hard cloud edge.
        const faceFade = smoothstep(0, 0.075, Math.min(localX, 1 - localX, localY, 1 - localY, localZ, 1 - localZ));
        const billow = 0.78 + 0.22 * shapeNoise(localX, localY, localZ);
        const value = clamp01(source.coverage * source.density * profile * envelope * faceFade * billow * 0.92);
        data[index(x, y, z, resolution)] = Math.round(value * 255);
      }
    }
  }
  return { descriptor: descriptor(resolution), data };
}

/** Volume-average a canonical field. Bounds, source id, and revision remain fixed. */
export function volumeAverage(source: LodField, resolution: number): LodField {
  return volumeAverageAxes(source, [resolution, resolution, resolution]);
}

/** Box-filter each axis independently; useful for tall fields with thin vertical profiles. */
export function volumeAverageAxes(source: LodField, dimensions: readonly [number, number, number]): LodField {
  const input = source.descriptor.dimensions;
  dimensions.forEach((n, axis) => {
    validateResolution(n);
    if (input[axis] % n !== 0) throw new Error('Target dimensions must divide the source dimensions.');
  });
  const ratio = dimensions.map((n, axis) => input[axis] / n);
  const data = new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2]);
  for (let z = 0; z < dimensions[2]; z++) for (let y = 0; y < dimensions[1]; y++) for (let x = 0; x < dimensions[0]; x++) {
    let sum = 0;
    for (let dz = 0; dz < ratio[2]; dz++) for (let dy = 0; dy < ratio[1]; dy++) for (let dx = 0; dx < ratio[0]; dx++) {
      sum += source.data[x * ratio[0] + dx + (y * ratio[1] + dy) * input[0] + (z * ratio[2] + dz) * input[0] * input[1]];
    }
    data[x + y * dimensions[0] + z * dimensions[0] * dimensions[1]] = Math.round(sum / (ratio[0] * ratio[1] * ratio[2]));
  }
  return { descriptor: { ...source.descriptor, dimensions }, data };
}

function assertCompatible(a: LodField, b: LodField): void {
  if (a.descriptor.id !== b.descriptor.id || a.descriptor.revision !== b.descriptor.revision) throw new Error('LOD fields have different source identity or revision.');
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(a.descriptor.bounds.min[axis] - b.descriptor.bounds.min[axis]) > OPTICAL_TEST_TOLERANCES.sameBoundsMetres || Math.abs(a.descriptor.bounds.max[axis] - b.descriptor.bounds.max[axis]) > OPTICAL_TEST_TOLERANCES.sameBoundsMetres) throw new Error('LOD fields must have matching bounds.');
  }
  if (a.descriptor.encoding !== b.descriptor.encoding || Math.abs(a.descriptor.extinctionScale - b.descriptor.extinctionScale) > OPTICAL_TEST_TOLERANCES.sameBoundsMetres) throw new Error('LOD fields must have matching encoding and extinction scale.');
}

/** Trilinear world-space lookup; both levels address the same physical box. */
export function sampleTrilinear(field: LodField, point: readonly [number, number, number]): number {
  for (let axis = 0; axis < 3; axis++) if (point[axis] < field.descriptor.bounds.min[axis] || point[axis] > field.descriptor.bounds.max[axis]) return 0;
  const [sizeX, sizeY, sizeZ] = field.descriptor.dimensions;
  const min = field.descriptor.bounds.min, max = field.descriptor.bounds.max;
  const coordinates = [
    (point[0] - min[0]) / (max[0] - min[0]) * sizeX - 0.5,
    (point[1] - min[1]) / (max[1] - min[1]) * sizeY - 0.5,
    (point[2] - min[2]) / (max[2] - min[2]) * sizeZ - 0.5,
  ];
  const lower = coordinates.map((value, axis) => Math.max(0, Math.min(field.descriptor.dimensions[axis] - 1, Math.floor(value))));
  const upper = lower.map((value, axis) => Math.min(field.descriptor.dimensions[axis] - 1, value + 1));
  const t = coordinates.map((value, axis) => Math.max(0, Math.min(1, value - lower[axis])));
  const c = (x: number, y: number, z: number) => field.data[x + y * sizeX + z * sizeX * sizeY] / 255;
  const x00 = lerp(c(lower[0], lower[1], lower[2]), c(upper[0], lower[1], lower[2]), t[0]);
  const x10 = lerp(c(lower[0], upper[1], lower[2]), c(upper[0], upper[1], lower[2]), t[0]);
  const x01 = lerp(c(lower[0], lower[1], upper[2]), c(upper[0], lower[1], upper[2]), t[0]);
  const x11 = lerp(c(lower[0], upper[1], upper[2]), c(upper[0], upper[1], upper[2]), t[0]);
  return lerp(lerp(x00, x10, t[1]), lerp(x01, x11, t[1]), t[2]);
}

export function blendDensity(coarse: LodField, fine: LodField, weight: number, point: readonly [number, number, number]): number {
  assertCompatible(coarse, fine);
  if (!Number.isFinite(weight)) throw new RangeError('LOD blend weight must be finite.');
  const w = clamp01(weight);
  return lerp(sampleTrilinear(coarse, point), sampleTrilinear(fine, point), w);
}

/** Build one field for the existing bounded renderer; this is a CPU upload diagnostic. */
export function createBlendedField(coarse: LodField, fine: LodField, weight: number): LodField {
  assertCompatible(coarse, fine);
  const resolution = fine.descriptor.dimensions[0];
  const data = new Uint8Array(resolution ** 3);
  const min = fine.descriptor.bounds.min, max = fine.descriptor.bounds.max;
  for (let z = 0; z < resolution; z++) for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    const point: Vec3 = [
      min[0] + (x + 0.5) * (max[0] - min[0]) / resolution,
      min[1] + (y + 0.5) * (max[1] - min[1]) / resolution,
      min[2] + (z + 0.5) * (max[2] - min[2]) / resolution,
    ];
    data[index(x, y, z, resolution)] = Math.round(blendDensity(coarse, fine, weight, point) * 255);
  }
  return { descriptor: { ...fine.descriptor }, data };
}

function rayBox(ray: Ray, bounds: Bounds3): [number, number] | undefined {
  let near = 0, far = ray.maxDistance;
  for (let axis = 0; axis < 3; axis++) {
    const direction = ray.direction[axis], origin = ray.origin[axis];
    if (Math.abs(direction) < 1e-12) {
      if (origin < bounds.min[axis] || origin > bounds.max[axis]) return undefined;
      continue;
    }
    const a = (bounds.min[axis] - origin) / direction, b = (bounds.max[axis] - origin) / direction;
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
  }
  return far > near ? [near, far] : undefined;
}

export function integrateTransmittance(field: LodField, ray: Ray, steps = 128): number {
  const interval = rayBox(ray, field.descriptor.bounds);
  if (!interval) return 1;
  const ds = (interval[1] - interval[0]) / steps;
  let opticalDepth = 0;
  for (let i = 0; i < steps; i++) {
    const distance = interval[0] + (i + 0.5) * ds;
    const point: Vec3 = [ray.origin[0] + ray.direction[0] * distance, ray.origin[1] + ray.direction[1] * distance, ray.origin[2] + ray.direction[2] * distance];
    opticalDepth += sampleTrilinear(field, point) * field.descriptor.extinctionScale * ds;
  }
  return Math.exp(-opticalDepth);
}

export function integrateBlendedTransmittance(coarse: LodField, fine: LodField, weight: number, ray: Ray, steps = 128): number {
  assertCompatible(coarse, fine);
  const interval = rayBox(ray, fine.descriptor.bounds);
  if (!interval) return 1;
  const ds = (interval[1] - interval[0]) / steps;
  let opticalDepth = 0;
  for (let i = 0; i < steps; i++) {
    const distance = interval[0] + (i + 0.5) * ds;
    const point: Vec3 = [ray.origin[0] + ray.direction[0] * distance, ray.origin[1] + ray.direction[1] * distance, ray.origin[2] + ray.direction[2] * distance];
    opticalDepth += blendDensity(coarse, fine, weight, point) * fine.descriptor.extinctionScale * ds;
  }
  return Math.exp(-opticalDepth);
}

export function fixedDiagnosticRays(): readonly Ray[] {
  const rays: Ray[] = [
    { origin: [-600, 1_450, 0], direction: [1, 0, 0], maxDistance: 1_500 },
    { origin: [0, 1_450, -700], direction: [0, 0, 1], maxDistance: 1_500 },
    { origin: [-520, 1_120, -520], direction: [1 / Math.sqrt(2), 0, 1 / Math.sqrt(2)], maxDistance: 1_700 },
    { origin: [0, 2_900, 0], direction: [0, -1, 0], maxDistance: 2_600 },
    { origin: [-700, 1_260, -420], direction: [0.88, 0.12, 0.46], maxDistance: 1_900 },
    { origin: [640, 1_000, 360], direction: [-0.78, 0.2, -0.59], maxDistance: 1_900 },
  ];
  return rays.map(ray => {
    const length = Math.hypot(...ray.direction);
    return { ...ray, direction: ray.direction.map(value => value / length) as unknown as Vec3 };
  });
}

export function fixedRayErrors(coarse: LodField, canonical: LodField): { coarseMaxAbs: number; mixedAtHalfMaxAbs: number; coarseValues: number[]; canonicalValues: number[] } {
  const coarseValues = fixedDiagnosticRays().map((ray) => integrateTransmittance(coarse, ray));
  const canonicalValues = fixedDiagnosticRays().map((ray) => integrateTransmittance(canonical, ray));
  const mixedValues = fixedDiagnosticRays().map((ray) => integrateBlendedTransmittance(coarse, canonical, 0.5, ray));
  return {
    coarseMaxAbs: Math.max(...coarseValues.map((value, i) => Math.abs(value - canonicalValues[i]))),
    mixedAtHalfMaxAbs: Math.max(...mixedValues.map((value, i) => Math.abs(value - canonicalValues[i]))),
    coarseValues,
    canonicalValues,
  };
}

/** Error introduced when the blended float intent is quantized to the r8 upload field. */
export function r8UploadError(coarse: LodField, fine: LodField, weight: number, uploadedField?: LodField): number {
  const uploaded = uploadedField ?? createBlendedField(coarse, fine, weight);
  const resolution = uploaded.descriptor.dimensions[0];
  const min = uploaded.descriptor.bounds.min, max = uploaded.descriptor.bounds.max;
  let maximum = 0;
  for (let z = 0; z < resolution; z += 4) for (let y = 0; y < resolution; y += 4) for (let x = 0; x < resolution; x += 4) {
    const point: Vec3 = [min[0] + (x + 0.5) * (max[0] - min[0]) / resolution, min[1] + (y + 0.5) * (max[1] - min[1]) / resolution, min[2] + (z + 0.5) * (max[2] - min[2]) / resolution];
    maximum = Math.max(maximum, Math.abs(sampleTrilinear(uploaded, point) - blendDensity(coarse, fine, weight, point)));
  }
  return maximum;
}

export type FineResidency = 'pending' | 'ready' | 'evicted';
export type LodSnapshot = {
  readonly fine: FineResidency;
  readonly revision: number;
  readonly requestToken: number;
  readonly projectedVoxelPixels: number;
  readonly requested: boolean;
  readonly weight: number;
  readonly readiness: number;
};

export const LOD_HYSTERESIS = { enterPixels: 2.5, exitPixels: 1.5 } as const;

/** Coarse stays resident while fine requests are intentionally reorderable. */
export class LodResidencyController {
  readonly coarse: LodField;
  readonly canonical: LodField;
  readonly revision: number;
  private fineField: LodField | undefined;
  private token = 0;
  private fineState: FineResidency = 'evicted';
  private requested = false;
  private readiness = 0;
  private lastUpdateTime = 0;

  constructor(canonical: LodField, coarse: LodField, revision = LOD_REVISION) {
    assertCompatible(canonical, coarse);
    if (canonical.descriptor.revision !== revision) throw new Error('Unexpected LOD revision.');
    this.canonical = canonical; this.coarse = coarse; this.revision = revision;
  }

  beginFineRequest(): number {
    this.token++;
    this.fineState = 'pending';
    this.fineField = undefined;
    this.readiness = 0;
    return this.token;
  }

  resolveFine(requestToken: number, field: LodField): boolean {
    if (requestToken !== this.token || this.fineState !== 'pending' || field.descriptor.revision !== this.revision) return false;
    try { assertCompatible(this.canonical, field); } catch { return false; }
    this.fineField = field; this.fineState = 'ready'; this.readiness = 0;
    return true;
  }

  rejectFine(requestToken: number): boolean {
    if (requestToken !== this.token) return false;
    this.token++; this.fineState = 'evicted'; this.fineField = undefined; this.readiness = 0;
    return true;
  }

  evictFine(): void {
    this.token++;
    this.fineState = 'evicted';
    this.fineField = undefined;
    this.readiness = 0;
  }

  setRequested(value: boolean): void { this.requested = value; }

  get fine(): LodField | undefined { return this.fineField; }
  get state(): FineResidency { return this.fineState; }
  get requestToken(): number { return this.token; }

  projectedVoxelSize(cameraDistance: number, viewportHeight = 720, verticalFovRadians = Math.PI / 3, resolution = this.coarse.descriptor.dimensions[0]): number {
    if (!(cameraDistance > 0) || !(viewportHeight > 0) || !(verticalFovRadians > 0)) throw new RangeError('Camera projection inputs must be positive.');
    const voxel = Math.max(...this.coarse.descriptor.bounds.max.map((value, axis) => (value - this.coarse.descriptor.bounds.min[axis]) / (resolution === this.coarse.descriptor.dimensions[0] ? this.coarse.descriptor.dimensions[axis] : resolution)));
    return voxel / cameraDistance * viewportHeight / (2 * Math.tan(verticalFovRadians / 2));
  }

  update(cameraDistance: number, viewportHeight = 720, verticalFovRadians = Math.PI / 3, timeSeconds = 0): LodSnapshot {
    const elapsed = Math.max(0, timeSeconds - this.lastUpdateTime);
    this.lastUpdateTime = timeSeconds;
    if (this.fineState === 'ready') this.readiness = Math.min(1, this.readiness + elapsed / 0.45);
    else this.readiness = 0;
    const projected = this.projectedVoxelSize(cameraDistance, viewportHeight, verticalFovRadians);
    if (this.requested) this.requested = projected >= LOD_HYSTERESIS.exitPixels;
    else this.requested = projected >= LOD_HYSTERESIS.enterPixels;
    const targetWeight = clamp01((projected - LOD_HYSTERESIS.exitPixels) / (LOD_HYSTERESIS.enterPixels - LOD_HYSTERESIS.exitPixels));
    return { fine: this.fineState, revision: this.revision, requestToken: this.token, projectedVoxelPixels: projected, requested: this.requested, weight: this.fineState === 'ready' ? targetWeight * this.readiness : 0, readiness: this.readiness };
  }
}
