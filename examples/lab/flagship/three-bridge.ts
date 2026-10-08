// three <-> runtime glue for P1 (moves to the P2 adapter package): scene render target with depth, the runtime's
// output as a three StorageTexture, and a QuadMesh that blends `scene * a + rgb` before three's tone mapping.
import { DepthTexture, FloatType, HalfFloatType, RenderTarget, type Camera, type Scene } from 'three';
import { MeshBasicNodeMaterial, QuadMesh, StorageTexture, WebGPURenderer } from 'three/webgpu';
import { texture, vec4 } from 'three/tsl';
import { Matrix4, Vector3 } from 'three';
import type { CloudFrame, CloudRuntime } from '@clouds/runtime';
import { sharedBackend } from '../../../packages/legacy/three/src/gpu/backend';

export function createCloudBridge(renderer: WebGPURenderer, runtime: CloudRuntime) {
  const backend = sharedBackend(renderer);
  const sceneTarget = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true });
  sceneTarget.texture.name = 'cloud scene colour';
  sceneTarget.depthTexture = new DepthTexture(1, 1, FloatType);
  const cloudOutput = new StorageTexture(1, 1);
  cloudOutput.type = HalfFloatType; cloudOutput.generateMipmaps = false; cloudOutput.name = 'cloud composite';
  const material = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  const cloud = texture(cloudOutput);
  material.colorNode = vec4(texture(sceneTarget.texture).rgb.mul(cloud.a).add(cloud.rgb), 1);
  const quad = new QuadMesh(material);
  // Before the runtime is ready (or after it is disposed) the cloud texture is never written; present the plain scene instead.
  const plainMaterial = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  plainMaterial.colorNode = vec4(texture(sceneTarget.texture).rgb, 1);
  const plainQuad = new QuadMesh(plainMaterial);

  const views = new WeakMap<GPUTexture, GPUTextureView>();
  const proj = new Matrix4(), viewProj = new Matrix4(), invViewProj = new Matrix4(), prev = new Matrix4();
  const m = { view: new Float32Array(16), projection: new Float32Array(16), viewProjection: new Float32Array(16), inverseViewProjection: new Float32Array(16), previousViewProjection: new Float32Array(16) };
  const camPos = [0, 0, 0];
  const worldPos = new Vector3();
  let width = 0, height = 0, cwNow = 0, chNow = 0;

  return {
    resize(w: number, h: number) {
      if (w === width && h === height) return;
      width = w; height = h;
      sceneTarget.setSize(w, h);
      this.syncOutput();
    },
    /** The cloud texture follows the tier's composite scale (P5-C): call after `runtime.setQuality` (the loop does, every frame). Bilinear sampling upsamples it. */
    syncOutput() {
      const cw = Math.max(1, Math.round(width * runtime.outputScale)), ch = Math.max(1, Math.round(height * runtime.outputScale));
      if (cwNow === cw && chNow === ch && runtime.outputSize[0] === cw) return;
      cwNow = cw; chNow = ch;
      cloudOutput.setSize(cw, ch, 1);
      renderer.initTexture(cloudOutput);
      runtime.resize(width, height, backend.texture(cloudOutput));
    },
    /** Step 1: scene -> render target with depth. */
    renderScene(scene: Scene, camera: Camera) {
      renderer.setRenderTarget(sceneTarget);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
    },
    /** Camera matrices + scene depth view for runtime.encode. Call after renderScene. */
    fillFrame(camera: Camera, out: Pick<CloudFrame, 'view' | 'projection' | 'viewProjection' | 'inverseViewProjection' | 'previousViewProjection' | 'depth' | 'depthKind' | 'cameraPosition'>) {
      camera.updateMatrixWorld();
      proj.copy(camera.projectionMatrix);
      viewProj.multiplyMatrices(proj, camera.matrixWorldInverse);
      invViewProj.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
      prev.fromArray(m.viewProjection);
      camera.matrixWorldInverse.toArray(m.view); proj.toArray(m.projection); viewProj.toArray(m.viewProjection);
      invViewProj.toArray(m.inverseViewProjection); prev.toArray(m.previousViewProjection);
      Object.assign(out, m);
      const native = backend.texture(sceneTarget.depthTexture!);
      let view = views.get(native);
      if (!view) views.set(native, view = native.createView({ aspect: 'depth-only' }));
      out.depth = view; out.depthKind = 'depth32float';
      camera.getWorldPosition(worldPos).toArray(camPos); out.cameraPosition = camPos;
    },
    /** Step 3: blend and tone-map to the canvas. */
    present() { (runtime.ready ? quad : plainQuad).render(renderer); },
  };
}
