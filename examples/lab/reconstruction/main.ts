import { createLabRenderer } from '../harness/renderer';
import '../style.css';
import {
  WebGPURenderer, ACESFilmicToneMapping, Scene, PerspectiveCamera, Color, Vector3, Matrix4,
  Mesh, PlaneGeometry, BoxGeometry, SphereGeometry, MeshStandardNodeMaterial, MeshBasicNodeMaterial,
  DirectionalLight, HemisphereLight, WebGPUCoordinateSystem, QuadMesh,
} from 'three/webgpu';
import { texture, uv, uniform, mix, step, velocity, vec3 } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SkyAtmosphereBaker } from '@pmndrs/sky';
import { createCloudscape } from '../../../packages/three/src/cloudscape';
import { createCloudWorld } from '../../../packages/three/src/world';
import { createCloudscapeAtlas } from '../../../packages/three/src/sources/cloudscape-atlas';
import { createReconstructionAdapter } from '../../../packages/three/src/reconstruction/adapter';
import { createOpticalResolve } from '../../../packages/three/src/optical-resolve';
import { sampleCameraPath, type CameraPath } from '../../../bench/camera';
import { MeasurementCollector, downloadCanvasCapture } from '../harness';
import { createFlightClock } from '../cloudscape/playback';
import { createFrameTimer } from './frame-timer';
import { runReconstructionChecks } from './checks';

