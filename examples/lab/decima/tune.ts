// Tuning panel for the Decima parity page (Tweakpane): every runtime setting and the shot's scene values as live controls, grouped by what they
// change: the shot (camera and framing, sun and sky, exposure and tone), then the renderer (shape and detail, ray march, sun light and shadows,
// inner glow, sky light, colour and phase, atmosphere, models, debug). Each control has an (i) with what it does, a reset to the shot's value, and
// an amber name when it differs from the shot. Modes are dropdowns. Presets save to this browser and export / import as JSON. T opens it.
// The panel itself (decoration, filter, presets, the control picker) is the shared one in ../tune/panel.ts.
import type { FolderApi } from 'tweakpane';
import { clone, createTunePanel, interfaceBlock, parseDocs, parseUnions, same, vecHolder, type TuneEntry } from '../tune/panel';
import runtimeSource from '../../../packages/runtime/src/runtime.ts?raw';

export interface TuneScene {
  /** The shot camera, relative to the cloud base as in refs.ts (y up, metres), its vertical field of view and roll in degrees. */
  camEye: [number, number, number]; camTarget: [number, number, number]; vfov: number; roll: number;
  /** Framing: the width and height of the view as multiples of the fitted ones (anamorphic, 1 = as fitted), and a lens shift in frame widths / heights. */
  frameWidth: number; frameHeight: number; shiftX: number; shiftY: number;
  sunElevation: number; sunAzimuth: number; exposure: number; turbidity: number; miePhaseG: number;
  sunColor: [number, number, number]; sunTint: [number, number, number]; ambientTint: [number, number, number]; skyFactor: [number, number, number];
  postMode: number; dither: number;
}

export interface TuneHost {
  settings: Record<string, unknown>;
  /** Called after a setting changes (the page resets the temporal history so the change shows at once). */
  onSettingChange(key: string): void;
  /** Applies the scene values to the camera, the sky, the bridge and the post chain. */
  applyScene(scene: TuneScene): void;
  bookmark(): string;
  look(): string;
  loadBookmark(name: string): void;
  /** The camera as it is now (after orbiting), in the same base-relative coordinates. */
  readCamera(): { eye: [number, number, number]; target: [number, number, number]; vfov: number };
}

interface Preset { bookmark: string; look: string; scene: TuneScene; settings: Record<string, unknown>; savedAt: string; note?: string }
type Vec3Key = 'camEye' | 'camTarget' | 'sunColor' | 'sunTint' | 'ambientTint' | 'skyFactor';

const STORE = 'decima-tune-presets';
const SKIP = new Set(['lightning']);

const settingsBlock = interfaceBlock(runtimeSource, 'export interface CloudSettings');
// What each setting does: its doc comment in CloudSettings, or a line here for the few without one.
const docs: Record<string, string> = {
  silverG: 'Anisotropy of the forward (silver lining) lobe of the phase function.',
  mipDistanceScale: 'How fast the noise switches to blurrier mips with distance (the noise MIP constant; smaller keeps detail further out).',
  baseMip: 'Mip level the noise starts from at the camera.',
  maxSteps: 'Most march steps per ray.',
  hazeHeight: 'Scale height (m) of the horizon haze.',
  windVelocity: 'Wind velocity (m/s) the up-rez noise scrolls at (the parity stills stop it with animSpeed 0).',
  animSpeed: 'Multiplier on time for the noise scroll (0 = frozen, as the parity stills are).',
  microShadow2: 'Weight of the second micro sun tap (from microDist to microDist2) on the glow terms.',
  bodySunKnee: 'Sun elevation (as sin) over which the low-sun handoff fades the sun out of the body terms.',
  temporalFar: 'Pixels traced per frame in the far march = 1/k, k in {1, 2, 4}.',
};
for (const [k, d] of Object.entries(parseDocs(settingsBlock))) docs[k] = d;
// String settings list their choices from the CloudSettings type.
const unions = parseUnions(settingsBlock);

