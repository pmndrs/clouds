// The painter's engine: the map (fields.ts's five Float32 layers), strokes, undo patches (history.ts), the upload to the sky (proc.setNdf,
// written in place), the sources (the sky read back from the GPU, the generator and the authored maps through the runtime's own image path,
// a PNG from disk, blank, the last painting), the autosave, save and download, and the map view's pixels. No React: the components call
// it, and it mirrors what the controls show into the painter store (store.ts). Behaviour as the vanilla painter (examples/lab/hzd/paint/editor.ts in git history).
import type { WebGPURenderer } from 'three/webgpu';
import type { ViewState } from '../../compare/shared';
import type { ProceduralClouds } from '../../../../packages/runtime/src/procedural';
import { HZD_NDF_DEFAULTS } from '../../../../packages/runtime/src/procedural/settings';
import { addNoise, blurAll, CHANNELS, dab, fill, fromNdfLayers, gradient, invert, MapFields, mapToWorld, strokePoints, toMaskPixels, toNdfFields, toPngPixels, worldToMap, writeImage, type Brush, type Channel } from './fields';
import { History, capture, dabRegion, fullRegion, union, type Region } from './history';
import { AUTOSAVE, type Tool } from './constants';
import { paint, saveUi } from './store';

export interface PaintHost {
  proc: ProceduralClouds;
  device: GPUDevice;
  ndf: Record<string, unknown>;
  hzd: Record<string, unknown>;
  core: { settings: { windOffset: number[]; windVelocity: number[] } };
  view: ViewState;
  renderer: WebGPURenderer;
  /** The camera moved (right-click, view from above). */
  onViewChange(): void;
  /** Settings changed (ndf.image, ndfMotion, tileMeters): the tuner, the temporal history and the URL follow. */
  onSettingsChange(): void;
}

// --- The autosave: IndexedDB (the vanilla painter's localStorage data URLs passed the 5 MB quota at 1024² and failed silently) ---
const idb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const r = indexedDB.open('hzd-paint', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('maps');
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
interface Saved { n: number; time: number; main: Blob; height: Blob; mask?: Blob }
async function idbGet(): Promise<Saved | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => { const r = db.transaction('maps').objectStore('maps').get(AUTOSAVE); r.onsuccess = () => resolve(r.result as Saved | undefined); r.onerror = () => reject(r.error); });
}
async function idbPut(v: Saved): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => { const t = db.transaction('maps', 'readwrite'); t.objectStore('maps').put(v, AUTOSAVE); t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); });
}

const SKY = [18, 34, 58], STRATUS = [150, 172, 205], STRATOCU = [225, 228, 232], CUMULUS = [255, 247, 226];
const RAMP: [number, number, number][] = [[12, 18, 40], [38, 62, 140], [32, 140, 160], [120, 200, 110], [240, 220, 90], [255, 255, 255]];
const ramp = (v: number): [number, number, number] => {
  const x = Math.min(Math.max(v, 0), 1) * (RAMP.length - 1), i = Math.min(Math.floor(x), RAMP.length - 2), t = x - i, a = RAMP[i], b = RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
};

export class PaintEngine {
  fields: MapFields | null = null;
  /** The source the painting started from (restore). */
  base: MapFields | null = null;
  readonly history = new History(40);
  /** The map view's pixels, redrawn when the map or the view options change. */
  readonly mapCanvas = new OffscreenCanvas(1, 1);
  dirtyMap = true;
  private mapImage: ImageData | null = null;
  private drawnThreshold = NaN;
  private dirtyUpload = false;
  private lastUpload = 0;
  private stroke: { last: [number, number]; carry: number } | null = null;
  grad: { a: [number, number]; b: [number, number]; src: MapFields } | null = null;
  /** The channels before the stroke (the patch is cut from them at the end) and the rectangle it touched. */
  private before: { channels: Channel[]; data: Partial<Record<Channel, Float32Array>>; region: Region | null } | null = null;
  private topDown: { position: [number, number, number]; pitch: number } | null = null;
  private autosaveTimer = 0;

  constructor(readonly host: PaintHost) {}

