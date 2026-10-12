// HZD bench: the procedural Horizon Zero Dawn-style sky (the 'hzd' shaper: GPU Pro 7's density chain on our HZD noise set and the five-field
// NDF; packages/runtime/src/procedural/) in one full-window view, with every option in the sidebar, a tuning panel for its settings (tune.ts)
// and reference shots from Guerrilla's papers and the owner's photos beside it (refs.ts). Built like the Decima parity bench (../decima/).
//   Render: the compare page's "ours" pane forced to { model: 'procedural', shaper: 'hzd' } (../compare/panes/ours.ts), over its ground plane.
//   Views: the compare bookmarks (ground, horizon, sunset, dusk, afterglow, above) plus gp7 (ground, pitch 25: GPU Pro 7 Fig 4.13-4.16's framing)
//   and high (4300 m, pitch -6), the H-reports' views. Drag to look (fly: WASD QE, wheel = speed; orbit: wheel = distance).
//   Reference: a picker of the papers' frames and the photos, side by side or picture in picture (not an overlay: they are not pixel-matched),
//   hold F for the reference alone, R cycles the mode, , and . step through the list. The images come from the local research folder through
//   the dev server (refs-plugin.ts), never from the repo. A reference can carry an approximate starting view (sun, camera, coverage).
//   T: the tuning panel. M: the weather-map painter (paint/editor.ts). H: hide the UI. ?: help. [ ] { }: sun elevation by 0.1 / 1 degree.
// The URL follows the sidebar and the panel, so a copied link reopens the same view and sky:
//   ?view=<name> ?sunel= ?sunaz= ?lookaz= ?pitch= ?pos=x,y,z ?fov= ?coverage= ?exposure= ?motion= ?ref=<id> ?refmode=side|pip ?pip=s|m|l ?corner=bl|br
//   ?refpage=1 (whole page instead of the figure) ?refview=0 (picking a reference keeps the view) ?quality=ultra|high|... ?clean=1 (no UI, captures)
//   settings: hz_<key> (the shaper), hzn_<key> (the NDF), proc_<key> (march and light), c_<key> (renderer), sky_<key> (sky layer), cirrus_<key>;
//   arrays as comma lists, switches as 1 / 0. The same flags as the compare page.
// Captures: bookmarks are view names or ref:<id>, with @ variants: @sun:el:az @cov:c @exp:e @ref:<id> @mode:off|side|pip, e.g. "gp7@ref:gp7-f4.16@mode:side".
import { installCloudsHarness } from '../harness/clouds-contract';
import { BOOKMARKS, DEFAULT_COVERAGE, type Bookmark, type ViewState } from '../compare/shared';
import { Rig } from '../compare/rig';
import { createOursPane } from '../compare/panes/ours';
import { addSunControl } from '../compare/sun-control';
import { HZD_REFS, HZD_REF_BY_ID, type RefView } from './refs';
import { createHzdTuner, PREFIX, type BenchView, type SourceId } from './tune';
import { createPainter } from './paint/editor';
import { sharedBackend } from '@clouds/three';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const QUALITIES = ['mobile', 'low', 'medium', 'high', 'ultra'] as const;
const quality = (QUALITIES as readonly string[]).includes(query.get('quality') ?? '') ? query.get('quality')! : 'ultra';
const CLEAN = query.get('clean') === '1';

/** The views: the compare bookmarks plus the two framings the H-reports used. */
const VIEWS: Record<string, Bookmark & { about: string }> = {
  ground: { ...BOOKMARKS.ground, about: 'from the ground, 2 m, looking north (sun 40° in the south-east)' },
  gp7: { ...BOOKMARKS.ground, pitch: 25, about: 'GPU Pro 7 Fig 4.13-4.16 framing: the ground view tilted up 25° (the H-reports\' gp7 captures)' },
  horizon: { ...BOOKMARKS.horizon, about: 'from 40 m, nearly level: the horizon rows and the ring' },
  sunset: { ...BOOKMARKS.sunset, about: 'into a sun 4° high' },
  dusk: { ...BOOKMARKS.dusk, about: 'a 3° sun from the side (west), looking north' },
  afterglow: { ...BOOKMARKS.afterglow, about: 'the sun 1° below the horizon: clouds above about 0.5 km still lit from below' },
  above: { ...BOOKMARKS.above, about: 'from 3 km, inside the 1.5-5 km layer, looking slightly down' },
  high: { ...BOOKMARKS.ground, position: [0, 4300, 0], pitch: -6, about: 'from 4.3 km, near the tops, pitch -6° (the H-reports\' high captures)' },
};
const VIEW_NAMES = Object.keys(VIEWS);
const MOTIONS: [string, number][] = [['frozen', 0], ['slow', 0.25], ['normal', 1], ['fast', 4], ['time-lapse', 20]];
// Settings the bench reads from the URL itself (not passed to the pane), so their starting values are the code defaults.
const SETTING_PREFIXES = Object.entries(PREFIX) as [SourceId, string][];
const isSettingKey = (k: string) => SETTING_PREFIXES.some(([, p]) => k.startsWith(p)) || k === 'cirrus' || k === 'phase' || k === 'vlight';

