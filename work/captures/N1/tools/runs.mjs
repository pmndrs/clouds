#!/usr/bin/env node
// N1: interleaved capture runs of the HZD bench (F2's runs.mjs with named camera shots). Each arm is `label=query`; every rep runs every arm
// once, in order, so the arms share the GPU's load drift. Shots are views or `alias=spec`, where spec is a bench bookmark with @ variants
// (store.ts bookmark: @look:az:pitch @pos:x:y:z @fov:f @sun:el:az ...); the image is saved as <alias>.jpg. Writes <out>/timing.json (skyLayer
// GPU ms per arm and shot, all reps) and keeps the last rep's images in <out>/<label>/.
//   node work/captures/N1/tools/runs.mjs --out work/captures/N1/s1 --reps 2 --shots "ground,gp7,tops=gp7@look:23:27@fov:12" "hzd=" "n3=hz_noiseSet=nubis3"
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const out = resolve(opt('out', 'work/captures/N1/scratch'));
const reps = Number(opt('reps', 1));
const shots = opt('shots', 'ground,gp7,horizon,above').split(',').map(s => { const i = s.indexOf('='); return i < 0 ? [s, s] : [s.slice(0, i), s.slice(i + 1)]; });
const settle = opt('settle', '300');
const base = opt('base', 'clean=1&motion=0');
const arms = argv.map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; });
const timing = {};
mkdirSync(out, { recursive: true });
for (let r = 0; r < reps; r++) for (const [label, q] of arms) {
  const dir = `${out}/${label}`;
  const res = spawnSync('node', ['scripts/gpu/capture.mjs', '--serve', '--page', 'hzd/', '--query', `${base}${q ? '&' + q : ''}`, '--settle', settle, '--shots', shots.map(s => s[1]).join(','), '--out', dir, '--timeout', '240'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (res.status !== 0) { console.error(label, res.stdout.slice(-2000), res.stderr.slice(-2000)); continue; }
  const cap = JSON.parse(readFileSync(`${dir}/capture.json`, 'utf8'));
  if (cap.errors?.length) console.error(label, 'page errors', cap.errors);
  for (const s of cap.shots) {
    const alias = shots.find(x => x[1] === s.name)?.[0] ?? s.name;
    if (alias !== s.name && existsSync(`${dir}/${s.name}.jpg`)) renameSync(`${dir}/${s.name}.jpg`, `${dir}/${alias}.jpg`);
    const ms = s.report?.gpuMs?.skyLayer;
    ((timing[label] ??= {})[alias] ??= []).push(ms == null ? null : +ms.toFixed(2));
  }
  console.log(r, label, JSON.stringify(timing[label]));
}
writeFileSync(`${out}/timing.json`, JSON.stringify({ shots: Object.fromEntries(shots), reps, arms: Object.fromEntries(arms), skyLayerMs: timing }, null, 1));
for (const [label, t] of Object.entries(timing)) console.log(label.padEnd(16), Object.entries(t).map(([s, v]) => `${s} ${Math.min(...v)}-${Math.max(...v)}`).join('  '));
