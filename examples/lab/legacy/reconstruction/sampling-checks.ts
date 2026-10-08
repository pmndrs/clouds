import { Scene, PerspectiveCamera, WebGPUCoordinateSystem, Mesh, PlaneGeometry, MeshBasicNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { createCloudscape } from '../../../../packages/legacy/three/src/cloudscape';
import { createCloudWorld, type WorldSnapshot } from '../../../../packages/legacy/three/src/world';
import { createCloudscapeAtlas } from '../../../../packages/legacy/three/src/sources/cloudscape-atlas';

/** An unresolved detail field must integrate its mean, not a camera-dependent alias. */
export async function runSamplingChecks(renderer: WebGPURenderer) {
  const results: { name: string; passed: boolean; error: number; tolerance: number }[] = [];
  const check = (name: string, error: number, tolerance: number) => results.push({ name, error, tolerance, passed: Number.isFinite(error) && error <= tolerance });
  const base = createCloudWorld({ radius: 4, coverage: 0 }).snapshot;
  const fixture: WorldSnapshot = { ...base, revision: 1, cells: base.cells.map((cell, i) => ({ ...cell, active: i === 40, bounds: { min: [-500, 1000, -500], max: [500, 2000, 500] }, extinctionScale: 0.001 })) };
  const atlas = createCloudscapeAtlas(4); atlas.data.fill(255);
  const cloud = createCloudscape(renderer, atlas, fixture); cloud.resize(65, 49);
  Object.assign(cloud.settings, { distanceFade: false, detail: 0.16, stepMetres: 24, maxSteps: 320, hazeStrength: 0, constantLight: true, shadows: false, skipEmpty: false });
  const camera = new PerspectiveCamera(5, 65 / 49, 1, 15000); camera.coordinateSystem = WebGPUCoordinateSystem; camera.updateProjectionMatrix();
  const scene = new Scene();
  // Terminate exactly at the slab exit: the fixture should measure detail
  // filtering, not midpoint quadrature error at a discontinuous box boundary.
  const geometry = new PlaneGeometry(2000, 2000), material = new MeshBasicNodeMaterial();
  const stop = new Mesh(geometry, material); stop.position.set(0, 1500, -500); scene.add(stop);
  const center = (24 * 65 + 32) * 4;
  const render = async (x: number) => { camera.position.set(x, 1500, 0); camera.lookAt(x, 1500, -500); cloud.render(scene, camera, false); return cloud.readOptical(); };
  try {
    camera.position.set(0, 1500, 0); camera.lookAt(0, 1500, -500);
    await cloud.compile(scene, camera);
    const a = await render(0), b = await render(10);
    // The center ray travels 499 m between the near plane and the volume exit.
    // Fully filtered detail has mean multiplier 1 - detail/2, independent of phase.
    const expected = Math.exp(-0.001 * (1 - 0.16 / 2) * 499);
    check('Unresolved density detail integrates its mean extinction', Math.max(Math.abs(a[center + 3] - expected), Math.abs(b[center + 3] - expected)), 0.001);
    check('Camera translation does not strobe unresolved density detail', a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0), 0.001);
    cloud.settings.viewSubsteps = 4; cloud.settings.lightSteps = 64;
    const dense = await render(10);
    cloud.settings.skipEmpty = true; const skipped = await render(10);
    check('Four-substep sampling preserves occupancy/full-march parity', dense.reduce((m, v, i) => Math.max(m, Math.abs(v - skipped[i])), 0), 0.00001);
    cloud.settings.viewSubsteps = 1;
    check('Filtered density retains radiance/transmittance conservation', a.reduce((m, v, i) => i % 4 === 3 ? Math.max(m, Math.abs(v + a[i - 3] - 1)) : m, 0), 0.001);
    cloud.resize(1, 1); camera.aspect = 1; camera.fov = 90; camera.updateProjectionMatrix();
    const coarsePixel = await render(0);
    check('Coarse pixel footprint retains nominal detail mean', Math.abs(coarsePixel[3] - expected), 0.001);
    cloud.resize(65, 49); camera.aspect = 65 / 49; camera.fov = 5; camera.updateProjectionMatrix();
    cloud.settings.maxSteps = 1024; cloud.settings.stepMetres = 1;
    const resolved = await render(0);
    // Independent dense quadrature of the continuous source, not the shader's
    // sampling lattice. At this budget the central ray resolves the modulation.
    let opticalDepth = 0;
    for (let i = 0; i < 4990; i++) {
      const z = -(1 + (i + 0.5) * 0.1);
      const n = Math.sin(Math.sin(z * 0.041)) * Math.sin(1500 * 0.091 + z * 0.025);
      opticalDepth += 0.001 * (1 - 0.16 * (0.5 + 0.5 * n)) * 0.1;
    }
    check('Resolved density detail agrees with dense source quadrature', Math.abs(resolved[center + 3] - Math.exp(-opticalDepth)), 0.002);
    check('Resolved density detail remains present', Math.abs(resolved[center + 3] - a[center + 3]) > 0.001 ? 0 : 1, 0);
  } finally { cloud.dispose(); geometry.dispose(); material.dispose(); }
  return results;
}
