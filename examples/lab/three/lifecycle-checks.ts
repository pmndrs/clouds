import { Color, CubeRenderTarget, PerspectiveCamera, Scene, Vector3, WebGPUCoordinateSystem, type WebGPURenderer } from 'three/webgpu';
import { createCloudscape, createCloudscapeAtlas, createCloudWorld, createDensityField, createReferenceCloud } from '@clouds/three';

/** Sequential shared-renderer checks. The caller pauses its frame loop first. */
export async function runLifecycleChecks(renderer: WebGPURenderer, progress: (message: string) => void) {
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  const checks: { name: string; passed: boolean; detail: string | number }[] = [];
  function check(name: string, passed: boolean, detail: string | number) { checks.push({ name, passed, detail }); if (!passed) throw new Error(`${name}: ${detail}`); }
  const difference = (a: Float32Array, b: Float32Array) => a.length !== b.length ? Infinity : a.reduce((max, value, i) => Math.max(max, Math.abs(value - b[i])), 0);
  const informative = (frame: Float32Array) => frame.every(Number.isFinite) && frame.some((value, index) => index % 4 === 3 && value < 0.99 && value > 0.01);
  const originalTarget = renderer.getRenderTarget(), originalFace = renderer.getActiveCubeFace(), originalMip = renderer.getActiveMipmapLevel(), originalMRT = renderer.getMRT();
  const target = new CubeRenderTarget(16); renderer.initRenderTarget(target);
  const scene = new Scene(); scene.background = new Color(0.4, 0.6, 0.8);
  const camera = new PerspectiveCamera(50, 64 / 36, 1, 30000); camera.coordinateSystem = WebGPUCoordinateSystem; camera.updateProjectionMatrix();
  const atlas = createCloudscapeAtlas(16), world = createCloudWorld({ radius: 1, coverage: 1 });
  const sourceBefore = atlas.data.slice();
  const central = world.snapshot.cells.find(cell => cell.cellX === 0 && cell.cellZ === 0)!;
  const center = new Vector3().fromArray(central.bounds.min).add(new Vector3().fromArray(central.bounds.max)).multiplyScalar(0.5);
  camera.position.copy(center).add(new Vector3(0, 300, 2600)); camera.lookAt(center); camera.updateMatrixWorld();
  let a: ReturnType<typeof createCloudscape> | undefined, b: ReturnType<typeof createCloudscape> | undefined, object: ReturnType<typeof createReferenceCloud> | undefined;
  let scopeOpen = true; device.pushErrorScope('validation');
  try {
    renderer.setRenderTarget(target, 4, 0); renderer.setMRT(null);
    const hostState = () => renderer.getRenderTarget() === target && renderer.getActiveCubeFace() === 4 && renderer.getActiveMipmapLevel() === 0 && renderer.getMRT() === null;
    for (let cycle = 0; cycle < 3; cycle++) {
      progress(`Shared-renderer lifecycle cycle ${cycle + 1}/3…`);
      a = createCloudscape(renderer, atlas, world.snapshot); b = createCloudscape(renderer, atlas, world.snapshot);
      for (const cloud of [a, b]) { cloud.resize(64, 36); cloud.settings.distanceFade = false; cloud.settings.geometryShadows = false; }
      await a.compile(scene, camera); await b.compile(scene, camera);
      check(`cycle ${cycle + 1}: compilation restores host target/face/MRT`, hostState(), 'cube face 4');
      a.render(scene, camera, false); const baseline = await a.readOptical();
      check(`cycle ${cycle + 1}: nonblank finite optical output`, informative(baseline), baseline.length);
      const otherCamera = camera.clone(); otherCamera.position.x += 500; otherCamera.lookAt(center); otherCamera.updateMatrixWorld();
      b.render(scene, otherCamera, false); const other = await b.readOptical();
      check(`cycle ${cycle + 1}: second camera has a distinct image`, informative(other) && difference(baseline, other) > 1e-4, difference(baseline, other));
      b.resize(31, 17); b.settings.density = 0; b.render(scene, otherCamera, false);
      const clear = await b.readOptical();
      check(`cycle ${cycle + 1}: independent resize and settings`, clear.length === 31 * 17 * 4 && clear.every((value, i) => Math.abs(value - (i % 4 === 3 ? 1 : 0)) < 1e-5), clear.length);
      a.render(scene, camera, false); const retained = await a.readOptical();
      check(`cycle ${cycle + 1}: other view cannot change first view`, difference(baseline, retained) <= 1e-5, difference(baseline, retained));
      check(`cycle ${cycle + 1}: render restores host target/face/MRT`, hostState(), 'cube face 4');
      b.dispose(); b.dispose();
      let rejected = false; try { b.render(scene, otherCamera, false); } catch { rejected = true; }
      check(`cycle ${cycle + 1}: disposed view rejects use`, rejected, 'render rejected'); b = undefined;
      a.render(scene, camera, false); const survivor = await a.readOptical();
      check(`cycle ${cycle + 1}: surviving view remains unchanged`, difference(baseline, survivor) <= 1e-5, difference(baseline, survivor));
      a.dispose(); a = undefined;
    }
    check('shared caller-owned atlas bytes remain unchanged', atlas.data.every((value, index) => value === sourceBefore[index]), atlas.data.length);
    progress('Checking single-cloud host target restoration…');
    const field = createDensityField('cumulus', 16, 17);
    object = createReferenceCloud(renderer, field, { min: [-2000, 0, -2000], max: [-1900, 100, -1900] }); object.resize(64, 36);
    const bounds = field.descriptor.bounds, objectCenter = new Vector3().fromArray(bounds.min).add(new Vector3().fromArray(bounds.max)).multiplyScalar(0.5);
    camera.position.copy(objectCenter).add(new Vector3(0, 250, 1500)); camera.lookAt(objectCenter); camera.updateMatrixWorld();
    object.render(scene, camera, false);
    check('single-cloud render restores host cube face', hostState(), renderer.getActiveCubeFace());
    check('single-cloud output is finite and populated', informative(await object.readOptical()), 'optical readback');
    object.dispose(); object = undefined;
    await device.queue.onSubmittedWorkDone();
    const error = await device.popErrorScope(); scopeOpen = false;
    check('WebGPU validation', error === null, error?.message ?? 'no validation errors');
    return { passed: true, checks, cycles: 3, simultaneousCloudViews: 2, ordering: 'sequential render on one shared renderer', adapter: device.adapterInfo.architecture, sourceRetained: true, limits: 'No parallel asynchronous compilation, device-loss recovery, memory-leak claim or visual acceptance.' };
  } finally {
    if (scopeOpen) await device.popErrorScope();
    a?.dispose(); b?.dispose(); object?.dispose();
    renderer.setMRT(originalMRT); renderer.setRenderTarget(originalTarget, originalFace, originalMip); target.dispose();
  }
}
