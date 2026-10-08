import { Scene, PerspectiveCamera, WebGPUCoordinateSystem } from 'three/webgpu';
import { createCloudWorld, type WorldSnapshot } from '../../../../packages/three/src/world';
import { buildCandidateMasks } from '../../../../packages/three/src/world-candidates';
import { createCloudscapeAtlas } from '../../../../packages/three/src/sources/cloudscape-atlas';
import { createCloudscape } from '../../../../packages/three/src/cloudscape';
import type { WebGPURenderer } from 'three/webgpu';

export async function runCloudscapeChecks(renderer: WebGPURenderer) {
  const results: { name: string; passed: boolean; error: number; tolerance: number }[] = [];
  const check = (name: string, error: number, tolerance = 0.001) => results.push({ name, passed: Number.isFinite(error) && error <= tolerance, error, tolerance });
  const scene = new Scene(), camera = new PerspectiveCamera(50, 41 / 31, 1, 40000);
  camera.coordinateSystem = WebGPUCoordinateSystem; camera.updateProjectionMatrix(); camera.position.set(0, 1500, 3000); camera.lookAt(0, 1500, 0);
  const emptyWorld = createCloudWorld({ radius: 1, coverage: 0 }).snapshot;
  const atlas = createCloudscapeAtlas(4); atlas.data.fill(255);
  const cloud = createCloudscape(renderer, atlas, emptyWorld); cloud.resize(41, 31);
  // Keep analytic fixtures independent of the camera-relative support fade.
  Object.assign(cloud.settings, { cachedLighting: false, shadows: false, constantLight: true, detail: 0, maxSteps: 512, stepMetres: 10, distanceFade: false });
  const center = (15 * 41 + 20) * 4;
  const sample = async () => { cloud.render(scene, camera, false); return cloud.readOptical(); };
  const fixture = (count: number): WorldSnapshot => ({ ...emptyWorld, revision: count + 1, cells: emptyWorld.cells.map((cell, i) => ({ ...cell, active: i === 4 || (count === 2 && i === 3), bounds: { min: [-500, 1000, -500], max: [500, 2000, 500] }, extinctionScale: 0.001 })) });
  try {
    const empty = await sample(); check('Empty world has zero radiance and unit transmittance', empty.reduce((max, n, i) => Math.max(max, Math.abs(n - (i % 4 === 3 ? 1 : 0))), 0), 0);
    cloud.setWorld(fixture(1)); const single = await sample();
    check('Homogeneous world volume matches physical optical depth', Math.abs(single[center + 3] - Math.exp(-1)), 0.006);
    check('Linear world radiance / transmittance conservation', Math.abs(single[center] + single[center + 3] - 1));
    cloud.setWorld(fixture(2)); const overlap = await sample();
    check('Overlapping world cells sum extinction in one march', Math.abs(overlap[center + 3] - single[center + 3] ** 2));
    cloud.settings.density = 30; cloud.settings.earlyTermination = false; const fullOpaque = await sample();
    cloud.settings.earlyTermination = true; const stoppedOpaque = await sample();
    check('Opaque-ray cutoff stays within optical error budget', fullOpaque.reduce((max, n, i) => Math.max(max, Math.abs(n - stoppedOpaque[i])), 0), 0.001);
    cloud.settings.density = 1;
    const sparse = createCloudWorld({ radius: 3, coverage: 0.15 }); cloud.setWorld(sparse.snapshot);
    cloud.settings.constantLight = false; cloud.settings.detail = 0.16;
    cloud.settings.skipEmpty = false; const brute = await sample(); cloud.settings.skipEmpty = true; const skipped = await sample();
    check('Cell traversal matches full sample lattice', brute.reduce((max, n, i) => Math.max(max, Math.abs(n - skipped[i])), 0), 0.00001);
    const candidateReference = buildCandidateMasks(sparse.snapshot).data;
    const candidateGpu = await cloud.readCandidates();
    check('GPU candidate mask matches CPU conservative reference', candidateGpu.length === candidateReference.length && candidateGpu.every((value, i) => value === candidateReference[i]) ? 0 : 1, 0);
    const before = cloud.evidence.worldUploads; cloud.setWorld(sparse.update([50, 100, 50])); await sample();
    check('Camera motion within cell avoids world upload', cloud.evidence.worldUploads - before, 0);
    cloud.settings.cachedLighting = true; cloud.settings.shadows = true; await sample(); const cacheBefore = cloud.evidence.cacheUpdates;
    await sample(); check('Unchanged lighting reuses the cache', cloud.evidence.cacheUpdates - cacheBefore, 0);
    cloud.settings.sunDirection.set(0.2, 1, 0.3).normalize(); await sample(); check('Sun change refreshes lighting once', Math.abs(cloud.evidence.cacheUpdates - cacheBefore - 1), 0);
    const cacheAfterSun = cloud.evidence.cacheUpdates;
    cloud.settings.sunDirection.multiplyScalar(5); await sample();
    check('Sun magnitude does not rebuild normalized lighting cache', cloud.evidence.cacheUpdates - cacheAfterSun, 0);
    cloud.setWorld(sparse.update([2300, 100, 50])); await sample(); check('Resident-window shift refreshes lighting', Math.abs(cloud.evidence.cacheUpdates - cacheBefore - 2), 0);
    cloud.resize(23, 17); const resized = await sample(); check('World output resizes without stale bindings', resized.length === 23 * 17 * 4 && resized.every(Number.isFinite) ? 0 : 1, 0);
    cloud.dispose(); cloud.dispose(); let rejected = false; try { await sample(); } catch { rejected = true; } check('Disposed world rejects render', rejected ? 0 : 1, 0);
    const shapedWorld = createCloudWorld({ radius: 3, coverage: 0.3 });
    const shaped = createCloudscape(renderer, createCloudscapeAtlas(16), shapedWorld.snapshot); shaped.resize(41, 31);
    Object.assign(shaped.settings, { shadows: false, cachedLighting: false, detail: 0.16, distanceFade: false });
    try {
      camera.position.set(1000, 1400, 5000); camera.lookAt(0, 1500, 0);
      shaped.settings.skipEmpty = false; shaped.render(scene, camera, false); const fullShape = await shaped.readOptical();
      shaped.settings.skipEmpty = true; shaped.render(scene, camera, false); const fastShape = await shaped.readOptical();
      check('Traversal preserves shaped cloud edges and thin density', fullShape.reduce((max, n, i) => Math.max(max, Math.abs(n - fastShape[i])), 0), 0.00001);
      check('Shaped comparison contains visible density', fullShape.some((n, i) => i % 4 === 3 && n < 0.99) ? 0 : 1, 0);
    } finally { shaped.dispose(); }

    // The support fade is deliberately enabled here. Both snapshots contain
    // the same deterministic global cells, but the residency window is
    // rebased while the camera and view remain fixed. The output should stay
    // continuous through the overlap rather than inherit a moving grid edge.
    const continuityWorld = createCloudWorld({ radius: 4, coverage: 1, seed: 91 });
    const continuity = createCloudscape(renderer, createCloudscapeAtlas(24, 17), continuityWorld.snapshot);
    continuity.resize(41, 31);
    Object.assign(continuity.settings, { cachedLighting: false, shadows: false, constantLight: true, detail: 0.16, skipEmpty: true, distanceFade: true, maxSteps: 512, stepMetres: 10 });
    const rebasePosition = [0, 1400, 5000] as const;
    const originalSnapshot = continuityWorld.update(rebasePosition);
    camera.position.fromArray(rebasePosition); camera.lookAt(0, 1500, 0);
    const maxDifference = (a: Float32Array, b: Float32Array) => a.reduce((max, value, i) => Math.max(max, Math.abs(value - b[i])), 0);
    try {
      continuity.setWorld(originalSnapshot); continuity.render(scene, camera, false); const original = await continuity.readOptical();
      const shiftedSnapshot = continuityWorld.update([2200, 1400, 5000]);
      continuity.setWorld(shiftedSnapshot); continuity.render(scene, camera, false); const rebased = await continuity.readOptical();
      check('World rebase preserves same-camera cloud density', maxDifference(original, rebased), 0.00001);
      check('Rebase fixture contains visible cloud density', original.some((value, i) => i % 4 === 3 && value < 0.999) ? 0 : 1, 0);

      const beforeBoundarySnapshot = continuityWorld.update([2199.9, 1400, 5000]);
      const afterBoundarySnapshot = continuityWorld.update([2200.1, 1400, 5000]);
      continuity.setWorld(beforeBoundarySnapshot); camera.position.set(2199.9, 1400, 5000); camera.lookAt(0, 1500, 0);
      continuity.render(scene, camera, false); const beforeBoundary = await continuity.readOptical();
      continuity.setWorld(afterBoundarySnapshot); camera.position.set(2200.1, 1400, 5000); camera.lookAt(0, 1500, 0);
      continuity.render(scene, camera, false); const afterBoundary = await continuity.readOptical();
      check('Small camera crossing keeps cloud density continuous', maxDifference(beforeBoundary, afterBoundary), 0.04);
    } finally { continuity.dispose(); }
    return results;
  } finally { cloud.dispose(); }
}
