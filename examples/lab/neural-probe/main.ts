export {};
// N5.1: is ORT's missing ~100 ms a per-dispatch cost? Synthetic chain of dependent compute dispatches.
// Each step has its own pipeline and bind group (like ORT): setPipeline + setBindGroup + dispatchWorkgroups.
const N = 262144; // elements per buffer (512 x 512)
const WG = 64;
const BIG = { n1825: 32 }; // iterations per element per dispatch in the 1825 case
const ITERS_82 = Math.round((BIG.n1825 * 1825) / 82); // same total arithmetic in 82 dispatches
const WARM = 5, RUNS = 20;

interface Row { case: string; dispatches: number; passes: number; wallMs: number; msPerDispatch: number; encodeMs: number; iters: number }

const setStatus = (s: string) => { (document.getElementById('status') as HTMLElement).textContent = s; };
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

async function main() {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no adapter');
  const device = await adapter.requestDevice();
  const info = (adapter as any).info ?? {};
  const bufs = [0, 1, 2].map(() => device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE }));
  const bgl = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } } ] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });

  const cache = new Map<string, { pipes: GPUComputePipeline[]; groups: GPUBindGroup[] }>();
  async function build(count: number, iters: number) {
    const key = `${count}/${iters}`;
    if (cache.has(key)) return cache.get(key)!;
    const pipes: GPUComputePipeline[] = [], groups: GPUBindGroup[] = [];
    const promises: Promise<GPUComputePipeline>[] = [];
    const mods: GPUShaderModule[] = [];
    for (let i = 0; i < count; i++) {
      // 24 distinct modules (distinct constant) shared round-robin; every step still gets its own pipeline object and bind group
      if (!mods[i % 24]) mods[i % 24] = device.createShaderModule({ code: src(i % 24) });
      promises.push(device.createComputePipelineAsync({ layout, compute: { module: mods[i % 24], entryPoint: 'main' } }));
      groups.push(device.createBindGroup({ layout: bgl, entries: [
        { binding: 0, resource: { buffer: bufs[i % 3] } }, { binding: 1, resource: { buffer: bufs[(i + 1) % 3] } }] }));
    }
    function src(i: number) {
      return `@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read_write> b: array<f32>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  var x = a[id.x] + ${(1 + i * 1e-4).toFixed(6)};
  let n = ${iters}u + u32(abs(a[0]) * 0.0); // runtime trip count: no unrolling difference between cases
  for (var k = 0u; k < n; k++) { x = fma(x, 0.99991, 0.0003); }
  b[id.x] = x;
}`;
    }
    for (const p of promises) pipes.push(await p);
    cache.set(key, { pipes, groups });
    return { pipes, groups };
  }

  async function run(label: string, count: number, iters: number, passes: number): Promise<Row> {
    status(`building ${label}`);
    const { pipes, groups } = await build(count, iters);
    const wall: number[] = [], enc: number[] = [];
    for (let r = 0; r < WARM + RUNS; r++) {
      const t0 = performance.now();
      const e = device.createCommandEncoder();
      let i = 0;
      for (let p = 0; p < passes; p++) {
        const n = Math.floor(((p + 1) * count) / passes) - Math.floor((p * count) / passes);
        const pass = e.beginComputePass();
        for (let j = 0; j < n; j++, i++) { pass.setPipeline(pipes[i]); pass.setBindGroup(0, groups[i]); pass.dispatchWorkgroups(N / WG); }
        pass.end();
      }
      device.queue.submit([e.finish()]);
      const t1 = performance.now();
      await device.queue.onSubmittedWorkDone();
      const t2 = performance.now();
      if (r >= WARM) { wall.push(t2 - t0); enc.push(t1 - t0); }
    }
    const w = median(wall);
    return { case: label, dispatches: count, passes, wallMs: w, msPerDispatch: w / count, encodeMs: median(enc), iters };
  }

  const I = BIG.n1825;
  const rows: Row[] = [];
  rows.push(await run('a: 1825 work, 1 pass', 1825, I, 1));
  rows.push(await run('b: 82 work (same total), 1 pass', 82, ITERS_82, 1));
  rows.push(await run('c: 1825 near-empty, 1 pass', 1825, 1, 1));
  rows.push(await run('d: 82 near-empty, 1 pass', 82, 1, 1));
  rows.push(await run('e: 1825 work, 276 passes', 1825, I, 276));
  rows.push(await run('f: 82 work, 82 passes', 82, ITERS_82, 82));
  const report = () => ({ adapter: `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`.trim(), elements: N, rows });
  (window as any).__clouds = { ready: true, report };
  const f = (x: number, d = 3) => x.toFixed(d);
  (document.getElementById('out') as HTMLElement).innerHTML = `<table><tr><th>case</th><th>dispatches</th><th>passes</th><th>iters/elem</th><th>wall ms</th><th>ms/dispatch</th><th>encode ms</th></tr>${
    rows.map(r => `<tr><td>${r.case}</td><td>${r.dispatches}</td><td>${r.passes}</td><td>${r.iters}</td><td>${f(r.wallMs, 2)}</td><td>${f(r.msPerDispatch)}</td><td>${f(r.encodeMs, 2)}</td></tr>`).join('')}</table>`;
  status('done: ' + report().adapter);
}
main().catch(e => { status('ERROR ' + e); (window as any).__clouds = { ready: false, error: String(e), report: () => ({ error: String(e) }) }; });
