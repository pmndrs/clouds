import '../../style.css';
import {
  WebGPURenderer, ACESFilmicToneMapping, Scene, PerspectiveCamera, Color, Vector3,
  Mesh, PlaneGeometry, BoxGeometry, SphereGeometry, MeshStandardNodeMaterial,
  DirectionalLight, HemisphereLight, WebGPUCoordinateSystem,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SkyAtmosphereBaker } from '@pmndrs/sky';
import { createCloudscape } from '../../../../packages/legacy/three/src/cloudscape';
import { createCloudWorld } from '../../../../packages/legacy/three/src/world';
import { createCloudscapeAtlas } from '../../../../packages/legacy/three/src/sources/cloudscape-atlas';
import { createCloudscapeEnvironment } from '../../../../packages/legacy/three/src/environment';
import { downloadCanvasCapture } from '../../harness';
import { runLightingChecks } from './checks';

document.querySelector('#app')!.innerHTML = `<div class="shell"><aside class="sidebar"><header><span class="eyebrow">pmndrs / clouds</span><h1>Light & sky</h1><span class="badge">P3 · Integration study</span><p>Clouds cast onto scene materials. Scene geometry casts into clouds. Drag to orbit.</p></header>
<section class="section"><h2>LIGHTING</h2><label>Sun elevation<input id="sun" type="range" min="5" max="85" value="40"></label><label>Cloud density<input id="density" type="range" min="0" max="2" step="0.01" value="0.7"></label><label>Occluder position<input id="caster" type="range" min="-2500" max="2500" step="10" value="0"></label><div class="row"><label for="animate">Move occluder</label><input id="animate" type="checkbox"></div><div class="row"><label for="shadows">Cloud shadows</label><input id="shadows" type="checkbox" checked></div><div class="row"><label for="geometry">Geometry casts into clouds</label><input id="geometry" type="checkbox" checked></div></section>
<section class="section"><h2>COMPOSITION</h2><div class="row"><label for="mode">View</label><select id="mode"><option value="composite">Sky + clouds</option><option value="sky">Sky only</option><option value="cloud">Clouds on black</option></select></div><button id="environment" class="full">Refresh environment</button><p id="env-status">Preparing separate environment capture…</p><button id="overview">Overview</button><button id="objects">Lighting objects</button><button id="occlusion">Cloud occluder</button></section>
<section class="section"><div id="status" role="status" class="result">Preparing lighting…</div><div class="stack"><button id="verify">Run P3 checks</button><button id="capture">Save image</button><button id="report">Export evidence</button></div><details><summary>Evidence</summary><pre id="evidence"></pre></details></section>
<div class="footer">R3: moving shadows, sun agreement and reflections.<br>Distance / LOD and spatial quality remain open.<br><a href="/legacy/cloudscape/">P2 cloudscape</a> · <a href="/legacy/clouds/">P1 reference</a></div></aside><main class="main"><header class="topbar"><div><h2>Clouds in the lighting system</h2><p>One directional sun · explicit material receivers · independent capture</p></div><span id="device" class="badge">WebGPU</span></header><div id="stage" class="stage"><div class="caption">Integration prototype: stylized clouds and coarse cloud-shadow cache. Distance fading is unchanged. Sky background uses pmndrs/sky; cloud haze remains an approximation.</div></div><footer class="statusbar"><span id="metrics">—</span></footer></main></div>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const errors: string[] = [];
function lockControls(locked:boolean){document.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,button,select').forEach(element=>{element.disabled=locked;});}
const fail = (error: unknown) => { const message = error instanceof Error ? error.message : String(error); errors.push(message); $('status').textContent = message; $('status').classList.add('error'); console.error(error); };

async function boot() {
  const renderer = new WebGPURenderer({ antialias: false }); await renderer.init();
  renderer.setPixelRatio(1); renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 0.85; renderer.shadowMap.enabled = true;
  $('stage').prepend(renderer.domElement);
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  device.addEventListener('uncapturederror', event => fail((event as GPUUncapturedErrorEvent).error.message));
  $('device').textContent = device.adapterInfo.description || device.adapterInfo.architecture || 'WebGPU';
  const atlas = createCloudscapeAtlas(), world = createCloudWorld({ radius: 4, coverage: 0.75 });
  const scene = new Scene(), camera = new PerspectiveCamera(55, 1, 1, 80000);
  camera.coordinateSystem = WebGPUCoordinateSystem; camera.updateProjectionMatrix();
  const controls = new OrbitControls(camera, renderer.domElement); controls.maxDistance = 35000; controls.minDistance = 10;
  const cloud = createCloudscape(renderer, atlas, world.snapshot); cloud.settings.density = 0.7;
  const central = world.snapshot.cells.filter(c => c.active).sort((a,b) => Math.hypot(a.cellX,a.cellZ)-Math.hypot(b.cellX,b.cellZ))[0];
  const center = new Vector3().fromArray(central.bounds.min).add(new Vector3().fromArray(central.bounds.max)).multiplyScalar(0.5);
  const materials: MeshStandardNodeMaterial[] = [], meshes: Mesh[] = [];
  function add(geometry: PlaneGeometry | BoxGeometry | SphereGeometry, material: MeshStandardNodeMaterial, position: Vector3) {
    const mesh = new Mesh(geometry, material); mesh.position.copy(position); mesh.receiveShadow = true; mesh.castShadow = true;
    cloud.shadowReceiver.attach(material); materials.push(material); meshes.push(mesh); scene.add(mesh); return mesh;
  }
  const ground = add(new PlaneGeometry(100000,100000), new MeshStandardNodeMaterial({ color:0x708678,roughness:1 }), new Vector3()); ground.rotation.x=-Math.PI/2; ground.castShadow=false;
  add(new BoxGeometry(300,1600,300),new MeshStandardNodeMaterial({color:0xba9272,roughness:0.8}),new Vector3(center.x-1400,800,center.z));
  add(new SphereGeometry(350,48,32),new MeshStandardNodeMaterial({color:0xdddddd,roughness:0.9}),new Vector3(center.x-500,350,center.z+2100));
  add(new SphereGeometry(350,48,32),new MeshStandardNodeMaterial({color:0xffffff,metalness:1,roughness:0.06}),new Vector3(center.x+500,350,center.z+2100));
  const caster=add(new BoxGeometry(1400,120,900),new MeshStandardNodeMaterial({color:0x765e55,roughness:0.7}),center.clone().add(new Vector3(0,1100,0)));
  const sun = new DirectionalLight(0xffedda,3); sun.castShadow=true; sun.shadow.mapSize.set(2048,2048); sun.shadow.camera.left=-7000;sun.shadow.camera.right=7000;sun.shadow.camera.top=7000;sun.shadow.camera.bottom=-7000;sun.shadow.camera.near=1;sun.shadow.camera.far=30000;sun.shadow.bias=-0.00015;sun.shadow.normalBias=2;
  sun.target.position.copy(center); scene.add(sun,sun.target,new HemisphereLight(0xc4d9ed,0x45534c,0.35)); cloud.setDirectionalShadow(sun);
  const sky=new SkyAtmosphereBaker(renderer,{cubeSize:64,enableAerialPerspective:false});
  const probeCamera=new PerspectiveCamera(90,1,1,80000);probeCamera.coordinateSystem=WebGPUCoordinateSystem;probeCamera.position.set(center.x,350,center.z+2100);probeCamera.updateMatrixWorld();
  let alive=true,checking=false,raf=0,lastUI=0,environmentDirty=true;
  let tests: Awaited<ReturnType<typeof runLightingChecks>>=[];
  const captureScene=new Scene();
  const captureWorld=createCloudWorld({radius:4,coverage:0.75}).update(probeCamera.position.toArray());
  const environment=createCloudscapeEnvironment(renderer,atlas,captureWorld,{cubeSize:64,probePosition:probeCamera.position,backgroundScene:captureScene,settingsSource:cloud});
  let environmentRefreshes=0,environmentRefreshWallMs=0;
  async function refreshEnvironment(){
    if(checking)return;checking=true;lockControls(true);$('env-status').textContent='Capturing six directions and filtering reflections…';
    const started=performance.now();
    try{
      environment.syncSettings(cloud);
      const mode=$<HTMLSelectElement>('mode').value;
      captureScene.background=mode==='cloud'?new Color(0):sky.texture;
      if(mode==='sky')environment.cloudscape.settings.density=0;
      await environment.refresh();environment.attach(scene);
      environmentRefreshes++;environmentRefreshWallMs=performance.now()-started;environmentDirty=false;
      $('env-status').textContent=`Fixed probe refreshed ${environmentRefreshes} time(s). Camera motion does not rebake it.`;
    }catch(error){fail(error);}finally{checking=false;lockControls(false);}
  }
  $('environment').onclick=()=>void refreshEnvironment();
  function dirtyEnvironment(){environmentDirty=true;$('env-status').textContent='Environment needs refresh (capture stays fixed until refreshed).';}
  function setSun(){
    const elevation=Number($<HTMLInputElement>('sun').value);sky.setSun({elevation,azimuth:235});sky.setCamera(probeCamera);sky.update();
    const angle=elevation*Math.PI/180,azimuth=235*Math.PI/180;
    cloud.settings.sunDirection.set(Math.cos(angle)*Math.sin(azimuth),Math.sin(angle),Math.cos(angle)*Math.cos(azimuth));
    sun.position.copy(center).addScaledVector(cloud.settings.sunDirection,15000);
    caster.position.copy(center).addScaledVector(cloud.settings.sunDirection,1100/cloud.settings.sunDirection.y);
    caster.position.x+=Number($<HTMLInputElement>('caster').value);
    const warm=new Color().setRGB(1,0.72+0.25*Math.sin(angle),0.48+0.42*Math.sin(angle));sun.color.copy(warm);
    cloud.settings.sunRadiance.set(warm.r,warm.g,warm.b).multiplyScalar(10.5);
    dirtyEnvironment();
  }
  setSun();
  function pose(position:Vector3,target:Vector3){camera.position.copy(position);controls.target.copy(target);camera.lookAt(target);controls.update();}
  const overview=()=>pose(center.clone().add(new Vector3(4800,2200,6500)),center.clone().add(new Vector3(0,-500,0)));
  overview();
  $('overview').onclick=overview;
  $('objects').onclick=()=>pose(new Vector3(center.x,650,center.z+4300),new Vector3(center.x,420,center.z+2100));
  $('occlusion').onclick=()=>pose(center.clone().add(new Vector3(2500,700,2800)),center);
  function resize(){const w=Math.max(1,$('stage').clientWidth),h=Math.max(1,$('stage').clientHeight);renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();cloud.resize(Math.round(w*0.65),Math.round(h*0.65));}
  const observer=new ResizeObserver(resize);observer.observe($('stage'));resize();
  function draw(){
    const mode=$<HTMLSelectElement>('mode').value;
    scene.background=mode==='cloud'?new Color(0):sky.texture;
    meshes.forEach(mesh=>{mesh.visible=mode!=='cloud';});
    if(mode==='sky') { cloud.shadowReceiver.setEnabled(false); renderer.render(scene,camera); }
    else {
      cloud.setWorld(world.update(camera.position.toArray()));
      const geometryShadows=cloud.settings.geometryShadows;
      try{if(mode==='cloud')cloud.settings.geometryShadows=false;cloud.render(scene,camera);}
      finally{cloud.settings.geometryShadows=geometryShadows;}
    }
  }
  const evidence=()=>({phase:'P3',generatedAt:new Date().toISOString(),browser:navigator.userAgent,device:device.adapterInfo.architecture,cloud:cloud.evidence,environmentDirty,environmentRefreshes,environmentRefreshWallMs,environment:environment.cloudscape.evidence,tests,errors:[...errors],limitations:['Distance/LOD unresolved','Single directional sun','Coarse shadow cache','Approximate cloud haze; no aerial-perspective LUT integration','Opaque meshes only']});
  function frame(t:number){if(!alive)return;if(!checking){try{if($<HTMLInputElement>('animate').checked){caster.position.x=center.x+cloud.settings.sunDirection.x*1100/cloud.settings.sunDirection.y+Math.sin(t/1800)*2000;}draw();if(t-lastUI>700){$('metrics').textContent=`Cloud cache updates: ${cloud.evidence.cacheUpdates} · Geometry map updates independently`; $('evidence').textContent=JSON.stringify(evidence(),null,2);lastUI=t;}}catch(error){fail(error);alive=false;return;}}raf=requestAnimationFrame(frame);}
  $('sun').oninput=setSun;
  $('mode').onchange=dirtyEnvironment;
  $('density').oninput=()=>{cloud.settings.density=Number($<HTMLInputElement>('density').value);dirtyEnvironment();};
  $('caster').oninput=()=>{caster.position.x=center.x+cloud.settings.sunDirection.x*1100/cloud.settings.sunDirection.y+Number($<HTMLInputElement>('caster').value);};
  $('shadows').onchange=()=>{cloud.settings.shadows=$<HTMLInputElement>('shadows').checked;};
  $('geometry').onchange=()=>{cloud.settings.geometryShadows=$<HTMLInputElement>('geometry').checked;};
  $('capture').onclick=()=>{draw();void downloadCanvasCapture(renderer.domElement,'clouds-p3.png').catch(fail);};
  $('report').onclick=()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(evidence(),null,2)],{type:'application/json'}));a.href=url;a.download='clouds-p3-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  async function verify(){if(checking)return;checking=true;lockControls(true);$('status').textContent='Checking directional shadows and cache order…';device.pushErrorScope('validation');try{tests=await runLightingChecks(renderer);$('status').textContent=tests.every(t=>t.passed)?`Passed ${tests.length} P3 GPU checks. Visual review pending.`:'P3 checks need attention. Open Evidence.';}catch(error){fail(error);}finally{const error=await device.popErrorScope();if(error)fail(error.message);checking=false;lockControls(false);}}
  $('verify').onclick=()=>void verify();
  window.addEventListener('pagehide',()=>{alive=false;cancelAnimationFrame(raf);observer.disconnect();controls.dispose();environment.dispose();cloud.dispose();sky.dispose();sun.shadow.dispose();meshes.forEach(m=>m.geometry.dispose());materials.forEach(m=>m.dispose());renderer.dispose();},{once:true});
  void device.lost.then(info=>{if(alive){alive=false;cancelAnimationFrame(raf);fail(`Device lost: ${info.reason}. Reload to rebuild.`);}});
  await cloud.compile(scene,camera);await refreshEnvironment();await verify();raf=requestAnimationFrame(frame);
}
void boot().catch(fail);
