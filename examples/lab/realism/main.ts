/// <reference types="vite/client" />
import '../style.css';
import { WebGPURenderer, Scene, PerspectiveCamera, Vector3, ACESFilmicToneMapping, Mesh, PlaneGeometry, MeshBasicNodeMaterial } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SkyAtmosphereBaker } from '@pmndrs/sky';
import { createReferenceCloud } from '../../../packages/three/src/volumetric';
import { createCloudLayerField, summarizeCloudLayerField } from '../../../experiments/cloudscape-density/source';
import { decodeDenseAsset, type DenseDensityField } from '../../../packages/assets/src/index';
import { sharedBackend } from '../../../packages/three/src/gpu/backend';
import { downloadCanvasCapture } from '../harness';
import { runRealismChecks, runMorphologyChecks } from './checks';
import { createMorphologyNoise, type MorphologyNoiseResources } from '../../../packages/three/src/sources/morphology-noise';
import { createMorphologyDomain, MORPHOLOGY_BOUNDS } from '../../../packages/three/src/volumetric/morphology';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
document.querySelector('#app')!.innerHTML=`<div class="shell"><aside class="sidebar"><header><span class="eyebrow">pmndrs / clouds</span><h1>Cloud layer</h1><span class="badge">Realism development</span><p>Weather-driven volume, eroded detail and self-lighting. Drag to orbit; scroll to fly closer.</p></header>
<section class="section"><h2>WEATHER</h2><label>Cloud source<select id="source"><option value="morphology">Procedural · weather / shape / erosion</option><option value="houdini-detail">VDB import fixture · two noise passes</option><option value="houdini-billowy">VDB import fixture · billowy noise</option><option value="houdini-soft">VDB import fixture · reduced density</option><option value="houdini">VDB import fixture · baseline</option><option value="procedural">Previous procedural source</option></select></label><label>Domain<select id="domain"><option value="local">Local field · 4 km</option><option value="layer">Broad field · 9 km</option></select></label><label>Coverage<input id="coverage" type="range" min="0" max="1" step=".05" value=".55"></label><label>Edge erosion<input id="erosion" type="range" min="0" max="1" step=".05" value=".85"></label><label>Seed<select id="seed"><option>17</option><option>29</option><option>53</option></select></label><label>Weather scale (m)<input id="weatherScale" type="range" min="8000" max="24000" step="1000" value="10000"></label><label>Shape scale (m)<input id="shapeScale" type="range" min="1000" max="5000" step="250" value="2250"></label><label>Erosion scale (m)<input id="erosionScale" type="range" min="200" max="1200" step="50" value="450"></label><label>Optical density<input id="density" type="range" min="0" max="2" step=".05" value="1"></label><label>Sun elevation<input id="sun" type="range" min="5" max="85" value="35"></label></section>
<section class="section"><h2>VIEW</h2><button id="ground">Ground</button><button id="edge">Layer edge</button><button id="above">Above</button><button id="inside">Inside</button><button id="orbit">Play orbit</button><label>View samples<select id="steps"><option value="256">256</option><option value="512" selected>512</option></select></label><label>Light samples<select id="lightSteps"><option value="64">64</option><option value="128" selected>128</option><option value="256">256</option></select></label><label>Render scale<select id="scale"><option value=".5" selected>Half</option><option value=".75">75%</option><option value="1">Native</option></select></label><label>Display<select id="display"><option value="lit">Full lighting</option><option value="direct">Direct light + ambient</option><option value="unlit">Unshadowed density</option><option value="sky">Sky only</option></select></label></section>
<section class="section"><h2>AUTHORED DENSITY</h2><label>Load converted cloud<input id="asset" type="file" accept=".clda"></label><button id="procedural">Restore new procedural source</button><p>Bundled Houdini fixtures start from overlapping spherical particles. They validate import and transport; their shapes are not a realism reference. Load an authored cloud through the offline VDB converter.</p></section>
<section class="section"><div id="status" role="status" class="result">Preparing cloud density…</div><button id="verify">Run transport checks</button><button id="capture">Save image</button><button id="report">Export evidence</button><details><summary>Evidence</summary><pre id="evidence"></pre></details></section><div class="footer">Quality-first experiment. Reference target: three-geospatial.<br>Finite field, independent detail scale and approximate multiple scattering.<br><a href="/three/">Three integration</a> · <a href="/react/">React</a> · <a href="/reconstruction/">Reconstruction</a></div></aside><main class="main"><header class="topbar"><div><h2>Clouds from weather and volume data</h2><p>Shared WebGPU device · native density · sky integration</p></div><span id="device" class="badge">WebGPU</span></header><div id="stage" class="stage"></div></main></div>`;
async function main(){
 let initializingDevice:GPUDevice|null=null,setupCancelled=false;
 const cancelSetup=()=>{setupCancelled=true;initializingDevice?.destroy();};
 let disposeSetup=cancelSetup;
 window.addEventListener('pagehide',cancelSetup,{once:true});
 import.meta.hot?.dispose(()=>disposeSetup());
 const timeout=<T>(promise:Promise<T>,phase:string)=>Promise.race([promise,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error(`${phase} timed out; GPU initialization is unavailable in this browser session.`)),15000))]);
 $('status').textContent='Requesting WebGPU adapter…';const adapter=await timeout(navigator.gpu.requestAdapter(),'Adapter request');if(!adapter)throw new Error('No WebGPU adapter is available.');
 $('status').textContent='Requesting WebGPU device…';const deviceRequest=adapter.requestDevice({});
 deviceRequest.then(device=>{if(setupCancelled)device.destroy();else initializingDevice=device;},()=>{});
 let ownedDevice:GPUDevice;
 try{ownedDevice=await timeout(deviceRequest,'Device request');}catch(error){cancelSetup();throw error;}
 if(setupCancelled){ownedDevice.destroy();return;};
 const renderer=new WebGPURenderer({antialias:false,device:ownedDevice});$('status').textContent='Initializing Three renderer…';
 try{await timeout(renderer.init(),'Renderer initialization');}catch(error){cancelSetup();void renderer.dispose();throw error;}
 if(setupCancelled){void renderer.dispose();return;}
 renderer.setPixelRatio(1);renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=1;
 const device=sharedBackend(renderer).device;const errors:string[]=[];function fail(e:unknown){const message=e instanceof Error?e.message:String(e);errors.push(message);$('status').textContent=message;}
 device.addEventListener('uncapturederror',e=>fail(e.error.message));$('device').textContent=device.adapterInfo.architecture||'WebGPU';$('stage').appendChild(renderer.domElement);
 let generationMs=0;
 const bounds=()=>$<HTMLSelectElement>('domain').value==='local'?{min:[-2000,900,-2000] as const,max:[2000,3500,2000] as const}:MORPHOLOGY_BOUNDS;
 const noiseCache=new Map<number,MorphologyNoiseResources>();
 function noise(){const seed=Number($<HTMLSelectElement>('seed').value);let result=noiseCache.get(seed);if(!result){const start=performance.now();result=createMorphologyNoise({seed});generationMs=performance.now()-start;noiseCache.set(seed,result);}return result;}
 const generate=()=>{const start=performance.now();const result=createCloudLayerField({coverage:Number($<HTMLInputElement>('coverage').value),erosion:Number($<HTMLInputElement>('erosion').value),seed:Number($<HTMLSelectElement>('seed').value)});generationMs=performance.now()-start;return {...result,descriptor:{...result.descriptor,bounds:bounds()}};};

 const houdiniBaselineUrl=new URL('../../../fixtures/authored/vdb/houdini-cloudnoise.clda',import.meta.url).href;
 const houdiniDetailUrl=new URL('../../../fixtures/authored/vdb/houdini-cloudnoise-detail.clda',import.meta.url).href;
 const houdiniSoftUrl=new URL('../../../fixtures/authored/vdb/houdini-cloudnoise-soft.clda',import.meta.url).href;
 const houdiniBillowyUrl=new URL('../../../fixtures/authored/vdb/houdini-cloudnoise-billowy.clda',import.meta.url).href;
 const nativeUrl=()=>({'houdini-billowy':houdiniBillowyUrl,'houdini-detail':houdiniDetailUrl,'houdini-soft':houdiniSoftUrl,houdini:houdiniBaselineUrl}[$<HTMLSelectElement>('source').value]??houdiniBaselineUrl);
 let originalDescriptor: DenseDensityField['descriptor'] | null=null;
 function placeAsset(asset:DenseDensityField):DenseDensityField{
   originalDescriptor=asset.descriptor;
   const center=asset.descriptor.bounds.min.map((n,i)=>(n+asset.descriptor.bounds.max[i])*.5),offset=[-center[0],1700-center[1],-center[2]];
   return {...asset,descriptor:{...asset.descriptor,bounds:{min:asset.descriptor.bounds.min.map((n,i)=>n+offset[i]) as [number,number,number],max:asset.descriptor.bounds.max.map((n,i)=>n+offset[i]) as [number,number,number]}}};
 }
 let field:DenseDensityField=createMorphologyDomain(bounds());let statistics:ReturnType<typeof summarizeCloudLayerField>|null=null;let source='morphology';const scene=new Scene(),camera=new PerspectiveCamera(55,1,1,100000);camera.coordinateSystem=renderer.coordinateSystem;
 const groundMaterial=new MeshBasicNodeMaterial({color:0x34515c});
 const groundMesh=new Mesh(new PlaneGeometry(200000,200000),groundMaterial);groundMesh.rotation.x=-Math.PI/2;scene.add(groundMesh);
 const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1700,0);controls.maxDistance=40000;controls.minDistance=1;
 const sky=new SkyAtmosphereBaker(renderer,{cubeSize:128,enableAerialPerspective:false});
 const occluder={min:[50000,0,50000] as const,max:[50001,1,50001] as const};
 let cloud=createReferenceCloud(renderer,field,occluder,{appearance:'realistic',morphology:noise()});
 Object.assign(cloud.settings,{viewSteps:512,lightSteps:128,detailErosion:0,castShadow:false,receiveShadow:false});
 let alive=true,busy=false,dirty=true,playing=false,last=0,time=0;let tests:unknown=null;
 function setSun(){const elevation=Number($<HTMLInputElement>('sun').value),azimuth=235;sky.setSun({elevation,azimuth});sky.setCamera(camera);sky.update();scene.background=sky.texture;const e=elevation*Math.PI/180,a=azimuth*Math.PI/180;cloud.settings.sunDirection.set(Math.cos(e)*Math.sin(a),Math.sin(e),Math.cos(e)*Math.cos(a));dirty=true;}
 function pose(position:Vector3,target:Vector3){playing=false;$('orbit').textContent='Play orbit';camera.position.copy(position);controls.target.copy(target);controls.update();dirty=true;}
 function ground(){if(source!=='procedural'&&source!=='morphology'){const extent=new Vector3(...field.descriptor.bounds.max).sub(new Vector3(...field.descriptor.bounds.min)).length();pose(new Vector3(extent*.25,Math.max(150,field.descriptor.bounds.min[1]-100),extent*1.3),new Vector3(0,1700,0));return;}const local=$<HTMLSelectElement>('domain').value==='local';pose(local?new Vector3(400,150,3100):new Vector3(1500,150,6500),new Vector3(0,1700,0));}
 function resize(){if(busy)return;const rect=$('stage').getBoundingClientRect(),scale=Number($<HTMLSelectElement>('scale').value);const w=Math.max(1,Math.floor(rect.width*scale)),h=Math.max(1,Math.floor(rect.height*scale));renderer.setSize(Math.max(1,rect.width),Math.max(1,rect.height),false);cloud.resize(w,h);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();dirty=true;}
 function draw(){cloud.settings.constantLight=$<HTMLSelectElement>('display').value==='unlit';cloud.settings.directLightOnly=$<HTMLSelectElement>('display').value==='direct';cloud.settings.densityMultiplier=$<HTMLSelectElement>('display').value==='sky'?0:Number($<HTMLInputElement>('density').value);cloud.render(scene,camera);dirty=false;}
 function evidence(){return{date:new Date().toISOString(),source,originalDescriptor,displayPlacement:source==='procedural'||source==='morphology'?null:'translated to center Y=1700 m; scale, density and extinction unchanged',sourceStatistics:statistics,generationMs,camera:camera.position.toArray(),device:{vendor:device.adapterInfo.vendor,architecture:device.adapterInfo.architecture},runtime:cloud.evidence,tests,errors:[...errors]};}
 function sourceControls(){for(const id of ['coverage','erosion','seed','domain'])($<HTMLInputElement|HTMLSelectElement>(id)).disabled=source!=='procedural'&&source!=='morphology';for(const id of ['weatherScale','shapeScale','erosionScale'])$<HTMLInputElement>(id).disabled=source!=='morphology';}
 function lock(value:boolean){busy=value;controls.enabled=!value;document.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>('input,select,button').forEach(e=>e.disabled=value);if(!value)sourceControls();}
 function replaceRuntime(procedural:boolean){
   const next=createReferenceCloud(renderer,field,occluder,{appearance:'realistic',...(procedural?{morphology:noise()}: {})});
   Object.assign(next.settings,{viewSteps:Number($<HTMLSelectElement>('steps').value),lightSteps:Number($<HTMLSelectElement>('lightSteps').value),detailErosion:source==='procedural'?.4:0,castShadow:false,receiveShadow:false});
   next.settings.sunDirection.copy(cloud.settings.sunDirection);cloud.dispose();cloud=next;tests=null;resize();dirty=true;
 }
 function updateMorphology(){Object.assign(cloud.settings,{morphologyCoverage:Number($<HTMLInputElement>('coverage').value),morphologyErosion:Number($<HTMLInputElement>('erosion').value),weatherScale:Number($<HTMLInputElement>('weatherScale').value),shapeScale:Number($<HTMLInputElement>('shapeScale').value),erosionScale:Number($<HTMLInputElement>('erosionScale').value)});tests=null;dirty=true;}
 function selectProcedural(kind:'morphology'|'procedural'){
   source=kind;originalDescriptor=null;field=kind==='morphology'?createMorphologyDomain(bounds()):generate();statistics=kind==='morphology'?null:summarizeCloudLayerField(field);
   replaceRuntime(kind==='morphology');if(kind==='morphology')updateMorphology();sourceControls();$('status').textContent=kind==='morphology'?'Procedural formation ready. Weather, base boundary and erosion have independent scales.':'Previous baked density source loaded.';
 }
 for(const id of ['coverage','erosion','seed','domain','weatherScale','shapeScale','erosionScale'])$(id).onchange=()=>{if(busy)return;try{if(source==='morphology'&&id!=='seed'&&id!=='domain'){updateMorphology();}else selectProcedural(source==='morphology'?'morphology':'procedural');}catch(e){fail(e);}};
 $('procedural').onclick=()=>{$<HTMLSelectElement>('source').value='morphology';selectProcedural('morphology');};
 $('source').onchange=async()=>{const kind=$<HTMLSelectElement>('source').value;if(kind==='procedural'||kind==='morphology'){selectProcedural(kind);return;}lock(true);try{field=placeAsset(decodeDenseAsset(await(await fetch(nativeUrl())).arrayBuffer()));source='houdini-vdb-'+kind;statistics=summarizeCloudLayerField(field);replaceRuntime(false);$('status').textContent='Particle/noise VDB import fixture loaded. Shape remains provisional.';}catch(e){fail(e);}finally{lock(false);resize();}};

 $('asset').onchange=async()=>{const file=$<HTMLInputElement>('asset').files?.[0];if(!file)return;if(file.size>64*1024*1024){fail('Cloud asset exceeds 64 MiB viewer limit.');return;}lock(true);try{const next=decodeDenseAsset(await file.arrayBuffer());if(next.descriptor.encoding!=='r8unorm')throw new Error('Viewer currently requires r8unorm cloud density.');field=placeAsset(next);$<HTMLSelectElement>('source').value='houdini';statistics=summarizeCloudLayerField(field);source=file.name;replaceRuntime(false);const b=field.descriptor.bounds;const center=new Vector3(...b.min).add(new Vector3(...b.max)).multiplyScalar(.5),extent=new Vector3(...b.max).sub(new Vector3(...b.min)).length();pose(center.clone().add(new Vector3(extent*.2,extent*.1,extent*.8)),center);tests=null;$('status').textContent='Authored density loaded.';}catch(e){fail(e);}finally{lock(false);resize();}};
 $('ground').onclick=ground;$('edge').onclick=()=>{const b=field.descriptor.bounds,c=new Vector3(...b.min).add(new Vector3(...b.max)).multiplyScalar(.5),r=Math.max(...b.max.map((n,i)=>n-b.min[i]));pose(c.clone().add(new Vector3(r*.7,r*.15,r*.75)),c);};$('above').onclick=()=>{const b=field.descriptor.bounds,c=new Vector3(...b.min).add(new Vector3(...b.max)).multiplyScalar(.5),r=Math.max(...b.max.map((n,i)=>n-b.min[i]));pose(c.clone().add(new Vector3(0,r*.8,r*.9)),c);};$('inside').onclick=()=>{const b=field.descriptor.bounds,c=new Vector3(...b.min).add(new Vector3(...b.max)).multiplyScalar(.5);if(source==='morphology')c.y=b.min[1]+(b.max[1]-b.min[1])*.1;pose(c,c.clone().add(new Vector3(-500,100,-1000)));};
 $('orbit').onclick=()=>{playing=!playing;$('orbit').textContent=playing?'Pause':'Play orbit';};controls.addEventListener('change',()=>{dirty=true;});
 $('sun').onchange=setSun;for(const id of ['display','density'])$(id).onchange=()=>{dirty=true;};for(const[id,key]of[['steps','viewSteps'],['lightSteps','lightSteps']]as const)$(id).onchange=()=>{cloud.settings[key]=Number($<HTMLSelectElement>(id).value);dirty=true;};$('scale').onchange=resize;
 $('verify').onclick=async()=>{if(busy)return;lock(true);device.pushErrorScope('validation');try{tests=[...await runRealismChecks(renderer),...await runMorphologyChecks(renderer)];$('status').textContent=(tests as {passed:boolean}[]).every(t=>t.passed)?'Transport and cache checks pass. Visual quality remains in development.':'Transport checks need attention.';}catch(e){fail(e);}finally{const e=await device.popErrorScope();if(e)fail(e.message);lock(false);resize();}};
 $('capture').onclick=()=>{draw();void downloadCanvasCapture(renderer.domElement,'clouds-realism.png').catch(fail);};$('report').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(evidence(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='clouds-realism.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const observer=new ResizeObserver(resize);observer.observe($('stage'));updateMorphology();sourceControls();ground();resize();setSun();$('status').textContent='Procedural formation ready. Independent weather, shape and erosion scales.';
 function frame(t:number){if(!alive)return;if(!busy){if(playing){time+=Math.min(.05,(t-last)/1000);const b=field.descriptor.bounds,c=new Vector3(...b.min).add(new Vector3(...b.max)).multiplyScalar(.5),r=Math.max(...b.max.map((n,i)=>n-b.min[i]))*1.15;camera.position.set(c.x+Math.sin(time*.08)*r,c.y+Math.sin(time*.04)*r*.25,c.z+Math.cos(time*.08)*r);controls.target.copy(c);controls.update();dirty=true;}if(dirty)try{draw();$('evidence').textContent=JSON.stringify(evidence(),null,2);}catch(e){fail(e);dirty=false;playing=false;}}last=t;requestAnimationFrame(frame);}requestAnimationFrame(frame);
 window.removeEventListener('pagehide',cancelSetup);
 const cleanup=()=>{if(!alive)return;setupCancelled=true;alive=false;observer.disconnect();controls.dispose();cloud.dispose();sky.dispose();groundMesh.geometry.dispose();groundMaterial.dispose();void renderer.dispose().finally(()=>ownedDevice.destroy());};window.addEventListener('pagehide',cleanup,{once:true});disposeSetup=cleanup;
}
void main().catch(e=>{$('status').textContent=e instanceof Error?e.message:String(e);});
