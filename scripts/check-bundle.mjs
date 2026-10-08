// Bundle-size report for the three cloud packages (P7-B).
//
//   node scripts/check-bundle.mjs            print the table
//   node scripts/check-bundle.mjs --strict   exit 1 when @clouds/runtime is over the core budget
//   node scripts/check-bundle.mjs --json     machine-readable output
//
// Each package entry is bundled with esbuild (ESM, minified, es2022, browser) with three, react, @react-three/*, @pmndrs/*
// external, like a consumer's bundler sees them. Two columns per package:
//   alone     the sibling @clouds/* packages are external (what the package itself adds)
//   +deps     the sibling @clouds/* packages are bundled in (what a consumer ships)
// Sizes are raw / gzip level 9 / brotli quality 11 bytes of the single output chunk. `@clouds/runtime` is the "core": its budget is 60 KB gzip.
import { build } from 'esbuild';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const BUDGET_GZIP = 60 * 1024;
const args = new Set(process.argv.slice(2));
const packages = [
  { name: '@clouds/runtime', entry: 'packages/runtime/src/index.ts', siblings: [] },
  { name: '@clouds/three', entry: 'packages/three/src/index.ts', siblings: ['@clouds/runtime'] },
  { name: '@clouds/react', entry: 'packages/react/src/index.tsx', siblings: ['@clouds/runtime', '@clouds/three'] },
];
const external = ['three', 'three/*', 'react', 'react/*', 'react-dom', 'react-dom/*', '@react-three/*', '@pmndrs/*'];

async function measure(entry, extra) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    minify: true, legalComments: 'none', jsx: 'automatic', tsconfig: 'tsconfig.json', logLevel: 'error',
    external: [...external, ...extra],
  });
  if (result.outputFiles.length !== 1) throw new Error(`${entry}: expected one output chunk, got ${result.outputFiles.length}`);
  const bytes = Buffer.from(result.outputFiles[0].contents);
  return {
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  };
}

const rows = [];
for (const p of packages) {
  const alone = await measure(p.entry, p.siblings);
  const withDeps = p.siblings.length ? await measure(p.entry, []) : alone;
  rows.push({ name: p.name, alone, withDeps });
}

const kb = n => `${(n / 1024).toFixed(1)} KB`;
const core = rows[0].alone;
if (args.has('--json')) {
  console.log(JSON.stringify({ budgetGzipBytes: BUDGET_GZIP, packages: rows, coreWithinBudget: core.gzip < BUDGET_GZIP }, null, 2));
} else {
  console.log('package'.padEnd(18), 'build'.padEnd(8), 'raw'.padStart(10), 'gzip'.padStart(10), 'brotli'.padStart(10));
  for (const r of rows) {
    for (const [label, m] of [['alone', r.alone], ['+deps', r.withDeps]]) {
      if (label === '+deps' && m === r.alone) continue;
      console.log(r.name.padEnd(18), label.padEnd(8), kb(m.raw).padStart(10), kb(m.gzip).padStart(10), kb(m.brotli).padStart(10));
    }
  }
  console.log(`\ncore (@clouds/runtime) gzip ${kb(core.gzip)} of the ${kb(BUDGET_GZIP)} budget: ${core.gzip < BUDGET_GZIP ? 'within budget' : 'OVER BUDGET'}`);
}
if (args.has('--strict') && core.gzip >= BUDGET_GZIP) process.exit(1);
