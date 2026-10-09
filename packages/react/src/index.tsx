// @clouds/react: React Three Fiber v10 bindings for @clouds/three. See work/specs/P2-api.md and work/reports/P7-A.md.
//
//   <Canvas renderer={...}>
//     <Sky timeOfDay={14}><AutoHaze /></Sky>
//     <Clouds volume="/clouds/parkouring/" position={[0, 500, 0]} quality="high" densityScale={0.02} />   // after <AutoHaze />
//   </Canvas>
//
// <Clouds> owns one `Clouds` instance (from @clouds/three) per renderer and sky, loads the volume (suspending until the assets are in), and
// composites the clouds node into R3F's render pipeline (`useRenderPipeline`): over the scene pass, or over whatever colour node the
// pipeline already outputs when something else (sky's <AutoHaze />) set it first. <Cloudscape> shows a generated, camera-following cloud field.
import { Suspense, createContext, use, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame, useRenderPipeline, useStore, useThree } from '@react-three/fiber/webgpu';
import { useSky } from '@pmndrs/sky/react';
import type { Sky } from '@pmndrs/sky';
import type { DirectionalLight, Vector3 } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { loadCloudNoise, loadCloudVolume, type CloudNoiseAsset, type CloudVolumeAsset } from '@clouds/runtime';
import { createEmptyCloudVolume, createStreamingCloudscape, type CloudPreset, type CloudPresetName, type StreamingCloudscape, type StreamingUpdate } from '@clouds/runtime/generate';
import { Clouds as CloudsCore, sharedBackend, type CloudQuality, type CloudQualityOption, type CloudSettings, type GpuCloudVolume, type UniformLightingValues } from '@clouds/three';
import { collectSettings, settingsKey, settingsPatch } from './props';

type ScenePass = NonNullable<PassRecord['scenePass']>;

export { CLOUD_QUALITIES } from '@clouds/three';
export { CLOUD_PRESETS } from '@clouds/runtime/generate';
export type { CloudQuality, CloudQualityOption, CloudSettings, CloudPresetName };
export type CloudsInstance = CloudsCore;

// ---- asset cache (Suspense) -------------------------------------------------------------------------------------------------------------

const volumeCache = new Map<string, Promise<CloudVolumeAsset>>();
const noiseCache = new Map<string, Promise<CloudNoiseAsset>>();
function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) { p = load(); cache.set(key, p); p.catch(() => cache.delete(key)); } // a failed load can be retried by remounting
  return p;
}
/** Starts loading a cloud pack and the noise ahead of time, so mounting `<Clouds>` does not suspend. */
export function preloadClouds(volume?: string, noise = '/clouds/noise/'): void {
  if (volume) void cached(volumeCache, volume, () => loadCloudVolume(volume)).catch(() => {});
  void cached(noiseCache, noise, () => loadCloudNoise(noise)).catch(() => {});
}
/** Drops cached CPU copies of cloud packs (the GPU copies belong to mounted `<Clouds>`). */
export function clearCloudsCache(): void { volumeCache.clear(); noiseCache.clear(); }

// ---- context ----------------------------------------------------------------------------------------------------------------------------

interface CloudsContextValue {
  clouds: CloudsCore;
  device: GPUDevice;
  /** Shows nothing (an empty volume) so a caller-owned volume can be destroyed safely. */
  clear(): Promise<void>;
}
const CloudsContext = createContext<CloudsContextValue | null>(null);

/** The `Clouds` instance of the enclosing `<Clouds>` / `<Cloudscape>`: `settings`, `timings`, `isReady`, `reflection(dir)`, `core`. */
export function useClouds(): CloudsCore {
  const ctx = useContext(CloudsContext);
  if (!ctx) throw new Error('@clouds/react: useClouds() must be used inside <Clouds> or <Cloudscape>.');
  return ctx.clouds;
}

// ---- <Clouds> ---------------------------------------------------------------------------------------------------------------------------

