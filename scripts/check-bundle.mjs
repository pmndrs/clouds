// Bundle-size report for the three cloud packages (P7-B, reworked in P7-C to measure the built dist/ as a consumer's bundler sees it).
//
//   node scripts/check-bundle.mjs            print the table (builds dist/ first when it is missing)
//   node scripts/check-bundle.mjs --strict   exit 1 when a budgeted row is over 60 KB gzip
//   node scripts/check-bundle.mjs --json     machine-readable output
//
// Each entry is bundled with esbuild (ESM, minified, es2022, browser) with three, react, @react-three/*, @pmndrs/* external. Rows:
//   alone      sibling @clouds/* imports external (what the entry itself adds)
//   +deps      siblings bundled in and tree-shaken (what a consumer ships)
// Budgeted (60 KB gzip): the core runtime entry, and the three-user path (`@clouds/three` + the runtime parts it imports). Not budgeted, listed
// separately: the generate / import subpaths and "everything" (core + generate + import, the old single barrel). Sizes are raw / gzip level 9 /
// brotli quality 11 bytes of the single output chunk.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const BUDGET_GZIP = 60 * 1024;
const args = new Set(process.argv.slice(2));
const external = ['three', 'three/*', 'react', 'react/*', 'react-dom', 'react-dom/*', '@react-three/*', '@pmndrs/*'];
const R = 'packages/runtime/dist';

// `entry` is a file or an `export * from` source (all three runtime entries). `budget` marks the rows --strict checks, on the column named.
const targets = [
  { name: '@clouds/runtime (core entry)', entry: `${R}/index.js`, budget: 'alone' },
  { name: '@clouds/runtime/generate', entry: `${R}/generate.js` },
  { name: '@clouds/runtime/import', entry: `${R}/import.js` },
  { name: '@clouds/runtime (core+generate+import)', source: ['index', 'generate', 'import'].map(n => `export * from './${R}/${n}.js';`).join('\n') },
  { name: '@clouds/three', entry: 'packages/three/dist/index.js', siblings: ['@clouds/runtime'], budget: 'withDeps' },
  { name: '@clouds/react', entry: 'packages/react/dist/index.js', siblings: ['@clouds/runtime', '@clouds/three'] },
];

if (!existsSync(`${R}/index.js`)) {
  console.error('dist/ is missing: building it first (node scripts/build-release.mjs --no-list)');
  const r = spawnSync(process.execPath, ['scripts/build-release.mjs', '--no-list'], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

async function measure(t, extra) {
  const result = await build({
    ...(t.source ? { stdin: { contents: t.source, resolveDir: process.cwd(), loader: 'js' } } : { entryPoints: [t.entry] }),
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    minify: true, legalComments: 'none', jsx: 'automatic', logLevel: 'error',
    external: [...external, ...extra],
  });
  if (result.outputFiles.length !== 1) throw new Error(`${t.name}: expected one output chunk, got ${result.outputFiles.length}`);
  const bytes = Buffer.from(result.outputFiles[0].contents);
  return {
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  };
}

const rows = [];
for (const t of targets) {
  const alone = await measure(t, t.siblings ?? []);
  const withDeps = t.siblings?.length ? await measure(t, []) : null;
  rows.push({ name: t.name, budget: t.budget ?? null, alone, withDeps });
}

const kb = n => `${(n / 1024).toFixed(1)} KB`;
const over = rows.filter(r => r.budget && r[r.budget].gzip >= BUDGET_GZIP).map(r => r.name);
if (args.has('--json')) {
  console.log(JSON.stringify({ budgetGzipBytes: BUDGET_GZIP, rows, overBudget: over }, null, 2));
} else {
  console.log('entry'.padEnd(40), 'build'.padEnd(8), 'raw'.padStart(10), 'gzip'.padStart(10), 'brotli'.padStart(10));
  for (const r of rows) {
    for (const [label, m, key] of [['alone', r.alone, 'alone'], ['+deps', r.withDeps, 'withDeps']]) {
      if (!m) continue;
      console.log(r.name.padEnd(40), label.padEnd(8), kb(m.raw).padStart(10), kb(m.gzip).padStart(10), kb(m.brotli).padStart(10), r.budget === key ? (m.gzip < BUDGET_GZIP ? '  <- budget ok' : '  <- OVER BUDGET') : '');
    }
  }
  console.log(`\nbudget ${kb(BUDGET_GZIP)} gzip on: the core runtime entry, and the three-user path (@clouds/three +deps). ${over.length ? 'OVER: ' + over.join(', ') : 'Both within budget.'}`);
}
if (args.has('--strict') && over.length) process.exit(1);
