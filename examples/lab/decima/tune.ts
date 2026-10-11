// Tuning panel for the Decima parity page: every runtime setting and the frame's scene values as live dials, for tuning by hand.
// Edits apply to the running render immediately. Presets save to this browser (localStorage) and export / import as JSON files.
// A preset stores the bookmark, the look, the scene values and only the settings that differ from the bookmark's own starting values,
// so it reapplies cleanly on top of later code changes. Open it with the "tune" button or the T key.
import runtimeSource from '../../../packages/runtime/src/runtime.ts?raw';

export interface TuneScene {
  sunElevation: number; sunAzimuth: number; exposure: number; turbidity: number; miePhaseG: number;
  sunColor: [number, number, number]; sunTint: [number, number, number]; ambientTint: [number, number, number]; skyFactor: [number, number, number];
  postMode: number; dither: number;
}

export interface TuneHost {
  settings: Record<string, unknown>;
  /** Called after a setting changes (the page resets the temporal history so the change shows at once). */
  onSettingChange(key: string): void;
  /** Applies one scene value to the sky, the bridge or the post chain. */
  applyScene(scene: TuneScene): void;
  bookmark(): string;
  look(): string;
  loadBookmark(name: string): void;
}

interface Preset { bookmark: string; look: string; scene: TuneScene; settings: Record<string, unknown>; savedAt: string; note?: string }

const STORE = 'decima-tune-presets';
const SKIP = new Set(['lightning']);

// The doc comment above each CloudSettings field, shown as the row's tooltip.
const docs = (() => {
  const out: Record<string, string> = {};
  const block = runtimeSource.slice(runtimeSource.indexOf('export interface CloudSettings'));
  const end = block.indexOf('\n}');
  const re = /\/\*\*([\s\S]*?)\*\/\s*(\w+)\??:/g;
  for (const m of block.slice(0, end).matchAll(re)) out[m[2]] = m[1].replace(/\n\s*\*\s?/g, ' ').trim();
  return out;
})();