  // --- Geometry ---
  tile = () => Number(this.host.ndf.tileMeters) || HZD_NDF_DEFAULTS.tileMeters;
  layer = () => [Number(this.host.hzd.layerBottom) || 1500, Number(this.host.hzd.layerTop) || 5000] as const;
  chosen = (): Channel[] => { const t = paint.getState().ticked; return CHANNELS.filter(c => t[c]); };
  /** W2 influence mode: a stroke that changes the map also stamps the influence mask under the brush (so only the painted region leaves the generated map). */
  private stamps = (ch: Channel[]) => {
    const s = paint.getState();
    return s.influenceMode && !ch.includes('influence') && ch.length > 0 && (s.tool === 'paint' || s.tool === 'raise' || s.tool === 'lower' || s.tool === 'noise' || s.tool === 'smudge' || s.tool === 'gradient');
  };
  /** The map's offset in the world now (the NDF drifts with the wind unless ndfMotion is 'static'; ndf.wgsl.ts ndfOffset). */
  drift = (): [number, number] => {
    const s = this.host.hzd.ndfMotion === 'static' ? 0 : Number(this.host.hzd.ndfDrift) || 0, w = this.host.core.settings.windOffset;
    return [w[0] * s, w[2] * s];
  };
  camMap = (): [number, number] => {
    const [ox, oz] = this.drift(), v = this.host.view;
    return this.fields ? worldToMap(v.position[0] - ox, v.position[2] - oz, this.fields.n, this.tile()) : [0, 0];
  };
  radiusPx = () => (this.fields ? (paint.getState().sizeMeters / this.tile()) * this.fields.n : 1);
  aspect = () => { const c = this.host.renderer.domElement as HTMLCanvasElement; return c.width / Math.max(1, c.height); };
  brushNow = (): Brush => { const s = paint.getState(); return { op: s.tool === 'gradient' ? 'paint' : s.tool, radius: this.radiusPx(), hardness: s.hardness, strength: s.strength, noiseCells: s.noiseCells, noiseSeed: s.noiseSeed }; };

  /** The engine's state into the store, for the controls. */
  sync(extra: Partial<ReturnType<typeof paint.getState>> = {}): void {
    paint.setState({ n: this.fields?.n ?? 0, canUndo: this.history.undo.length > 0, canRedo: this.history.redo.length > 0, undoBytes: this.history.bytes, topDown: !!this.topDown, ...extra });
  }
  note(text: string): void { paint.setState({ note: text }); }
  private busy(text: string): void { paint.setState({ busy: text }); }

  // --- Opening ---
  toggle(want = !paint.getState().open): void {
    if (want === paint.getState().open) return;
    paint.setState({ open: want });
    if (!want) return;
    // A painted formation should stay where it was painted: the map holds still while the painter is used (the select still changes it).
    if (this.host.hzd.ndfMotion !== 'static') { this.host.hzd.ndfMotion = 'static'; this.host.onSettingsChange(); }
    void this.refreshSources();
    if (!this.fields) void this.loadSource('sky');
  }

  async refreshSources(): Promise<void> {
    let maps = { examples: [], painted: [] };
    try { maps = await (await fetch('/__hzd/ndf/list')).json(); } catch { /* no dev server */ }
    let autosaveTime = 0;
    try { autosaveTime = (await idbGet())?.time ?? 0; } catch { /* storage off */ }
    paint.setState({ maps, autosaveTime });
  }

  // --- Sources ---
  /** Read the NDF texture back (2 layers of rgba8) into a map. */
  async readSky(): Promise<MapFields> {
    const { proc, device } = this.host;
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
  }

