import { createLabRenderer } from '../../harness/renderer';
import { fetchDenseAsset, decodeDenseAsset, type DenseDensityField } from '@clouds/assets';
import { createReferenceCloud } from '@clouds/three';
import { WebGPURenderer, Scene, PerspectiveCamera, Color, Vector3, Box3, Box3Helper, ACESFilmicToneMapping } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createMeshBench, type MeshBenchResult } from './mesh-bench';

document.querySelector('#app')!.innerHTML = `<style>
*{box-sizing:border-box}body{margin:0;background:#101e28;color:#e4eff5;font:14px system-ui}header{padding:18px 24px;display:flex;gap:20px;align-items:center;flex-wrap:wrap}h1{margin:0;font-size:21px}p{margin:6px 0;color:#aec5d4}button,select,input{accent-color:#8ccde2}button{padding:8px 12px;background:#284553;color:white;border:1px solid #567281;border-radius:5px}main{display:grid;grid-template-columns:minmax(0,1fr) 340px}#view{height:75vh;min-height:400px}canvas{display:block}aside{padding:16px;overflow:auto}pre{white-space:pre-wrap;font-size:12px}label{display:block;margin:14px 0}a{color:#9edbea}@media(max-width:800px){main{grid-template-columns:1fr}}
</style><header><div><h1>Authored density</h1><p>Static mesh → dense field → the same volume renderer</p></div><label>Fixture <select id="fixture"><option value="mesh">Blender mesh → density</option><option value="density">Blender-authored density</option><option value="meshbench">Closed mesh testbench</option></select></label><button id="reload">Reload fixture</button><button id="verify">Check input rejection</button><a href="/legacy/three/">Three.js</a><a href="/legacy/quality-bench/">Quality bench</a></header><main><div id="view"></div><aside><p id="status" role="status">Loading fixture…</p><section id="meshControls" hidden><label>Input mesh <select id="meshShape"><option value="sphere">Closed sphere</option><option value="torus">Closed concave torus</option></select></label><label>Voxel resolution <select id="meshResolution"><option value="16">16³</option><option value="32" selected>32³</option></select></label><label>Surface falloff <input id="meshSoftness" type="range" min="0" max="0.3" value="0.08" step="0.01"><output id="meshSoftnessValue">0.08 m</output></label><label><input id="meshWireframe" type="checkbox" checked> Show input mesh wireframe</label><label>Edge erosion <input id="meshErosion" type="range" min="0" max="100" value="0" step="1"><output id="meshErosionValue">0%</output></label><p>The testbench generates a low segment closed sphere or concave torus, converts it at bounded resolution, and renders the resulting density. Erosion is seeded and deterministic in the realistic diagnostic shader.</p></section><label>Display density multiplier <input id="density" type="range" min="0" max="200" value="100" step="1"><output id="multiplier">100</output></label><p>The small fixture uses metres. A visible multiplier is applied for inspection; its stored extinction and bounds remain unchanged. Orange lines show the asset bounds. Orbit and zoom to inspect the shape.</p><p>This proves static dense transport. It does not demonstrate VDB, sparse playback or finished cloud shading.</p><pre id="evidence"></pre></aside></main>`;
const $ = (id: string) => document.getElementById(id)!;
const fixtureUrls = { mesh: new URL('../../../../fixtures/authored/cube-density.clda', import.meta.url).href, density: new URL('../../../../fixtures/authored/authored-density.clda', import.meta.url).href };
const fixtureUrl = () => fixtureUrls[($('fixture') as HTMLSelectElement).value as keyof typeof fixtureUrls];
async function main() {
  const renderer = await createLabRenderer({ antialias: true }); await renderer.init(); renderer.setPixelRatio(1); renderer.toneMapping = ACESFilmicToneMapping;
  $('view').append(renderer.domElement);
  const scene = new Scene(); scene.background = new Color(0x24465d);
  const camera = new PerspectiveCamera(45, 1, 0.001, 1000); camera.coordinateSystem = renderer.coordinateSystem; camera.updateProjectionMatrix();
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
  let cloud: ReturnType<typeof createReferenceCloud> | undefined, field: DenseDensityField | undefined, box: Box3Helper | undefined, bench: MeshBenchResult | undefined;
  let alive = true, request = 0, controller: AbortController | undefined, loaded = 0, frame = 0;
  const checks: { name: string; passed: boolean }[] = [], errors: string[] = [];
  const resize = () => { const host = $('view'); renderer.setSize(host.clientWidth, host.clientHeight); camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix(); cloud?.resize(host.clientWidth, host.clientHeight); };
  const report = () => { $('evidence').textContent = JSON.stringify({ loaded, descriptor: field?.descriptor, spacingMetres: field?.descriptor.dimensions.map((n, i) => (field!.descriptor.bounds.max[i] - field!.descriptor.bounds.min[i]) / n), displayDensityMultiplier: Number(($('density') as HTMLInputElement).value), checks, errors }, null, 2); };
  function benchOptions() { return { shape: ($('meshShape') as HTMLSelectElement).value as 'sphere' | 'torus', resolution: Number(($('meshResolution') as HTMLSelectElement).value) as 16 | 32, softness: Number(($('meshSoftness') as HTMLInputElement).value) }; }
  function updateBenchControls() { $('meshControls').hidden = ($('fixture') as HTMLSelectElement).value !== 'meshbench'; }
  async function load() {
    controller?.abort(); const ticket = ++request; controller = new AbortController(); $('status').textContent = 'Loading validated dense fixture…';
    try {
      const isBench = ($('fixture') as HTMLSelectElement).value === 'meshbench';
      const nextBench = isBench ? createMeshBench(benchOptions()) : undefined;
      const next = nextBench?.field ?? await fetchDenseAsset(fixtureUrl(), { signal: controller.signal, maxPayloadBytes: 16 * 1024 * 1024 });
      if (!alive || ticket !== request) return;
      bench?.dispose(); bench = nextBench;
      if (bench) { bench.wireframe.visible = ($('meshWireframe') as HTMLInputElement).checked; scene.add(bench.wireframe); }
      const replacement = createReferenceCloud(renderer, next, { min: [-1000,-1000,-1000], max: [-999,-999,-999] }, { appearance: isBench ? 'realistic' : 'reference' });
      replacement.settings.castShadow = false; replacement.settings.receiveShadow = false; replacement.settings.viewSteps = 256; replacement.settings.lightSteps = 64;
      replacement.settings.densityMultiplier = Number(($('density') as HTMLInputElement).value);
      replacement.settings.detailErosion = Number(($('meshErosion') as HTMLInputElement).value) / 100;
      cloud?.dispose(); cloud = replacement; field = next; loaded++;
      if (box) { scene.remove(box); box.dispose(); }
      const bounds = new Box3(new Vector3(...next.descriptor.bounds.min), new Vector3(...next.descriptor.bounds.max));
      box = new Box3Helper(bounds, 0xdb943e); scene.add(box);
      const center = bounds.getCenter(new Vector3()), size = bounds.getSize(new Vector3()).length();
      controls.target.copy(center); camera.position.copy(center).add(new Vector3(size, size * .45, size)); camera.near = Math.max(.0001, size / 1000); camera.far = size * 100; camera.lookAt(center); controls.update(); resize();
      cloud.render(scene, camera); const pixels = await cloud.readOptical();
      if (!alive || ticket !== request) return;
      const passed = pixels.every(Number.isFinite) && pixels.some((v,i) => i % 4 === 3 && v < .99);
      checks.push({ name: 'Loaded authored field produces finite visible GPU density', passed });
      $('status').textContent = passed ? (isBench ? `Converted ${bench!.shape} mesh (${bench!.triangleCount} triangles) at ${next.descriptor.dimensions[0]}³.` : 'Fixture loaded. Orbit and zoom to inspect.') : 'Fixture loaded, but GPU visibility check failed.'; report();
    } catch (error) { if (alive && ticket === request) { const message = String(error); errors.push(message); $('status').textContent = message; report(); } }
  }
  $('density').oninput = () => { const value = Number(($('density') as HTMLInputElement).value); $('multiplier').textContent = String(value); if (cloud) cloud.settings.densityMultiplier = value; report(); };
  $('meshErosion').oninput = () => { const value = Number(($('meshErosion') as HTMLInputElement).value); $('meshErosionValue').textContent = `${value}%`; if (cloud) cloud.settings.detailErosion = value / 100; report(); };
  $('meshWireframe').oninput = () => { if (bench) bench.wireframe.visible = ($('meshWireframe') as HTMLInputElement).checked; };
  $('reload').onclick = () => { void load(); };
  $('fixture').onchange = () => { updateBenchControls(); void load(); };
  $('meshShape').onchange = () => { if (($('fixture') as HTMLSelectElement).value === 'meshbench') void load(); };
  $('meshResolution').onchange = () => { if (($('fixture') as HTMLSelectElement).value === 'meshbench') void load(); };
  $('meshSoftness').oninput = () => { $('meshSoftnessValue').textContent = `${Number(($('meshSoftness') as HTMLInputElement).value).toFixed(2)} m`; };
  $('meshSoftness').onchange = () => { if (($('fixture') as HTMLSelectElement).value === 'meshbench') void load(); };
  $('verify').onclick = async () => {
    const previous = cloud;
    try { decodeDenseAsset(new Uint8Array(96)); checks.push({ name: 'Reject malformed header', passed: false }); } catch { checks.push({ name: 'Reject malformed header', passed: true }); }
    const aborted = new AbortController(); aborted.abort();
    try { await fetchDenseAsset(fixtureUrl(), { signal: aborted.signal }); checks.push({ name: 'Reject cancelled load', passed: false }); } catch (error) { checks.push({ name: 'Reject cancelled load', passed: error instanceof Error && error.name === 'AbortError' }); }
    checks.push({ name: 'Rejected load preserves active cloud', passed: cloud === previous });
    $('status').textContent = checks.every(check => check.passed) ? 'All authored checks pass.' : 'A check failed; inspect evidence.'; report();
  };
  const observer = new ResizeObserver(resize); observer.observe($('view')); resize();
  function animate() { if (!alive) return; controls.update(); if (cloud) cloud.render(scene, camera); else renderer.render(scene, camera); frame = requestAnimationFrame(animate); }
  animate(); updateBenchControls(); await load();
  window.addEventListener('pagehide', () => { alive = false; request++; controller?.abort(); cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); cloud?.dispose(); box?.dispose(); bench?.dispose(); renderer.dispose(); }, { once: true });
}
main().catch(error => { $('status').textContent = String(error); });
