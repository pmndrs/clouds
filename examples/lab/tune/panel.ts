// Shared tuning panel for the lab benches (Tweakpane): the Decima parity bench (decima/tune.ts) and the HZD bench (hzd/tune.ts) build on it.
// What lives here is the generic part: the panel and its styles, the (i) / reset / amber "changed" decoration of every control, the filter that
// opens matching groups, "changed only", presets saved in this browser and exported / imported as JSON, and the control picker for a settings
// object (numbers get a slider sized from the value, string unions and numeric modes get dropdowns, on/off switches get dropdowns, arrays get
// point controls). Each bench keeps its own groups, docs, scene values and preset contents. T toggles the panel.
import { Pane, type FolderApi } from 'tweakpane';
import type { BindingApi } from '@tweakpane/core';

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The text of `export interface <name>` (or any marker) up to its closing brace. */
export const interfaceBlock = (source: string, marker: string) => { const b = source.slice(source.indexOf(marker)); return b.slice(0, b.indexOf('\n}')); };

/**
 * What each field does, from its doc comment in an interface block. By default only the field right after a comment gets it (the Decima
 * bench's reading). `inherit` also gives it to the fields that follow on their own lines without a comment of their own, as in
 * `/** Shell base altitude and thickness. *\/ altitude: number; thickness: number;`.
 */
export function parseDocs(block: string, options: { inherit?: boolean } = {}): Record<string, string> {
  const docs: Record<string, string> = {};
  if (!options.inherit) {
    for (const m of block.matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/\s*(\w+)\??:/g)) docs[m[2]] = m[1].replace(/\n\s*\*\s?/g, ' ').trim();
    return docs;
  }
  let doc = '';
  for (const m of block.matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/|^\s*(\w+)\??:/gm)) {
    if (m[1] !== undefined) doc = m[1].replace(/\n\s*\*\s?/g, ' ').trim();
    else if (doc) docs[m[2]] = doc;
  }
  return docs;
}

/** String settings' choices from their union type in an interface block (`key: 'a' | 'b';`). */
export function parseUnions(block: string): Record<string, string[]> {
  const unions: Record<string, string[]> = {};
  for (const m of block.matchAll(/^\s+(\w+)\??:\s*('[^']+'(?:\s*\|\s*'[^']+')+);/gm)) unions[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]);
  return unions;
}

/** A slider range guessed from the starting value (0..1 when the doc says so); undefined = a plain number field. */
export const rangeOf = (doc: string | undefined, v: number): { min: number; max: number } | undefined => {
  if (/\b0\.\.1\b/.test(doc ?? '') && v >= 0 && v <= 1) return { min: 0, max: 1 };
  if (v === 0) return undefined;   // no scale to guess from: a plain number field (drag or type), unclamped
  const hi = Math.abs(v) * 4;
  return { min: v < 0 ? -hi : 0, max: hi };
};
export const stepOf = (v: number) => { const a = Math.abs(v); return a === 0 ? 0.001 : a >= 100 ? 1 : a >= 10 ? 0.1 : a >= 1 ? 0.01 : a >= 0.1 ? 0.001 : 0.0001; };

const AXES = ['x', 'y', 'z', 'w'] as const;
/** A Tweakpane point value over a 2..4-array, held in { v } (Tweakpane binds an object's property); the array stays the source of truth. */
export const vecHolder = (get: () => number[], set: (v: number[]) => void, n = 3) => {
  const v = {} as Record<string, number>;
  for (let i = 0; i < n; i++) Object.defineProperty(v, AXES[i], { enumerable: true, get: () => get()[i], set: (x: number) => { const a = [...get()]; a[i] = x; set(a); } });
  return { v };
};

export interface TuneEntry {
  key: string;
  api: BindingApi;
  value(): unknown;
  base(): unknown;
  reset(): void;
  doc?: string;
  docEl?: HTMLElement;
  folder?: FolderApi;
}

export interface Preset { savedAt: string; note?: string }

export interface TunePanelOptions<P extends Preset> {
  /** Panel title and the localStorage key its presets live under. */
  title: string;
  storeKey: string;
  /** A "keep changes across ..." switch in the tools (read it from `ui.carry`); omitted = none. */
  carryLabel?: string;
  /** The reset button's tooltip (each control) and the "reset everything" button's title. */
  resetTip: string;
  resetAllTitle: string;
  /** Presets: the current state, putting one back, putting the starting state back, and their names and labels. */
  snapshot(): P;
  apply(p: P): void;
  resetAll(): void;
  /** Name for a preset saved without one, and for an exported file. */
  defaultName(): string;
  exportName(): string;
  presetLabel(name: string, p: P): string;
  /** Tells a single exported preset from a file of several (name -> preset). */
  isPreset(data: unknown): boolean;
  /** Extra tool buttons, added after "reset everything" (e.g. "copy link with these settings"). */
  extraTools?(tools: FolderApi, say: (text: string) => void): void;
}

