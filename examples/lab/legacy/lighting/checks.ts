import {
  Scene, PerspectiveCamera, WebGPUCoordinateSystem, DirectionalLight, Mesh, BoxGeometry,
  PlaneGeometry, MeshStandardNodeMaterial, AmbientLight, Color, Vector3, RenderTarget,
  type WebGPURenderer,
} from 'three/webgpu';
import { runEnvironmentChecks } from '../../../../packages/three/src/environment/checks';
import { createCloudscape } from '../../../../packages/three/src/cloudscape';
import { createCloudWorld, type WorldSnapshot } from '../../../../packages/three/src/world';
import { createCloudscapeAtlas } from '../../../../packages/three/src/sources/cloudscape-atlas';

export async function runLightingChecks(renderer:WebGPURenderer){
  const results:{name:string;passed:boolean;error:number;tolerance:number}[]=[];
  const check=(name:string,error:number,tolerance=0.001)=>results.push({name,error,tolerance,passed:Number.isFinite(error)&&error<=tolerance});
  const oldShadows=renderer.shadowMap.enabled;renderer.shadowMap.enabled=true;
  const world=createCloudWorld({radius:1,coverage:0}).snapshot;
  const fixture:WorldSnapshot={...world,revision:1,cells:world.cells.map((c,i)=>({...c,active:i===4,bounds:{min:[-500,1000,-500],max:[500,2000,500]},extinctionScale:0.001}))};
  const atlas=createCloudscapeAtlas(4);atlas.data.fill(255);
  const cloud=createCloudscape(renderer,atlas,fixture);cloud.resize(41,31);
  Object.assign(cloud.settings,{distanceFade:false,detail:0,stepMetres:10,maxSteps:512,hazeStrength:0});cloud.settings.sunDirection.set(0,1,0);
  const scene=new Scene();scene.background=new Color(0);
  const camera=new PerspectiveCamera(45,41/31,1,15000);camera.coordinateSystem=WebGPUCoordinateSystem;camera.updateProjectionMatrix();camera.position.set(0,1500,3000);camera.lookAt(0,1500,0);
  const sun=new DirectionalLight(0xffffff,4);sun.position.set(0,6000,0);sun.castShadow=true;sun.shadow.mapSize.set(512,512);Object.assign(sun.shadow.camera,{left:-2500,right:2500,top:2500,bottom:-2500,near:1,far:10000});sun.shadow.bias=-0.0001;scene.add(sun,sun.target);
  const ambient=new AmbientLight(0xffffff,0.3);scene.add(ambient);
  const material=new MeshStandardNodeMaterial({color:0xffffff,roughness:1});
  const caster=new Mesh(new BoxGeometry(1400,100,1400),material);caster.position.set(0,2600,0);caster.castShadow=true;scene.add(caster);
  // A receiving mesh makes Three allocate/update the selected shadow map.
  const floorMaterial=new MeshStandardNodeMaterial({color:0xffffff,roughness:1});
  const floor=new Mesh(new PlaneGeometry(12000,12000),floorMaterial);floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
  cloud.setDirectionalShadow(sun);
  const pixel=(15*41+20)*4;
  const nextFrame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  const render=async()=>{await nextFrame();cloud.render(scene,camera,false);return cloud.readOptical();};
  try{
    await cloud.compile(scene,camera);
    const occluded=await render(),cacheBefore=cloud.evidence.cacheUpdates;
    caster.position.x=4000;const clear=await render();
    check('Moving geometry changes cloud lighting in the current frame',clear[pixel]-occluded[pixel]>0.05?0:1,0);
    check('Geometry shadow leaves cloud optical depth unchanged',Math.abs(clear[pixel+3]-occluded[pixel+3]),0.00001);
    check('Moving geometry does not rebuild cloud-only light cache',cloud.evidence.cacheUpdates-cacheBefore,0);
    caster.position.x=0;const again=await render();
    check('Returning caster restores cloud shadow without a stale frame',Math.abs(again[pixel]-occluded[pixel]),0.0001);
    cloud.settings.density=0.6;await render();check('Density change refreshes cloud light cache exactly once',Math.abs(cloud.evidence.cacheUpdates-cacheBefore-1),0);
    cloud.settings.density=1;caster.position.x=4000;
    cloud.shadowReceiver.attach(floorMaterial);
    await cloud.compile(scene,camera);
    camera.position.set(0,400,2600);camera.lookAt(0,0,0);
    const composite=async()=>{await nextFrame();cloud.render(scene,camera,false);return cloud.readComposite();};
    cloud.settings.shadows=true;const shadowed=await composite();
    cloud.settings.shadows=false;const unshadowed=await composite();
    check('Cloud shadow reaches a real opaque material at the cache boundary',unshadowed[pixel]-shadowed[pixel]>0.05?0:1,0);
    sun.intensity=0;cloud.settings.shadows=true;const ambientShadowed=await composite();
    cloud.settings.shadows=false;const ambientUnshadowed=await composite();
    check('Cloud receiver preserves ambient lighting',Math.abs(ambientUnshadowed[pixel]-ambientShadowed[pixel]),0.001);
    sun.intensity=4;cloud.settings.shadows=true;
    cloud.settings.cachedLighting=false;cloud.invalidateLighting();const before=cloud.evidence.cacheUpdates;await composite();
    check('Material receivers keep a fresh cache in direct-march reference mode',cloud.evidence.cacheUpdates-before===1?0:1,0);
    const previous=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel(),mrt=renderer.getMRT();
    const host=new RenderTarget(4,4);renderer.setRenderTarget(host);
    try{await composite();check('Cloud render restores caller render target and MRT',renderer.getRenderTarget()===host&&renderer.getMRT()===mrt?0:1,0);}finally{renderer.setRenderTarget(previous,face,mip);host.dispose();}
    cloud.shadowReceiver.detach(floorMaterial);check('Receiver detaches without leaving a material hook',floorMaterial.receivedShadowNode===null?0:1,0);
    results.push(...await runEnvironmentChecks(renderer));
    return results;
  }finally{cloud.dispose();caster.geometry.dispose();floor.geometry.dispose();material.dispose();floorMaterial.dispose();sun.shadow.dispose();renderer.shadowMap.enabled=oldShadows;}
}
