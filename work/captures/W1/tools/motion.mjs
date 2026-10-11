// W1 motion clips per advection policy: node work/captures/W1/tools/motion.mjs <outdir> <view: ground|high|above> <policy,...> ["extra query"]
// The wind runs at c_animSpeed (x the runtime's 3.35 m/s); each frame is a repeated bookmark shot `settle` frames after the last, so the
// frame spacing is wall-clock (about equal, not exact). Frames 1-2 are dropped (pipeline warm-up). Writes <policy>/clip.mp4 and frames.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
const W = '/Users/dex/Developer/WebGPUClouds/.claude/worktrees/agent-aa870fc0b8d9c5742';
const [out, view = 'ground', policies = 'drift,static,rigid,shape,detail', extra = ''] = process.argv.slice(2);
const N = 16, anim = 100, settle = 20;
const cam = view === 'high' ? '&posy=4300&pitch=-6&sunel=25' : view === 'world' ? '&posy=9000&pitch=-28&sunel=40' : `&bookmark=${view}`;
for (const p of policies.split(',')) {
  const dir = `${out}/${view}-${p}`;
  const url = `http://127.0.0.1:5391/compare/?impls=hzd&clean=1&hud=0&quality=ultra&c_animSpeed=${anim}&hz_ndfMotion=${p}${cam}${extra ? '&' + extra : ''}`;
  const r = spawnSync('node', ['scripts/gpu/capture.mjs', '--url', url, '--settle', String(settle), '--shots', Array(N).fill(view === 'high' || view === 'world' ? 'ground' : view).join(','), '--out', dir], { cwd: W, encoding: 'utf8' });
  const frames = readdirSync(`${W}/${dir}`).filter(f => f.endsWith('.jpg')).sort((a, b) => (Number(a.match(/-(\d+)\./)?.[1] ?? 1) - Number(b.match(/-(\d+)\./)?.[1] ?? 1)));
  // view=high/world: the bookmark resets the camera to 'ground'; pass the camera in the URL and shoot 'view' instead
  const list = frames.slice(2).map(f => `file '${W}/${dir}/${f}'\nduration 0.25`).join('\n');
  spawnSync('sh', ['-c', `printf "%s\n" "$0" > "${W}/${dir}/frames.txt" && ffmpeg -y -loglevel error -f concat -safe 0 -i "${W}/${dir}/frames.txt" -vf scale=960:-2,format=yuv420p -r 8 "${W}/${dir}/clip.mp4"`, list]);
  console.log(p, frames.length, 'frames', (r.stdout + r.stderr).trim().split('\n').slice(-1)[0]);
}
