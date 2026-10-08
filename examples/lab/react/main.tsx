import { Canvas, useFrame, useThree } from '@react-three/fiber/webgpu';
import { Cloudscape, type CloudscapeHandle } from '@clouds/react';
import { CloudLayer, type CloudLayer as CloudLayerRuntime } from '@clouds/react/layers';
import {
  createCloudscape,
  createCloudscapeAtlas,
  createCloudWorld,
  type CloudscapeSettings,
} from '@clouds/three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useCallback, useEffect, useMemo, useRef, useState, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PerspectiveCamera, Vector2, Vector3, type Scene as ThreeScene, type WebGPURenderer } from 'three/webgpu';

type ParityView = {
  renderer: WebGPURenderer;
  scene: ThreeScene;
  getCamera: () => PerspectiveCamera;
  setFrameloop: (mode?: 'always' | 'demand' | 'never') => void;
  invalidate: () => void;
};

function ActiveCameraControls() {
  const camera = useThree((state) => state.camera);
  const renderer = useThree((state) => state.renderer);
  const controlsRef = useRef<OrbitControls | null>(null);

  useEffect(() => {
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1200, 0);
    controls.enableDamping = true;
    controlsRef.current = controls;
    controls.update();
    return () => {
      if (controlsRef.current === controls) controlsRef.current = null;
      controls.dispose();
    };
  }, [camera, renderer]);

  useFrame(() => controlsRef.current?.update(), { phase: 'update', priority: -50 });
  return null;
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
    const replacement = new PerspectiveCamera(52, size.width / Math.max(1, size.height), 1, 12000);
    replacement.coordinateSystem = previous.coordinateSystem;
    replacement.position.copy(previous.position);
    replacement.quaternion.copy(previous.quaternion);
    replacement.updateProjectionMatrix();
    set({ camera: replacement });
    report(`installed replacement PerspectiveCamera ${replacement.uuid.slice(0, 8)}; previous=${previous.uuid.slice(0, 8)}`);
    return () => {
      if (get().camera === replacement) set({ camera: previous });
    };
  }, [get, set, size.width, size.height, variant, report]);

  return null;
}

function LifecycleProbe({ onDispose }: { onDispose: () => void }) {
  useEffect(() => onDispose, [onDispose]);
  return null;
}

function Scene({ showCloudscape, showLayer, cameraVariant, report, onReady, onDispose, onError, onView, onLayerReady, atlas, world, sharedSettings }: {
  showCloudscape: boolean;
  showLayer: boolean;
  cameraVariant: number;
  report: (message: string) => void;
  onReady: (handle: CloudscapeHandle) => void;
  onDispose: () => void;
  onError: (error: Error) => void;
  onView: (view: ParityView | null) => void;
  onLayerReady: (layer: CloudLayerRuntime) => void;
  atlas: ReturnType<typeof createCloudscapeAtlas>;
  world: ReturnType<typeof createCloudWorld>;
  sharedSettings: Partial<CloudscapeSettings>;
}) {
  const renderer = useThree((state) => state.renderer);
  const camera = useThree((state) => state.camera);
  const get = useThree((state) => state.get);
  const setFrameloop = useThree((state) => state.setFrameloop);
  const invalidate = useThree((state) => state.invalidate);
  const lastReport = useRef(-Infinity);
  const drawingBuffer = useRef(new Vector2());

  useEffect(() => {
    report(`camera=${camera.type}; WebGPU renderer ready; waiting for the first cloud frame`);
  }, [camera, report]);

  useEffect(() => {
    onView({
      renderer,
      scene: get().scene,
      getCamera: () => get().camera as PerspectiveCamera,
      setFrameloop,
      invalidate,
    });
    return () => onView(null);
  }, [get, invalidate, onView, renderer, setFrameloop]);

  useFrame((state) => {
    if (state.time - lastReport.current < 750) return;
    lastReport.current = state.time;
    const size = renderer.getDrawingBufferSize(drawingBuffer.current);
    report(`camera=${state.camera.type} ${state.camera.uuid.slice(0, 8)}#${cameraVariant}; CSS=${state.size.width}×${state.size.height}; drawingBuffer=${size.x}×${size.y}; mounted=${showCloudscape ? 'cloudscape' : 'scene'}${showLayer ? '+layer' : ''}`);
  }, { phase: 'finish', priority: -100 });

  return (
    <>
      <CameraReplacement variant={cameraVariant} report={report} />
      <ActiveCameraControls />
      {showCloudscape ? (
        <Cloudscape source={atlas} world={world} settings={sharedSettings} onReady={onReady} onError={onError}>
          <LifecycleProbe onDispose={onDispose} />
          <color attach="background" args={[0xb6cddd]} />
          <ambientLight intensity={0.7} />
          <directionalLight position={[-1200, 2200, 1000]} intensity={2.4} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
            <planeGeometry args={[12000, 12000]} />
            <meshBasicNodeMaterial color={0x172c3d} />
          </mesh>
        </Cloudscape>
      ) : (
        <>
          <color attach="background" args={[0xb6cddd]} />
          <ambientLight intensity={0.7} />
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[12000, 12000]} />
            <meshBasicNodeMaterial color={0x172c3d} />
          </mesh>
        </>
      )}
      {showLayer ? <CloudLayer onReady={onLayerReady} height={5000} radius={6000} cloudScale={0.0008} coverage={0.54} density={0.7} /> : null}
    </>
  );
}

