import { ACESFilmicToneMapping, Color, PerspectiveCamera, Scene, Vector3, WebGPURenderer } from 'three/webgpu';
import { createReferenceCloud } from '@clouds/three';
import {
  LOD_HYSTERESIS,
  LodResidencyController,
  createBlendedField,
  createCanonicalField,
  fixedRayErrors,
  r8UploadError,
  volumeAverage,
  volumeAverageAxes,
} from '../../../experiments/lod/reference';
import './style.css';
import { runDistanceAudit, type DistanceAuditReport } from './distance-audit';

document.querySelector('#app')!.innerHTML = `
<header><h1>Single-formation LOD study</h1><p>Bounded P2.5 reference · fixed weather/profile source · one effective extinction field</p></header>
<p class="subtle">Canonical and candidate are separate panes for inspection. During a transition the candidate contains one CPU-blended field, then uploads that one field to the bounded Three renderer.</p>
<section class="controls">
  <label for="distance">Camera pose <output id="distanceValue">12 km</output><input id="distance" type="range" min="1" max="24" step="0.1" value="12"></label>
  <label for="angle">Orbit angle <output id="angleValue">20°</output><input id="angle" type="range" min="-180" max="180" step="1" value="20"></label>
  <label>Coarse resolution<select id="resolution"><option value="16">16³ coarse</option><option value="32">32³ coarse</option><option value="32x64x32" selected>32 × 64 × 32 coarse</option></select></label>
  <div class="button-row"><button data-pose="20">20 km</button><button data-pose="12">12 km</button><button data-pose="8">8 km</button><button data-pose="4">4 km</button><button data-pose="1">1 km</button></div>
  <div class="button-row"><button id="delay">Simulate delayed fine</button><button id="evict">Evict fine</button><button id="endpoint">Run GPU checks</button><label>Audit image size<select id="auditSize"><option value="320">320 × 320</option><option value="640" selected>640 × 640</option></select></label><button id="distanceAudit">Measure distance quality</button><button id="cancelAudit" disabled>Cancel measurement</button></div>
  <div><strong id="status">Preparing coarse residency…</strong><p id="statusDetail">Coarse remains available while fine is pending.</p></div>
</section>
<section class="panes"><div class="pane"><h2>Canonical 64³</h2><div id="canonicalView"></div><small>Frozen reference generated from weather/profile source</small></div><div class="pane"><h2>Candidate / one blended field</h2><div id="candidateView"></div><small id="candidateLabel">Coarse fallback while fine is unavailable</small></div></section>
<section class="distance-results"><h2>Distance quality</h2><p id="auditProgress" role="status">Not measured. The audit compares 15 poses at the selected resolution with fixed unshadowed integration.</p><button id="exportAudit" disabled>Export distance report</button><div id="auditSummary"></div><details><summary>Full distance evidence</summary><pre id="distanceEvidence"></pre></details></section><section class="evidence"><div><h2>Evidence</h2><pre id="evidence"></pre></div><div><h2>Scope</h2><p class="notice">Two independent renderers are used for these diagnostic panes. CPU blending and full-size upload are diagnostic steps. Fine loading is manually simulated; this is not a streaming scheduler. This does not claim GPU streaming, memory optimization, source realism, or a production LOD policy.</p></div></section>`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canonical = createCanonicalField();
let coarse = volumeAverageAxes(canonical, [32, 64, 32]);
let controller = new LodResidencyController(canonical, coarse);
let candidateField = coarse;
let canonicalCloud: ReturnType<typeof createReferenceCloud> | undefined;
let candidateCloud: ReturnType<typeof createReferenceCloud> | undefined;
let canonicalRenderer: WebGPURenderer | undefined;
let candidateRenderer: WebGPURenderer | undefined;
let canonicalCamera: PerspectiveCamera | undefined;
let candidateCamera: PerspectiveCamera | undefined;
let scene: Scene | undefined;
let frame = 0;
let alive = true;
let lastWeight = -1;
let pendingTimer: ReturnType<typeof setTimeout> | undefined;
let lastBlendUpdate = 0;
let uploadError: number | undefined;
let auditRunning = false;
let auditCancelled = false;
let distanceReport: DistanceAuditReport | undefined;
let gpuEvidence: unknown;
let rayErrors = fixedRayErrors(coarse, canonical);

function distanceMetres(): number { return Number(($<HTMLInputElement>('distance')).value) * 1_000; }
function angleRadians(): number { return Number(($<HTMLInputElement>('angle')).value) * Math.PI / 180; }
function setStatus(text: string, detail = '') { $('status').textContent = text; $('statusDetail').textContent = detail; }