type Mode='native'|'bilinear'|'cloud'|'fsr1'|'fsr3';
const labels:Record<Mode,string>={native:'Native reference',bilinear:'Reduced + bilinear',cloud:'Cloud-only spatial',fsr1:'Final FSR1',fsr3:'Final FSR3 temporal'};
const modeOptions=Object.entries(labels).map(([value,label])=>`<option value="${value}" ${value==='fsr3'?'selected':''}>${label}</option>`).join('');
document.querySelector('#app')!.innerHTML=`<div class="shell"><aside class="sidebar"><header><span class="eyebrow">pmndrs / clouds</span><h1>Reconstruction</h1><span class="badge">P4 · Critical review</span><p>Compare reconstruction against native pixels at the same pose. Native still contains the known source and lighting defects.</p></header>
<section class="section"><h2>COMPARISON</h2><label>Method<select id="mode">${modeOptions}</select></label><label>Input scale<select id="scale"><option value="0.5">Half · 50%</option><option value="0.6666667" selected>67% · comparison default</option><option value="0.75">75%</option><option value="1">Native · 100%</option></select></label><div class="row"><label for="compare">Native comparison wipe</label><input id="compare" type="checkbox" checked></div><div class="row"><label for="divider">Show comparison divider</label><input id="divider" type="checkbox" checked></div><label>Left native / right selected<input id="wipe" type="range" min="0" max="1" step="0.01" value="0.5"></label><label>Sharpness<input id="sharpness" type="range" min="0" max="1" step="0.05" value="0.2"></label><label>Guide view<select id="debug"><option value="0">Final image</option><option value="1">Motion vectors</option><option value="2">Disocclusion</option><option value="3">Depth</option><option value="8">Reactivity</option></select></label><button id="reset">Reset history</button></section>
<section class="section"><h2>SCENARIOS</h2><div class="row"><button id="overview">Overview</button><button id="foreground">Foreground edges</button><button id="inside">Inside cloud</button></div><button id="cut">Camera cut</button><label>Fixed flight<input id="flight" type="range" min="0" max="40" step="0.02" value="12"></label><button id="play">Play flight</button><div class="row"><label for="move">Moving geometry</label><input id="move" type="checkbox"></div><label>Density<input id="density" type="range" min="0" max="2" step="0.01" value="0.7"></label><label>Sun elevation<input id="sun" type="range" min="10" max="80" value="40"></label><button id="source">Change world seed</button><label>Max cloud samples<select id="samples"><option value="320">320 · current baseline</option><option value="640">640 · spatial diagnostic</option></select></label></section>
<section class="section"><h2>SAMPLING DIAGNOSTICS</h2><label>Volume integration<select id="volume-quality"><option value="current">Current · 1× view / 48 light</option><option value="quality">Quality experiment · 4× view / 192 light</option><option value="dense">Dense light reference · 4× view / 256 light</option></select></label><p>The quality experiment takes four physical samples per primary segment. Expect higher cost; this is not an accepted preset.</p><div class="row"><label for="detail">Fine density detail</label><input id="detail" type="checkbox" checked></div><div class="row"><label for="detail-filter">Filter unresolved detail</label><input id="detail-filter" type="checkbox" checked></div><p>Filtering only addresses fine-detail aliasing. Compare the integration modes for the remaining volume bands.</p></section>
<section class="section"><h2>VERIFY & MEASURE</h2><div id="status" role="status" class="result">Preparing comparison…</div><button id="verify" class="full">Run P4 checks</button><label>Benchmark output<select id="resolution"><option value="1080">1920 × 1080</option><option value="180">320 × 180 · timing smoke only</option><option value="1440">2560 × 1440</option></select></label><button id="measure" class="full">Measure all five methods</button><p>Diagnostic timing: only FSR3 generates temporal guides; comparison runtimes stay allocated. Timings exclude the native wipe and environment capture. Preset acceptance remains open.</p><button id="capture">Save image</button><button id="report">Export evidence</button><details><summary>Live evidence</summary><pre id="evidence"></pre></details></section>
<section class="section"><h2>JUDGE CRITICALLY</h2><p><b>Fail reconstruction:</b> new trails, doubled edges, missing thin objects, halos, brightness shifts, stale pixels after cuts, or no net speed benefit.</p><p><b>Known unresolved defects:</b> limited far coverage, clouds fading before their shadows, repeated voxel forms, coarse cloud shadows, and approximate haze. Prominent volume banding remains an open defect; the integration modes are experimental. Known does not mean accepted for release.</p><p><b>Expected tradeoff:</b> reduced modes can soften fine detail. Moving geometry is supported; full cloud wind is not implemented. Cloud-only mode keeps opaque geometry at full resolution.</p></section>
<div class="footer"><a href="/lighting/">P3 lighting</a> · <a href="/cloudscape/">P2 coverage</a><br>P4 review pending · no validated preset yet</div></aside><main class="main"><header class="topbar"><div><h2 id="title">Native | FSR3 temporal</h2><p id="dimensions">—</p></div><span id="device" class="badge">WebGPU</span></header><div id="stage" class="stage"><div class="caption" id="caption">Left: native pixels. Right: selected method. Both retain source/LOD/lighting limitations. The comparison itself renders twice.</div></div><footer class="statusbar"><span id="metrics">—</span></footer></main></div>`;
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const input=(id:string)=>$<HTMLInputElement>(id);
const errors:string[]=[];
function fail(error:unknown){const message=error instanceof Error?error.message:String(error);errors.push(message);$('status').textContent=message;$('status').classList.add('error');console.error(error);}
function lock(value:boolean){document.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,button,select').forEach(e=>{e.disabled=value;});}
async function boot(){
  const renderer=await createLabRenderer({antialias:false}, true);await renderer.init();renderer.setPixelRatio(1);renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=0.85;renderer.shadowMap.enabled=true;$('stage').prepend(renderer.domElement);
  const device=(renderer.backend as unknown as {device:GPUDevice}).device;device.addEventListener('uncapturederror',event=>fail((event as GPUUncapturedErrorEvent).error.message));$('device').textContent=device.adapterInfo.description||device.adapterInfo.architecture||'WebGPU';
  const scene=new Scene(),camera=new PerspectiveCamera(58,1,1,80000),nativeCamera=new PerspectiveCamera();camera.coordinateSystem=WebGPUCoordinateSystem;camera.updateProjectionMatrix();
  const controls=new OrbitControls(camera,renderer.domElement);controls.maxDistance=40000;controls.minDistance=1;
  let seed=17,world=createCloudWorld({seed}),snapshot=world.snapshot;
  const atlas=createCloudscapeAtlas();
  const plainClouds=createCloudscape(renderer,atlas,snapshot),guidedClouds=createCloudscape(renderer,atlas,snapshot,{temporalGuides:true}),reference=createCloudscape(renderer,atlas,snapshot);
  let clouds=guidedClouds;
  const reconstruction=createReconstructionAdapter(renderer,{alpha:false}),resolve=createOpticalResolve(renderer);
  reconstruction.settings.sharpness=0.2;reconstruction.settings.autoExposure=false;
  velocity.setProjectionMatrix(reconstruction.unjitteredProjectionMatrix);
  const central=snapshot.cells.filter(c=>c.active).sort((a,b)=>Math.hypot(a.cellX,a.cellZ)-Math.hypot(b.cellX,b.cellZ))[0];
  const center=new Vector3().fromArray(central.bounds.min).add(new Vector3().fromArray(central.bounds.max)).multiplyScalar(0.5);
  const materials:MeshStandardNodeMaterial[]=[],meshes:Mesh[]=[];
  function copyCloudSettings(source:typeof plainClouds,target:typeof plainClouds){const from=source.settings as Record<string,unknown>,to=target.settings as Record<string,unknown>;for(const key of Object.keys(from)){const value=from[key],current=to[key];if(value instanceof Vector3&&current instanceof Vector3)current.copy(value);else to[key]=value;}}
  function selectCloudRuntime(next:typeof plainClouds){if(clouds===next)return;copyCloudSettings(clouds,next);for(const material of materials)clouds.shadowReceiver.detach(material);for(const material of materials)next.shadowReceiver.attach(material);clouds=next;}
  function add(geometry:PlaneGeometry|BoxGeometry|SphereGeometry,color:number,position:Vector3){const material=new MeshStandardNodeMaterial({color,roughness:0.8});materials.push(material);clouds.shadowReceiver.attach(material);const mesh=new Mesh(geometry,material);mesh.position.copy(position);mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);scene.add(mesh);return mesh;}
  const ground=add(new PlaneGeometry(100000,100000),0x708678,new Vector3());ground.rotation.x=-Math.PI/2;ground.castShadow=false;
  add(new BoxGeometry(350,1700,350),0xb69272,new Vector3(center.x-900,850,center.z+900));
  add(new SphereGeometry(250,32,24),0xc7d4d7,new Vector3(center.x+600,250,center.z+2100));
  for(let i=0;i<8;i++)add(new BoxGeometry(12+i*5,900,22),0x302b27,new Vector3(center.x-650+i*180,450,center.z+2100));
  const mover=add(new BoxGeometry(400,650,200),0x914c36,new Vector3(center.x,950,center.z+1900));
  const sun=new DirectionalLight(0xffebd0,3);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-7000,right:7000,top:7000,bottom:-7000,near:1,far:30000});sun.shadow.bias=-0.00015;sun.shadow.normalBias=2;sun.target.position.copy(center);scene.add(sun,sun.target,new HemisphereLight(0xc4d9ed,0x45534c,0.35));plainClouds.setDirectionalShadow(sun);guidedClouds.setDirectionalShadow(sun);reference.setDirectionalShadow(sun);
  const sky=new SkyAtmosphereBaker(renderer,{cubeSize:64,enableAerialPerspective:false});
  const sampleNode=texture(clouds.output),nativeNode=texture(reference.output),wipe=uniform(0.5),dividerVisible=uniform(1),outputWidth=uniform(1);
  // A one-pixel light line with a dark border stays legible on both sky and
  // cloud shadows. Drawing it in the presentation pass includes it in captures.
  const dividerDistance=uv().x.mul(outputWidth).floor().sub(wipe.mul(outputWidth).floor()).abs();
  const comparison=mix(nativeNode,sampleNode,step(wipe,uv().x));
  const bordered=mix(comparison,vec3(0.015),step(dividerDistance,1).mul(dividerVisible));
  const divided=mix(bordered,vec3(2),step(dividerDistance,0).mul(dividerVisible));
  const material=new MeshBasicNodeMaterial({colorNode:divided,depthTest:false,depthWrite:false});const quad=new QuadMesh(material);
  let alive=true,busy=false,playing=false,lastTime=0,simulation=0,raf=0,lastUI=0,width=1,height=1,mode:Mode='fsr3',resets=0,lastReset='startup',previousValid=false;
  const currentVP=new Matrix4(),previousVP=new Matrix4();
  const frameTimer=createFrameTimer(device);
  let tests:Awaited<ReturnType<typeof runReconstructionChecks>>=[],benchmarks:unknown[]=[],cpuSubmitMs=0;
  const path:CameraPath={name:'p4-ground-approach-inside',durationSeconds:40,keyframes:[
    {timeSeconds:0,position:[center.x,80,center.z+7500],target:[center.x,1500,center.z],up:[0,1,0],fovDegrees:58},
    {timeSeconds:12,position:[center.x+500,900,center.z+3400],target:[center.x,1100,center.z],up:[0,1,0],fovDegrees:58},
    {timeSeconds:20,position:center.toArray(),target:[center.x,center.y+50,center.z-2000],up:[0,1,0],fovDegrees:58},
    {timeSeconds:30,position:[center.x-1500,2600,center.z-6500],target:[center.x-1800,2000,center.z-9000],up:[0,1,0],fovDegrees:58},
    {timeSeconds:40,position:[center.x-2500,1500,center.z-15000],target:[center.x-3000,1400,center.z-18000],up:[0,1,0],fovDegrees:58},
  ]};
  const clock=createFlightClock(40);clock.seek(12);
  function invalidate(reason:string){reconstruction.resetHistory();previousValid=false;resets++;lastReset=reason;}
  function pose(position:Vector3,target:Vector3){camera.position.copy(position);controls.target.copy(target);camera.lookAt(target);controls.update();}
  function flight(t:number){const p=sampleCameraPath(path,t);pose(new Vector3().fromArray(p.position),new Vector3().fromArray(p.target));}
  flight(12);
  function setSun(){const elevation=Number(input('sun').value),angle=elevation*Math.PI/180,azimuth=235*Math.PI/180;clouds.settings.sunDirection.set(Math.cos(angle)*Math.sin(azimuth),Math.sin(angle),Math.cos(angle)*Math.cos(azimuth));copyCloudSettings(clouds,clouds===plainClouds?guidedClouds:plainClouds);sun.position.copy(center).addScaledVector(clouds.settings.sunDirection,15000);sky.setSun({elevation,azimuth:235});sky.setCamera(camera);sky.update();scene.background=sky.texture;scene.environment=sky.environmentTexture;invalidate('sun');}
  function configure(w:number,h:number,chosen:Mode=mode){width=w;height=h;outputWidth.value=w;mode=chosen;selectCloudRuntime(chosen==='fsr3'?guidedClouds:plainClouds);const scale=chosen==='native'?1:Number(input('scale').value),rw=Math.max(1,Math.round(w*scale)),rh=Math.max(1,Math.round(h*scale)),sceneWidth=chosen==='cloud'?w:rw,sceneHeight=chosen==='cloud'?h:rh;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();reconstruction.configure({displayWidth:w,displayHeight:h,renderWidth:rw,renderHeight:rh,mode:chosen==='fsr3'?'fsr3':chosen==='fsr1'?'fsr1':'native'});plainClouds.resize(rw,rh,sceneWidth,sceneHeight);guidedClouds.resize(rw,rh,sceneWidth,sceneHeight);reference.resize(w,h);resolve.resize(w,h);invalidate('mode/scale/resize');$('dimensions').textContent=`${w}×${h} output · ${rw}×${rh} cloud input · ${chosen==='cloud'?'full':'matching'}-resolution scene`;$('title').textContent=`Native | ${labels[chosen]}`;}
  function resize(){if(busy)return;configure(Math.max(1,$('stage').clientWidth),Math.max(1,$('stage').clientHeight),$<HTMLSelectElement>('mode').value as Mode);}
  const observer=new ResizeObserver(resize);observer.observe($('stage'));resize();setSun();
  function syncReference(){const a=clouds.settings,b=reference.settings;Object.assign(b,{density:a.density,stepMetres:a.stepMetres,maxSteps:a.maxSteps,viewSubsteps:a.viewSubsteps,lightSteps:a.lightSteps,detail:a.detail,detailFiltering:a.detailFiltering,distanceFade:a.distanceFade,shadows:a.shadows,geometryShadows:a.geometryShadows,hazeDensity:a.hazeDensity,hazeStrength:a.hazeStrength});b.sunDirection.copy(a.sunDirection);b.sunRadiance.copy(a.sunRadiance);b.ambientRadiance.copy(a.ambientRadiance);b.hazeColor.copy(a.hazeColor);}
  function draw(dt:number,compare=input('compare').checked){
    snapshot=world.update(camera.position.toArray());plainClouds.setWorld(snapshot);guidedClouds.setWorld(snapshot);reference.setWorld(snapshot);clouds.settings.density=Number(input('density').value);copyCloudSettings(clouds,clouds===plainClouds?guidedClouds:plainClouds);syncReference();
    camera.updateMatrixWorld();currentVP.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);if(!previousValid)previousVP.copy(currentVP);
    reconstruction.beginFrame(camera);
    try{clouds.setTemporalMatrices(currentVP,previousVP);clouds.render(scene,camera,false);
      if(mode==='cloud'){resolve.render(clouds.optical,clouds.sceneColor,clouds.sceneDepth,{cameraNear:camera.near,cameraFar:camera.far});sampleNode.value=resolve.output;}
      else if(mode==='native')sampleNode.value=clouds.output;
      else{reconstruction.dispatch({color:clouds.output,guides:mode==='fsr3'?clouds.guides!:undefined,deltaTime:dt},camera);sampleNode.value=reconstruction.outputTexture;}
    }finally{reconstruction.endFrame(camera);}
    previousVP.copy(currentVP);previousValid=true;
    if(compare){nativeCamera.copy(camera);nativeCamera.updateMatrixWorld();reference.render(scene,nativeCamera,false);nativeNode.value=reference.output;}
    wipe.value=compare?Number(input('wipe').value):0;dividerVisible.value=compare&&input('divider').checked?1:0;quad.render(renderer);
  }
  const evidence=()=>({phase:'P4',generatedAt:new Date().toISOString(),browser:navigator.userAgent,device:device.adapterInfo.architecture,mode,scale:Number(input('scale').value),display:[width,height],cloud:clouds.evidence,guideAllocation:{plain:{runtime:'plain',allocated:plainClouds.guides!==null,temporalGuides:plainClouds.evidence.temporalGuides},guided:{runtime:'guided',allocated:guidedClouds.guides!==null,temporalGuides:guidedClouds.evidence.temporalGuides}},camera:camera.position.toArray(),target:controls.target.toArray(),flightTime:clock.time,seed,resetCount:resets,lastReset,comparison:input('compare').checked,divider:input('divider').checked,wipe:Number(input('wipe').value),settings:{...reconstruction.settings},upscalerPassGpuMs:Object.fromEntries(reconstruction.gpuTimings),cpuSubmitMs,tests,benchmarks,errors:[...errors],limits:['Only FSR3 generates guides; both diagnostic runtimes stay allocated; production net benefit remains unverified','Known distance/LOD and shadow mismatch','Single representative cloud depth','Mixed pixels reactive','No full-cloud wind/advection','Approximate atmosphere','No accepted preset or RTX result']});
  function frame(t:number){if(!alive)return;if(!busy){try{const dt=lastTime?Math.min((t-lastTime)/1000,0.1):1/60;simulation+=dt;if(playing){clock.advance(dt*1000);input('flight').value=String(clock.time);flight(clock.time);if(clock.time>=40){playing=false;$('play').textContent='Play flight';}}if(input('move').checked)mover.position.x=center.x+Math.sin(simulation*1.2)*1200;const start=performance.now();draw(dt);cpuSubmitMs=performance.now()-start;if(t-lastUI>700){$('metrics').textContent=`${labels[mode]} · ${cpuSubmitMs.toFixed(2)} ms CPU submit · reset ${resets}: ${lastReset}`;$('evidence').textContent=JSON.stringify(evidence(),null,2);lastUI=t;}}catch(error){fail(error);alive=false;return;}}lastTime=t;raf=requestAnimationFrame(frame);}
  function stop(){playing=false;$('play').textContent='Play flight';}
  $('mode').onchange=resize;$('scale').onchange=resize;
  $('sharpness').oninput=()=>{reconstruction.settings.sharpness=Number(input('sharpness').value);invalidate('sharpness');};
  $('debug').onchange=()=>{reconstruction.settings.debugView=Number(input('debug').value);invalidate('debug view');};
  $('reset').onclick=()=>invalidate('manual');
  $('density').oninput=()=>invalidate('density');$('sun').oninput=setSun;
  $('volume-quality').onchange=()=>{const value=($('volume-quality') as HTMLSelectElement).value;clouds.settings.viewSubsteps=value==='current'?1:4;clouds.settings.lightSteps=value==='current'?48:value==='quality'?192:256;invalidate('volume integration quality');};
  $('detail-filter').onchange=()=>{clouds.settings.detailFiltering=input('detail-filter').checked;invalidate('detail filtering');};
  $('detail').onchange=()=>{clouds.settings.detail=input('detail').checked?0.16:0;invalidate('fine density detail');};
  $('samples').onchange=()=>{clouds.settings.maxSteps=Number(input('samples').value);invalidate('sample budget');};
  $('source').onclick=()=>{world=createCloudWorld({seed:++seed});invalidate('world source');};
  $('move').onchange=()=>invalidate('geometry animation');
  $('overview').onclick=()=>{stop();pose(center.clone().add(new Vector3(4000,2200,6000)),center);invalidate('overview cut');};
  $('foreground').onclick=()=>{stop();flight(12);clock.seek(12);input('flight').value='12';invalidate('foreground cut');};
  $('inside').onclick=()=>{stop();flight(20);clock.seek(20);input('flight').value='20';invalidate('inside cut');};
  $('cut').onclick=()=>{stop();const t=camera.position.distanceTo(center)<1500?12:20;flight(t);clock.seek(t);input('flight').value=String(t);invalidate('camera cut');};
  $('flight').oninput=()=>{stop();clock.seek(Number(input('flight').value));flight(clock.time);invalidate('timeline seek');};
  $('play').onclick=()=>{if(clock.time>=40){clock.seek(0);invalidate('flight restart');}playing=!playing;lastTime=0;$('play').textContent=playing?'Pause flight':'Play flight';};
  async function verify(){if(busy)return;busy=true;lock(true);$('status').textContent='Checking optical reconstruction and temporal guides…';device.pushErrorScope('validation');try{tests=await runReconstructionChecks(renderer);$('status').textContent=tests.every(t=>t.passed)?`Passed ${tests.length} P4 GPU checks. Human quality review pending.`:'P4 checks need attention. Open evidence.';}catch(error){fail(error);}finally{const e=await device.popErrorScope();if(e)fail(e.message);busy=false;lock(false);velocity.setProjectionMatrix(reconstruction.unjitteredProjectionMatrix);invalidate('verification completed');}}
  $('verify').onclick=()=>void verify();
  $('capture').onclick=()=>{draw(1/60);void downloadCanvasCapture(renderer.domElement,'clouds-p4-comparison.png').catch(fail);};
  $('report').onclick=()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(evidence(),null,2)],{type:'application/json'}));a.href=url;a.download='clouds-p4-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('measure').onclick=async()=>{
    if(busy)return;if(!frameTimer){$('status').textContent='GPU timestamps unavailable; no GPU performance claim.';return;}busy=true;lock(true);stop();benchmarks=[];mover.position.x=center.x;
    const savedPosition=camera.position.clone(),savedTarget=controls.target.clone(),savedMode=mode;const h=Number(input('resolution').value),w=Math.round(h*16/9);
    try{for(const selected of Object.keys(labels) as Mode[]){configure(w,h,selected);for(const time of [0,12,20]){flight(time);invalidate('benchmark clip');const data=new MeasurementCollector(32);for(let i=0;i<64;i++){if(h!==180)await new Promise<void>(r=>requestAnimationFrame(()=>r()));flight(Math.min(40,time+i/120));frameTimer.begin();const start=performance.now();draw(1/60,false);const cpuSubmitMs=performance.now()-start;const gpuMs=await frameTimer.end();data.add({frameIndex:i,timeSeconds:i/60,cpuSubmitMs,gpuMs});}$('status').textContent=`Measured ${labels[selected]} at flight ${time}s…`;benchmarks.push({mode:selected,clipStart:time,display:[w,h],internal:clouds.evidence.renderSize,scene:clouds.evidence.sceneSize,scale:selected==='native'?1:Number(input('scale').value),cloudSamples:clouds.settings.maxSteps,sharpness:reconstruction.settings.sharpness,metrics:data.summarize(),runtime:selected==='fsr3'?'guided':'plain',guideAllocation:{allocated:clouds.guides!==null,temporalGuides:clouds.evidence.temporalGuides},timer:'GPU queue span including scene/clouds/reconstruction/present and marker overhead; excludes wipe and environment refresh'});}}$('status').textContent='All five diagnostic methods measured. FSR3 is the only guide-enabled arm; production net benefit and visual acceptance remain unverified.';}catch(error){fail(error);}finally{pose(savedPosition,savedTarget);busy=false;mode=savedMode;lock(false);resize();invalidate('benchmark completed');}
  };
  window.addEventListener('pagehide',()=>{alive=false;cancelAnimationFrame(raf);observer.disconnect();controls.dispose();reconstruction.dispose();resolve.dispose();plainClouds.dispose();guidedClouds.dispose();reference.dispose();frameTimer?.dispose();sky.dispose();sun.shadow.dispose();meshes.forEach(m=>m.geometry.dispose());materials.forEach(m=>m.dispose());material.dispose();renderer.dispose();},{once:true});
  void device.lost.then(info=>{if(alive){alive=false;fail(`Device lost: ${info.reason}. Reload to rebuild.`);}});
  await plainClouds.compile(scene,camera);await guidedClouds.compile(scene,camera);await reference.compile(scene,camera);await verify();raf=requestAnimationFrame(frame);
}
void boot().catch(fail);
