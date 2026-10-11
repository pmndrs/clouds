// node maps.mjs <outroot> name=query name=query ...   -> map tool captures + stats
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const W = '/Users/dex/Developer/WebGPUClouds/.claude/worktrees/agent-aa870fc0b8d9c5742';
const [root, ...variants] = process.argv.slice(2);
for (const v of variants) {
  const i = v.indexOf('='); const name = v.slice(0, i), q = v.slice(i + 1);
  const url = `http://127.0.0.1:5391/@fs${W}/work/captures/W1/tools/ndf-map.html?label=${name}&${q}`;
  const p = spawnSync('node', ['scripts/gpu/capture.mjs', '--url', url, '--size', '1530x430', '--settle', '2', '--format', 'png', '--out', `${root}/${name}`], { cwd: W, encoding: 'utf8' });
  let st = ''; try { st = JSON.stringify(JSON.parse(readFileSync(`${W}/${root}/${name}/capture.json`, 'utf8')).shots[0].report.stats); } catch { st = (p.stdout + p.stderr).slice(-400); }
  console.log(name, st);
}