const css = `
#tune{position:fixed;left:8px;top:64px;bottom:8px;width:380px;max-width:calc(100vw - 16px);display:none;flex-direction:column;background:#0b0f15ee;border:1px solid #333;border-radius:4px;font:12px/1.35 ui-monospace,Menlo,monospace;color:#e6e6e6;z-index:10}
#tune.open{display:flex}
#tune header{display:grid;gap:6px;padding:8px;border-bottom:1px solid #333}
#tune header .row{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
#tune input[type=text],#tune input[type=number],#tune select{font:inherit;background:#161c25;color:#fff;border:1px solid #444;border-radius:3px;padding:2px 4px;min-width:0}
#tune button{font:inherit;background:#222;color:#fff;border:1px solid #555;border-radius:3px;padding:2px 6px;cursor:pointer}
#tune button:hover{background:#2c3a4a}
#tune .body{overflow:auto;padding:4px 8px 12px}
#tune h4{margin:10px 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8fb0dd;cursor:pointer;user-select:none}
#tune .item{display:grid;grid-template-columns:140px 1fr 74px 18px;gap:6px;align-items:center;padding:2px 0}
#tune .item.vec{grid-template-columns:140px 1fr 18px}
#tune .item .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#tune .item.changed .name{color:#f0b85a}
#tune .item input[type=range]{width:100%;min-width:0}
#tune .item .vecs{display:flex;gap:3px;min-width:0}
#tune .item .vecs input{width:100%}
#tune .item .reset{background:none;border:none;color:#777;padding:0;cursor:pointer}
#tune .item .reset:hover{color:#fff}
#tune .presets{display:grid;gap:3px;max-height:120px;overflow:auto}
#tune .presets .p{display:flex;gap:4px;align-items:center}
#tune .presets .p span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#tune .msg{color:#8fb0dd;min-height:1em}
`;

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(3) : v.toPrecision(3));
const stepOf = (v: number) => { const a = Math.abs(v); return a === 0 ? 0.001 : a >= 100 ? 1 : a >= 10 ? 0.1 : a >= 1 ? 0.01 : a >= 0.1 ? 0.001 : 0.0001; };
const rangeOf = (v: number): [number, number] => {
  const a = Math.abs(v);
  if (Number.isInteger(v) && a <= 4) return [Math.min(-1, v), 4];
  const hi = a === 0 ? 1 : a * 4;
  return [v < 0 ? -hi : 0, hi];
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function createTuner(host: TuneHost) {
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'tune'; document.body.appendChild(root);
  let base: Record<string, unknown> = {};          // the bookmark's starting settings (look + scene settings), for "changed" and reset
  let sceneBase: TuneScene | null = null;
  let scene: TuneScene | null = null;
  let filter = '';
  let changedOnly = false;
  let carry = true;
  let edits: Record<string, unknown> = {};          // the settings the user changed by hand (carried across shots)
  const collapsed = new Set<string>();

  root.innerHTML = `<header>
    <div class="row"><b style="flex:1">Tune</b><span class="msg"></span><button data-a="close">close (T)</button></div>
    <div class="row"><input type="text" placeholder="filter settings…" data-a="filter" style="flex:1"><label><input type="checkbox" data-a="changed"> changed only</label></div>
    <div class="row"><label title="When you switch shots, re-apply your changed settings on top of the new shot (scene values stay per shot)"><input type="checkbox" data-a="carry" checked> keep my setting changes when switching shots</label></div>
    <div class="row"><input type="text" placeholder="preset name" data-a="name" style="flex:1"><button data-a="save">save</button><button data-a="export">export</button><button data-a="import">import</button><button data-a="resetall">reset all</button></div>
    <div class="presets"></div>
    <input type="file" accept="application/json" data-a="file" hidden>
  </header><div class="body"></div>`;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const body = $('.body'), msg = $('.msg'), presetsEl = $('.presets');
  const say = (t: string) => { msg.textContent = t; setTimeout(() => { if (msg.textContent === t) msg.textContent = ''; }, 2500); };

  const loadStore = (): Record<string, Preset> => { try { return JSON.parse(localStorage.getItem(STORE) ?? '{}'); } catch { return {}; } };
  const saveStore = (s: Record<string, Preset>) => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { say('could not save to this browser'); } };

  const snapshot = (): Preset => {
    const diff: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(host.settings)) {
      if (SKIP.has(k) || (typeof v === 'object' && !Array.isArray(v))) continue;
      if (!same(v, base[k])) diff[k] = clone(v);
    }
    return { bookmark: host.bookmark(), look: host.look(), scene: clone(scene!), settings: diff, savedAt: new Date().toISOString() };
  };
  const apply = (p: Preset) => {
    edits = clone(p.settings);
    if (p.bookmark && p.bookmark !== host.bookmark()) host.loadBookmark(p.bookmark);
    else for (const [k, v] of Object.entries(base)) host.settings[k] = clone(v);   // same shot: start from the shot, then the preset
    for (const [k, v] of Object.entries(p.settings)) if (k in host.settings) host.settings[k] = clone(v);
    if (p.scene) { scene = { ...scene!, ...clone(p.scene) }; host.applyScene(scene); }
    host.onSettingChange('*');
    render();
  };

  const renderPresets = () => {
    const store = loadStore();
    presetsEl.innerHTML = '';
    for (const [name, p] of Object.entries(store).sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt))) {
      const row = document.createElement('div'); row.className = 'p';
      const label = document.createElement('span'); label.textContent = `${name}  ·  ${p.bookmark}  ·  ${Object.keys(p.settings).length} changed`; label.title = p.savedAt;
      const load = document.createElement('button'); load.textContent = 'load'; load.onclick = () => { apply(p); say(`loaded ${name}`); };
      const del = document.createElement('button'); del.textContent = '×'; del.title = 'delete'; del.onclick = () => { const s = loadStore(); delete s[name]; saveStore(s); renderPresets(); };
      row.append(label, load, del); presetsEl.appendChild(row);
    }
  };

  const numberRow = (name: string, get: () => number, set: (v: number) => void, baseVal: number | undefined, tip?: string) => {
    const row = document.createElement('div'); row.className = 'item';
    const v0 = get();
    const label = document.createElement('span'); label.className = 'name'; label.textContent = name; label.title = tip ? `${name}: ${tip}` : name;
    const [lo, hi] = rangeOf(baseVal ?? v0);
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = String(Math.min(lo, v0)); slider.max = String(Math.max(hi, v0)); slider.step = String(stepOf(baseVal ?? v0) / 10 || 0.0001); slider.value = String(v0);
    const box = document.createElement('input'); box.type = 'number'; box.step = String(stepOf(v0)); box.value = fmt(v0);
    const reset = document.createElement('button'); reset.className = 'reset'; reset.textContent = '↺'; reset.title = 'back to the bookmark value';
    const mark = () => row.classList.toggle('changed', baseVal !== undefined && Math.abs(get() - baseVal) > 1e-9);
    const commit = (v: number) => { if (!Number.isFinite(v)) return; set(v); slider.value = String(v); box.value = fmt(v); mark(); };
    slider.oninput = () => commit(Number(slider.value));
    box.onchange = () => { const v = Number(box.value); if (v > Number(slider.max)) slider.max = String(v * 2); if (v < Number(slider.min)) slider.min = String(v * 2); commit(v); };
    reset.onclick = () => { if (baseVal !== undefined) commit(baseVal); };
    mark(); row.append(label, slider, box, reset);
    return row;
  };
  const vecRow = (name: string, get: () => number[], set: (v: number[]) => void, baseVal: number[] | undefined, tip?: string) => {
    const row = document.createElement('div'); row.className = 'item vec';
    const label = document.createElement('span'); label.className = 'name'; label.textContent = name; label.title = tip ? `${name}: ${tip}` : name;
    const wrap = document.createElement('div'); wrap.className = 'vecs';
    const reset = document.createElement('button'); reset.className = 'reset'; reset.textContent = '↺';
    const mark = () => row.classList.toggle('changed', !!baseVal && !same(get(), baseVal));
    const boxes = get().map((x, i) => {
      const b = document.createElement('input'); b.type = 'number'; b.step = String(stepOf(x)); b.value = fmt(x);
      b.onchange = () => { const v = [...get()]; v[i] = Number(b.value); set(v); mark(); };
      wrap.appendChild(b); return b;
    });
    reset.onclick = () => { if (!baseVal) return; set([...baseVal]); boxes.forEach((b, i) => { b.value = fmt(baseVal[i]); }); mark(); };
    mark(); row.append(label, wrap, reset);
    return row;
  };
  const otherRow = (name: string, value: unknown, set: (v: unknown) => void, baseVal: unknown, tip?: string) => {
    const row = document.createElement('div'); row.className = 'item vec';
    const label = document.createElement('span'); label.className = 'name'; label.textContent = name; label.title = tip ? `${name}: ${tip}` : name;
    const input = document.createElement('input');
    if (typeof value === 'boolean') { input.type = 'checkbox'; input.checked = value; input.onchange = () => { set(input.checked); mark(); }; }
    else { input.type = 'text'; input.value = String(value); input.onchange = () => { set(input.value); mark(); }; }
    const reset = document.createElement('button'); reset.className = 'reset'; reset.textContent = '↺';
    const mark = () => row.classList.toggle('changed', !same(typeof value === 'boolean' ? input.checked : input.value, baseVal));
    reset.onclick = () => { set(baseVal); if (typeof baseVal === 'boolean') input.checked = baseVal; else input.value = String(baseVal); mark(); };
    mark(); row.append(label, input, reset);
    return row;
  };

  const section = (title: string, rows: HTMLElement[]) => {
    if (!rows.length) return;
    const h = document.createElement('h4'); h.textContent = `${collapsed.has(title) ? '▸' : '▾'} ${title} (${rows.length})`;
    h.onclick = () => { collapsed.has(title) ? collapsed.delete(title) : collapsed.add(title); render(); };
    body.appendChild(h);
    if (!collapsed.has(title)) for (const r of rows) body.appendChild(r);
  };
  const keep = (name: string, row: HTMLElement) => (!filter || name.toLowerCase().includes(filter)) && (!changedOnly || row.classList.contains('changed'));

  function render() {
    if (!root.classList.contains('open')) return;
    body.innerHTML = '';
    if (scene && sceneBase) {
      const sb = sceneBase, s = scene;
      const push = () => host.applyScene(s);
      const sceneRows: [string, HTMLElement][] = [
        ['sunElevation', numberRow('sunElevation', () => s.sunElevation, v => { s.sunElevation = v; push(); }, sb.sunElevation, 'Sun elevation in degrees above the horizon.')],
        ['sunAzimuth', numberRow('sunAzimuth', () => s.sunAzimuth, v => { s.sunAzimuth = v; push(); }, sb.sunAzimuth, 'Sun azimuth in degrees (the sky convention, north = -Z).')],
        ['exposure', numberRow('exposure', () => s.exposure, v => { s.exposure = v; push(); }, sb.exposure, 'Exposure before the tone curve.')],
        ['turbidity', numberRow('turbidity', () => s.turbidity, v => { s.turbidity = v; push(); }, sb.turbidity, 'Haze amount of the physical sky.')],
        ['miePhaseG', numberRow('miePhaseG', () => s.miePhaseG, v => { s.miePhaseG = v; push(); }, sb.miePhaseG, 'Forward scattering of the haze: the size of the glow around the sun.')],
        ['postMode', numberRow('postMode', () => s.postMode, v => { s.postMode = Math.round(v); push(); }, sb.postMode, '0 = ACES filmic, 1 = linear, 2 = the fitted Decima curve.')],
        ['dither', numberRow('dither', () => s.dither, v => { s.dither = v; push(); }, sb.dither, 'Output dither before 8-bit (1 = on).')],
        ['sunColor', vecRow('sunColor', () => s.sunColor, v => { s.sunColor = v as TuneScene['sunColor']; push(); }, sb.sunColor, 'Sun colour for sky and clouds (linear RGB).')],
        ['sunTint', vecRow('sunTint', () => s.sunTint, v => { s.sunTint = v as TuneScene['sunTint']; push(); }, sb.sunTint, 'Extra tint of the sun the clouds see; the sky is untouched (the round-12 pink).')],
        ['ambientTint', vecRow('ambientTint', () => s.ambientTint, v => { s.ambientTint = v as TuneScene['ambientTint']; push(); }, sb.ambientTint, 'Tint of the sky light the clouds see; the sky is untouched.')],
        ['skyFactor', vecRow('skyFactor', () => s.skyFactor, v => { s.skyFactor = v as TuneScene['skyFactor']; push(); }, sb.skyFactor, 'Per-channel sky brightness (sky and the clouds\' ambient).')],
      ];
      section('scene', sceneRows.filter(([n, r]) => keep(n, r)).map(([, r]) => r));
    }
    const settingRows: [string, HTMLElement][] = [];
    for (const key of Object.keys(host.settings).sort((a, b) => a.localeCompare(b))) {
      if (SKIP.has(key)) continue;
      const v = host.settings[key], b = base[key], tip = docs[key];
      const set = (x: unknown) => { host.settings[key] = x; if (same(x, b)) delete edits[key]; else edits[key] = clone(x); host.onSettingChange(key); };
      if (typeof v === 'number') settingRows.push([key, numberRow(key, () => host.settings[key] as number, set, typeof b === 'number' ? b : undefined, tip)]);
      else if (Array.isArray(v) && v.every(x => typeof x === 'number')) settingRows.push([key, vecRow(key, () => host.settings[key] as number[], set, Array.isArray(b) ? (b as number[]) : undefined, tip)]);
      else if (typeof v === 'boolean' || typeof v === 'string') settingRows.push([key, otherRow(key, v, set, b, tip)]);
    }
    section('runtime settings', settingRows.filter(([n, r]) => keep(n, r)).map(([, r]) => r));
  }

  root.addEventListener('input', e => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.a === 'filter') { filter = t.value.trim().toLowerCase(); render(); }
  });
  root.addEventListener('change', e => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.a === 'changed') { changedOnly = t.checked; render(); }
    if (t.dataset.a === 'carry') carry = t.checked;
    if (t.dataset.a === 'file' && t.files?.[0]) {
      t.files[0].text().then(txt => {
        const data = JSON.parse(txt);
        const list: Record<string, Preset> = data.bookmark ? { [t.files![0].name.replace(/\.json$/, '')]: data } : data;
        const store = loadStore(); Object.assign(store, list); saveStore(store); renderPresets();
        const first = Object.values(list)[0]; if (first) apply(first);
        say(`imported ${Object.keys(list).length}`);
      }).catch(() => say('not a preset file')).finally(() => { t.value = ''; });
    }
  });
  root.addEventListener('click', e => {
    const a = (e.target as HTMLElement).dataset.a;
    if (a === 'close') toggle(false);
    if (a === 'save') {
      const nameEl = $<HTMLInputElement>('[data-a=name]');
      const name = nameEl.value.trim() || `${host.bookmark()} ${new Date().toLocaleTimeString()}`;
      const store = loadStore(); store[name] = snapshot(); saveStore(store); renderPresets(); say(`saved ${name}`);
    }
    if (a === 'export') {
      const name = $<HTMLInputElement>('[data-a=name]').value.trim() || host.bookmark();
      const blob = new Blob([JSON.stringify({ ...snapshot(), note: name }, null, 2)], { type: 'application/json' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${name.replace(/[^\w.-]+/g, '_')}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
    if (a === 'import') $<HTMLInputElement>('[data-a=file]').click();
    if (a === 'resetall') {
      for (const [k, v] of Object.entries(base)) host.settings[k] = clone(v);
      edits = {};
      if (sceneBase) { scene = clone(sceneBase); host.applyScene(scene); }
      host.onSettingChange('*'); render(); say('back to the bookmark');
    }
  });

  const toggle = (open = !root.classList.contains('open')) => { root.classList.toggle('open', open); render(); };
  addEventListener('keydown', e => { if (e.key === 't' && !(e.target instanceof HTMLInputElement)) toggle(); });
  renderPresets();

  return {
    toggle,
    /** Called by the page after each bookmark: the new starting point for "changed" and reset. */
    sync(sceneNow: TuneScene) {
      const carried = carry ? edits : {};
      base = clone(Object.fromEntries(Object.entries(host.settings).filter(([k]) => !SKIP.has(k))));
      sceneBase = clone(sceneNow); scene = clone(sceneNow);
      for (const [k, v] of Object.entries(carried)) if (k in host.settings) host.settings[k] = clone(v);
      if (Object.keys(carried).length) host.onSettingChange('*');
      render();
    },
    /** The current state as a preset, for scripts and captures (window.__tune.snapshot()). */
    snapshot,
    apply,
  };
}