try {
  // --- The render ---
  const viewHost = document.getElementById('view')!;
  const canvas = document.createElement('canvas'); viewHost.appendChild(canvas);
  const paneQuery = new URLSearchParams([...query].filter(([k]) => !isSettingKey(k)));
  paneQuery.set('quality', quality);
  const pane = createOursPane(canvas, paneQuery, { model: 'procedural', shaper: 'hzd' });
  const view: ViewState = { position: [0, 2, 0], lookAz: 0, pitch: 7, fov: 50, sunAz: 150, sunEl: 40, coverage: DEFAULT_COVERAGE, exposure: 1 };
  let viewName = 'ground';
  const hud = document.getElementById('hud')!;
  hud.textContent = 'starting the HZD sky...';
  await pane.init();
  const { clouds, proc, renderer } = pane.internals();
  if (!proc) throw new Error('the procedural model did not start');
  const core = clouds.core;
  const sources: Record<SourceId, Record<string, unknown>> = {
    proc: proc.settings as unknown as Record<string, unknown>,
    hzd: proc.settings.hzd as unknown as Record<string, unknown>,
    ndf: proc.settings.hzd.ndf as unknown as Record<string, unknown>,
    c: core.settings as unknown as Record<string, unknown>,
    sky: core.skyLayer.settings as unknown as Record<string, unknown>,
    cirrus: core.cirrus.settings as unknown as Record<string, unknown>,
  };

  // --- Views and the camera ---
  const syncers: Array<() => void> = [];
  const syncUi = () => syncers.forEach(f => f());
  const applyBookmark = (name: string) => {
    const b = VIEWS[name];
    if (!b) throw new Error(`unknown view: ${name}`);
    viewName = name;
    view.position = [...b.position]; view.lookAz = b.lookAz; view.pitch = b.pitch; view.sunEl = b.sunEl; view.sunAz = b.sunAz;
  };
  const applyRefView = (v: RefView) => {
    applyBookmark(v.from);
    if (v.sunEl !== undefined) view.sunEl = v.sunEl;
    if (v.sunAz !== undefined) view.sunAz = v.sunAz;
    if (v.lookAz !== undefined) view.lookAz = v.lookAz;
    if (v.pitch !== undefined) view.pitch = v.pitch;
    if (v.posy !== undefined) view.position[1] = v.posy;
    if (v.coverage !== undefined) view.coverage = v.coverage;
    if (v.fov !== undefined) view.fov = v.fov;
  };
  const num = (k: string, d: number) => (query.has(k) && query.get(k) !== '' && Number.isFinite(Number(query.get(k))) ? Number(query.get(k)) : d);
  applyBookmark(VIEW_NAMES.includes(query.get('view') ?? '') ? query.get('view')! : VIEW_NAMES.includes(query.get('bookmark') ?? '') ? query.get('bookmark')! : 'ground');
  // A link with a reference and no view (the lab index's chips) opens at the reference's starting view.
  { const r = HZD_REF_BY_ID.get(query.get('ref') ?? ''); if (r?.view && !query.has('view') && !query.has('bookmark') && query.get('refview') !== '0') applyRefView(r.view); }
  view.sunEl = num('sunel', view.sunEl); view.sunAz = num('sunaz', view.sunAz); view.lookAz = num('lookaz', view.lookAz); view.pitch = num('pitch', view.pitch);
  view.fov = num('fov', view.fov); view.coverage = num('coverage', view.coverage); view.exposure = num('exposure', view.exposure);
  view.position[1] = num('posy', view.position[1]);
  { const p = (query.get('pos') ?? '').split(',').map(Number); if (p.length === 3 && p.every(Number.isFinite)) view.position = [p[0], p[1], p[2]]; }
  const rig = new Rig(view, viewHost);

  // --- Settings: the tuning panel, then the URL's overrides on top of the starting values ---
  let urlTimer = 0;
  const scheduleUrl = () => { clearTimeout(urlTimer); urlTimer = window.setTimeout(syncUrl, 250); };
  const tuner = createHzdTuner({
    sources,
    onChange: () => { core.resetTemporal(); scheduleUrl(); },
    view: (): BenchView => ({ name: viewName, position: [...view.position], lookAz: view.lookAz, pitch: view.pitch, fov: view.fov, sunEl: view.sunEl, sunAz: view.sunAz, coverage: view.coverage, exposure: view.exposure }),
    applyView: v => { viewName = VIEWS[v.name] ? v.name : viewName; Object.assign(view, { position: [...v.position], lookAz: v.lookAz, pitch: v.pitch, fov: v.fov, sunEl: v.sunEl, sunAz: v.sunAz, coverage: v.coverage, exposure: v.exposure }); syncUi(); scheduleUrl(); },
    ref: () => refId,
    setRef: id => setRef(id, false),
  });
  tuner.start();
  const parseLike = (old: unknown, raw: string): unknown => {
    if (typeof old === 'number') return Number.isFinite(Number(raw)) ? Number(raw) : undefined;
    if (typeof old === 'boolean') return raw === '1' || raw === 'true';
    if (typeof old === 'string') return raw;
    if (Array.isArray(old)) { const a = raw.split(',').map(Number); return a.length === old.length && a.every(Number.isFinite) ? a : undefined; }
    return undefined;
  };
  for (const [k, raw] of query) {
    if (k === 'cirrus') { sources.cirrus.enabled = raw === '1'; continue; }
    if (k === 'phase') { sources.c.phaseModel = raw; continue; }
    for (const [s, p] of SETTING_PREFIXES) {
      if (!k.startsWith(p)) continue;
      const key = k.slice(p.length);
      if (!(key in sources[s])) continue;
      const v = parseLike(sources[s][key], raw);
      if (v !== undefined) sources[s][key] = v;
    }
  }
  // Motion: the renderer's animSpeed (?motion=0 freezes the clouds, as the H-report captures did with c_animSpeed=0).
  if (query.has('motion')) sources.c.animSpeed = num('motion', 1);
  tuner.refresh();
  (window as unknown as { __tune: unknown }).__tune = tuner;

  // --- Layout: the render and the reference (off, side by side, picture in picture; hold F for the reference alone) ---
  const MODES = ['off', 'side', 'pip'] as const;
  type RefMode = (typeof MODES)[number];
  let refMode: RefMode = (MODES as readonly string[]).includes(query.get('refmode') ?? '') ? query.get('refmode') as RefMode : 'off';
  let refId = HZD_REF_BY_ID.has(query.get('ref') ?? '') ? query.get('ref')! : '';
  let pipSize = ['s', 'm', 'l'].includes(query.get('pip') ?? '') ? query.get('pip')! : 'm';
  let corner = query.get('corner') === 'br' ? 'br' : 'bl';
  let refPage = query.get('refpage') === '1';
  let refFollowsView = query.get('refview') !== '0';
  let flip = false;
  let uiHidden = CLEAN;
  const refBox = document.getElementById('refbox')!;
  const refCanvas = refBox.querySelector('canvas')!;
  const refMsg = refBox.querySelector<HTMLElement>('.msg')!;
  const refCap = refBox.querySelector<HTMLElement>('.cap')!;
  const refImg = new Image();
  let refLoaded = false;
  const PIP: Record<string, number> = { s: 0.25, m: 0.36, l: 0.5 };
  const SIDEBAR = 266;
  const drawRef = () => {
    const ref = HZD_REF_BY_ID.get(refId);
    const r = refBox.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    refCanvas.width = Math.max(1, Math.round(r.width * dpr)); refCanvas.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = refCanvas.getContext('2d')!;
    ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0, 0, refCanvas.width, refCanvas.height);
    if (!ref || !refLoaded) return;
    const [cx, cy, cw, ch] = ref.crop && !refPage ? ref.crop : [0, 0, 1, 1];
    const sx = cx * refImg.naturalWidth, sy = cy * refImg.naturalHeight, sw = cw * refImg.naturalWidth, sh = ch * refImg.naturalHeight;
    const k = Math.min(refCanvas.width / sw, refCanvas.height / sh);
    const dw = sw * k, dh = sh * k;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(refImg, sx, sy, sw, sh, (refCanvas.width - dw) / 2, (refCanvas.height - dh) / 2, dw, dh);
  };
  const refAspect = () => {
    const ref = HZD_REF_BY_ID.get(refId);
    if (!ref || !refLoaded) return 16 / 9;
    const [, , cw, ch] = ref.crop && !refPage ? ref.crop : [0, 0, 1, 1];
    return (cw * refImg.naturalWidth) / (ch * refImg.naturalHeight);
  };
  const layout = () => {
    // The weather-map painter docks on the left (M); the render and the reference share what is left.
    const L = painter?.inset() ?? 0, W = innerWidth - L, H = innerHeight;
    const showRef = !!refId && (flip || refMode !== 'off');
    let vw = W;
    refBox.className = '';
    if (!showRef) refBox.style.display = 'none';
    else {
      refBox.style.display = 'block';
      let box: { x: number; y: number; w: number; h: number };
      if (flip) { box = { x: 0, y: 0, w: innerWidth, h: H }; refBox.classList.add('full'); }
      else if (refMode === 'side') {
        // The two halves share the width left of the sidebar (all of it with the UI hidden).
        const avail = W - (uiHidden ? 0 : SIDEBAR);
        vw = Math.round(avail / 2);
        box = { x: L + vw, y: 0, w: avail - vw, h: H };
      } else {
        const w = Math.round(W * PIP[pipSize]), h = Math.min(Math.round(H * 0.7), Math.round(w / refAspect()) + 34);
        box = { x: corner === 'bl' ? L + 12 : L + W - w - 12, y: H - h - 12, w, h };
        refBox.classList.add('pip');
      }
      Object.assign(refBox.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    }
    Object.assign(viewHost.style, { left: `${L}px`, width: `${vw}px`, height: `${H}px` });
    hud.style.left = `${L + 8}px`;
    pane.resize(Math.max(2, vw), Math.max(2, H));
    if (showRef) drawRef();
  };
  const loadRef = () => {
    const ref = HZD_REF_BY_ID.get(refId);
    refLoaded = false;
    refCap.innerHTML = '';
    refMsg.hidden = true;
    if (!ref) { layout(); return; }
    const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
    refCap.innerHTML = `<b>${esc(ref.title)}</b><br><span class="src">${esc(ref.source)}</span>${ref.view ? ' <span class="approx">· approximate view</span>' : ''}`;
    refImg.onload = () => { refLoaded = true; layout(); };
    refImg.onerror = () => { refMsg.hidden = false; refMsg.textContent = `The image for ${ref.id} is not in the local research folder (artifacts/research/${ref.file}). It is served by the dev server only.`; layout(); };
    refImg.src = `/__hzd/ref/${encodeURIComponent(ref.id)}`;
    layout();
  };
  addEventListener('resize', layout);

  // --- The weather-map painter (M): paints the NDF in a dock on the left, the sky updating as it goes ---
  const painter = CLEAN ? null : createPainter({
    proc, device: sharedBackend(renderer).device, ndf: sources.ndf, hzd: sources.hzd, core, view,
    aspect: () => canvas.width / Math.max(1, canvas.height),
    onLayout: () => layout(),
    onViewChange: () => { core.resetTemporal(); syncUi(); scheduleUrl(); },
    onSettingsChange: () => { tuner.refresh(); core.resetTemporal(); scheduleUrl(); },
  });

  // --- The sidebar: every option as a control. The URL follows it. ---
  const panel = document.getElementById('panel')!;
  const section = (title: string) => { const h = document.createElement('div'); h.className = 'sec'; h.textContent = title; panel.appendChild(h); };
  const row = (...els: (HTMLElement | string)[]) => { const r = document.createElement('div'); r.className = 'row'; r.append(...els); panel.appendChild(r); return r; };
  const note = (text: string) => { const n = document.createElement('div'); n.className = 'note'; n.textContent = text; panel.appendChild(n); return n; };
  const button = (text: string, title: string, onclick: () => void) => { const b = document.createElement('button'); b.textContent = text; b.title = title; b.onclick = onclick; return b; };
  const select = (title: string, options: [string, string][], value: string, onchange: (v: string) => void) => {
    const sel = document.createElement('select'); sel.title = title; sel.append(...options.map(([v, t]) => new Option(t, v))); sel.value = value; sel.onchange = () => onchange(sel.value); return sel;
  };
  const slider = (name: string, title: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt = (v: number) => String(Math.round(v * 100) / 100)) => {
    const l = document.createElement('label'); l.className = 'sl'; l.title = title;
    const i = document.createElement('input'); i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step);
    const t = document.createElement('span'); l.append(name, i, t);
    i.oninput = () => { set(Number(i.value)); t.textContent = fmt(Number(i.value)); scheduleUrl(); };
    syncers.push(() => { i.value = String(get()); t.textContent = fmt(get()); });
    panel.appendChild(l);
    return l;
  };

  section('Views');
  const viewButtons = new Map<string, HTMLButtonElement>();
  row(...VIEW_NAMES.map(n => { const b = button(n, VIEWS[n].about, () => { applyBookmark(n); syncUi(); scheduleUrl(); }); viewButtons.set(n, b); return b; }));
  syncers.push(() => { for (const [n, b] of viewButtons) b.classList.toggle('on', n === viewName); });
  const modeBtn = button('', 'drag to look; fly: WASD QE to move, wheel = speed; orbit: around a point ahead, wheel = distance', () => { rig.mode = rig.mode === 'fly' ? 'orbit' : 'fly'; syncUi(); });
  syncers.push(() => { modeBtn.textContent = `camera: ${rig.mode}`; });
  row(modeBtn, button('back to the view', 'the view\'s own camera (after flying or orbiting)', () => { const s = { sunEl: view.sunEl, sunAz: view.sunAz }; applyBookmark(viewName); Object.assign(view, s); syncUi(); scheduleUrl(); }));
  slider('fov', 'vertical field of view, degrees', 20, 100, 1, () => view.fov, v => { view.fov = v; });
  slider('pitch', 'camera pitch, degrees (up positive)', -89, 89, 0.5, () => view.pitch, v => { view.pitch = v; });
  slider('altitude', 'camera altitude, metres (the layer is 1.5-5 km by default)', 0.5, 12000, 0.5, () => view.position[1], v => { view.position[1] = v; }, v => `${Math.round(v)}`);

  section('Sun and time');
  {
    const sunBar = document.createElement('div'); panel.appendChild(sunBar);
    addSunControl(sunBar, view, syncers);
    const sunEl = sunBar.querySelector('label')!;
    sunEl.title = 'sun elevation: 0.1° steps from -6 to 15°, then 0.5° ([ ] 0.1°, { } 1°)';
    sunEl.querySelectorAll('input').forEach(i => i.addEventListener('input', scheduleUrl));
    addEventListener('keydown', e => { if ('[]{}'.includes(e.key)) scheduleUrl(); });
  }
  slider('sun az', 'sun azimuth, degrees from north (90 = east)', 0, 360, 1, () => view.sunAz, v => { view.sunAz = v; }, v => `${Math.round(v)}°`);
  // Time of day: sets the sun from a simple solar model (latitude 30° N, late spring: declination +15°). The elevation and azimuth stay free.
  let hours = 15;
  const solar = (h: number) => {
    const rad = Math.PI / 180, lat = 30 * rad, dec = 15 * rad, H = (h - 12) * 15 * rad;
    const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
    const A = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat));
    return { el: el / rad, az: (A / rad + 180 + 360) % 360 };
  };
  slider('time', 'time of day: sets the sun elevation and azimuth from a simple solar model (30° N, late spring); the two sliders above stay free', 4.5, 19.5, 0.05, () => hours,
    v => { hours = v; const s = solar(v); view.sunEl = Math.round(s.el * 10) / 10; view.sunAz = Math.round(s.az); syncUi(); },
    v => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`);
  const motionPick = select('cloud motion: the renderer\'s animSpeed (frozen = the H-report captures\' c_animSpeed=0)', MOTIONS.map(([n, v]) => [String(v), `motion: ${n}`]), String(sources.c.animSpeed),
    v => { sources.c.animSpeed = Number(v); tuner.refresh(); scheduleUrl(); });
  syncers.push(() => { const v = String(sources.c.animSpeed); if (![...motionPick.options].some(o => o.value === v)) motionPick.append(new Option(`motion: ×${v}`, v)); motionPick.value = v; });
  row(motionPick);

  section('Clouds and exposure');
  slider('coverage', 'the common coverage control: drives the HZD coverage bias (0.5 = the NDF as generated, ±0.5)', 0, 1, 0.01, () => view.coverage, v => { view.coverage = v; });
  slider('exposure', 'exposure multiplier on our calibrated ACES exposure', 0.25, 4, 0.05, () => view.exposure, v => { view.exposure = v; });
  if (painter) row(button('paint the weather map (M)', 'the weather-map painter: paint coverage, cloud type and heights in a dock beside the sky, load the example maps, save PNGs', () => painter.toggle()));

  section('Reference');
  const groups = [...new Set(HZD_REFS.map(r => r.group))];
  const refPick = document.createElement('select'); refPick.title = 'a reference shot shown beside the render (, and . step through the list)';
  refPick.append(new Option('reference: none', ''));
  for (const g of groups) {
    const og = document.createElement('optgroup'); og.label = g;
    for (const r of HZD_REFS.filter(x => x.group === g)) og.append(new Option(`${r.source.replace(/^owner photo: .*\//, '')} · ${r.title}`, r.id));
    refPick.append(og);
  }
  refPick.onchange = () => setRef(refPick.value, true);
  row(refPick);
  const step = (d: number) => { const ids = HZD_REFS.map(r => r.id); const i = ids.indexOf(refId); setRef(ids[(i + d + ids.length) % ids.length], true); };
  const refModeButtons = MODES.map(m => button(m === 'side' ? 'side by side' : m === 'pip' ? 'picture in picture' : 'off',
    { off: 'the render only', side: 'the reference on the right half', pip: 'the reference in a corner over the render' }[m], () => { refMode = m; syncRef(); }));
  row(button('‹', 'previous reference (,)', () => step(-1)), button('›', 'next reference (.)', () => step(1)), ...refModeButtons);
  const pipPick = select('picture-in-picture size', [['s', 'pip: small'], ['m', 'pip: medium'], ['l', 'pip: large']], pipSize, v => { pipSize = v; syncRef(); });
  const cornerPick = select('picture-in-picture corner', [['bl', 'corner: bottom left'], ['br', 'corner: bottom right']], corner, v => { corner = v; syncRef(); });
  const pipRow = row(pipPick, cornerPick);
  const pagePick = select('for a page of a paper: the figure only, or the whole page', [['0', 'show: the figure'], ['1', 'show: the whole page']], refPage ? '1' : '0', v => { refPage = v === '1'; syncRef(); });
  const pageRow = row(pagePick);
  const followBox = document.createElement('input'); followBox.type = 'checkbox'; followBox.checked = refFollowsView;
  const followLabel = document.createElement('label'); followLabel.className = 'ck'; followLabel.title = 'picking a reference also sets its approximate starting view (sun, camera, coverage)';
  followLabel.append(followBox, 'picking a reference sets its view');
  followBox.onchange = () => { refFollowsView = followBox.checked; scheduleUrl(); };
  const applyViewBtn = button('apply its view', 'the reference\'s approximate starting view (sun, camera, coverage)', () => { const r = HZD_REF_BY_ID.get(refId); if (r?.view) { applyRefView(r.view); syncUi(); scheduleUrl(); } });
  row(followLabel); row(applyViewBtn);
  const refInfo = note('');
  function syncRef() {
    const ref = HZD_REF_BY_ID.get(refId);
    refPick.value = refId;
    for (const b of refModeButtons) b.classList.toggle('on', MODES[refModeButtons.indexOf(b)] === refMode);
    pipRow.style.display = refMode === 'pip' ? '' : 'none';
    pageRow.style.display = ref?.crop ? '' : 'none';
    applyViewBtn.disabled = !ref?.view;
    refInfo.textContent = !ref ? 'Papers\' frames and the owner\'s photos (local files, served by the dev server only).'
      : `${ref.source}${ref.view ? ` · approximate starting view: ${ref.view.from}${ref.view.sunEl !== undefined ? `, sun ${ref.view.sunEl}°` : ''}${ref.view.pitch !== undefined ? `, pitch ${ref.view.pitch}°` : ''}${ref.view.coverage !== undefined ? `, coverage ${ref.view.coverage}` : ''}` : ' · no starting view (a diagram or a map)'}`;
    layout(); scheduleUrl();
  }
  function setRef(id: string, pickedByHand: boolean) {
    refId = HZD_REF_BY_ID.has(id) ? id : '';
    const ref = HZD_REF_BY_ID.get(refId);
    if (ref && refMode === 'off') refMode = 'side';
    if (pickedByHand && ref?.view && refFollowsView) { applyRefView(ref.view); syncUi(); }
    loadRef(); syncRef();
  }

  section('Panel');
  const qualityPick = select('render quality (reloads the page)', QUALITIES.map(q => [q, `quality: ${q}`]), quality, v => { const q = new URLSearchParams(location.search); if (v === 'ultra') q.delete('quality'); else q.set('quality', v); location.search = q.toString(); });
  row(button('tune (T)', 'every setting of the HZD sky, grouped, with presets', () => tuner.toggle()), qualityPick);
  const showUiBtn = document.createElement('button'); showUiBtn.id = 'showui'; showUiBtn.textContent = 'show UI (H)'; document.body.appendChild(showUiBtn);
  const help = document.createElement('div'); help.id = 'help'; help.hidden = true;
  help.innerHTML = `<b>The HZD bench</b><br>Our procedural Horizon Zero Dawn-style sky (GPU Pro 7's chain on the HZD noise set and the five-field weather map), beside Guerrilla's frames and the owner's photos.<br><br>
<b>Keys</b><br>T tuning panel · M weather-map painter · H hide the UI · ? this card<br>R cycle the reference mode (off, side by side, picture in picture) · hold F the reference alone<br>, . previous / next reference<br>[ ] sun elevation 0.1° · { } 1°<br>drag to look · fly: WASD QE, shift faster, wheel = speed · orbit: wheel = distance<br><br>
<b>Notes</b><br>References are not pixel-matched: their starting views (sun, camera, coverage) are approximate, set by eye. Papers' pages show the figure; "show: the whole page" shows the page.<br>The URL keeps the view, the reference and every changed setting: copy it to share or reopen this state. Guide: work/HZD-BENCH.md.`;
  document.body.appendChild(help);
  const hudEl = hud;
  const setUi = (hidden: boolean) => { uiHidden = hidden; hudEl.style.display = panel.style.display = hidden ? 'none' : ''; showUiBtn.style.display = hidden && !CLEAN ? 'block' : 'none'; if (hidden) help.hidden = true; layout(); };
  showUiBtn.onclick = () => setUi(false);
  row(button('hide UI (H)', 'hide the sidebar and the readout', () => setUi(true)), button('help (?)', 'keys and notes', () => { help.hidden = !help.hidden; }));

  addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'h') setUi(!uiHidden);
    if (e.key === '?') help.hidden = !help.hidden;
    if (e.key === 'r') { refMode = MODES[(MODES.indexOf(refMode) + 1) % MODES.length]; syncRef(); }
    if (e.key === ',') step(-1);
    if (e.key === '.') step(1);
    if (e.key === 'f' && !flip && refId) { flip = true; layout(); }
  });
  addEventListener('keyup', e => { if (e.key === 'f' && flip) { flip = false; layout(); } });

  // The URL follows the sidebar and the panel (throttled while dragging or flying).
  function syncUrl() {
    const q = new URLSearchParams();
    const b = VIEWS[viewName];
    const r = (v: number, k = 10) => String(Math.round(v * k) / k);
    q.set('view', viewName);
    if (view.sunEl !== b.sunEl) q.set('sunel', r(view.sunEl));
    if (view.sunAz !== b.sunAz) q.set('sunaz', r(view.sunAz));
    if (view.lookAz !== b.lookAz) q.set('lookaz', r(view.lookAz));
    if (view.pitch !== b.pitch) q.set('pitch', r(view.pitch));
    if (view.position.some((v, i) => Math.abs(v - b.position[i]) > 0.05)) q.set('pos', view.position.map(v => r(v)).join(','));
    if (view.fov !== 50) q.set('fov', r(view.fov));
    if (view.coverage !== DEFAULT_COVERAGE) q.set('coverage', r(view.coverage, 100));
    if (view.exposure !== 1) q.set('exposure', r(view.exposure, 100));
    if (refId) q.set('ref', refId);
    if (refId && refMode !== 'off') q.set('refmode', refMode);
    if (refMode === 'pip' && pipSize !== 'm') q.set('pip', pipSize);
    if (refMode === 'pip' && corner !== 'bl') q.set('corner', corner);
    if (refPage) q.set('refpage', '1');
    if (!refFollowsView) q.set('refview', '0');
    if (quality !== 'ultra') q.set('quality', quality);
    if (CLEAN) q.set('clean', '1');
    for (const [k, v] of Object.entries(tuner.changes())) {
      const [s, key] = [k.slice(0, k.indexOf('.')) as SourceId, k.slice(k.indexOf('.') + 1)];
      q.set(PREFIX[s] + key, Array.isArray(v) ? v.join(',') : typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    }
    history.replaceState(null, '', `?${q}`);
  }
  let lastCam = '';
  setInterval(() => { const k = `${view.position.map(v => Math.round(v)).join()},${Math.round(view.lookAz)},${Math.round(view.pitch)}`; if (k !== lastCam) { lastCam = k; scheduleUrl(); syncUi(); } }, 500);

  setUi(uiHidden);
  syncUi();
  if (refId) loadRef();
  syncRef();

  // --- The loop ---
  const f1 = (n: number) => n.toFixed(1);
  let last = performance.now(), frame = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    rig.update(dt);
    view.position[1] = Math.max(0.5, view.position[1]);
    pane.render(view, dt);
    if (frame % 15 === 0 && !uiHidden) {
      const s = pane.stats();
      const gpu = s.gpuMs?.total;
      const sky = s.gpuMs?.skyLayer;
      hud.textContent = `HZD sky · ${viewName}${pane.ready() ? '' : ' (loading...)'}  q ${quality}\n`
        + `cam ${view.position.map(v => Math.round(v)).join(', ')}  az ${Math.round(view.lookAz)}  pitch ${f1(view.pitch)}  fov ${Math.round(view.fov)}\n`
        + `sun el ${f1(view.sunEl)} az ${Math.round(view.sunAz)}  coverage ${view.coverage.toFixed(2)}  motion ×${sources.c.animSpeed}\n`
        + `${gpu != null ? `gpu ${f1(gpu)} ms` : ''}${sky != null ? `  sky layer ${f1(sky)} ms` : ''}  ${canvas.width}x${canvas.height}${refId ? `\nvs ${refId}` : ''}`;
    }
    frame++;
    harness.frame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Captures: "<view>" or "ref:<id>", with @ variants (see the header).
  const bookmark = (spec: string) => {
    const [head, ...variants] = spec.split('@');
    if (head.startsWith('ref:')) { refMode = refMode === 'off' ? 'side' : refMode; setRef(head.slice(4), true); }
    else applyBookmark(head);
    for (const v of variants) {
      const [k, ...a] = v.split(':');
      if (k === 'sun') { view.sunEl = Number(a[0]); if (a[1] !== undefined) view.sunAz = Number(a[1]); }
      else if (k === 'cov') view.coverage = Number(a[0]);
      else if (k === 'exp') view.exposure = Number(a[0]);
      else if (k === 'ref') setRef(a[0], false);
      else if (k === 'mode' && (MODES as readonly string[]).includes(a[0])) { refMode = a[0] as RefMode; syncRef(); }
    }
    core.resetTemporal();
    syncUi(); scheduleUrl();
  };
  const waitReady = async () => { while (!pane.ready()) await new Promise(r => setTimeout(r, 100)); };
  void waitReady().then(() => harness.ready({
    bookmark,
    report: () => ({ view: viewName, ref: refId, refMode, camera: [...view.position], lookAz: view.lookAz, pitch: view.pitch, sunElevation: view.sunEl, sunAzimuth: view.sunAz, coverage: view.coverage, quality, gpuMs: pane.stats().gpuMs, frameMs: {}, renderSize: [canvas.width, canvas.height], changed: tuner.changes() }),
  }));
} catch (e) {
  document.getElementById('hud')!.textContent = 'failed: ' + (e instanceof Error ? e.message : String(e));
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
