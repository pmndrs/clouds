#!/usr/bin/env node
// F2: interleaved capture runs of the HZD bench. Each arm is `label=query`; every rep runs every arm once (in order), so arms share the GPU's
// load drift. Prints and writes <out>/timing.json: skyLayer GPU ms per arm and shot (all reps), and keeps the last rep's images in <out>/<label>/.
//   node work/captures/F2/tools/runs.mjs --out work/captures/F2/s1/timing --reps 3 --shots ground,above \
//     "nutshell=hz_profileMode=nutshell" "uniform=hz_profileMode=tables&hz_tableSource=uniform"
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const out = resolve(opt('out', 'work/captures/F2/scratch'));
const reps = Number(opt('reps', 1));
const shots = opt('shots', 'ground,gp7,horizon,above');
const settle = opt('settle', '300');
const base = opt('base', 'clean=1&motion=0');
const arms = argv.map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; });
const timing = {};
mkdirSync(out, { recursive: true });
for (let r = 0; r < reps; r++) for (const [label, q] of arms) {
  const dir = `${out}/${label}`;
  const res = spawnSync('node', ['scripts/gpu/capture.mjs', '--serve', '--page', 'hzd/', '--query', `${base}${q ? '&' + q : ''}`, '--settle', settle, '--shots', shots, '--out', dir, '--timeout', '180'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (res.status !== 0) { console.error(label, res.stdout.slice(-2000), res.stderr.slice(-2000)); continue; }
  const cap = JSON.parse(readFileSync(`${dir}/capture.json`, 'utf8'));
  for (const s of cap.shots) {
    const ms = s.report?.gpuMs?.skyLayer;
    ((timing[label] ??= {})[s.name] ??= []).push(ms == null ? null : +ms.toFixed(2));
  }
  console.log(r, label, JSON.stringify(timing[label]));
}
writeFileSync(`${out}/timing.json`, JSON.stringify({ shots, reps, arms: Object.fromEntries(arms), skyLayerMs: timing }, null, 1));
for (const [label, t] of Object.entries(timing)) console.log(label.padEnd(16), Object.entries(t).map(([s, v]) => `${s} ${Math.min(...v)}-${Math.max(...v)}`).join('  '));
