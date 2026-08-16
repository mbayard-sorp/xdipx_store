/**
 * Guard: ensure app/lib/discovery-vocab.ts and ivr/src/discovery-vocab.ts stay
 * byte-identical. `ivr/` is a separate Fly.io deploy with its own Dockerfile;
 * it cannot import from `app/`, so we mirror the discovery vocabulary instead
 * of sharing it.
 *
 * This lives as a vitest test (rather than a standalone tsx script wired into
 * the npm test script) because package.json is a protected path — vitest
 * already runs inside `npm test`, so the guard runs with no package.json edit.
 * Precedent for the byte-identity check itself: scripts/check-tts-normalize-sync.ts.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// This file is app/lib/__tests__/…, so the repo root is three levels up.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('discovery-vocab mirror', () => {
  it('app/lib/discovery-vocab.ts and ivr/src/discovery-vocab.ts are byte-identical', () => {
    const appFile = resolve(root, 'app/lib/discovery-vocab.ts')
    const ivrFile = resolve(root, 'ivr/src/discovery-vocab.ts')
    const appContent = readFileSync(appFile, 'utf8')
    const ivrContent = readFileSync(ivrFile, 'utf8')
    expect(ivrContent).toBe(appContent)
  })
})
