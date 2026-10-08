import { Canvas, useFrame, useThree } from '@react-three/fiber/webgpu';
import { DensityCloud, type DensityCloudHandle } from '@clouds/react';
import { createDensityField, createReferenceCloud, type DenseDensityField, type ReferenceCloudSettings } from '@clouds/three';
import { useCallback, useEffect, useMemo, useRef, useState, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PerspectiveCamera, Vector3, WebGPURenderer, type Scene as ThreeScene } from 'three/webgpu';

type DensityView = {
  renderer: WebGPURenderer;
  scene: ThreeScene;
  getCamera: () => PerspectiveCamera;
  setFrameloop: (mode?: 'always' | 'demand' | 'never') => void;
  invalidate: () => void;
};

type Check = { name: string; passed: boolean; detail?: string };

const NO_OCCLUDER = {
  min: [1e9, 0, 1e9] as [number, number, number],
  max: [1e9 + 1, 1, 1e9 + 1] as [number, number, number],
};

let ownedDevice: GPUDevice | null = null;
let ownedRenderer: WebGPURenderer | null = null;

async function createOwnedRenderer(defaultProps: { canvas: HTMLCanvasElement; [key: string]: unknown }) {
  if (!navigator.gpu) throw new Error('This verification requires a browser with WebGPU.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter is available.');
  ownedDevice = await adapter.requestDevice({});
  const renderer = new WebGPURenderer({
    ...defaultProps,
    antialias: false,
    device: ownedDevice,
  });
  await renderer.init();
  ownedRenderer = renderer;
  return renderer;
}

function finiteError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function configure(runtime: ReturnType<typeof createReferenceCloud>, settings: Partial<ReferenceCloudSettings>) {
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) continue;
    const target = runtime.settings[key as keyof ReferenceCloudSettings] as unknown;
    if (target && typeof (target as { copy?: (source: unknown) => void }).copy === 'function') {
      (target as { copy(source: unknown): void }).copy(value);
    } else {
      (runtime.settings as unknown as Record<string, unknown>)[key] = value;
    }
  }
}

function CameraReplacement({ variant, report }: { variant: number; report: (message: string) => void }) {
  const get = useThree((state) => state.get);
  const set = useThree((state) => state.set);
  const size = useThree((state) => state.size);
  const original = useRef(useThree((state) => state.camera));
  useEffect(() => {
    if (variant === 0) {
      if (get().camera !== original.current) set({ camera: original.current });
      return;
    }
    const previous = get().camera;
    const replacement = new PerspectiveCamera(52, size.width / Math.max(1, size.height), 1, 10000);
    replacement.coordinateSystem = previous.coordinateSystem;
    replacement.position.copy(previous.position);
    replacement.quaternion.copy(previous.quaternion);
    replacement.updateProjectionMatrix();
    set({ camera: replacement });
    report(`replacement camera=${replacement.uuid.slice(0, 8)} previous=${previous.uuid.slice(0, 8)}`);
    return () => { if (get().camera === replacement) set({ camera: previous }); };
  }, [get, report, set, size.height, size.width, variant]);
  return null;
}

function LifecycleProbe({ onDispose }: { onDispose: () => void }) {
  useEffect(() => onDispose, [onDispose]);
  return null;
}

