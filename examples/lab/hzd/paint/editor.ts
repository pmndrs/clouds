// Weather-map painter for the HZD bench (M): paint the NDF's five fields (coverage, top type, bottom type, min and max height) in a dock beside
// the sky, which updates as you paint. Replaces painting the authored maps (assets/clouds/ndf/README.md) in another app.
//   Sources: the sky as it is now (read back from the GPU), the generator (seed, footprint), W1's example maps and saved paintings (through the
//   runtime's own image path, so they read exactly as ?hzn_image= does), a PNG from disk, a blank map, or the last session (autosaved here).
//   Tools: paint (toward each ticked channel's value), raise, lower, smooth, smudge, noise (toward value x fBM, to break up plateaus, which turn
//   into slabs), restore (back toward the source), gradient (drag a line). Alt-click picks the values. Right-click puts the camera there.
//   Whole-map operations, brush recipes (stratus deck, cumulus, congestus...), undo and redo.
//   The map view: north up, the camera and its view wedge, the horizon ring (beyond ringStart the ring replaces the map), the sun, the wind
//   and the coverage threshold contour (where a mean base shape survives, given the coverage slider). It follows the map's drift.
//   Save writes assets/clouds/ndf/painted/<name>.png and -height.png through the dev server (plugin.ts) and points ndf.image at them, so the
//   bench's URL reopens the painted sky. Download saves the same two PNGs.
// The model and the brush maths are in fields.ts; the runtime takes the map through proc.setNdf (written in place while painting).
import type { ProceduralClouds } from '../../../../packages/runtime/src/procedural';
import { HZD_NDF_DEFAULTS } from '../../../../packages/runtime/src/procedural/settings';
import type { ViewState } from '../../compare/shared';
import { addNoise, blurAll, CHANNELS, dab, fill, fromNdfLayers, gradient, invert, MapFields, mapToWorld, strokePoints, toNdfFields, toPngPixels, worldToMap, writeImage, type Brush, type BrushOp, type Channel, type Targets } from './fields';
import type { NdfMapEntry } from './plugin';

export interface PainterHost {
  proc: ProceduralClouds;
  device: GPUDevice;
  /** The live settings objects (the bench's tuning sources). */
  ndf: Record<string, unknown>;
  hzd: Record<string, unknown>;
  core: { settings: { windOffset: number[]; windVelocity: number[] } };
  /** The bench's live camera and sun. */
  view: ViewState;
  /** The render's aspect (width / height), for the view wedge. */
  aspect(): number;
  /** The dock opened, closed or was resized: lay the page out again. */
  onLayout(): void;
  /** The painter moved the camera. */
  onViewChange(): void;
  /** The painter changed settings (refresh the tuning panel, update the URL). */
  onSettingsChange(): void;
}

export interface Painter {
  readonly isOpen: boolean;
  toggle(open?: boolean): void;
  /** Width the dock takes from the left of the window (0 when closed). */
  inset(): number;
}

type Tool = BrushOp | 'gradient';
const TOOLS: [Tool, string, string][] = [
  ['paint', 'paint', 'toward each ticked channel\'s value'], ['raise', 'raise', 'add to the ticked channels'], ['lower', 'lower', 'subtract from the ticked channels'],
  ['smooth', 'smooth', 'blur under the brush'], ['smudge', 'smudge', 'drag the values along the stroke'],
  ['noise', 'noise', 'toward value x fBM: breaks up plateaus (painted plateaus turn into flat-sided slabs)'], ['restore', 'restore', 'back toward the source map'],
  ['gradient', 'gradient', 'drag a line: the values at its start, fading out at its end'],
];
const LABEL: Record<Channel, string> = { coverage: 'coverage', topType: 'top type', bottomType: 'bottom type', minHeight: 'min height', maxHeight: 'max height' };
const ABOUT: Record<Channel, string> = {
  coverage: 'how much cloud in the column (a mean base shape survives above about 0.38 at the default coverage; the generated map\'s p50 / p90 / p99 are 0.30 / 0.52 / 0.67)',
  topType: '0 flat stratiform top, 0.5 stratocumulus, 1 tall tiered cumulus top',
  bottomType: '0 sharp crisp base, 1 slow ragged base (table mode; the default hzd profile ignores it)',
  minHeight: 'base of the column, as a fraction of the cloud layer',
  maxHeight: 'top of the column, as a fraction of the cloud layer (kept above the base)',
};
/** Brush recipes: which channels a stroke paints, and to what. Starting points by eye, not measured. */
const RECIPES: [string, string, Targets][] = [
  ['clear', 'clear sky: coverage 0', { coverage: 0 }],
  ['stratus', 'a low flat deck: coverage 0.5, top type 0, the lowest quarter of the layer', { coverage: 0.5, topType: 0, minHeight: 0, maxHeight: 0.25 }],
  ['strato-cu', 'stratocumulus: coverage 0.5, top type 0.5, up to half the layer', { coverage: 0.5, topType: 0.5, minHeight: 0, maxHeight: 0.5 }],
  ['cumulus', 'fair-weather cumulus: coverage 0.55, top type 1, up to 0.6 of the layer', { coverage: 0.55, topType: 1, minHeight: 0, maxHeight: 0.6 }],
  ['congestus', 'towering cumulus: coverage 0.65, top type 1, the whole layer', { coverage: 0.65, topType: 1, minHeight: 0, maxHeight: 1 }],
];
const AUTOSAVE = 'hzd-paint-autosave';
const UI_STORE = 'hzd-paint-ui';

