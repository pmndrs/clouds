// Bundle-size report for the three cloud packages (P7-B, reworked in P7-C to measure the built dist/ as a consumer's bundler sees it).
//
//   node scripts/check-bundle.mjs            print the table (builds dist/ first when it is missing)
//   node scripts/check-bundle.mjs --strict   accepted for old scripts; no longer fails (no size cap, owner 2026-10-09)
//   node scripts/check-bundle.mjs --json     machine-readable output
//
// Each entry is bundled with esbuild (ESM, minified, es2022, browser) with three, react, @react-three/*, @pmndrs/* external. Rows:
//   alone      sibling @clouds/* imports external (what the entry itself adds)
//   +deps      siblings bundled in and tree-shaken (what a consumer ships)
// Report only: the owner removed the package size cap (2026-10-09), so nothing fails on size. Sizes are raw / gzip level 9 / brotli quality 11
// bytes of the single output chunk.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const args = new Set(process.argv.slice(2));
const external = ['three', 'three/*', 'react', 'react/*', 'react-dom', 'react-dom/*', '@react-three/*', '@pmndrs/*'];
const R = 'packages/runtime/dist';

// `entry` is a file or an `export * from` source (all three runtime entries).
const targets = [
  { name: '@clouds/runtime (core entry)', entry: `${R}/index.js` },
  { name: '@clouds/runtime/generate', entry: `${R}/generate.js` },
  { name: '@clouds/runtime/import', entry: `${R}/import.js` },
  { name: '@clouds/runtime (core+generate+import)', source: ['index', 'generate', 'import'].map(n => `export * from './${R}/${n}.js';`).join('\n') },
  { name: '@clouds/three', entry: 'packages/three/dist/index.js', siblings: ['@clouds/runtime'] },
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
    // The repo's tsconfig `paths` alias @clouds/* to source; a consumer resolves the packages' dist/, so ignore them (else the +deps rows measure unminified source).
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
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
  rows.push({ name: t.name, alone, withDeps });
}

const kb = n => `${(n / 1024).toFixed(1)} KB`;
if (args.has('--json')) {
  console.log(JSON.stringify({ rows }, null, 2));
} else {
  console.log('entry'.padEnd(40), 'build'.padEnd(8), 'raw'.padStart(10), 'gzip'.padStart(10), 'brotli'.padStart(10));
  for (const r of rows) {
    for (const [label, m] of [['alone', r.alone], ['+deps', r.withDeps]]) {
      if (!m) continue;
      console.log(r.name.padEnd(40), label.padEnd(8), kb(m.raw).padStart(10), kb(m.gzip).padStart(10), kb(m.brotli).padStart(10));
    }
  }
}
