// X1: the interface between the runtime (runtime.ts, sky-layer.ts) and a procedural density model. The core imports only this type, so the
// procedural code (procedural/index.ts) is not in the core bundle: a page creates the model and hands it to `CloudRuntime.setProceduralModel`.
// The model owns its trace pipeline and bind group; the sky layer gives it its pass layout and resources and runs the pass, the resolve and the copy.
// X3: the model also hands its density WGSL and resources to other passes (the cloud shadow map, the reflection dome), which build their own pipelines.

/** L3: what the model asks the runtime to draw as the mid-level 2.5D layer (the cirrus layer's model at the mid slot's altitude). */
export interface MidLayerState {
  mode: 'layer' | 'hybrid';
  form: 'altocumulus' | 'altostratus';
  altitude: number;
  thickness: number;
  coverage: number;
  type: number;
  veil: number;
  opticalDepth: number;
  /** Noise tile size (m). */
  scale: number;
  detail: number;
  windOffset: [number, number];
  /** Streak / tile direction, degrees from +x toward +z. */
  streakAngle: number;
  /** Weather-map influence 0..1, and the map (a 2-layer 2D array) with its tile and drifted offset (m). */
  ndfInfluence: number;
  /** The layer type where the map's top type is stratiform (0) and cumuliform (1). */
  typeStratiform: number;
  typeCumuliform: number;
  ndf: { view: GPUTextureView; tileMeters: number; offset: [number, number] } | null;
  /** Hybrid cross-fade distances (m); 0, 0 in 'layer' mode. */
  fadeStart: number;
  fadeEnd: number;
}

export interface ProceduralDensityModel {
  /** True once its textures are loaded and its parameters can be written. */
  readonly ready: boolean;
  /**
   * The trace pipeline ('trace' entry) for this lighting mode, compiled asynchronously on first request: null until it is ready. Its layout is
   * [volume, the layer's pass entries plus the model's own, atmosphere (atmosphere mode only)].
   */
  pipeline(mode: 'atmosphere' | 'uniform', layouts: { volume: GPUBindGroupLayout; pass: GPUBindGroupLayoutEntry[]; atmosphere: GPUBindGroupLayout }): GPUComputePipeline | null;
  /** The pass's group 1: the layer's entries (all but its weather binding, which the model fills) plus the model's. Cached by `key` and the model's resources. */
  bindGroup(entries: GPUBindGroupEntry[], key: readonly unknown[]): GPUBindGroup;
  /**
   * Write this frame's parameters (`view`: the camera, the curvature reference, and CloudSettings.windOffset). Returns a version that changes
   * when the model changes (a history cut), not when only the view moves.
   */
  update(time: number, view: { camera: ArrayLike<number>; wind: ArrayLike<number> }): { version: number };
  /** L3: the mid-level 2.5D layer to draw this frame, or null (volume mode, no alto form in the mid slot, other shapers). As of the last `update`. */
  readonly midLayer?: MidLayerState | null;
  /** C2: the fraction of the wind offset the visible clouds follow (the temporal reprojection shifts its history by it). Absent = 1. */
  readonly motionSpeed?: number;
  /** SH1: the fraction of the wind offset the cloud bodies follow as the ground shadow sees them (HZD: the mean of the shape and detail noise speeds; the weather map's own, slower drift only gates where bodies form). The shadow map slides by it. Absent = motionSpeed. */
  readonly shadowSpeed?: number;
  /** X3: the version `update` last returned. */
  readonly version: number;
  /** X3: the lowest and highest altitude (m) the model's clouds can reach, as of the last `update`. */
  readonly shell: readonly [number, number];
  /** X3: the model's density for another pass: ProcParams `P`, its bindings in `group` from binding `base`, procSample(p, t, footprint, full, jitter). Needs COMMON_WGSL before it. */
  densityWgsl(group: number, base: number): string;
  /** X3: a key for pipelines built from `densityWgsl` (it changes with the shaper). */
  readonly wgslKey: string;
  /** X3: layout and bind group entries of `densityWgsl`'s bindings. `resourceKey` changes identity when the entries do. */
  layoutEntries(base: number, visibility: number): GPUBindGroupLayoutEntry[];
  resourceEntries(base: number): GPUBindGroupEntry[];
  readonly resourceKey: object;
  /** X3: the procedural lighting model (the dome uses it for the model's clouds). */
  readonly lightingModel: 'nubis' | 'octave';
  dispose(): void;
}
