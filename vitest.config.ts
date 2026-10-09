import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**', 'e2e/**', 'test/e2e/**'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // Not installable yet — see test/stubs/occulta-core.ts. Tests only; the app build
      // still resolves (and fails on) the real package.
      '@occulta/core': path.resolve(__dirname, 'test/stubs/occulta-core.ts'),
    },
  },
});
