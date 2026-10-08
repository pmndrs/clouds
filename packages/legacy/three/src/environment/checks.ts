import { Color, RenderTarget, Scene, Texture, type WebGPURenderer } from 'three/webgpu';
import { createCloudscapeAtlas } from '../sources/cloudscape-atlas';
import { createCloudWorld } from '../world';
import { decodeFloat16 } from '../volumetric';
import { sharedBackend } from '../gpu/backend';
import { createCloudscapeEnvironment } from './index';

export interface EnvironmentCheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly error: number;
  readonly tolerance: number;
}

type TextureWithPMREMFlag = { readonly isPMREMTexture?: boolean };

async function readCubeCenters(renderer: WebGPURenderer, texture: ReturnType<typeof createCloudscapeEnvironment>['cubeTexture'], size: number): Promise<number[][]> {
  const backend = sharedBackend(renderer);
  const { device } = backend;
  const native = backend.texture(texture);
  const bytesPerRow = Math.ceil(size * 8 / 256) * 256;
  const staging = device.createBuffer({ size: bytesPerRow * size * 6, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const encoder = device.createCommandEncoder({ label: 'cloudscape-environment-check-readback' });
    encoder.copyTextureToBuffer(
      { texture: native },
      { buffer: staging, bytesPerRow, rowsPerImage: size },
      [size, size, 6],
    );
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await staging.mapAsync(GPUMapMode.READ);
    const packed = new Uint16Array(staging.getMappedRange());
    const result: number[][] = [];
    const center = Math.floor(size / 2);
    for (let face = 0; face < 6; face += 1) {
      const offset = face * bytesPerRow * size / 2 + center * bytesPerRow / 2 + center * 4;
      result.push([decodeFloat16(packed[offset]), decodeFloat16(packed[offset + 1]), decodeFloat16(packed[offset + 2]), decodeFloat16(packed[offset + 3])]);
    }
    staging.unmap();
    return result;
  } finally {
    staging.destroy();
  }
}

/**
 * Small real-device checks for the isolated environment path. This helper is
 * intentionally separate from the lighting checks because it creates its own
 * cloud runtime and never renders the caller's opaque scene.
 */
export async function runEnvironmentChecks(renderer: WebGPURenderer): Promise<EnvironmentCheckResult[]> {
  const results: EnvironmentCheckResult[] = [];
  const check = (name: string, error: number, tolerance = 0.001) => results.push({ name, error, tolerance, passed: Number.isFinite(error) && error <= tolerance });
  const size = 16;
  const background = new Scene();
  const faceColors = Array.from({ length: 6 }, (_, face) => new Color().setRGB(1.25 + face * 0.13, 1.5 + face * 0.07, 1.8 + face * 0.05));
  const atlas = createCloudscapeAtlas(4);
  const world = createCloudWorld({ radius: 0, coverage: 0 }).snapshot;
  const capture = createCloudscapeEnvironment(renderer, atlas, world, {
    cubeSize: size,
    probePosition: [0, 350, 0],
    backgroundScene: background,
    onBeforeFace: ({ face, scene }) => { scene.background = faceColors[face]; },
  });
  capture.cloudscape.settings.density = 0;
  const hostTarget = new RenderTarget(2, 2);
  const previousTarget = renderer.getRenderTarget();
  const previousFace = renderer.getActiveCubeFace();
  const previousMip = renderer.getActiveMipmapLevel();
  const previousMRT = renderer.getMRT();
  const callerScene = new Scene();
  callerScene.background = new Color(0x102030);
  const callerEnvironment = new Texture();
  callerScene.environment = callerEnvironment;
  try {
    renderer.setRenderTarget(hostTarget);
    const before = renderer.getRenderTarget();
    const beforeMRT = renderer.getMRT();
    const first = await capture.refresh();
    check('Environment refresh produces a PMREM texture', (first as TextureWithPMREMFlag).isPMREMTexture === true ? 0 : 1, 0);
    check('Environment refresh restores the caller render target', renderer.getRenderTarget() === hostTarget ? 0 : 1, 0);
    check('Environment capture remains marked clean after explicit refresh', capture.needsRefresh ? 1 : 0, 0);
    const centers = await readCubeCenters(renderer, capture.cubeTexture, size);
    const exactFaceValues = centers.every((pixel, face) => pixel.slice(0, 3).every((value, channel) => Math.abs(value - faceColors[face][['r', 'g', 'b'][channel] as 'r' | 'g' | 'b']) <= 0.005));
    check('All six environment faces preserve linear HDR values', exactFaceValues ? 0 : 1, 0);
    check('Environment face writes remain distinct', new Set(centers.map((pixel) => pixel[0].toFixed(2))).size >= 5 ? 0 : 1, 0);
    check('Capture disables view fade and reference geometry shadows', capture.cloudscape.settings.distanceFade || capture.cloudscape.settings.geometryShadows ? 1 : 0, 0);
    check('Environment capture restores the host target and MRT', before === hostTarget && renderer.getRenderTarget() === hostTarget && renderer.getMRT() === beforeMRT ? 0 : 1, 0);

    capture.attach(callerScene);
    check('Environment attachment preserves caller background', callerScene.background instanceof Color && callerScene.background.getHex() === 0x102030 ? 0 : 1, 0);
    check('Environment attachment installs the filtered environment', callerScene.environment === capture.environmentTexture ? 0 : 1, 0);
    const second = await capture.refresh();
    check('Refresh replaces the filtered environment resource', first === second ? 1 : 0, 0);
    check('Attached scenes follow an explicit environment refresh', callerScene.environment === second ? 0 : 1, 0);
    capture.detach(callerScene);
    check('Detach restores caller environment ownership', callerScene.environment === callerEnvironment ? 0 : 1, 0);
    capture.attach(callerScene);
    capture.dispose();
    check('Dispose restores caller environment ownership', callerScene.environment === callerEnvironment ? 0 : 1, 0);
  } finally {
    hostTarget.dispose();
    callerEnvironment.dispose();
    background.clear();
    renderer.setMRT(previousMRT);
    renderer.setRenderTarget(previousTarget, previousFace, previousMip);
    capture.dispose();
  }
  return results;
}
