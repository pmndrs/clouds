// P13-H1 test stage: the flagship's frame (three WebGPURenderer + @pmndrs/sky + ground, runtime encode, blend) with an optional
// deterministic clock. Uses only runtime API that predates H1, so `still.ts` runs unchanged on the pre-H1 tree for the A/B.
import { ACESFilmicToneMapping, PerspectiveCamera, Scene } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { Sky } from '@pmndrs/sky';
import { createCloudRuntime, GpuTimer, type CloudFrame, type CloudQuality, type CloudRuntime } from '@clouds/runtime';
import { sharedBackend } from '../../../../packages/legacy/three/src/gpu/backend';
import { createCloudBridge } from '../../flagship/three-bridge';
import { CameraRig } from '../../flagship/controls';
import { createSkyBridge } from '../../flagship/sky-bridge';

export interface StageOptions {
  quality: CloudQuality;
  timeOfDay: number;
  /** Clock = frame / 60 s and frameIndex = frame (no wall time), so a run renders the same frames every time. */
  deterministic: boolean;
  exposure?: number;
}

export interface Stage {
  renderer: WebGPURenderer;
  device: GPUDevice;
  runtime: CloudRuntime;
  sky: Sky;
  camera: PerspectiveCamera;
  rig: CameraRig;
  timer: GpuTimer;
  /** Frames rendered since start. */
  readonly frame: number;
  /** Render up to this many frames, then stop drawing (the canvas keeps the last frame) and only tick the harness. Infinity = run. */
  stopAfter: number;
  /** Median GPU ms per pass over the samples since the last `resetSamples`. */
  gpuMedian(): Record<string, number>;
  resetSamples(): void;
  frameMs(): { p50: number; p95: number };
  start(onFrame: () => void): void;
}

export async function createStage(o: StageOptions): Promise<Stage> {
  const app = document.getElementById('app')!;
  const renderer = new WebGPURenderer({ antialias: true, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = o.exposure ?? 0.35;
  app.appendChild(renderer.domElement);
  await renderer.init();
  const { device } = sharedBackend(renderer);
  const timer = new GpuTimer(device);
  const scene = new Scene();
  const camera = new PerspectiveCamera(70, 1, 1, 1500000);
  const rig = new CameraRig(camera, renderer.domElement);
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: o.timeOfDay, latitude: 40, north: '-Z' });
  sky.attach(scene);
  const ground = sky.createGround({ mode: 'plane', size: 8000000, color: 0x34461f, roughness: 1 });
  ground.attach(scene);
  sky.createSun({ physical: true }).attach(scene);
  await sky.compileAsync();
  const skyBridge = createSkyBridge(renderer, sky);
  const runtime = createCloudRuntime(device, { quality: o.quality, atmosphereLayout: skyBridge.layout });
  const bridge = createCloudBridge(renderer, runtime);
  const resize = () => {
    renderer.setPixelRatio(1);
    renderer.setSize(innerWidth, innerHeight, false);
    bridge.resize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  const frameData: CloudFrame = {
    view: new Float32Array(16), projection: new Float32Array(16), viewProjection: new Float32Array(16), inverseViewProjection: new Float32Array(16), previousViewProjection: new Float32Array(16),
    cameraPosition: [0, 0, 0], depth: undefined as unknown as GPUTextureView, depthKind: 'depth32float',
    sunDirection: skyBridge.values.sunDirection, atmosphere: skyBridge.bindGroup, time: 0, frameIndex: 0,
  };
  const samples: Record<string, number>[] = [];
  const frameTimes: number[] = [];
  const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  let frame = 0;
  const stage: Stage = {
    renderer, device, runtime, sky, camera, rig, timer,
    get frame() { return frame; },
    stopAfter: Infinity,
    gpuMedian() {
      const out: Record<string, number> = {};
      for (const n of new Set(samples.flatMap(s => Object.keys(s)))) { const v = samples.map(s => s[n]).filter(x => x !== undefined); if (v.length) out[n] = pct(v, 0.5); }
      return out;
    },
    resetSamples() { samples.length = 0; frameTimes.length = 0; },
    frameMs: () => ({ p50: pct(frameTimes, 0.5), p95: pct(frameTimes, 0.95) }),
    start(onFrame) {
      const t0 = performance.now();
      let last = t0;
      const loop = (now: number) => {
        const dt = Math.min(0.25, (now - last) / 1000);
        last = now;
        if (frame < stage.stopAfter) {
          frameTimes.push(dt * 1000); if (frameTimes.length > 240) frameTimes.shift();
          rig.update(o.deterministic ? 1 / 60 : dt);
          camera.near = Math.min(200, Math.max(0.5, camera.position.y * 0.002));
          camera.updateProjectionMatrix();
          ground.mesh.position.set(camera.position.x, 0, camera.position.z);
          sky.update(camera);
          void sky.updateAerialPerspective();
          skyBridge.update(camera);
          bridge.syncOutput();
          bridge.renderScene(scene, camera);
          bridge.fillFrame(camera, frameData);
          frameData.time = o.deterministic ? frame / 60 : (now - t0) / 1000; frameData.frameIndex = frame;
          timer.beginFrame();
          const encoder = device.createCommandEncoder({ label: 'hero-fine cloud encoder' });
          runtime.encode(encoder, frameData, timer);
          timer.endFrame(encoder);
          device.queue.submit([encoder.finish()]);
          bridge.present();
          samples.push({ ...timer.last() }); if (samples.length > 600) samples.shift();
          frame++;
        }
        onFrame();
      };
      renderer.setAnimationLoop(loop);
    },
  };
  return stage;
}
