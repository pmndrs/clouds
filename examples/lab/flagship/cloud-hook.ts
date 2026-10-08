import type { Camera, Scene, WebGPURenderer } from 'three/webgpu';
import type { Sky } from '@pmndrs/sky';
import type { GpuTimer } from '@clouds/runtime';

export interface CloudPassContext {
  renderer: WebGPURenderer;
  device: GPUDevice;
  camera: Camera;
  scene: Scene;
  sky: Sky;
  timer: GpuTimer;
  /** Shared encoder for this frame. Pass `timer.passTimestampWrites(name)` to compute/render passes; the frame loop calls timer.endFrame(encoder) and submits it. */
  encoder: GPUCommandEncoder;
  quality: string;
  renderSize: { width: number; height: number };
  /** Seconds since start, for jitter/noise animation. */
  time: number;
  frame: number;
}

/**
 * ===== P1 HOOK: the cloud pass goes here. =====
 * Called once per frame, synchronously, after sky.update() and before three renders the scene.
 * Contract: record GPU commands only (into ctx.encoder); never await, never read back, never block the frame.
 * Replace this function (or set `cloudPass.current`) from the P1 tasks.
 */
export const cloudPass: { current: (ctx: CloudPassContext) => void } = { current: () => {} };
