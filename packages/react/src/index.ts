import {
  useFrame,
  useThree,
  type RootState as WebGPURootState,
} from '@react-three/fiber/webgpu';
import {
  createCloudscape,
  createCloudscapeAtlas,
  createCloudWorld,
  type Cloudscape as CloudscapeRuntime,
  type CloudscapeAtlas,
  type CloudscapeSettings,
  type CloudWorld,
  type WorldSnapshot,
} from '@clouds/three';
import {
  Matrix4,
  Vector2,
  Vector3,
  type PerspectiveCamera,
} from 'three/webgpu';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/** Conservative defaults for the binding. Full-resolution output is the default. */
export const DEFAULT_CLOUDSCAPE_QUALITY = Object.freeze({
  resolutionScale: 1,
  sceneResolutionScale: 1,
  temporalGuides: false,
});

export interface CloudscapeQuality {
  /** Cloud integration resolution as a fraction of the drawing buffer. */
  readonly resolutionScale?: number;
  /** Opaque scene resolution as a fraction of the drawing buffer. */
  readonly sceneResolutionScale?: number;
  /** Allocate the optional motion/depth/reactivity guide texture. */
  readonly temporalGuides?: boolean;
}

export interface CloudscapeHandle {
  readonly runtime: CloudscapeRuntime;
  dispose(): void;
}

export interface UseCloudscapeOptions {
  /** CPU atlas source. The runtime uploads its own GPU copy. */
  readonly source?: CloudscapeAtlas;
  /** Alias for source, useful when a scene calls the input an atlas. */
  readonly atlas?: CloudscapeAtlas;
  /** A caller-owned world or an immutable initial snapshot. */
  readonly world?: CloudWorld | WorldSnapshot;
  readonly quality?: CloudscapeQuality;
  /** Settings are applied when this object changes. Use a new object for updates. */
  readonly settings?: Partial<CloudscapeSettings>;
  /** Optional directional light used for the scene-shadow input. */
  readonly directionalShadow?: Parameters<CloudscapeRuntime['setDirectionalShadow']>[0];
  /** Scheduler order within R3F's render phase. */
  readonly renderPriority?: number;
  readonly enabled?: boolean;
  readonly onReady?: (handle: CloudscapeHandle) => void;
  readonly onError?: (error: Error) => void;
}

export interface CloudscapeProps extends UseCloudscapeOptions {
  children?: ReactNode;
}

function isCloudWorld(value: CloudWorld | WorldSnapshot): value is CloudWorld {
  return typeof (value as CloudWorld).update === 'function' && 'snapshot' in value;
}

function qualityNumber(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0 || resolved > 1) {
    throw new Error(`@clouds/react ${name} must be finite and between 0 (exclusive) and 1.`);
  }
  return resolved;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function applySettings(runtime: CloudscapeRuntime, next: Partial<CloudscapeSettings>): void {
  const target = runtime.settings as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    const current = target[key] as { copy?: (source: unknown) => unknown } | undefined;
    if (current && value && typeof current.copy === 'function') current.copy(value);
    else target[key] = value;
  }
}

/**
 * Own one cloudscape runtime for one R3F view.
 *
 * The hook deliberately uses the WebGPU entry point. Its render-phase job is
 * the only presentation job for this view: the vanilla runtime renders the
 * opaque scene into its MRT, integrates the cloud, then presents the result.
 */
