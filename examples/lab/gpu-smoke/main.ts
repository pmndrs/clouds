// Capture-harness self-test: a compute-free WebGPU clear whose colour cycles, plus the window.__clouds contract.
import { installCloudsHarness } from '../harness/clouds-contract';

const harness = installCloudsHarness();
const adapter = await navigator.gpu?.requestAdapter();
if (!adapter) harness.fail('WebGPU adapter unavailable');
else {
  const device = await adapter.requestDevice();
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
  const context = canvas.getContext('webgpu')!;
  context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat() });
  let frame = 0;
  const loop = () => {
    const t = frame++ / 120;
    const encoder = device.createCommandEncoder();
    encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.2 + 0.2 * Math.sin(t), g: 0.45, b: 0.8, a: 1 } }] }).end();
    device.queue.submit([encoder.finish()]);
    harness.frame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  harness.ready({ report: () => ({ frames: frame, adapter: adapter.info?.architecture }) });
}
