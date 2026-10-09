// Sun elevation control (T2): one slider whose steps are 0.1 deg across -6..+15 (the sunset/dusk range) and 0.5 deg above, a numeric field, and keys.
//   [ ]  -/+ 0.1 deg     { }  -/+ 1 deg     (the slider and the field stay in sync with every other way sunEl changes, e.g. bookmarks)
export const SUN_MIN = -6, SUN_FINE_MAX = 15, SUN_MAX = 90;
const FINE_STEPS = Math.round((SUN_FINE_MAX - SUN_MIN) * 10); // 210
const TOTAL = FINE_STEPS + Math.round((SUN_MAX - SUN_FINE_MAX) * 2); // + 150
export const sunToIndex = (el: number) => { const e = Math.min(SUN_MAX, Math.max(SUN_MIN, el)); return e <= SUN_FINE_MAX ? Math.round((e - SUN_MIN) * 10) : FINE_STEPS + Math.round((e - SUN_FINE_MAX) * 2); };
export const indexToSun = (i: number) => (i <= FINE_STEPS ? SUN_MIN + i / 10 : SUN_FINE_MAX + (i - FINE_STEPS) / 2);
const r1 = (v: number) => Math.round(v * 10) / 10;

export function addSunControl(bar: HTMLElement, view: { sunEl: number }, sync: Array<() => void>) {
  const wrap = document.createElement('label'); wrap.className = 'sunctl';
  const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = String(TOTAL); slider.step = '1';
  const num = document.createElement('input'); num.type = 'number'; num.step = '0.1'; num.min = String(SUN_MIN); num.max = String(SUN_MAX); num.title = 'sun elevation, degrees ([ ] 0.1, { } 1)';
  wrap.append('sun el', slider, num, '°'); bar.appendChild(wrap);
  const set = (el: number) => { view.sunEl = r1(Math.min(SUN_MAX, Math.max(SUN_MIN, el))); show(); };
  const show = () => { slider.value = String(sunToIndex(view.sunEl)); if (document.activeElement !== num) num.value = view.sunEl.toFixed(1); };
  slider.oninput = () => set(indexToSun(Number(slider.value)));
  num.oninput = () => { const v = Number(num.value); if (Number.isFinite(v) && num.value !== '') { view.sunEl = Math.min(SUN_MAX, Math.max(SUN_MIN, v)); slider.value = String(sunToIndex(view.sunEl)); } };
  num.onblur = show;
  addEventListener('keydown', e => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
    const d = e.key === '[' ? -0.1 : e.key === ']' ? 0.1 : e.key === '{' ? -1 : e.key === '}' ? 1 : 0;
    if (d) { e.preventDefault(); set(view.sunEl + d); }
  });
  sync.push(show);
}