function App() {
  const [showCloudscape, setShowCloudscape] = useState(true);
  const [showLayer, setShowLayer] = useState(true);
  const [cameraVariant, setCameraVariant] = useState(0);
  const [status, setStatus] = useState('Mounting the pinned R3F v10 WebGPU Canvas…');
  const [lifecycle, setLifecycle] = useState({ ready: 0, dispose: 0, error: 0 });
  const [lastError, setLastError] = useState('');
  const [parityRunning, setParityRunning] = useState(false);
  const [parityStatus, setParityStatus] = useState('parity: not run');
  const [layerManualDisposals, setLayerManualDisposals] = useState(0);
  const canvasCamera = useMemo(() => ({ position: [0, 1200, 2800] as [number, number, number], fov: 45, near: 1, far: 12000 }), []);
  const atlas = useMemo(() => createCloudscapeAtlas(), []);
  const world = useMemo(() => createCloudWorld(), []);
  const sharedSettings = useMemo<Partial<CloudscapeSettings>>(() => ({
    density: 1,
    stepMetres: 24,
    maxSteps: 320,
    detail: 0.16,
    detailFiltering: true,
    skipEmpty: true,
    distanceFade: true,
    earlyTermination: true,
    cachedLighting: true,
    shadows: true,
    geometryShadows: true,
    constantLight: false,
  }), []);
  const cloudscapeHandle = useRef<CloudscapeHandle | null>(null);
  const layerHandle = useRef<CloudLayerRuntime | null>(null);
  const parityView = useRef<ParityView | null>(null);
  const recordReady = useCallback((handle: CloudscapeHandle) => {
    cloudscapeHandle.current = handle;
    setLifecycle((current) => ({ ...current, ready: current.ready + 1 }));
    setStatus(`cloudscape mounted; runtime output=${handle.runtime.evidence.renderSize.join('×')}; resize follows the WebGPU drawing buffer`);
  }, []);
  const recordDispose = useCallback(() => {
    cloudscapeHandle.current = null;
    setLifecycle((current) => ({ ...current, dispose: current.dispose + 1 }));
  }, []);
  const recordError = useCallback((error: Error) => {
    setLifecycle((current) => ({ ...current, error: current.error + 1 }));
    setLastError(error.message);
    setStatus(`cloudscape error: ${error.message}`);
  }, []);
  const registerView = useCallback((view: ParityView | null) => { parityView.current = view; }, []);
  const recordLayerReady = useCallback((layer: CloudLayerRuntime) => {
    layerHandle.current = layer;
    setStatus(`distant layer mounted; manual dispose test ready`);
  }, []);
  const disposeLayer = useCallback(() => {
    const layer = layerHandle.current;
    if (!layer) return;
    layer.dispose();
    layerHandle.current = null;
    setLayerManualDisposals((count) => count + 1);
    setStatus('distant layer manually disposed; frame updates remain healthy; toggle it off/on to remount');
  }, []);
  const runParity = useCallback(async () => {
    const handle = cloudscapeHandle.current;
    const view = parityView.current;
    if (!handle || !view || parityRunning) return;
    setParityRunning(true);
    setParityStatus('parity: running offscreen vanilla comparison…');
    view.setFrameloop('never');
    let reference: ReturnType<typeof createCloudscape> | null = null;
    try {
      const camera = view.getCamera();
      camera.updateMatrixWorld(true);
      const cameraPosition = camera.getWorldPosition(new Vector3());
      const snapshot = world.update(cameraPosition.toArray());
      const runtime = handle.runtime;
      runtime.setWorld(snapshot);
      Object.assign(runtime.settings, sharedSettings);
      const { renderSize, sceneSize } = runtime.evidence;
      runtime.resize(renderSize[0], renderSize[1], sceneSize[0], sceneSize[1]);

      reference = createCloudscape(view.renderer, atlas, snapshot);
      Object.assign(reference.settings, sharedSettings);
      reference.resize(renderSize[0], renderSize[1], sceneSize[0], sceneSize[1]);
      // Both renders are explicit offscreen passes. Neither presents, and the
      // host loop stays paused until both readbacks have completed.
      runtime.render(view.scene, camera, false);
      reference.render(view.scene, camera, false);
      const [bindingOptical, vanillaOptical] = await Promise.all([runtime.readOptical(), reference.readOptical()]);
      if (bindingOptical.length !== vanillaOptical.length) throw new Error('Optical readback dimensions differ.');
      for (const pixels of [bindingOptical, vanillaOptical]) {
        if (!pixels.every(Number.isFinite) || !pixels.some((value, index) => index % 4 === 3 && value > 0 && value < 0.99)) {
          throw new Error('Parity needs a finite, visible cloud in both renders; blank outputs do not pass.');
        }
      }
      let maxError = 0;
      for (let index = 0; index < bindingOptical.length; index++) {
        maxError = Math.max(maxError, Math.abs(bindingOptical[index] - vanillaOptical[index]));
      }
      const passed = maxError <= 1e-5;
      setParityStatus(`parity: ${passed ? 'PASS' : 'FAIL'} · max optical L/T error=${maxError.toExponential(3)} · threshold=1e-5 · ${renderSize.join('×')}`);
    } catch (error) {
      setParityStatus(`parity: ERROR · ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      reference?.dispose();
      view.setFrameloop('always');
      view.invalidate();
      setParityRunning(false);
    }
  }, [atlas, parityRunning, sharedSettings, world]);
  return (
    <div id="app">
      <header>
        <div><h1>React WebGPU bindings</h1><p>One renderer · one R3F render phase · explicit mount/unmount lifecycle</p></div>
        <div className="controls">
          <button disabled={parityRunning} aria-pressed={showCloudscape} onClick={() => setShowCloudscape((value) => !value)}>Cloudscape</button>
          <button disabled={parityRunning} aria-pressed={showLayer} onClick={() => setShowLayer((value) => !value)}>Distant layer</button>
          <button disabled={parityRunning} onClick={() => setCameraVariant((value) => value ? 0 : 1)}>Replace camera</button>
          <button disabled={parityRunning || !showLayer || !layerHandle.current} onClick={disposeLayer}>Dispose layer handle</button>
          <button disabled={parityRunning || !showCloudscape || lifecycle.ready === 0 || lifecycle.dispose >= lifecycle.ready} onClick={() => void runParity()}>{parityRunning ? 'Running parity…' : 'Run vanilla parity check'}</button>
        </div>
      </header>
      <main id="canvas">
        <Canvas camera={canvasCamera} dpr={1} onCreated={() => setStatus('WebGPU renderer created; R3F owns the frame loop')}>
          <Scene showCloudscape={showCloudscape} showLayer={showLayer} cameraVariant={cameraVariant} report={setStatus} onReady={recordReady} onDispose={recordDispose} onError={recordError} onView={registerView} onLayerReady={recordLayerReady} atlas={atlas} world={world} sharedSettings={sharedSettings} />
        </Canvas>
        <div id="status" role="status">{status} · ready={lifecycle.ready} dispose={lifecycle.dispose} errors={lifecycle.error} layerManualDispose={layerManualDisposals}{lastError ? ` · ${lastError}` : ''}<br />{parityStatus}</div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('app')!).render(<StrictMode><App /></StrictMode>);