export interface CloudsOwnProps {
  /** A cloud pack URL (loaded with Suspense) or a volume you already have (generator output stays yours to destroy). */
  volume?: string | GpuCloudVolume | CloudVolumeAsset;
  /** Noise pack URL. Default '/clouds/noise/'. */
  noise?: string;
  /** World position of the volume's base centre. Default [0, 500, 0]. Changing it re-places the volume (a re-upload for packs). */
  position?: [number, number, number];
  /** A tier, or 'auto' (picked at creation from the adapter, then dynamic resolution toward the budget). Switching to 'auto' later keeps the current tier. */
  quality?: CloudQualityOption;
  /** Settings as an object; loose props (`<Clouds densityScale={0.02} />`) are settings too and win. */
  settings?: Partial<CloudSettings>;
  /** Default: the enclosing <Sky> (useSky()). `false` forces the sky-less uniform lighting. Changing it recreates the instance. */
  sky?: Sky | false;
  /** Apply the sky's aerial-perspective haze under the clouds. Leave off when you use <AutoHaze />. Read at mount. */
  haze?: boolean;
  /** Sky-less lighting values (see `clouds.lighting`). */
  lighting?: Partial<UniformLightingValues>;
  /** World-space planet centre for sky planet mode. */
  planetCenter?: Vector3 | null;
  /** A sun DirectionalLight to take cloud shadows through (`clouds.applyShadow`): only its direct light is dimmed, on meshes with `receiveShadow`. Turns the composite-alpha shadow off while set. */
  shadowLight?: DirectionalLight | null;
  /** Called after the volume is placed (for framing a camera). */
  onLoad?: (volume: GpuCloudVolume | CloudVolumeAsset) => void;
  children?: ReactNode;
}
export type CloudsProps = CloudsOwnProps & Partial<CloudSettings>;

const DEFAULT_POSITION: [number, number, number] = [0, 500, 0];