function setupCamera(renderer: WebGPURenderer): PerspectiveCamera {
  const camera = new PerspectiveCamera(42, 1, 0.1, 100_000);
  camera.coordinateSystem = renderer.coordinateSystem;
  return camera;
}

function updateCamera(camera: PerspectiveCamera): void {
  const distance = distanceMetres(), angle = angleRadians();
  camera.position.set(Math.sin(angle) * distance, 1_550 + distance * 0.08, Math.cos(angle) * distance);
  camera.lookAt(new Vector3(0, 1_550, 0));
  camera.updateProjectionMatrix();
}

function resize(): void {
  if (auditRunning) return;
  const height = Math.max(280, Math.min(560, Math.floor(window.innerHeight * .56)));
  for (const [host, renderer, camera] of [[document.getElementById('canonicalView'), canonicalRenderer, canonicalCamera], [document.getElementById('candidateView'), candidateRenderer, candidateCamera]] as const) {
    if (!host || !renderer || !camera) continue;
    const width = Math.max(1, host.clientWidth);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (host === document.getElementById('canonicalView')) canonicalCloud?.resize(width, height);
    else candidateCloud?.resize(width, height);
  }
}

function projectionInputs(): [number, number] {
  const host = $('candidateView');
  return [Math.max(1, host.clientHeight || 560), (candidateCamera?.fov ?? 42) * Math.PI / 180];
}

function report(snapshot = controller.update(distanceMetres(), ...projectionInputs())): void {
  const errors = rayErrors;
  $('distanceValue').textContent = `${(distanceMetres() / 1_000).toFixed(1)} km`;
  $('angleValue').textContent = `${Number(($<HTMLInputElement>('angle')).value)}°`;
  $('candidateLabel').textContent = snapshot.fine === 'ready' ? `Fine ready · 64³ upload · blend ${(snapshot.weight * 100).toFixed(0)}%` : `${snapshot.fine} · coarse ${coarse.descriptor.dimensions.join(" × ")} fallback · blend 0%`;
  $('evidence').textContent = JSON.stringify({
    state: snapshot.fine, sourceId: canonical.descriptor.id, revision: snapshot.revision, requestToken: snapshot.requestToken,
    coarseDimensions: coarse.descriptor.dimensions, fineResolution: 64, bounds: canonical.descriptor.bounds,
    projectedVoxelPixels: Number(snapshot.projectedVoxelPixels.toFixed(3)), transitionWeight: Number(snapshot.weight.toFixed(4)), readiness: Number(snapshot.readiness.toFixed(4)),
    hysteresisPixels: LOD_HYSTERESIS, fixedRayTransmittance: { canonical: errors.canonicalValues, coarse: errors.coarseValues },
    measuredError: { coarseMaxAbs: errors.coarseMaxAbs, mixedHalfMaxAbs: errors.mixedAtHalfMaxAbs },
    r8UploadSampledQuantizationMaxAbs: uploadError,
    cpuFieldBytes: canonical.data.byteLength + coarse.data.byteLength + (candidateField === coarse ? 0 : candidateField.data.byteLength),
    diagnosticDevices: 2, gpuEvidence,
    opticalAcceptance: 'Coarse/mixed errors are measurements; no visual quality pass is claimed.',
    loaderPolicy: 'Manual delayed fine request; projected thresholds drive blend/request intent only.', 
    diagnostic: 'CPU blend + full-size r8 upload; canonical is the frozen comparison pane.',
  }, null, 2);
}

function updateField(): void {
  const snapshot = controller.update(distanceMetres(), ...projectionInputs(), performance.now() / 1_000);
  if (snapshot.weight !== lastWeight) {
    lastWeight = snapshot.weight;
    candidateField = snapshot.fine === 'ready' ? createBlendedField(coarse, canonical, snapshot.weight) : coarse;
    uploadError = snapshot.fine === 'ready' ? r8UploadError(coarse, canonical, snapshot.weight, candidateField) : undefined;
    candidateCloud?.setField(candidateField);
  }
  report(snapshot);
}

function beginDelayedFine(): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  const token = controller.beginFineRequest();
  lastWeight = -1;
  updateField();
  setStatus('Fine pending', `Request token ${token}; coarse remains resident. Completion is deliberately delayed.`);
  pendingTimer = setTimeout(() => {
    pendingTimer = undefined;
    if (controller.resolveFine(token, canonical)) { setStatus('Fine ready', `Accepted request token ${token}; candidate blends one effective field.`); updateField(); }
  }, 900);
}