// Numeric settings that are really modes or on/off switches.
const MODES: Record<string, Record<string, number>> = {
  lightDebug: { 'normal': 0, 'direct sun only': 1, 'inner glow (ms) only': 2, 'deep octaves only': 3, 'sky ambient only': 4, 'environment body only': 5, 'all, no aerial perspective': 6 },
  ambientLaw: { 'diffuse 1 / (1 + τ)': 0, 'deck exp(−τ)': 1 },
  glowDepthMode: { 'along the view ray': 0, 'max of sample and deeper': 1, 'inward along the SDF': 2 },
  microShadowMode: { 'whole optical depth': 0, 'up-rez excess': 1 },
  noiseInvert: { 'as shipped': 0, 'billowy inverted': 1, 'wispy inverted': 2, 'both inverted': 3 },
  profileFilter: { 'trilinear': 0, 'tricubic profile': 1, 'tricubic SDF': 2, 'tricubic both': 3 },
  temporalNear: { 'every frame': 1, '1 in 2': 2, '1 in 4': 4 },
  temporalFar: { 'every frame': 1, '1 in 2': 2, '1 in 4': 4 },
};
const SWITCHES = new Set(['compositeShadow', 'jitterStatic', 'inlineProfile', 'temporalAccumulate', 'jitterNoise', 'stepJitter', 'lightGridFilter', 'windCompensate', 'historyFilter', 'historyDither']);

// The renderer's settings by what they change, in pipeline order. Anything not listed lands in "Other".
const GROUPS: { title: string; about: string; keys: string[] }[] = [
  { title: 'Shape and detail', about: 'How the cloud\'s density is built: how thick it is, and how the noise carves the coarse shape into detail (the up-rez).',
    keys: ['densityScale', 'detailBias', 'wispyBias', 'typeFromScale', 'detailTypeOverride', 'noiseScale', 'noiseInvert', 'fineErosion', 'detailDistance', 'mipDistanceScale', 'baseMip'] },
  { title: 'Ray march', about: 'How each pixel\'s ray steps through the cloud: step size and limits, jitter, and the temporal blend that cleans the noise up over frames.',
    keys: ['stepScale', 'maxSteps', 'transmittanceCutoff', 'splitDistance', 'farLimit', 'fineDistance', 'renderScale', 'jitterNoise', 'jitterStatic', 'stepJitter', 'temporalNear', 'temporalFar', 'temporalBlend', 'temporalAccumulate', 'historyFilter', 'historyDither', 'windCompensate', 'animSpeed', 'windVelocity', 'windOffset'] },
  { title: 'Sun light and shadows', about: 'How much sunlight reaches each point: the coarse light grid, the short shadow samples near the surface (they shade the cauliflower bumps), and the direct term.',
    keys: ['lightDensityScale', 'lightGridFilter', 'inlineLightScale', 'inlineProfile', 'inlineReuse', 'lightMipBias', 'microDist', 'microShadow', 'microLightScale', 'microShadowMode', 'microDist2', 'microShadow2', 'directProfile', 'directRimDepth', 'edgeDarkening', 'shadowStrength', 'compositeShadow'] },
  { title: 'Inner glow (multiple scattering)', about: 'Light bouncing around inside the cloud: what lifts the shadow sides and makes thick parts glow.',
    keys: ['msStrength', 'glowBoost', 'glowFront', 'glowDepth', 'glowDepthMode', 'inScatterProfile', 'profileFilter', 'deepScatter', 'deepAttenuation', 'diffuseSun', 'diffuseFalloff', 'bodySunFloor', 'bodySunKnee', 'bodyEnv', 'bodyDepth'] },
  { title: 'Sky light (ambient)', about: 'Light from the sky dome and the ground below: how bright and how flat the shade and the underside are.',
    keys: ['ambientStrength', 'ambientExtinction', 'ambientLaw', 'ambientFloor', 'ambientSkyBias', 'ambientTap', 'ambientBelowMirror', 'ambientLowSun', 'envSunWeight', 'groundAlbedo'] },
  { title: 'Colour and phase', about: 'How light scatters by direction (the phase function: silver linings, the glow toward the sun) and the colour of the sky light the cloud sees.',
    keys: ['phaseModel', 'phaseG', 'silverG', 'silverStrength', 'dropletDiameter', 'ambientSaturation', 'ambientWarmth'] },
  { title: 'Atmosphere', about: 'The haze between the camera and the cloud.', keys: ['hazeDensity', 'hazeBase', 'hazeHeight'] },
  { title: 'Models and imported volumes', about: 'Which density and lighting model runs, and the settings for imported VDBs rendered directly.',
    keys: ['densityModel', 'lightingModel', 'directDensity', 'directInScatterFlat'] },
  { title: 'Debug', about: 'Show one lighting term at a time.', keys: ['lightDebug'] },
];

