import { Color, PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createReferenceCloud } from '../../../packages/three/src/volumetric';
import { sharedBackend } from '../../../packages/three/src/gpu/backend';
import { createCumulusField } from '../../../experiments/cumulus/source';
import { coarsenDensityField, extractAtlasField, runDensityAudit } from './audit';
import { compareOpticalImages } from '../../../experiments/lod/image-metrics';
import '../lod-study/style.css';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
document.querySelector('#app')!.innerHTML = `
<header><h1>P2.7 · Cumulus density study</h1><a href="/cloudscape/">World coverage</a><a href="/lighting-bench/">Lighting isolation</a></header>
<p>Compare broad shape, billows and eroded edges. Drag the left image to orbit both views; scroll to approach. These are source candidates, not accepted realistic clouds.</p>
<div class="controls">
<label>Comparison<select id="comparison"><option value="placeholder">Placeholder → new cumulus</option><option value="coarse">New cumulus fine → coarse</option></select></label>
<label>Lighting<select id="lighting"><option value="lit">Reference-lit · 128 sun samples</option><option value="dense">Reference-lit · 512 sun samples (slow)</option><option value="unlit">Unshadowed density</option></select></label>
<label>Candidate erosion<input id="erosion" type="range" min="0" max="1" step="0.05" value="0.55"></label>
<label>Density<input id="density" type="range" min="0" max="2" step="0.05" value="1"></label>
<label>Candidate seed<select id="seed"><option>17</option><option>29</option><option>53</option></select></label>
<label>Candidate voxels<select id="resolution"><option value="96">96³</option><option value="64">64³</option></select></label>
<label>Placeholder form<select id="tile">${Array.from({length:8},(_,i)=>`<option value="${i}">${i+1}</option>`).join('')}</select></label>
<label>Sun angle<select id="sun"><option value="side">Side light</option><option value="back">Backlight</option><option value="front">Front light</option></select></label>
<div class="button-row"><button id="overview">Overview</button><button id="close">Close</button><button id="inside">Inside</button><button id="far">12 km</button></div>
<div class="button-row"><button id="orbit">Play orbit</button><button id="approach">Play approach</button></div>
<div class="button-row"><button id="verify">Run source/render checks</button><button id="audit">Measure source LOD</button><button id="cancel" disabled>Cancel audit</button></div>
<div class="button-row"><button id="capture">Save comparison</button><button id="export">Export evidence</button></div></div>
<p class="notice">Judge density structure separately from lighting. Self-shadow bands can remain in lit modes. No atmosphere, temporal upscaling or performance preset is being certified here. Both panes have a fixed visible separator.</p>
<div class="panes"><section class="pane"><h2 id="leftTitle">Placeholder · 48³</h2><div id="left"></div></section><section class="pane"><h2 id="rightTitle">Cumulus candidate · 96³</h2><div id="right"></div></section></div>
<p id="status" role="status">Generating density…</p><div id="auditSummary"></div><details><summary>Evidence</summary><pre id="evidence"></pre></details>
<h2>Review gate</h2><p>Does the new source read as a plausible cumulus: a broad connected body, flatter base, varied billows and soft irregular edges? Check overview, close and orbit. Fail density for detached fuzz, conspicuous voxel stairs, repeated stripes, sliced edges or a shape that collapses when coarsened. Report lighting bands separately. Choose a preferred seed/erosion before this replaces the world atlas.</p>`;

