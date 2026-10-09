#!/usr/bin/env node
// Scene review loop: re-shoots every scene target with fixed bookmarks through the capture harness,
// then builds a dated contact sheet (and a before/after sheet against the previous run).
//
//   node scripts/review-scenes.mjs --label baseline
//   node scripts/review-scenes.mjs --label pass-3 --photos      # also side-by-sides with reference photos (scratch, never committed)
//   node scripts/review-scenes.mjs --from work/captures/review/<dir> --photos   # rebuild sheets without re-shooting
//
// Output: work/captures/review/<YYYY-MM-DD-HHMM>-<label>/<group>/<shot>.jpg (+ capture.json per group),
//         sheet.jpg, and vs-previous.jpg when an earlier review folder exists.
// Photo side-by-sides go to work/captures/scratch/review/<same name>/ (gitignored).
// Photo picks come from docs/research/photo-species-specs.md, section 13, by target tag (see PICK_TAGS).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : undefined; };
const flag = name => argv.includes('--' + name);
const DOC = join(root, 'docs/research/photo-species-specs.md');
const PHOTOS = process.env.CLOUD_PHOTOS ?? '/Users/dex/Developer/WebGPUClouds/artifacts/research/cloud-photos';
const REVIEW_ROOT = join(root, 'work/captures/review');
const SCRATCH_ROOT = join(root, 'work/captures/scratch/review');
const HARNESS = join(root, 'scripts/gpu/capture.mjs');

// Scene targets. `picks` names the section-13 tag whose reference photos sit beside each shot.
const SCENES = [
  { group: 'sunset', page: 'sunset/', query: 'hud=0&clean=1', shots: ['golden', 'sunset', 'afterglow', 'side', 'zenith'], picks: 'T4' },
  { group: 'compare', page: 'compare/', query: 'impls=ours,takram&layout=rows&hud=0', shots: ['horizon', 'sunset', 'dusk', 'afterglow'], picks: 'T4' },
  { group: 'species', page: 'species/', query: 'species=mixed&hud=0&clean=1', shots: ['side'], picks: 'T1' },
  { group: 'open-water', page: 'open-water/', query: 'hud=0&clean=1', shots: ['horizon', 'sunset'], picks: 'T2' },
  { group: 'plains-flight', page: 'plains-flight/', query: 'hud=0&clean=1', shots: ['t25'], picks: 'T1' },
  { group: 'onsen', page: 'onsen/', query: 'hud=0&clean=1', shots: ['vantage', 'sunset'], picks: 'T3' },
];

const pad2 = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
const REVIEW_NAME = /^\d{4}-\d{2}-\d{2}-\d{4}-/;

