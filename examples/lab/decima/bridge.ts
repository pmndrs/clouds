// D0: the flagship's three <-> runtime glue (flagship/three-bridge.ts) plus a matte mode: `matte` = true presents the cloud's opacity
// 1 - a as grey (exact silhouettes for the parity masks).
// D1 round 5: the present pass owns the post chain (the page sets the renderer to NoToneMapping and a linear output colour space): `post.mode`
// 0 = three's ACES filmic at `post.exposure` (what the page had), 1 = linear x exposure, clamped (for the linear captures the tone-curve fit reads),
// 2 = the Decima fit (POST_FIT: a tone curve and colour matrix fitted to Guerrilla's frames, work/reports/D1.md section 9); then the sRGB OETF and,
// with `post.dither`, a triangular +-1/255 dither before the 8-bit canvas. Without the dither a converged (noise-free) render shows its 8-bit
// quantisation as contour lines on every shallow gradient (the judges' topographic rings), which Decima's frames hide under their film grain.
import { DepthTexture, FloatType, HalfFloatType, RenderTarget, type Camera, type Scene } from 'three';
import { MeshBasicNodeMaterial, QuadMesh, StorageTexture, WebGPURenderer } from 'three/webgpu';
import { acesFilmicToneMapping, clamp, hash, mat3, screenCoordinate, select, sRGBTransferOETF, texture, uniform, vec3, vec4 } from 'three/tsl';
import { Matrix4, Vector3 } from 'three';
import type { CloudFrame, CloudRuntime } from '@clouds/runtime';
import { sharedBackend } from '../../../packages/legacy/three/src/gpu/backend';

export function createCloudBridge(renderer: WebGPURenderer, runtime: CloudRuntime, options: { matte?: boolean } = {}) {
  const backend = sharedBackend(renderer);
  const sceneTarget = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true });
  sceneTarget.texture.name = 'cloud scene colour';
  sceneTarget.depthTexture = new DepthTexture(1, 1, FloatType);
  const cloudOutput = new StorageTexture(1, 1);
  cloudOutput.type = HalfFloatType; cloudOutput.generateMipmaps = false; cloudOutput.name = 'cloud composite';
  const material = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  const cloud = texture(cloudOutput);
  // TSL nodes are typed loosely here (any): the chain mixes float, vec3 and mat3 nodes that the typings do not follow.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const uMode: any = uniform(0), uExposure: any = uniform(1), uDither: any = uniform(1), uSeed: any = uniform(0);
  const uCurve: any = uniform(vec4(POST_FIT.curve[0], POST_FIT.curve[1], POST_FIT.curve[2], POST_FIT.curve[3]));
  const uMatrix: any = uniform(mat3(...POST_FIT.matrix));
  const linear: any = texture(sceneTarget.texture).rgb.mul(cloud.a).add(cloud.rgb);
  const exposed: any = linear.mul(uExposure);
  // The fit: the colour matrix in exposed linear space, then the per-channel curve y = c x^a / (x^a + b) + d (postFitCurve).
  const fitted: any = postFitCurve(uMatrix.mul(exposed), uCurve);
  const mapped: any = select(uMode.equal(1), exposed, select(uMode.equal(2), fitted, acesFilmicToneMapping(linear, uExposure)));
  const encoded: any = sRGBTransferOETF(clamp(mapped, 0, 1));
  // Triangular dither (two uniform hashes) of +-1/255 in display space.
  const sc: any = screenCoordinate;
  const n1: any = hash(sc.x.add(sc.y.mul(1920.37)).add(uSeed));
  const n2: any = hash(sc.x.mul(1.73).add(sc.y.mul(733.91)).add(uSeed.mul(2.17)).add(17.3));
  const dither: any = n1.add(n2).sub(1).mul(uDither.div(255));
  material.colorNode = vec4(encoded.add(dither), 1);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const matteMaterial = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  matteMaterial.colorNode = vec4((sRGBTransferOETF as any)(vec3(cloud.a.oneMinus())), 1);
  const matteQuad = new QuadMesh(matteMaterial);
  const quad = new QuadMesh(material);
  // Before the runtime is ready (or after it is disposed) the cloud texture is never written; present the plain scene instead.
  const plainMaterial = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plainMaterial.colorNode = vec4((sRGBTransferOETF as any)(clamp((acesFilmicToneMapping as any)(texture(sceneTarget.texture).rgb, uExposure), 0, 1)), 1);
  const plainQuad = new QuadMesh(plainMaterial);

  const views = new WeakMap<GPUTexture, GPUTextureView>();
  const proj = new Matrix4(), viewProj = new Matrix4(), invViewProj = new Matrix4(), prev = new Matrix4();
  const m = { view: new Float32Array(16), projection: new Float32Array(16), viewProjection: new Float32Array(16), inverseViewProjection: new Float32Array(16), previousViewProjection: new Float32Array(16) };
  const camPos = [0, 0, 0];
  const worldPos = new Vector3();
  let width = 0, height = 0, cwNow = 0, chNow = 0;

  let seed = 0;
  return {
    /** Present the opacity instead of the image (switchable per frame). */
    matte: !!options.matte,
    /** The post chain of the present pass (see the file comment). */
    post: { mode: 0 as 0 | 1 | 2, exposure: 1, dither: 1 },
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
    present() {
      uMode.value = this.post.mode; uExposure.value = this.post.exposure; uDither.value = this.post.dither; uSeed.value = (seed = (seed + 1) % 4096) * 0.7319;
      (runtime.ready ? (this.matte ? matteQuad : quad) : plainQuad).render(renderer);
    },
  };
}

/**
 * D1 round 5: the Decima post fit (scripts/d1/postfit.py against the deck frames; work/reports/D1.md section 9). `curve` = (a, b, c, d) of the
 * per-channel display curve y = c * x^a / (x^a + b) + d on the exposed linear value, `matrix` = a 3x3 colour matrix (column-major, three's mat3)
 * applied before the curve. Identity until the fit is run.
 */
export const POST_FIT = {
  // scripts/d1/postfit.py on the nine frames (sky-anchored, ridge 0.05): a nearly linear curve with a gentle shoulder and a 0.07 lift, and a
  // warm matrix (R gains 1.26 and 0.16 of G; B 1.17). Cloud luminance-quantile residual 0.228 (ACES) -> 0.165, sky 0.28 -> 0.20.
  curve: [1.71181, 0.53868, 1.22388, 0.10256] as [number, number, number, number],   // D1 round 11: refitted on the cloud alone (postfit.py --erode 6, round-11 linear captures); round 5's [0.97562, 2.15726, 1.79074, 0.06686]
  matrix: [1.09510, 0.02209, 0.05579, 0.06710, 1.03225, 0.03359, -0.03817, 0.02637, 1.03210] as [number, number, number, number, number, number, number, number, number],
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function postFitCurve(x: any, c: any): any {
  const xa = clamp(x, 0, 1e4).pow(c.x);
  return xa.div(xa.add(c.y)).mul(c.z).add(c.w);
}
