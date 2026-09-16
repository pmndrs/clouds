import { describe, expect, it } from 'vitest';
import { createDefaultCameraPaths, sampleCameraPath } from './camera';

describe('deterministic camera paths', () => {
  it('samples from absolute time and clamps outside the path', () => {
    const path = createDefaultCameraPaths().ground;
    expect(sampleCameraPath(path, 2).position[0]).toBeCloseTo(0);
    expect(sampleCameraPath(path, 2).position[1]).toBeCloseTo(1.7);
    expect(sampleCameraPath(path, 2).position[2]).toBeCloseTo(4.5);
    expect(sampleCameraPath(path, -1).position).toEqual(path.keyframes[0].position);
    expect(sampleCameraPath(path, 99).position).toEqual(path.keyframes[1].position);
    expect(sampleCameraPath(path, 2).position).toEqual(sampleCameraPath(path, 2).position);
  });
});
