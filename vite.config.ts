import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: 'examples/lab',
  resolve: { alias: {
    '@clouds/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    '@clouds/three': fileURLToPath(new URL('./packages/three/src/index.ts', import.meta.url)),
  } },
  server: { port: 5173, strictPort: true, fs: { allow: ['../..'] } },
  build: { outDir: '../../dist/lab', emptyOutDir: true },
});
