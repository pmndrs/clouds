import {
  Color, PerspectiveCamera, Scene, Vector3, WebGPUCoordinateSystem, WebGPURenderer,
} from 'three/webgpu';
import { createCloudscape } from '../../../packages/three/src/cloudscape';
import { createCloudscapeAtlas } from '../../../packages/three/src/sources/cloudscape-atlas';
import { createCloudWorld } from '../../../packages/three/src/world';
import { compareFrames, compareTemporalResidual, summarizeMotion } from './metrics';

export interface ProductionPreview {
  current: Float32Array;
  dense: Float32Array;
  width: number;
  height: number;
}

/** Audit the shared cloudscape with its real atlas and resident world. */
export async function runProductionCloudAudit(
  update: (message: string) => void,
  present: (preview: ProductionPreview) => void,
) {
  const renderer = new WebGPURenderer({ antialias: false });
  await renderer.init();
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  device.pushErrorScope('validation');
  let validationScopeOpen = true;
  const scene = new Scene(); scene.background = new Color(0.36, 0.56, 0.81);
  const camera = new PerspectiveCamera(48, 16 / 9, 1, 30000); camera.coordinateSystem = WebGPUCoordinateSystem; camera.updateProjectionMatrix();
  const world = createCloudWorld({ seed: 17 });
  update('Generating the production cloud atlas…');
  const atlas = createCloudscapeAtlas();
  const cloud = createCloudscape(renderer, atlas, world.snapshot); cloud.resize(96, 54);
  const active = world.snapshot.cells.filter(cell => cell.active).sort((a, b) => Math.hypot(a.cellX, a.cellZ) - Math.hypot(b.cellX, b.cellZ))[0];
  if (!active) throw new Error('Production audit world contains no active cloud.');
  const center = new Vector3().fromArray(active.bounds.min).add(new Vector3().fromArray(active.bounds.max)).multiplyScalar(0.5);
  Object.assign(cloud.settings, {
    density: 0.7, detail: 0.16, detailFiltering: true, stepMetres: 24, maxSteps: 320,
    // `shadows` gates cloud self-shadowing as well as ground shadows. Keep it
    // enabled so the light-step sweep actually evaluates directLight().
    distanceFade: false, shadows: true, geometryShadows: false, cachedLighting: false,
    hazeStrength: 0, earlyTermination: true,
  });
  const poses = Array.from({ length: 12 }, (_, index) => {
    const phase = index / 11, angle = -0.8 + phase * Math.PI * 1.5;
    const radius = 5000 + 1200 * Math.cos(phase * Math.PI * 2);
    return center.clone().add(new Vector3(Math.sin(angle) * radius, 330 + 220 * Math.sin(phase * Math.PI * 2), Math.cos(angle) * radius));
  });
  const currentFrames: Float32Array[] = [], qualityFrames: Float32Array[] = [], denseFrames: Float32Array[] = [];
  const spatial = [], temporal = [], qualitySpatial = [], qualityTemporal = [];
  const currentCosts: number[] = [], qualityCosts: number[] = [], denseCosts: number[] = [];
  const render = async (viewSubsteps: number, lightSteps: number) => {
    cloud.settings.viewSubsteps = viewSubsteps; cloud.settings.lightSteps = lightSteps;
    const start = performance.now();
    cloud.render(scene, camera, false);
    const pixels = await cloud.readOptical();
    // The optical attachment stores transmittance. Metrics use opacity to mask
    // empty background and compare cloud radiance only.
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 1 - pixels[i];
    return { pixels, elapsedMs: performance.now() - start };
  };
  const started = performance.now();
  try {
    await cloud.compile(scene, camera);
    for (const [index, position] of poses.entries()) {
      update(`Production atlas motion ${index + 1} / ${poses.length}…`);
      camera.position.copy(position); camera.lookAt(center); camera.updateMatrixWorld();
      cloud.setWorld(world.update(camera.position.toArray()));
      const current = await render(1, 48), quality = await render(4, 192), dense = await render(4, 256);
      currentFrames.push(current.pixels); qualityFrames.push(quality.pixels); denseFrames.push(dense.pixels);
      currentCosts.push(current.elapsedMs); qualityCosts.push(quality.elapsedMs); denseCosts.push(dense.elapsedMs);
      spatial.push(compareFrames(current.pixels, dense.pixels));
      qualitySpatial.push(compareFrames(quality.pixels, dense.pixels));
      if (index > 0) temporal.push(compareTemporalResidual(current.pixels, currentFrames[index - 1], dense.pixels, denseFrames[index - 1]));
      if (index > 0) qualityTemporal.push(compareTemporalResidual(quality.pixels, qualityFrames[index - 1], dense.pixels, denseFrames[index - 1]));
    }
    const support = currentFrames.reduce((count, frame) => {
      for (let i = 3; i < frame.length; i += 4) if (frame[i] > 0.01) count++;
      return count;
    }, 0);
    const partial = currentFrames.reduce((count, frame) => {
      for (let i = 3; i < frame.length; i += 4) if (frame[i] > 0.01 && frame[i] < 0.99) count++;
      return count;
    }, 0);
    const sampleCount = currentFrames.length * 96 * 54;
    const cloudSupportFraction = support / sampleCount, partialOpacityFraction = partial / sampleCount;
    if (cloudSupportFraction < 0.02 || cloudSupportFraction > 0.95 || partialOpacityFraction < 0.01) {
      throw new Error(`Production audit scene is under-informative (support ${cloudSupportFraction.toFixed(3)}, partial ${partialOpacityFraction.toFixed(3)}).`);
    }
    present({ current: qualityFrames.at(-1)!, dense: denseFrames.at(-1)!, width: 96, height: 54 });
    update('Checking 4× substep empty-space parity…');
    cloud.settings.cachedLighting = false; cloud.settings.skipEmpty = false; const brute = (await render(4, 64)).pixels;
    cloud.settings.skipEmpty = true; const skipped = (await render(4, 64)).pixels;
    let skipMaxError = 0;
    for (let i = 0; i < brute.length; i++) skipMaxError = Math.max(skipMaxError, Math.abs(brute[i] - skipped[i]));
    update('Checking light-cache budget invalidation…');
    cloud.settings.cachedLighting = true; cloud.settings.lightSteps = 48; cloud.invalidateLighting(); cloud.render(scene, camera, false);
    const before = cloud.evidence.cacheUpdates;
    cloud.settings.lightSteps = 64; cloud.render(scene, camera, false);
    const cacheRefreshes = cloud.evidence.cacheUpdates - before;
    await device.queue.onSubmittedWorkDone();
    const validationError = await device.popErrorScope(); validationScopeOpen = false;
    if (validationError) throw new Error(`Production WebGPU validation failed: ${validationError.message}`);
    return {
      source: 'production createCloudscapeAtlas + createCloudWorld(seed 17)',
      device: device.adapterInfo.description || device.adapterInfo.architecture || device.adapterInfo.vendor,
      renderSize: [96, 54], path: '12 deterministic camera poses over a 270-degree orbit with zoom and vertical travel',
      current: { viewSubsteps: 1, lightSteps: 48 }, quality: { viewSubsteps: 4, lightSteps: 192 }, dense: { viewSubsteps: 4, lightSteps: 256 },
      lighting: { cloudSelfShadowing: true, geometryShadows: false, integration: 'direct; cache disabled during motion comparison' },
      currentVersusDense: summarizeMotion(spatial, temporal, performance.now() - started),
      qualityVersusDense: summarizeMotion(qualitySpatial, qualityTemporal, performance.now() - started),
      cloudSupportFraction, partialOpacityFraction,
      measuredRenderCostMs: {
        currentMean: currentCosts.reduce((sum, value) => sum + value, 0) / currentCosts.length,
        qualityMean: qualityCosts.reduce((sum, value) => sum + value, 0) / qualityCosts.length,
        denseMean: denseCosts.reduce((sum, value) => sum + value, 0) / denseCosts.length,
        qualityToCurrentRatio: qualityCosts.reduce((sum, value) => sum + value, 0) / currentCosts.reduce((sum, value) => sum + value, 0),
        denseToCurrentRatio: denseCosts.reduce((sum, value) => sum + value, 0) / currentCosts.reduce((sum, value) => sum + value, 0),
        includesReadback: true,
      },
      denseSkipParityMaxError: skipMaxError, denseSkipParityPassed: skipMaxError <= 1e-5,
      lightBudgetCacheRefreshes: cacheRefreshes, lightBudgetCacheRefreshPassed: cacheRefreshes === 1,
      postBlur: false, temporalHistory: false,
    };
  } finally {
    if (validationScopeOpen) await device.popErrorScope();
    cloud.dispose(); renderer.dispose();
  }
}
