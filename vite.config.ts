import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: 'examples/lab',
  resolve: { alias: {
    '@clouds/three/layers': fileURLToPath(new URL('./packages/three/src/layers/index.ts', import.meta.url)),
    '@clouds/three/environment': fileURLToPath(new URL('./packages/three/src/environment/index.ts', import.meta.url)),
    '@clouds/react/layers': fileURLToPath(new URL('./packages/react/src/layers.tsx', import.meta.url)),
    '@clouds/react': fileURLToPath(new URL('./packages/react/src/index.ts', import.meta.url)),
    '@clouds/assets': fileURLToPath(new URL('./packages/assets/src/index.ts', import.meta.url)),
    '@clouds/tools': fileURLToPath(new URL('./packages/tools/src/index.ts', import.meta.url)),
    '@clouds/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    '@clouds/three': fileURLToPath(new URL('./packages/three/src/index.ts', import.meta.url)),
  } },
  server: { port: 5173, strictPort: true, fs: { allow: ['../..'] } },
  build: { outDir: '../../dist/lab', emptyOutDir: true, rollupOptions: { input: {
    reactDensity: fileURLToPath(new URL('./examples/lab/react-density/index.html', import.meta.url)),
    realism: fileURLToPath(new URL('./examples/lab/realism/index.html', import.meta.url)),
    densityStudy: fileURLToPath(new URL('./examples/lab/density-study/index.html', import.meta.url)),
    lodStudy: fileURLToPath(new URL('./examples/lab/lod-study/index.html', import.meta.url)),
    coverageStudy: fileURLToPath(new URL('./examples/lab/coverage-study/index.html', import.meta.url)),
    lightingBench: fileURLToPath(new URL('./examples/lab/lighting-bench/index.html', import.meta.url)),
    quality: fileURLToPath(new URL('./examples/lab/quality-bench/index.html', import.meta.url)),
    three: fileURLToPath(new URL('./examples/lab/three/index.html', import.meta.url)),
    react: fileURLToPath(new URL('./examples/lab/react/index.html', import.meta.url)),
    authored: fileURLToPath(new URL('./examples/lab/authored/index.html', import.meta.url)),
    lab: fileURLToPath(new URL('./examples/lab/index.html', import.meta.url)),
    clouds: fileURLToPath(new URL('./examples/lab/clouds/index.html', import.meta.url)),
    reconstruction: fileURLToPath(new URL('./examples/lab/reconstruction/index.html', import.meta.url)),
    lighting: fileURLToPath(new URL('./examples/lab/lighting/index.html', import.meta.url)),
    cloudscape: fileURLToPath(new URL('./examples/lab/cloudscape/index.html', import.meta.url)),
    layer: fileURLToPath(new URL('./examples/lab/layer-only/index.html', import.meta.url)),
  } } },
});
