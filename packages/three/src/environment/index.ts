import {
  CubeCamera,
  CubeRenderTarget,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  PMREMGenerator,
  RGBAFormat,
  Scene,
  Vector3,
  WebGPUCoordinateSystem,
  type PerspectiveCamera,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import type { createCloudscapeAtlas } from '../sources/cloudscape-atlas';
import { sharedBackend } from '../gpu/backend';
import { createCloudscape } from '../cloudscape';
import type { WorldSnapshot } from '../world';

type Atlas = ReturnType<typeof createCloudscapeAtlas>;
type Cloudscape = ReturnType<typeof createCloudscape>;

/** The settings copied into the independent capture cloud runtime. */
export type CloudscapeCaptureSettings = Cloudscape['settings'];

/** A live cloudscape whose settings can be copied into the capture runtime. */
export type CloudscapeSettingsSource = Pick<Cloudscape, 'settings'>;

/** Context passed to the optional per-face background hook. */
export interface EnvironmentCaptureFaceContext {
  readonly face: number;
  readonly camera: PerspectiveCamera;
  readonly scene: Scene;
  readonly position: Vector3;
}

export interface CloudscapeEnvironmentOptions {
  /** Fixed world-space probe position. It is copied when the adapter is created. */
  readonly probePosition?: Vector3 | readonly [number, number, number];
  /** Resolution of each raw cube face. Defaults to 64. */
  readonly cubeSize?: number;
  readonly near?: number;
  readonly far?: number;
  /**
   * A dedicated sky/background scene, such as `SkyAtmosphereBaker.skyScene`.
   * The main camera scene is intentionally not accepted by this adapter.
   * `null` selects a black background; omitting it creates an empty scene.
   */
  readonly backgroundScene?: Scene | null;
  /** Configure the dedicated background scene before each cube face. */
  readonly onBeforeFace?: (context: EnvironmentCaptureFaceContext) => void;
  /** Copy the initial settings from the main cloud runtime. */
  readonly settingsSource?: CloudscapeSettingsSource;
}

export interface CloudscapeEnvironmentCapture {
  /** Independent volumetric runtime used only by environment refreshes. */
  readonly cloudscape: Cloudscape;
  /** Raw six-face, linear HDR cube. */
  readonly cubeTexture: Texture;
  /** PMREM-filtered linear HDR environment texture, or null before refresh. */
  readonly environmentTexture: Texture | null;
  /** True until the caller explicitly calls refresh(). */
  readonly needsRefresh: boolean;
  /** Fixed position used by every refresh. */
  readonly probePosition: Vector3;
  /** Render six cube faces and update the PMREM environment texture. */
  refresh(): Promise<Texture>;
  /** Copy the cloud settings and sun direction explicitly, then mark dirty. */
  syncSettings(source: CloudscapeSettingsSource): void;
  /** Copy only the sun direction explicitly, then mark dirty. */
  syncSunDirection(direction: Vector3 | readonly [number, number, number]): void;
  /** Use the capture environment for this scene while preserving its background. */
  attach(scene: Scene): void;
  /** Restore a scene's prior environment if it still points at this adapter. */
  detach(scene: Scene): void;
  dispose(): void;
}

const DEFAULT_PROBE_POSITION = new Vector3(0, 350, 0);
const DEFAULT_CUBE_SIZE = 64;
const DEFAULT_NEAR = 1;
const DEFAULT_FAR = 80_000;

function finiteNumber(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 2) throw new Error(`${name} must be an integer greater than one.`);
  return value;
}

