// Packed-consumer smoke test for @clouds/{runtime,three,react} (P7-C).
//
//   node scripts/check-packed-consumer.mjs            build + pack the three packages, install the tarballs in a clean dir, typecheck and bundle
//   node scripts/check-packed-consumer.mjs --online   allow pnpm to hit the registry (default: --offline, from the pnpm store)
//   node scripts/check-packed-consumer.mjs --no-build reuse artifacts/release-pkgs
//
// artifacts/packed-release-consumer/ is an independent project (own pnpm-workspace.yaml, no workspace links, no source aliases). It depends on the
// three tarballs (`pnpm pack` rewrites workspace:* to the version) plus the peers pinned like the repo root. Checks:
//   1. install                          the tarballs' dependencies and peers resolve
//   2. tsc --noEmit (strict)            a three example and a react example import every public subpath and typecheck against the shipped .d.ts
//   3. node: import() each runtime entry  the ESM exports resolve and evaluate without a GPU
//   4. esbuild bundle of both examples  nothing under /packages/ (no workspace source leak); the three example has no react and (as it does not
//                                       import @clouds/runtime/import) no vendored VDB parser; the react example has no vendored parser either
//   5. the runtime tarball carries the vendored Apache-2.0 LICENSE and NOTICE
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const dest = path.join(root, 'artifacts/packed-release-consumer');
const tarDir = path.join(root, 'artifacts/release-pkgs');
const sh = (cmd, a, cwd, opts = {}) => {
  const r = spawnSync(cmd, a, { cwd, stdio: 'inherit', env: { ...process.env, CI: 'true' }, ...opts });
  if (r.status !== 0) { console.error(`FAILED: ${cmd} ${a.join(' ')}`); process.exit(r.status ?? 1); }
};

if (!args.has('--no-build')) sh(process.execPath, [path.join(root, 'scripts/build-release.mjs'), '--pack', '--no-list'], root);
const tarballs = (await readdir(tarDir)).filter(f => f.endsWith('.tgz'));
const tar = name => tarballs.find(f => f.startsWith(`clouds-${name}-`));
for (const n of ['runtime', 'three', 'react']) if (!tar(n)) { console.error(`missing tarball for ${n} in ${tarDir}`); process.exit(1); }

// 5. licence files in the runtime tarball
const listing = spawnSync('tar', ['-tzf', path.join(tarDir, tar('runtime'))], { encoding: 'utf8' }).stdout.split('\n');
for (const f of ['package/vendor/vdb-web-tools/LICENSE', 'package/vendor/vdb-web-tools/NOTICE', 'package/LICENSE']) if (!listing.includes(f)) { console.error(`runtime tarball lacks ${f}`); process.exit(1); }

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
const rootPkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const dev = rootPkg.devDependencies;
const file = n => `file:../release-pkgs/${tar(n)}`;
const deps = {
  '@clouds/runtime': file('runtime'), '@clouds/three': file('three'), '@clouds/react': file('react'),
  three: dev.three, react: dev.react, 'react-dom': dev['react-dom'], '@react-three/fiber': dev['@react-three/fiber'], '@pmndrs/sky': dev['@pmndrs/sky'],
};
await writeFile(path.join(dest, 'package.json'), JSON.stringify({
  name: 'clouds-packed-release-consumer', private: true, type: 'module', dependencies: deps,
  devDependencies: { '@types/three': dev['@types/three'], '@types/react': dev['@types/react'], '@webgpu/types': dev['@webgpu/types'] },
  // sibling @clouds/* inside the three/react tarballs must resolve to the tarballs, not the registry
  pnpm: { overrides: { '@clouds/runtime': deps['@clouds/runtime'], '@clouds/three': deps['@clouds/three'] } },
}, null, 2));
await writeFile(path.join(dest, 'pnpm-workspace.yaml'), 'packages: []\n');
sh('pnpm', ['install', ...(args.has('--online') ? [] : ['--offline']), '--ignore-scripts', '--no-frozen-lockfile'], dest);

await writeFile(path.join(dest, 'tsconfig.json'), JSON.stringify({
  compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, skipLibCheck: true, jsx: 'react-jsx', lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: ['@webgpu/types'], verbatimModuleSyntax: true },
  include: ['*.ts', '*.tsx'],
}, null, 2));

