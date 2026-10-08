// P1-02 investigation: why animating the sky's time of day costs ~10 ms of GPU, and which options cut it.
// Replicates the flagship sky setup (earth preset, ground, physical sun, ACES), moves the sun every frame (or every N frames)
// and reads three's render/compute timestamps per frame. Not a pass/fail test: it reports numbers.
import { ACESFilmicToneMapping, PerspectiveCamera, REVISION, Scene, WebGPURenderer } from 'three/webgpu';
import { Sky } from '@pmndrs/sky';
import { installCloudsHarness } from '../../harness/clouds-contract';

const harness = installCloudsHarness();
const out = document.getElementById('out')!;
const log = (s: string) => { out.textContent += s + '\n'; };
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sleepFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()));

interface Scenario { name: string; sky?: Record<string, unknown>; every?: number; only?: 'lut' | 'cube' | 'pmrem' | 'none'; }
const SCENARIOS: Scenario[] = [
  { name: 'static (sun fixed)', every: 0 },
  { name: 'animate every frame, defaults', every: 1 },
  { name: '  only skyView LUT re-render', only: 'lut' },
  { name: '  only cube capture (6 faces)', only: 'cube' },
  { name: '  only PMREM prefilter (sky compute)', only: 'pmrem' },
  { name: 'animate, pmrem quality fast', sky: { pmrem: { quality: 'fast' } }, every: 1 },
  { name: 'animate, pmrem three generator (250 ms, 1 level/frame)', sky: { pmrem: { generator: 'three' } }, every: 1 },
  { name: 'animate, pmrem three generator (1000 ms, 1 level/frame)', sky: { pmrem: { generator: 'three', minInterval: 1000 } }, every: 1 },
  { name: 'animate, cubeSize 64', sky: { cubeSize: 64 }, every: 1 },
  { name: 'animate, cubeSize 128', sky: { cubeSize: 128 }, every: 1 },
  { name: 'animate, cubeSize 512', sky: { cubeSize: 512 }, every: 1 },
  { name: 'animate, quality low', sky: { quality: 'low' }, every: 1 },
  { name: 'animate, cubeSize 64 + pmrem fast', sky: { cubeSize: 64, pmrem: { quality: 'fast' } }, every: 1 },
  { name: 'update every 4th frame, defaults', every: 4 },
  { name: 'update every 15th frame, defaults', every: 15 },
  { name: 'update every 4th frame, cubeSize 128', sky: { cubeSize: 128 }, every: 4 },
];

