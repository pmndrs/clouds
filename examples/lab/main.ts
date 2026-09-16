import './style.css';
import { WebGPURenderer, ACESFilmicToneMapping, Scene, PerspectiveCamera, PlaneGeometry, Mesh, MeshBasicNodeMaterial, Vector2 } from 'three/webgpu';
import { texture, texture3D, uv, vec3, uniform } from 'three/tsl';
import { CONTRACT_VERSION } from '@clouds/core';
import { createLabScheduler } from './scenes/integration-probes/scheduler';
import { createLightingProbe } from './scenes/integration-probes/lighting';
import { createInteropProbe, type InteropProbeReport } from './scenes/interop';
import { MeasurementCollector, exportBenchmarkReport, downloadCanvasCapture, createDefaultCameraPaths, sampleCameraPath } from './harness';
import compatibility from '../../fixtures/compatibility.json';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<div class="shell"><aside class="sidebar"><header><span class="eyebrow">pmndrs / clouds</span><h1>Rendering lab</h1><span class="badge">P0 · Foundation</span><p>Validate the connections before building the cloudscape.</p></header><section class="section"><h2>INTEGRATION SCENE</h2><div class="stack"><button id="lighting" class="full">01 &nbsp; Sky, light & environment</button><button id="interop" class="full" disabled>02 &nbsp; Direct GPU sharing</button></div></section><section class="section"><h2>CONTROLS</h2><div id="light-controls"><label for="sun">Sun elevation <span id="sun-value">35°</span></label><input id="sun" type="range" min="8" max="75" value="35"><div class="row"><label for="contribution">Environment contribution</label><input id="contribution" type="checkbox" checked></div><div class="row"><label for="path">Camera</label><select id="path"><option value="fixed">Fixed</option><option value="ground">Ground</option><option value="side">Side</option><option value="interior">Interior fixture</option></select></div><input aria-label="Camera path time" id="path-time" type="range" min="0" max="4" step="0.01" value="0"></div><div id="gpu-controls" hidden><label for="slice">Volume slice</label><input id="slice" type="range" min="0" max="1" step="0.01" value="0.5"></div><button id="verify" class="full" disabled>Run GPU checks</button></section><section class="section"><h2>VALIDATION</h2><div id="status" class="result" role="status">Initializing WebGPU…</div><details><summary>Evidence</summary><pre id="evidence"></pre></details></section><section class="section"><h2>CAPTURE</h2><div class="stack"><button id="report" disabled>Export report</button><button id="capture" disabled>Save image</button></div></section><div class="footer"><a href="/clouds/">Open first voxel cloud →</a><br><a href="/layer-only/">Independent 2D layer →</a><br>Three.js r186 · contract v${CONTRACT_VERSION}<br>TSL + direct WGSL · one GPU device<br>Diagnostic fixtures, not cloud rendering.</div></aside><main class="main"><header class="topbar"><div><h2 id="scene-name">Sky, light & environment</h2><p id="scene-desc">Diffuse and specular lighting · directional shadows</p></div><span id="backend" class="badge">Connecting</span></header><div id="stage" class="stage"><div id="caption" class="caption">The cyan block is a diagnostic contribution baked into the sky environment. Toggle it to inspect reflections and lighting.</div></div><footer class="statusbar"><span>Device <strong id="device">—</strong></span><span>Output <strong id="resolution">—</strong></span><span>CPU submit <strong id="timing">—</strong></span></footer></main></div>`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const errors: string[]=[];
let alive=true;
let runningChecks=false;
let renderer: WebGPURenderer;
let lighting: ReturnType<typeof createLightingProbe>;
let probe: ReturnType<typeof createInteropProbe>;
let raf=0;
let scheduler: ReturnType<typeof createLabScheduler>;
let mode: 'lighting' | 'interop' = 'lighting';
let measurements=new MeasurementCollector(30);
let lastTime=0, lastUi=0;
const reports: InteropProbeReport[]=[];
let disposalPassed=false;
function fail(error: unknown) { const message = error instanceof Error ? error.message : String(error); errors.push(message); $('status').textContent=message; $('status').classList.add('error'); console.error(error); }

async function boot() {
  if (!navigator.gpu) throw new Error('WebGPU is unavailable in this browser. Open this lab in a WebGPU-enabled desktop browser.');
  renderer=new WebGPURenderer({antialias:true}); await renderer.init();
  const backend=renderer.backend as unknown as {device:GPUDevice};
  backend.device.addEventListener('uncapturederror', e => fail((e as GPUUncapturedErrorEvent).error.message));
  void backend.device.lost.then(info => { if(alive) { cancelAnimationFrame(raf); fail(`GPU device lost: ${info.message || info.reason}. Reload to rebuild resources.`); } });
  renderer.setPixelRatio(1); renderer.shadowMap.enabled=true; renderer.toneMapping=ACESFilmicToneMapping; renderer.toneMappingExposure=0.3;
  $('stage').prepend(renderer.domElement);
  lighting=createLightingProbe(renderer);
  probe=createInteropProbe(renderer);
  const gpuScene=new Scene();
  const gpuCamera=new PerspectiveCamera(45,1,0.1,100); gpuCamera.position.set(0,0,5);
  const slice=uniform(0.5);
  const material2D=new MeshBasicNodeMaterial({colorNode:texture(probe.texture),toneMapped:false});
  const material3D=new MeshBasicNodeMaterial({colorNode:texture3D(probe.volumeTexture,vec3(uv(),slice)),toneMapped:false});
  const plane2D=new Mesh(new PlaneGeometry(1.8,1.8),material2D); plane2D.position.x=-1.05;
  const plane3D=new Mesh(new PlaneGeometry(1.8,1.8),material3D); plane3D.position.x=1.05; gpuScene.add(plane2D,plane3D);
  const info=backend.device.adapterInfo;
  $('device').textContent=info.description || info.architecture || info.vendor || 'WebGPU adapter';
  $('backend').textContent='WebGPU active';
  function resize() { const stage=$('stage'); renderer.setSize(stage.clientWidth,stage.clientHeight); for(const camera of [lighting.camera,gpuCamera]) {camera.aspect=stage.clientWidth/stage.clientHeight;camera.updateProjectionMatrix();} $('resolution').textContent=`${stage.clientWidth} × ${stage.clientHeight}`; measurements=new MeasurementCollector(30); }
  const observer=new ResizeObserver(resize); observer.observe($('stage')); resize();
  const draw=()=>{if(mode==='lighting')renderer.render(lighting.scene,lighting.camera);else renderer.render(gpuScene,gpuCamera)};
  scheduler=createLabScheduler(()=>{},draw);
  function buildReport() {
    const output=renderer.getDrawingBufferSize(new Vector2());
    return { schemaVersion:1 as const, generatedAt:new Date().toISOString(), runtime:{browser:navigator.userAgent,appVersion:'0.0.0',contractVersion:CONTRACT_VERSION}, device:{vendor:info.vendor,architecture:info.architecture,description:info.description,backend:'webgpu',limits:{maxTextureDimension3D:backend.device.limits.maxTextureDimension3D}}, resolutions:{render:[output.x,output.y] as const,output:[output.x,output.y] as const}, errors:[...errors], tests:reports.flatMap((r,i)=>[{name:`raw-to-TSL ${r.size}³ run ${i}`,passed:r.rawToTSL.passed,details:JSON.stringify(r.rawToTSL)},{name:`TSL-to-raw ${r.size}³ run ${i}`,passed:r.tslToRaw.passed,details:JSON.stringify(r.tslToRaw)},{name:`native-buffer ${r.size}³ run ${i}`,passed:r.nativeBufferValidated}]).concat([{name:'disposed probe rejects dispatch',passed:disposalPassed}]), metrics:measurements.summarize(), context:{mode,compatibility,lighting:lighting.evidence,gpuReports:reports,measurement:'CPU submission samples; GPU timestamps not collected',cameraPath:$<HTMLSelectElement>('path').value,cameraTime:Number($<HTMLInputElement>('path-time').value)} };
  }
  function updateEvidence() {
    $('evidence').textContent=JSON.stringify({phase:'P0',mode,lighting:lighting.evidence,interop:reports,disposalPassed,errors},null,2);
  }
  function frame(t:number) {
    if(!alive)return;
    if(!runningChecks) {
      const start=performance.now(); scheduler.step(t); const submitMs=performance.now()-start;
      if(measurements.count<630)measurements.add({frameIndex:measurements.count,timeSeconds:t/1000,cpuSubmitMs:submitMs,...(lastTime?{cpuFrameMs:t-lastTime}:{})});
      if(t-lastUi>500) { $('timing').textContent=`${submitMs.toFixed(2)} ms`; updateEvidence(); lastUi=t; }
      lastTime=t;
      if(measurements.count>30)$('report').removeAttribute('disabled');
    }
    raf=requestAnimationFrame(frame);
  }
  async function checks() {
    if(runningChecks)return;
    runningChecks=true; $('verify').setAttribute('disabled',''); $('status').classList.remove('error'); $('status').textContent='Checking raw WGSL ↔ TSL, resize and disposal…';
    reports.length=0;
    try {
      reports.push(await probe.run());
      await probe.resize(8); reports.push(await probe.run());
      await probe.resize(16); reports.push(await probe.run());
      const disposable=createInteropProbe(renderer,4); await disposable.run(); disposable.dispose(); disposable.dispose();
      try{await disposable.run();disposalPassed=false}catch{disposalPassed=true}
      const passed=reports.every(r=>r.rawToTSL.passed&&r.tslToRaw.passed&&r.nativeBufferValidated&&!r.gpuErrors.length)&&disposalPassed;
      $('status').textContent=passed?'Passed: WGSL ↔ TSL sharing, 2D/3D textures, native buffer, resize and disposal.':'GPU checks need attention. Open Evidence for details.';
      $('status').classList.toggle('error',!passed); $('interop').removeAttribute('disabled');
    } catch(e) {fail(e)} finally {runningChecks=false;measurements=new MeasurementCollector(30);lastTime=0;updateEvidence();$('verify').removeAttribute('disabled')}
  }
  function selectMode(next: typeof mode) {
    mode=next; measurements=new MeasurementCollector(30);lastTime=0;
    $('light-controls').hidden=mode!=='lighting'; $('gpu-controls').hidden=mode!=='interop';
    $('scene-name').textContent=mode==='lighting'?'Sky, light & environment':'Direct GPU sharing';
    $('scene-desc').textContent=mode==='lighting'?'Diffuse and specular lighting · directional shadows':'Raw WGSL ↔ TSL · shared storage textures and buffer';
    $('caption').textContent=mode==='lighting'?'The cyan block is a diagnostic contribution baked into the sky environment. Toggle it to inspect reflections and lighting.':'Left: computed 2D output. Right: a live slice through the shared 3D texture. The gradient is a known-pattern correctness fixture.';
  }
  $('lighting').onclick=()=>selectMode('lighting'); $('interop').onclick=()=>selectMode('interop');
  $('verify').onclick=()=>void checks();
  $('sun').oninput=()=>{ const value=Number($<HTMLInputElement>('sun').value); $('sun-value').textContent=`${value}°`; try{lighting.setSun(value);measurements=new MeasurementCollector(30)}catch(e){fail(e)} };
  $('contribution').onchange=()=>{try{lighting.setContribution($<HTMLInputElement>('contribution').checked);measurements=new MeasurementCollector(30)}catch(e){fail(e)}};
  $('slice').oninput=()=>{slice.value=Number($<HTMLInputElement>('slice').value)};
  const paths=createDefaultCameraPaths();
  function setCamera() {
    const name=$<HTMLSelectElement>('path').value;
    if(name==='fixed'){lighting.camera.position.set(8,5,10);lighting.camera.lookAt(0,1,0);lighting.camera.fov=48;}
    else {const pose=sampleCameraPath(paths[name as keyof typeof paths],Number($<HTMLInputElement>('path-time').value));lighting.camera.position.fromArray(pose.position);lighting.camera.up.fromArray(pose.up);lighting.camera.lookAt(...pose.target);lighting.camera.fov=pose.fovDegrees;}
    lighting.camera.updateProjectionMatrix();measurements=new MeasurementCollector(30);
  }
  $('path').onchange=setCamera; $('path-time').oninput=setCamera;
  $('report').onclick=()=>{try{const text=exportBenchmarkReport(buildReport());$('evidence').textContent=text; const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.download='clouds-p0-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}catch(e){fail(e)}};
  $('capture').removeAttribute('disabled'); $('capture').onclick=()=>{draw();void downloadCanvasCapture(renderer.domElement,'clouds-p0.png').catch(fail)};
  await checks(); raf=requestAnimationFrame(frame);
  window.addEventListener('pagehide',()=>{alive=false;cancelAnimationFrame(raf);observer.disconnect();scheduler.dispose();lighting.dispose();probe.dispose();plane2D.geometry.dispose();plane3D.geometry.dispose();material2D.dispose();material3D.dispose();renderer.dispose();},{once:true});
}
void boot().catch(fail);