const css = `
#tune{position:fixed;left:8px;top:var(--tune-top,96px);bottom:8px;width:400px;max-width:calc(100vw - 16px);display:none;overflow:auto;z-index:10;border-radius:6px}
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

/** How `bindSetting` turns a settings field into a control. */
export interface SettingControl {
  /** The starting value (amber name and reset compare against it). */
  base(): unknown;
  doc?: string;
  /** Choices of a string field (from its union type). */
  union?: string[];
  /** A number that is really a mode: label -> value. */
  mode?: Record<string, number>;
  /** A number that is really an on/off switch (0 / 1). */
  switch?: boolean;
  /** Booleans as an off / on dropdown instead of a checkbox. */
  boolDropdown?: boolean;
  /** Fixed slider range and step (instead of the guess from the starting value). */
  range?: { min?: number; max?: number; step?: number };
  /** After the value changed (from the control or a reset). */
  onChange(): void;
}

export function createTunePanel<P extends Preset>(opts: TunePanelOptions<P>) {
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'tune'; document.body.appendChild(root);
  const pane = new Pane({ container: root, title: opts.title });

  const ui = { filter: '', changedOnly: false, carry: true, name: '' };
  const entries: TuneEntry[] = [];
  const msgEl = document.createElement('div'); msgEl.className = 'msg';
  const say = (t: string) => { msgEl.textContent = t; setTimeout(() => { if (msgEl.textContent === t) msgEl.textContent = ''; }, 2500); };

  const mark = (e: TuneEntry) => e.api.element.classList.toggle('changed', e.base() !== undefined && !same(e.value(), e.base()));
  const markAll = () => entries.forEach(mark);
  const applyFilter = () => {
    const q = ui.filter.trim().toLowerCase();
    for (const e of entries) {
      const text = `${e.key} ${e.doc ?? ''}`.toLowerCase();
      e.api.hidden = (!!q && !text.includes(q)) || (ui.changedOnly && !e.api.element.classList.contains('changed'));
      if (e.api.hidden && e.docEl) { e.docEl.remove(); e.docEl = undefined; }
    }
    // While filtering, open every group that has a match.
    if (q || ui.changedOnly) for (const e of entries) if (!e.api.hidden && e.folder) e.folder.expanded = true;
  };
  const refresh = () => { pane.refresh(); markAll(); applyFilter(); };

  // The (i) and reset buttons go into the control's label; the doc opens under the control.
  const decorate = (e: TuneEntry) => {
    const label = e.api.element.querySelector('.tp-lblv_l') as HTMLElement | null;
    if (!label) return;
    const name = document.createElement('span'); name.className = 'nm'; name.textContent = label.textContent ?? e.key; name.title = e.key;
    label.textContent = ''; label.append(name);
    const doc = e.doc;
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
    const rb = document.createElement('button'); rb.className = 'rb'; rb.textContent = '↺'; rb.title = opts.resetTip;
    rb.onclick = ev => { ev.stopPropagation(); e.reset(); };
    label.append(rb);
  };
  /** Registers a control: decorates it, and marks it changed on every edit. */
  const add = (folder: FolderApi, e: TuneEntry) => {
    e.api.on('change', () => mark(e));
    e.folder = folder; decorate(e); entries.push(e);
    return e;
  };
  /** A group's one-line explanation, at the top of the folder. */
  const about = (folder: FolderApi, text: string) => {
    const div = document.createElement('div'); div.className = 'about'; div.textContent = text;
    folder.element.querySelector('.tp-fldv_c')?.prepend(div);
  };
  const addGroup = (title: string, text: string, expanded = false) => { const f = pane.addFolder({ title, expanded }); about(f, text); return f; };

  // --- Presets and tools ---
  const tools = pane.addFolder({ title: 'Presets and tools', expanded: true });
  tools.addBinding(ui, 'filter', { label: 'filter' }).on('change', applyFilter);
  tools.addBinding(ui, 'changedOnly', { label: 'changed only' }).on('change', applyFilter);
  if (opts.carryLabel) tools.addBinding(ui, 'carry', { label: opts.carryLabel });
  tools.addBinding(ui, 'name', { label: 'preset name' });
  const presetsEl = document.createElement('div'); presetsEl.className = 'presets';
  const loadStore = (): Record<string, P> => { try { return JSON.parse(localStorage.getItem(opts.storeKey) ?? '{}'); } catch { return {}; } };
  const saveStore = (s: Record<string, P>) => { try { localStorage.setItem(opts.storeKey, JSON.stringify(s)); } catch { say('could not save to this browser'); } };
  const renderPresets = () => {
    presetsEl.innerHTML = '';
    for (const [name, p] of Object.entries(loadStore()).sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt))) {
      const row = document.createElement('div'); row.className = 'p';
      const label = document.createElement('span'); label.textContent = opts.presetLabel(name, p); label.title = p.savedAt;
      const load = document.createElement('button'); load.textContent = 'load'; load.onclick = () => { opts.apply(p); say(`loaded ${name}`); };
      const del = document.createElement('button'); del.textContent = '×'; del.title = 'delete'; del.onclick = () => { const s = loadStore(); delete s[name]; saveStore(s); renderPresets(); };
      row.append(label, load, del); presetsEl.appendChild(row);
    }
  };
  tools.addButton({ title: 'save preset' }).on('click', () => {
    const name = ui.name.trim() || opts.defaultName();
    const s = loadStore(); s[name] = opts.snapshot(); saveStore(s); renderPresets(); say(`saved ${name}`);
  });
  tools.addButton({ title: 'export preset (JSON file)' }).on('click', () => {
    const name = ui.name.trim() || opts.exportName();
    const blob = new Blob([JSON.stringify({ ...opts.snapshot(), note: name }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${name.replace(/[^\w.-]+/g, '_')}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'application/json'; file.hidden = true; root.appendChild(file);
  file.onchange = () => {
    const f = file.files?.[0]; if (!f) return;
    f.text().then(txt => {
      const data = JSON.parse(txt);
      const list: Record<string, P> = opts.isPreset(data) ? { [f.name.replace(/\.json$/, '')]: data } : data;
      const s = loadStore(); Object.assign(s, list); saveStore(s); renderPresets();
      const first = Object.values(list)[0]; if (first) opts.apply(first);
      say(`imported ${Object.keys(list).length}`);
    }).catch(() => say('not a preset file')).finally(() => { file.value = ''; });
  };
  tools.addButton({ title: 'import preset (JSON file)' }).on('click', () => file.click());
  tools.addButton({ title: opts.resetAllTitle }).on('click', () => opts.resetAll());
  opts.extraTools?.(tools, say);
  tools.element.querySelector('.tp-fldv_c')!.append(msgEl, presetsEl);

  /** A control for one field of a settings object, picked from its value (see SettingControl). Returns undefined for values it cannot show. */
  const bindSetting = (folder: FolderApi, target: Record<string, unknown>, key: string, c: SettingControl): TuneEntry | undefined => {
    const v = target[key];
    let api: BindingApi;
    if (Array.isArray(v)) {
      if (v.length < 2 || v.length > 4 || v.some(x => typeof x !== 'number')) return undefined;
      api = folder.addBinding(vecHolder(() => target[key] as number[], nv => { target[key] = nv; c.onChange(); }, v.length), 'v', { label: key });
    } else if (typeof v === 'string') {
      api = folder.addBinding(target, key, c.union ? { label: key, options: Object.fromEntries(c.union.map(o => [o, o])) } : { label: key });
      api.on('change', c.onChange);
    } else if (typeof v === 'boolean') {
      api = folder.addBinding(target, key, c.boolDropdown ? { label: key, options: { off: false, on: true } } : { label: key }); api.on('change', c.onChange);
    } else if (typeof v === 'number') {
      const b = (c.base() as number) ?? v;
      const options = c.mode ?? (c.switch ? { off: 0, on: 1 } : undefined);
      if (options) {
        api = folder.addBinding(target, key, { label: key, options });
      } else {
        // FX1: a slider clamps (and steps) the value it reads on every refresh and writes the clamped value back. A value set outside the slider's
        // range from elsewhere (the Review section, the URL, the console) was silently pulled back to the range's end (LH1's 1 became 0.6, the
        // guessed max 4 x 0.15). The binding goes through a holder that ignores those write-backs: only a real move of the slider changes the setting.
        const o = { label: key, ...(rangeOf(c.doc, b) ?? {}), step: stepOf(b), ...(c.range ?? {}) } as { min?: number; max?: number; step: number };
        const holder = {} as Record<string, number>;
        Object.defineProperty(holder, 'v', {
          enumerable: true,
          get: () => target[key] as number,
          set: (x: number) => {
            const cur = target[key] as number;
            const clamped = Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, cur));
            if (Math.abs(x - clamped) <= o.step * 0.5 + 1e-9) return;   // the slider's own clamp / step of the current value, not a user move
            target[key] = x;
          },
        });
        api = folder.addBinding(holder, 'v', o);
      }
      api.on('change', c.onChange);
    } else return undefined;
    return add(folder, {
      key, api, doc: c.doc, value: () => target[key], base: c.base,
      reset: () => { target[key] = clone(c.base()); c.onChange(); refresh(); },
    });
  };

  const toggle = (open = !root.classList.contains('open')) => { root.classList.toggle('open', open); };
  addEventListener('keydown', e => { if (e.key === 't' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement)) toggle(); });
  renderPresets();

  return { pane, root, ui, entries, say, mark, refresh, applyFilter, add, about, addGroup, bindSetting, toggle, renderPresets };
}
export type TunePanel = ReturnType<typeof createTunePanel>;
