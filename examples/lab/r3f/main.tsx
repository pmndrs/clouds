// Minimal R3F v10 scene: <Canvas> (WebGPU) + @pmndrs/sky <Sky> + ground + @clouds/react <Clouds>. Lines tagged `// CLOUDS` are the whole cost of adding clouds.
// ?stress=1 swaps the volume and settings, changes quality and remounts <Clouds>/<Cloudscape> a few times, then reports GPU object counts.
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ACESFilmicToneMapping, type PerspectiveCamera } from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber/webgpu';
import { Sky, useSky } from '@pmndrs/sky/react';
import { AutoHaze } from '@pmndrs/sky/react/auto-haze';
import { Clouds, Cloudscape, useClouds, type CloudsInstance, type CloudsProps } from '@clouds/react'; // CLOUDS
import { installCloudsHarness } from '../harness/clouds-contract';
import { BOOKMARK_NAMES, bookmarkTime, isBookmarkName, placeCloud, resolveBookmark, sunVector } from '../flagship/bookmarks';
import { CameraRig } from '../flagship/controls';

// ---- GPU object accounting (installed before anything creates a device resource) and uncaptured-error capture -----------------------------
const gpu = { errors: [] as string[], textures: new Set<GPUTexture>(), buffers: new Set<GPUBuffer>(), texturesCreated: 0, buffersCreated: 0, devicesLost: 0 };
if (typeof GPUDevice !== 'undefined') {
  const hooked = new WeakSet<GPUDevice>();
  const hook = (d: GPUDevice) => {
    if (hooked.has(d)) return;
    hooked.add(d);
    d.addEventListener('uncapturederror', e => { const m = (e as GPUUncapturedErrorEvent).error.message; gpu.errors.push(m); console.error(`GPU uncaptured error: ${m}`); });
    void d.lost.then(i => { gpu.devicesLost++; console.error(`GPU device lost: ${i.reason} ${i.message}`); });
  };
  const createTexture = GPUDevice.prototype.createTexture, createBuffer = GPUDevice.prototype.createBuffer;
  GPUDevice.prototype.createTexture = function (this: GPUDevice, d: GPUTextureDescriptor) { hook(this); const t = createTexture.call(this, d); gpu.textures.add(t); gpu.texturesCreated++; return t; };
  GPUDevice.prototype.createBuffer = function (this: GPUDevice, d: GPUBufferDescriptor) { hook(this); const b = createBuffer.call(this, d); gpu.buffers.add(b); gpu.buffersCreated++; return b; };
  const tDestroy = GPUTexture.prototype.destroy, bDestroy = GPUBuffer.prototype.destroy;
  GPUTexture.prototype.destroy = function (this: GPUTexture) { gpu.textures.delete(this); tDestroy.call(this); };
  GPUBuffer.prototype.destroy = function (this: GPUBuffer) { gpu.buffers.delete(this); bDestroy.call(this); };
}

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const stressOn = query.get('stress') === '1';
const looseSettings = Object.fromEntries([...query].filter(([k]) => k.startsWith('s.')).map(([k, v]) => [k.slice(2), Number(v)])) as Partial<CloudsProps>;

// ---- scene pieces --------------------------------------------------------------------------------------------------------------------

/** Ground plane and physical sun light from the sky (as the three-adapter page). */
function Ground() {
  const sky = useSky()!, scene = useThree(s => s.scene);
  useEffect(() => {
    const ground = sky.createGround({ mode: 'plane', size: 8000000, color: 0x34461f, roughness: 1 }).attach(scene);
    const sun = sky.createSun({ physical: true }).attach(scene);
    return () => { ground.detach(); ground.dispose(); sun.detach(); sun.dispose?.(); };
  }, [sky, scene]);
  return null;
}

