import { PerspectiveCamera, Scene, WebGPUCoordinateSystem, type WebGPURenderer } from 'three/webgpu';
import { createCloudscape } from '../../../../packages/legacy/three/src/cloudscape';
import { createPersistentCloudWorld } from '../../../../packages/legacy/three/src/world/persistent';
import { createCloudscapeAtlas } from '../../../../packages/legacy/three/src/sources/cloudscape-atlas';
import { createCoarseCloudscapeAtlas } from '../../../../packages/legacy/three/src/sources/atlas-lod';
import type { WorldSnapshot } from '../../../../packages/legacy/three/src/world';

/** Optical/support checks. These intentionally do not certify lighting quality. */
export async function runPersistentWorldChecks(renderer: WebGPURenderer) {
  const results: { name: string; passed: boolean; error: number; tolerance: number }[] = [];
  const check = (name: string, error: number, tolerance = 0) => results.push({ name, error, tolerance, passed: Number.isFinite(error) && error <= tolerance });
  const delta = (a: Float32Array, b: Float32Array) => a.reduce((m, n, i) => Math.max(m, Math.abs(n - b[i])), 0);
  const world = createPersistentCloudWorld({ coverage: 0 });
  const empty = world.snapshot;
  const fixture: WorldSnapshot = { ...empty, revision: 1, cells: empty.cells.map((cell, i) => i !== (empty.cells.length - 1) / 2 ? cell : {
    ...cell, active: true, extinctionScale: .001, bounds: { min: [-400, 1100, -400], max: [400, 1900, 400] },
  }) };
  const atlas = createCloudscapeAtlas(4); atlas.data.fill(255);
  const coarseAtlas = createCoarseCloudscapeAtlas(atlas);
  const cloud = createCloudscape(renderer, atlas, empty, { persistent: { coarseAtlas } });
  const scene = new Scene(), camera = new PerspectiveCamera(50, 33 / 25, 1, 100000);
  camera.coordinateSystem = WebGPUCoordinateSystem; camera.updateProjectionMatrix();
  const pose = (distance: number) => { camera.position.set(0, 1500, distance); camera.lookAt(0, 1500, 0); };
  pose(20000); cloud.resize(33, 25);
  Object.assign(cloud.settings, { shadows: false, cachedLighting: false, constantLight: true, detail: 0, distanceFade: true, maxSteps: 1024, viewSubsteps: 4, stepMetres: 10, earlyTermination: false });
  const center = (12 * 33 + 16) * 4;
  const sample = async () => { cloud.render(scene, camera, false); return cloud.readOptical(); };
  try {
    check('Fixed region survives a camera cut without changing its snapshot', world.update([250000, 1500, -250000]) === empty ? 0 : 1);
    const blank = await sample();
    check('Zero coverage is exactly empty', blank.reduce((m, n, i) => Math.max(m, Math.abs(n - (i % 4 === 3 ? 1 : 0))), 0));
    cloud.setWorld(fixture); cloud.settings.refinementMode = 'coarse';
    const distant = await sample();
    check('Cloud at 20 km retains its optical depth despite legacy fade setting', Math.abs(distant[center + 3] - Math.exp(-.8)), .015);
    const uploads = cloud.evidence.worldUploads;
    pose(12000); await sample(); pose(20000); const returned = await sample();
    check('Camera travel does not upload or rebase world cells', cloud.evidence.worldUploads - uploads);
    check('Returning to a pose reproduces distant support', delta(distant, returned));
    cloud.settings.refinementMode = 'fine'; const fine = await sample();
    check('Equal-density coarse/fine endpoints do not double extinction', delta(distant, fine));
    cloud.settings.refinementMode = 'auto'; pose(6000); const blended = await sample();
    check('Automatic projected-size policy refines the nearby formation', cloud.evidence.refinedCells === 1 ? 0 : 1);
    cloud.settings.refinementMode = 'coarse'; const nearbyCoarse = await sample();
    check('Equal-density transition preserves optical depth', delta(blended, nearbyCoarse));
    cloud.settings.refinementMode = 'fine'; cloud.settings.fineReady = false; const unavailable = await sample();
    check('Unavailable fine data retains coarse support', delta(unavailable, nearbyCoarse));
    check('Unavailable fine data selects zero refinement weights', cloud.evidence.refinedCells);
    cloud.settings.fineReady = true; cloud.settings.refinementMode = 'coarse';
    cloud.settings.skipEmpty = false; const full = await sample();
    cloud.settings.skipEmpty = true; const skipped = await sample();
    check('Large-region candidate traversal preserves the full sample lattice', delta(full, skipped), .00001);
    cloud.settings.cachedLighting = true; await sample(); const cacheBefore = cloud.evidence.cacheUpdates;
    await sample(); check('Unchanged refinement reuses light cache', cloud.evidence.cacheUpdates - cacheBefore);
    cloud.settings.refinementMode = 'fine'; await sample();
    check('Refinement changes refresh shared lighting once', Math.abs(cloud.evidence.cacheUpdates - cacheBefore - 1));
    await sample(); check('Stable fine endpoint reuses refreshed cache', Math.abs(cloud.evidence.cacheUpdates - cacheBefore - 1));
  } finally { cloud.dispose(); }
  // Different homogeneous endpoints exercise the actual density blend, not
  // just endpoint selection. This deliberately substitutes a half-density coarse field.
  coarseAtlas.data.fill(128);
  const mixed = createCloudscape(renderer, atlas, fixture, { persistent: { coarseAtlas } });
  mixed.resize(33, 25); pose(6000);
  Object.assign(mixed.settings, { shadows: false, cachedLighting: false, constantLight: true, maxSteps: 1024, viewSubsteps: 4, stepMetres: 10, earlyTermination: false });
  try {
    const pixels = 400 / (5600 * (2 * Math.tan(50 * Math.PI / 360) / 25));
    const t = (pixels - 1) / 2, weight = t * t * (3 - 2 * t);
    check('Transition fixture exercises a partial weight', weight > .1 && weight < .9 ? 0 : 1);
    mixed.render(scene, camera, false); const image = await mixed.readOptical();
    const expectedT = Math.exp(-.8 * ((128 / 255) * (1 - weight) + weight));
    check('Partial LOD integrates one blended extinction field', Math.abs(image[center + 3] - expectedT), .015);
  } finally { mixed.dispose(); }
  // Separate shaped source ensures support is not only proven for a filled box.
  const shapeAtlas = createCloudscapeAtlas(24);
  const shaped = createCloudscape(renderer, shapeAtlas, fixture, { persistent: { coarseAtlas: createCoarseCloudscapeAtlas(shapeAtlas) } });
  shaped.resize(65, 49); camera.aspect = 65 / 49; camera.updateProjectionMatrix(); pose(20000);
  Object.assign(shaped.settings, { shadows: false, cachedLighting: false, constantLight: true, maxSteps: 1024, viewSubsteps: 4, stepMetres: 10, refinementMode: 'auto' });
  try {
    shaped.render(scene, camera, false); const image = await shaped.readOptical();
    check('Shaped coarse formation remains visible at 20 km', image.some((n, i) => i % 4 === 3 && n < .99) ? 0 : 1);
    check('Distant automatic policy retains coarse representation', shaped.evidence.refinedCells);
  } finally { shaped.dispose(); }
  return results;
}
