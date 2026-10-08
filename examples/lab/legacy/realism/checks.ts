import { Scene, PerspectiveCamera, type WebGPURenderer } from 'three/webgpu';
import { createReferenceCloud } from '../../../../packages/legacy/three/src/volumetric';
import { createMorphologyNoise } from '../../../../packages/legacy/three/src/sources/morphology-noise';
import { createMorphologyDomain } from '../../../../packages/legacy/three/src/volumetric/morphology';
export async function runRealismChecks(renderer:WebGPURenderer){
  const results:{name:string;error:number;tolerance:number;passed:boolean}[]=[];
  const check=(name:string,error:number,tolerance=0)=>results.push({name,error,tolerance,passed:Number.isFinite(error)&&error<=tolerance});
  const field={descriptor:{id:'analytic-quality',revision:0,dimensions:[8,16,8] as const,bounds:{min:[-100,700,-100] as const,max:[100,900,100] as const},extinctionScale:.01,encoding:'r8unorm' as const},data:new Uint8Array(8*16*8).fill(255)};
  const cloud=createReferenceCloud(renderer,field,{min:[5000,0,5000],max:[5001,1,5001]},{appearance:'realistic'});cloud.resize(33,25);
  const camera=new PerspectiveCamera(50,33/25,.1,10000);camera.coordinateSystem=renderer.coordinateSystem;camera.position.set(0,800,800);camera.lookAt(0,800,0);camera.updateProjectionMatrix();
  const scene=new Scene();cloud.settings.sunDirection.set(0,1,0);Object.assign(cloud.settings,{viewSteps:256,lightSteps:64,detailErosion:0,constantLight:true,castShadow:false,receiveShadow:false});
  const sample=async()=>{cloud.render(scene,camera,false);return cloud.readOptical();};
  try{
    const image=await sample(),center=(12*33+16)*4;
    check('Homogeneous T matches exp(-2)',Math.abs(image[center+3]-Math.exp(-2)),.001);
    check('Constant-light L + T conserves energy',Math.abs(image[center]+image[center+3]-1),.001);
    const cache=await cloud.readOpticalDepthCache();
    check('Optical-depth cache maps density-grid texel centers',cache.reduce((m,tau,i)=>Math.max(m,Math.abs(tau-(900-(700+(Math.floor(i/16)%32+.5)*6.25))*.01)),0),.002);
    const updates=cloud.evidence.cacheUpdates;await sample();check('Static source and sunlight reuse cache',cloud.evidence.cacheUpdates-updates);
    camera.position.x=300;camera.lookAt(0,800,0);await sample();check('Camera movement does not rebuild source light cache',cloud.evidence.cacheUpdates-updates);
    cloud.settings.densityMultiplier=.5;await sample();check('Density changes invalidate cache once',Math.abs(cloud.evidence.cacheUpdates-updates-1));
    const scaled=await cloud.readOpticalDepthCache();check('Density scale halves cached optical depth',scaled.reduce((m,n,i)=>Math.max(m,Math.abs(n-cache[i]*.5)),0),.001);
    const samePoseUnlit=await sample();
    cloud.settings.constantLight=false;const lit=await sample();check('Lit output is finite and populated',lit.every(Number.isFinite)&&lit.some((n,i)=>i%4!==3&&n>0)?0:1);
    check('Lighting leaves view transmittance unchanged',lit.reduce((m,n,i)=>i%4===3?Math.max(m,Math.abs(n-samePoseUnlit[i])):m,0));
    check('Lit fixture differs from uniform-light control',lit.some((n,i)=>i%4!==3&&Math.abs(n-samePoseUnlit[i])>.01)?0:1);
    cloud.settings.densityMultiplier=0;const blank=await sample();check('Zero density gives zero radiance and unit T',blank.reduce((m,n,i)=>Math.max(m,Math.abs(n-(i%4===3?1:0))),0));
    cloud.resize(19,13);const small=await sample();check('Resize preserves valid bindings',small.length===19*13*4&&small.every(Number.isFinite)?0:1);
  }finally{cloud.dispose();}
  return results;
}

export async function runMorphologyChecks(renderer:WebGPURenderer){
  const results:{name:string;error:number;tolerance:number;passed:boolean}[]=[];
  const check=(name:string,error:number,tolerance=0)=>results.push({name,error,tolerance,passed:Number.isFinite(error)&&error<=tolerance});
  const domain=createMorphologyDomain({min:[-2000,900,-2000],max:[2000,3500,2000]});
  const field={...domain,descriptor:{...domain.descriptor,dimensions:[16,8,16] as const},data:new Uint8Array(16*8*16).fill(255)};
  const cloud=createReferenceCloud(renderer,field,{min:[50000,0,50000],max:[50001,1,50001]},
    {appearance:'realistic',morphology:createMorphologyNoise({volumeResolution:16,weatherResolution:32})});
  cloud.resize(33,25);
  const camera=new PerspectiveCamera(50,33/25,.1,20000);camera.coordinateSystem=renderer.coordinateSystem;
  camera.position.set(400,1450,4000);camera.lookAt(0,1500,0);camera.updateProjectionMatrix();
  Object.assign(cloud.settings,{viewSteps:256,lightSteps:32,castShadow:false,receiveShadow:false,constantLight:true,morphologyCoverage:1});
  const scene=new Scene();
  const sample=async()=>{cloud.render(scene,camera,false);return cloud.readOptical();};
  try{
    try{
      createReferenceCloud(renderer,{...field,data:new Uint8Array(1)},
        {min:[50000,0,50000],max:[50001,1,50001]},
        {appearance:'realistic',morphology:createMorphologyNoise({volumeResolution:16,weatherResolution:32})});
      check('Malformed procedural domain is rejected before allocation',1);
    }catch(error){check('Malformed procedural domain is rejected before allocation',error instanceof Error&&/payload/.test(error.message)?0:1);}
    const first=await sample();
    check('Procedural source produces finite occupied cloud pixels',first.every(Number.isFinite)&&first.some((v,i)=>i%4===3&&v<.99)?0:1);
    check('Procedural constant-light L + T conserves energy',first.reduce((e,v,i)=>i%4===0?Math.max(e,Math.abs(v+first[i+3]-1)):e,0),.001);
    const updates=cloud.evidence.cacheUpdates;await sample();
    check('Procedural static source reuses sunlight cache',cloud.evidence.cacheUpdates-updates);
    camera.position.set(0,1500,0);camera.lookAt(0,1800,-1000);await sample();
    check('Procedural inside view reuses sunlight cache',cloud.evidence.cacheUpdates-updates);
    cloud.settings.morphologyErosion=.9;await sample();
    check('Procedural erosion invalidates sunlight cache once',Math.abs(cloud.evidence.cacheUpdates-updates-1));
    cloud.settings.morphologyCoverage=0;const blank=await sample();
    check('Procedural zero coverage clears view radiance and extinction',blank.reduce((e,v,i)=>Math.max(e,Math.abs(v-(i%4===3?1:0))),0));
    const cache=await cloud.readOpticalDepthCache();
    check('Procedural zero coverage clears sunlight optical depth',cache.reduce((e,v)=>Math.max(e,Math.abs(v)),0));
    cloud.resize(19,13);const resized=await sample();
    check('Procedural mip resources remain valid after resize',resized.length===19*13*4&&resized.every(Number.isFinite)?0:1);
  }finally{cloud.dispose();}
  return results;
}
