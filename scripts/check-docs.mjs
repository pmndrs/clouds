// Documentation checks (P7-B).
//
//   node scripts/check-docs.mjs            both checks
//   node scripts/check-docs.mjs --links    only the relative-link check
//   node scripts/check-docs.mjs --samples  only the code-sample typecheck
//
// Links: every relative `[text](path#anchor)` in README.md, docs/guide/*.md and packages/{runtime,three,react}/README.md must point at an
//        existing file or directory, and, for a Markdown target with an #anchor, at an existing heading (GitHub slugs).
// Samples: every ```ts / ```tsx fence is written to its own module under work/captures/scratch/doc-samples/ and checked with `tsc --noEmit`
//        against the repo's tsconfig (so `@clouds/*` resolve to the sources through its `paths`). Put `nocheck` after the language
//        (```ts nocheck) to skip a fence. Samples may `declare const x: T;` the objects they assume. A comment `<!-- doc-preamble ... -->`
//        directly before a fence is prepended to that sample (invisible when rendered): imports and declarations a short snippet assumes.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const doLinks = args.has('--links') || !args.has('--samples');
const doSamples = args.has('--samples') || !args.has('--links');
const root = process.cwd();
const files = ['README.md', 'packages/runtime/README.md', 'packages/three/README.md', 'packages/react/README.md',
  ...readdirSync('docs/guide').filter(f => f.endsWith('.md')).sort().map(f => `docs/guide/${f}`)];

const fences = text => {
  const out = [];
  const re = /^```([^\n]*)\n([\s\S]*?)^```/gm;
  for (let m; (m = re.exec(text));) out.push({ info: m[1].trim(), body: m[2], line: text.slice(0, m.index).split('\n').length + 1, start: m.index, end: m.index + m[0].length });
  return out;
};
const stripFences = text => fences(text).reduceRight((t, f) => t.slice(0, f.start) + ' '.repeat(0) + t.slice(f.end), text);
const slug = h => h.trim().toLowerCase().replace(/`/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
const anchorsOf = text => new Set(stripFences(text).split('\n').filter(l => /^#{1,6}\s/.test(l)).map(l => slug(l.replace(/^#{1,6}\s+/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'))));

let failed = false;

if (doLinks) {
  let checked = 0;
  const broken = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const prose = stripFences(text).replace(/`[^`\n]*`/g, '');
    for (const m of prose.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const href = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // http:, https:, mailto:
      checked++;
      const [rel, anchor] = href.split('#');
      const target = rel ? path.resolve(path.dirname(file), decodeURIComponent(rel)) : path.resolve(file);
      if (!existsSync(target)) { broken.push(`${file}: ${href} (no such file)`); continue; }
      if (anchor && statSync(target).isFile() && target.endsWith('.md') && !anchorsOf(readFileSync(target, 'utf8')).has(anchor)) broken.push(`${file}: ${href} (no such heading)`);
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
      const name = `${file.replace(/\.md$/, '').replace(/[\\/]/g, '__')}__${String(++n).padStart(2, '0')}_L${f.line}.${lang}`;
      const pre = text.slice(0, f.start).match(/<!--\s*doc-preamble\n((?:(?!-->)[\s\S])*)-->\s*$/);
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

process.exit(failed ? 1 : 0);
