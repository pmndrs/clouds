export interface SkyProView {
  position: readonly [number, number, number];
  forward: readonly [number, number, number];
  fov: number;
  sunAz: number;
  sunEl: number;
  coverage: number;
  exposure: number;
}
export interface SkyProPane {
  ready(): boolean;
  resize(w: number, h: number): void;
  render(view: SkyProView): void;
  gpuMs(): Record<string, number> | null;
  diagnostics(): Record<string, unknown>;
}
export function createSkyProPane(canvas: HTMLCanvasElement, options: { groundAlbedo: [number, number, number]; groundShadows?: boolean }): Promise<SkyProPane>;
