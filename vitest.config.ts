/**
 * Standalone vitest config.
 * Omits the reactRouter() plugin (which requires the full Vite dev server
 * preamble and breaks unit/component tests) while keeping path aliases and
 * CSS transforms out of the way.
 */

import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [
    tsconfigPaths(),
  ],
  test: {
    environment: 'node',
    environmentMatchGlobs: [
      // Component tests that need a DOM run under jsdom.
      ['app/components/**/*.test.tsx', 'jsdom'],
    ],
  },
})
