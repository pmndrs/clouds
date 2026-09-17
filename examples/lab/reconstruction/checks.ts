import { Scene, PerspectiveCamera, WebGPUCoordinateSystem, Matrix4, Vector3, Color, Mesh, BoxGeometry, MeshBasicNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { velocity } from 'three/tsl';
import { createCloudscape } from '../../../packages/three/src/cloudscape';
import { createCloudWorld, type WorldSnapshot } from '../../../packages/three/src/world';
import { createCloudscapeAtlas } from '../../../packages/three/src/sources/cloudscape-atlas';
import { runUpscalerChecks } from './upscaler-checks';
import { runOpticalGpuChecks } from './optical-checks';

export async function runReconstructionChecks(renderer:WebGPURenderer){
  const results:{name:string;passed:boolean;error:number;tolerance:number}[]=[];
  const check=(name:string,error:number,tolerance=0.001)=>results.push({name,error,tolerance,passed:Number.isFinite(error)&&error<=tolerance});
  const world=createCloudWorld({radius:1,coverage:0}).snapshot;
  const fixture:WorldSnapshot={...world,revision:1,cells:world.cells.map((c,i)=>({...c,active:i===4,bounds:{min:[-500,1000,-500],max:[500,2000,500]},extinctionScale:0.001}))};
  const atlas=createCloudscapeAtlas(4);atlas.data.fill(255);
  const cloud=createCloudscape(renderer,atlas,fixture,{temporalGuides:true});cloud.resize(41,31);
  Object.assign(cloud.settings,{distanceFade:false,detail:0,stepMetres:10,maxSteps:1024,hazeStrength:0,constantLight:true});
  const scene=new Scene();scene.background=new Color(0);
  const camera=new PerspectiveCamera(45,41/31,1,15000);camera.coordinateSystem=WebGPUCoordinateSystem;camera.updateProjectionMatrix();camera.position.set(0,1500,3000);camera.lookAt(0,1500,0);camera.updateMatrixWorld();
  const vp=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),oldVP=vp.clone();
  const pixel=(15*41+20)*4;
  const geometry=new BoxGeometry(500,500,10),material=new MeshBasicNodeMaterial({color:0xffffff}),mesh=new Mesh(geometry,material);
  try{
    await cloud.compile(scene,camera);cloud.setTemporalMatrices(vp,vp);cloud.render(scene,camera,false);
    const guides=await cloud.readGuides(),optical=await cloud.readOptical();
    check('Guide outputs are finite',guides.every(Number.isFinite)?0:1,0);
    check('Static cloud has zero unjittered motion',Math.max(Math.abs(guides[pixel]),Math.abs(guides[pixel+1])),1e-6);
    check('Homogeneous guide fixture retains Beer transmittance',Math.abs(optical[pixel+3]-Math.exp(-1)),0.002);
    const distance=2500+1000-1000/(Math.E-1);
    const projected=new Vector3(0,1500,3000-distance).applyMatrix4(vp);
    check('Cloud guide depth follows extinction-weighted distance',Math.abs(guides[pixel+2]-projected.z),0.000002);
    check('Mixed cloud pixels provide reactive weight',Math.abs(guides[pixel+3]-4*Math.exp(-1)*(1-Math.exp(-1))),0.002);
    camera.position.x=20;camera.lookAt(20,1500,0);camera.updateMatrixWorld();vp.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);cloud.setTemporalMatrices(vp,oldVP);cloud.render(scene,camera,false);
    const moved=await cloud.readGuides(),expected=-20/(distance*Math.tan(Math.PI/8)*(41/31));
    check('Camera translation produces current-minus-previous NDC motion',Math.abs(moved[pixel]-expected),0.00005);
    cloud.settings.density=0;cloud.setTemporalMatrices(vp,vp);cloud.render(scene,camera,false);const empty=await cloud.readGuides();
    check('Empty sky guides have far depth, zero motion and zero reactivity',Math.max(Math.abs(empty[pixel]),Math.abs(empty[pixel+1]),Math.abs(empty[pixel+2]-1),Math.abs(empty[pixel+3])),1e-6);
    velocity.setProjectionMatrix(camera.projectionMatrix);
    mesh.position.set(20,1500,2000);scene.add(mesh);await cloud.compile(scene,camera);
    await new Promise<void>(r=>requestAnimationFrame(()=>r()));cloud.render(scene,camera,false);await cloud.readGuides();
    mesh.position.x+=10;
    await new Promise<void>(r=>requestAnimationFrame(()=>r()));cloud.render(scene,camera,false);const geometryGuide=await cloud.readGuides();
    const geometryDepth=new Vector3(20,1500,2005).applyMatrix4(vp).z;
    check('Opaque foreground guides retain scene device depth',Math.abs(geometryGuide[pixel+2]-geometryDepth),1e-6);
    check('Moving opaque geometry supplies object motion to temporal guides',Math.abs(geometryGuide[pixel]-10/(995*Math.tan(Math.PI/8)*(41/31))),0.00005);
    cloud.resize(23,17,46,34);cloud.render(scene,camera,false);const resized=await cloud.readGuides();
    check('Guides resize independently of the scene target',resized.length===23*17*4&&resized.every(Number.isFinite)?0:1,0);
  }finally{cloud.dispose();geometry.dispose();material.dispose();}
  results.push(...await runOpticalGpuChecks(renderer),...await runUpscalerChecks(renderer));
  return results;
}