  /** Through the runtime's own path (generator, then ndf.image / heightImage resampled over it), then read back. */
  private async viaRuntime(image: string, heightImage: string): Promise<MapFields> {
    for (const u of [image, heightImage]) if (u && !u.startsWith('blob:')) { const r = await fetch(u, { method: 'HEAD' }); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); }
    this.host.ndf.image = image; this.host.ndf.heightImage = heightImage; this.host.ndf.maskImage = '';
    this.host.proc.setNdf(null);
    await this.host.proc.load({ hzd: true });
    return this.readSky();
  }

  private async decodePng(src: Blob | string): Promise<{ px: Uint8ClampedArray; w: number; h: number }> {
    const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height), ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    bmp.close();
    return { px, w: c.width, h: c.height };
  }

  async loadSource(kind: string): Promise<void> {
    if (paint.getState().busy) return;
    const { ndf, proc } = this.host;
    this.busy('loading...');
    try {
      let f: MapFields, label: string, keepOwned = false;
      if (kind === 'sky') { f = await this.readSky(); label = 'the sky'; keepOwned = paint.getState().owned; }
      else if (kind === 'generated') { f = await this.viaRuntime('', ''); label = `generated, seed ${ndf.seed}`; }
      else if (kind === 'blank') {
        const n = proc.hzdTextures?.ndf.texture.width ?? Math.round(Number(ndf.resolution) || HZD_NDF_DEFAULTS.resolution);
        f = new MapFields(n, { coverage: 0, topType: Number(ndf.typeMax) || 1, bottomType: Number(ndf.bottomType) || 0, minHeight: Number(ndf.minHeight) || 0, maxHeight: Number(ndf.maxHeight) || 1 });
        label = 'blank';
      } else if (kind === 'autosave') {
        const s = await idbGet();
        if (!s) throw new Error('no autosave in this browser');
        f = new MapFields(s.n);
        const a = await this.decodePng(s.main), b = await this.decodePng(s.height);
        writeImage(f, a.px, a.w, a.h, ['coverage', 'topType', 'bottomType']); writeImage(f, b.px, b.w, b.h, ['minHeight', 'maxHeight', null]);
        if (s.mask) { const m = await this.decodePng(s.mask); writeImage(f, m.px, m.w, m.h, ['influence', null, null]); }
        label = 'the last painting';
      } else if (kind.startsWith('url:')) {
        const [main, height, mask] = kind.slice(4).split('|');
        f = await this.viaRuntime(main, height);
        // W2: a map saved with an influence mask brings it back as the influence channel (and keeps ndf.maskImage, so the URL reopens it).
        if (mask) { const m = await this.decodePng(mask); writeImage(f, m.px, m.w, m.h, ['influence', null, null]); }
        label = main.replace(/^.*\/clouds\/ndf\//, '');
      } else throw new Error(`unknown source ${kind}`);
      this.setMap(f, label);
      // A file source stays named in ndf.image (the URL reopens it until the first stroke); the others own the map from the first stroke.
      if (kind === 'sky') paint.setState({ owned: keepOwned });
      else if (kind.startsWith('url:')) { paint.setState({ owned: false }); ndf.maskImage = kind.slice(4).split('|')[2] ?? ''; }
      else { ndf.image = ''; ndf.heightImage = ''; ndf.maskImage = ''; paint.setState({ owned: false }); if (kind === 'blank' || kind === 'autosave') this.upload(); }
      this.host.onSettingsChange();
      this.note('');
    } catch (e) { this.note(`could not load: ${e instanceof Error ? e.message : String(e)}`); }
    this.busy('');
  }

  async loadFile(file: File): Promise<void> {
    this.busy('loading...');
    const url = URL.createObjectURL(file);
    try { const f = await this.viaRuntime(url, ''); this.host.ndf.image = ''; this.setMap(f, file.name); this.upload(); this.host.onSettingsChange(); }
    catch (e) { this.note(`could not load ${file.name}: ${e instanceof Error ? e.message : String(e)}`); }
    URL.revokeObjectURL(url);
    this.busy('');
  }

  private setMap(f: MapFields, label: string): void {
    const first = !this.fields || this.fields.n !== f.n;
    this.fields = f; this.base = f.clone();
    this.history.clear();
    this.dirtyMap = true;
    this.sync({ sourceLabel: label, edited: false, ...(first ? { pan: [f.n / 2, f.n / 2] as [number, number], zoom: 1 } : {}) });
  }

  // --- Painting ---
  upload(): void {
    if (!this.fields) return;
    const nf = toNdfFields(this.fields);
    this.host.proc.setNdf({ size: this.fields.n, fields: paint.getState().influenceMode ? nf : { ...nf, influence: undefined } });
    this.dirtyUpload = false; this.lastUpload = performance.now();
    if (!paint.getState().owned) paint.setState({ owned: true });
  }

  private changed(final: boolean): void {
    this.dirtyMap = true;
    if (final || paint.getState().liveMode === 'live') this.dirtyUpload = true;
    if (!paint.getState().edited) paint.setState({ edited: true });
    if (final) { this.scheduleAutosave(); this.sync(); }
  }

  /** Before a stroke: keep the channels it can change (the undo patch is cut from them when it ends). */
  private begin(channels: Channel[]): void {
    const f = this.fields!;
    this.before = { channels, data: Object.fromEntries(channels.map(c => [c, f.data[c].slice()])), region: null };
  }
  private touch(r: Region): void { if (this.before && this.fields) this.before.region = union(this.before.region, r, this.fields.n); }
  private commit(): void {
    const b = this.before, f = this.fields;
    this.before = null;
    if (!b || !f || !b.region) return;
    this.history.push(capture(f.n, b.data, b.channels, b.region));
  }

  pointerDown(p: [number, number], alt: boolean): void {
    const f = this.fields;
    if (!f || paint.getState().busy) return;
    const s = paint.getState();
    if (alt) {
      const targets = { ...s.targets };
      for (const c of CHANNELS) targets[c] = Math.round(f.sample(c, p[0], p[1]) * 100) / 100;
      paint.setState({ targets });
      return;
    }
    const ch = this.chosen();
    if (!ch.length) { this.note('tick a channel to paint'); return; }
    this.begin(this.stamps(ch) ? [...ch, 'influence'] : ch);
    if (s.tool === 'gradient') { this.grad = { a: p, b: p, src: f.clone() }; this.touch(fullRegion(f.n)); return; }
    this.stroke = { last: p, carry: 0 };
    const b = this.brushNow();
    dab(f, b, p[0], p[1], ch, s.targets, { base: this.base ?? undefined });
    if (this.stamps(ch)) dab(f, { ...b, op: 'paint' }, p[0], p[1], ['influence'], { influence: 1 });
    this.touch(dabRegion(p[0], p[1], Math.max(0.5, b.radius)));
    this.changed(false);
  }

  pointerMove(p: [number, number]): void {
    const f = this.fields;
    if (!f) return;
    const s = paint.getState();
    if (this.grad) { const ch = this.chosen(); gradient(f, this.grad.src, this.grad.a, (this.grad.b = p), this.stamps(ch) ? [...ch, 'influence'] : ch, s.targets, s.strength); this.changed(false); return; }
    if (!this.stroke) return;
    const b = this.brushNow(), spacing = Math.max(0.5, b.radius * 0.25), ch = this.chosen();
    const { points, carry } = strokePoints(this.stroke.last, p, spacing, this.stroke.carry);
    let prev = this.stroke.last;
    for (const q of points) {
      dab(f, b, q[0], q[1], ch, s.targets, { base: this.base ?? undefined, dx: q[0] - prev[0], dy: q[1] - prev[1] });
      if (this.stamps(ch)) dab(f, { ...b, op: 'paint' }, q[0], q[1], ['influence'], { influence: 1 });
      this.touch(dabRegion(q[0], q[1], Math.max(0.5, b.radius)));
      prev = q;
    }
    this.stroke = { last: p, carry };
    if (points.length) this.changed(false);
  }

  pointerUp(): void {
    if (this.stroke || this.grad) { this.commit(); this.changed(true); }
    this.stroke = null; this.grad = null;
  }
  get painting(): boolean { return !!(this.stroke || this.grad); }

  /** Put the camera over this map spot (the map has drifted by the wind offset since it was laid down). */
  cameraHere(p: [number, number]): void {
    if (!this.fields) return;
    const [ox, oz] = this.drift(), [wx, wz] = mapToWorld(p[0], p[1], this.fields.n, this.tile()), v = this.host.view;
    v.position = [wx + ox, v.position[1], wz + oz];
    this.host.onViewChange();
  }

  /** A whole-map operation on the ticked channels (one undo step). */
  whole(kind: 'fill' | 'blur' | 'invert' | 'noise'): void {
    const f = this.fields, ch = this.chosen(), s = paint.getState();
    if (!f || !ch.length) { this.note(f ? 'tick a channel first' : ''); return; }
    this.history.push(capture(f.n, f.data, ch, fullRegion(f.n)));
    if (kind === 'fill') fill(f, ch, s.targets);
    else if (kind === 'blur') blurAll(f, ch, this.radiusPx() / 4);
    else if (kind === 'invert') invert(f, ch);
    else { const seed = s.noiseSeed + 1; paint.setState({ noiseSeed: seed }); addNoise(f, ch, s.strength, s.noiseCells, seed); }
    this.changed(true);
  }

  undoStep(back: boolean): void {
    if (!this.fields || this.painting) return;
    if (this.history.step(this.fields, back)) this.changed(true);
  }

  /** Called every frame while the dock is open: sends the map to the sky (live: at most every 80 ms while painting; else when it ends). */
  frame(): void {
    if (!this.dirtyUpload || !this.fields) return;
    if (!this.painting) this.upload();
    else if (paint.getState().liveMode === 'live' && performance.now() - this.lastUpload > 80) this.upload();
  }

  dropPainting(): void {
    this.host.proc.setNdf(null);
    paint.setState({ owned: false });
  }

  /** Look straight down from 14 km over the camera's spot, or back. */
  toggleTopDown(): void {
    const v = this.host.view;
    if (this.topDown) { v.position = [v.position[0], this.topDown.position[1], v.position[2]]; v.pitch = this.topDown.pitch; this.topDown = null; }
    else { this.topDown = { position: [...v.position], pitch: v.pitch }; v.position = [v.position[0], 14000, v.position[2]]; v.pitch = -89; }
    this.host.onViewChange();
    this.sync();
  }

  // --- Files ---
  private async pngs(f: MapFields): Promise<{ main: Blob; height: Blob; mask: Blob | null }> {
    const { main, height } = toPngPixels(f);
    const enc = async (px: Uint8ClampedArray) => { const c = new OffscreenCanvas(f.n, f.n); c.getContext('2d')!.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, f.n, f.n), 0, 0); return c.convertToBlob({ type: 'image/png' }); };
    // W2: the mask goes with the map when influence mode is on and something was painted into it.
    const hasMask = paint.getState().influenceMode && f.data.influence.some(v => v > 0);
    return { main: await enc(main), height: await enc(height), mask: hasMask ? await enc(toMaskPixels(f)) : null };
  }

  private scheduleAutosave(): void {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(async () => {
      const f = this.fields;
      if (!f) return;
      try {
        const { main, height, mask } = await this.pngs(f);
        const time = Date.now();
        await idbPut({ n: f.n, time, main, height, ...(mask ? { mask } : {}) });
        paint.setState({ autosaveTime: time });
      } catch (e) { this.note(`autosave failed (save or download to keep this painting): ${e instanceof Error ? e.message : String(e)}`); }
    }, 1500);
  }

  async save(): Promise<void> {
    const f = this.fields;
    if (!f) return;
    const name = paint.getState().name.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name) || name.endsWith('-height')) { this.note('name: lower-case letters, digits and dashes'); return; }
    try {
      const { main, height, mask } = await this.pngs(f);
      const put = async (kind: string, body: Blob) => {
        const r = await fetch(`/__hzd/ndf/save?name=${name}&kind=${kind}`, { method: 'POST', body });
        const j = await r.json() as { url?: string; path?: string; error?: string };
        if (!r.ok || !j.url) throw new Error(j.error ?? `HTTP ${r.status}`);
        return j;
      };
      const a = await put('main', main), b = await put('height', height), c = mask ? await put('mask', mask) : null;
      // ndf.image names the saved files, so the page's URL reopens this sky. The painting stays bound (the same pixels).
      this.host.ndf.image = a.url; this.host.ndf.heightImage = b.url; this.host.ndf.maskImage = c?.url ?? '';
      paint.setState({ edited: false, sourceLabel: `painted/${name}.png` });
      saveUi();
      this.host.onSettingsChange();
      this.note(`saved ${a.path} and ${b.path}${c ? ` and ${c.path}` : ''}${this.tile() !== HZD_NDF_DEFAULTS.tileMeters ? ` (map size ${this.tile() / 1000} km: keep hzn_tileMeters with it)` : ''}`);
      void this.refreshSources();
    } catch (e) { this.note(`save failed (the dev server saves; a static build cannot): ${e instanceof Error ? e.message : String(e)}`); }
  }

  async download(): Promise<void> {
    const f = this.fields;
    if (!f) return;
    const name = paint.getState().name.trim().toLowerCase() || 'painted-map';
    const { main, height, mask } = await this.pngs(f);
    for (const [blob, file] of [[main, `${name}.png`], [height, `${name}-height.png`], ...(mask ? [[mask, `${name}-mask.png`] as const] : [])] as const) {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  }

  // --- The map view's pixels ---
  threshold = () => 0.38 - (Number(this.host.hzd.coverageBias) || 0);

  /** Recolours the map image when it changed (or the contour's threshold moved with the coverage slider). */
  redrawMap(): void {
    const f = this.fields, s = paint.getState();
    if (!f) return;
    if (!this.dirtyMap && !(s.contour && this.drawnThreshold !== this.threshold())) return;
    const n = f.n;
    if (this.mapCanvas.width !== n) { this.mapCanvas.width = n; this.mapCanvas.height = n; this.mapImage = null; }
    this.mapImage ??= new ImageData(n, n);
    const px = this.mapImage.data, cov = f.data.coverage, type = f.data.topType, ch = f.data[s.viewChannel];
    const thr = this.drawnThreshold = this.threshold();
    for (let i = 0; i < n * n; i++) {
      let r: number, g: number, b: number;
      if (s.display === 'channel') [r, g, b] = ramp(ch[i]);
      else {
        // Coverage as cloud over a dark sky, tinted by top type: blue-grey stratus, neutral stratocumulus, warm cumulus.
        const a = Math.min(cov[i] / 0.75, 1), t = type[i], lo = t < 0.5 ? STRATUS : STRATOCU, hi = t < 0.5 ? STRATOCU : CUMULUS, u = t < 0.5 ? t * 2 : t * 2 - 1;
        r = SKY[0] + (lo[0] + (hi[0] - lo[0]) * u - SKY[0]) * a; g = SKY[1] + (lo[1] + (hi[1] - lo[1]) * u - SKY[1]) * a; b = SKY[2] + (lo[2] + (hi[2] - lo[2]) * u - SKY[2]) * a;
      }
      if (s.contour) {
        const x = i % n, y = (i - x) / n, here = cov[i] >= thr;
        if (here !== (cov[y * n + ((x + 1) % n)] >= thr) || here !== (cov[((y + 1) % n) * n + x] >= thr)) { r = 255; g = 176; b = 64; }
      }
      if (s.influenceMode && s.display === 'composite') { const m = f.data.influence[i]; if (m > 0.02) { r = r * (1 - 0.35 * m) + 255 * 0.35 * m; g = g * (1 - 0.35 * m) + 60 * 0.35 * m; b = b * (1 - 0.35 * m) + 200 * 0.35 * m; } }
      px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
    }
    this.mapCanvas.getContext('2d')!.putImageData(this.mapImage, 0, 0);
    this.dirtyMap = false;
  }

  /** The status line for a cursor at map pixel p (world position, the channels under it). */
  statusAt(p: [number, number] | null): string {
    const f = this.fields;
    if (!f || !p) return f ? 'left-drag paints · alt-click picks · right-click: camera here' : ' ';
    const [ox, oz] = this.drift(), [wx, wz] = mapToWorld(p[0], p[1], f.n, this.tile());
    const x = Math.floor(p[0]), y = Math.floor(p[1]), [lb, lt] = this.layer(), m = (v: number) => Math.round(lb + v * (lt - lb));
    return `x ${((wx + ox) / 1000).toFixed(2)} km  z ${((wz + oz) / 1000).toFixed(2)} km (${Math.abs((wz + oz) / 1000).toFixed(1)} ${wz + oz <= 0 ? 'N' : 'S'})\n`
      + `coverage ${f.at('coverage', x, y).toFixed(2)}  top ${f.at('topType', x, y).toFixed(2)}  bottom ${f.at('bottomType', x, y).toFixed(2)}\n`
      + `heights ${m(f.at('minHeight', x, y))}-${m(f.at('maxHeight', x, y))} m${paint.getState().influenceMode ? `  influence ${f.at('influence', x, y).toFixed(2)}` : ''}`;
  }
}

let engine: PaintEngine | null = null;
/** One engine per page (StrictMode and Fast Refresh remount the dock; the painting and its history stay). */
export function getEngine(host: PaintHost): PaintEngine {
  engine ??= new PaintEngine(host);
  (window as unknown as { __paint?: unknown }).__paint = { engine, store: paint };   // scripting hook (captures, console)
  return engine;
}
export const currentEngine = () => engine;
export type { Tool };
