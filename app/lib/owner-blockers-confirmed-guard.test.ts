/**
 * #4702 — the two reliability guards that keep a credential-scoped absence from
 * being filed as a fact about the world:
 *
 *   1. guardedRun: the probe-runner boundary maps a thrown "could not ask" to
 *      null, never false. false is reserved for an authoritative "still blocked".
 *   2. fileBlocker: a CONFIRMED-titled blocker is rejected unless it names the
 *      credential/app/path the check ran with (a non-empty evidence field).
 *
 * Both paths under test throw or resolve BEFORE any DB access, so this suite is
 * hermetic (no Neon). It imports the server module (where both live), matching
 * owner-blockers-webhook-probe.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { guardedRun, fileBlocker } from '~/lib/owner-blockers.server'

describe('guardedRun maps a could-not-ask to null, never false (#4702)', () => {
  it('a throwing runner resolves to null', async () => {
    const run = guardedRun('table_exists', async () => {
      throw new Error('DB unreachable')
    })
    await expect(run('anything')).resolves.toBeNull()
  })

  it('an authoritative false passes through unchanged', async () => {
    const run = guardedRun('table_exists', async () => false)
    await expect(run('some_table')).resolves.toBe(false)
  })

  it('an authoritative true passes through unchanged', async () => {
    const run = guardedRun('table_exists', async () => true)
    await expect(run('some_table')).resolves.toBe(true)
  })

  it('a runner that returns null (its own could-not-ask) stays null', async () => {
    const run = guardedRun('webhook_registered', async () => null)
    await expect(run('all')).resolves.toBeNull()
  })
})

describe('fileBlocker rejects a CONFIRMED title with no credential evidence (#4702)', () => {
  it('throws when the title claims CONFIRMED but evidence is empty', async () => {
    await expect(
      fileBlocker({
        dedupeKey: 'test-confirmed-no-evidence',
        title: 'CONFIRMED: zero Shopify webhooks registered in production',
        // no evidence -> must be rejected before any DB write
      }),
    ).rejects.toThrow(/CONFIRMED-titled blocker requires .*evidence/i)
  })

  it('throws when evidence is only whitespace', async () => {
    await expect(
      fileBlocker({
        dedupeKey: 'test-confirmed-blank-evidence',
        title: 'confirmed no rows exist',
        evidence: '   ',
      }),
    ).rejects.toThrow(/requires .*evidence/i)
  })
})