const CSS = `
#paint{position:fixed;left:0;top:0;bottom:0;background:#0c0f13;border-right:1px solid #2a3340;z-index:8;display:none;flex-direction:column;font:12px/1.35 ui-monospace,Menlo,monospace;color:#fff;box-sizing:border-box}
#paint.open{display:flex}
#paint .top{flex:none;padding:8px 8px 6px;display:flex;flex-direction:column;gap:5px;border-bottom:1px solid #2a3340}
#paint .scroll{flex:1 1 0;min-height:0;overflow-y:auto;overflow-x:hidden;padding:8px;display:grid;gap:5px;align-content:start}
#paint .grip{position:absolute;right:-4px;top:0;bottom:0;width:8px;cursor:ew-resize;z-index:2}
#paint .head{display:flex;align-items:center;gap:6px}
#paint .head b{flex:1;color:#8fb0dd;letter-spacing:.06em;text-transform:uppercase;font-size:11px}
#paint .sec{margin-top:6px;color:#8fb0dd;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase}
#paint .row{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
#paint .row>select,#paint .row>input[type=text]{flex:1 1 0;width:0;min-width:0}
#paint .note{color:#9aa6b2;font-size:11px;white-space:normal}
#paint .warn{color:#f0b85a}
#paint button,#paint select,#paint input[type=text],#paint input[type=number]{font:inherit;background:#222;color:#fff;border:1px solid #555;border-radius:3px;padding:2px 5px}
#paint button{cursor:pointer}
#paint button:disabled{opacity:.45;cursor:default}
#paint button.on{background:#357;border-color:#58a}
#paint label.sl{display:grid;grid-template-columns:70px 1fr 64px;align-items:center;gap:4px}
#paint label.sl span{text-align:right;color:#c9d2db}
#paint label.ck{display:inline-flex;gap:4px;align-items:center;cursor:pointer}
#paint input[type=range]{width:100%;min-width:0}
#paint .ch{display:grid;grid-template-columns:18px 84px 1fr 64px 18px;align-items:center;gap:4px}
#paint .ch .nm{cursor:pointer}
#paint .ch.view .nm{color:#ffd27a}
#paint .ch span.v{text-align:right;color:#c9d2db}
#paint .mapwrap{position:relative;flex:none;align-self:center;width:min(100%, max(180px, 100vh - 340px));aspect-ratio:1;background:#000;border:1px solid #2a3340;border-radius:3px;overflow:hidden;touch-action:none}
#paint .mapwrap canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
#paint .status{color:#c9d2db;font-size:11px;min-height:2.7em;white-space:pre}
#paint .busy{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#000a;color:#c9d2db}
#paint [hidden]{display:none!important}
`;

