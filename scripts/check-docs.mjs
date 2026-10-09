// Documentation checks (P7-B).
//
//   node scripts/check-docs.mjs            both checks
//   node scripts/check-docs.mjs --links    only the relative-link check
//   node scripts/check-docs.mjs --samples  only the code-sample typecheck
//   node scripts/check-docs.mjs --meta     only the frontmatter check
//   node scripts/check-docs.mjs --build    also build docs/guide with `npx @pmndrs/docs` (needs network; the real MDX compile)
//
// The guide is MDX for pmndrs/docs (`.github/workflows/docs.yml`): docs/guide/*.mdx, each with frontmatter `title`, `description`, `nav`.
// Meta:  every guide page has a non-empty string `title` and `description` and a unique integer `nav`.
// Links: every relative `[text](path#anchor)` in README.md, docs/guide/*.mdx and packages/{runtime,three,react}/README.md must point at an
//        existing file or directory, and, for a Markdown/MDX target with an #anchor, at an existing heading. Anchors in .mdx targets use
//        pmndrs/docs' slugs (lower case, whitespace to `-`, punctuation kept; repeats get -1, -2), in .md targets GitHub's.
//        Absolute links under GITHUB_BASE (repo URL, one constant below) must point at an existing local path.
// Samples: every ```ts / ```tsx fence is written to its own module under work/captures/scratch/doc-samples/ and checked with `tsc --noEmit`
//        against the repo's tsconfig (so `@clouds/*` resolve to the sources through its `paths`). Put `nocheck` after the language
//        (```ts nocheck) to skip a fence. Samples may `declare const x: T;` the objects they assume. A comment `<!-- doc-preamble ... -->`
//        directly before a fence (in .mdx: `{/* doc-preamble ... */}`) is prepended to that sample (invisible when rendered): imports and declarations a short snippet assumes.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// The repository URL is not final: this is the only place (besides `github:` in .github/workflows/docs.yml) that names it.
const GITHUB_BASE = 'https://github.com/pmndrs/clouds';
const GITHUB_BRANCH = 'main';

const args = new Set(process.argv.slice(2));
const only = ['--links', '--samples', '--meta'].filter(a => args.has(a));
const doLinks = !only.length || args.has('--links');
const doSamples = !only.length || args.has('--samples');
const doMeta = !only.length || args.has('--meta');
const doBuild = args.has('--build');
const root = process.cwd();
const files = ['README.md', 'packages/runtime/README.md', 'packages/three/README.md', 'packages/react/README.md',
  ...readdirSync('docs/guide').filter(f => /\.mdx?$/.test(f)).sort().map(f => `docs/guide/${f}`)];

