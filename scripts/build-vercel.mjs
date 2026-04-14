/**
 * Bundle server/index.ts into a single file for Vercel deployment.
 *
 * @vercel/node traces imports with nft but doesn't fix bare specifiers,
 * so Node.js ESM fails on extensionless relative imports like './kv.server'.
 * Bundling resolves all app/lib/ imports at build time, avoiding the issue.
 */
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

await build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'server/vercel-entry.mjs',
  // Keep node_modules external — Vercel includes them via nft
  packages: 'external',
  // Resolve ~/... path alias used in app/lib/
  alias: {
    '~': path.resolve(rootDir, 'app'),
  },
  plugins: [{
    // Keep the React Router build output external — loaded at runtime
    name: 'externalize-rr-build',
    setup(b) {
      b.onResolve({ filter: /build\/server\/index\.js/ }, () => ({
        path: '../build/server/index.js',
        external: true,
      }))
    },
  }],
})

console.log('✓ server/vercel-entry.mjs built')