export function useCloudscape(options: UseCloudscapeOptions = {}): CloudscapeRuntime | null {
  const state = useThree() as WebGPURootState;
  const renderer = state.renderer;
  const defaultAtlas = useMemo(() => createCloudscapeAtlas(), []);
  const source = options.source ?? options.atlas ?? defaultAtlas;
  const defaultWorld = useMemo(() => createCloudWorld(), []);
  const worldInput = options.world ?? defaultWorld;
  const initialWorld = isCloudWorld(worldInput) ? worldInput.snapshot : worldInput;
  const worldIdentityRef = useRef(worldInput);
  const initialWorldRef = useRef(initialWorld);
  const quality = options.quality;
  const resolutionScale = qualityNumber(quality?.resolutionScale, DEFAULT_CLOUDSCAPE_QUALITY.resolutionScale, 'quality.resolutionScale');
  const sceneResolutionScale = qualityNumber(quality?.sceneResolutionScale, DEFAULT_CLOUDSCAPE_QUALITY.sceneResolutionScale, 'quality.sceneResolutionScale');
  const temporalGuides = quality?.temporalGuides ?? DEFAULT_CLOUDSCAPE_QUALITY.temporalGuides;
  const runtimeRef = useRef<CloudscapeRuntime | null>(null);
  const worldRef = useRef<CloudWorld | WorldSnapshot>(worldInput);
  const lastWorldRef = useRef<WorldSnapshot | null>(null);
  const previousViewProjection = useRef(new Matrix4());
  const lastCameraRef = useRef<PerspectiveCamera | null>(null);
  const cameraPosition = useMemo(() => new Vector3(), []);
  const viewProjection = useMemo(() => new Matrix4(), []);
  const drawingBuffer = useMemo(() => new Vector2(), []);
  const onReadyRef = useRef(options.onReady);
  const onErrorRef = useRef(options.onError);
  const frameConfigRef = useRef({
    enabled: options.enabled !== false,
    resolutionScale,
    sceneResolutionScale,
    temporalGuides,
  });
  const [runtime, setRuntime] = useState<CloudscapeRuntime | null>(null);

  // These refs feed the frame callback. Update them after commit so an
  // interrupted concurrent render cannot alter an already-running view.
  useEffect(() => {
    onReadyRef.current = options.onReady;
    onErrorRef.current = options.onError;
    worldRef.current = worldInput;
    frameConfigRef.current = { enabled: options.enabled !== false, resolutionScale, sceneResolutionScale, temporalGuides };
    if (worldIdentityRef.current !== worldInput) {
      worldIdentityRef.current = worldInput;
      initialWorldRef.current = initialWorld;
    }
  }, [initialWorld, options.enabled, options.onError, options.onReady, resolutionScale, sceneResolutionScale, temporalGuides, worldInput]);

  useEffect(() => {
    const createdInitialWorld = initialWorldRef.current;
    const created = createCloudscape(renderer, source, createdInitialWorld, { temporalGuides });
    runtimeRef.current = created;
    lastWorldRef.current = createdInitialWorld;
    lastCameraRef.current = null;
    const handle: CloudscapeHandle = {
      runtime: created,
      dispose: () => {
        if (runtimeRef.current === created) runtimeRef.current = null;
        setRuntime((current) => current === created ? null : current);
        created.dispose();
      },
    };
    setRuntime(created);
    onReadyRef.current?.(handle);
    return () => {
      if (runtimeRef.current === created) runtimeRef.current = null;
      if (lastWorldRef.current === createdInitialWorld) lastWorldRef.current = null;
      created.dispose();
      setRuntime((current) => current === created ? null : current);
    };
  }, [renderer, source, worldInput, temporalGuides]);

  useEffect(() => {
    const current = runtimeRef.current;
    if (!current || !options.settings) return;
    applySettings(current, options.settings);
    current.invalidateLighting();
  }, [runtime, options.settings]);

  useEffect(() => {
    const current = runtimeRef.current;
    if (!current) return;
    current.setDirectionalShadow(options.directionalShadow ?? null);
  }, [runtime, options.directionalShadow]);

  const framePriority = options.renderPriority ?? 100;
  useFrame((frameState) => {
    const current = runtimeRef.current;
    const frameConfig = frameConfigRef.current;
    if (!current || !frameConfig.enabled) {
      // A render-phase user job suppresses R3F's default render job. Keep the
      // host scene visible while the cloud resource is mounting or disabled.
      frameState.renderer.render(frameState.scene, frameState.camera);
      return;
    }

    try {
      const camera = frameState.camera;
      if (!(camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera) {
        throw new Error('@clouds/react Cloudscape requires a THREE.PerspectiveCamera. Orthographic cameras are unsupported by the volumetric runtime.');
      }
      const perspective = camera as PerspectiveCamera;
      // R3F callers may replace the camera with a fresh Three camera. Apply
      // the host renderer's depth convention before the runtime validates it.
      if (perspective.coordinateSystem !== renderer.coordinateSystem) {
        perspective.coordinateSystem = renderer.coordinateSystem;
        perspective.updateProjectionMatrix();
      }
      perspective.updateMatrixWorld();
      perspective.getWorldPosition(cameraPosition);
      const sourceWorld = worldRef.current;
      if (isCloudWorld(sourceWorld)) {
        const nextWorld = sourceWorld.update(cameraPosition.toArray());
        if (nextWorld !== lastWorldRef.current) {
          current.setWorld(nextWorld);
          lastWorldRef.current = nextWorld;
        }
      } else if (sourceWorld !== lastWorldRef.current) {
        current.setWorld(sourceWorld);
        lastWorldRef.current = sourceWorld;
      }

      renderer.getDrawingBufferSize(drawingBuffer);
      const sceneWidth = Math.max(1, Math.floor(drawingBuffer.x * frameConfig.sceneResolutionScale));
      const sceneHeight = Math.max(1, Math.floor(drawingBuffer.y * frameConfig.sceneResolutionScale));
      const cloudWidth = Math.max(1, Math.floor(drawingBuffer.x * frameConfig.resolutionScale));
      const cloudHeight = Math.max(1, Math.floor(drawingBuffer.y * frameConfig.resolutionScale));
      current.resize(cloudWidth, cloudHeight, sceneWidth, sceneHeight);

      if (frameConfig.temporalGuides) {
        viewProjection.multiplyMatrices(perspective.projectionMatrix, perspective.matrixWorldInverse);
        if (lastCameraRef.current !== perspective) {
          previousViewProjection.current.copy(viewProjection);
          lastCameraRef.current = perspective;
        }
        current.setTemporalMatrices(viewProjection, previousViewProjection.current);
      }
      current.render(frameState.scene, perspective, true);
      if (frameConfig.temporalGuides) previousViewProjection.current.copy(viewProjection);
    } catch (error) {
      const failure = asError(error);
      onErrorRef.current?.(failure);
      throw failure;
    }
  }, { phase: 'render', priority: framePriority });

  return runtime;
}

/** Declarative cloudscape view. Children are rendered into the caller's scene. */
export function Cloudscape(props: CloudscapeProps) {
  useCloudscape(props);
  return props.children ?? null;
}

export type Cloudscape = CloudscapeRuntime;
export type { CloudscapeSettings };
export type { CloudscapeAtlas, CloudWorld, WorldSnapshot };
export { createCloudscapeAtlas, createCloudWorld };
export { DensityCloud, useDensityCloud } from './density';
export type { DensityCloudHandle, DensityCloudProps, UseDensityCloudOptions } from './density';
