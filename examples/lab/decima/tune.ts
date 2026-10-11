// Tuning panel for the Decima parity page (Tweakpane): every runtime setting and the shot's scene values as live controls, grouped by what they
// change: the shot (camera and framing, sun and sky, exposure and tone), then the renderer (shape and detail, ray march, sun light and shadows,
// inner glow, sky light, colour and phase, atmosphere, models, debug). Each control has an (i) with what it does, a reset to the shot's value, and
// an amber name when it differs from the shot. Modes are dropdowns. Presets save to this browser and export / import as JSON. T opens it.
import { Pane, type FolderApi } from 'tweakpane';
import type { BindingApi } from '@tweakpane/core';
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
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const settingsBlock = (() => { const b = runtimeSource.slice(runtimeSource.indexOf('export interface CloudSettings')); return b.slice(0, b.indexOf('\n}')); })();
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
for (const m of settingsBlock.matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/\s*(\w+)\??:/g)) docs[m[2]] = m[1].replace(/\n\s*\*\s?/g, ' ').trim();
// String settings list their choices from the CloudSettings type.
const unions: Record<string, string[]> = {};
for (const m of settingsBlock.matchAll(/^\s+(\w+)\??:\s*('[^']+'(?:\s*\|\s*'[^']+')+);/gm)) unions[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]);

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

const css = `
#tune{position:fixed;left:8px;top:96px;bottom:8px;width:400px;max-width:calc(100vw - 16px);display:none;overflow:auto;z-index:10;border-radius:6px}
#tune.open{display:block}
#tune .tp-dfwv{width:100% !important;--tp-blade-value-width:190px}
#tune .tp-lblv_l{display:flex;align-items:center;gap:4px;overflow:visible}
#tune .tp-lblv_l .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
#tune .changed > .tp-lblv_l .nm{color:#f0b85a}
#tune .ib,#tune .rb{flex:none;width:15px;height:15px;border-radius:50%;border:1px solid #6b7785;background:none;color:#9aa6b2;font:10px/13px ui-monospace,Menlo,monospace;text-align:center;padding:0;cursor:pointer}
#tune .ib:hover,#tune .rb:hover{color:#fff;border-color:#fff}
#tune .rb{border:none;font-size:12px;visibility:hidden}
#tune .changed .rb{visibility:visible}
#tune .doc{margin:2px 8px 6px;padding:6px 8px;border-radius:4px;background:#0006;color:#c9d2db;font:11.5px/1.45 system-ui,sans-serif}
#tune .about{margin:4px 8px 6px;color:#8d99a6;font:11px/1.4 system-ui,sans-serif}
#tune .presets{display:grid;gap:3px;margin:4px 6px 6px}
#tune .presets .p{display:flex;gap:4px;align-items:center;font:11px ui-monospace,Menlo,monospace;color:#c9d2db}
#tune .presets .p span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#tune .presets button{font:inherit;background:#2a3039;color:#fff;border:0;border-radius:3px;padding:1px 6px;cursor:pointer}
#tune .msg{margin:2px 8px;color:#8fb0dd;font:11px system-ui,sans-serif;min-height:1em}
`;

const rangeOf = (key: string, v: number): { min: number; max: number } | undefined => {
  if (/\b0\.\.1\b/.test(docs[key] ?? '') && v >= 0 && v <= 1) return { min: 0, max: 1 };
  if (v === 0) return undefined;   // no scale to guess from: a plain number field (drag or type), unclamped
  const hi = Math.abs(v) * 4;
  return { min: v < 0 ? -hi : 0, max: hi };
};
const stepOf = (v: number) => { const a = Math.abs(v); return a === 0 ? 0.001 : a >= 100 ? 1 : a >= 10 ? 0.1 : a >= 1 ? 0.01 : a >= 0.1 ? 0.001 : 0.0001; };

// A Tweakpane point value over a 3-array, held in { v } (Tweakpane binds an object's property); the array stays the source of truth.
const vec3Holder = (get: () => number[], set: (v: number[]) => void) => ({
  v: {
    get x() { return get()[0]; }, set x(n: number) { const v = [...get()]; v[0] = n; set(v); },
    get y() { return get()[1]; }, set y(n: number) { const v = [...get()]; v[1] = n; set(v); },
    get z() { return get()[2]; }, set z(n: number) { const v = [...get()]; v[2] = n; set(v); },
  },
});

