// D0 Decima parity page: one pack cloud (Parkouring or Stormbird) under the camera, sun and lens reconstructed for each of Guerrilla's
// own frames of it (refs.ts), rendered with the D1 parity settings ('decima' look, default), the deck's settings (?look=deck) or our art
// defaults (?look=art). Flagship shell (three WebGPURenderer + @pmndrs/sky, the window.__clouds contract); no ground, as the deck frames show only sky.
//   ?cloud=parkouring|stormbird   ?bookmark=<ref>   ?look=decima|deck|art   ?quality=ultra   ?exposure=0.35
//   bookmark variants (D1): @sun:el:az  @turb:t  @exp:e  @skyf:r:g:b  @sunc:r:g:b  @mieg:g  @atm:mieHeightKm:multiScatter:rayleighMul  @ramp:0|1|2[:ambientWeight]  @skytint:0|1  @ambtint:r:g:b  @suntint:r:g:b  @wind:x:y:z  @matte  @look:x  @s.<setting>:v  @post:aces|none|fit  @dither:0|1
//   R or the "compare" button: Guerrilla's frame for the shot next to ours (wipe, overlay, or the frame alone; hold F to flip to it), letterboxed to
//   the frames' 16:9. The frames come from the local research folder through the dev server (refs-plugin.ts), never from the repo.
//   T or the "tune" button: every runtime setting and the scene values as live dials, with presets (tune.ts)
//   ?matte=1 (opacity only)   ?cam=ex,ey,ez,tx,ty,tz,vfov (relative to the cloud base, overrides the bookmark)   ?sun=elevation,azimuth   ?s.<setting>=<value>
import { LinearSRGBColorSpace, NoToneMapping, PerspectiveCamera, Scene } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { EARTH, Sky, resolveLook } from '@pmndrs/sky';
import { cloudLookSettings, createCloudRuntime, GpuTimer, loadCloudNoise, loadCloudVolume, type CloudFrame, type CloudLook, type CloudQuality } from '@clouds/runtime';
import { sharedBackend } from '../../../packages/legacy/three/src/gpu/backend';
import { installCloudsHarness } from '../harness/clouds-contract';
import { CLOUD_BASE_HEIGHT, placeCloud } from '../flagship/bookmarks';
import { createCloudBridge } from './bridge';
import { CameraRig } from '../flagship/controls';
import { createSkyBridge } from '../flagship/sky-bridge';
import { DECIMA_REFS, DECIMA_REF_NAMES, type DecimaRef } from './refs';
import { createTuner, type TuneScene } from './tune';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const QUALITIES = ['mobile', 'low', 'medium', 'high', 'ultra'] as const;
const quality = (QUALITIES.includes(query.get('quality') as never) ? query.get('quality') : 'ultra') as CloudQuality;
const LOOKS: CloudLook[] = ['decima', 'deck', 'art'];
const asLook = (v: string | null | undefined, fallback: CloudLook): CloudLook => (LOOKS.includes(v as CloudLook) ? (v as CloudLook) : fallback);
const pageLook: CloudLook = asLook(query.get('look'), 'decima');
let look: CloudLook = pageLook;
const firstRef = DECIMA_REFS[query.get('bookmark') ?? ''] ?? Object.values(DECIMA_REFS).find(r => r.cloud === query.get('cloud')) ?? DECIMA_REFS[DECIMA_REF_NAMES[0]];
const cloudName = (query.get('cloud') === 'stormbird' || query.get('cloud') === 'parkouring') ? query.get('cloud')! : firstRef.cloud;
const nums = (key: string) => (query.get(key) ?? '').split(',').filter(Boolean).map(Number);

