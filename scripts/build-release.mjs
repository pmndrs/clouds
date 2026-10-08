// Release build for @clouds/{runtime,three,react} (P7-C).
//
//   node scripts/build-release.mjs            dist/ (ESM + .d.ts) for the three packages, then `npm pack --dry-run` file lists
//   node scripts/build-release.mjs --pack     also write the tarballs (pnpm pack, so workspace:* becomes a version) to artifacts/release-pkgs/
//   node scripts/build-release.mjs --no-list  skip the dry-run lists
//
// JS: esbuild, ESM, es2022, unminified (consumers' bundlers minify), code splitting inside a package so the subpath entries share chunks.
// Other @clouds/* packages and every peer (three, react, @react-three/*, @pmndrs/*) stay external. Types: `tsc -p <pkg>/tsconfig.build.json`
// (declaration emit only), in dependency order because three/react resolve @clouds/runtime to the runtime's emitted .d.ts.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const external = ['@clouds/*', 'three', 'three/*', 'react', 'react/*', 'react-dom', 'react-dom/*', '@react-three/*', '@pmndrs/*'];
const packages = [
  { dir: 'runtime', entries: { index: 'src/index.ts', generate: 'src/generate/index.ts', import: 'src/import/index.ts' } },
  { dir: 'three', entries: { index: 'src/index.ts' } },
  { dir: 'react', entries: { index: 'src/index.tsx' } },
];

function run(cmd, cmdArgs, cwd) {
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`failed: ${cmd} ${cmdArgs.join(' ')} (in ${path.relative(root, cwd) || '.'})`); process.exit(r.status ?? 1); }
}

for (const p of packages) {
  const cwd = path.join(root, 'packages', p.dir);
  await rm(path.join(cwd, 'dist'), { recursive: true, force: true });
  await build({
    absWorkingDir: cwd, entryPoints: p.entries, outdir: 'dist', bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022',
    jsx: 'automatic', external, logLevel: 'warning', legalComments: 'none', chunkNames: 'chunks/[name]-[hash]',
    // tsconfig `paths` (the repo's source aliases) must not rewrite @clouds/* here: they are external imports of the published packages.
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
  });
  run(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], cwd);
  console.log(`built @clouds/${p.dir}`);
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) out.push(...(e.isDirectory() ? await walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  return out;
}
let total = 0;
for (const p of packages) for (const f of await walk(path.join(root, 'packages', p.dir, 'dist'))) if (f.endsWith('.js')) total += (await stat(f)).size;
console.log(`dist JS total ${(total / 1024).toFixed(1)} KB (unminified)`);

if (!args.has('--no-list')) {
  for (const p of packages) {
    const cwd = path.join(root, 'packages', p.dir);
    const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd, encoding: 'utf8' });
    if (r.status !== 0) { console.error(r.stderr); process.exit(r.status ?? 1); }
    const info = JSON.parse(r.stdout)[0];
    console.log(`\n@clouds/${p.dir}: ${info.entryCount} files, ${(info.size / 1024).toFixed(1)} KB packed, ${(info.unpackedSize / 1024).toFixed(1)} KB unpacked`);
    for (const f of info.files.map(f => f.path).sort()) console.log('  ' + f);
  }
}

if (args.has('--pack')) {
  const out = path.join(root, 'artifacts/release-pkgs');
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  for (const p of packages) run('pnpm', ['pack', '--pack-destination', out], path.join(root, 'packages', p.dir));
  console.log(`\ntarballs in ${path.relative(root, out)}`);
}