try {
  const renderer = new WebGPURenderer({ antialias: true, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.setSize(1280, 720, false);
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  const results: Record<string, unknown>[] = [];
  const wall: Record<string, number> = {};
  let pmremInfo = '';
  log('scenario                                                    three render-ts ms   cpu ms   wall ms/frame');

  for (const sc of SCENARIOS) {
    const scene = new Scene();
    const camera = new PerspectiveCamera(70, 16 / 9, 1, 1_500_000);
    camera.position.set(0, 200, 0);
    const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 14, latitude: 40, north: '-Z', ...sc.sky } as never);
    sky.attach(scene);
    sky.createGround({ mode: 'plane', size: 2_000_000, color: 0x34461f, roughness: 1 }).attach(scene);
    sky.createSun({ physical: true }).attach(scene);
    await sky.compileAsync();
    const baker = sky.baker as any;
    let t = 14, frame = 0;
    if (!pmremInfo) {
      pmremInfo = `three r${REVISION}, pmrem mode ${baker.pmrem.mode}, layout ${baker.pmrem.layout}`;
      log(pmremInfo);
      // wall-clock per operation: submit, then wait for the queue to drain (upper bound: includes launch latency)
      const device = (renderer.backend as any).device as GPUDevice;
      const timeOp = async (name: string, op: () => void) => {
        sky.update(camera); renderer.render(scene, camera);
        for (let i = 0; i < 5; i++) { op(); await device.queue.onSubmittedWorkDone(); }
        const t0 = performance.now();
        for (let i = 0; i < 30; i++) { op(); await device.queue.onSubmittedWorkDone(); }
        wall[name] = (performance.now() - t0) / 30;
        log(`wall-clock ${name.padEnd(28)} ${wall[name].toFixed(2)} ms/op (submit + drain)`);
      };
      await timeOp('empty queue round trip', () => { device.queue.submit([]); });
      await timeOp('skyView LUT render', () => baker.skyViewLUT.render());
      await timeOp('cube capture (6 faces)', () => baker._captureCube());
      await timeOp('PMREM prefilter', () => { baker.pmrem.markDirty(); baker.pmrem.tick(); });
      await timeOp('AP LUT compute', () => { void baker.aerialPerspectiveLUT.render(); });
      await timeOp('whole frame, sun fixed', () => { sky.update(camera); renderer.render(scene, camera); });
      await timeOp('whole frame, sun moving', () => { sky.setTimeOfDay((t += 0.02)); sky.update(camera); renderer.render(scene, camera); });
      await timeOp('all three (full sun change)', () => { sky.setTimeOfDay((t += 0.02)); sky.update(camera); });
    }
    const step = async (measure: boolean, acc: { r: number[]; c: number[]; cpu: number[] }) => {
      const c0 = performance.now();
      if (sc.every && frame % sc.every === 0) { t += 0.02; sky.setTimeOfDay(t); }
      sky.update(camera);
      if (sc.only === 'lut') baker.skyViewLUT.render();
      else if (sc.only === 'cube') baker._captureCube();
      else if (sc.only === 'pmrem') { baker.pmrem.markDirty(); baker.pmrem.tick(); }
      renderer.render(scene, camera);
      const cpu = performance.now() - c0;
      const r = await renderer.resolveTimestampsAsync('render');
      const c = await renderer.resolveTimestampsAsync('compute');
      frame++;
      if (measure) { acc.r.push(Number(r) || 0); acc.c.push(Number(c) || 0); acc.cpu.push(cpu); }
      await sleepFrame();
    };
    const warm = { r: [], c: [], cpu: [] }, acc = { r: [] as number[], c: [] as number[], cpu: [] as number[] };
    for (let i = 0; i < 30; i++) await step(false, warm);
    for (let i = 0; i < 90; i++) await step(true, acc);
    // wall clock per frame (submit + queue drain), the cost the frame actually pays whatever the timestamps attribute
    const device = (renderer.backend as any).device as GPUDevice;
    const w0 = performance.now();
    const wallFrames = 60;
    for (let i = 0; i < wallFrames; i++) {
      if (sc.every && frame % sc.every === 0) { t += 0.02; sky.setTimeOfDay(t); }
      sky.update(camera);
      if (sc.only === 'lut') baker.skyViewLUT.render();
      else if (sc.only === 'cube') baker._captureCube();
      else if (sc.only === 'pmrem') { baker.pmrem.markDirty(); baker.pmrem.tick(); }
      renderer.render(scene, camera);
      frame++;
      await device.queue.onSubmittedWorkDone();
    }
    const wallMs = (performance.now() - w0) / wallFrames;
    const row = { name: sc.name, renderMs: mean(acc.r), computeMs: mean(acc.c), cpuMs: mean(acc.cpu), wallMs };
    results.push(row);
    log(`${sc.name.padEnd(58)}  ${row.renderMs.toFixed(2).padStart(7)}  ${row.cpuMs.toFixed(2).padStart(8)}  ${row.wallMs.toFixed(2).padStart(8)}`);
    sky.dispose();
  }

  const tick = () => { harness.frame(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  harness.ready({ report: () => ({ gpuMs: {}, frameMs: { p50: 0, p95: 0, last: 0 }, renderSize: [1280, 720], scenarios: results, wallClockMsPerOp: wall, env: pmremInfo }) });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
