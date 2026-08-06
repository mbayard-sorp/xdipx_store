/**
 * Bundle server/index.ts into a single file for Vercel deployment.
 *
 * @vercel/node traces imports with nft but doesn't fix bare specifiers,
 * so Node.js ESM fails on extensionless relative imports like './kv.server'.
 * Bundling resolves all app/lib/ imports at build time, avoiding the issue.
 *
 * Output path branches on the environment:
 *
 *   - On Vercel (VERCEL=1, set by the platform during deploys) the bundle is
 *     written to server/vercel-entry.mjs, the entry vercel.json's builds[].src
 *     points at. postinstall triggers this via `npm run build`, so the real
 *     bundle always overwrites the committed placeholder before the function
 *     is packaged.
 *   - Everywhere else (local builds, CI) the bundle goes to
 *     build/vercel-entry-local.mjs, which is gitignored. Local builds must
 *     never rewrite the tracked server/vercel-entry.mjs: the committed file is
 *     a stable stub, and rewriting it made every server PR conflict on a
 *     1.3MB artifact (and a conflicted PR runs zero pull_request workflows,
 *     which is a silent CI blackout).
 */
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const onVercel = process.env.VERCEL === '1'
const outfile = onVercel ? 'server/vercel-entry.mjs' : 'build/vercel-entry-local.mjs'

await build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile,
  // Keep node_modules external. Vercel includes them via nft.
  packages: 'external',
  // Resolve ~/... path alias used in app/lib/
  alias: {
    '~': path.resolve(rootDir, 'app'),
  },
  plugins: [{
    // Keep the React Router build output external, loaded at runtime.
    name: 'externalize-rr-build',
    setup(b) {
      b.onResolve({ filter: /build\/server\/index\.js/ }, () => ({
        path: '../build/server/index.js',
        external: true,
      }))
    },
  }],
})

console.log(`✓ ${outfile} built${onVercel ? '' : ' (local output, tracked stub untouched)'}`)
