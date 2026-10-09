// X1: the interface between the runtime (runtime.ts, sky-layer.ts) and a procedural density model. The core imports only this type, so the
// procedural code (procedural/index.ts) is not in the core bundle: a page creates the model and hands it to `CloudRuntime.setProceduralModel`.
// The model owns its trace pipeline and bind group; the sky layer gives it its pass layout and resources and runs the pass, the resolve and the copy.

export interface ProceduralDensityModel {
  /** True once its textures are loaded and its parameters can be written. */
  readonly ready: boolean;
  /**
   * The trace pipeline ('trace' entry) for this lighting mode, compiled asynchronously on first request: null until it is ready. Its layout is
   * [volume, the layer's pass entries plus the model's own, atmosphere (atmosphere mode only)].
   */
  pipeline(mode: 'atmosphere' | 'uniform', layouts: { volume: GPUBindGroupLayout; pass: GPUBindGroupLayoutEntry[]; atmosphere: GPUBindGroupLayout }): GPUComputePipeline | null;
  /** The pass's group 1: the layer's entries (all but its weather binding, which the model fills) plus the model's. Rebuilt when `key` or the model's resources change. */
  bindGroup(entries: GPUBindGroupEntry[], key: readonly unknown[]): GPUBindGroup;
  /** Write this frame's parameters. Returns a version that changes when the model changes (a history cut). */
  update(time: number): { version: number };
  dispose(): void;
}