async function main(): Promise<void> {
  try {
    scene = new Scene(); scene.background = new Color(0x24465d);
    canonicalRenderer = new WebGPURenderer({ antialias: true }); candidateRenderer = new WebGPURenderer({ antialias: true });
    await Promise.all([canonicalRenderer.init(), candidateRenderer.init()]);
    canonicalRenderer.toneMapping = ACESFilmicToneMapping; candidateRenderer.toneMapping = ACESFilmicToneMapping;
    $('canonicalView').append(canonicalRenderer.domElement); $('candidateView').append(candidateRenderer.domElement);
    canonicalCamera = setupCamera(canonicalRenderer); candidateCamera = setupCamera(candidateRenderer);
    canonicalCloud = createReferenceCloud(canonicalRenderer, canonical, { min: [-1_000, 0, -1_000], max: [1_000, 3_000, 1_000] });
    candidateCloud = createReferenceCloud(candidateRenderer, candidateField, { min: [-1_000, 0, -1_000], max: [1_000, 3_000, 1_000] });
    for (const cloud of [canonicalCloud, candidateCloud]) { cloud.settings.castShadow = false; cloud.settings.receiveShadow = false; cloud.settings.constantLight = true; cloud.settings.occupancy = false; cloud.settings.viewSteps = 96; cloud.settings.lightSteps = 8; }
    resize(); beginDelayedFine();
    window.addEventListener('resize', resize);
    $('distance').addEventListener('input', () => { updateField(); });
    $('angle').addEventListener('input', () => { updateField(); });
    $('resolution').addEventListener('change', () => { coarse = ($<HTMLSelectElement>('resolution')).value === '32x64x32' ? volumeAverageAxes(canonical, [32, 64, 32]) : volumeAverage(canonical, Number(($<HTMLSelectElement>('resolution')).value)); rayErrors = fixedRayErrors(coarse, canonical); controller = new LodResidencyController(canonical, coarse); lastWeight = -1; beginDelayedFine(); });
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-pose]')) button.onclick = () => { ($<HTMLInputElement>('distance')).value = button.dataset.pose!; updateField(); };
    $('delay').onclick = beginDelayedFine;
    $('evict').onclick = () => { if (pendingTimer) clearTimeout(pendingTimer); controller.evictFine(); lastWeight = -1; setStatus('Fine evicted', 'The coarse field remains visible; no hole or duplicate cloud is introduced.'); updateField(); };
    $('endpoint').onclick = async () => {
      if (auditRunning || !candidateCloud || !canonicalCloud || !scene) return;
      auditRunning = true;
      const controls = [...document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')];
      controls.forEach(control => { control.disabled = true; });
      if (pendingTimer) clearTimeout(pendingTimer);
      const checks: { name: string; passed: boolean; value?: number }[] = [];
      const finiteVisible = (pixels: Float32Array) => pixels.every(Number.isFinite) && pixels.some((value, i) => i % 4 === 3 && value < .99);
      try {
        const auditCamera = setupCamera(candidateRenderer!);
        auditCamera.aspect = 1; auditCamera.position.set(1_000, 1_700, 3_800);
        auditCamera.lookAt(0, 1_700, 0); auditCamera.updateProjectionMatrix();
        canonicalCloud.resize(128, 128); candidateCloud.resize(128, 128);
        canonicalCloud.render(scene, auditCamera, false);
        const reference = await canonicalCloud.readOptical();
        checks.push({ name: 'Canonical finite and visible', passed: finiteVisible(reference) });
        const probe = new LodResidencyController(canonical, coarse);
        const stale = probe.beginFineRequest();
        const current = probe.beginFineRequest();
        checks.push({ name: 'Reordered completion rejected', passed: !probe.resolveFine(stale, canonical) });
        candidateCloud.setField(coarse); candidateCloud.render(scene, auditCamera, false);
        const fallback = await candidateCloud.readOptical();
        checks.push({ name: 'Pending fine retains visible coarse', passed: probe.update(4_000).weight === 0 && finiteVisible(fallback) });
        probe.evictFine();
        checks.push({ name: 'Cancelled completion rejected', passed: !probe.resolveFine(current, canonical) && probe.fine === undefined });
        const fine = createBlendedField(coarse, canonical, 1);
        candidateCloud.setField(fine); candidateCloud.render(scene, auditCamera, false);
        const endpoint = await candidateCloud.readOptical();
        let maxT = 0;
        for (let i = 3; i < reference.length; i += 4) maxT = Math.max(maxT, Math.abs(endpoint[i] - reference[i]));
        checks.push({ name: 'Blended fine endpoint matches canonical T', passed: finiteVisible(endpoint) && endpoint.length === reference.length && maxT <= 1e-6, value: maxT });
        gpuEvidence = { renderSize: [128, 128], selfShadowing: false, coarseDimensions: coarse.descriptor.dimensions, checks };
        setStatus(checks.every(check => check.passed) ? 'All GPU checks pass' : 'A GPU check failed', 'Fixed-pose optical checks; not a world LOD or lighting acceptance.');
      } catch (error) {
        gpuEvidence = { checks, error: String(error) }; setStatus('GPU check failed', String(error));
      } finally {
        if (alive) {
          auditRunning = false; controller.evictFine(); lastWeight = -1; updateField(); resize();
          controls.forEach(control => { control.disabled = false; });
          ($<HTMLButtonElement>('cancelAudit')).disabled = true;
          ($<HTMLButtonElement>('exportAudit')).disabled = !distanceReport;
        }
        auditRunning = false;
      }
    };
    $('cancelAudit').onclick = () => { auditCancelled = true; };
    $('exportAudit').onclick = () => {
      if (!distanceReport) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(distanceReport, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'lod-distance-report.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    };
    $('distanceAudit').onclick = async () => {
      if (auditRunning || !candidateCloud || !canonicalCloud || !scene || !candidateRenderer) return;
      auditRunning = true; auditCancelled = false;
      if (pendingTimer) clearTimeout(pendingTimer);
      const controls = [...document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')];
      controls.forEach(control => { control.disabled = true; });
      ($<HTMLButtonElement>('cancelAudit')).disabled = false;
      $('auditProgress').textContent = 'Preparing distance comparisons…';
      try {
        const result = await runDistanceAudit({ renderer: candidateRenderer, scene, reference: canonicalCloud, candidate: candidateCloud, canonical, imageSize: Number(($<HTMLSelectElement>('auditSize')).value) as 320 | 640,
          cancelled: () => auditCancelled || !alive, progress: text => { $('auditProgress').textContent = text; } });
        if (!alive) return;
        distanceReport = result;
        $('distanceEvidence').textContent = JSON.stringify(result, null, 2);
        $('auditSummary').innerHTML = '<table><thead><tr><th>Distance</th><th>Candidate passing all measured angles</th></tr></thead><tbody>' + result.selection.map(row => `<tr><td>${row.distanceMetres / 1_000} km</td><td>${row.representation}</td></tr>`).join('') + '</tbody></table><p>These choices apply only to this measured fixture and image size. A canonical fallback means no coarse candidate passed every provisional gate.</p>';
        $('auditProgress').textContent = `Completed ${result.rows.length} poses. ${result.rows.filter(row => row.converged).length} passed the reference sampling convergence check.`;
      } catch (error) {
        $('auditProgress').textContent = `${String(error)} Any previous completed evidence remains dated separately.`;
      } finally {
        auditRunning = false;
        if (alive) {
          controller.evictFine(); lastWeight = -1; updateField(); resize();
          controls.forEach(control => { control.disabled = false; });
          ($<HTMLButtonElement>('cancelAudit')).disabled = true;
          ($<HTMLButtonElement>('exportAudit')).disabled = !distanceReport;
        }
      }
    };
    const render = () => {
      if (!alive || !scene || !canonicalRenderer || !candidateRenderer || !canonicalCamera || !candidateCamera || !canonicalCloud || !candidateCloud) return;
      if (auditRunning) { frame = requestAnimationFrame(render); return; }
      updateCamera(canonicalCamera); updateCamera(candidateCamera);
      // Readiness is time based, but field rebuild/upload is throttled because
      // this is intentionally a CPU blending diagnostic.
      const now = performance.now();
      if (now - lastBlendUpdate > 120) { lastBlendUpdate = now; updateField(); }
      canonicalCloud.render(scene, canonicalCamera); candidateCloud.render(scene, candidateCamera);
      frame = requestAnimationFrame(render);
    };
    render();
    window.addEventListener('pagehide', () => { alive = false; if (pendingTimer) clearTimeout(pendingTimer); cancelAnimationFrame(frame); canonicalCloud?.dispose(); candidateCloud?.dispose(); canonicalRenderer?.dispose(); candidateRenderer?.dispose(); }, { once: true });
  } catch (error) { setStatus('WebGPU unavailable', String(error)); report(); }
}

void main();