const SCENE_DOCS: Record<string, string> = {
  camEye: 'Where the camera stands (x, y, z metres; y is height above the cloud base). Fitted from the silhouette: Guerrilla never published the cameras.',
  camTarget: 'The point the camera looks at (x, y, z metres; y from the cloud base). Move it to pan or tilt.',
  vfov: 'Vertical field of view in degrees (smaller zooms in).',
  vfovKeepSize: 'Dolly zoom: changes the field of view and moves the camera so the cloud keeps its size. A silhouette fit cannot tell distance from field of view, so this tests perspective.',
  roll: 'Camera roll in degrees about the view axis.',
  frameWidth: 'How much the view shows horizontally, as a multiple of the fitted view (1 = as fitted; above 1 the cloud gets narrower). Horizontal field of view only.',
  frameHeight: 'How much the view shows vertically, as a multiple of the fitted view. Vertical field of view only.',
  shiftX: 'Lens shift in frame widths (+ moves the picture right): off-centre framing, as if the frame had been cropped off-centre.',
  shiftY: 'Lens shift in frame heights (+ moves the picture up).',
  sunElevation: 'Sun elevation in degrees above the horizon.',
  sunAzimuth: 'Sun azimuth in degrees (the sky convention, north = -Z).',
  sunColor: 'Sun colour for the sky and the clouds (linear; x, y, z = r, g, b).',
  sunTint: 'Extra tint of the sun the clouds see; the sky is untouched (the round-12 pink). x, y, z = r, g, b.',
  turbidity: 'Haze amount of the physical sky.',
  miePhaseG: 'Forward scattering of the haze: the size of the glow around the sun.',
  skyFactor: 'Per-channel sky brightness (the sky and the clouds\' ambient). x, y, z = r, g, b.',
  ambientTint: 'Tint of the sky light the clouds see; the sky is untouched. x, y, z = r, g, b.',
  exposure: 'Exposure before the tone curve.',
  postMode: 'Tone curve: ACES filmic, linear, or the curve fitted to Decima\'s frames.',
  dither: 'Output dither before 8-bit (hides banding).',
};

