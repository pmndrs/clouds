import type { WebGPURenderer } from 'three/webgpu';
import type { Bounds3 } from '@clouds/core';
import type { DenseDensityField } from '../sources/density';
import type { MorphologyNoiseResources } from '../sources/morphology-noise';
import { createReferenceCloud } from './index';

export const MORPHOLOGY_BOUNDS: Bounds3 = { min: [-4500, 900, -4500], max: [4500, 3500, 4500] };

/** Conservative domain support, not a baked density approximation. */
export function createMorphologyDomain(bounds: Bounds3 = MORPHOLOGY_BOUNDS): DenseDensityField {
  const dimensions = [96, 64, 96] as const;
  return {
    descriptor: {
      id: 'morphology-conservative-domain', revision: 0, dimensions,
      bounds, encoding: 'r8unorm', extinctionScale: .006,
    },
    data: new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2]).fill(255),
  };
}

/** Experimental procedural formation; shares the authored-volume integrator. */
export function createMorphologyCloud(renderer: WebGPURenderer, noise: MorphologyNoiseResources, bounds: Bounds3 = MORPHOLOGY_BOUNDS): ReturnType<typeof createReferenceCloud> {
  return createReferenceCloud(renderer, createMorphologyDomain(bounds),
    { min: [50000, 0, 50000], max: [50001, 1, 50001] },
    { appearance: 'realistic', morphology: noise });
}
