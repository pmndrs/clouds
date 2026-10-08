/** Contract v0: right-handed world, metres, column-major matrices, linear HDR. */
export const CONTRACT_VERSION = 0 as const;
export type Vec3 = readonly [number, number, number];
export interface Bounds3 { readonly min: Vec3; readonly max: Vec3 }
export interface DensityDescriptor {
  readonly id: string;
  readonly revision: number;
  readonly dimensions: Vec3;
  readonly bounds: Bounds3;
  /** Density is dimensionless; this maps it to extinction in inverse metres. */
  readonly extinctionScale: number;
  readonly encoding: 'r8unorm' | 'r16float' | 'r32float';
}
export interface FrameContext {
  readonly viewId: string;
  readonly frameIndex: number;
  readonly timeSeconds: number;
  readonly deltaSeconds: number;
  readonly renderSize: readonly [number, number];
  readonly outputSize: readonly [number, number];
  readonly cameraCut: boolean;
  readonly depthConvention: 'webgpu-zero-to-one' | 'webgpu-reversed';
}
export interface DirectionalSun {
  /** Unit direction from sample toward sun; scene shadow provider is host-specific. */
  readonly direction: Vec3;
  readonly radiance: Vec3;
}
export interface ResourceContract {
  readonly label: string;
  readonly owner: 'three' | 'clouds';
  readonly producer: string;
  readonly consumers: readonly string[];
  readonly revision: number;
}
export interface Disposable { dispose(): void }
export function validateDensityDescriptor(d: DensityDescriptor): void {
  if (!d || typeof d !== 'object') throw new Error('Invalid density descriptor');
  if (!Array.isArray(d.dimensions) || d.dimensions.length !== 3 || !d.bounds || !Array.isArray(d.bounds.min) || !Array.isArray(d.bounds.max) || d.bounds.min.length !== 3 || d.bounds.max.length !== 3) throw new Error('Density dimensions and bounds must have exactly three components');
  if (typeof d.id !== 'string' || !d.id || !Number.isSafeInteger(d.revision) || d.revision < 0) throw new Error('Invalid density identity/revision');
  if (!d.dimensions.every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Density dimensions must be positive integers');
  if (!Number.isFinite(d.extinctionScale) || d.extinctionScale < 0) throw new Error('Extinction scale must be finite and nonnegative');
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(d.bounds.min[i]) || !Number.isFinite(d.bounds.max[i]) || d.bounds.min[i] >= d.bounds.max[i]) throw new Error('Invalid density bounds');
  }
  if (!['r8unorm', 'r16float', 'r32float'].includes(d.encoding)) throw new Error('Unsupported density encoding');
}
/** Payload only: excludes driver allocations, upload staging and any mip chain. */
export function densityPayloadBytes(d: DensityDescriptor): number {
  validateDensityDescriptor(d);
  const bytes = d.dimensions.reduce((a, b) => a * b, 1) * ({ r8unorm: 1, r16float: 2, r32float: 4 }[d.encoding]);
  if (!Number.isSafeInteger(bytes)) throw new Error('Density payload exceeds safe integer range');
  return bytes;
}
/** Homogeneous reference, also used to validate a later GPU integrator. */
export function homogeneousTransmittance(extinctionPerMetre: number, distanceMetres: number): number {
  if (![extinctionPerMetre, distanceMetres].every(n => Number.isFinite(n) && n >= 0)) throw new Error('Extinction and distance must be finite and nonnegative');
  return Math.exp(-extinctionPerMetre * distanceMetres);
}