export function createTuner(host: TuneHost) {
  let base: Record<string, unknown> = {};
  let sceneBase: TuneScene | null = null;
  const scene = {} as TuneScene;            // a stable object: the bindings read it through getters
  let edits: Record<string, unknown> = {};  // settings changed by hand (carried across shots)

  const snapshot = (): Preset => {
    const diff: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(host.settings)) {
      if (SKIP.has(k) || (typeof v === 'object' && !Array.isArray(v))) continue;
      if (!same(v, base[k])) diff[k] = clone(v);
    }
    return { bookmark: host.bookmark(), look: host.look(), scene: clone(scene), settings: diff, savedAt: new Date().toISOString() };
  };
  const pushScene = () => host.applyScene(scene);
  const apply = (p: Preset) => {
    edits = clone(p.settings);
    if (p.bookmark && p.bookmark !== host.bookmark()) host.loadBookmark(p.bookmark);
    else for (const [k, v] of Object.entries(base)) host.settings[k] = clone(v);
    for (const [k, v] of Object.entries(p.settings)) if (k in host.settings) host.settings[k] = clone(v);
    if (p.scene) { Object.assign(scene, clone(p.scene)); pushScene(); }
    host.onSettingChange('*'); panel.refresh();
  };
  const panel = createTunePanel<Preset>({
    title: 'Tune (T)', storeKey: STORE, carryLabel: 'keep changes across shots',
    resetTip: 'back to the shot\'s value', resetAllTitle: 'reset everything to the shot',
    snapshot, apply,
    resetAll: () => {
      for (const [k, v] of Object.entries(base)) host.settings[k] = clone(v);
      edits = {};
      if (sceneBase) { Object.assign(scene, clone(sceneBase)); pushScene(); }
      host.onSettingChange('*'); panel.refresh(); panel.say('back to the shot');
    },
    defaultName: () => `${host.bookmark()} ${new Date().toLocaleTimeString()}`,
    exportName: () => host.bookmark(),
    presetLabel: (name, p) => `${name} · ${p.bookmark} · ${Object.keys(p.settings).length} changed`,
    isPreset: data => !!(data as Preset).bookmark,
  });
  const { pane, ui, say, refresh } = panel;

  // --- The shot: camera and framing, sun and sky, exposure and tone ---
  const sceneBaseOf = (key: string) => sceneBase ? (sceneBase as unknown as Record<string, unknown>)[key] : undefined;
  const sceneNum = (folder: FolderApi, key: keyof TuneScene, opts: Record<string, unknown>) => {
    const api = folder.addBinding(scene as unknown as Record<string, unknown>, key, { label: key, ...opts });
    api.on('change', pushScene);
    panel.add(folder, {
      key, api, doc: SCENE_DOCS[key], value: () => scene[key], base: () => sceneBaseOf(key),
      reset: () => { if (!sceneBase) return; (scene as unknown as Record<string, unknown>)[key] = clone(sceneBaseOf(key)); pushScene(); refresh(); },
    });
  };
  const sceneVec = (folder: FolderApi, key: Vec3Key, step: number) => {
    const holder = vecHolder(() => scene[key], v => { scene[key] = v as TuneScene[Vec3Key]; pushScene(); });
    const api = folder.addBinding(holder, 'v', { label: key, x: { step }, y: { step }, z: { step } });
    panel.add(folder, {
      key, api, doc: SCENE_DOCS[key], value: () => scene[key], base: () => sceneBaseOf(key),
      reset: () => { if (!sceneBase) return; scene[key] = clone(sceneBase[key]); pushScene(); refresh(); },
    });
  };

  // Built on the first sync: Tweakpane picks each control from the value it finds.
  const buildScene = () => {
    const cam = panel.addGroup('Shot: camera and framing', 'Where the camera is and what it sees. Guerrilla published no cameras; these were fitted from the cloud\'s outline. Line them up with the compare view in overlay mode.');
    sceneVec(cam, 'camEye', 1);
    sceneVec(cam, 'camTarget', 1);
    sceneNum(cam, 'vfov', { min: 5, max: 90, step: 0.01 });
    {
      // Dolly zoom: the field of view changes and the eye moves along the view line so the target keeps its size.
      const dollyObj = {
        get vfovKeepSize() { return scene.vfov; },
        set vfovKeepSize(x: number) {
          const k = Math.tan((scene.vfov * Math.PI) / 360) / Math.tan((x * Math.PI) / 360);
          scene.camEye = scene.camTarget.map((t, i) => t + (scene.camEye[i] - t) * k) as TuneScene['camEye']; scene.vfov = x; pushScene();
        },
      };
      const api = cam.addBinding(dollyObj, 'vfovKeepSize', { label: 'vfovKeepSize', min: 5, max: 90, step: 0.01 });
      api.on('change', () => refresh());
      panel.add(cam, {
        key: 'vfovKeepSize', api, doc: SCENE_DOCS.vfovKeepSize, value: () => scene.vfov, base: () => sceneBase?.vfov,
        reset: () => { if (!sceneBase) return; scene.vfov = sceneBase.vfov; scene.camEye = clone(sceneBase.camEye); pushScene(); refresh(); },
      });
    }
    sceneNum(cam, 'roll', { min: -45, max: 45, step: 0.1 });
    sceneNum(cam, 'frameWidth', { min: 0.5, max: 2, step: 0.001 });
    sceneNum(cam, 'frameHeight', { min: 0.5, max: 2, step: 0.001 });
    sceneNum(cam, 'shiftX', { min: -0.5, max: 0.5, step: 0.001 });
    sceneNum(cam, 'shiftY', { min: -0.5, max: 0.5, step: 0.001 });
    cam.addButton({ title: 'use the current view as the camera' }).on('click', () => {
      const c = host.readCamera(); scene.camEye = c.eye; scene.camTarget = c.target; scene.vfov = c.vfov; pushScene(); refresh(); say('camera taken from the view');
    });
    cam.addButton({ title: 'copy camera for refs.ts' }).on('click', () => {
      const r = (v: number) => Math.round(v * 10) / 10;
      const extra = (scene.frameWidth !== 1 || scene.frameHeight !== 1 || scene.shiftX || scene.shiftY || scene.roll) ? ` /* framing: frameWidth ${scene.frameWidth}, frameHeight ${scene.frameHeight}, shiftX ${scene.shiftX}, shiftY ${scene.shiftY}, roll ${scene.roll} */` : '';
      const text = `${host.bookmark()}: eye: [${scene.camEye.map(r).join(', ')}], target: [${scene.camTarget.map(r).join(', ')}], vfov: ${Math.round(scene.vfov * 100) / 100},${extra}`;
      navigator.clipboard.writeText(text).then(() => say('camera copied')).catch(() => { console.log(text); say('copy failed: the line is in the console'); });
    });

    const sun = panel.addGroup('Shot: sun and sky', 'The light the shot is lit by: where the sun is, its colour, and the sky around the cloud.');
    sceneNum(sun, 'sunElevation', { min: -10, max: 90, step: 0.1 });
    sceneNum(sun, 'sunAzimuth', { min: 0, max: 360, step: 0.5 });
    sceneVec(sun, 'sunColor', 0.01);
    sceneVec(sun, 'sunTint', 0.01);
    sceneNum(sun, 'turbidity', { min: 1, max: 20, step: 0.1 });
    sceneNum(sun, 'miePhaseG', { min: 0, max: 0.99, step: 0.01 });
    sceneVec(sun, 'skyFactor', 0.01);
    sceneVec(sun, 'ambientTint', 0.01);

    const post = panel.addGroup('Shot: exposure and tone', 'How the rendered light becomes the image: exposure, the tone curve and the output dither.');
    sceneNum(post, 'exposure', { min: 0, max: 1, step: 0.001 });
    sceneNum(post, 'postMode', { options: { 'ACES filmic': 0, 'linear': 1, 'fitted to Decima': 2 } });
    sceneNum(post, 'dither', { options: { off: 0, on: 1 } });
  };

  // --- The renderer's settings, grouped ---
  const settingEntry = (folder: FolderApi, key: string): TuneEntry | undefined => panel.bindSetting(folder, host.settings, key, {
    base: () => base[key], doc: docs[key], union: unions[key], mode: MODES[key], switch: SWITCHES.has(key),
    onChange: () => { const x = host.settings[key]; if (same(x, base[key])) delete edits[key]; else edits[key] = clone(x); host.onSettingChange(key); },
  });
  let built = false;
  const buildSettings = () => {
    const listed = new Set(GROUPS.flatMap(g => g.keys));
    for (const g of GROUPS) {
      const keys = g.keys.filter(k => k in host.settings);
      if (!keys.length) continue;
      const f = panel.addGroup(g.title, g.about);
      for (const k of keys) settingEntry(f, k);
    }
    const rest = Object.keys(host.settings).filter(k => !listed.has(k) && !SKIP.has(k)).sort();
    if (rest.length) { const f = pane.addFolder({ title: 'Other', expanded: false }); for (const k of rest) settingEntry(f, k); }
    built = true;
  };

  return {
    toggle: panel.toggle,
    /** Called by the page after each bookmark: the new starting point for "changed" and reset. */
    sync(sceneNow: TuneScene) {
      const carried = ui.carry ? edits : {};
      base = clone(Object.fromEntries(Object.entries(host.settings).filter(([k]) => !SKIP.has(k))));
      sceneBase = clone(sceneNow); Object.assign(scene, clone(sceneNow));
      if (!built) { buildScene(); buildSettings(); }
      for (const [k, v] of Object.entries(carried)) if (k in host.settings) host.settings[k] = clone(v);
      if (Object.keys(carried).length) host.onSettingChange('*');
      refresh();
    },
    /** The current state as a preset, for scripts and captures (window.__tune.snapshot()). */
    snapshot,
    apply,
  };
}
