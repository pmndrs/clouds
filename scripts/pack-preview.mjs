import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const output=path.resolve('artifacts/release');await mkdir(output,{recursive:true});
const names=['core','legacy/three','legacy/react','assets','tools'];
for(const name of names){const r=spawnSync('pnpm',['pack','--pack-destination',output],{cwd:`packages/${name}`,stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);}
await copyFile('vendor/pmndrs-upscaler-0.2.0.tgz',`${output}/pmndrs-upscaler-0.2.0.tgz`);
await copyFile('vendor/README.md',`${output}/UPSCALER-PROVENANCE.md`);
const files=[];
for(const name of (await readdir(output)).filter(n=>n.endsWith('.tgz')).sort()){
 const bytes=await readFile(`${output}/${name}`);files.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(`${output}/manifest.json`,JSON.stringify({status:'local preview artifacts; not published or production accepted',generatedAt:new Date().toISOString(),files},null,2));
console.log('Packed local preview artifacts in artifacts/release');
