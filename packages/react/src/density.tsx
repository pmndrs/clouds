import { useFrame, useThree, type RootState as WebGPURootState } from '@react-three/fiber/webgpu';
import {
  createReferenceCloud,
  type DenseDensityField,
  type ReferenceCloudSettings,
  type ReferenceCloud as ReferenceCloudRuntime,
} from '@clouds/three';
import { Vector2, type PerspectiveCamera } from 'three/webgpu';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type DensityCloudOccluder = Parameters<typeof createReferenceCloud>[2];

export interface DensityCloudHandle {
  readonly runtime: ReferenceCloudRuntime;
  dispose(): void;
}

export interface UseDensityCloudOptions {
  readonly field: DenseDensityField;
  readonly appearance?: 'reference' | 'realistic';
  readonly occluder?: DensityCloudOccluder;
  readonly settings?: Partial<ReferenceCloudSettings>;
  readonly resolutionScale?: number;
  readonly enabled?: boolean;
  readonly renderPriority?: number;
  readonly onReady?: (handle: DensityCloudHandle) => void;
  readonly onError?: (error: Error) => void;
}

export interface DensityCloudProps extends UseDensityCloudOptions {
  children?: ReactNode;
}

const NO_OCCLUDER: DensityCloudOccluder = Object.freeze({
  min: Object.freeze([1e9, 0, 1e9] as [number, number, number]),
  max: Object.freeze([1e9 + 1, 1, 1e9 + 1] as [number, number, number]),
});

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function resolutionNumber(value: number | undefined): number {
  const resolved = value ?? 1;
  if (!Number.isFinite(resolved) || resolved <= 0 || resolved > 1) {
    throw new Error('@clouds/react DensityCloud resolutionScale must be finite and between 0 (exclusive) and 1.');
  }
  return resolved;
}

function applySettings(runtime: ReferenceCloudRuntime, next: Partial<ReferenceCloudSettings>): void {
  const target = runtime.settings as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    const current = target[key] as { copy?: (source: unknown) => unknown } | undefined;
    if (current && value && typeof current.copy === 'function') current.copy(value);
    else target[key] = value;
  }
}

export function useDensityCloud(options: UseDensityCloudOptions): ReferenceCloudRuntime | null {
  const state = useThree() as WebGPURootState;
  const renderer = state.renderer;
  const appearance = options.appearance ?? 'reference';
  const resolutionScale = resolutionNumber(options.resolutionScale);
  const occluderKey = JSON.stringify(options.occluder ?? null);
  const occluder = options.occluder ?? NO_OCCLUDER;
  const runtimeRef = useRef<ReferenceCloudRuntime | null>(null);
  const fieldRef = useRef<DenseDensityField>(options.field);
  const onReadyRef = useRef(options.onReady);
  const onErrorRef = useRef(options.onError);
  const frameConfigRef = useRef({ enabled: options.enabled !== false, resolutionScale });
  const drawingBuffer = useMemo(() => new Vector2(), []);
  const [runtime, setRuntime] = useState<ReferenceCloudRuntime | null>(null);

  useEffect(() => {
    onReadyRef.current = options.onReady;
    onErrorRef.current = options.onError;
    frameConfigRef.current = { enabled: options.enabled !== false, resolutionScale };
  }, [options.enabled, options.onError, options.onReady, resolutionScale]);

  useEffect(() => {
    let created: ReferenceCloudRuntime;
    try {
      created = createReferenceCloud(renderer, options.field, occluder, { appearance });
    } catch (error) {
      const failure = asError(error);
      onErrorRef.current?.(failure);
      throw failure;
    }
    runtimeRef.current = created;
    fieldRef.current = options.field;
    const handle: DensityCloudHandle = {
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
      created.dispose();
      setRuntime((current) => current === created ? null : current);
    };
  }, [appearance, occluderKey, renderer]);

  useEffect(() => {
    const current = runtimeRef.current;
    if (!current || fieldRef.current === options.field) return;
    try {
      current.setField(options.field);
      fieldRef.current = options.field;
    } catch (error) {
      const failure = asError(error);
      onErrorRef.current?.(failure);
      throw failure;
    }
  }, [options.field, runtime]);

  useEffect(() => {
    const current = runtimeRef.current;
    if (!current || !options.settings) return;
    applySettings(current, options.settings);
  }, [options.settings, runtime]);

  const framePriority = options.renderPriority ?? 100;
  useFrame((frameState) => {
    const current = runtimeRef.current;
    const frameConfig = frameConfigRef.current;
    if (!current || !frameConfig.enabled) {
      frameState.renderer.render(frameState.scene, frameState.camera);
      return;
    }
    try {
      const camera = frameState.camera;
      if (!(camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera) {
        throw new Error('@clouds/react DensityCloud requires a THREE.PerspectiveCamera. Orthographic cameras are unsupported by the volumetric runtime.');
      }
      const perspective = camera as PerspectiveCamera;
      if (perspective.coordinateSystem !== renderer.coordinateSystem) {
        perspective.coordinateSystem = renderer.coordinateSystem;
        perspective.updateProjectionMatrix();
      }
      renderer.getDrawingBufferSize(drawingBuffer);
      current.resize(
        Math.max(1, Math.floor(drawingBuffer.x * frameConfig.resolutionScale)),
        Math.max(1, Math.floor(drawingBuffer.y * frameConfig.resolutionScale)),
      );
      current.render(frameState.scene, perspective, true);
    } catch (error) {
      const failure = asError(error);
      onErrorRef.current?.(failure);
      throw failure;
    }
  }, { phase: 'render', priority: framePriority });

  return runtime;
}

export function DensityCloud(props: DensityCloudProps) {
  useDensityCloud(props);
  return props.children ?? null;
}

export type { DenseDensityField, ReferenceCloudSettings };
