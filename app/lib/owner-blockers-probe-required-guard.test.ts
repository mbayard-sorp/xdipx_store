/**
 * Ticket #8028 (self-healing-automation tracker milestone a4-probes):
 * POST /api/team/blocker only warned when a filed row had no probe in a
 * category that needed one; nothing required one. Measured 2026-09-07: 9
 * open owner_blockers rows sat status='open', verify_probe IS NULL, category
 * <> 'decision' with nothing enforcing a fix.
 *
 * This locks down fileBlocker's reject-or-override gate: a probe-required
 * category (PROBE_REQUIRED_CATEGORIES) with neither a real nor a derivable
 * probe throws before any DB access, same discipline as the CONFIRMED-title
 * guard next door (owner-blockers-confirmed-guard.test.ts) -- so the reject
 * path here is hermetic too. The accept path (an override reason, or a
 * category with a probe) reaches the DB, mocked the same way the
 * neighbouring upsert-refresh and dedupe-canonicalize suites do.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/db.server', () => ({ db: { execute: executeMock } }))

import { fileBlocker } from '~/lib/owner-blockers.server'

beforeEach(() => {
  executeMock.mockReset()
  executeMock
    .mockResolvedValueOnce({ rows: [] })                     // no prior row
    .mockResolvedValueOnce({ rows: [{ id: 1, created: true }] })
    .mockResolvedValue({ rows: [] })                          // near-duplicate sweep
})

describe('fileBlocker rejects a probe-required category with no probe and no override (#8028)', () => {
  it('throws for the default category (other) with neither a probe nor an override', async () => {
    await expect(
      fileBlocker({ dedupeKey: 'test-other-no-probe', title: 'something needs doing' }),
    ).rejects.toThrow(/should carry a verifyProbe/i)
    expect(executeMock).not.toHaveBeenCalled()
  })

  for (const category of ['migration', 'valve', 'credential', 'merge', 'execute', 'other']) {
    it(`throws for category '${category}' with neither a probe nor an override`, async () => {
      await expect(
        fileBlocker({ dedupeKey: `test-${category}-no-probe`, title: 'x', category }),
      ).rejects.toThrow(/should carry a verifyProbe/i)
    })
  }

  it('does not throw for the console carve-out', async () => {
    await expect(
      fileBlocker({ dedupeKey: 'test-console', title: 'x', category: 'console' }),
    ).resolves.toBeDefined()
  })

  it('does not throw for the decision carve-out', async () => {
    await expect(
      fileBlocker({ dedupeKey: 'test-decision', title: 'x', category: 'decision' }),
    ).resolves.toBeDefined()
  })
})

describe('fileBlocker accepts an explicit override in place of a probe (#8028)', () => {
  it('files the row when overrideNoProbeReason is given', async () => {
    await expect(
      fileBlocker({
        dedupeKey: 'test-override', title: 'x', category: 'other',
        overrideNoProbeReason: 'no automated check exists for this yet',
      }),
    ).resolves.toBeDefined()
  })

  it('rejects a blank/whitespace-only override the same as none at all', async () => {
    await expect(
      fileBlocker({
        dedupeKey: 'test-blank-override', title: 'x', category: 'other',
        overrideNoProbeReason: '   ',
      }),
    ).rejects.toThrow(/should carry a verifyProbe/i)
  })
})

describe('fileBlocker accepts a real or derived probe without needing an override (#8028)', () => {
  it('files the row when verifyProbe is given directly', async () => {
    await expect(
      fileBlocker({
        dedupeKey: 'test-with-probe', title: 'x', category: 'valve',
        verifyProbe: 'setting_true', verifyArg: 'some_flag',
      }),
    ).resolves.toBeDefined()
  })

  it('files the row when a probe is derivable (merge category + PR sourceRef)', async () => {
    await expect(
      fileBlocker({
        dedupeKey: 'test-derived', title: 'x', category: 'merge',
        sourceRef: 'https://github.com/x/y/pull/42',
      }),
    ).resolves.toBeDefined()
  })
})
