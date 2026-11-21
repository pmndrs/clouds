#!/usr/bin/env node
// P0.4 the scene card: every cloud x sun on examples/lab/reference-pt/, path traced with two seeds and rendered by the runtime, all in linear
// radiance (capture.mjs --linear), then the manifest. One browser session per cloud and seed; a failed session (device lost, out of memory on
// a shared GPU) is retried after a pause.
//
//   node scripts/gpu/card.mjs [--url http://127.0.0.1:5173] [--clouds parkouring,embergen02,wdas,sky,stratus] [--spp 2048] [--out work/captures/card]
//        [--spp-<cloud> 1024] [--rerun nubis-noon,octave-noon]   (--rerun: the realtime frames again in a fresh session, into <cloud>/rerun/)
//        [--manifest-only]
// Then: python3 scripts/gpu/scorecard.py --gate work/captures/card
import { spawnSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : fallback; };
const flag = name => argv.includes('--' + name);
const root = resolve(new URL('../..', import.meta.url).pathname);
const out = resolve(root, opt('out', 'work/captures/card'));
const url = opt('url', 'http://127.0.0.1:5173');
const clouds = opt('clouds', 'parkouring,embergen02,wdas,sky,stratus').split(',');
const SUNS = ['noon', 'low', 'backlit', 'sunset'];
const RT = ['nubis', 'octave', 'fit', 'alpha', 'rtalpha'];
const size = opt('size', '1280x720');

function capture(cloud, seed, shots, dir, spp) {
  const q = `clean=1&cloud=${cloud}&spp=${spp}&seed=${seed}`;
  const args = ['scripts/gpu/capture.mjs', '--url', `${url}/reference-pt/?${q}`, '--size', size, '--format', 'png', '--linear', '--settle', '90',
    '--eval-timeout', '3600', '--timeout', '600', '--out', dir, '--shots', shots.join(',')];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    console.log(`[card] ${cloud} seed ${seed} spp ${spp}: ${shots.length} shots -> ${dir.slice(root.length + 1)} (attempt ${attempt})`);
    const r = spawnSync('node', args, { cwd: root, stdio: 'inherit' });
    const ms = Date.now() - t0;
    if (r.status === 0) return { ok: true, ms, attempt };
    console.log(`[card] ${cloud} seed ${seed} failed (status ${r.status}) after ${(ms / 1000).toFixed(0)} s; waiting 60 s before retrying (shared GPU)`);
    spawnSync('sleep', ['60']);
  }
  return { ok: false };
}

const runs = existsSync(join(out, 'runs.json')) ? JSON.parse(readFileSync(join(out, 'runs.json'), 'utf8')) : {};
if (!flag('manifest-only')) {
  for (const cloud of clouds) {
    const spp = Number(opt(`spp-${cloud}`, opt('spp', 2048)));
    const dir = join(out, cloud);
    mkdirSync(dir, { recursive: true });
    if (opt('rerun')) {
      const shots = opt('rerun').split(',');
      runs[`${cloud}/rerun`] = { ...capture(cloud, 1, shots, join(dir, 'rerun'), spp), shots };
      continue;
    }
    const all = SUNS.flatMap(s => ['pt', ...RT].map(r => `${r}-${s}`));
    runs[`${cloud}/seed1`] = { ...capture(cloud, 1, all, dir, spp), spp };
    runs[`${cloud}/seed2`] = { ...capture(cloud, 2, SUNS.map(s => `pt-${s}`), join(dir, 'seed2'), spp), spp };
    writeFileSync(join(out, 'runs.json'), JSON.stringify(runs, null, 1));
  }
  writeFileSync(join(out, 'runs.json'), JSON.stringify(runs, null, 1));
}

// ---- manifest: every frame with its cloud parameters, sun, camera, spp, seeds and the commit
const commit = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
const dirty = execSync('git status --porcelain -- examples/lab/reference-pt scripts/gpu', { cwd: root }).toString().trim() !== '';
const manifest = { step: 'P0.4 scene card', commit, dirtyTree: dirty, createdAt: new Date().toISOString(), size, suns: SUNS, frames: [], clouds: {}, runs };
for (const cloud of ['parkouring', 'embergen02', 'wdas', 'sky', 'stratus']) {
  const dir = join(out, cloud);
  const c1 = join(dir, 'capture.json');
  if (!existsSync(c1)) continue;
  const cap = JSON.parse(readFileSync(c1, 'utf8'));
  const cap2 = existsSync(join(dir, 'seed2', 'capture.json')) ? JSON.parse(readFileSync(join(dir, 'seed2', 'capture.json'), 'utf8')) : null;
  const first = cap.shots.find(s => s.report?.card)?.report;
  if (first) manifest.clouds[cloud] = { ...first.card, albedo: first.pt.medium.albedo, g: first.pt.medium.g, ptSigmaPerUnit: first.pt.medium.extinction, maxDepth: first.pt.maxDepth, runtime: first.runtime };
  for (const s of cap.shots) {
    const r = s.report;
    if (!r) continue;
    const [renderer, sun] = s.name.split('-');
    const frame = {
      cloud, name: s.name, renderer, sun, file: s.linear?.file ?? null, png: s.file,
      sunDirection: r.sun.direction, sunElevationDeg: r.sun.elevationDeg, sunAzimuthDeg: r.sun.azimuthDeg, timeOfDay: r.sun.timeOfDay, cameraRingDeg: r.sun.ring,
      sunIrradiance: r.sky?.sunIrradiance, skyAmbientUp: r.sky?.ambientUp,
      camera: { ...r.camera, yFovDeg: r.fovY, viewport: r.viewport },
      grid: r.grid, medium: r.pt.medium, alphaFilter: r.pt.alphaFilter,
    };
    if (renderer === 'pt') {
      const s2 = cap2?.shots.find(x => x.name === s.name);
      frame.spp = r.pt.samples; frame.seeds = [r.pt.seed, ...(s2 ? [s2.report.pt.seed] : [])];
      frame.seed2File = s2?.linear?.file ?? null; frame.ptWallMs = [r.pt.wallMs, ...(s2 ? [s2.report.pt.wallMs] : [])]; frame.maxDepth = r.pt.maxDepth;
    } else if (renderer === 'nubis' || renderer === 'octave' || renderer === 'fit' || renderer === 'rtalpha') {
      frame.runtime = { ...r.runtime, lightingModel: renderer === 'rtalpha' ? 'nubis' : renderer };
    }
    manifest.frames.push(frame);
  }
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`[card] manifest: ${manifest.frames.length} frames, ${Object.keys(manifest.clouds).length} clouds, commit ${commit.slice(0, 9)}${dirty ? ' (dirty tree)' : ''} -> ${join(out, 'manifest.json').slice(root.length + 1)}`);
