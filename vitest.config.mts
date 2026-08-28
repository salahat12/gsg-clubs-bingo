import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./src/*", so route files (which
    // import via the alias, like the rest of the app) can be loaded and
    // mocked under test without rewriting their imports.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['db/tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
