import { WebGPURenderer } from 'three/webgpu';

/** Lab host setup: request only features needed by this example. */
export async function createLabRenderer(options: NonNullable<ConstructorParameters<typeof WebGPURenderer>[0]> = {}, timing = false) {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter is available.');
  const requiredFeatures: GPUFeatureName[] = timing && adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
  const device = await adapter.requestDevice({ requiredFeatures });
  const renderer = new WebGPURenderer({ ...options, device });
  try { await renderer.init(); } catch (error) { device.destroy(); throw error; }
  const originalDispose = renderer.dispose.bind(renderer);
  let disposed = false;
  renderer.dispose = async () => { if (disposed) return; disposed = true; await originalDispose(); device.destroy(); };
  return renderer;
}