export function Clouds(props: CloudsProps) {
  const { volume, noise = '/clouds/noise/', position = DEFAULT_POSITION, quality = 'high', sky: skyProp, haze = false, lighting, planetCenter, shadowLight, onLoad, children } = props;
  const renderer = useThree(s => s.gl) as unknown as WebGPURenderer;
  const contextSky = useSky() as Sky | null;
  const sky = skyProp === false ? undefined : (skyProp ?? contextSky ?? undefined);
  const noiseAsset = use(cached(noiseCache, noise, () => loadCloudNoise(noise)));
  const packAsset = typeof volume === 'string' ? use(cached(volumeCache, volume, () => loadCloudVolume(volume))) : undefined;
  const volumeValue = typeof volume === 'string' ? packAsset : volume;

  const latest = useRef({ quality, lighting, onLoad });
  latest.current = { quality, lighting, onLoad };

  // 1. The instance. Created after the renderer is initialised; disposed in the same effect's cleanup.
  const [instance, setInstance] = useState<CloudsCore | null>(null);
  const [ctx, setCtx] = useState<CloudsContextValue | null>(null);
  // Per-instance teardown hooks, so the pipeline is handed back before the instance is disposed, whichever effect cleans up first.
  const unhook = useRef(new Map<CloudsCore, () => void>());
  useEffect(() => {
    let cancelled = false, made: CloudsCore | undefined, emptyVolume: GpuCloudVolume | undefined;
    void (async () => {
      if (!renderer.hasInitialized()) await renderer.init();
      if (cancelled) return;
      const created = made = new CloudsCore(renderer, { sky, quality: latest.current.quality, lighting: latest.current.lighting, planetCenter });
      const device = sharedBackend(renderer).device;
      setInstance(created);
      setCtx({
        clouds: created, device,
        clear: async () => {
          if (cancelled) return; // disposed with the component: nothing is shown any more
          emptyVolume ??= createEmptyCloudVolume(device, [8, 8, 8], 8, 'react empty');
          await created.setVolume(emptyVolume, { position: [0, 0, 0] });
        },
      });
    })().catch(e => console.error('@clouds/react: could not create the clouds instance', e));
    // The instance is disposed here, not from state: StrictMode and fast prop changes can unmount an instance that React never rendered with.
    return () => {
      cancelled = true; setInstance(null); setCtx(null);
      if (!made) return;
      unhook.current.get(made)?.();
      made.dispose();
      emptyVolume?.destroy();
    };
  }, [renderer, sky, planetCenter]);

  // Work on the instance runs one after another, so a fast prop change cannot interleave two setVolume calls.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = (job: () => Promise<void> | void) => { queue.current = queue.current.then(job).catch(e => console.error('@clouds/react', e)); };

  // Cloud shadows through the sun light (direct sun only).
  useEffect(() => {
    if (!instance || !shadowLight) return;
    instance.applyShadow(shadowLight);
    return () => instance.removeShadow(shadowLight);
  }, [instance, shadowLight]);

  // 2. Noise, then volume.
  useEffect(() => {
    if (!instance) return;
    let stale = false;
    enqueue(async () => { if (!stale) await instance.setNoise(noiseAsset); });
    return () => { stale = true; };
  }, [instance, noiseAsset]);
  const [px, py, pz] = position;
  useEffect(() => {
    if (!instance || !volumeValue) return;
    let stale = false;
    enqueue(async () => {
      if (stale) return;
      await instance.setVolume(volumeValue, { position: [px, py, pz] });
      if (!stale) latest.current.onLoad?.(volumeValue);
    });
    return () => { stale = true; };
  }, [instance, volumeValue, px, py, pz]);

  // 3. Quality, settings and sky-less lighting.
  useEffect(() => { if (quality !== 'auto') instance?.setQuality(quality); }, [instance, quality]);
  const settings = collectSettings(props as unknown as Record<string, unknown>);
  const key = settingsKey(settings);
  const applied = useRef<{ instance: CloudsCore | null; settings: Partial<CloudSettings>; defaults: Partial<CloudSettings> }>({ instance: null, settings: {}, defaults: {} });
  useEffect(() => {
    if (!instance) return;
    const a = applied.current;
    if (a.instance !== instance) { a.instance = instance; a.settings = {}; a.defaults = { ...instance.settings }; }
    Object.assign(instance.settings, settingsPatch(a.settings, settings, a.defaults));
    a.settings = settings;
  }, [instance, key]); // eslint-disable-line react-hooks/exhaustive-deps -- `settings` is derived from `key`
  useEffect(() => { if (instance?.lighting && lighting) Object.assign(instance.lighting, lighting); }, [instance, lighting]);

  // 4. The render pipeline. `useRenderPipeline()` without callbacks only makes sure a pipeline and its scene pass exist; the clouds node is
  //    installed here, reactively, around whatever the pipeline outputs at that moment (the scene pass, or a hazed colour from <AutoHaze />).
  const store = useStore();
  const foreignPass = useRef<ScenePass | undefined>(undefined);
  const ownPass = useRef<ScenePass | undefined>(undefined);
  // Runs before `useRenderPipeline`'s own layout effect (same component, declared first): the scene pass an earlier <AutoHaze /> left in the store.
  useLayoutEffect(() => { foreignPass.current = store.getState().passes.scenePass; }, [store]);
  const { renderPipeline, passes } = useRenderPipeline(({ passes: p }) => { ownPass.current = p.scenePass; });
  const scenePass = passes.scenePass;
  useEffect(() => {
    if (!instance || !renderPipeline || !scenePass) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pipeline = renderPipeline as any;
    const previous = pipeline.outputNode;
    let pass: ScenePass, colour: unknown;
    if (!previous || previous.isPassNode) {
      pass = previous ?? scenePass; colour = pass.getTextureNode(); // the plain scene pass
    } else {
      // Something (<AutoHaze />) already built a colour node. Its scene pass is not reachable from the node, but it is the one hook that is not ours:
      // reuse it for depth so the scene renders once. (If it cannot be told apart, depth comes from our own pass and the scene renders twice.)
      const other = [foreignPass.current, store.getState().passes.scenePass].find(p => p && p !== ownPass.current);
      pass = other ?? scenePass; colour = previous;
      if (!other) console.warn('@clouds/react: could not find the scene pass behind the pipeline output; the scene is rendered twice.');
    }
    if (haze && sky && colour !== previous) colour = sky.applyHaze(colour, { scenePass: pass });
    const node = instance.node(colour, pass);
    pipeline.outputNode = node;
    pipeline.needsUpdate = true;
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      if (pipeline.outputNode === node) pipeline.outputNode = previous; // unmount or swap: hand the pipeline back as found
      pipeline.needsUpdate = true;
      node.dispose?.();
    };
    unhook.current.set(instance, restore);
    return () => { unhook.current.delete(instance); restore(); };
  }, [instance, renderPipeline, scenePass, haze, sky, store]);

  // Children (including <Cloudscape>) mount once the instance exists, so `useClouds()` is never null inside.
  return <CloudsContext.Provider value={ctx}>{ctx ? children : null}</CloudsContext.Provider>;
}

