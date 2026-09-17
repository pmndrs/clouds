import { Scene, PerspectiveCamera, WebGPUCoordinateSystem, BoxGeometry, PlaneGeometry, Mesh, MeshBasicNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { createDensityField } from '../../../packages/three/src/sources/index';
import { createReferenceCloud, referenceGroundReceiver } from '../../../packages/three/src/volumetric/index';

export interface CloudCheck { name: string; passed: boolean; error: number; tolerance: number }

/** Actual production shader on small offscreen targets; half-float output tolerance fixed in advance. */
export async function runCloudChecks(renderer: WebGPURenderer): Promise<CloudCheck[]> {
  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 41 / 31, 0.1, 10000);
  camera.coordinateSystem = WebGPUCoordinateSystem; camera.updateProjectionMatrix();
  const field = createDensityField('homogeneous', 32);
  const cloud = createReferenceCloud(renderer, field, { min: [-50, 300, 50], max: [50, 400, 150] });
  cloud.resize(41, 31);
  Object.assign(cloud.settings, { densityMultiplier: 0.08, constantLight: true, castShadow: false, receiveShadow: false });
  const results: CloudCheck[] = [];
  const center = ((31 >> 1) * 41 + (41 >> 1)) * 4;
  const geometry = new BoxGeometry(100, 100, 100);
  const material = new MeshBasicNodeMaterial();
  const object = new Mesh(geometry, material); object.position.set(0, 350, 100);
  const groundGeometry = new PlaneGeometry(4000, 4000);
  const groundMaterial = new MeshBasicNodeMaterial(); groundMaterial.mrtNode = referenceGroundReceiver();
  const ground = new Mesh(groundGeometry, groundMaterial); ground.rotation.x = -Math.PI / 2;
  const check = (name: string, error: number, tolerance = 0.001) => results.push({ name, error, tolerance, passed: Number.isFinite(error) && error <= tolerance });
  async function sample() { cloud.render(scene, camera, false); return cloud.readOptical(); }
  try {
    camera.position.set(0, 350, 1000); camera.lookAt(0, 350, 0);
    let pixels = await sample();
    check('Homogeneous Beer–Lambert, 500 m', Math.abs(pixels[center + 3] - Math.exp(-1)));
    check('Linear radiance + transmittance conservation', Math.abs(pixels[center] + pixels[center + 3] - 1));
    scene.add(object); pixels = await sample();
    check('Opaque depth stops cloud at 100 m', Math.abs(pixels[center + 3] - Math.exp(-0.2)));
    scene.remove(object);
    camera.position.set(0, 350, 0); camera.lookAt(0, 350, -1000); pixels = await sample();
    check('Inside camera integrates to exit beyond near plane', Math.abs(pixels[center + 3] - Math.exp(-0.002 * 249.9)));
    // Scale positions, bounds and near plane by 2; halve extinction. Optical thickness must stay fixed.
    cloud.setField({ ...field, descriptor: { ...field.descriptor, extinctionScale: field.descriptor.extinctionScale / 2, bounds: { min: [-600, 200, -500], max: [600, 1200, 500] } } });
    camera.position.set(0, 700, 2000); camera.lookAt(0, 700, 0); pixels = await sample();
    check('World-scale/extinction equivalence', Math.abs(pixels[center + 3] - Math.exp(-1)));
    cloud.setField(createDensityField('empty', 32)); pixels = await sample();
    check('Empty density: zero radiance and unit transmittance', pixels.reduce((max, n, i) => Math.max(max, Math.abs(n - (i % 4 === 3 ? 1 : 0))), 0), 0);
    camera.position.set(0, 350, 1000); camera.lookAt(0, 350, 0);
    cloud.setField(createDensityField('cumulus', 64)); cloud.settings.constantLight = false; cloud.settings.densityMultiplier = 1;
    cloud.settings.occupancy = false; const brute = await sample();
    cloud.settings.occupancy = true; const accelerated = await sample();
    check('Conservative occupancy matches full march', brute.reduce((max, n, i) => Math.max(max, Math.abs(n - accelerated[i])), 0), 0.00001);
    // Compare cloud optical output with a matching opaque box shadow enabled.
    cloud.settings.receiveShadow = true; const shadowed = await sample();
    const shadowDifference = accelerated.reduce((max, n, i) => i % 4 === 3 ? max : Math.max(max, n - shadowed[i]), 0);
    results.push({ name: 'Opaque box casts into voxel cloud', passed: shadowDifference > 0.001, error: shadowDifference, tolerance: 0.001 });
    scene.add(ground); camera.position.set(600, 900, 1000); camera.lookAt(0, 0, 0);
    cloud.settings.receiveShadow = false; cloud.settings.castShadow = false;
    cloud.render(scene, camera, false); const unshadowedGround = await cloud.readComposite();
    cloud.settings.castShadow = true; cloud.render(scene, camera, false); const shadowedGround = await cloud.readComposite();
    const groundDifference = unshadowedGround.reduce((max, n, i) => i % 4 === 3 ? max : Math.max(max, n - shadowedGround[i]), 0);
    results.push({ name: 'Voxel cloud casts onto opaque ground', passed: groundDifference > 0.01, error: groundDifference, tolerance: 0.01 });
    // A uniform overhead slab must shade every ground pixel identically, even
    // where distant perspective depth loses sub-metre world-position precision.
    cloud.setField({ ...field, descriptor: { ...field.descriptor, bounds: { min: [-10000, 1000, -10000], max: [10000, 1500, 10000] } } });
    ground.scale.setScalar(10);
    camera.far = 20000; camera.updateProjectionMatrix();
    let groundStabilityError = 0;
    for (const offset of [0, 0.1, -0.1]) {
      camera.position.set(850 + offset, 900, 6000); camera.lookAt(0, 0, 0);
      cloud.render(scene, camera, false); const shaded = await cloud.readComposite();
      for (let y = 12; y <= 18; y++) for (let x = 17; x <= 23; x++) {
        groundStabilityError = Math.max(groundStabilityError, Math.abs(shaded[(y * 41 + x) * 4] - 0.25));
      }
    }
    check('Distant ground shadow remains continuous under camera motion', groundStabilityError, 0.002);
    const unmarked = new Mesh(groundGeometry, material);
    unmarked.rotation.x = -Math.PI / 2; unmarked.position.y = 2; unmarked.scale.setScalar(10);
    scene.add(unmarked); camera.position.set(0, 100, 500); camera.lookAt(0, 2, 0);
    const hostTarget = renderer.getRenderTarget(), hostMRT = renderer.getMRT();
    cloud.render(scene, camera, false); const unmarkedPixels = await cloud.readComposite();
    check('Ground receiver marker does not affect other opaque surfaces', Math.abs(unmarkedPixels[center] - 1), 0.001);
    check('Cloud pass restores caller render target and MRT state', renderer.getRenderTarget() === hostTarget && renderer.getMRT() === hostMRT ? 0 : 1, 0);
    scene.remove(unmarked);
    cloud.resize(23, 17); cloud.render(scene, camera, false); const resized = await cloud.readOptical();
    check('Resize rebuilds output bindings', resized.length === 23 * 17 * 4 && resized.every(Number.isFinite) ? 0 : 1, 0);
    cloud.dispose(); cloud.dispose();
    let rejects = false; try { cloud.render(scene, camera, false); } catch { rejects = true; }
    check('Disposed renderer rejects dispatch', rejects ? 0 : 1, 0);
    return results;
  } finally { cloud.dispose(); geometry.dispose(); groundGeometry.dispose(); material.dispose(); groundMaterial.dispose(); }
}
