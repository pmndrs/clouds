import { createWeatherSource } from '../../../../experiments/coverage/weather';
import './style.css';

document.querySelector('#app')!.innerHTML = `
<header><h1>Persistent weather source</h1><p>P2.4 experiment · source and residency study · no lighting dependency</p></header>
<main><aside>
<p>This top-down map samples one fixed world-space source. The yellow square illustrates the existing resident window. Weather outside it continues to exist.</p>
<label>Seed<input id="seed" type="number" min="0" max="100000" value="17"></label>
<label for="coverage">Weather coverage <output id="coverageValue">0.55</output><input id="coverage" type="range" min="0" max="1" step="0.01" value="0.55"></label>
<label for="density">Density multiplier <output id="densityValue">1.00</output><input id="density" type="range" min="0" max="2" step="0.05" value="1"></label>
<label>Map<select id="field"><option value="coverage">Coverage mask</option><option value="density">Density response</option><option value="height">Cloud top height</option></select></label>
<h2>Approach selected point</h2><div id="distances"><button data-distance="20000">20 km</button><button data-distance="12000">12 km</button><button data-distance="8000">8 km</button><button data-distance="4000">4 km</button><button data-distance="1000">1 km</button><button data-distance="0">Entry</button></div>
<button id="retreat">Reset to 20 km</button><button id="audit">Run source checks</button>
<p id="status" role="status">Preparing source…</p><pre id="evidence"></pre>
</aside><section><h2>96 × 96 km source map</h2><p>Click to select a world point. White cross: selected point. Yellow marker: camera. Dashed yellow square: illustrative 9 × 9 cells at 2.2 km/cell.</p><canvas id="map" width="768" height="768" aria-label="World weather map"></canvas><pre id="selection"></pre><p class="notice">Source study only. No distant cloud renderer, voxel refinement or LOD handoff is connected yet. This does not fix the existing cloud viewer's pop-in or shadows.</p></section></main>
<footer><a href="/legacy/cloudscape/">Current cloudscape</a> · <a href="/legacy/lighting-bench/">Lighting isolation</a></footer>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('map'), context = canvas.getContext('2d')!;
const SPAN = 96000, GRID = 192, SIDE = 9, CELL = 2200;
let source = createWeatherSource({ seed: 17, scaleMetres: 18000 });
let selected = { x: 0, z: 0 }, distance = 20000;
let cachedMap = document.createElement('canvas'); cachedMap.width = GRID; cachedMap.height = GRID;
let generation = 0;
function controls() { return { coverage: Number($<HTMLInputElement>('coverage').value), density: Number($<HTMLInputElement>('density').value) }; }
function screen(value: number) { return (value / SPAN + 0.5) * canvas.width; }
function mark(x: number, z: number, color: string, cross = false) { context.strokeStyle = color; context.lineWidth = 2; context.beginPath(); if (cross) { context.moveTo(screen(x) - 8, screen(z)); context.lineTo(screen(x) + 8, screen(z)); context.moveTo(screen(x), screen(z) - 8); context.lineTo(screen(x), screen(z) + 8); } else { context.arc(screen(x), screen(z), 6, 0, Math.PI * 2); } context.stroke(); }
function drawOverlay() {
  context.imageSmoothingEnabled = true; context.drawImage(cachedMap, 0, 0, canvas.width, canvas.height);
  const camera = { x: selected.x, z: selected.z + distance };
  const originX = Math.floor(camera.x / CELL), originZ = Math.floor(camera.z / CELL);
  const left = (originX - 4) * CELL, top = (originZ - 4) * CELL;
  context.strokeStyle = '#fbd378'; context.lineWidth = 2; context.setLineDash([8, 5]); context.strokeRect(screen(left), screen(top), SIDE * CELL / SPAN * canvas.width, SIDE * CELL / SPAN * canvas.height); context.setLineDash([]);
  context.beginPath(); context.moveTo(screen(camera.x), screen(camera.z)); context.lineTo(screen(selected.x), screen(selected.z)); context.stroke();
  mark(selected.x, selected.z, '#ffffff', true); mark(camera.x, camera.z, '#fbd378');
  const sample = source.sample(selected.x, selected.z, controls());
  $('selection').textContent = JSON.stringify({ selectedWorldMetres: [selected.x, selected.z], sourceAtSelection: sample, cameraDistanceKm: distance / 1000, residentOriginCell: [originX, originZ], selectedPointInsideWindow: selected.x >= left && selected.x < left + SIDE * CELL && selected.z >= top && selected.z < top + SIDE * CELL, sourceMapGeneration: generation }, null, 2);
}
function regenerate() {
  try {
    source = createWeatherSource({ seed: Number($<HTMLInputElement>('seed').value), scaleMetres: 18000 });
    const options = controls(), mode = $<HTMLSelectElement>('field').value;
    $('coverageValue').textContent = options.coverage.toFixed(2); $('densityValue').textContent = options.density.toFixed(2);
    const ctx = cachedMap.getContext('2d')!, image = ctx.createImageData(GRID, GRID);
    let maskSum = 0, occupied = 0;
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const sample = source.sample(((x + 0.5) / GRID - 0.5) * SPAN, ((z + 0.5) / GRID - 0.5) * SPAN, options);
      maskSum += sample.coverage; if (sample.coverage > 0.5) occupied++;
      const response = sample.coverage * sample.density;
      const value = mode === 'density' ? response / (1 + response) : mode === 'height' ? (sample.topMetres - 700) / 2800 : sample.coverage;
      const clamped = Math.min(1, Math.max(0, value)), index = (z * GRID + x) * 4;
      image.data[index] = 18 + 220 * clamped; image.data[index + 1] = 40 + 200 * clamped; image.data[index + 2] = 54 + 188 * clamped; image.data[index + 3] = 255;
    }
    ctx.putImageData(image, 0, 0); generation++; $('evidence').textContent = '';
    $('status').textContent = `Ready · mean mask ${(100 * maskSum / (GRID * GRID)).toFixed(1)}% · area above 0.5 ${(100 * occupied / (GRID * GRID)).toFixed(1)}%. Coverage is a shaping control, not a promised sky-area percentage.`;
    drawOverlay();
  } catch (error) { $('status').textContent = String(error); }
}
for (const id of ['seed', 'coverage', 'density', 'field']) $(id).oninput = regenerate;
document.querySelectorAll<HTMLButtonElement>('[data-distance]').forEach(button => { button.onclick = () => { distance = Number(button.dataset.distance); drawOverlay(); }; });
$('retreat').onclick = () => { distance = 20000; drawOverlay(); };
canvas.onclick = event => { const rect = canvas.getBoundingClientRect(); selected = { x: Math.round(((event.clientX - rect.left) / rect.width - 0.5) * SPAN), z: Math.round(((event.clientY - rect.top) / rect.height - 0.5) * SPAN) }; drawOverlay(); };
$('audit').onclick = () => {
  const rows: { name: string; passed: boolean }[] = [];
  const points = Array.from({ length: 121 }, (_, i) => [((i % 11) - 5) * 7500, (Math.floor(i / 11) - 5) * 7500] as const);
  const defaults = { coverage: 0.55, density: 1 };
  rows.push({ name: 'Clear and full coverage endpoints', passed: points.every(([x, z]) => source.sample(x, z, { ...defaults, coverage: 0 }).coverage === 0 && source.sample(x, z, { ...defaults, coverage: 1 }).coverage === 1) });
  rows.push({ name: 'Coverage is monotonic at every sampled world point', passed: points.every(([x, z]) => { const values = [0, 0.25, 0.5, 0.75, 1].map(coverage => source.sample(x, z, { ...defaults, coverage }).coverage); return values.every((value, i) => i === 0 || value >= values[i - 1]); }) });
  rows.push({ name: 'Density zero clears density without altering weather shape', passed: points.every(([x, z]) => { const a = source.sample(x, z, defaults), b = source.sample(x, z, { ...defaults, density: 0 }); return b.density === 0 && b.coverage === a.coverage && b.topMetres === a.topMetres && b.baseMetres === a.baseMetres && b.type === a.type; }) });
  const before = points.map(([x, z]) => JSON.stringify(source.sample(x, z, defaults)));
  const savedDistance = distance, savedGeneration = generation;
  for (const next of [20000, 12000, 8000, 4000, 1000, 0, 20000]) { distance = next; drawOverlay(); }
  rows.push({ name: 'Approach and retreat leave source and map generation unchanged', passed: generation === savedGeneration && points.every(([x, z], i) => JSON.stringify(source.sample(x, z, defaults)) === before[i]) });
  rows.push({ name: 'Ordered finite height profiles', passed: points.every(([x, z]) => { const p = source.sample(x, z, defaults); return Object.values(p).every(Number.isFinite) && p.baseMetres >= 700 && p.topMetres <= 3500 && p.baseMetres < p.topMetres; }) });
  distance = savedDistance; drawOverlay();
  $('evidence').textContent = JSON.stringify({ seed: Number($<HTMLInputElement>('seed').value), scaleMetres: 18000, sampledWorldPoints: points.length, passed: rows.every(row => row.passed), checks: rows, scope: 'CPU weather source only; no renderer, optical continuity or shadow claim' }, null, 2);
};
regenerate();