function copyCloudSettings(target: Cloudscape, source: CloudscapeSettingsSource): void {
  const from = source.settings;
  const to = target.settings;
  to.sunRadiance.copy(from.sunRadiance);
  to.ambientRadiance.copy(from.ambientRadiance);
  to.hazeColor.copy(from.hazeColor);
  to.hazeDensity = from.hazeDensity;
  to.hazeStrength = from.hazeStrength;
  to.density = from.density;
  to.stepMetres = from.stepMetres;
  to.maxSteps = from.maxSteps;
  to.viewSubsteps = from.viewSubsteps;
  to.lightSteps = from.lightSteps;
  to.lightSampling = from.lightSampling ?? 'normalized';
  to.detail = from.detail;
  to.detailFiltering = from.detailFiltering;
  to.refinementMode = from.refinementMode;
  to.fineReady = from.fineReady;
  to.skipEmpty = from.skipEmpty;
  // The capture is a fixed probe and must not use camera-distance fading.
  to.distanceFade = false;
  to.earlyTermination = from.earlyTermination;
  to.cachedLighting = from.cachedLighting;
  to.shadows = from.shadows;
  // The capture scene intentionally contains only the supplied sky/background;
  // opaque scene geometry must not feed the cloud shadow path.
  to.geometryShadows = false;
  to.constantLight = from.constantLight;
  to.sunDirection.copy(from.sunDirection);
  to.casterMin.copy(from.casterMin);
  to.casterMax.copy(from.casterMax);
}

/**
 * Captures the cloudscape and a caller-provided sky/background scene into a
 * fixed-position cube, then runs Three's PMREM filter on the linear HDR cube.
 *
 * The adapter owns a separate `createCloudscape()` instance and never renders
 * the caller's main scene. There is no per-frame update: settings and sky
 * changes become visible to reflections only after an explicit `refresh()`.
 */