export function createPainter(host: PainterHost): Painter {
  const { proc, device, ndf, hzd, view } = host;
  const ui = (() => { try { return JSON.parse(localStorage.getItem(UI_STORE) ?? '{}') as Record<string, unknown>; } catch { return {}; } })();
  const saveUi = () => { try { localStorage.setItem(UI_STORE, JSON.stringify({ width, liveMode, display, contour, overlays, follow, name: nameIn.value.trim() })); } catch { /* storage off */ } };

  // --- State ---
  let open = false;
  let width = typeof ui.width === 'number' ? ui.width : Math.min(460, Math.round(innerWidth * 0.36));
  let fields: MapFields | null = null;       // the painting
  let base: MapFields | null = null;         // the source it started from (restore)
  let owned = false;                         // the sky shows the painting (proc.setNdf), not the generator
  let edited = false;                        // changed since the last load or save
  let sourceLabel = '';
  let tool: Tool = 'paint';
  const brush: Brush = { op: 'paint', radius: 0, hardness: 0.2, strength: 0.35, noiseCells: 12, noiseSeed: 7 };
  let sizeMeters = 1500;
  const ticked: Record<Channel, boolean> = { coverage: true, topType: false, bottomType: false, minHeight: false, maxHeight: false };
  const targets: Record<Channel, number> = { coverage: 0.55, topType: 1, bottomType: 0, minHeight: 0, maxHeight: 0.6 };
  let viewChannel: Channel = 'coverage';
  let display: 'composite' | 'channel' = ui.display === 'channel' ? 'channel' : 'composite';
  let contour = ui.contour !== false, overlays = ui.overlays !== false, follow = ui.follow === true;
  let liveMode: 'live' | 'release' = ui.liveMode === 'release' ? 'release' : 'live';
  let zoom = 1, pan: [number, number] = [0, 0];   // the map point (pixels) at the view's centre
  const undo: { channels: Channel[]; before: Float32Array[] }[] = [], redo: typeof undo = [];
  let topDown: { position: [number, number, number]; pitch: number } | null = null;
  let dirtyMap = true, dirtyUpload = false, lastUpload = 0, busy = '';
  let maps: { examples: NdfMapEntry[]; painted: NdfMapEntry[] } = { examples: [], painted: [] };

  const tile = () => Number(ndf.tileMeters) || HZD_NDF_DEFAULTS.tileMeters;
  const layer = () => [Number(hzd.layerBottom) || 1500, Number(hzd.layerTop) || 5000] as const;
  const chosen = () => CHANNELS.filter(c => ticked[c]);
  /** The map's offset in the world now (the NDF drifts with the wind unless ndfMotion is 'static'; ndf.wgsl.ts ndfOffset). */
  const drift = (): [number, number] => {
    const s = hzd.ndfMotion === 'static' ? 0 : Number(hzd.ndfDrift) || 0, w = host.core.settings.windOffset;
    return [w[0] * s, w[2] * s];
  };
  const camMap = (): [number, number] => { const [ox, oz] = drift(); return fields ? worldToMap(view.position[0] - ox, view.position[2] - oz, fields.n, tile()) : [0, 0]; };

  // --- DOM ---
  if (!document.getElementById('paint-css')) { const st = document.createElement('style'); st.id = 'paint-css'; st.textContent = CSS; document.head.appendChild(st); }
  const dock = document.createElement('div'); dock.id = 'paint';
  const grip = document.createElement('div'); grip.className = 'grip'; grip.title = 'drag to resize';
  // The head, source and map stay put; the controls under them scroll.
  const top = document.createElement('div'); top.className = 'top';
  const scroll = document.createElement('div'); scroll.className = 'scroll';
  let into: HTMLElement = top;
  dock.append(grip, top, scroll); document.body.appendChild(dock);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e;
  };
  const sec = (t: string) => into.appendChild(el('div', { className: 'sec', textContent: t }));
  const row = (...kids: (Node | string)[]) => into.appendChild(el('div', { className: 'row' }, ...kids));
  const note = (t = '') => into.appendChild(el('div', { className: 'note', textContent: t }));
  const btn = (text: string, title: string, onclick: () => void) => el('button', { textContent: text, title, onclick });
  const syncers: (() => void)[] = [];
  const sync = () => syncers.forEach(f => f());
  const slider = (name: string, title: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string) => {
    const i = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    const t = el('span');
    i.oninput = () => { set(Number(i.value)); t.textContent = fmt(Number(i.value)); };
    syncers.push(() => { i.value = String(get()); t.textContent = fmt(get()); });
    return into.appendChild(el('label', { className: 'sl', title }, name, i, t));
  };

  into.appendChild(el('div', { className: 'head' }, el('b', { textContent: 'Weather map painter' }),
    btn('help', 'keys and notes', () => { helpNote.hidden = !helpNote.hidden; }), btn('×', 'close (M)', () => toggle(false))));
  const helpNote = note('Left-drag paints. Alt-click picks the values under the cursor. Right-click puts the camera there. Wheel zooms, space- or middle-drag pans, shift-wheel sets the size. '
    + 'Over the map: 1-8 tools, [ ] size, ctrl/cmd-Z undo, shift-ctrl/cmd-Z redo, 0 fits the map. M opens and closes the painter. '
    + 'The painting replaces the generated map in the sky from the first stroke until you drop it; the tuning panel\'s weather-map settings apply to "generated" sources. '
    + 'Beyond ringStart (15 km) the horizon ring replaces the map, as in HZD. Paint soft gradients: a flat plateau of coverage turns into a flat-sided slab.');
  helpNote.hidden = true;

  // Source
  sec('Source');
  const srcPick = el('select', { title: 'what to start painting from' });
  const fileInput = el('input', { type: 'file', accept: 'image/png' }); fileInput.style.display = 'none';
  into.appendChild(fileInput);
  row(srcPick, btn('load', 'replace the painting with this source (undoable only by loading again)', () => void loadSource(srcPick.value)));
  const seedIn = el('input', { type: 'number', title: 'the generator\'s seed (ndf.seed)', step: '1' }); seedIn.style.width = '56px';
  seedIn.onchange = () => { ndf.seed = Math.round(Number(seedIn.value) || 0); host.onSettingsChange(); };
  const footPick = el('select', { title: 'the generator\'s footprint (ndf.footprint): Perlin "connected formations" or Perlin-Worley "isolated islands" (n17 p.56-57)' });
  footPick.append(new Option('connected', '0'), new Option('islands', '1'));
  footPick.onchange = () => { ndf.footprint = Number(footPick.value); host.onSettingsChange(); };
  row('seed', seedIn, btn('🎲', 'a random seed, then load the generated map', () => { ndf.seed = Math.floor(Math.random() * 1000); host.onSettingsChange(); sync(); void loadSource('generated'); }), footPick);
  syncers.push(() => { seedIn.value = String(ndf.seed); footPick.value = Number(ndf.footprint) >= 0.5 ? '1' : '0'; });
  const srcNote = note();
  syncers.push(() => {
    srcNote.innerHTML = '';
    srcNote.append(fields ? `${sourceLabel} · ${fields.n}² over ${(tile() / 1000).toFixed(0)} km (${(tile() / fields.n).toFixed(0)} m per pixel)` : 'no map yet');
    if (edited) srcNote.append(el('span', { className: 'warn', textContent: ' · unsaved changes' }));
    srcNote.append(owned ? ' · in the sky' : ` · the sky shows ${ndf.image ? String(ndf.image).replace(/^.*\//, '') : 'the generator'} until the first stroke`);
  });

  // The map view
  const mapWrap = el('div', { className: 'mapwrap' });
  const viewCanvas = el('canvas');
  const busyEl = el('div', { className: 'busy' }); busyEl.hidden = true;
  mapWrap.append(viewCanvas, busyEl);
  into.appendChild(mapWrap);
  const status = into.appendChild(el('div', { className: 'status', textContent: ' ' }));

  into = scroll;
  // Tools and brush
  sec('Tools');
  const toolButtons = TOOLS.map(([t, name, about], i) => btn(name, `${about} (${i + 1})`, () => { tool = t; sync(); }));
  row(...toolButtons);
  syncers.push(() => toolButtons.forEach((b, i) => b.classList.toggle('on', TOOLS[i][0] === tool)));
  slider('size', 'brush radius in metres ([ ] or shift-wheel over the map)', 50, 8000, 10, () => sizeMeters, v => { sizeMeters = v; }, v => (v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${Math.round(v)} m`));
  slider('strength', 'per dab (a stroke lays a dab every quarter radius); for the gradient, its full weight', 0.01, 1, 0.01, () => brush.strength, v => { brush.strength = v; }, v => v.toFixed(2));
  slider('hardness', '0 = a soft cosine falloff, 1 = a hard disc', 0, 1, 0.01, () => brush.hardness, v => { brush.hardness = v; }, v => v.toFixed(2));
  const grain = slider('grain', 'the noise brush and "+ noise": the size of its largest blobs', 200, 8000, 50, () => tile() / brush.noiseCells, v => { brush.noiseCells = Math.max(1, Math.round(tile() / v)); },
    v => `${(tile() / Math.max(1, Math.round(tile() / v)) / 1000).toFixed(2)} km`);
  syncers.push(() => { grain.style.display = tool === 'noise' ? '' : 'none'; });

  // Channels
  sec('Channels');
  note('Tick the channels a stroke changes; each one\'s value is what paint, noise, gradient and fill go toward. Click a name to view it.');
  for (const c of CHANNELS) {
    const ck = el('input', { type: 'checkbox', title: `paint ${LABEL[c]}` });
    ck.onchange = () => { ticked[c] = ck.checked; };
    const nm = el('span', { className: 'nm', textContent: LABEL[c], title: `${ABOUT[c]} (click to view this channel)` });
    nm.onclick = () => { viewChannel = c; display = 'channel'; dirtyMap = true; sync(); saveUi(); };
    const i = el('input', { type: 'range', min: '0', max: '1', step: '0.01', title: ABOUT[c] });
    const v = el('span', { className: 'v' });
    const fmt = (x: number) => (c === 'minHeight' || c === 'maxHeight' ? `${Math.round(layer()[0] + x * (layer()[1] - layer()[0]))} m` : x.toFixed(2));
    i.oninput = () => { targets[c] = Number(i.value); v.textContent = fmt(targets[c]); if (!ticked[c]) { ticked[c] = true; ck.checked = true; } };
    const eye = el('input', { type: 'radio', name: 'paint-view', title: 'view this channel in the map' });
    eye.onchange = () => { viewChannel = c; display = 'channel'; dirtyMap = true; sync(); saveUi(); };
    const r = into.appendChild(el('div', { className: 'ch' }, ck, nm, i, v, eye));
    syncers.push(() => { ck.checked = ticked[c]; i.value = String(targets[c]); v.textContent = fmt(targets[c]); eye.checked = display === 'channel' && viewChannel === c; r.classList.toggle('view', display === 'channel' && viewChannel === c); });
  }
  row(...RECIPES.map(([name, about, t]) => btn(name, `${about}; ticks those channels and switches to paint`, () => {
    for (const c of CHANNELS) { ticked[c] = t[c] !== undefined; if (t[c] !== undefined) targets[c] = t[c]!; }
    if (tool !== 'noise') tool = 'paint';
    sync();
  })));
  row(btn('fill', 'set the ticked channels to their values everywhere', () => whole(f => fill(f, chosen(), targets))),
    btn('blur all', 'blur the ticked channels by a quarter of the brush size', () => whole(f => blurAll(f, chosen(), radiusPx() / 4))),
    btn('invert', 'the ticked channels become 1 - value', () => whole(f => invert(f, chosen()))),
    btn('+ noise', 'multiply the ticked channels by fBM at the grain size, by the strength: breaks up plateaus in place', () => whole(f => addNoise(f, chosen(), brush.strength, brush.noiseCells, ++brush.noiseSeed))));

  // Display
  sec('Map view');
  const dispPick = el('select', { title: 'composite: coverage as cloud over sky, tinted by top type (blue-grey stratus to warm cumulus); channel: the viewed channel as a ramp' });
  dispPick.append(new Option('show: composite', 'composite'), new Option('show: the viewed channel', 'channel'));
  dispPick.onchange = () => { display = dispPick.value as typeof display; dirtyMap = true; sync(); saveUi(); };
  syncers.push(() => { dispPick.value = display; });
  const check = (label: string, title: string, get: () => boolean, set: (v: boolean) => void) => {
    const c = el('input', { type: 'checkbox' }); c.onchange = () => { set(c.checked); dirtyMap = true; saveUi(); };
    syncers.push(() => { c.checked = get(); });
    return el('label', { className: 'ck', title }, c, label);
  };
  row(dispPick, btn('fit', 'the whole map, centred on the world origin (0)', () => { zoom = 1; pan = fields ? [fields.n / 2, fields.n / 2] : [0, 0]; follow = false; sync(); }));
  row(check('contour', 'the coverage threshold (0.38 less the coverage bias): roughly where clouds start to form', () => contour, v => { contour = v; }),
    check('overlays', 'the camera and its view, the horizon ring, the sun and the wind', () => overlays, v => { overlays = v; }),
    check('follow camera', 'keep the camera in the middle of the map view', () => follow, v => { follow = v; }));

  // Sky
  sec('Sky');
  const livePick = el('select', { title: 'live: the sky updates while you paint (each update restarts its temporal blend, so it is noisy until you stop); on release: when the stroke ends' });
  livePick.append(new Option('update: while painting', 'live'), new Option('update: on release', 'release'));
  livePick.onchange = () => { liveMode = livePick.value as typeof liveMode; saveUi(); };
  syncers.push(() => { livePick.value = liveMode; });
  const motionPick = el('select', { title: 'hzd.ndfMotion: drift moves the map with the wind (the default), static keeps it where you painted it (Nubis)' });
  for (const m of ['drift', 'static', 'rigid', 'shape', 'detail']) motionPick.append(new Option(`map motion: ${m}`, m));
  motionPick.onchange = () => { hzd.ndfMotion = motionPick.value; host.onSettingsChange(); };
  syncers.push(() => { motionPick.value = String(hzd.ndfMotion); });
  row(livePick, motionPick);
  const tilePick = el('select', { title: 'ndf.tileMeters: the world size of the map (it tiles). Changes the sky at once; the painting keeps its pixels' });
  for (const km of [8, 12, 16, 24, 32, 48, 64]) tilePick.append(new Option(`map size: ${km} km`, String(km * 1000)));
  tilePick.onchange = () => { ndf.tileMeters = Number(tilePick.value); host.onSettingsChange(); sync(); };
  syncers.push(() => { if (![...tilePick.options].some(o => o.value === String(tile()))) tilePick.append(new Option(`map size: ${tile() / 1000} km`, String(tile()))); tilePick.value = String(tile()); });
  const topBtn = btn('', 'look straight down from 14 km over the camera\'s spot (again to go back)', () => {
    if (topDown) { view.position = [view.position[0], topDown.position[1], view.position[2]]; view.pitch = topDown.pitch; topDown = null; }
    else { topDown = { position: [...view.position], pitch: view.pitch }; view.position = [view.position[0], 14000, view.position[2]]; view.pitch = -89; }
    host.onViewChange(); sync();
  });
  syncers.push(() => { topBtn.textContent = topDown ? 'back from above' : 'view from above'; });
  const dropBtn = btn('drop the painting', 'the sky goes back to the generated map (or ndf.image); the painting stays here', () => {
    owned = false; proc.setNdf(null); sync();
  });
  syncers.push(() => { dropBtn.disabled = !owned; });
  row(topBtn, dropBtn);

  // History and files
  sec('History and files');
  const undoBtn = btn('undo', 'ctrl/cmd-Z', () => step(undo, redo)), redoBtn = btn('redo', 'shift-ctrl/cmd-Z', () => step(redo, undo));
  syncers.push(() => { undoBtn.disabled = !undo.length; redoBtn.disabled = !redo.length; });
  row(undoBtn, redoBtn);
  const nameIn = el('input', { type: 'text', placeholder: 'name (a-z 0-9 -)', title: 'saved as assets/clouds/ndf/painted/<name>.png and <name>-height.png' });
  nameIn.value = typeof ui.name === 'string' ? ui.name : '';
  row(nameIn, btn('save', 'write the two PNGs to assets/clouds/ndf/painted/ (dev server) and point ndf.image at them, so the page\'s URL reopens this sky', () => void save()),
    btn('download', 'download the two PNGs (the authored-map format: assets/clouds/ndf/README.md)', () => void download()));
  const fileNote = note('');
  row(btn('copy link', 'copy the page\'s URL (after a save it reopens this painted sky)', () => { void navigator.clipboard?.writeText(location.href); fileNote.textContent = 'link copied'; }));

  // --- Sources ---
  const refreshSources = async () => {
    try { maps = await (await fetch('/__hzd/ndf/list')).json(); } catch { maps = { examples: [], painted: [] }; }
    const keep = srcPick.value;
    srcPick.innerHTML = '';
    srcPick.append(new Option('the sky as it is now', 'sky'), new Option('generated (seed, footprint, the tuning panel\'s map settings)', 'generated'), new Option('blank (no cloud)', 'blank'));
    let saved: { time?: number } | null = null;
    try { saved = JSON.parse(localStorage.getItem(AUTOSAVE) ?? 'null'); } catch { /* storage off */ }
    if (saved?.time) srcPick.append(new Option(`last painting (${new Date(saved.time).toLocaleString()})`, 'autosave'));
    const group = (label: string, list: NdfMapEntry[]) => {
      if (!list.length) return;
      const og = el('optgroup', { label });
      for (const m of list) og.append(new Option(`${m.name}${m.heightUrl ? ' + height' : ''}`, `url:${m.url}|${m.heightUrl}`));
      srcPick.append(og);
    };
    group('W1 example maps (assets/clouds/ndf)', maps.examples);
    group('painted (assets/clouds/ndf/painted)', maps.painted);
    srcPick.append(new Option('a PNG from disk...', 'file'));
    srcPick.value = [...srcPick.options].some(o => o.value === keep) ? keep : 'sky';
  };

  /** Read the NDF texture back (2 layers of rgba8) into a map. */
  const readSky = async (): Promise<MapFields> => {
    const tex = proc.hzdTextures?.ndf.texture;
    if (!tex) throw new Error('the HZD map is not ready yet');
    const n = tex.width, bpr = Math.ceil((n * 4) / 256) * 256;
    const buf = device.createBuffer({ label: 'paint readback', size: bpr * n * 2, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = device.createCommandEncoder({ label: 'paint readback' });
    for (let l = 0; l < 2; l++) enc.copyTextureToBuffer({ texture: tex, origin: [0, 0, l] }, { buffer: buf, offset: l * bpr * n, bytesPerRow: bpr, rowsPerImage: n }, [n, n, 1]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(buf.getMappedRange());
    const l0 = new Uint8Array(n * n * 4), l1 = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) { l0.set(raw.subarray(y * bpr, y * bpr + n * 4), y * n * 4); l1.set(raw.subarray(bpr * n + y * bpr, bpr * n + y * bpr + n * 4), y * n * 4); }
    buf.unmap(); buf.destroy();
    return fromNdfLayers(n, l0, l1);
  };
  /** Through the runtime's own path (generator, then ndf.image / heightImage resampled over it), then read back. */
  const viaRuntime = async (image: string, heightImage: string): Promise<MapFields> => {
    for (const u of [image, heightImage]) if (u && !u.startsWith('blob:')) { const r = await fetch(u, { method: 'HEAD' }); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); }
    ndf.image = image; ndf.heightImage = heightImage;
    proc.setNdf(null);
    await proc.load({ hzd: true });
    return readSky();
  };
  const decodePng = async (src: Blob | string): Promise<{ px: Uint8ClampedArray; w: number; h: number }> => {
    const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height), ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    bmp.close();
    return { px, w: c.width, h: c.height };
  };

  async function loadSource(kind: string) {
    if (busy) return;
    if (kind === 'file') { fileInput.value = ''; fileInput.click(); return; }
    setBusy('loading...');
    try {
      let f: MapFields, label: string, keepOwned = false;
      if (kind === 'sky') { f = await readSky(); label = 'the sky'; keepOwned = owned; }
      else if (kind === 'generated') { f = await viaRuntime('', ''); label = `generated, seed ${ndf.seed}`; }
      else if (kind === 'blank') {
        const n = proc.hzdTextures?.ndf.texture.width ?? Math.round(Number(ndf.resolution) || HZD_NDF_DEFAULTS.resolution);
        f = new MapFields(n, { coverage: 0, topType: Number(ndf.typeMax) || 1, bottomType: Number(ndf.bottomType) || 0, minHeight: Number(ndf.minHeight) || 0, maxHeight: Number(ndf.maxHeight) || 1 });
        label = 'blank';
      } else if (kind === 'autosave') {
        const s = JSON.parse(localStorage.getItem(AUTOSAVE) ?? 'null') as { n: number; main: string; height: string } | null;
        if (!s) throw new Error('no autosave');
        f = new MapFields(s.n);
        const a = await decodePng(s.main), b = await decodePng(s.height);
        writeImage(f, a.px, a.w, a.h, ['coverage', 'topType', 'bottomType']); writeImage(f, b.px, b.w, b.h, ['minHeight', 'maxHeight', null]);
        label = 'the last painting';
      } else if (kind.startsWith('url:')) {
        const [main, height] = kind.slice(4).split('|');
        f = await viaRuntime(main, height);
        label = main.replace(/^.*\/clouds\/ndf\//, '');
      } else throw new Error(`unknown source ${kind}`);
      setMap(f, label);
      // A file source stays named in ndf.image (the URL reopens it until the first stroke); the others own the map from the first stroke.
      if (kind === 'sky') owned = keepOwned;
      else if (kind.startsWith('url:')) owned = false;
      else { ndf.image = ''; ndf.heightImage = ''; owned = false; if (kind === 'blank' || kind === 'autosave') upload(); }
      host.onSettingsChange();
      fileNote.textContent = '';
    } catch (e) { fileNote.textContent = `could not load: ${e instanceof Error ? e.message : String(e)}`; }
    setBusy('');
  }
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    setBusy('loading...');
    const url = URL.createObjectURL(file);
    try { const f = await viaRuntime(url, ''); ndf.image = ''; setMap(f, file.name); upload(); host.onSettingsChange(); }
    catch (e) { fileNote.textContent = `could not load ${file.name}: ${e instanceof Error ? e.message : String(e)}`; }
    URL.revokeObjectURL(url);
    setBusy('');
  };
  const setMap = (f: MapFields, label: string) => {
    const first = !fields || fields.n !== f.n;
    fields = f; base = f.clone(); sourceLabel = label; edited = false;
    undo.length = 0; redo.length = 0;
    if (first) { pan = [f.n / 2, f.n / 2]; zoom = 1; }
    dirtyMap = true; sync();
  };
  const setBusy = (t: string) => { busy = t; busyEl.hidden = !t; busyEl.textContent = t; };

  // --- Painting ---
  const radiusPx = () => (fields ? (sizeMeters / tile()) * fields.n : 1);
  const upload = () => {
    if (!fields) return;
    proc.setNdf({ size: fields.n, fields: toNdfFields(fields) });
    owned = true; dirtyUpload = false; lastUpload = performance.now();
    sync();
  };
  const pushUndo = (channels: Channel[]) => {
    if (!fields || !channels.length) return;
    undo.push({ channels, before: channels.map(c => fields!.data[c].slice()) });
    if (undo.length > 40) undo.shift();
    redo.length = 0;
  };
  function step(from: typeof undo, to: typeof undo) {
    const e = from.pop();
    if (!e || !fields) return;
    to.push({ channels: e.channels, before: e.channels.map(c => fields!.data[c].slice()) });
    e.channels.forEach((c, i) => fields!.data[c].set(e.before[i]));
    changed(true);
  }
  const changed = (final: boolean) => {
    edited = true; dirtyMap = true;
    if (final || liveMode === 'live') dirtyUpload = true;
    if (final) { scheduleAutosave(); sync(); }
  };
  const whole = (op: (f: MapFields) => void) => {
    if (!fields || !chosen().length) { fileNote.textContent = fields ? 'tick a channel first' : ''; return; }
    pushUndo(chosen()); op(fields); changed(true);
  };

  let autosaveTimer = 0;
  const scheduleAutosave = () => {
    clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(async () => {
      if (!fields) return;
      try {
        const { main, height } = await pngs(fields);
        const url = (b: Blob) => new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(b); });
        localStorage.setItem(AUTOSAVE, JSON.stringify({ n: fields.n, time: Date.now(), main: await url(main), height: await url(height) }));
      } catch { /* storage off or full: the autosave is a convenience */ }
    }, 1500);
  };
  const pngs = async (f: MapFields) => {
    const { main, height } = toPngPixels(f);
    const enc = async (px: Uint8ClampedArray) => { const c = new OffscreenCanvas(f.n, f.n); c.getContext('2d')!.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, f.n, f.n), 0, 0); return c.convertToBlob({ type: 'image/png' }); };
    return { main: await enc(main), height: await enc(height) };
  };
  async function save() {
    if (!fields) return;
    const name = nameIn.value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name) || name.endsWith('-height')) { fileNote.textContent = 'name: lower-case letters, digits and dashes'; return; }
    try {
      const { main, height } = await pngs(fields);
      const put = async (kind: string, body: Blob) => {
        const r = await fetch(`/__hzd/ndf/save?name=${name}&kind=${kind}`, { method: 'POST', body });
        const j = await r.json() as { url?: string; path?: string; error?: string };
        if (!r.ok || !j.url) throw new Error(j.error ?? `HTTP ${r.status}`);
        return j;
      };
      const a = await put('main', main), b = await put('height', height);
      // ndf.image names the saved files, so the page's URL reopens this sky. The painting stays bound (the same pixels).
      ndf.image = a.url; ndf.heightImage = b.url;
      edited = false; sourceLabel = `painted/${name}.png`;
      saveUi();
      host.onSettingsChange();
      fileNote.textContent = `saved ${a.path} and ${b.path}${tile() !== HZD_NDF_DEFAULTS.tileMeters ? ` (map size ${tile() / 1000} km: keep hzn_tileMeters with it)` : ''}`;
      void refreshSources();
    } catch (e) { fileNote.textContent = `save failed (the dev server saves; a static build cannot): ${e instanceof Error ? e.message : String(e)}`; }
    sync();
  }
  async function download() {
    if (!fields) return;
    const name = nameIn.value.trim().toLowerCase() || 'painted-map';
    const { main, height } = await pngs(fields);
    for (const [blob, file] of [[main, `${name}.png`], [height, `${name}-height.png`]] as const) {
      const a = el('a', { href: URL.createObjectURL(blob), download: file }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  }

  // --- The map view: drawing ---
  const mapCanvas = new OffscreenCanvas(1, 1);
  let mapImage: ImageData | null = null;
  const RAMP: [number, number, number][] = [[12, 18, 40], [38, 62, 140], [32, 140, 160], [120, 200, 110], [240, 220, 90], [255, 255, 255]];
  const ramp = (v: number): [number, number, number] => {
    const x = Math.min(Math.max(v, 0), 1) * (RAMP.length - 1), i = Math.min(Math.floor(x), RAMP.length - 2), t = x - i, a = RAMP[i], b = RAMP[i + 1];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
  const SKY = [18, 34, 58], STRATUS = [150, 172, 205], STRATOCU = [225, 228, 232], CUMULUS = [255, 247, 226];
  let drawnThreshold = NaN;
  const redrawMap = () => {
    if (!fields) return;
    const n = fields.n;
    if (mapCanvas.width !== n) { mapCanvas.width = n; mapCanvas.height = n; mapImage = null; }
    mapImage ??= new ImageData(n, n);
    const px = mapImage.data, cov = fields.data.coverage, type = fields.data.topType, ch = fields.data[viewChannel];
    const thr = drawnThreshold = 0.38 - (Number(hzd.coverageBias) || 0);
    for (let i = 0; i < n * n; i++) {
      let r: number, g: number, b: number;
      if (display === 'channel') [r, g, b] = ramp(ch[i]);
      else {
        // Coverage as cloud over a dark sky, tinted by top type: blue-grey stratus, neutral stratocumulus, warm cumulus.
        const a = Math.min(cov[i] / 0.75, 1), t = type[i], lo = t < 0.5 ? STRATUS : STRATOCU, hi = t < 0.5 ? STRATOCU : CUMULUS, u = t < 0.5 ? t * 2 : t * 2 - 1;
        r = SKY[0] + (lo[0] + (hi[0] - lo[0]) * u - SKY[0]) * a; g = SKY[1] + (lo[1] + (hi[1] - lo[1]) * u - SKY[1]) * a; b = SKY[2] + (lo[2] + (hi[2] - lo[2]) * u - SKY[2]) * a;
      }
      if (contour) {
        const x = i % n, y = (i - x) / n, here = cov[i] >= thr;
        if (here !== (cov[y * n + ((x + 1) % n)] >= thr) || here !== (cov[((y + 1) % n) * n + x] >= thr)) { r = 255; g = 176; b = 64; }
      }
      px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
    }
    mapCanvas.getContext('2d')!.putImageData(mapImage, 0, 0);
    dirtyMap = false;
  };
  let cursor: [number, number] | null = null;   // map pixels, unwrapped
  const geom = () => {
    const r = viewCanvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    const n = fields?.n ?? 1, s = (r.width / n) * zoom;   // CSS pixels per map pixel
    return { r, dpr, s, toScreen: (p: [number, number]): [number, number] => [(p[0] - pan[0]) * s + r.width / 2, (p[1] - pan[1]) * s + r.height / 2],
      toMap: (cx: number, cy: number): [number, number] => [(cx - r.left - r.width / 2) / s + pan[0], (cy - r.top - r.height / 2) / s + pan[1]] };
  };
  const draw = () => {
    const { r, dpr, s, toScreen } = geom();
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (viewCanvas.width !== W || viewCanvas.height !== H) { viewCanvas.width = W; viewCanvas.height = H; }
    const ctx = viewCanvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (!fields) return;
    if (dirtyMap || (contour && drawnThreshold !== 0.38 - (Number(hzd.coverageBias) || 0))) redrawMap();
    const n = fields.n;
    if (follow) pan = camMap();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The map tiles: a repeating pattern, the primary tile (centred on the world origin) outlined.
    const pat = ctx.createPattern(mapCanvas, 'repeat')!;
    const [ox, oy] = toScreen([0, 0]);
    pat.setTransform(new DOMMatrix([s, 0, 0, s, ox, oy]));
    ctx.imageSmoothingEnabled = s < 2;
    ctx.fillStyle = pat; ctx.fillRect(0, 0, r.width, r.height);
    ctx.strokeStyle = '#ffffff40'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.strokeRect(ox, oy, n * s, n * s); ctx.setLineDash([]);
    const mpp = tile() / n;   // metres per map pixel
    if (overlays) {
      const cam = camMap(), [cx, cy] = toScreen(cam);
      // The horizon ring (hzd ringStart..ringEnd): beyond its start the ring replaces the map.
      const rs = Number(hzd.ringStart) || 0, re = Number(hzd.ringEnd) || 0;
      if (rs > 0) {
        ctx.strokeStyle = '#9ad0ff55'; ctx.setLineDash([6, 5]);
        for (const m of [rs, re]) { ctx.beginPath(); ctx.arc(cx, cy, (m / mpp) * s, 0, Math.PI * 2); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      // The view wedge.
      const az = (view.lookAz * Math.PI) / 180, hf = Math.atan(Math.tan(((view.fov / 2) * Math.PI) / 180) * host.aspect()), len = Math.max(r.width, r.height);
      ctx.fillStyle = '#ffffff1c'; ctx.strokeStyle = '#ffffffaa';
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(az - hf) * len, cy - Math.cos(az - hf) * len);
      ctx.lineTo(cx + Math.sin(az + hf) * len, cy - Math.cos(az + hf) * len);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx + Math.sin(az - hf) * 40, cy - Math.cos(az - hf) * 40); ctx.lineTo(cx, cy); ctx.lineTo(cx + Math.sin(az + hf) * 40, cy - Math.cos(az + hf) * 40); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.stroke();
      // The sun's direction, on the view's edge.
      const sa = (view.sunAz * Math.PI) / 180, sr = Math.min(r.width, r.height) / 2 - 12;
      const sx = r.width / 2 + Math.sin(sa) * sr, sy = r.height / 2 - Math.cos(sa) * sr;
      ctx.fillStyle = view.sunEl > 0 ? '#ffd27a' : '#c77a4a'; ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.fill();
      // The wind (the map's drift direction) and north, in the top-left corner.
      const wv = host.core.settings.windVelocity, wl = Math.hypot(wv[0], wv[2]);
      ctx.font = '11px ui-monospace,Menlo,monospace'; ctx.fillStyle = '#c9d2db'; ctx.fillText('N ↑', 8, 16);
      if (wl > 0) {
        const ux = wv[0] / wl, uy = wv[2] / wl, bx = 22, by = 40;
        ctx.strokeStyle = '#c9d2db'; ctx.beginPath(); ctx.moveTo(bx - ux * 12, by - uy * 12); ctx.lineTo(bx + ux * 12, by + uy * 12); ctx.stroke();
        ctx.beginPath(); ctx.arc(bx + ux * 12, by + uy * 12, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillText('wind', 38, 44);
      }
    }
    // The scale bar.
    const target = r.width * 0.25 * mpp / s, nice = [100, 200, 500, 1000, 2000, 5000, 10000, 20000].find(v => v >= target * 0.6) ?? 20000;
    const bw = (nice / mpp) * s;
    ctx.fillStyle = '#000a'; ctx.fillRect(6, r.height - 22, bw + 52, 16);
    ctx.fillStyle = '#fff'; ctx.fillRect(10, r.height - 15, bw, 3);
    ctx.font = '11px ui-monospace,Menlo,monospace'; ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, bw + 14, r.height - 10);
    // The brush.
    if (cursor && !panning) {
      const [bx, by] = toScreen(cursor), br = radiusPx() * s;
      ctx.strokeStyle = '#ffffffcc'; ctx.beginPath(); ctx.arc(bx, by, Math.max(br, 2), 0, Math.PI * 2); ctx.stroke();
      if (brush.hardness < 0.95) { ctx.strokeStyle = '#ffffff55'; ctx.beginPath(); ctx.arc(bx, by, Math.max(br * Math.max(brush.hardness, 0.5), 1), 0, Math.PI * 2); ctx.stroke(); }
    }
    if (grad) {
      const a = toScreen(grad.a), b = toScreen(grad.b);
      ctx.strokeStyle = '#ffd27a'; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  };
  const showStatus = () => {
    if (!fields || !cursor) { status.textContent = fields ? 'left-drag paints · alt-click picks · right-click: camera here' : ' '; return; }
    const [ox, oz] = drift(), [wx, wz] = mapToWorld(cursor[0], cursor[1], fields.n, tile());
    const x = Math.floor(cursor[0]), y = Math.floor(cursor[1]), [lb, lt] = layer(), m = (v: number) => Math.round(lb + v * (lt - lb));
    const f = fields;
    status.textContent = `x ${((wx + ox) / 1000).toFixed(2)} km  z ${((wz + oz) / 1000).toFixed(2)} km (${Math.abs((wz + oz) / 1000).toFixed(1)} ${wz + oz <= 0 ? 'N' : 'S'})\n`
      + `coverage ${f.at('coverage', x, y).toFixed(2)}  top ${f.at('topType', x, y).toFixed(2)}  bottom ${f.at('bottomType', x, y).toFixed(2)}\n`
      + `heights ${m(f.at('minHeight', x, y))}-${m(f.at('maxHeight', x, y))} m`;
  };

  // --- The map view: input ---
  let stroke: { last: [number, number]; carry: number } | null = null;
  let grad: { a: [number, number]; b: [number, number]; src: MapFields } | null = null;
  let panning: { x: number; y: number; pan: [number, number] } | null = null;
  let space = false;
  const brushNow = (): Brush => ({ ...brush, op: tool === 'gradient' ? 'paint' : tool, radius: radiusPx() });
  viewCanvas.addEventListener('contextmenu', e => e.preventDefault());
  viewCanvas.addEventListener('pointerdown', e => {
    if (!fields || busy) return;
    viewCanvas.setPointerCapture(e.pointerId);
    const g = geom(), p = g.toMap(e.clientX, e.clientY);
    if (e.button === 1 || (e.button === 0 && space)) { panning = { x: e.clientX, y: e.clientY, pan: [...pan] }; follow = false; sync(); return; }
    if (e.button === 2) {
      // Put the camera over this spot (the map has drifted by the wind offset since it was laid down).
      const [ox, oz] = drift(), [wx, wz] = mapToWorld(p[0], p[1], fields.n, tile());
      view.position = [wx + ox, view.position[1], wz + oz];
      host.onViewChange();
      return;
    }
    if (e.button !== 0) return;
    if (e.altKey) {
      for (const c of CHANNELS) targets[c] = Math.round(fields.sample(c, p[0], p[1]) * 100) / 100;
      sync(); return;
    }
    const ch = chosen();
    if (!ch.length) { fileNote.textContent = 'tick a channel to paint'; return; }
    pushUndo(ch);
    if (tool === 'gradient') { grad = { a: p, b: p, src: fields.clone() }; return; }
    stroke = { last: p, carry: 0 };
    dab(fields, brushNow(), p[0], p[1], ch, targets, { base: base ?? undefined });
    changed(false);
  });
  viewCanvas.addEventListener('pointermove', e => {
    if (!fields) return;
    const g = geom(), p = g.toMap(e.clientX, e.clientY);
    cursor = p;
    if (panning) { pan = [panning.pan[0] - (e.clientX - panning.x) / g.s, panning.pan[1] - (e.clientY - panning.y) / g.s]; return; }
    if (grad) { grad.b = p; gradient(fields, grad.src, grad.a, grad.b, chosen(), targets, brush.strength); changed(false); return; }
    if (stroke) {
      const b = brushNow(), spacing = Math.max(0.5, b.radius * 0.25);
      const { points, carry } = strokePoints(stroke.last, p, spacing, stroke.carry);
      let prev = stroke.last;
      for (const q of points) { dab(fields, b, q[0], q[1], chosen(), targets, { base: base ?? undefined, dx: q[0] - prev[0], dy: q[1] - prev[1] }); prev = q; }
      stroke = { last: p, carry };
      if (points.length) changed(false);
    }
    showStatus();
  });
  const end = () => {
    if (stroke || grad) changed(true);
    stroke = null; grad = null; panning = null;
  };
  viewCanvas.addEventListener('pointerup', end);
  viewCanvas.addEventListener('pointercancel', end);
  viewCanvas.addEventListener('pointerleave', () => { cursor = null; showStatus(); });
  viewCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (!fields) return;
    if (e.shiftKey) { sizeMeters = Math.min(8000, Math.max(50, sizeMeters * Math.exp(-(e.deltaY || e.deltaX) * 0.002))); sync(); return; }
    const g = geom(), before = g.toMap(e.clientX, e.clientY);
    zoom = Math.min(32, Math.max(0.25, zoom * Math.exp(-e.deltaY * 0.0015)));
    const after = geom().toMap(e.clientX, e.clientY);
    pan = [pan[0] + before[0] - after[0], pan[1] + before[1] - after[1]];
    follow = false; sync();
  }, { passive: false });
  let hovering = false;
  dock.addEventListener('pointerenter', () => { hovering = true; });
  dock.addEventListener('pointerleave', () => { hovering = false; space = false; });
  const typing = (t: EventTarget | null) => t instanceof HTMLInputElement && t.type === 'text' || t instanceof HTMLInputElement && t.type === 'number' || t instanceof HTMLTextAreaElement;
  // Capture phase: over the dock, the painter's keys win over the bench's and the camera rig's.
  addEventListener('keydown', e => {
    if (typing(e.target)) return;
    if (e.key === 'm' && !e.metaKey && !e.ctrlKey) { toggle(); e.stopImmediatePropagation(); return; }
    if (!open) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopImmediatePropagation(); if (e.shiftKey) step(redo, undo); else step(undo, redo); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); e.stopImmediatePropagation(); step(redo, undo); return; }
    if (!hovering) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= TOOLS.length) { tool = TOOLS[n - 1][0]; sync(); }
    else if (e.key === '[' || e.key === '{') { sizeMeters = Math.max(50, sizeMeters / 1.2); sync(); }
    else if (e.key === ']' || e.key === '}') { sizeMeters = Math.min(8000, sizeMeters * 1.2); sync(); }
    else if (e.key === '0' && fields) { zoom = 1; pan = [fields.n / 2, fields.n / 2]; follow = false; sync(); }
    else if (e.code === 'Space') { space = true; e.preventDefault(); }
    else return;
    e.stopImmediatePropagation();
  }, true);
  addEventListener('keyup', e => { if (e.code === 'Space') space = false; }, true);

  // Resizing the dock.
  grip.addEventListener('pointerdown', e => {
    grip.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => { width = Math.min(Math.max(300, m.clientX), Math.round(innerWidth * 0.7)); dock.style.width = `${width}px`; host.onLayout(); };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); saveUi(); };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
  });

  // --- The loop: draw the view, send the map to the sky (live: at most every 80 ms while painting) ---
  const frame = () => {
    if (!open) return;
    if (dirtyUpload && fields && !stroke && !grad) upload();
    else if (dirtyUpload && fields && liveMode === 'live' && performance.now() - lastUpload > 80) upload();
    draw();
    requestAnimationFrame(frame);
  };

  function toggle(want = !open) {
    if (want === open) return;
    open = want;
    dock.classList.toggle('open', open);
    dock.style.width = `${width}px`;
    host.onLayout();
    if (open) {
      sync();
      void refreshSources();
      if (!fields) void loadSource('sky');
      requestAnimationFrame(frame);
    }
  }

  return {
    get isOpen() { return open; },
    toggle,
    inset: () => (open ? width : 0),
  };
}