/** Camera rig, bookmarks, the capture contract and a small HUD. */
function Harness({ cloudsRef }: { cloudsRef: { current: CloudsInstance | null } }) {
  const sky = useSky()!, gl = useThree(s => s.gl), camera = useThree(s => s.camera) as PerspectiveCamera;
  const rig = useMemo(() => new CameraRig(camera, gl.domElement), [camera, gl]);
  const hud = useRef<HTMLPreElement | null>(null);
  const s = useRef({ bookmark: 'ground', time: bookmarkTime('ground'), frame: 0, frameTimes: [] as number[], sceneGpu: [] as number[], busy: false, ready: false });
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pct = (p: number) => { const a = [...s.current.frameTimes].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0; };
  const gpuMs = () => ({ scene: mean(s.current.sceneGpu), ...cloudsRef.current?.timings });
  const apply = (name: string) => {
    if (!isBookmarkName(name)) throw new Error(`unknown bookmark: ${name}`);
    s.current.bookmark = name; s.current.time = bookmarkTime(name); sky.setTimeOfDay(s.current.time);
    const b = resolveBookmark(name, sunVector(sky.sunAzimuth, sky.sunElevation));
    rig.set(b.position, b.target);
  };
  useEffect(() => { apply(isBookmarkName(query.get('bookmark') ?? '') ? query.get('bookmark')! : 'ground'); }, [rig]); // eslint-disable-line react-hooks/exhaustive-deps
  // HUD and bookmark buttons are plain DOM (the Canvas children are scene objects, not DOM).
  useEffect(() => {
    const pre = document.createElement('pre');
    pre.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;color:#fff;font:12px monospace;text-shadow:0 0 3px #000;pointer-events:none';
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;right:8px;top:8px;display:flex;gap:4px';
    for (const n of BOOKMARK_NAMES) { const b = document.createElement('button'); b.textContent = n; b.onclick = () => apply(n); bar.appendChild(b); }
    document.body.append(pre, bar);
    hud.current = pre;
    return () => { pre.remove(); bar.remove(); hud.current = null; };
  }, [rig]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dt) => {
    const st = s.current;
    if (st.frame > 30) { st.frameTimes.push(Math.min(0.25, dt) * 1000); if (st.frameTimes.length > 240) st.frameTimes.shift(); }
    rig.update(Math.min(0.25, dt));
    camera.near = Math.min(200, Math.max(0.5, camera.position.y * 0.002)); // altitude-proportional near plane, as the other pages
    camera.updateProjectionMatrix();
    if (!st.busy) {
      st.busy = true;
      gl.resolveTimestampsAsync('render').then((ms: unknown) => { if (typeof ms === 'number' && ms > 0) { st.sceneGpu.push(ms); if (st.sceneGpu.length > 60) st.sceneGpu.shift(); } }).catch(() => {}).finally(() => { st.busy = false; });
    }
    if (st.frame++ % 10 === 0 && hud.current) hud.current.textContent = `frame ${pct(0.5).toFixed(2)} ms  clouds ${cloudsRef.current?.isReady ? 'on' : 'loading'}\n${Object.entries(gpuMs()).map(([k, v]) => `${k.padEnd(10)} ${v.toFixed(2)}`).join('\n')}`;
    if (!st.ready && cloudsRef.current?.isReady) {
      st.ready = true;
      harness.ready({
        bookmark: apply,
        report: () => ({
          gpuMs: gpuMs(), frameMs: { p50: pct(0.5), p95: pct(0.95) }, renderSize: [gl.domElement.width, gl.domElement.height], bookmark: st.bookmark, timeOfDay: st.time,
          haze: query.get('haze'), frames: st.frame, cloudsReady: !!cloudsRef.current?.isReady,
          gpu: { liveTextures: gpu.textures.size, liveBuffers: gpu.buffers.size, texturesCreated: gpu.texturesCreated, buffersCreated: gpu.buffersCreated, errors: gpu.errors, devicesLost: gpu.devicesLost },
          stress: stressOn ? stressReport : undefined,
        }),
      });
    }
    if (st.ready) harness.frame();
  });
  return null;
}

// ---- ?stress=1 -----------------------------------------------------------------------------------------------------------------------

type Mode = { kind: 'none' } | { kind: 'clouds'; volume: string; settings?: Partial<CloudsProps>; quality?: 'low' | 'medium' | 'high' } | { kind: 'scape'; preset: 'cumulus' | 'congestus'; nested: boolean };
const BASE: Mode = { kind: 'clouds', volume: '/clouds/parkouring/' };
const STEPS: { name: string; mode: Mode; frames: number }[] = [
  { name: 'baseline', mode: BASE, frames: 90 },
  { name: 'volume swap', mode: { kind: 'clouds', volume: '/clouds/heroes/fairweather/' }, frames: 60 },
  { name: 'settings', mode: { kind: 'clouds', volume: '/clouds/heroes/fairweather/', settings: { densityScale: 0.5, msStrength: 2 } }, frames: 40 },
  { name: 'settings removed', mode: { kind: 'clouds', volume: '/clouds/heroes/fairweather/' }, frames: 40 },
  { name: 'quality low', mode: { kind: 'clouds', volume: '/clouds/parkouring/', quality: 'low' }, frames: 40 },
  { name: 'quality medium', mode: { kind: 'clouds', volume: '/clouds/parkouring/', quality: 'medium' }, frames: 40 },
  ...[1, 2, 3].flatMap(i => [{ name: `unmount ${i}`, mode: { kind: 'none' } as Mode, frames: 20 }, { name: `remount ${i}`, mode: BASE, frames: 40 }]),
  { name: 'cloudscape standalone', mode: { kind: 'scape', preset: 'cumulus', nested: false }, frames: 120 },
  { name: 'cloudscape nested', mode: { kind: 'scape', preset: 'cumulus', nested: true }, frames: 120 },
  { name: 'cloudscape preset change', mode: { kind: 'scape', preset: 'congestus', nested: true }, frames: 120 },
  { name: 'back to baseline', mode: BASE, frames: 90 },
];
const tally = (set: Set<{ label: string }>) => { const m: Record<string, number> = {}; for (const o of set) m[o.label || '(unlabelled)'] = (m[o.label || '(unlabelled)'] ?? 0) + 1; return m; };
const diff = (a: Record<string, number>, b: Record<string, number>) => Object.fromEntries(Object.keys({ ...a, ...b }).filter(k => (a[k] ?? 0) !== (b[k] ?? 0)).map(k => [k, `${a[k] ?? 0} -> ${b[k] ?? 0}`]));
let baseTex: Record<string, number> = {}, baseBuf: Record<string, number> = {};
const stressReport = { texturesGrown: {} as Record<string, string>, buffersGrown: {} as Record<string, string>, step: 0, steps: STEPS.length, name: '', done: false, baselineTextures: 0, baselineBuffers: 0, finalTextures: 0, finalBuffers: 0, texturesCreated: 0, buffersCreated: 0 };

