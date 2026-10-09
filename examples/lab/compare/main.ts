// Side-by-side comparison of cloud implementations over the same wide scene. Each pane has its own canvas and renderer; one shared camera, sun and exposure drive them.
//   ?impls=ours,skypro,takram   which panes (default ours,takram)       ?layout=rows|cols (default rows)
//   ?bookmark=ground|horizon|sunset|above   ?coverage=0..1   ?exposure=  ?fov=   ?hud=0 / ?clean=1 hide the labels / all UI
// Other query keys pass through to the panes (ours: quality, seed, sky=0; Takram: takram_quality, stbn=<url>; every pane: clouds=0 for a clear sky).
import { installCloudsHarness } from '../harness/clouds-contract';
import { BOOKMARKS, BOOKMARK_NAMES, DEFAULT_COVERAGE, GROUND_HEX, mapCoverage, forwardOf, type Pane, type ViewState } from './shared';
import { Rig } from './rig';
import { createOursPane } from './panes/ours';
import { createTakramPane } from './panes/takram';
import { createSkyProPane } from './vendor/skypro/skypro-pane.js';
import { Color } from 'three';

// Calibrated exposure of the Sky Pro pane relative to ours (see the P8-A report).
const SKYPRO_EXPOSURE = 1.35;
/** Ground albedo multiplier for the Sky Pro and Takram panes: their Lambertian ground reads darker than ours (three's standard material under the physical sun), measured at the four bookmarks. */
const GROUND_GAIN = 1.45;
const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const msg = document.getElementById('msg')!;
const SHOW_LABELS = query.get('hud') !== '0';
const SHOW_UI = query.get('clean') !== '1';
const IMPLS = (query.get('impls') ?? 'ours,takram').split(',').filter(s => ['ours', 'skypro', 'takram'].includes(s)) as Pane['id'][];
const LAYOUT = query.get('layout') === 'cols' ? 'cols' : 'rows';
msg.classList.toggle('hidden', !SHOW_UI);

