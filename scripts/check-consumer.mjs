import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const destination=path.resolve('artifacts/packed-consumer');await rm(destination,{recursive:true,force:true});await mkdir(destination,{recursive:true});
const online=process.argv.includes('--online');
const root=JSON.parse(await readFile('package.json','utf8'));
const archives=(await readdir('artifacts/release')).filter(n=>n.startsWith('clouds-')&&n.endsWith('.tgz'));
const dependencies=Object.fromEntries(archives.map(file=>['@clouds/'+file.split('-')[1],`file:../release/${file}`]));
Object.assign(dependencies,{three:root.devDependencies.three,react:root.devDependencies.react,'react-dom':root.devDependencies['react-dom'],'@react-three/fiber':root.devDependencies['@react-three/fiber'],'@pmndrs/upscaler':'file:../release/pmndrs-upscaler-0.2.0.tgz'});
await writeFile(`${destination}/package.json`,JSON.stringify({name:'clouds-packed-consumer',private:true,type:'module',dependencies,devDependencies:{'@types/three':root.devDependencies['@types/three'],'@types/react':root.devDependencies['@types/react'],'@webgpu/types':root.devDependencies['@webgpu/types']},pnpm:{overrides:{...Object.fromEntries(Object.entries(dependencies).filter(([name])=>name.startsWith('@clouds/'))),'@pmndrs/upscaler':'file:../release/pmndrs-upscaler-0.2.0.tgz'}}},null,2));
// An independent install: no workspace links or source aliases.
await writeFile(`${destination}/pnpm-workspace.yaml`,'packages: []\n');
const installArgs=['install',...(online?[]:['--offline']),'--ignore-scripts','--no-frozen-lockfile'];
const install=spawnSync('pnpm',installArgs,{cwd:destination,stdio:'inherit',env:{...process.env,CI:'true'}});if(install.status!==0)process.exit(install.status??1);
await writeFile(`${destination}/tsconfig.json`,JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',strict:true,noEmit:true,skipLibCheck:false,types:['@webgpu/types'],lib:['ES2022','DOM'],jsx:'react-jsx'},include:['*.ts']},null,2));
const entries={
 vanilla:`export { createCloudscape, createCloudWorld, createCloudscapeAtlas, createReferenceCloud } from '@clouds/legacy-three';`,
 layer:`export { createCloudLayer } from '@clouds/legacy-three/layers';`,
 environment:`export { createCloudscapeEnvironment } from '@clouds/legacy-three/environment';`,
 react:`export * from '@clouds/legacy-react';`,
 assets:`export * from '@clouds/assets'; export * from '@clouds/tools';`,
 reconstruction:`export * from '@clouds/legacy-three/reconstruction';`,
};
const reports={};
for(const [name,source] of Object.entries(entries)){
 const file=`${destination}/${name}.ts`;await writeFile(file,source);
 const result=await build({absWorkingDir:destination,tsconfig:`${destination}/tsconfig.json`,entryPoints:[file],outdir:`${destination}/dist/${name}`,bundle:true,format:'esm',platform:'browser',metafile:true,write:true});
 const inputs=Object.keys(result.metafile.inputs);
 if(inputs.some(p=>p.includes('/packages/')&&!p.includes('node_modules')))throw new Error(`${name}: leaked workspace source`);
 if(['vanilla','layer','environment'].includes(name)&&inputs.some(p=>/node_modules\/(react|react-dom|@react-three|@pmndrs\/upscaler)(\/|$)/.test(p)))throw new Error(`${name}: unwanted React/FSR dependency`);
 if(name==='layer'&&inputs.some(p=>/cloudscape|volumetric|reconstruction|optical-resolve|clouds\/assets|clouds\/tools/.test(p)))throw new Error('Layer pulled volume/asset runtime');
 reports[name]={inputs:inputs.length,bytes:Object.values(result.metafile.outputs).reduce((n,x)=>n+x.bytes,0)};
}
await writeFile(`${destination}/tsconfig.nodenext.json`,JSON.stringify({extends:'./tsconfig.json',compilerOptions:{module:'NodeNext',moduleResolution:'NodeNext'},include:Object.keys(entries).filter(name=>name!=='reconstruction').map(name=>name+'.ts')},null,2));
for(const config of ['tsconfig.json','tsconfig.nodenext.json']) {
 const typecheck=spawnSync(process.execPath,[path.resolve('node_modules/typescript/bin/tsc'),'-p',`${destination}/${config}`],{cwd:destination,stdio:'inherit'});if(typecheck.status!==0)process.exit(typecheck.status??1);
}
await writeFile(`${destination}/smoke.ts`, `
import { createReferenceCloud, createDensityField, createCloudscape, createCloudscapeAtlas, createCloudWorld } from '@clouds/legacy-three';
import { createCloudLayer } from '@clouds/legacy-three/layers';
import { encodeDenseAsset, decodeDenseAsset } from '@clouds/assets';
import { WebGPURenderer, Scene, PerspectiveCamera, Color } from 'three/webgpu';
const status=document.querySelector('#status');
async function run(){
 const renderer=new WebGPURenderer();await renderer.init();renderer.setSize(480,270);document.body.append(renderer.domElement);
 const scene=new Scene();scene.background=new Color(0xadcce0);
 const camera=new PerspectiveCamera(50,480/270,1,10000);camera.coordinateSystem=renderer.coordinateSystem;camera.position.set(900,450,1200);camera.lookAt(0,350,0);camera.updateProjectionMatrix();
 const source=createDensityField('cumulus',32,17),loaded=decodeDenseAsset(encodeDenseAsset(source));
 const checks=[];
 checks.push({name:'Packed asset round trip',passed:loaded.data.every((v,i)=>v===source.data[i])});
 for(let cycle=0;cycle<3;cycle++){
  const cloud=createReferenceCloud(renderer,loaded,{min:[-2000,0,-2000],max:[-1900,100,-1900]});cloud.resize(480,270);cloud.settings.castShadow=false;cloud.render(scene,camera);
  const pixels=await cloud.readOptical();checks.push({name:'Packed GPU mount '+cycle,passed:pixels.every(Number.isFinite)&&pixels.some((v,i)=>i%4===3&&v<0.99)});
  cloud.resize(320,180);cloud.render(scene,camera,false);const resized=await cloud.readOptical();checks.push({name:'Packed GPU resize '+cycle,passed:resized.length===320*180*4&&resized.every(Number.isFinite)});cloud.dispose();cloud.dispose();
 }
 const world=createCloudWorld({radius:1,coverage:1});const cell=world.snapshot.cells.find(c=>c.active);if(!cell)throw new Error('Packed world has no density');
 const center=cell.bounds.min.map((v,i)=>(v+cell.bounds.max[i])/2);camera.position.set(center[0]+1500,center[1]+200,center[2]+2200);camera.lookAt(...center);camera.updateProjectionMatrix();
 const cloudscape=createCloudscape(renderer,createCloudscapeAtlas(16),world.snapshot);cloudscape.settings.distanceFade=false;cloudscape.resize(64,36);cloudscape.render(scene,camera,false);const worldPixels=await cloudscape.readOptical();
 checks.push({name:'Packed cloudscape cache and integration',passed:worldPixels.every(Number.isFinite)&&worldPixels.some((v,i)=>i%4===3&&v>0&&v<0.99)});cloudscape.dispose();
 const layer=createCloudLayer();scene.add(layer.mesh);layer.update(1);renderer.render(scene,camera);scene.remove(layer.mesh);layer.dispose();
 checks.push({name:'Packed independent layer lifecycle',passed:true});
 document.querySelector('#evidence').textContent=JSON.stringify(checks,null,2);status.textContent=checks.every(c=>c.passed)?'PASS: '+checks.length+' packed consumer checks':'FAIL: inspect evidence';
 window.addEventListener('pagehide',()=>renderer.dispose(),{once:true});
}
run().catch(e=>{status.textContent='FAIL: '+e.message;});
`);
await build({absWorkingDir:destination,tsconfig:`${destination}/tsconfig.json`,entryPoints:[`${destination}/smoke.ts`],outfile:`${destination}/dist/smoke.js`,bundle:true,format:'esm',platform:'browser'});
await writeFile(`${destination}/index.html`,'<!doctype html><title>Packed cloud library check</title><h1>Packed cloud library check</h1><p id="status">Running GPU checks from installed tarballs…</p><pre id="evidence"></pre><script type="module" src="./dist/smoke.js"></script>');
await writeFile('artifacts/packed-consumer-report.json',JSON.stringify({generatedAt:new Date().toISOString(),independentInstall:true,aliases:false,declarations:{bundler:"all entries",nodeNext:"all except optional reconstruction: upstream upscaler declarations require Bundler resolution"},entries:reports},null,2));
console.log('Packed consumers and entry boundaries passed. All declarations pass Bundler; NodeNext passes except the optional upstream FSR entry.');
