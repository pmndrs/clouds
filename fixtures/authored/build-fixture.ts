import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeDenseAsset } from '@clouds/assets';
import { convertMeshToDensity, type StaticTriangleMesh } from '@clouds/tools';

function parseObj(text: string): StaticTriangleMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields[0] === 'v' && fields.length >= 4) positions.push(Number(fields[1]), Number(fields[2]), Number(fields[3]));
    if (fields[0] === 'f' && fields.length >= 4) {
      const face = fields.slice(1).map(value => Number(value.split('/')[0]) - 1);
      for (let i = 1; i < face.length - 1; i++) indices.push(face[0], face[i], face[i + 1]);
    }
  }
  return { positions, indices };
}

const directory = resolve(process.cwd(), 'fixtures/authored');
const mesh = parseObj(readFileSync(resolve(directory, 'cube.obj'), 'utf8'));
const field = convertMeshToDensity(mesh, { id: 'authored-cube', dimensions: [32, 32, 32], padding: 0.15, softness: 0.08, extinctionScale: 0.025 });
writeFileSync(resolve(directory, 'cube-density.clda'), encodeDenseAsset(field));

const metadata = JSON.parse(readFileSync(resolve(directory, 'density.json'), 'utf8')) as {
  id: string; revision: number; dimensions: [number, number, number];
  bounds: { min: [number, number, number]; max: [number, number, number] };
  extinctionScale: number; encoding: string;
};
if (metadata.encoding !== 'r32float') throw new Error('Authored density source must declare r32float.');
const raw = readFileSync(resolve(directory, 'density.raw'));
const expected = metadata.dimensions[0] * metadata.dimensions[1] * metadata.dimensions[2] * 4;
if (raw.byteLength !== expected) throw new Error(`Authored density byte length ${raw.byteLength} does not match ${expected}.`);
const samples = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
const quantized = new Uint8Array(raw.byteLength / 4);
for (let i = 0; i < quantized.length; i++) {
  const value = samples.getFloat32(i * 4, true);
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Authored density sample ${i} is outside finite [0,1].`);
  quantized[i] = Math.round(value * 255);
}
const authored = { descriptor: { id: metadata.id, revision: metadata.revision, dimensions: metadata.dimensions, bounds: metadata.bounds, extinctionScale: metadata.extinctionScale, encoding: 'r8unorm' as const }, data: quantized };
writeFileSync(resolve(directory, 'authored-density.clda'), encodeDenseAsset(authored));
console.log(JSON.stringify({ mesh: { id: field.descriptor.id, dimensions: field.descriptor.dimensions, bounds: field.descriptor.bounds, bytes: field.data.byteLength }, authored: { id: authored.descriptor.id, dimensions: authored.descriptor.dimensions, bounds: authored.descriptor.bounds, bytes: authored.data.byteLength } }));