try {
  const view: ViewState = { position: [0, 2, 0], lookAz: 0, pitch: 7, fov: Number(query.get('fov') ?? 50), sunAz: 150, sunEl: 40, coverage: Number(query.get('coverage') ?? DEFAULT_COVERAGE), exposure: Number(query.get('exposure') ?? 1) };
  const sync: Array<() => void> = [];
  const syncUi = () => sync.forEach(f => f());
  let bookmark = 'ground';
  const applyBookmark = (name: string) => {
    const b = BOOKMARKS[name];
    if (!b) throw new Error(`unknown bookmark: ${name}`);
    bookmark = name;
    view.position = [...b.position]; view.lookAz = b.lookAz; view.pitch = b.pitch; view.sunEl = b.sunEl; view.sunAz = b.sunAz;
    syncUi();
  };

  const stack = document.getElementById('stack')!;
  stack.className = LAYOUT;
  const groundLinear = new Color(GROUND_HEX); // sRGB hex -> linear, shared by every pane
  const panes: Pane[] = [];
  const labels = new Map<Pane, HTMLElement>();
  for (const id of IMPLS) {
    const host = document.createElement('div'); host.className = 'pane';
    const canvas = document.createElement('canvas'); host.appendChild(canvas);
    const label = document.createElement('pre'); label.className = 'label'; if (!SHOW_LABELS) label.classList.add('hidden'); host.appendChild(label);
    stack.appendChild(host);
    msg.textContent = `starting ${id}...`;
    let pane: Pane;
    if (id === 'ours') pane = createOursPane(canvas, query);
    else if (id === 'takram') pane = createTakramPane(canvas, query, GROUND_GAIN);
    else {
      const sp = await createSkyProPane(canvas, { groundAlbedo: [groundLinear.r * GROUND_GAIN, groundLinear.g * GROUND_GAIN, groundLinear.b * GROUND_GAIN], groundShadows: query.get('shadows') === '1' });
      pane = {
        id: 'skypro', label: 'Sky Pro: DRG Software, WebGPU/WGSL (vendored from Tidewater)', canvas,
        init: async () => {}, resize: (w, h) => sp.resize(w, h), ready: () => sp.ready(),
        render: v => { sp.render({ position: v.position, forward: forwardOf(v), fov: v.fov, sunAz: v.sunAz, sunEl: v.sunEl, coverage: mapCoverage.skypro(v.coverage) * (query.get('clouds') === '0' ? 0 : 1), exposure: v.exposure * SKYPRO_EXPOSURE }); },
        stats: () => ({ gpuMs: sp.gpuMs(), cpuMs: cpuOf('skypro') }), detail: () => sp.diagnostics(),
      };
    }
    panes.push(pane); labels.set(pane, label);
  }
  const cpuTimes = new Map<string, number[]>();
  function cpuOf(id: string) { const a = cpuTimes.get(id) ?? []; return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

  const resizeAll = () => {
    for (const p of panes) { const r = p.canvas.parentElement!.getBoundingClientRect(); p.resize(Math.max(2, Math.round(r.width)), Math.max(2, Math.round(r.height))); }
  };
  msg.textContent = 'initialising panes...';
  await Promise.all(panes.map(p => p.init()));
  addEventListener('resize', resizeAll);
  resizeAll();

  const rig = new Rig(view, document.getElementById('overlay')!);
  applyBookmark(BOOKMARK_NAMES.includes(query.get('bookmark') ?? '') ? query.get('bookmark')! : 'ground');

  // ---- UI
  const bar = document.getElementById('bar')!;
  bar.classList.toggle('hidden', !SHOW_UI);
  for (const name of BOOKMARK_NAMES) { const b = document.createElement('button'); b.textContent = name; b.onclick = () => applyBookmark(name); bar.appendChild(b); }
  const modeBtn = document.createElement('button'); modeBtn.onclick = () => { rig.mode = rig.mode === 'fly' ? 'orbit' : 'fly'; modeBtn.textContent = `camera: ${rig.mode}`; }; modeBtn.textContent = `camera: ${rig.mode}`; bar.appendChild(modeBtn);
  const slider = (name: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) => {
    const l = document.createElement('label'); const i = document.createElement('input'); i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step);
    const t = document.createElement('span'); l.append(name, i, t);
    i.oninput = () => { set(Number(i.value)); t.textContent = i.value; };
    sync.push(() => { i.value = String(get()); t.textContent = String(Math.round(get() * 100) / 100); });
    bar.appendChild(l);
  };
  slider('sun el', 0, 90, 0.5, () => view.sunEl, v => { view.sunEl = v; });
  slider('sun az', 0, 360, 1, () => view.sunAz, v => { view.sunAz = v; });
  slider('coverage', 0, 1, 0.01, () => view.coverage, v => { view.coverage = v; });
  slider('exposure', 0.25, 4, 0.05, () => view.exposure, v => { view.exposure = v; });
  slider('fov', 20, 100, 1, () => view.fov, v => { view.fov = v; });
  syncUi();

  // ---- loop
  const frameTimes: number[] = [];
  let last = performance.now(), frame = 0;
  const pct = (p: number) => { const s = [...frameTimes].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  const f1 = (n: number) => n.toFixed(1);
  const loop = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    if (frame > 30) { frameTimes.push(dt * 1000); if (frameTimes.length > 240) frameTimes.shift(); }
    rig.update(dt);
    view.position[1] = Math.max(0.5, view.position[1]);
    for (const p of panes) {
      const t0 = performance.now();
      p.render(view, dt);
      const a = cpuTimes.get(p.id) ?? []; a.push(performance.now() - t0); if (a.length > 60) a.shift(); cpuTimes.set(p.id, a);
    }
    if (frame % 15 === 0) {
      for (const p of panes) {
        const s = p.stats();
        const gpu = s.gpuMs?.total ?? s.gpuMs?.cloudsTotal;
        labels.get(p)!.innerHTML = `<b>${p.label}</b>\n${p.ready() ? '' : 'loading... '}${gpu != null ? `gpu ${f1(gpu)} ms  ` : ''}cpu ${f1(s.cpuMs)} ms  ${p.canvas.width}x${p.canvas.height}`;
      }
      msg.textContent = `${bookmark}  pos ${view.position.map(v => Math.round(v)).join(',')}  az ${Math.round(view.lookAz)} pitch ${Math.round(view.pitch)}  sun ${Math.round(view.sunAz)}/${Math.round(view.sunEl)}  ${rig.mode}${rig.mode === 'fly' ? ` ${Math.round(rig.speed)} m/s (WASD QE, wheel)` : ''}  frame p50 ${f1(pct(0.5))} ms`;
    }
    frame++;
    harness.frame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const allReady = () => panes.every(p => p.ready());
  const waitReady = async () => { while (!allReady()) await new Promise(r => setTimeout(r, 100)); };
  void waitReady().then(() => harness.ready({
    bookmark: name => { applyBookmark(name); },
    report: () => {
      const out: Record<string, unknown> = {};
      const gpuMs: Record<string, number> = {};
      for (const p of panes) {
        const s = p.stats();
        out[p.id] = { label: p.label, gpuMs: s.gpuMs, cpuMs: s.cpuMs, renderSize: [p.canvas.width, p.canvas.height], detail: p.detail() };
        if (s.gpuMs) for (const [k, v] of Object.entries(s.gpuMs)) gpuMs[`${p.id}.${k}`] = v;
      }
      return { gpuMs, frameMs: { p50: pct(0.5), p95: pct(0.95) }, renderSize: panes.map(p => [p.canvas.width, p.canvas.height]), bookmark, layout: LAYOUT, impls: IMPLS, view: { ...view }, panes: out, frames: frame };
    },
  }));
} catch (e) {
  msg.textContent = 'failed: ' + (e instanceof Error ? e.message : String(e));
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
