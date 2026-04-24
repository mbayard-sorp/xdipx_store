/**
 * Guard: ensure app/lib/tts-normalize.ts and ivr/src/tts-normalize.ts stay
 * byte-identical. `ivr/` is a separate Fly.io deploy with its own Dockerfile;
 * it cannot import from `app/`, so we mirror instead of share.
 *
 * Run via `npm test` (wired into the test script) or directly:
 *   npx tsx scripts/check-tts-normalize-sync.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const a = resolve(root, 'app/lib/tts-normalize.ts')
const b = resolve(root, 'ivr/src/tts-normalize.ts')

const aContent = readFileSync(a, 'utf8')
const bContent = readFileSync(b, 'utf8')

if (aContent !== bContent) {
  console.error(`[tts-normalize-sync] FILES DIVERGED:\n  ${a}\n  ${b}\nCopy one to the other.`)
  process.exit(1)
}
console.log('[tts-normalize-sync] OK — files match')