try {
  const app = document.getElementById('app')!;
  const renderer = new WebGPURenderer({ antialias: true, trackTimestamp: true });
  // D1 round 5: the bridge's present pass does the tone mapping, sRGB encoding and dither itself (bridge.post); three only passes the values through.
  renderer.toneMapping = NoToneMapping;
  renderer.outputColorSpace = LinearSRGBColorSpace;
  const baseExposure = query.has('exposure') ? Number(query.get('exposure')) : 0.35;
  app.appendChild(renderer.domElement);
  await renderer.init();
  const { device } = sharedBackend(renderer);
  const timer = new GpuTimer(device);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 1, 1500000);
  const rig = new CameraRig(camera, renderer.domElement);
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 12, latitude: 40, north: '-Z' });
  sky.attach(scene);
  const sun = sky.createSun({ physical: true });
  sun.attach(scene);
  await sky.compileAsync();
  const skyBridge = createSkyBridge(renderer, sky);
  // D1 round 7/8: ?passScale=1.3334 renders the ultra far pass at the output resolution (the 0.75-scale upsample serrates opaque silhouettes, 7 vs 5 percent
  // of the s181 crust's edge columns jumping 2 px; the full-resolution pass adds 18 percent 1-3 px grain, the judges' stipple fringe). Default: the tier's scales.
  const runtime = createCloudRuntime(device, { quality, atmosphereLayout: skyBridge.layout, passScale: query.has('passScale') ? Number(query.get('passScale')) : 1 });
  const matte = query.get('matte') === '1';   // ?matte=1: present the cloud opacity (no tone mapping) for the parity masks
  const bridge = createCloudBridge(renderer, runtime, { matte });
  const POST_MODES: Record<string, 0 | 1 | 2> = { aces: 0, none: 1, fit: 2 };
  const [volumeAsset, noiseAsset] = await Promise.all([loadCloudVolume(`/clouds/${cloudName}/`), loadCloudNoise('/clouds/noise/')]);
  await runtime.setVolume(volumeAsset, { position: placeCloud(volumeAsset, CLOUD_BASE_HEIGHT) });
  await runtime.setNoise(noiseAsset);
  // D1: every bookmark starts from the runtime's own defaults, so a variant that is not a look knob (lightDebug, mipDistanceScale, temporal*,
  // inlineLightScale...) cannot leak from one shot into the next of a capture run.
  const baseSettings = JSON.parse(JSON.stringify({ ...runtime.settings, lightning: undefined }));
  const applyLook = () => {
    for (const [k, val] of Object.entries(baseSettings)) if (val !== undefined && k !== 'lightning') (runtime.settings as unknown as Record<string, unknown>)[k] = Array.isArray(val) ? [...val] : val;
    Object.assign(runtime.settings, cloudLookSettings(look, quality));
    for (const [key, value] of query) if (key.startsWith('s.') && key.slice(2) in runtime.settings) (runtime.settings as unknown as Record<string, number | string>)[key.slice(2)] = Number.isNaN(Number(value)) ? value : Number(value);
  };
  applyLook();

  // Compare view: the reference frame over the render. Off, wipe (frame left of the divider), overlay (frame at the slider's opacity), frame only.
  const COMPARE = ['off', 'wipe', 'overlay', 'frame'] as const;
  let compare: (typeof COMPARE)[number] = (COMPARE as readonly string[]).includes(query.get('compare') ?? '') ? query.get('compare') as (typeof COMPARE)[number] : 'off';
  let compareAmount = 0.5;
  let flip = false;
  const refImg = document.createElement('img'); refImg.id = 'refimg'; refImg.alt = ''; document.body.appendChild(refImg);
  const divider = document.createElement('div'); divider.id = 'divider'; document.body.appendChild(divider);
  const rect = () => {
    if (compare === 'off') return { x: 0, y: 0, w: innerWidth, h: innerHeight };
    const w = Math.min(innerWidth, Math.round(innerHeight * 16 / 9)), h = Math.round(w * 9 / 16);
    return { x: Math.round((innerWidth - w) / 2), y: Math.round((innerHeight - h) / 2), w, h };
  };
  const layoutCompare = () => {
    const r = rect();
    for (const el of [app, refImg]) Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    const mode = flip ? 'frame' : compare;
    refImg.style.display = mode === 'off' ? 'none' : 'block';
    refImg.style.opacity = mode === 'overlay' ? String(compareAmount) : '1';
    refImg.style.clipPath = mode === 'wipe' ? `inset(0 ${((1 - compareAmount) * 100).toFixed(2)}% 0 0)` : 'none';
    divider.style.display = mode === 'wipe' || mode === 'overlay' ? 'block' : 'none';
    divider.classList.toggle('overlay', mode === 'overlay');
    divider.title = mode === 'overlay' ? `drag: frame opacity ${(compareAmount * 100).toFixed(0)}%` : 'drag: wipe position';
    Object.assign(divider.style, { left: `${r.x + r.w * compareAmount - 11}px`, top: `${r.y}px`, height: `${r.h}px` });
  };
  const resize = () => {
    const r = rect();
    renderer.setPixelRatio(1);
    renderer.setSize(r.w, r.h, false);
    bridge.resize(r.w, r.h);
    camera.aspect = r.w / r.h;
    camera.updateProjectionMatrix();
    layoutCompare();
  };
  addEventListener('resize', resize);
  resize();

  let current = '';
  let turbidityNow = 1;
  let skyFactorNow = '1,1,1';
  let sunColorNow = '1,1,1';
  let miePhaseNow = 0.8;
  let atmNow = '1.2,1,1';
  let rampNow = '';
  let mirrorNow = false;
  let tuner: ReturnType<typeof createTuner> | null = null;
  let frameEye: [number, number, number] = [0, 0, 0], frameTarget: [number, number, number] = [0, 0, 0];
  // The compare view's frame: the shot's own by default, or any other frame of the same cloud (the "frame" picker, [ and ] keys), so one camera can be
  // checked against several of Guerrilla's frames (e.g. p101 / p102 / p213). ?ref=<shot> picks it from the URL.
  let shotName = '';
  let refOverride: string | null = query.get('ref');
  let syncRefImage = () => {};
  let rollDeg = 0;
  const lens = { width: 1, height: 1, shiftX: 0, shiftY: 0 };   // tuning panel framing (TuneScene frameWidth / frameHeight / shiftX / shiftY)
  // Applied after every updateProjectionMatrix in the frame loop: per-axis zoom and an off-centre shift on three's projection matrix.
  const fovEff = (vfov: number, k: number) => (2 * Math.atan(Math.tan((vfov * Math.PI) / 360) * k) * 180) / Math.PI;
  const applyLens = () => {
    if (lens.width === 1 && lens.height === 1 && lens.shiftX === 0 && lens.shiftY === 0) return;
    const m = camera.projectionMatrix.elements;
    m[0] /= lens.width; m[5] /= lens.height;
    m[8] -= 2 * lens.shiftX; m[9] -= 2 * lens.shiftY;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  };
  let camKeyNow = '';
  let sceneNow: TuneScene | null = null;
  const base = (p: readonly number[]) => [p[0], p[1] + CLOUD_BASE_HEIGHT, p[2]] as [number, number, number];
  // A bookmark is a ref name with optional variants for sweeps in one capture run, '@'-separated, ':' between key and values:
  //   p101@sun:45:335@look:art@exp:0.3@turb:4@matte@s.densityScale:0.2@cam:ex:ey:ez:tx:ty:tz:vfov
  const applyRef = (bookmark: string) => {
    const [name, ...variants] = bookmark.split('@');
    const ref: DecimaRef | undefined = DECIMA_REFS[name];
    if (!ref) throw new Error(`unknown bookmark: ${name}`);
    if (ref.cloud !== cloudName) throw new Error(`${name} shows ${ref.cloud}; load the page with ?cloud=${ref.cloud}`);
    current = bookmark;
    const v = new Map(variants.map(x => { const [k, ...rest] = x.split(':'); return [k, rest] as const; }));
    look = v.has('look') ? asLook(v.get('look')![0], pageLook) : pageLook;   // each bookmark starts from the page's look
    applyLook();
    // D1 round 7: the frame's scene settings (refs.ts `settings`), after the look and before the bookmark's own @s. variants.
    for (const [k, val] of Object.entries(ref.settings ?? {})) if (k in runtime.settings) (runtime.settings as unknown as Record<string, number | string>)[k] = val;
    for (const [k, val] of v) if (k.startsWith('s.') && k.slice(2) in runtime.settings) (runtime.settings as unknown as Record<string, number | string>)[k.slice(2)] = Number.isNaN(Number(val[0])) ? val[0] : Number(val[0]);
    const cam = v.has('cam') ? v.get('cam')!.map(Number) : nums('cam');
    const eye = cam.length === 7 ? base(cam.slice(0, 3)) : base(ref.eye);
    const target = cam.length === 7 ? base(cam.slice(3, 6)) : base(ref.target);
    camera.fov = cam.length === 7 ? cam[6] : ref.vfov;
    camera.updateProjectionMatrix();
    rig.set(eye, target);
    shotName = name;
    syncRefImage();
    frameEye = eye; frameTarget = target;
    const s = v.has('sun') ? v.get('sun')!.map(Number) : nums('sun');
    sky.setSunDirection(s.length === 2 ? { elevation: s[0], azimuth: s[1] } : ref.sun);
    const turbidity = v.has('turb') ? Number(v.get('turb')![0]) : (ref.turbidity ?? 1);
    if (turbidity !== turbidityNow) { sky.setTurbidity(turbidity); turbidityNow = turbidity; }
    // D1 sky colour variants: skyf:r:g:b = per-channel sky tint (Unreal SkyLuminanceFactor; the cloud's ambient follows through the LUTs),
    // sunc:r:g:b = sun colour (linear). Both reset to 1 when a bookmark lacks them.
    const skyf = v.has('skyf') ? v.get('skyf')!.map(Number) : (ref.skyFactor ?? [1, 1, 1]);
    if (skyf.join() !== skyFactorNow) { sky.setSkyLuminanceFactor(skyf); skyFactorNow = skyf.join(); }
    const sunc = v.has('sunc') ? v.get('sunc')!.map(Number) : (ref.sunColor ?? [1, 1, 1]);
    if (sunc.join() !== sunColorNow) { sky.setSunColor(sunc); sunColorNow = sunc.join(); }
    // mieg:g = the haze's forward-scatter phase (@pmndrs/sky miePhaseG, 0.8 default): lower spreads the sun halo that Decima's gradient skies lack.
    const mieg = v.has('mieg') ? Number(v.get('mieg')![0]) : (ref.miePhaseG ?? 0.8);
    if (mieg !== miePhaseNow) { sky.setAtmosphere({ miePhaseG: mieg }); miePhaseNow = mieg; }
    // D1 round 10 (atm:h:m:r = the haze band): the frames' skies are flat above and rise to a pale band (0.88-0.94) in the lowest quarter; the
    // Earth atmosphere at any turbidity rises evenly (ours 0.64-0.67 at the horizon). h = the Mie layer's scale height in km (Earth 1.2; a thin,
    // dense layer makes a band near the horizon), m = the multiple-scattering factor (Unreal's; lifts and whitens the whole sky), r = a Rayleigh
    // multiplier. Turbidity still scales the Mie coefficients (setTurbidity after setAtmosphere, which resets it).
    const atm = v.has('atm') ? v.get('atm')!.map(Number) : (ref.atmosphere ?? [1.2, 1, 1]);
    if (atm.join() !== atmNow) {
      sky.setAtmosphere({ mieDensityExpScale: -1 / atm[0], multiScatteringFactor: atm[1], rayleighScattering: [EARTH.rayleighScattering.x * atm[2], EARTH.rayleighScattering.y * atm[2], EARTH.rayleighScattering.z * atm[2]] });
      sky.setTurbidity(turbidity); atmNow = atm.join();
    }
    // mirror:1 = the sky mirrored below the horizon (D1 round 3): the deck frames have no ground, their sky gradient continues below the horizon
    // near white, so Decima's undersides are lit from below; our lower hemisphere was the dark sea.
    const mirror = v.has('mirror') ? v.get('mirror')![0] === '1' : (ref.mirrorBelowHorizon ?? false);
    if (mirror !== mirrorNow) { sky.setMirrorBelowHorizon(mirror); mirrorNow = mirror; }
    // D1 round 10 (ramp:0|1): the frame's sky ramp (refs.skyRamp) painted on the sky and integrated by the clouds' ambient; ramp:0 = the physical LUT.
    // ramp:0 = the physical LUT; 1 = painted sky, the clouds' ambient integrates it; 2 (round 11) = painted sky only, the ambient from the LUT;
    // ramp:1:a = painted sky with the ambient's ramp weight a (0..1). The look's stops ease smoothly (round 11: linear stops printed a stepped band).
    const rampArgs = v.has('ramp') ? v.get('ramp')!.map(Number) : [];
    const rampMode = rampArgs.length ? rampArgs[0] : (ref.skyRamp ? 1 : 0);
    const rampAmbient = rampMode === 2 ? 0 : rampArgs.length > 1 ? rampArgs[1] : (ref.skyRampAmbient ?? 0);
    const rampOn = rampMode > 0;
    const rampKey = rampOn && ref.skyRamp ? JSON.stringify(ref.skyRamp) + skyf.join() + rampMode + ':' + rampAmbient : '';
    if (rampKey !== rampNow) {
      if (rampKey) {
        // the sky mesh multiplies the look's ramp by the luminance factor afterwards: divide it out so the painted sky is the ref's ramp.
        const stops = ref.skyRamp!.map(st => ({ at: st.at, color: [st.color[0] / skyf[0], st.color[1] / skyf[1], st.color[2] / skyf[2]], ease: 'smooth' as const }));
        sky.setLook(resolveLook({ stops, chroma: 1, value: 1, intensity: 1 }));
        skyBridge.skyRamp = { strength: 1, ambient: rampAmbient, stops: ref.skyRamp!.map(st => ({ at: st.at, color: [st.color[0], st.color[1], st.color[2]] })) };
      } else { sky.setLook(null); skyBridge.skyRamp = null; }
      rampNow = rampKey;
    }
    skyBridge.skyTintToAmbient = !(v.has('skytint') && v.get('skytint')![0] === '0');   // D1 round 11 A/B: skytint:0 = the round-9 plumbing
    // D1 round 11 (ambtint:r:g:b, refs.ambientTint): a per-scene tint of the sky radiance the clouds see (on top of the luminance factor); the sky mesh untouched.
    const ambtint = v.has('ambtint') ? v.get('ambtint')!.map(Number) : (ref.ambientTint ?? [1, 1, 1]);
    skyBridge.ambientTint = [ambtint[0], ambtint[1], ambtint[2]];
    // D1 round 12 (suntint:r:g:b, refs.sunTint): the clouds' sun colour apart from the sky's; wind:x:y:z = the noise phase (windOffset, m) of a still.
    const suntint = v.has('suntint') ? v.get('suntint')!.map(Number) : (ref.sunTint ?? [1, 1, 1]);
    skyBridge.sunTint = [suntint[0], suntint[1], suntint[2]];
    if (v.has('wind')) { const w = v.get('wind')!.map(Number); runtime.settings.windOffset = [w[0], w[1], w[2]]; }
    bridge.matte = matte || v.has('matte');
    // D1 round 5 post variants: @post:aces|none|fit (?post= for the page), @dither:0|1 (?dither=; default 1).
    bridge.post.mode = POST_MODES[v.has('post') ? v.get('post')![0] : (query.get('post') ?? 'aces')] ?? 0;
    bridge.post.dither = v.has('dither') ? Number(v.get('dither')![0]) : query.has('dither') ? Number(query.get('dither')) : 1;
    bridge.post.exposure = v.has('exp') ? Number(v.get('exp')![0]) : query.has('exposure') ? baseExposure : (ref.exposure ?? baseExposure);
    runtime.resetTemporal();
    syncLook();
    const sunNow = s.length === 2 ? { elevation: s[0], azimuth: s[1] } : ref.sun;
    rollDeg = v.has('roll') ? Number(v.get('roll')![0]) : (ref.roll ?? 0);
    const rel = (p: readonly number[]) => [p[0], p[1] - CLOUD_BASE_HEIGHT, p[2]] as [number, number, number];
    sceneNow = {
      camEye: rel(eye), camTarget: rel(target), vfov: camera.fov, roll: rollDeg,
      frameWidth: lens.width, frameHeight: lens.height, shiftX: lens.shiftX, shiftY: lens.shiftY,
      sunElevation: sunNow.elevation, sunAzimuth: sunNow.azimuth, exposure: bridge.post.exposure, turbidity, miePhaseG: mieg,
      sunColor: [sunc[0], sunc[1], sunc[2]], sunTint: [suntint[0], suntint[1], suntint[2]], ambientTint: [ambtint[0], ambtint[1], ambtint[2]], skyFactor: [skyf[0], skyf[1], skyf[2]],
      postMode: bridge.post.mode, dither: bridge.post.dither,
    };
    camKeyNow = [...sceneNow.camEye, ...sceneNow.camTarget, sceneNow.vfov].join();
    tuner?.sync(sceneNow);
  };
  // The tuning panel's scene dials: the same setters applyRef uses, with its change trackers kept in step.
  const applyScene = (t: TuneScene) => {
    // Move the camera only when a camera dial changed, so tuning the light does not undo an orbit.
    const camKey = [...t.camEye, ...t.camTarget, t.vfov].join();
    if (camKey !== camKeyNow) {
      frameEye = base(t.camEye); frameTarget = base(t.camTarget);
      rig.set(frameEye, frameTarget);
      camera.fov = t.vfov; camera.updateProjectionMatrix();
      camKeyNow = camKey;
    }
    rollDeg = t.roll;
    lens.width = t.frameWidth || 1; lens.height = t.frameHeight || 1; lens.shiftX = t.shiftX; lens.shiftY = t.shiftY;
    sky.setSunDirection({ elevation: t.sunElevation, azimuth: t.sunAzimuth });
    if (t.miePhaseG !== miePhaseNow) { sky.setAtmosphere({ miePhaseG: t.miePhaseG }); miePhaseNow = t.miePhaseG; sky.setTurbidity(t.turbidity); }
    if (t.turbidity !== turbidityNow) { sky.setTurbidity(t.turbidity); turbidityNow = t.turbidity; }
    if (t.skyFactor.join() !== skyFactorNow) { sky.setSkyLuminanceFactor(t.skyFactor); skyFactorNow = t.skyFactor.join(); }
    if (t.sunColor.join() !== sunColorNow) { sky.setSunColor(t.sunColor); sunColorNow = t.sunColor.join(); }
    skyBridge.sunTint = [...t.sunTint];
    skyBridge.ambientTint = [...t.ambientTint];
    bridge.post.exposure = t.exposure;
    bridge.post.mode = (Math.max(0, Math.min(2, t.postMode)) as 0 | 1 | 2);
    bridge.post.dither = t.dither;
    runtime.resetTemporal();
  };

  const hud = document.getElementById('hud')!;
  const panel = document.getElementById('panel')!;
  if (query.get('clean') === '1') { hud.style.display = 'none'; panel.style.display = 'none'; }
  for (const name of DECIMA_REF_NAMES.filter(n => DECIMA_REFS[n].cloud === cloudName)) {
    const b = document.createElement('button'); b.textContent = name; b.title = DECIMA_REFS[name].source; b.onclick = () => applyRef(name); panel.appendChild(b);
  }
  const lookBtn = document.createElement('button');
  const syncLook = () => { lookBtn.textContent = `look: ${look}`; };
  lookBtn.onclick = () => { look = LOOKS[(LOOKS.indexOf(look) + 1) % LOOKS.length]; applyLook(); syncLook(); if (sceneNow) tuner?.sync(sceneNow); };
  syncLook(); panel.appendChild(lookBtn);
  tuner = createTuner({
    settings: runtime.settings as unknown as Record<string, unknown>,
    onSettingChange: () => runtime.resetTemporal(),
    applyScene,
    bookmark: () => current.split('@')[0],
    look: () => look,
    loadBookmark: name => applyRef(name),
    readCamera: () => {
      const p = camera.position, t = rig.orbit.target;
      return { eye: [p.x, p.y - CLOUD_BASE_HEIGHT, p.z], target: [t.x, t.y - CLOUD_BASE_HEIGHT, t.z], vfov: camera.fov };
    },
  });
  (window as unknown as { __tune: unknown }).__tune = tuner;
  const compareBtn = document.createElement('button');
  const compareSlider = document.createElement('input'); compareSlider.type = 'range'; compareSlider.min = '0'; compareSlider.max = '1'; compareSlider.step = '0.01'; compareSlider.value = String(compareAmount);
  compareSlider.title = 'wipe position / overlay opacity';
  const syncCompare = () => { compareBtn.textContent = `compare: ${compare} (R)`; compareBtn.classList.toggle('on', compare !== 'off'); compareSlider.style.display = compare === 'wipe' || compare === 'overlay' ? 'block' : 'none'; resize(); };
  compareBtn.onclick = () => { compare = COMPARE[(COMPARE.indexOf(compare) + 1) % COMPARE.length]; syncCompare(); };
  compareSlider.oninput = () => { compareAmount = Number(compareSlider.value); layoutCompare(); };
  const reframeBtn = document.createElement('button'); reframeBtn.textContent = 'back to the shot camera'; reframeBtn.title = 'the frame only lines up from the shot camera';
  reframeBtn.onclick = () => rig.set(frameEye, frameTarget);
  const refPick = document.createElement('select'); refPick.title = 'which of Guerrilla\'s frames the compare view shows ([ and ] cycle)';
  const refNames = DECIMA_REF_NAMES.filter(n => DECIMA_REFS[n].cloud === cloudName);
  refPick.append(new Option('frame: the shot\'s own', ''), ...refNames.map(n => new Option(`frame: ${n} (${DECIMA_REFS[n].source})`, n)));
  refPick.value = refOverride ?? '';
  syncRefImage = () => {
    const ref = refOverride ?? shotName;
    refImg.src = `/__decima/ref/${ref}.png`;
    refPick.value = refOverride ?? '';
    refPick.classList.toggle('on', !!refOverride && refOverride !== shotName);
  };
  refPick.onchange = () => { refOverride = refPick.value || null; syncRefImage(); };
  addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key !== '[' && e.key !== ']') return;
    const list = refNames, cur = list.indexOf(refOverride ?? shotName);
    refOverride = list[(cur + (e.key === ']' ? 1 : list.length - 1)) % list.length];
    syncRefImage();
  });
  panel.append(compareBtn, compareSlider, refPick, reframeBtn);
  syncRefImage();
  addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'r') compareBtn.click();
    if (e.key === 'f' && !flip) { flip = true; layoutCompare(); }
  });
  addEventListener('keyup', e => { if (e.key === 'f') { flip = false; layoutCompare(); } });
  // The handle on the image: drag it to move the wipe (or, in overlay mode, to set the frame's opacity). Shift-move also moves it.
  const moveHandle = (clientX: number) => { const r = rect(); compareAmount = Math.min(1, Math.max(0, (clientX - r.x) / r.w)); compareSlider.value = String(compareAmount); layoutCompare(); };
  let draggingHandle = false;
  divider.addEventListener('pointerdown', e => { draggingHandle = true; divider.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation(); });
  divider.addEventListener('pointermove', e => { if (draggingHandle) moveHandle(e.clientX); });
  divider.addEventListener('pointerup', () => { draggingHandle = false; });
  addEventListener('pointermove', e => { if (e.shiftKey && (compare === 'wipe' || compare === 'overlay')) moveHandle(e.clientX); });
  syncCompare();
  const tuneBtn = document.createElement('button'); tuneBtn.textContent = 'tune (T)'; tuneBtn.onclick = () => tuner!.toggle(); panel.appendChild(tuneBtn);

  const frameData: CloudFrame = {
    view: new Float32Array(16), projection: new Float32Array(16), viewProjection: new Float32Array(16), inverseViewProjection: new Float32Array(16), previousViewProjection: new Float32Array(16),
    cameraPosition: [0, 0, 0], depth: undefined as unknown as GPUTextureView, depthKind: 'depth32float',
    sunDirection: skyBridge.values.sunDirection, atmosphere: skyBridge.bindGroup, time: 0, frameIndex: 0,
  };
  const t0 = performance.now();
  let last = t0, frame = 0;
  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    rig.update(dt);
    if (rollDeg) camera.rotateZ((rollDeg * Math.PI) / 180);   // the rig re-aims every frame, so the roll is applied fresh each frame
    camera.near = Math.min(200, Math.max(0.5, camera.position.y * 0.002));
    camera.updateProjectionMatrix();
    applyLens();
    sky.update(camera);
    void sky.updateAerialPerspective();
    skyBridge.update(camera);
    bridge.syncOutput();
    bridge.renderScene(scene, camera);
    bridge.fillFrame(camera, frameData);
    frameData.time = (now - t0) / 1000; frameData.frameIndex = frame;
    timer.beginFrame();
    const encoder = device.createCommandEncoder({ label: 'decima cloud encoder' });
    runtime.encode(encoder, frameData, timer);
    timer.endFrame(encoder);
    device.queue.submit([encoder.finish()]);
    bridge.present();
    if (frame++ % 15 === 0) hud.textContent = `${current} (${DECIMA_REFS[current]?.source ?? ''})  look ${look}${compare !== 'off' ? `  vs ${refOverride ?? shotName}` : ''}  q ${runtime.quality}\ncam ${camera.position.toArray().map(v => v.toFixed(0)).join(', ')} (${(camera.position.y - CLOUD_BASE_HEIGHT).toFixed(0)} m from the base)\nvfov ${fovEff(camera.fov, lens.height).toFixed(2)}  hfov ${fovEff(camera.fov, lens.width * camera.aspect).toFixed(2)}  shift ${lens.shiftX.toFixed(3)}, ${lens.shiftY.toFixed(3)}\nsun el ${sky.sunElevation.toFixed(1)} az ${sky.sunAzimuth.toFixed(1)}`;
    harness.frame();
  });

  applyRef(DECIMA_REFS[query.get('bookmark') ?? ''] ? query.get('bookmark')! : DECIMA_REF_NAMES.find(n => DECIMA_REFS[n].cloud === cloudName)!);
  harness.ready({
    bookmark: name => applyRef(name),
    report: () => ({ bookmark: current, look, cloud: cloudName, camera: camera.position.toArray(), vfov: camera.fov, sunElevation: sky.sunElevation, sunAzimuth: sky.sunAzimuth, quality: runtime.quality, gpuMs: timer.averages(), frameMs: {}, renderSize: runtime.renderSize, settings: runtime.settings }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