/** Reads the owner's reference picks for a section-13 tag, e.g. "T4", from the research doc. */
function readPicks(tag) {
  const lines = readFileSync(DOC, 'utf8').split('\n');
  const start = lines.findIndex(l => l.startsWith(`**${tag}:`));
  if (start < 0) { console.warn(`no reference picks found for ${tag} in ${DOC}`); return []; }
  const picks = [];
  for (let k = start + 1; k < lines.length && !lines[k].startsWith('**'); k++) {
    if (!lines[k].startsWith('- ')) continue;
    const m = lines[k].match(/`([^`]+\.(?:jpe?g))`/i);
    if (!m) continue;
    const file = resolve(PHOTOS, m[1]);
    if (!existsSync(file)) { console.warn(`missing reference photo: ${file}`); continue; }
    picks.push({ path: file, label: basename(m[1]).replace(/\.[^.]+$/, '') });
  }
  return picks;
}

/** Latest review folder whose name sorts before `name` (names start with a sortable timestamp). */
function previousReview(name) {
  if (!existsSync(REVIEW_ROOT)) return null;
  const earlier = readdirSync(REVIEW_ROOT).filter(d => REVIEW_NAME.test(d) && d < name).sort();
  return earlier.length ? join(REVIEW_ROOT, earlier[earlier.length - 1]) : null;
}

// Python does the image work (PIL). The job arrives as JSON on stdin.
const PY = String.raw`
import sys, json, os, math
from PIL import Image, ImageDraw, ImageFont

def font(sz):
    for p in ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc']:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, sz)
            except Exception: pass
    return ImageFont.load_default(size=sz)

F, FB = font(18), font(26)
BG, INK, DIM, RED = (16, 16, 18), (236, 236, 236), (190, 190, 190), (230, 90, 90)

def card(path, w, h):
    canvas = Image.new('RGB', (w, h), (30, 30, 34))
    if not path or not os.path.exists(path):
        ImageDraw.Draw(canvas).text((w // 2 - 50, h // 2 - 12), 'missing', fill=RED, font=F)
        return canvas
    im = Image.open(path).convert('RGB')
    im.thumbnail((w, h), Image.LANCZOS)
    canvas.paste(im, ((w - im.width) // 2, (h - im.height) // 2))
    return canvas

def contact_sheet(spec):
    cols = spec.get('cols', 4); tw, th = spec.get('thumb', [480, 270]); bar, head, pad = 34, 56, 12
    cells = spec['cells']; rows = math.ceil(len(cells) / cols)
    W = pad + cols * (tw + pad); H = head + rows * (th + bar + pad) + pad
    img = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(img)
    d.text((pad, 14), spec['title'], fill=INK, font=FB)
    for i, c in enumerate(cells):
        x = pad + (i % cols) * (tw + pad); y = head + (i // cols) * (th + bar + pad)
        img.paste(card(c['path'], tw, th), (x, y))
        d.text((x, y + th + 8), c['label'], fill=DIM, font=F)
    img.save(spec['out'], quality=88)

def before_after(spec):
    tw, th, pad, bar, head = 400, 225, 12, 34, 56
    pairs = spec['pairs']; cols = 2
    cell_w = 2 * tw + pad; rows = math.ceil(len(pairs) / cols)
    W = pad + cols * (cell_w + pad * 2); H = head + rows * (bar + th + bar + pad) + pad
    img = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(img)
    d.text((pad, 14), spec['title'], fill=INK, font=FB)
    for i, p in enumerate(pairs):
        x = pad + (i % cols) * (cell_w + pad * 2); y = head + (i // cols) * (bar + th + bar + pad)
        d.text((x, y + 6), p['label'], fill=INK, font=F)
        img.paste(card(p.get('prev'), tw, th), (x, y + bar))
        img.paste(card(p.get('now'), tw, th), (x + tw + pad, y + bar))
        d.text((x, y + bar + th + 8), 'previous: ' + spec['prevName'], fill=DIM, font=F)
        d.text((x + tw + pad, y + bar + th + 8), 'now: ' + spec['nowName'], fill=DIM, font=F)
    img.save(spec['out'], quality=88)

def photo_sheet(spec):
    # our render on the left, the owner's reference picks in a two-column grid on the right
    ow, oh = 720, 405; pw, ph, pbar, pgap = 320, 180, 26, 12
    picks = spec['picks']; grid_rows = math.ceil(max(len(picks), 1) / 2)
    gridW = 2 * pw + 3 * pgap; gridH = grid_rows * (ph + pbar + pgap) + pgap
    H = max(oh + 56, gridH + 56) + 12; W = 12 + ow + 24 + gridW + 12
    img = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(img)
    d.text((12, 12), spec['label'] + '  (ours | owner reference picks)', fill=INK, font=FB)
    img.paste(card(spec['shot'], ow, oh), (12, 56))
    d.text((12, 56 + oh + 8), 'ours: ' + spec['label'], fill=DIM, font=F)
    gx = 12 + ow + 24
    for i, p in enumerate(picks):
        x = gx + pgap + (i % 2) * (pw + pgap); y = 56 + (i // 2) * (ph + pbar + pgap)
        img.paste(card(p['path'], pw, ph), (x, y))
        d.text((x, y + ph + 4), p['label'], fill=DIM, font=F)
    img.save(spec['out'], quality=88)

job = json.load(sys.stdin)
if job.get('sheet'): contact_sheet(job['sheet']); print('wrote', job['sheet']['out'])
if job.get('vs'): before_after(job['vs']); print('wrote', job['vs']['out'])
for spec in job.get('photos', []):
    os.makedirs(os.path.dirname(spec['out']), exist_ok=True); photo_sheet(spec); print('wrote', spec['out'])
`;

function runPython(job) {
  const r = spawnSync('python3', ['-I', '-c', PY], { input: JSON.stringify(job), encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.status !== 0) throw new Error(`python3 image step failed (needs PIL):\n${r.stderr}`);
}

// ---- main ----
const label = (opt('label') ?? 'pass').replace(/[^a-zA-Z0-9-]+/g, '-');
const from = opt('from');
const dir = from ? resolve(root, from) : join(REVIEW_ROOT, `${stamp(new Date())}-${label}`);
const name = basename(dir);
const failed = [];

if (!from) {
  const t0 = Date.now();
  for (const s of SCENES) {
    console.log(`\n== ${s.group}: ${s.shots.join(', ')}`);
    const r = spawnSync(process.execPath, [HARNESS, '--serve', '--page', s.page, '--query', s.query, '--shots', s.shots.join(','), '--out', join(dir, s.group)], { cwd: root, stdio: 'inherit' });
    if (r.status !== 0) { failed.push(s.group); console.error(`capture failed for ${s.group} (exit ${r.status})`); }
  }
  console.log(`\nshot in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
mkdirSync(dir, { recursive: true });

const cells = SCENES.flatMap(s => s.shots.map(shot => ({ group: s.group, shot, path: join(dir, s.group, `${shot}.jpg`), label: `${s.group}/${shot}` })));
const jobs = { sheet: { out: join(dir, 'sheet.jpg'), title: `Scene review ${name}`, cols: 4, thumb: [480, 270], cells: cells.map(c => ({ path: c.path, label: c.label })) } };

const prevDir = previousReview(name);
if (prevDir) {
  jobs.vs = {
    out: join(dir, 'vs-previous.jpg'), title: `Before / after: ${basename(prevDir)} -> ${name}`,
    prevName: basename(prevDir), nowName: name,
    pairs: cells.map(c => ({ label: c.label, prev: join(prevDir, c.group, `${c.shot}.jpg`), now: c.path })),
  };
} else {
  console.log('no previous review folder; skipping vs-previous.jpg');
}

if (flag('photos')) {
  const scratch = join(SCRATCH_ROOT, name);
  jobs.photos = [];
  const picksByTag = {};
  for (const s of SCENES) {
    picksByTag[s.picks] ??= readPicks(s.picks);
    for (const shot of s.shots) {
      jobs.photos.push({
        out: join(scratch, `${s.group}--${shot}.jpg`), label: `${s.group}/${shot}`,
        shot: join(dir, s.group, `${shot}.jpg`), picks: picksByTag[s.picks],
      });
    }
  }
  console.log(`photo side-by-sides -> ${scratch} (scratch, not committed)`);
}

runPython(jobs);
console.log(`\nreview: ${dir}`);
if (failed.length) { console.error(`failed groups: ${failed.join(', ')}`); process.exit(1); }
