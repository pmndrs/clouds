// node shots.mjs <outdir relative to worktree> "<extra query>" [views]
// views: comma list of bm (ground,horizon,above,sunset bookmarks), high (posy 4300 pitch -6 sunel 25), world (posy 9000 pitch -28 sunel 40), top (posy 14000 pitch -60: the map from above)
import { spawnSync } from 'node:child_process';
const W = '/Users/dex/Developer/WebGPUClouds/.claude/worktrees/agent-aa870fc0b8d9c5742';
const [out, extra = '', viewsArg = 'bm,high,world'] = process.argv.slice(2);
const base = `http://127.0.0.1:5391/compare/?impls=hzd&clean=1&hud=0&quality=ultra&c_animSpeed=0${extra ? '&' + extra : ''}`;
const runs = {
  bm: { q: '', shots: 'ground,horizon,above,sunset', sub: '' },
  high: { q: '&posy=4300&pitch=-6&sunel=25', shots: '', sub: 'high' },
  world: { q: '&posy=9000&pitch=-28&sunel=40', shots: '', sub: 'world' },
  top: { q: '&posy=14000&pitch=-60&sunel=60', shots: '', sub: 'top' },
};
for (const v of viewsArg.split(',')) {
  const r = runs[v];
  const args = ['scripts/gpu/capture.mjs', '--url', base + r.q, '--settle', '300', '--out', r.sub ? `${out}/${r.sub}` : out];
  if (r.shots) args.push('--shots', r.shots);
  const p = spawnSync('node', args, { cwd: W, encoding: 'utf8', timeout: 600000 });
  console.log(v, (p.stdout + p.stderr).trim().split('\n').slice(-6).join('\n'));
}
