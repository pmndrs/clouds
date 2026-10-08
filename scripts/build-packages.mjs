import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, cp, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const packages = {
  core: { index: 'index.ts' },
  three: { index: 'index.ts', layers: 'layers/index.ts', environment: 'environment/index.ts', reconstruction: 'reconstruction/adapter.ts', 'optical-resolve': 'optical-resolve/index.ts' },
  react: { index: 'index.ts', layers: 'layers.tsx' },
  assets: { index: 'index.ts' },
  tools: { index: 'index.ts' },
};
const typesRoot = 'artifacts/package-types';
await mkdir('artifacts', { recursive: true });
await rm(typesRoot, { recursive: true, force: true });
const result = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.packages.json'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
for (const [name, entries] of Object.entries(packages)) {
  const base = `packages/${name}`, outdir = `${base}/dist`;
  await rm(outdir, { recursive: true, force: true });
  const entryPoints = Object.fromEntries(Object.entries(entries).map(([key, file]) => [key, `${base}/src/${file}`]));
  const output = await build({ entryPoints, outdir, bundle: true, splitting: true, format: 'esm', platform: 'neutral', target: 'es2022', sourcemap: true, metafile: true, packages: 'external', jsx: 'automatic' });
  await writeFile(`artifacts/${name}-bundle.json`, JSON.stringify(output.metafile, null, 2));
  if (name === 'three') {
    const outputs = output.metafile.outputs;
    function closure(file, visited = new Set()) {
      if (visited.has(file)) return { inputs: [], external: [] };
      visited.add(file);
      const item = outputs[file];
      if (!item) throw new Error(`Missing bundle output ${file}`);
      const inputs = Object.keys(item.inputs), external = [];
      for (const dependency of item.imports) {
        if (dependency.external) external.push(dependency.path);
        else { const nested = closure(dependency.path, visited); inputs.push(...nested.inputs); external.push(...nested.external); }
      }
      return { inputs: [...new Set(inputs)], external: [...new Set(external)] };
    }
    const vanilla = closure(`${outdir}/index.js`), layer = closure(`${outdir}/layers.js`);
    for (const boundary of [vanilla, layer]) if (boundary.external.some(id => /^(react|react-dom|@react-three|@pmndrs\/upscaler)(\/|$)/.test(id))) throw new Error('Vanilla/layer imported React or FSR');
    if (layer.inputs.some(file => /\/(cloudscape|volumetric|sources|reconstruction|world|assets|tools)\//.test(file))) throw new Error('Layer bundled a volume or asset runtime');
    await writeFile('artifacts/package-boundaries.json', JSON.stringify({ vanilla, layer }, null, 2));
  }

  await cp(`${typesRoot}/${name}/src`, `${outdir}/types`, { recursive: true });
  await cp('LICENSE', `${base}/LICENSE`);
  const manifest = JSON.parse(await readFile(`${base}/package.json`, 'utf8'));
  // Public subpath declaration forwarding keeps source types without leaking workspace paths.
  for (const [key, file] of Object.entries(entries)) {
    const source = file.replace(/\.tsx?$/, '.js');
    await writeFile(`${outdir}/${key}.d.ts`, `export * from './types/${source}';\n`);
  }
  // NodeNext consumers also need explicit relative extensions in declaration files.
  async function fixTypes(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) { await fixTypes(file); continue; }
      if (!file.endsWith('.d.ts')) continue;
      const text = await readFile(file, 'utf8');
      const matches = [...text.matchAll(/(['"])(\.[^'"\n]+)\1/g)];
      let updated = text;
      for (const [, quote, specifier] of matches) {
        if (/\.(js|json|mjs)$/.test(specifier)) continue;
        const target = path.resolve(path.dirname(file), specifier);
        const flat = await stat(target + '.d.ts').then(() => true, () => false);
        updated = updated.replaceAll(quote + specifier + quote, quote + specifier + (flat ? '.js' : '/index.js') + quote);
      }
      await writeFile(file, updated);
    }
  }
  await fixTypes(`${outdir}/types`);
  console.log(`Built ${manifest.name}: ${Object.keys(entries).join(', ')}`);
}