function useStress(): Mode {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!stressOn) return;
    let raf = 0, frames = 0, cur = 0, started = false;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!started) { if (!(window.__clouds as { ready?: boolean } | undefined)?.ready) return; started = true; }
      if (++frames < STEPS[cur].frames) return;
      if (cur === 0) { stressReport.baselineTextures = gpu.textures.size; stressReport.baselineBuffers = gpu.buffers.size; baseTex = tally(gpu.textures); baseBuf = tally(gpu.buffers); }
      frames = 0;
      if (cur === STEPS.length - 1) { stressReport.finalTextures = gpu.textures.size; stressReport.finalBuffers = gpu.buffers.size; stressReport.texturesGrown = diff(baseTex, tally(gpu.textures)); stressReport.buffersGrown = diff(baseBuf, tally(gpu.buffers)); stressReport.texturesCreated = gpu.texturesCreated; stressReport.buffersCreated = gpu.buffersCreated; stressReport.done = true; cancelAnimationFrame(raf); return; }
      cur++; stressReport.step = cur; stressReport.name = STEPS[cur].name; setStep(cur);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return STEPS[stressOn ? step : 0].mode;
}

// ---- app -----------------------------------------------------------------------------------------------------------------------------

/** Reports the enclosing <Clouds> instance to the harness, and clears it on unmount. */
function Probe({ cloudsRef }: { cloudsRef: { current: CloudsInstance | null } }) {
  const clouds = useClouds();
  useEffect(() => { cloudsRef.current = clouds; return () => { cloudsRef.current = null; }; }, [clouds, cloudsRef]);
  return null;
}

function App() {
  const mode = useStress();
  const cloudsRef = useRef<CloudsInstance | null>(null);
  const quality = (query.get('quality') as 'high') ?? 'high';
  const haze = query.get('haze');
  const c = mode.kind === 'clouds' ? mode : null;
  return (
    <Canvas dpr={1} camera={{ fov: 70, near: 1, far: 1500000 }} renderer={{ antialias: false, trackTimestamp: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: query.has('exposure') ? Number(query.get('exposure')) : 0.35 }}>
      <Sky preset="earth" timeOfDay={bookmarkTime('ground')} latitude={40} north="-Z">
        <Ground />
        <Harness cloudsRef={cloudsRef} />
        {haze === '1' && <AutoHaze />}{/* ?haze=1: <AutoHaze /> before <Clouds>; ?haze=late: after it (both compose); ?haze=own: <Clouds haze> */}
        {c && (
          <Clouds volume={c.volume} position={[0, 500, 0]} quality={c.quality ?? quality} haze={haze === 'own'} sky={query.get('uniform') === '1' ? false : undefined} {...looseSettings} {...c.settings} onLoad={v => 'sdfMeters' in v && placeCloud(v)}>
            <Probe cloudsRef={cloudsRef} />
          </Clouds>
        )}
        {mode.kind === 'scape' && mode.nested && <Clouds><Probe cloudsRef={cloudsRef} /><Cloudscape preset={mode.preset} /></Clouds>}
        {haze === 'late' && <AutoHaze />}
        {mode.kind === 'scape' && !mode.nested && <Cloudscape preset={mode.preset}><Probe cloudsRef={cloudsRef} /></Cloudscape>}
      </Sky>
    </Canvas>
  );
}

try {
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