function DensityScene({ field, enabled, cameraVariant, settings, report, onReady, onDispose, onError, onView }: {
  field: DenseDensityField;
  enabled: boolean;
  cameraVariant: number;
  settings: Partial<ReferenceCloudSettings>;
  report: (message: string) => void;
  onReady: (handle: DensityCloudHandle) => void;
  onDispose: () => void;
  onError: (error: Error) => void;
  onView: (view: DensityView | null) => void;
}) {
  const renderer = useThree((state) => state.renderer);
  const get = useThree((state) => state.get);
  const setFrameloop = useThree((state) => state.setFrameloop);
  const invalidate = useThree((state) => state.invalidate);
  const lastReport = useRef(-Infinity);
  useEffect(() => {
    onView({ renderer, scene: get().scene, getCamera: () => get().camera as PerspectiveCamera, setFrameloop, invalidate });
    return () => onView(null);
  }, [get, invalidate, onView, renderer, setFrameloop]);
  useFrame((state) => {
    if (state.camera.type !== 'PerspectiveCamera') return;
    if (state.time - lastReport.current < 750) return;
    lastReport.current = state.time;
    report(`camera=${state.camera.uuid.slice(0, 8)} · field=${field.descriptor.id}@${field.descriptor.revision} · ${Math.round(state.size.width)}×${Math.round(state.size.height)} · ${enabled ? 'enabled' : 'disabled'}`);
  }, { phase: 'finish', priority: -100 });
  return <>
    <CameraReplacement variant={cameraVariant} report={report} />
    <DensityCloud field={field} appearance="realistic" occluder={NO_OCCLUDER} settings={settings} enabled={enabled} onReady={onReady} onError={onError}>
      <LifecycleProbe onDispose={onDispose} />
      <color attach="background" args={[0x9dbed4]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[10000, 10000]} />
        <meshBasicNodeMaterial color={0x1b3344} />
      </mesh>
    </DensityCloud>
  </>;
}