async function main() {
  let busy = false, cancelled = false, alive = true, dirty = true;
  let animation: 'none' | 'orbit' | 'approach' = 'none', elapsed = 0, last = 0;
  let checks: unknown = null; let audit: Awaited<ReturnType<typeof runDensityAudit>> | null = null;
  const errors: string[] = [];
  const start = performance.now();
  let candidate = createCumulusField(), generationMs = performance.now() - start;
  let placeholder = extractAtlasField(0), coarse = coarsenDensityField(candidate);
  const renderers = [new WebGPURenderer({antialias:false}), new WebGPURenderer({antialias:false})];
  await Promise.all(renderers.map(r => r.init()));
  const devices = renderers.map(r => sharedBackend(r).device);
  const fail = (e: unknown) => { const text = e instanceof Error ? e.message : String(e); errors.push(text); $('status').textContent = text; };
  devices.forEach(device => device.addEventListener('uncapturederror', event => fail(event.error.message)));
  const scene = new Scene(); scene.background = new Color('#769cb6');
  const cameras = renderers.map(r => { const c = new PerspectiveCamera(42, 1, .1, 100000); c.coordinateSystem = r.coordinateSystem; return c; });
  const occluder = { min:[50000,50000,50000] as const, max:[50001,50001,50001] as const };
  const clouds = renderers.map((r,i) => createReferenceCloud(r, i ? candidate : placeholder, occluder));
  ['left','right'].forEach((id,i) => { renderers[i].setPixelRatio(1); $(id).appendChild(renderers[i].domElement); });
  const controls = new OrbitControls(cameras[0], renderers[0].domElement); controls.target.set(0,1700,0); controls.minDistance = 30; controls.maxDistance = 30000;
  controls.addEventListener('change', () => { dirty = true; });
  function pose(distance: number, angle = .55) { cameras[0].position.set(Math.sin(angle)*distance,1700+distance*.08,Math.cos(angle)*distance); controls.target.set(0,1700,0); controls.update(); dirty = true; }
  function dimensions() {
    if (busy) return;
    const width = Math.max(1, Math.floor($('left').clientWidth)); const height = Math.min(480, Math.max(300, Math.floor(innerHeight*.5)));
    renderers.forEach((r,i) => { r.setSize(width,height,false); r.domElement.style.height = `${height}px`; cameras[i].aspect=width/height; cameras[i].updateProjectionMatrix(); clouds[i].resize(width,height); }); dirty=true;
  }
  function settings() {
    const lighting = $<HTMLSelectElement>('lighting').value;
    const sun = $<HTMLSelectElement>('sun').value;
    clouds.forEach(cloud => {
      Object.assign(cloud.settings,{viewSteps:256,lightSteps:lighting==='dense'?512:128,constantLight:lighting==='unlit',castShadow:false,receiveShadow:false,occupancy:false,densityMultiplier:Number($<HTMLInputElement>('density').value)});
      cloud.settings.sunDirection.set(...(sun==='back' ? [-.4,.5,-.8] : sun==='front' ? [.4,.5,.8] : [-.8,.6,.1]) as [number,number,number]).normalize();
    });
  }
  function fields() {
    const compareCoarse = $<HTMLSelectElement>('comparison').value === 'coarse';
    clouds[0].setField(compareCoarse ? candidate : placeholder); clouds[1].setField(compareCoarse ? coarse : candidate);
    $('leftTitle').textContent = compareCoarse ? `Cumulus fine · ${candidate.descriptor.dimensions.join('×')}` : `Placeholder ${Number($<HTMLSelectElement>('tile').value)+1} · 48³`;
    $('rightTitle').textContent = compareCoarse ? `Same cumulus coarse · ${coarse.descriptor.dimensions.join('×')}` : `Cumulus candidate · ${candidate.descriptor.dimensions.join('×')}`;
    dirty=true;
  }
  function evidence() { return { phase:'P2.7 density candidate', generatedAt:new Date().toISOString(), browser:navigator.userAgent, devices:devices.map(d=>({vendor:d.adapterInfo.vendor,architecture:d.adapterInfo.architecture,description:d.adapterInfo.description})), generationMs, source:candidate.descriptor, controls:{seed:$<HTMLSelectElement>('seed').value,erosion:$<HTMLInputElement>('erosion').value,comparison:$<HTMLSelectElement>('comparison').value,lighting:$<HTMLSelectElement>('lighting').value,density:$<HTMLInputElement>('density').value},camera:cameras[0].position.toArray(),clouds:clouds.map(c=>c.evidence),checks,audit,errors:[...errors], limitations:['two diagnostic renderers','unaccepted source appearance','known reference lighting limitations','no world streaming or performance claim'] }; }
  function draw() { cameras[1].position.copy(cameras[0].position); cameras[1].quaternion.copy(cameras[0].quaternion); clouds.forEach((cloud,i)=>cloud.render(scene,cameras[i])); $('evidence').textContent=JSON.stringify(evidence(),null,2); dirty=false; }
  function stop() { animation='none'; $('orbit').textContent='Play orbit'; $('approach').textContent='Play approach'; }
  function lock(value:boolean) { busy=value; controls.enabled=!value; document.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,button,select').forEach(e=>e.disabled=value); $<HTMLButtonElement>('cancel').disabled=!value; }
  function regenerate() { stop(); const t=performance.now(); candidate=createCumulusField({resolution:Number($<HTMLSelectElement>('resolution').value) as 64|96,seed:Number($<HTMLSelectElement>('seed').value),erosion:Number($<HTMLInputElement>('erosion').value)}); generationMs=performance.now()-t; coarse=coarsenDensityField(candidate); checks=null; audit=null; $('auditSummary').textContent=''; fields(); $('status').textContent='Source regenerated. Appearance and optical acceptance remain open.'; }
  for (const id of ['seed','resolution','erosion']) $(id).onchange=()=>{try{regenerate();}catch(e){fail(e);}};
  $('tile').onchange=()=>{placeholder=extractAtlasField(Number($<HTMLSelectElement>('tile').value));fields();};
  $('comparison').onchange=fields;
  for (const id of ['density','lighting','sun']) $(id).onchange=()=>{settings();dirty=true;};
  for (const [id,distance] of [['overview',5000],['close',2200],['inside',200],['far',12000]] as const) $(id).onclick=()=>{stop();pose(distance);};
  for (const mode of ['orbit','approach'] as const) $(mode).onclick=()=>{const toggle=animation!==mode;stop();if(toggle){animation=mode;elapsed=0;$(mode).textContent='Pause';}};
  $('cancel').onclick=()=>{cancelled=true;};
  $('verify').onclick=async()=>{
    if(busy)return;stop();lock(true);checks=null;devices.forEach(d=>d.pushErrorScope('validation'));
    try {
      const results: {name:string;passed:boolean;value:number}[]=[];
      const add=(name:string,value:number,tolerance=0)=>results.push({name,value,passed:Number.isFinite(value)&&value<=tolerance});
      clouds.forEach(c=>{c.setField(candidate);c.resize(96,96);Object.assign(c.settings,{viewSteps:256,constantLight:true,castShadow:false,receiveShadow:false,densityMultiplier:1});});
      const camera=new PerspectiveCamera(42,1,.1,100000);camera.coordinateSystem=renderers[0].coordinateSystem;camera.position.set(2800,2100,4200);camera.lookAt(0,1700,0);
      clouds.forEach(c=>c.render(scene,camera,false));const a=await clouds[0].readOptical(),b=await clouds[1].readOptical();
      add('Two panes agree for the same source',compareOpticalImages(a,b,96,96).maxAbsT,.001);
      add('Candidate contains visible density',a.some((n,i)=>i%4===3&&n<.95)?0:1);
      add('Optical output is finite',a.every(Number.isFinite)&&b.every(Number.isFinite)?0:1);
      clouds[0].settings.densityMultiplier=0;clouds[0].render(scene,camera,false);const empty=await clouds[0].readOptical();
      add('Zero density clears the source exactly',empty.reduce((m,n,i)=>Math.max(m,Math.abs(n-(i%4===3?1:0))),0));
      clouds[0].settings.densityMultiplier=1;clouds[0].settings.constantLight=false;clouds[0].settings.lightSteps=128;clouds[0].render(scene,camera,false);const lit=await clouds[0].readOptical();
      add('Self-lighting does not change transmittance',compareOpticalImages(a,lit,96,96).maxAbsT,0);
      checks=results;$('status').textContent=results.every(r=>r.passed)?'Source/render checks pass. Human shape review still required.':'Checks need attention; see Evidence.';
    }catch(e){fail(e);}finally{for(const d of devices){const e=await d.popErrorScope();if(e)fail(e.message);}lock(false);fields();settings();dimensions();}
  };
  $('audit').onclick=async()=>{
    if(busy)return;stop();lock(true);cancelled=false;audit=null; $('auditSummary').textContent='';devices.forEach(d=>d.pushErrorScope('validation'));
    try { audit=await runDensityAudit({renderer:renderers[0],scene,reference:clouds[0],candidate:clouds[1],fields:[...Array.from({length:8},(_,i)=>extractAtlasField(i)),candidate],cancelled:()=>cancelled||!alive,progress:s=>{$('status').textContent=s;}});$('status').textContent='Optical sweep complete. These gates judge coarsening, not realistic appearance or lighting.';
      $('auditSummary').innerHTML='<table><thead><tr><th>Source</th><th>Converged poses</th><th>Coarse passes</th><th>Half-blend passes</th><th>Worst coarse ΔT</th></tr></thead><tbody>'+audit.sources.map(source=>{
        const direct=source.rows.map(row=>row.comparisons[0]);
        return `<tr><td>${source.source}</td><td>${source.rows.filter(row=>row.converged).length}/${source.rows.length}</td><td>${direct.filter(c=>c.usableAtThisPose).length}/${direct.length}</td><td>${source.rows.filter(row=>row.comparisons[1]?.usableAtThisPose).length}/${source.rows.length}</td><td>${Math.max(...direct.map(c=>c.metrics.maxAbsT)).toFixed(4)}</td></tr>`;
      }).join('')+'</tbody></table><p>All fields use common bounds and extinction 0.003/m for comparison. This does not certify the stronger densities or varying bounds in the world viewer. Inconclusive and failed rows are retained in exported evidence.</p>'; }
    catch(e){if(cancelled)$('status').textContent='Audit cancelled; no partial result accepted.';else fail(e);}finally{for(const d of devices){const e=await d.popErrorScope();if(e)fail(e.message);}lock(false);fields();settings();dimensions();}
  };
  $('capture').onclick=()=>{
    draw();const canvas=document.createElement('canvas'),width=renderers[0].domElement.width,height=renderers[0].domElement.height;
    canvas.width=width*2+8;canvas.height=height+40;const context=canvas.getContext('2d')!;
    context.fillStyle='#10212c';context.fillRect(0,0,canvas.width,canvas.height);context.fillStyle='#e3edf2';context.font='16px system-ui';
    renderers.forEach((r,i)=>{context.fillText($(i?'rightTitle':'leftTitle').textContent??'',i*(width+8)+12,26);context.drawImage(r.domElement,i*(width+8),40);});
    canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='clouds-density-comparison.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');
  };
  $('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(evidence(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='clouds-density-study.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const observer=new ResizeObserver(dimensions);observer.observe($('left'));
  fields();settings();pose(5000);dimensions();$('status').textContent='Ready for source comparison. Lighting remains provisional.';
  function frame(t:number){if(!alive)return;const dt=Math.min(.05,(t-last)/1000);last=t;if(!busy){if(animation!=='none'){elapsed+=dt;pose(animation==='orbit'?5000:12000-11000*(.5-.5*Math.cos(elapsed*Math.PI/12)),animation==='orbit'?.55+elapsed*.15:.55);}if(dirty)try{draw();}catch(e){fail(e);stop();dirty=false;}}requestAnimationFrame(frame);}
  requestAnimationFrame(frame);
  window.addEventListener('pagehide',()=>{alive=false;cancelled=true;observer.disconnect();controls.dispose();clouds.forEach(c=>c.dispose());renderers.forEach(r=>r.dispose());},{once:true});
}
void main().catch(e=>{$('status').textContent=e instanceof Error?e.message:String(e);});
