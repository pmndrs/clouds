import '../../style.css';
import { WebGPURenderer, Scene, PerspectiveCamera, Color, Mesh, PlaneGeometry, SphereGeometry, MeshStandardNodeMaterial, DirectionalLight, HemisphereLight, ACESFilmicToneMapping, Vector2 } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createCloudscape, createCloudWorld, createCloudscapeAtlas, createReferenceCloud, createDensityField, type Cloudscape, type ReferenceCloud } from '@clouds/legacy-three';
import { createCloudLayer, type CloudLayer } from '@clouds/legacy-three/layers';
import { createCloudscapeEnvironment, type CloudscapeEnvironmentCapture } from '@clouds/legacy-three/environment';
import { runLifecycleChecks } from './lifecycle-checks';

const app = document.querySelector('#app')!;
app.innerHTML = `<div class="shell"><aside class="sidebar"><header><span class="eyebrow">pmndrs / clouds</span><h1>Three.js library</h1><span class="badge">P5 · Public API preview</span><p>One renderer, one host frame loop. Orbit or zoom to explore.</p></header><section class="section"><label>Runtime<select id="mode"><option value="world">Voxel cloudscape</option><option value="object">Single voxel object</option><option value="layer">Independent 2D layer</option></select></label><label>Density<input id="density" type="range" min="0" max="2" step="0.01" value="1"></label><button id="mount">Unmount clouds</button><button id="camera">Replace camera</button><button id="environment">Capture cloud environment</button><p>Environment capture is explicit and independent of the main camera.</p></section><section class="section"><div id="status" class="result">Initializing WebGPU…</div><pre id="evidence"></pre></section><p>Library preview. Banding, distant coverage and shadow quality remain open. Packaging is not visual acceptance.</p><a href="/legacy/react/">R3F v10 example</a><a href="/legacy/authored/">Authored assets</a><a href="/legacy/quality-bench/">Cloud quality bench</a><a href="/legacy/reconstruction/">Reconstruction review</a></aside><main class="main"><header class="topbar"><h2>Framework-free Three.js</h2><span class="badge" id="device">WebGPU</span></header><div id="stage" class="stage"></div><footer class="statusbar">Shared CPU sources · explicit resize, render and disposal</footer></main></div>`;
const $ = (id:string) => document.getElementById(id)!;
const lifecycleButton = document.createElement('button'); lifecycleButton.id = 'lifecycle'; lifecycleButton.textContent = 'Run shared-renderer lifecycle checks'; $('environment').after(lifecycleButton);
const lifecycleEvidence = document.createElement('pre'); lifecycleEvidence.id = 'lifecycleEvidence'; $('evidence').after(lifecycleEvidence);
const errors:string[]=[];
function fail(error:unknown) { const message=error instanceof Error?error.message:String(error);errors.push(message);$('status').textContent=message; }
async function boot() {
  const renderer = new WebGPURenderer({antialias:false}); await renderer.init(); renderer.setPixelRatio(1); renderer.toneMapping=ACESFilmicToneMapping;
  $('stage').append(renderer.domElement);
  const device=(renderer.backend as unknown as {device:GPUDevice}).device;
  device.addEventListener('uncapturederror',e=>fail((e as GPUUncapturedErrorEvent).error.message));
  $('device').textContent=device.adapterInfo.architecture;
  const scene=new Scene();scene.background=new Color(0xb6cddd);
  let camera=new PerspectiveCamera(55,1,1,80000);camera.coordinateSystem=renderer.coordinateSystem;
  const controls=new OrbitControls(camera,renderer.domElement);
  const material=new MeshStandardNodeMaterial({color:0x647f70}),ground=new Mesh(new PlaneGeometry(100000,100000),material);ground.rotation.x=-Math.PI/2;scene.add(ground);
  const sphereMaterial=new MeshStandardNodeMaterial({color:0xd4dedc,roughness:0.15,metalness:0.8}),sphere=new Mesh(new SphereGeometry(120,24,16),sphereMaterial);sphere.position.set(0,120,0);scene.add(sphere);
  const sun=new DirectionalLight(0xffedcf,3);sun.position.set(-2000,4000,1000);scene.add(sun,new HemisphereLight(0xc6def0,0x344034,2));
  const world=createCloudWorld(),atlas=createCloudscapeAtlas(),field=createDensityField('cumulus',64,17);
  let clouds:Cloudscape|null=null,object:ReferenceCloud|null=null,layer:CloudLayer|null=null,capture:CloudscapeEnvironmentCapture|null=null;
  let mode='world',mounted=true,created=0,disposed=0,cameraChanges=0,alive=true,raf=0,lastUI=0,capturing=false;
  function resize() {const w=Math.max(1,$('stage').clientWidth),h=Math.max(1,$('stage').clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();clouds?.resize(w,h);object?.resize(w,h);}
  function detach() { capture?.dispose();capture=null;clouds?.dispose();object?.dispose();if(layer){scene.remove(layer.mesh);layer.dispose();}if(clouds||object||layer)disposed++;clouds=null;object=null;layer=null; }
  function mount() {
    detach(); if(!mounted)return;
    if(mode==='world'){clouds=createCloudscape(renderer,atlas,world.snapshot);clouds.shadowReceiver.attach(material);clouds.shadowReceiver.attach(sphereMaterial);camera.position.set(4000,2300,6500);controls.target.set(0,1500,0);}
    else if(mode==='object'){object=createReferenceCloud(renderer,field,{min:[-2000,0,-2000],max:[-1900,100,-1900]});object.settings.castShadow=false;camera.position.set(900,450,1200);controls.target.set(0,350,0);}
    else {layer=createCloudLayer({radius:60000,height:6000,cloudScale:0.0008,wind:[10,4]});scene.add(layer.mesh);camera.position.set(4000,100,6500);controls.target.set(0,4000,0);}
    controls.update();created++;resize();$('environment').toggleAttribute('disabled',mode!=='world');$('status').textContent='Ready. Sources stay reusable across runtime disposal.';
  }
  $('mode').onchange=()=>{mode=($('mode') as HTMLSelectElement).value;mount();};
  $('mount').onclick=()=>{mounted=!mounted;$('mount').textContent=mounted?'Unmount clouds':'Mount clouds';mount();};
  $('camera').onclick=()=>{const next=camera.clone();camera=next;controls.object=next;cameraChanges++;resize();};
  $('environment').onclick=async()=>{
    if(!clouds||capturing)return;capturing=true;['environment','mode','mount'].forEach(id=>$(id).setAttribute('disabled','')); 
    const active=clouds;
    try {
      if(!capture)capture=createCloudscapeEnvironment(renderer,atlas,world.snapshot,{cubeSize:16,settingsSource:clouds});
      capture.cloudscape.setWorld(world.snapshot);capture.syncSettings(clouds);await capture.refresh();
      if(active===clouds){capture.attach(scene);$('status').textContent='Environment captured from a separate fixed probe.';}
    }catch(e){fail(e);}finally{capturing=false;['mode','mount'].forEach(id=>$(id).removeAttribute('disabled'));($('environment') as HTMLButtonElement).disabled=!clouds;}
  };
  $('lifecycle').onclick=async()=>{
    if(capturing)return;capturing=true;
    let outcome='';
    const ids=['lifecycle','environment','mode','mount','camera'];ids.forEach(id=>$(id).setAttribute('disabled',''));
    detach();
    try { const result=await runLifecycleChecks(renderer,message=>{$('status').textContent=message;});$('lifecycleEvidence').textContent=JSON.stringify(result,null,2);outcome=`PASS · ${result.checks.length} lifecycle checks`; }
    catch(error){fail(error);outcome=`FAIL · ${String(error)}`;$('lifecycleEvidence').textContent=outcome;}
    finally {capturing=false;ids.forEach(id=>$(id).removeAttribute('disabled'));mount();$('status').textContent=outcome;}
  };
  const observer=new ResizeObserver(resize);observer.observe($('stage'));mount();
  function frame(t:number) { if(!alive)return;if(capturing){raf=requestAnimationFrame(frame);return;}try {
    const density=Number(($('density') as HTMLInputElement).value);
    if(clouds){clouds.settings.density=density;clouds.setWorld(world.update(camera.position.toArray()));clouds.render(scene,camera);}
    else if(object){object.settings.densityMultiplier=density;object.render(scene,camera);}
    else {layer?.setDensity(Math.min(1,density));layer?.update(t/1000);renderer.render(scene,camera);}
    if(t-lastUI>500){const size=renderer.getDrawingBufferSize(new Vector2());$('evidence').textContent=JSON.stringify({mode,mounted,created,disposed,cameraChanges,renderSize:size.toArray(),environmentAttached:!!capture,errors},null,2);lastUI=t;}
  }catch(e){fail(e);alive=false;return;}raf=requestAnimationFrame(frame); }
  raf=requestAnimationFrame(frame);
  window.addEventListener('pagehide',()=>{alive=false;cancelAnimationFrame(raf);observer.disconnect();detach();controls.dispose();ground.geometry.dispose();sphere.geometry.dispose();material.dispose();sphereMaterial.dispose();renderer.dispose();},{once:true});
}
void boot().catch(fail);