const fences = text => {
  const out = [];
  const re = /^```([^\n]*)\n([\s\S]*?)^```/gm;
  for (let m; (m = re.exec(text));) out.push({ info: m[1].trim(), body: m[2], line: text.slice(0, m.index).split('\n').length + 1, start: m.index, end: m.index + m[0].length });
  return out;
};
const stripFences = text => fences(text).reduceRight((t, f) => t.slice(0, f.start) + ' '.repeat(0) + t.slice(f.end), text);
const isMdx = f => f.endsWith('.mdx');
const frontmatter = text => {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
};
const body = text => text.replace(/^---\n[\s\S]*?\n---\n/, '');
const slug = h => h.trim().toLowerCase().replace(/`/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
const pmndrsSlug = h => h.replace(/`/g, '').toLowerCase().replace(/\s+|-+/g, '-');
const anchorsOf = (text, mdx) => {
  const seen = new Map();
  const out = new Set();
  for (const l of stripFences(mdx ? body(text) : text).split('\n').filter(l => /^#{1,6}\s/.test(l))) {
    const h = l.replace(/^#{1,6}\s+/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    let id = mdx ? pmndrsSlug(h) : slug(h);
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    out.add(n ? `${id}-${n}` : id);
  }
  return out;
};

let failed = false;

if (doMeta) {
  const bad = [];
  const navs = new Map();
  let pages = 0;
  for (const file of files.filter(f => f.startsWith('docs/guide/'))) {
    if (!isMdx(file)) { bad.push(`${file}: guide pages must be .mdx`); continue; }
    pages++;
    const fm = frontmatter(readFileSync(file, 'utf8'));
    if (!fm) { bad.push(`${file}: no frontmatter`); continue; }
    if (!fm.title) bad.push(`${file}: missing title`);
    if (!fm.description) bad.push(`${file}: missing description`);
    if (!/^\d+$/.test(fm.nav ?? '')) bad.push(`${file}: nav must be an integer`);
    else if (navs.has(fm.nav)) bad.push(`${file}: nav ${fm.nav} already used by ${navs.get(fm.nav)}`);
    else navs.set(fm.nav, file);
  }
  console.log(`meta: ${pages} guide pages, ${bad.length} frontmatter problems`);
  for (const b of bad) console.log(`  BAD ${b}`);
  if (bad.length) failed = true;
}

if (doLinks) {
  let checked = 0;
  const broken = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const prose = stripFences(text).replace(/`[^`\n]*`/g, '');
    for (const m of prose.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const href = m[1];
      if (href.startsWith(`${GITHUB_BASE}/`)) {
        checked++;
        const m = href.slice(GITHUB_BASE.length + 1).match(/^(?:blob|tree)\/([^/]+)\/([^#?]*)/);
        if (!m || m[1] !== GITHUB_BRANCH) broken.push(`${file}: ${href} (not ${GITHUB_BASE}/{blob,tree}/${GITHUB_BRANCH}/...)`);
        else if (!existsSync(decodeURIComponent(m[2]))) broken.push(`${file}: ${href} (no such path in the repo)`);
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // http:, https:, mailto:
      checked++;
      const [rel, anchor] = href.split('#');
      const target = rel ? path.resolve(path.dirname(file), decodeURIComponent(rel)) : path.resolve(file);
      if (!existsSync(target)) { broken.push(`${file}: ${href} (no such file)`); continue; }
      if (anchor && statSync(target).isFile() && /\.mdx?$/.test(target) && !anchorsOf(readFileSync(target, 'utf8'), isMdx(target)).has(anchor)) broken.push(`${file}: ${href} (no such heading)`);
    }
  }
  console.log(`links: ${checked} relative links in ${files.length} files, ${broken.length} broken`);
  for (const b of broken) console.log(`  BROKEN ${b}`);
  if (broken.length) failed = true;
}

if (doSamples) {
  const dir = path.join(root, 'work/captures/scratch/doc-samples');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const index = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    let n = 0;
    for (const f of fences(text)) {
      const [lang, flag] = f.info.split(/\s+/);
      if (lang !== 'ts' && lang !== 'tsx') continue;
      if (flag === 'nocheck') continue;
      const name = `${file.replace(/\.mdx?$/, '').replace(/[\\/]/g, '__')}__${String(++n).padStart(2, '0')}_L${f.line}.${lang}`;
      const pre = text.slice(0, f.start).match(/(?:<!--|\{\/\*)\s*doc-preamble\n((?:(?!-->|\*\/\})[\s\S])*)(?:-->|\*\/\})\s*$/);
      const code = pre ? `${pre[1]}\n${f.body}` : f.body;
      const body = /^\s*(import|export)\s/m.test(code) ? code : `${code}\nexport {};\n`;
      writeFileSync(path.join(dir, name), body);
      index.push(`${name} <- ${file}:${f.line}`);
    }
  }
  writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    extends: '../../../../tsconfig.json',
    compilerOptions: { noEmit: true, types: ['@webgpu/types', 'node'] },
    include: ['./*.ts', './*.tsx'],
  }, null, 2));
  writeFileSync(path.join(dir, 'INDEX.txt'), `${index.join('\n')}\n`);
  const run = spawnSync('npx', ['tsc', '-p', path.join(dir, 'tsconfig.json')], { stdio: 'inherit' });
  console.log(`samples: ${index.length} code samples extracted to ${path.relative(root, dir)}/, tsc ${run.status === 0 ? 'passed' : 'FAILED'}`);
  if (run.status !== 0) failed = true;
}

if (doBuild) {
  const out = path.join(root, 'work/captures/scratch/docs-build');
  rmSync(out, { recursive: true, force: true });
  const run = spawnSync('npx', ['-y', '@pmndrs/docs@3', 'build', 'docs/guide', out], { stdio: 'inherit' });
  console.log(`build: @pmndrs/docs ${run.status === 0 ? 'compiled every page' : 'FAILED'}`);
  if (run.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
