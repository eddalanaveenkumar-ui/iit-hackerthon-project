import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The app relies on the automatic JSX runtime; esbuild must be told the same
  // in tests or every JSX file that does not import React throws.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    css: false,
    restoreMocks: true,
    // Renderers are code-split; a cold jsdom + chunk load can exceed the 1s
    // default under parallel load, which made the acceptance suite flaky.
    testTimeout: 15000,
    // The renderer lazy-loads Monaco/KaTeX; those modules are mocked per-test
    // where they would otherwise pull a 4 MB editor into jsdom.
    server: { deps: { inline: ['zod'] } },
  },
});
