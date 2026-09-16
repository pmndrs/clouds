import type { Vec3 } from '@clouds/core';

export type CameraPathName = 'ground' | 'side' | 'interior';

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
  readonly fovDegrees: number;
}

export interface CameraKeyframe extends CameraPose {
  /** Time in seconds from the start of the path. */
  readonly timeSeconds: number;
}

export interface CameraPath {
  readonly name: CameraPathName | string;
  readonly durationSeconds: number;
  readonly keyframes: readonly CameraKeyframe[];
}

const DEFAULT_UP: Vec3 = [0, 1, 0];

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function vec3(value: readonly number[], label: string): Vec3 {
  if (value.length !== 3 || value.some(n => !Number.isFinite(n))) throw new Error(`${label} must contain three finite values`);
  return [value[0], value[1], value[2]];
}

function validatePath(path: CameraPath): void {
  if (!path.name || !Number.isFinite(path.durationSeconds) || path.durationSeconds < 0) throw new Error('Camera path duration must be finite and nonnegative');
  if (path.keyframes.length === 0) throw new Error('Camera path requires at least one keyframe');
  let previous = -Infinity;
  for (const frame of path.keyframes) {
    finite(frame.timeSeconds, 'Keyframe time');
    if (frame.timeSeconds < 0 || frame.timeSeconds > path.durationSeconds || frame.timeSeconds < previous) throw new Error('Camera keyframes must be ordered within the path duration');
    vec3(frame.position, 'Camera position');
    vec3(frame.target, 'Camera target');
    vec3(frame.up, 'Camera up');
    finite(frame.fovDegrees, 'Camera field of view');
    if (frame.fovDegrees <= 0 || frame.fovDegrees >= 180) throw new Error('Camera field of view must be between 0 and 180 degrees');
    previous = frame.timeSeconds;
  }
}

function interpolate(a: CameraKeyframe, b: CameraKeyframe, t: number): CameraPose {
  const mix = (x: number, y: number) => x + (y - x) * t;
  const mixVec = (x: Vec3, y: Vec3): Vec3 => [mix(x[0], y[0]), mix(x[1], y[1]), mix(x[2], y[2])];
  return { position: mixVec(a.position, b.position), target: mixVec(a.target, b.target), up: mixVec(a.up, b.up), fovDegrees: mix(a.fovDegrees, b.fovDegrees) };
}

/** Samples a path using absolute time. Time is clamped; no frame delta is accumulated. */
export function sampleCameraPath(path: CameraPath, timeSeconds: number): CameraPose {
  validatePath(path);
  const time = Math.min(path.durationSeconds, Math.max(0, finite(timeSeconds, 'Sample time')));
  if (time <= path.keyframes[0].timeSeconds) return { ...path.keyframes[0], position: [...path.keyframes[0].position], target: [...path.keyframes[0].target], up: [...path.keyframes[0].up] };
  for (let i = 1; i < path.keyframes.length; i++) {
    const next = path.keyframes[i];
    if (time <= next.timeSeconds) {
      const previous = path.keyframes[i - 1];
      const span = next.timeSeconds - previous.timeSeconds;
      return interpolate(previous, next, span === 0 ? 1 : (time - previous.timeSeconds) / span);
    }
  }
  const last = path.keyframes[path.keyframes.length - 1];
  return { ...last, position: [...last.position], target: [...last.target], up: [...last.up] };
}

/** Three diagnostic placeholder paths with stable absolute-time keyframes. */
export function createDefaultCameraPaths(): Readonly<Record<CameraPathName, CameraPath>> {
  const make = (name: CameraPathName, keyframes: readonly CameraKeyframe[]): CameraPath => ({ name, durationSeconds: keyframes[keyframes.length - 1].timeSeconds, keyframes });
  return {
    ground: make('ground', [
      { timeSeconds: 0, position: [4, 1.6, 6], target: [0, 1, 0], up: DEFAULT_UP, fovDegrees: 55 },
      { timeSeconds: 4, position: [-4, 1.8, 3], target: [0, 1.2, 0], up: DEFAULT_UP, fovDegrees: 55 },
    ]),
    side: make('side', [
      { timeSeconds: 0, position: [7, 3, 0], target: [0, 2, 0], up: DEFAULT_UP, fovDegrees: 50 },
      { timeSeconds: 4, position: [-7, 3, 0], target: [0, 2, 0], up: DEFAULT_UP, fovDegrees: 50 },
    ]),
    interior: make('interior', [
      { timeSeconds: 0, position: [-0.8, 2, 0], target: [0.8, 2.1, -4], up: DEFAULT_UP, fovDegrees: 70 },
      { timeSeconds: 4, position: [0.8, 2.1, -4], target: [1.3, 2.3, -8], up: DEFAULT_UP, fovDegrees: 70 },
    ]),
  };
}
