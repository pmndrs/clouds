// Photo browser for the compare page (T2): a thumbnail drawer over the owner's cloud photos, served by photos-plugin.ts (dev server only).
// Filter by folder, remembers the last photo (localStorage), and can record a sun elevation per photo (sun-presets.json in the photos dir, not committed).
// Keys: O toggles the drawer, , and . step to the previous / next photo in the current filter.
import type { PhotoPane } from './photo';
import { photoUrl } from './photo';

interface Item { folder: string; file: string; path: string; grade?: string; time?: string; notes?: string; sun?: { sunEl: number; sunAz?: number } }
const KEY = 'compare.photo.last';

export async function addPhotoPicker(bar: HTMLElement, photo: PhotoPane, view: { sunEl: number; sunAz: number }, onSun: () => void, opts: { loadLast: boolean }) {
  const btn = document.createElement('button'); btn.textContent = 'photos (O)'; bar.appendChild(btn);
  let data: { items: Item[] };
  try { data = await (await fetch('/__photos/index.json')).json(); if (!Array.isArray(data.items)) throw new Error(JSON.stringify(data)); }
  catch (e) { btn.textContent = 'photos: unavailable'; btn.title = String(e); return; }
  const items = data.items;
  const folders = ['all', ...new Set(items.map(i => i.folder))];
  const drawer = document.createElement('div'); drawer.className = 'drawer hidden';
  const head = document.createElement('div'); head.className = 'drawerhead';
  const sel = document.createElement('select'); folders.forEach(f => sel.add(new Option(f === 'all' ? `all (${items.length})` : `${f} (${items.filter(i => i.folder === f).length})`, f)));
  const follow = document.createElement('label'); const fc = document.createElement('input'); fc.type = 'checkbox'; fc.checked = true; follow.append(fc, 'use saved sun');
  const save = document.createElement('button'); save.textContent = 'save sun for this photo';
  const grid = document.createElement('div'); grid.className = 'grid';
  head.append(sel, follow, save); drawer.append(head, grid); document.body.appendChild(drawer);
  let current: Item | null = null, shown: Item[] = [];
  const idOf = (i: Item) => `${i.folder}/${i.file}`;
  const thumbs = new Map<string, HTMLElement>();

  const pick = async (it: Item, applySun = true) => {
    current = it;
    try { localStorage.setItem(KEY, idOf(it)); } catch { /* storage unavailable */ }
    thumbs.forEach((el, k) => el.classList.toggle('on', k === idOf(it)));
    await photo.setUrl(photoUrl(it.path), `${it.folder}/${it.file}${it.grade ? `  ${it.grade}` : ''}${it.time ? `  ${it.time}` : ''}${it.sun ? `  sun ${it.sun.sunEl}°` : ''}`);
    if (applySun && fc.checked && it.sun) { view.sunEl = it.sun.sunEl; if (it.sun.sunAz != null) view.sunAz = it.sun.sunAz; onSun(); }
  };
  const render = () => {
    shown = items.filter(i => sel.value === 'all' || i.folder === sel.value);
    grid.replaceChildren(); thumbs.clear();
    for (const it of shown) {
      const d = document.createElement('div'); d.className = 'thumb'; d.title = `${it.folder}/${it.file}\n${it.notes ?? ''}`;
      const img = document.createElement('img'); img.loading = 'lazy'; img.decoding = 'async'; img.src = photoUrl(it.path);
      const cap = document.createElement('span'); cap.textContent = `${it.grade ?? ''} ${it.sun ? `☀${it.sun.sunEl}°` : ''}`;
      d.append(img, cap); d.onclick = () => void pick(it); grid.appendChild(d); thumbs.set(idOf(it), d);
      if (current && idOf(it) === idOf(current)) d.classList.add('on');
    }
  };
  sel.onchange = render;
  save.onclick = async () => {
    if (!current) return;
    const r = await fetch('/__photos/sun', { method: 'POST', body: JSON.stringify({ folder: current.folder, file: current.file, sunEl: view.sunEl, sunAz: Math.round(view.sunAz) }) });
    if (r.ok) { current.sun = { sunEl: view.sunEl, sunAz: Math.round(view.sunAz) }; save.textContent = `saved ${view.sunEl.toFixed(1)}°`; setTimeout(() => { save.textContent = 'save sun for this photo'; }, 1500); render(); }
  };
  const toggle = () => drawer.classList.toggle('hidden');
  btn.onclick = toggle;
  addEventListener('keydown', e => {
    if (['INPUT', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
    if (e.key === 'o' || e.key === 'O') toggle();
    else if ((e.key === ',' || e.key === '.') && shown.length) {
      const k = current ? shown.findIndex(i => idOf(i) === idOf(current!)) : -1;
      void pick(shown[(k + (e.key === '.' ? 1 : -1) + shown.length) % shown.length]);
    }
  });
  render();
  let last: string | null = null;
  try { last = localStorage.getItem(KEY); } catch { /* ignore */ }
  const start = (opts.loadLast && last && items.find(i => idOf(i) === last)) || null;
  if (start) { sel.value = start.folder; render(); await pick(start, false); }
}
