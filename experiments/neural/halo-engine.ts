// N5.12: HaloRT on our WGSL engine (./engine/), fully on the GPU, for the live /neural/ page.
// Input: FeaturePass.packed as is ([17, H, W] planar f32, rdv pixel order, the same buffer ONNX Runtime reads). The engine's
// first conv gathers its 8 channels per batch item from that buffer itself (HALO_GATHER_B6: items 0-2 `dir` passes 0-2 =
// depth, c1-c3, tr, g, nee, sa_k; items 3-5 `env` = ..., env_k, sa_k), so no separate gather pass is needed, and no 180° turn
// here: packed is already in rdv order, and so are the network output and the blended radiance.
// After the network, a blend op (halonet_ref.py `compose`, the step the ONNX graph does inside itself):
//   radiance[k] = (dir_k * light[k] + envScale[k] * env_k) * S + background[k] * envScale[k] * (1 - S),  S = packed 13, background = 14-16
// written as [3, H, W] f32 in rdv order: the layout the ONNX `radiance` output has, so the page's accumulate + display is shared.
import { Engine, type Binding } from './engine/runtime';
import { HALO_GATHER_B6, haloNetGraph } from './engine/graph';
import { parseTZA } from './engine/tza';

/** Network output: [6][1][H][W] in NC4HW4 (C4 = 1: one vec4 per pixel, value in .x). f16 activations are read as u32 pairs. */
const blendWgsl = (f16: boolean) => /* wgsl */ `
struct P { plane: u32, _a: u32, _b: u32, _c: u32, light: vec4f, envScale: vec4f }
@group(0) @binding(0) var<uniform> U: P;
@group(0) @binding(1) var<storage, read> cond: array<f32>;
@group(0) @binding(2) var<storage, read> net: array<${f16 ? 'u32' : 'f32'}>;
@group(0) @binding(3) var<storage, read_write> radiance: array<f32>;
fn netAt(j: u32) -> f32 { ${f16 ? 'return unpack2x16float(net[j * 2u]).x;' : 'return net[j * 4u];'} }
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = U.plane;
  let i = id.y * 65535u * 64u + id.x;
  if (i >= n) { return; }
  let s = cond[13u * n + i];
  for (var k = 0u; k < 3u; k++) {
    let dir = netAt(k * n + i);
    let env = netAt((3u + k) * n + i);
    radiance[k * n + i] = (dir * U.light[k] + U.envScale[k] * env) * s + cond[(14u + k) * n + i] * U.envScale[k] * (1.0 - s);
  }
}`;

export class HaloEngine {
  private readonly params: GPUBuffer;
  private readonly blendPipe: GPUComputePipeline;
  private readonly blendGroup: GPUBindGroup;

  private constructor(private readonly device: GPUDevice, readonly size: number, readonly f16: boolean, private readonly engine: Engine,
    private readonly binding: Binding, output: number, input: GPUBuffer, radiance: GPUBuffer, readonly dispatches: number) {
    this.params = device.createBuffer({ label: 'halo engine blend params', size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.blendPipe = device.createComputePipeline({ label: 'halo engine blend', layout: 'auto', compute: { module: device.createShaderModule({ label: 'halo engine blend', code: blendWgsl(f16) }), entryPoint: 'main' } });
    this.blendGroup = device.createBindGroup({ layout: this.blendPipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.params } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: binding.buffer(output) } },
      { binding: 3, resource: { buffer: radiance } },
    ] });
  }

  /** `input` = FeaturePass.packed (needs STORAGE), `radiance` = [3, size, size] f32 target (e.g. HaloNet.output); weights = halo_dir.tza, halo_env.tza. */
  static async create(device: GPUDevice, size: number, input: GPUBuffer, radiance: GPUBuffer, weights: [ArrayBuffer, ArrayBuffer], f16: boolean): Promise<HaloEngine> {
    const { graph, output } = haloNetGraph(HALO_GATHER_B6);
    const engine = await Engine.create(device, graph, [parseTZA(weights[0]), parseTZA(weights[1])], { f16, batch: 6, setSplit: 3 });
    const binding = engine.bind(size, input);
    return new HaloEngine(device, size, f16, engine, binding, output, input, radiance, engine.dispatches + 1);
  }

  /** One frame: network (one pass, one submit), then the blend into `radiance` (second submit). */
  run(lightIntensity: readonly number[], environmentScale: readonly number[]): void {
    const p = new ArrayBuffer(48);
    new Uint32Array(p, 0, 1)[0] = this.size * this.size;
    new Float32Array(p, 16, 8).set([...lightIntensity.slice(0, 3), 0, ...environmentScale.slice(0, 3), 0]);
    this.device.queue.writeBuffer(this.params, 0, p);
    this.binding.run();
    const enc = this.device.createCommandEncoder({ label: 'halo engine blend' });
    const pass = enc.beginComputePass();
    pass.setPipeline(this.blendPipe);
    pass.setBindGroup(0, this.blendGroup);
    const groups = Math.ceil((this.size * this.size) / 64);
    pass.dispatchWorkgroups(Math.min(groups, 65535), Math.ceil(groups / 65535));
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  release(): void { this.binding.release(); this.engine.release(); this.params.destroy(); }
}
