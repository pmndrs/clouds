import { defineConfig } from 'vitest/config';
import viteConfig from './vite.config';
// Resolve workspace packages from source, as the lab does, so tests never depend on built dist/.
export default defineConfig({ resolve: viteConfig.resolve, test: { include: ['packages/**/*.test.ts', 'bench/**/*.test.ts', 'examples/**/*.test.ts', 'experiments/**/*.test.ts', 'scripts/**/*.test.ts', 'scripts/**/*.test.mjs'] } });