// A minimal three example: every runtime subpath is touched so the .d.ts of each is checked.
await writeFile(path.join(dest, 'three-example.ts'), `
import { ACESFilmicToneMapping, PerspectiveCamera, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend, CLOUD_QUALITIES, type CloudQuality } from '@clouds/three';
import { loadCloudNoise, type CloudSettings, type GpuCloudVolume } from '@clouds/runtime';
import { CLOUD_PRESETS, createVolumeGenerator, type CloudPresetName } from '@clouds/runtime/generate';

export async function main(): Promise<void> {
  const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  await renderer.init();
  const scene = new Scene();
  const camera = new PerspectiveCamera(70, 16 / 9, 1, 1500000);
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 14, latitude: 40, north: '-Z' });
  sky.attach(scene);
  await sky.compileAsync();
  const quality: CloudQuality = CLOUD_QUALITIES[3];
  const clouds = new Clouds(renderer, { sky, quality });
  await clouds.load({ volume: '/clouds/parkouring/', position: [0, 500, 0] });
  const post = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  post.outputNode = clouds.node(scenePass.getTextureNode(), scenePass);
  const settings: Partial<CloudSettings> = { msStrength: 1.2 };
  void settings;
  const name = Object.keys(CLOUD_PRESETS)[0] as CloudPresetName;
  const backend = sharedBackend(renderer);
  void createVolumeGenerator; void backend; void name; void loadCloudNoise; void (null as GpuCloudVolume | null);
  renderer.setAnimationLoop(() => { sky.update(camera); post.render(); });
}
`);
await writeFile(path.join(dest, 'react-example.tsx'), `
import { Suspense } from 'react';
import { AutoHaze } from '@pmndrs/sky/react/auto-haze';
import { Sky } from '@pmndrs/sky/react';
import { Canvas } from '@react-three/fiber/webgpu';
import { Clouds, Cloudscape, CLOUD_PRESETS, preloadClouds, type CloudQuality } from '@clouds/react';

preloadClouds('/clouds/stormbird/');
void Cloudscape; void CLOUD_PRESETS;
export function App({ quality = 'high' }: { quality?: CloudQuality }) {
  return (
    <Canvas renderer={{ antialias: false, trackTimestamp: true }}>
      <Sky preset="earth" timeOfDay={16}>
        <AutoHaze />
        <Suspense fallback={null}>
          <Clouds volume="/clouds/stormbird/" position={[0, 600, 0]} quality={quality} densityScale={0.15} />
        </Suspense>
      </Sky>
    </Canvas>
  );
}
`);
await writeFile(path.join(dest, 'import-example.ts'), `
import { importVdb, VdbImportError, type VdbImportInfo } from '@clouds/runtime/import';
export async function load(device: GPUDevice, file: File): Promise<VdbImportInfo> {
  try { return (await importVdb(device, await file.arrayBuffer(), { voxelSize: 8 })).info; } catch (e) { if (e instanceof VdbImportError) throw e; throw e; }
}
`);

// 2. typecheck
sh(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(dest, 'tsconfig.json')], dest);
console.log('typecheck: ok (three example, react example, import example)');

// 3. runtime entries evaluate in node
const probe = `
const core = await import('@clouds/runtime'), gen = await import('@clouds/runtime/generate'), imp = await import('@clouds/runtime/import');
const need = [[core, 'createCloudRuntime'], [core, 'loadCloudVolume'], [gen, 'createVolumeGenerator'], [gen, 'CLOUD_PRESETS'], [imp, 'importVdb'], [imp, 'VdbImportError']];
for (const [m, k] of need) if (!(k in m)) throw new Error('missing export ' + k);
if ('importVdb' in core || 'createVolumeGenerator' in core) throw new Error('core entry leaks subpath exports');
console.log('node import: ok (' + Object.keys(core).length + ' core, ' + Object.keys(gen).length + ' generate, ' + Object.keys(imp).length + ' import exports)');
`;
await writeFile(path.join(dest, 'probe.mjs'), probe);
sh(process.execPath, ['probe.mjs'], dest);

// 4. bundles
const external = [];
const report = {};
for (const [name, entry] of [['three-example', 'three-example.ts'], ['react-example', 'react-example.tsx'], ['import-example', 'import-example.ts']]) {
  const r = await build({
    absWorkingDir: dest, entryPoints: [path.join(dest, entry)], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', target: 'es2022',
    minify: true, jsx: 'automatic', tsconfig: path.join(dest, 'tsconfig.json'), logLevel: 'error', external,
  });
  const inputs = Object.keys(r.metafile.inputs);
  const code = r.outputFiles[0].text;
  const leaked = inputs.filter(p => p.includes('/packages/') && !p.includes('node_modules'));
  if (leaked.length) throw new Error(`${name}: workspace source leaked: ${leaked.slice(0, 3)}`);
  const has = re => inputs.some(p => re.test(p));
  if (name === 'three-example' && has(/node_modules\/(\.pnpm\/[^/]*\/node_modules\/)?(react|react-dom|@react-three)\//)) throw new Error('three example pulled in react');
  const vdb = /VdbUnsupportedError|lz4DecompressBlock|bloscDecompress/.test(code);
  if (name !== 'import-example' && vdb) throw new Error(`${name}: bundles the vendored VDB parser it does not use`);
  if (name === 'import-example' && !vdb) throw new Error('import example lacks the VDB parser');
  report[name] = { rawKB: +(code.length / 1024).toFixed(1), gzipKB: +(gzipSync(code, { level: 9 }).length / 1024).toFixed(1), inputs: inputs.length };
}
console.log('bundles (everything incl. three/react/sky, minified):', JSON.stringify(report));
console.log('\nPACKED CONSUMER OK');