// ---- <Cloudscape> -----------------------------------------------------------------------------------------------------------------------

export interface CloudscapeOwnProps {
  /** A preset name ('cumulus' | 'congestus' | 'stratocumulus') or a preset object. Default 'cumulus'. A change regenerates from scratch. */
  preset?: CloudPresetName | CloudPreset;
  seed?: number;
  /** Volume dims (x, map row, up) and metres per voxel. Default [512, 512, 64] at 8 m. */
  dims?: [number, number, number];
  voxelSize?: number;
  /** Base height of the field in world metres. Default 500. */
  baseHeight?: number;
  /** Re-centre the window as the camera moves (streaming). Default true; false keeps the window generated around the camera at mount. */
  follow?: boolean;
  /** Generation jobs per frame. Default 2. */
  jobsPerFrame?: number;
}
export type CloudscapeProps = CloudscapeOwnProps & Omit<CloudsProps, 'volume' | 'position' | 'onLoad' | keyof CloudscapeOwnProps>;

/** A generated cloud field that follows the camera. Standalone it creates its own <Clouds>; inside a <Clouds> it drives that instance. */
export function Cloudscape(props: CloudscapeProps) {
  const { preset, seed, dims, voxelSize, baseHeight, follow, jobsPerFrame, children, ...cloudsProps } = props;
  const inside = useContext(CloudsContext);
  const driver = <CloudscapeDriver preset={preset} seed={seed} dims={dims} voxelSize={voxelSize} baseHeight={baseHeight} follow={follow} jobsPerFrame={jobsPerFrame} />;
  if (inside) return <>{driver}{children}</>;
  return <Suspense fallback={null}><Clouds {...(cloudsProps as CloudsProps)}>{driver}{children}</Clouds></Suspense>;
}

function CloudscapeDriver({ preset = 'cumulus', seed = 1, dims, voxelSize, baseHeight = 500, follow = true, jobsPerFrame }: CloudscapeOwnProps) {
  const { clouds, device, clear } = useContext(CloudsContext)!;
  const camera = useThree(s => s.camera);
  const live = useRef<StreamingCloudscape | null>(null);   // the streamer being updated each frame
  const shown = useRef<StreamingCloudscape | null>(null);  // the streamer whose volume the clouds currently display
  const presetKey = typeof preset === 'string' ? preset : JSON.stringify(preset);
  const presetObject = useMemo<CloudPresetName | CloudPreset>(() => preset, [presetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const show = (u: StreamingUpdate) => clouds.setVolume(u.volume, { position: [u.centre[0], baseHeight, u.centre[1]] });

  useEffect(() => {
    const streamer = createStreamingCloudscape(device, { preset: presetObject, seed, dims, voxelSize, jobsPerFrame });
    let cancelled = false;
    void streamer.start(camera.position.x, camera.position.z).then(async first => {
      if (cancelled) return;
      await show(first);
      const old = shown.current;
      shown.current = streamer; live.current = streamer;
      old?.destroy(); // the clouds now read the new streamer's volume
    }).catch(e => console.error('@clouds/react: cloudscape generation failed', e));
    return () => {
      cancelled = true;
      if (live.current === streamer) live.current = null;
      if (shown.current !== streamer) streamer.destroy(); // never displayed: nothing references it
    };
  }, [device, clouds, presetObject, seed, dims?.join(), voxelSize, baseHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unmount: stop showing the field before its textures go.
  useEffect(() => () => {
    const old = shown.current;
    shown.current = null;
    if (old) void clear().then(() => old.destroy(), () => old.destroy());
  }, [clouds]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(() => {
    const s = live.current;
    if (!s || !follow || shown.current !== s) return;
    const u = s.update(camera.position.x, camera.position.z);
    if (u.swapped) void show(u);
  });
  return null;
}
