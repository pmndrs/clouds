// X1: the interface between the runtime (runtime.ts, sky-layer.ts) and a procedural density model. The core imports only this type, so the
// procedural code (procedural/index.ts) is not in the core bundle: a page creates the model and hands it to `CloudRuntime.setProceduralModel`.

export interface ProceduralDensityModel {
  /** True once its textures are loaded and its parameters can be written. */
  readonly ready: boolean;
  /** Identity of the compiled variant (the shaper): the sky layer compiles one trace pipeline per key and lighting mode. */
  readonly pipelineKey: string;
  /** The trace pass's WGSL after COMMON_WGSL + volumeWgsl(0) (entry point `trace`), for 'atmosphere' or 'uniform' lighting. */
  traceCode(mode: 'atmosphere' | 'uniform'): string;
  /** Group-1 layout entries beyond the sky layer's (bindings 9..). */
  readonly layoutEntries: GPUBindGroupLayoutEntry[];
  /** The resources for those entries; `resourceKey` changes identity whenever they do. */
  bindGroupEntries(): GPUBindGroupEntry[];
  readonly resourceKey: unknown;
  /** Write this frame's parameters. Returns the shell (min, max altitude in metres) and a version that changes when the model changes (a history cut). */
  update(time: number): { shell: [number, number]; version: number };
  dispose(): void;
}