export function createCloudscapeEnvironment(
  renderer: WebGPURenderer,
  source: Atlas,
  initialWorld: WorldSnapshot,
  options: CloudscapeEnvironmentOptions = {},
): CloudscapeEnvironmentCapture {
  const backend = sharedBackend(renderer);
  const cubeSize = positiveInteger(options.cubeSize ?? DEFAULT_CUBE_SIZE, 'Environment cubeSize');
  const near = finiteNumber(options.near ?? DEFAULT_NEAR, 'Environment near');
  const far = finiteNumber(options.far ?? DEFAULT_FAR, 'Environment far');
  if (near <= 0 || far <= near) throw new Error('Environment capture requires 0 < near < far.');

  const probePosition = options.probePosition instanceof Vector3
    ? options.probePosition.clone()
    : new Vector3(...(options.probePosition ?? DEFAULT_PROBE_POSITION.toArray() as [number, number, number]));
  if (!probePosition.toArray().every(Number.isFinite)) throw new Error('Environment probePosition must be finite.');

  const cloudscape = createCloudscape(renderer, source, initialWorld);
  cloudscape.settings.distanceFade = false;
  cloudscape.settings.geometryShadows = false;
  if (options.settingsSource) copyCloudSettings(cloudscape, options.settingsSource);
  const backgroundScene = options.backgroundScene === null
    ? new Scene()
    : options.backgroundScene ?? new Scene();
  const cubeTarget = new CubeRenderTarget(cubeSize, {
    format: RGBAFormat,
    type: HalfFloatType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
    colorSpace: LinearSRGBColorSpace,
    depthBuffer: false,
  });
  cubeTarget.texture.name = 'cloudscape-environment-cube-linear-hdr';
  cubeTarget.texture.colorSpace = LinearSRGBColorSpace;
  renderer.initRenderTarget(cubeTarget);

  const cubeCamera = new CubeCamera(near, far, cubeTarget);
  cubeCamera.coordinateSystem = WebGPUCoordinateSystem;
  cubeCamera.updateCoordinateSystem();
  for (const child of cubeCamera.children) {
    const camera = child as PerspectiveCamera;
    camera.coordinateSystem = WebGPUCoordinateSystem;
    camera.updateProjectionMatrix();
  }
  cubeCamera.position.copy(probePosition);
  cubeCamera.updateMatrixWorld(true);

  const pmrem = new PMREMGenerator(renderer);
  let pmremTarget: ReturnType<PMREMGenerator['fromCubemap']> | null = null;
  let environmentTexture: Texture | null = null;
  let disposed = false, refreshing = false;
  let dirty = true;
  const attached = new Map<Scene, { previous: Texture | null; current: Texture | null }>();

  const ensureAlive = () => {
    if (disposed) throw new Error('Cloudscape environment has been disposed.');
  };

  function syncSettings(sourceSettings: CloudscapeSettingsSource): void {
    ensureAlive();
    copyCloudSettings(cloudscape, sourceSettings);
    dirty = true;
  }

  function syncSunDirection(direction: Vector3 | readonly [number, number, number]): void {
    ensureAlive();
    const next = direction instanceof Vector3 ? direction : new Vector3(direction[0], direction[1], direction[2]);
    if (!next.toArray().every(Number.isFinite) || next.lengthSq() === 0) throw new Error('Environment sunDirection must be finite and non-zero.');
    cloudscape.settings.sunDirection.copy(next);
    dirty = true;
  }

  async function refresh(): Promise<Texture> {
    ensureAlive();
    if (refreshing) throw new Error('Cloudscape environment refresh is already running.');
    refreshing = true;
    const previousTarget = renderer.getRenderTarget();
    const previousMRT = renderer.getMRT();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();
    const previousXr = renderer.xr.enabled;
    const previousEnvironment = environmentTexture;
    try {
      renderer.xr.enabled = false;
      renderer.setMRT(null);
      cubeCamera.position.copy(probePosition);
      cubeCamera.updateMatrixWorld(true);
      cloudscape.resize(cubeSize, cubeSize);

      // CubeCamera's children contain six independent perspective cameras. We
      // invoke the cloud runtime separately for every face so capture has no
      // dependency on the main camera's view or history.
      for (let face = 0; face < 6; face += 1) {
        const camera = cubeCamera.children[face] as PerspectiveCamera;
        camera.updateMatrixWorld(true);
        options.onBeforeFace?.({ face, camera, scene: backgroundScene, position: probePosition });
        await cloudscape.compile(backgroundScene, camera);
        ensureAlive();
        cloudscape.render(backgroundScene, camera, false);
        // Both textures are Three-owned WebGPU resources. The WebGPU texture
        // manager creates them with COPY_SRC/COPY_DST usage, so this copies the
        // linear HDR cloud result into one cube array layer without a readback.
        backend.texture(cloudscape.output);
        backend.texture(cubeTarget.texture);
        renderer.copyTextureToTexture(cloudscape.output, cubeTarget.texture, null, new Vector3(0, 0, face));
      }

      // PMREM uses its own single-target passes; keeping MRT disabled avoids
      // inheriting an unrelated caller attachment layout.
      // Allocate a fresh filtered target on explicit refresh. Attached scenes
      // are updated below, and the previous target is released afterwards.
      const nextPmremTarget = pmrem.fromCubemap(cubeTarget.texture);
      const oldPmremTarget = pmremTarget;
      pmremTarget = nextPmremTarget;
      environmentTexture = nextPmremTarget.texture;
      dirty = false;
      for (const [scene, record] of attached) {
        const ownsCurrentEnvironment = scene.environment === previousEnvironment || scene.environment === record.current;
        if (ownsCurrentEnvironment) {
          scene.environment = environmentTexture;
          record.current = environmentTexture;
        }
      }
      oldPmremTarget?.dispose();
      return environmentTexture;
    } finally {
      refreshing = false;
      renderer.xr.enabled = previousXr;
      renderer.setMRT(previousMRT);
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
    }
  }

  function attach(scene: Scene): void {
    ensureAlive();
    if (!environmentTexture) throw new Error('Refresh the cloudscape environment before attaching it.');
    if (!attached.has(scene)) attached.set(scene, { previous: scene.environment, current: environmentTexture });
    else attached.get(scene)!.current = environmentTexture;
    scene.environment = environmentTexture;
  }

  function detach(scene: Scene): void {
    ensureAlive();
    const record = attached.get(scene);
    if (!record) return;
    if (scene.environment === record.current) scene.environment = record.previous;
    attached.delete(scene);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const [scene, record] of attached) {
      if (scene.environment === record.current) scene.environment = record.previous;
    }
    attached.clear();
    pmrem.dispose();
    pmremTarget?.dispose();
    cubeTarget.dispose();
    cloudscape.dispose();
  }

  return {
    cloudscape,
    cubeTexture: cubeTarget.texture,
    get environmentTexture() { return environmentTexture; },
    get needsRefresh() { return dirty; },
    probePosition,
    refresh,
    syncSettings,
    syncSunDirection,
    attach,
    detach,
    dispose,
  };
}