interface Entry { key: string; api: BindingApi; value(): unknown; base(): unknown; reset(): void; docEl?: HTMLElement; folder?: FolderApi }

export function createTuner(host: TuneHost) {
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'tune'; document.body.appendChild(root);
  const pane = new Pane({ container: root, title: 'Tune (T)' });

  let base: Record<string, unknown> = {};
  let sceneBase: TuneScene | null = null;
  const scene = {} as TuneScene;            // a stable object: the bindings read it through getters
  let edits: Record<string, unknown> = {};  // settings changed by hand (carried across shots)
  const ui = { filter: '', changedOnly: false, carry: true, name: '' };
  const entries: Entry[] = [];
  const msgEl = document.createElement('div'); msgEl.className = 'msg';
  const say = (t: string) => { msgEl.textContent = t; setTimeout(() => { if (msgEl.textContent === t) msgEl.textContent = ''; }, 2500); };

  const mark = (e: Entry) => e.api.element.classList.toggle('changed', e.base() !== undefined && !same(e.value(), e.base()));
  const markAll = () => entries.forEach(mark);
  const applyFilter = () => {
    const q = ui.filter.trim().toLowerCase();
    for (const e of entries) {
      const text = `${e.key} ${docs[e.key] ?? SCENE_DOCS[e.key] ?? ''}`.toLowerCase();
      e.api.hidden = (!!q && !text.includes(q)) || (ui.changedOnly && !e.api.element.classList.contains('changed'));
      if (e.api.hidden && e.docEl) { e.docEl.remove(); e.docEl = undefined; }
    }
    // While filtering, open every group that has a match.
    if (q || ui.changedOnly) for (const e of entries) if (!e.api.hidden && e.folder) e.folder.expanded = true;
  };
  const refresh = () => { pane.refresh(); markAll(); applyFilter(); };

  // The (i) and reset buttons go into the control's label; the doc opens under the control.
  const decorate = (e: Entry, doc: string | undefined) => {
    const label = e.api.element.querySelector('.tp-lblv_l') as HTMLElement | null;
    if (!label) return;
    const name = document.createElement('span'); name.className = 'nm'; name.textContent = label.textContent ?? e.key; name.title = e.key;
    label.textContent = ''; label.append(name);
    if (doc) {
      const ib = document.createElement('button'); ib.className = 'ib'; ib.textContent = 'i'; ib.title = doc;
      ib.onclick = ev => {
        ev.stopPropagation();
        if (e.docEl) { e.docEl.remove(); e.docEl = undefined; return; }
        e.docEl = document.createElement('div'); e.docEl.className = 'doc'; e.docEl.textContent = `${e.key}: ${doc}`;
        e.api.element.insertAdjacentElement('afterend', e.docEl);
      };
      label.append(ib);
    }
    const rb = document.createElement('button'); rb.className = 'rb'; rb.textContent = '↺'; rb.title = 'back to the shot\'s value';
    rb.onclick = ev => { ev.stopPropagation(); e.reset(); };
    label.append(rb);
  };
  const about = (folder: FolderApi, text: string) => {
    const div = document.createElement('div'); div.className = 'about'; div.textContent = text;
    folder.element.querySelector('.tp-fldv_c')?.prepend(div);
  };

  // --- Presets and tools ---
  const tools = pane.addFolder({ title: 'Presets and tools', expanded: true });
  tools.addBinding(ui, 'filter', { label: 'filter' }).on('change', applyFilter);
  tools.addBinding(ui, 'changedOnly', { label: 'changed only' }).on('change', applyFilter);
  tools.addBinding(ui, 'carry', { label: 'keep changes across shots' });
  tools.addBinding(ui, 'name', { label: 'preset name' });
  const presetsEl = document.createElement('div'); presetsEl.className = 'presets';
  const loadStore = (): Record<string, Preset> => { try { return JSON.parse(localStorage.getItem(STORE) ?? '{}'); } catch { return {}; } };
  const saveStore = (s: Record<string, Preset>) => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { say('could not save to this browser'); } };
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
    host.onSettingChange('*'); refresh();
  };
  const renderPresets = () => {
    presetsEl.innerHTML = '';
    for (const [name, p] of Object.entries(loadStore()).sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt))) {
      const row = document.createElement('div'); row.className = 'p';
      const label = document.createElement('span'); label.textContent = `${name} · ${p.bookmark} · ${Object.keys(p.settings).length} changed`; label.title = p.savedAt;
      const load = document.createElement('button'); load.textContent = 'load'; load.onclick = () => { apply(p); say(`loaded ${name}`); };
      const del = document.createElement('button'); del.textContent = '×'; del.title = 'delete'; del.onclick = () => { const s = loadStore(); delete s[name]; saveStore(s); renderPresets(); };
      row.append(label, load, del); presetsEl.appendChild(row);
    }
  };
  tools.addButton({ title: 'save preset' }).on('click', () => {
    const name = ui.name.trim() || `${host.bookmark()} ${new Date().toLocaleTimeString()}`;
    const s = loadStore(); s[name] = snapshot(); saveStore(s); renderPresets(); say(`saved ${name}`);
  });
  tools.addButton({ title: 'export preset (JSON file)' }).on('click', () => {
    const name = ui.name.trim() || host.bookmark();
    const blob = new Blob([JSON.stringify({ ...snapshot(), note: name }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${name.replace(/[^\w.-]+/g, '_')}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'application/json'; file.hidden = true; root.appendChild(file);
  file.onchange = () => {
    const f = file.files?.[0]; if (!f) return;
    f.text().then(txt => {
      const data = JSON.parse(txt);
      const list: Record<string, Preset> = data.bookmark ? { [f.name.replace(/\.json$/, '')]: data } : data;
      const s = loadStore(); Object.assign(s, list); saveStore(s); renderPresets();
      const first = Object.values(list)[0]; if (first) apply(first);
      say(`imported ${Object.keys(list).length}`);
    }).catch(() => say('not a preset file')).finally(() => { file.value = ''; });
  };
  tools.addButton({ title: 'import preset (JSON file)' }).on('click', () => file.click());
  tools.addButton({ title: 'reset everything to the shot' }).on('click', () => {
    for (const [k, v] of Object.entries(base)) host.settings[k] = clone(v);
    edits = {};
    if (sceneBase) { Object.assign(scene, clone(sceneBase)); pushScene(); }
    host.onSettingChange('*'); refresh(); say('back to the shot');
  });
  tools.element.querySelector('.tp-fldv_c')!.append(msgEl, presetsEl);

  // --- The shot: camera and framing, sun and sky, exposure and tone ---
  const sceneBaseOf = (key: string) => sceneBase ? (sceneBase as unknown as Record<string, unknown>)[key] : undefined;
  const sceneNum = (folder: FolderApi, key: keyof TuneScene, opts: Record<string, unknown>) => {
    const api = folder.addBinding(scene as unknown as Record<string, unknown>, key, { label: key, ...opts });
    const e: Entry = {
      key, api, value: () => scene[key], base: () => sceneBaseOf(key),
      reset: () => { if (!sceneBase) return; (scene as unknown as Record<string, unknown>)[key] = clone(sceneBaseOf(key)); pushScene(); refresh(); },
    };
    api.on('change', () => { pushScene(); mark(e); });
    e.folder = folder; decorate(e, SCENE_DOCS[key]); entries.push(e);
  };
  const sceneVec = (folder: FolderApi, key: Vec3Key, step: number) => {
    const holder = vec3Holder(() => scene[key], v => { scene[key] = v as TuneScene[Vec3Key]; pushScene(); });
    const api = folder.addBinding(holder, 'v', { label: key, x: { step }, y: { step }, z: { step } });
    const e: Entry = {
      key, api, value: () => scene[key], base: () => sceneBaseOf(key),
      reset: () => { if (!sceneBase) return; scene[key] = clone(sceneBase[key]); pushScene(); refresh(); },
    };
    api.on('change', () => mark(e));
    e.folder = folder; decorate(e, SCENE_DOCS[key]); entries.push(e);
  };

  // Built on the first sync: Tweakpane picks each control from the value it finds.
  const buildScene = () => {
    const cam = pane.addFolder({ title: 'Shot: camera and framing', expanded: false });
    about(cam, 'Where the camera is and what it sees. Guerrilla published no cameras; these were fitted from the cloud\'s outline. Line them up with the compare view in overlay mode.');
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
      const e: Entry = {
        key: 'vfovKeepSize', api, value: () => scene.vfov, base: () => sceneBase?.vfov,
        reset: () => { if (!sceneBase) return; scene.vfov = sceneBase.vfov; scene.camEye = clone(sceneBase.camEye); pushScene(); refresh(); },
      };
      api.on('change', () => refresh());
      e.folder = cam; decorate(e, SCENE_DOCS.vfovKeepSize); entries.push(e);
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

    const sun = pane.addFolder({ title: 'Shot: sun and sky', expanded: false });
    about(sun, 'The light the shot is lit by: where the sun is, its colour, and the sky around the cloud.');
    sceneNum(sun, 'sunElevation', { min: -10, max: 90, step: 0.1 });
    sceneNum(sun, 'sunAzimuth', { min: 0, max: 360, step: 0.5 });
    sceneVec(sun, 'sunColor', 0.01);
    sceneVec(sun, 'sunTint', 0.01);
    sceneNum(sun, 'turbidity', { min: 1, max: 20, step: 0.1 });
    sceneNum(sun, 'miePhaseG', { min: 0, max: 0.99, step: 0.01 });
    sceneVec(sun, 'skyFactor', 0.01);
    sceneVec(sun, 'ambientTint', 0.01);

    const post = pane.addFolder({ title: 'Shot: exposure and tone', expanded: false });
    about(post, 'How the rendered light becomes the image: exposure, the tone curve and the output dither.');
    sceneNum(post, 'exposure', { min: 0, max: 1, step: 0.001 });
    sceneNum(post, 'postMode', { options: { 'ACES filmic': 0, 'linear': 1, 'fitted to Decima': 2 } });
    sceneNum(post, 'dither', { options: { off: 0, on: 1 } });
  };

  // --- The renderer's settings, grouped ---
  const settingEntry = (folder: FolderApi, key: string) => {
    const v = host.settings[key];
    const changed = () => { const x = host.settings[key]; if (same(x, base[key])) delete edits[key]; else edits[key] = clone(x); host.onSettingChange(key); };
    let api: BindingApi;
    if (Array.isArray(v)) {
      api = folder.addBinding(vec3Holder(() => host.settings[key] as number[], nv => { host.settings[key] = nv; changed(); }), 'v', { label: key });
    } else if (typeof v === 'string') {
      const opts = unions[key];
      api = folder.addBinding(host.settings, key, opts ? { label: key, options: Object.fromEntries(opts.map(o => [o, o])) } : { label: key });
      api.on('change', changed);
    } else if (typeof v === 'boolean') {
      api = folder.addBinding(host.settings, key, { label: key }); api.on('change', changed);
    } else if (typeof v === 'number') {
      const b = (base[key] as number) ?? v;
      const opts = MODES[key] ?? (SWITCHES.has(key) ? { off: 0, on: 1 } : undefined);
      api = folder.addBinding(host.settings, key, opts ? { label: key, options: opts } : { label: key, ...(rangeOf(key, b) ?? {}), step: stepOf(b) });
      api.on('change', changed);
    } else return;
    const e: Entry = {
      key, api, value: () => host.settings[key], base: () => base[key],
      reset: () => { host.settings[key] = clone(base[key]); delete edits[key]; host.onSettingChange(key); refresh(); },
    };
    api.on('change', () => mark(e));
    e.folder = folder; decorate(e, docs[key]); entries.push(e);
  };
  let built = false;
  const buildSettings = () => {
    const listed = new Set(GROUPS.flatMap(g => g.keys));
    for (const g of GROUPS) {
      const keys = g.keys.filter(k => k in host.settings);
      if (!keys.length) continue;
      const f = pane.addFolder({ title: g.title, expanded: false });
      about(f, g.about);
      for (const k of keys) settingEntry(f, k);
    }
    const rest = Object.keys(host.settings).filter(k => !listed.has(k) && !SKIP.has(k)).sort();
    if (rest.length) { const f = pane.addFolder({ title: 'Other', expanded: false }); for (const k of rest) settingEntry(f, k); }
    built = true;
  };

  const toggle = (open = !root.classList.contains('open')) => { root.classList.toggle('open', open); };
  addEventListener('keydown', e => { if (e.key === 't' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement)) toggle(); });
  renderPresets();

  return {
    toggle,
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