function App() {
  const [fieldSeed, setFieldSeed] = useState(17);
  const [enabled, setEnabled] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [cameraVariant, setCameraVariant] = useState(0);
  const [status, setStatus] = useState('Requesting a minimal WebGPU device…');
  const [parityStatus, setParityStatus] = useState('parity: not run');
  const [parityRunning, setParityRunning] = useState(false);
  const [lifecycle, setLifecycle] = useState({ ready: 0, dispose: 0, errors: 0 });
  const [lastError, setLastError] = useState('');
  const [checks, setChecks] = useState<Check[]>([]);
  const field = useMemo(() => createDensityField('cumulus', 32, fieldSeed), [fieldSeed]);
  const settings = useMemo<Partial<ReferenceCloudSettings>>(() => ({
    densityMultiplier: 1,
    detailErosion: 0,
    viewSteps: 96,
    lightSteps: 12,
    occupancy: false,
    castShadow: false,
    receiveShadow: false,
    constantLight: false,
    sunDirection: new Vector3(-0.6, 0.8, 0.4).normalize(),
  }), []);
  const handleRef = useRef<DensityCloudHandle | null>(null);
  const viewRef = useRef<DensityView | null>(null);
  const report = useCallback((message: string) => setStatus(message), []);
  const onReady = useCallback((handle: DensityCloudHandle) => {
    handleRef.current = handle;
    setLifecycle((value) => ({ ...value, ready: value.ready + 1 }));
  }, []);
  const onDispose = useCallback(() => {
    handleRef.current = null;
    setLifecycle((value) => ({ ...value, dispose: value.dispose + 1 }));
  }, []);
  const onError = useCallback((error: Error) => {
    setLastError(error.message);
    setLifecycle((value) => ({ ...value, errors: value.errors + 1 }));
  }, []);
  const registerView = useCallback((view: DensityView | null) => { viewRef.current = view; }, []);
  useEffect(() => {
    setChecks([]);
    setParityStatus('parity: not run');
  }, [cameraVariant, enabled, fieldSeed, mounted]);
  const evidence = useMemo(() => ({
    generatedAt: new Date().toISOString(),
    field: field.descriptor,
    appearance: 'realistic',
    settings: { ...settings, sunDirection: settings.sunDirection?.toArray() },
    lifecycle,
    checks,
    parity: parityStatus,
    errors: lastError ? [lastError] : [],
  }), [checks, field, lastError, lifecycle, parityStatus, settings]);
  const runParity = useCallback(async () => {
    const handle = handleRef.current;
    const view = viewRef.current;
    if (!handle || !view || parityRunning) return;
    setParityRunning(true);
    setParityStatus('parity: running paused vanilla comparison…');
    view.setFrameloop('never');
    let reference: ReturnType<typeof createReferenceCloud> | null = null;
    try {
      const camera = view.getCamera();
      camera.updateMatrixWorld(true);
      const runtime = handle.runtime;
      const [width, height] = runtime.evidence.renderSize;
      runtime.resize(width, height);
      configure(runtime, settings);
      reference = createReferenceCloud(view.renderer, field, NO_OCCLUDER, { appearance: 'realistic' });
      configure(reference, settings);
      reference.resize(width, height);
      runtime.render(view.scene, camera, false);
      reference.render(view.scene, camera, false);
      const [bindingOptical, vanillaOptical] = await Promise.all([runtime.readOptical(), reference.readOptical()]);
      if (bindingOptical.length !== vanillaOptical.length) throw new Error('React and vanilla optical readbacks differ in size.');
      const result: Check[] = [];
      for (const [name, pixels] of [['React optical', bindingOptical], ['Vanilla optical', vanillaOptical]] as const) {
        const finite = pixels.every(Number.isFinite);
        const visible = pixels.some((value, index) => index % 4 === 3 && value > 0 && value < 0.99);
        result.push({ name: `${name} finite`, passed: finite });
        result.push({ name: `${name} nonblank`, passed: visible });
        if (!finite || !visible) throw new Error(`${name} output was blank or non-finite.`);
      }
      let maxError = 0;
      for (let index = 0; index < bindingOptical.length; index += 1) maxError = Math.max(maxError, Math.abs(bindingOptical[index] - vanillaOptical[index]));
      result.push({ name: 'React/vanilla optical parity', passed: maxError <= 1e-5, detail: `max=${maxError.toExponential(3)} threshold=1e-5` });
      setChecks(result);
      setParityStatus(`parity: ${maxError <= 1e-5 ? 'PASS' : 'FAIL'} · max L/T error=${maxError.toExponential(3)} · ${width}×${height}`);
    } catch (error) {
      const failure = finiteError(error);
      setChecks([{ name: 'Parity run', passed: false, detail: failure.message }]);
      setParityStatus(`parity: ERROR · ${failure.message}`);
    } finally {
      reference?.dispose();
      view.setFrameloop('always');
      view.invalidate();
      setParityRunning(false);
    }
  }, [field, parityRunning, settings]);
  const exportEvidence = useCallback(() => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'react-density-evidence.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [evidence]);
  return <div id="app">
    <header>
      <div><h1>React density adapter</h1><p>R3F v10 · realistic appearance · caller-owned WebGPU device</p></div>
      <div className="controls">
        <button disabled={parityRunning} aria-pressed={mounted} onClick={() => setMounted((value) => !value)}>{mounted ? 'Unmount cloud' : 'Mount cloud'}</button>
        <button disabled={parityRunning} onClick={() => setFieldSeed((value) => value === 17 ? 29 : 17)}>Replace field</button>
        <button disabled={parityRunning} onClick={() => setCameraVariant((value) => value ? 0 : 1)}>Replace camera</button>
        <button disabled={parityRunning || !mounted} aria-pressed={enabled} onClick={() => setEnabled((value) => !value)}>Cloud {enabled ? 'on' : 'off'}</button>
        <button disabled={parityRunning || !mounted || !handleRef.current} onClick={() => void runParity()}>{parityRunning ? 'Running parity…' : 'Run parity'}</button>
        <button disabled={parityRunning} onClick={exportEvidence}>Export JSON</button>
      </div>
    </header>
    <main id="canvas">
      <Canvas renderer={createOwnedRenderer} camera={{ position: [900, 450, 1200], fov: 55, near: 1, far: 10000 }} dpr={1} onCreated={() => setStatus('WebGPU renderer ready; density adapter mounted')}>
        {mounted ? <DensityScene field={field} enabled={enabled} cameraVariant={cameraVariant} settings={settings} report={report} onReady={onReady} onDispose={onDispose} onError={onError} onView={registerView} /> : <color attach="background" args={[0x172b3a]} />}
      </Canvas>
      <div id="status" role="status">{status} · ready={lifecycle.ready} dispose={lifecycle.dispose} errors={lifecycle.errors}{lastError ? ` · ${lastError}` : ''}<br />{parityStatus}</div>
      <pre id="evidence">{JSON.stringify({ field: `${field.descriptor.id}@${field.descriptor.revision}`, checks, lifecycle }, null, 2)}</pre>
    </main>
  </div>;
}

window.addEventListener('pagehide', () => {
  ownedRenderer?.dispose();
  ownedDevice?.destroy();
  ownedRenderer = null;
  ownedDevice = null;
}, { once: true });

createRoot(document.getElementById('app')!).render(<StrictMode><App /></StrictMode>);
