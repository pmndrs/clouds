#!/usr/bin/env node
// Regenerates the gallery thumbnails (examples/lab/gallery/thumbs/<id>.webp) with the GPU capture harness.
//   node scripts/gallery-thumbs.mjs [id ...]      all cards, or only the named ones
// Cards come from examples/lab/gallery/cards.json. A card whose page folder does not exist yet is skipped.
// Needs `cwebp` (brew install webp) for the crop and 640 px downscale.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const lab = join(root, 'examples/lab');
const outDir = join(lab, 'gallery/thumbs');
const scratch = join(root, 'work/captures/scratch/gallery-thumbs');
const { cards } = JSON.parse(readFileSync(join(lab, 'gallery/cards.json'), 'utf8'));
const only = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

let failed = 0;
for (const c of cards) {
  if (only.length && !only.includes(c.id)) continue;
  if (!existsSync(join(lab, c.page, 'index.html')) || !c.thumb?.shot) { console.log(`skip ${c.id} (page or thumb shot missing)`); continue; }
  const dir = join(scratch, c.id);
  rmSync(dir, { recursive: true, force: true });
  const query = ['hud=0', 'clean=1', c.thumb.query?.replace('{root}', root.replace(/^\//, ''))].filter(Boolean).join('&');
  console.log(`shoot ${c.id} (${c.page}?${query} @ ${c.thumb.shot})`);
  const r = spawnSync('node', [join(root, 'scripts/gpu/capture.mjs'), '--serve', '--page', c.page, '--query', query, '--shots', c.thumb.shot, '--out', dir], { cwd: root, stdio: 'inherit' });
  const src = join(dir, `${c.thumb.shot}.jpg`);
  if (r.status !== 0 || !existsSync(src)) { console.error(`FAILED ${c.id}`); failed++; continue; }
  const dst = join(outDir, `${c.id}.webp`);
  // thumb.cropTop: pixels (at 1920x1080) to cut from the top, for pages that cannot hide their HUD (vdb-drop)
  const top = c.thumb.cropTop ?? 0;
  const s = spawnSync('cwebp', ['-quiet', '-q', '82', '-crop', '0', String(top), '1920', String(1080 - top), '-resize', '640', '0', src, '-o', dst], { stdio: 'inherit' });
  if (s.status !== 0) { console.error(`cwebp failed for ${c.id} (brew install webp)`); failed++; continue; }
  console.log(`  -> ${c.id}.webp ${(statSync(dst).size / 1024).toFixed(0)} KB`);
}
process.exit(failed ? 1 : 0);
