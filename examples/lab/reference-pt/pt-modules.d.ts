// PT1: the slice of the owner's sibling path tracer (../pathtracer: `@pmndrs/pathtracer`, `@pmndrs/raytracer`, both TS sources with no
// dist) that the reference-pt page uses. Vite aliases the two names to that checkout's sources (vite.config.ts pathtracerAliases); these
// declarations keep `tsc` independent of whether the sibling is checked out. Signatures copied from its sources (2026-11-20, main 0e4435b).
declare module '@pmndrs/raytracer' {
  export type Caps = { readonly subgroups?: boolean } & Record<string, unknown>;
  export function detectCaps(adapter: GPUAdapter, wgslLanguageFeatures?: ReadonlySet<string>): Caps;
  export function requestDeviceForCaps(adapter: GPUAdapter, caps: Caps, options?: { label?: string }): Promise<{ device: GPUDevice; caps: Caps }>;
  export interface RtMaterialInput { baseColor?: readonly [number, number, number]; baseWeight?: number; specularWeight?: number; metalness?: number; specularRoughness?: number }
  export interface SceneCopyMesh { positions: Float32Array; indices?: ArrayLike<number> | null; normals?: ArrayLike<number> | null }
  export interface SceneCopyInstance { instanceIndex: number; meshIndex: number; objectToWorld: ArrayLike<number>; material?: number; visible?: boolean; mask?: number }
  export interface SunInput { direction: readonly [number, number, number]; irradiance: readonly [number, number, number]; angularRadius?: number }
  export interface EnvMapInput { width: number; height: number; channels: number; data: ArrayLike<number> }
  export interface EnvironmentInput { radiance?: readonly [number, number, number]; map?: EnvMapInput; scale?: number; rotationY?: number }
  export interface SceneCopyInput {
    meshes: readonly SceneCopyMesh[];
    instances: readonly SceneCopyInstance[];
    materials: readonly RtMaterialInput[];
    sun?: SunInput | null;
    environment?: EnvironmentInput | null;
    options?: { surface?: { normals?: boolean; uvs?: boolean; positions?: boolean } };
  }
  export interface SceneCopy { layout: unknown; textureLayout: unknown; byteLength: number }
  export interface SceneCopyBuffers { packing: string; destroy?(): void }
  export function buildSceneCopy(input: SceneCopyInput): SceneCopy;
  export function uploadSceneCopy(device: GPUDevice, copy: SceneCopy, options?: { label?: string }): SceneCopyBuffers;
  export function envMapMean(img: EnvMapInput): [number, number, number];
  export function sceneFormatOf(format: { nodeFormat: string; triangleLeaves?: unknown; positionLayout?: unknown }): unknown;
}

declare module '@pmndrs/pathtracer' {
  import type { Caps, SceneCopyBuffers } from '@pmndrs/raytracer';
  export type VolRgb = readonly [number, number, number];
  export interface PtMediumGrid { resolution: readonly [number, number, number]; worldToIndex: readonly number[]; densityMax: number }
  export interface PtMedium { sigmaT: VolRgb; albedo: VolRgb; g: number; grid?: PtMediumGrid }
  export interface PtMaterialVolume { interior: number; exterior: number; boundary: boolean }
  export interface PtVolumeOptions { media: readonly PtMedium[]; materials: readonly PtMaterialVolume[]; cameraMedium?: number; shadowTracking?: 'analytic' | 'ratio'; majorant?: 'global' | 'brick' }
  export interface PtIntegratorOptions {
    sampler?: 'owen-sobol' | 'independent' | 'bluenoise' | string;
    nee?: boolean;
    envSampling?: 'uniform' | 'importance' | 'none';
    envMap?: boolean;
    sunVisible?: boolean;
    volumes?: PtVolumeOptions | null;
  }
  export interface PtLookAtCamera { position: VolRgb; target: VolRgb; up: VolRgb; yFovDeg: number }
  export interface PtLimits { maxDepth: number; rrStartDepth?: number }
  export interface PtMegakernelOptions {
    format: unknown;
    layout: unknown;
    textures?: unknown;
    integrator?: PtIntegratorOptions;
    volumeGrid?: { resolution: readonly [number, number, number]; density: Float32Array; majorant?: { resolution: readonly [number, number, number]; values: Float32Array } };
    label?: string;
  }
  export class PtMegakernel {
    static create(device: GPUDevice, caps: Caps, options: PtMegakernelOptions): Promise<PtMegakernel>;
    readonly wgslBytes: number;
    setScene(trace: unknown, scene: SceneCopyBuffers): void;
    setFilm(width: number, height: number): void;
    setCamera(camera: PtLookAtCamera): void;
    setLimits(limits: PtLimits): void;
    setSeed(seed: number): void;
    reset(encoder: GPUCommandEncoder): void;
    encode(encoder: GPUCommandEncoder, passes: number): void;
    readonly accumulator: GPUBuffer | null;
    destroy(): void;
  }
  export function gridWorldToIndex(resolution: readonly [number, number, number], bounds: readonly [VolRgb, VolRgb], toWorld?: readonly number[]): number[];
  export function brickMajorants(resolution: readonly [number, number, number], data: ArrayLike<number>): { resolution: [number, number, number]; values: Float32Array };
}

declare module '@pmndrs/bvh' {
  export interface MeshBvhBuilder { build(geometry: unknown): Promise<unknown>; dispose(): void }
  export function createMeshBvhBuilder(): MeshBvhBuilder;
  export interface TraceSceneData { readonly nodeFormat: string }
  export interface TraceSceneBuffers { readonly nodeFormat: string; readonly triangleLeaves: unknown; readonly positionLayout: unknown; destroy?(): void }
  export function buildTraceScene(
    inputs: readonly { positions: Float32Array; indices: Uint32Array | null }[],
    instances: readonly { meshIndex: number; instanceIndex: number; objectToWorld: ArrayLike<number>; material?: number; mask?: number; static?: boolean }[],
    options: { build: (geometry: unknown) => Promise<unknown>; mergeStaticInstances?: boolean },
  ): Promise<TraceSceneData>;
  export function uploadTraceScene(device: GPUDevice, scene: TraceSceneData, label?: string): TraceSceneBuffers;
}
