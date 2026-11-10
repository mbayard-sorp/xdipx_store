// Probe vocabulary additions and the probe-requirement rules (audit Stage A).
//
// Of 32 blockers ever filed, 25 carried no probe and 15 of those were cleared
// by the owner's own hand — including valve-off rows, where the owner's own
// flip should have closed the row and did not. The vocabulary had ten kinds and
// none could answer the four questions the open list actually asked: is this
// env var set, did this PR merge, is this check green, is this endpoint up.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  PROBE_DESCRIPTIONS,
  PROBE_REQUIRED_CATEGORIES,
  BLOCKER_CATEGORIES,
  suggestProbeFor,
  probeGapReason,
  isProbe,
} from './owner-blockers-core'

describe('probe vocabulary', () => {
  it('describes the four new kinds in a sentence the owner can read', () => {
    expect(PROBE_DESCRIPTIONS['env_present']!('ATLAS_CLOUD_API_KEY'))
      .toBe("ATLAS_CLOUD_API_KEY is set in the app's environment")
    expect(PROBE_DESCRIPTIONS['pr_merged']!('991')).toBe('PR 991 is merged')
    expect(PROBE_DESCRIPTIONS['check_green']!('migration-dry-run'))
      .toBe('the migration-dry-run check is green on main')
    expect(PROBE_DESCRIPTIONS['check_green']!('check|abc123'))
      .toBe('the check check is green on abc123')
    expect(PROBE_DESCRIPTIONS['endpoint_200']!('https://xdipx.com/healthz'))
      .toBe('https://xdipx.com/healthz answers 2xx')
  })

  it('registers them as real probes', () => {
    for (const name of ['env_present', 'pr_merged', 'check_green', 'endpoint_200']) {
      expect(isProbe(name)).toBe(true)
    }
  })

  it('describes the two new #20825 probes in a sentence the owner can read', () => {
    expect(PROBE_DESCRIPTIONS['ad_entity_not_rejected']!('meta|120249750018750056'))
      .toBe('meta entity 120249750018750056 is no longer DISAPPROVED or WITH_ISSUES')
    expect(PROBE_DESCRIPTIONS['video_episodes_not_pending']!('8,9,10,11,12'))
      .toBe("none of video_episodes 8,9,10,11,12 are still production_status='pending_approval'")
    for (const name of ['ad_entity_not_rejected', 'video_episodes_not_pending']) {
      expect(isProbe(name)).toBe(true)
    }
  })
})

describe('decision category', () => {
  it('exists, so a genuinely unprobeable row does not have to hide in `other`', () => {
    // `other` also catches rows that are perfectly checkable and simply were not
    // given a probe, which is why they need to be distinguishable.
    expect(BLOCKER_CATEGORIES).toContain('decision')
    expect(PROBE_REQUIRED_CATEGORIES).not.toContain('decision')
    expect(PROBE_REQUIRED_CATEGORIES).not.toContain('console')
  })
})

describe('suggestProbeFor', () => {
  it('derives pr_merged from a merge row whose sourceRef is a PR url', () => {
    expect(suggestProbeFor({
      category: 'merge',
      sourceRef: 'https://github.com/mbayard-sorp/xdipx_store/pull/991',
    })).toEqual({ verifyProbe: 'pr_merged', verifyArg: '991' })
  })

  it('derives pr_merged from the #N short form too', () => {
    expect(suggestProbeFor({ category: 'merge', sourceRef: 'PR #1017' }))
      .toEqual({ verifyProbe: 'pr_merged', verifyArg: '1017' })
  })

  it('never overrides a probe the filer chose', () => {
    expect(suggestProbeFor({
      category: 'merge',
      sourceRef: 'https://github.com/x/y/pull/5',
      verifyProbe: 'check_green',
    })).toBeNull()
  })

  it('invents nothing where the argument is not in the row', () => {
    // A probe with a guessed argument answers the wrong question, which is worse
    // than no probe: it can clear a row that is still true.
    expect(suggestProbeFor({ category: 'valve', sourceRef: null })).toBeNull()
    expect(suggestProbeFor({ category: 'credential', sourceRef: 'somewhere' })).toBeNull()
    expect(suggestProbeFor({ category: 'migration', sourceRef: '088' })).toBeNull()
    expect(suggestProbeFor({ category: 'merge', sourceRef: 'no number here' })).toBeNull()
  })
})

describe('probeGapReason', () => {
  it('flags a probe-less row in a category that should have had one', () => {
    for (const category of PROBE_REQUIRED_CATEGORIES) {
      expect(probeGapReason({ category, verifyProbe: null })).toContain(category)
    }
  })

  it('is silent once a probe is present', () => {
    expect(probeGapReason({ category: 'valve', verifyProbe: 'setting_true' })).toBeNull()
  })

  it('still flags console/decision/approval once a probe is missing, just without demanding one (#20825)', () => {
    // These never need a PROBE (console completes in a third-party UI,
    // decision has no observable completion state, approval can be a pure
    // notification), but they are not exempt from the gate altogether:
    // fileBlocker still requires an overrideNoProbeReason for them.
    for (const category of ['console', 'decision', 'approval'] as const) {
      const gap = probeGapReason({ category, verifyProbe: null })
      expect(gap).not.toBeNull()
      expect(gap).not.toMatch(/should carry a verifyProbe/i)
    }
  })
})

describe('env_present runner', () => {
  const ORIGINAL = { ...process.env }
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { process.env = { ...ORIGINAL } })

  it('answers the honest question: has the value reached this process', async () => {
    const { PROBES } = await import('./owner-blockers.server')
    process.env['PROBE_TEST_ONE'] = 'x'
    expect(await PROBES['env_present']!.run('PROBE_TEST_ONE')).toBe(true)

    delete process.env['PROBE_TEST_ONE']
    expect(await PROBES['env_present']!.run('PROBE_TEST_ONE')).toBe(false)
  })

  it('treats blank as absent, because a blank credential reaches nothing', async () => {
    const { PROBES } = await import('./owner-blockers.server')
    process.env['PROBE_TEST_BLANK'] = '   '
    expect(await PROBES['env_present']!.run('PROBE_TEST_BLANK')).toBe(false)
  })

  it('requires every name when several are given', async () => {
    const { PROBES } = await import('./owner-blockers.server')
    process.env['PROBE_TEST_A'] = 'a'
    delete process.env['PROBE_TEST_B']
    expect(await PROBES['env_present']!.run('PROBE_TEST_A,PROBE_TEST_B')).toBe(false)

    process.env['PROBE_TEST_B'] = 'b'
    expect(await PROBES['env_present']!.run('PROBE_TEST_A,PROBE_TEST_B')).toBe(true)
  })

  it('cannot answer an empty arg, and says so with null rather than false', async () => {
    const { PROBES } = await import('./owner-blockers.server')
    expect(await PROBES['env_present']!.run('')).toBeNull()
  })
})

describe('endpoint_200 runner', () => {
  it('refuses a non-url with null, not false', async () => {
    const { PROBES } = await import('./owner-blockers.server')
    expect(await PROBES['endpoint_200']!.run('not a url')).toBeNull()
  })

  it('reports an unreachable endpoint as could-not-ask, never as still-blocked', async () => {
    // #4702 generalised: an endpoint unreachable from THIS network is a fact
    // about the network, not proof the endpoint is down. guardedRun maps the
    // throw to null.
    const { PROBES } = await import('./owner-blockers.server')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENOTFOUND'))
    expect(await PROBES['endpoint_200']!.run('https://example.invalid/x')).toBeNull()
    fetchSpy.mockRestore()
  })

  // Ticket #19526: blocker #1672's verifyArg is the relative cron path
  // `/cron/release-engine`, which the plain-URL branch above has always
  // rejected outright (it never matches `^https?://`), and even a corrected
  // absolute URL would 401 forever against an unauthenticated GET since
  // every cron route requires `x-cron-secret`. A `/cron/*` arg now reads
  // cron_runs recency instead — read-only, no fetch, no triggered job.
  describe('a /cron/* arg (ticket #19526)', () => {
    afterEach(() => { vi.doUnmock('~/lib/cron-runs.server'); vi.resetModules() })

    it('answers true when the route is live and not failing', async () => {
      vi.doMock('~/lib/cron-runs.server', () => ({
        readCronLiveness: vi.fn(async () => [
          { route: '/cron/release-engine', breached: false, failing: false },
        ]),
      }))
      const { PROBES } = await import('./owner-blockers.server')
      expect(await PROBES['endpoint_200']!.run('/cron/release-engine')).toBe(true)
    })

    it('answers false when the route is breached (gone silent past its grace window)', async () => {
      vi.doMock('~/lib/cron-runs.server', () => ({
        readCronLiveness: vi.fn(async () => [
          { route: '/cron/release-engine', breached: true, failing: false },
        ]),
      }))
      const { PROBES } = await import('./owner-blockers.server')
      expect(await PROBES['endpoint_200']!.run('/cron/release-engine')).toBe(false)
    })

    it('answers false when the route is alive but failing on consecutive runs', async () => {
      vi.doMock('~/lib/cron-runs.server', () => ({
        readCronLiveness: vi.fn(async () => [
          { route: '/cron/release-engine', breached: false, failing: true },
        ]),
      }))
      const { PROBES } = await import('./owner-blockers.server')
      expect(await PROBES['endpoint_200']!.run('/cron/release-engine')).toBe(false)
    })

    it('answers null (could not ask), never false, for a route with no cron_expectations entry', async () => {
      vi.doMock('~/lib/cron-runs.server', () => ({
        readCronLiveness: vi.fn(async () => []),
      }))
      const { PROBES } = await import('./owner-blockers.server')
      expect(await PROBES['endpoint_200']!.run('/cron/not-a-real-route')).toBeNull()
    })

    it('never makes an HTTP fetch for a /cron/* arg', async () => {
      vi.doMock('~/lib/cron-runs.server', () => ({
        readCronLiveness: vi.fn(async () => [
          { route: '/cron/release-engine', breached: false, failing: false },
        ]),
      }))
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      const { PROBES } = await import('./owner-blockers.server')
      await PROBES['endpoint_200']!.run('/cron/release-engine')
      expect(fetchSpy).not.toHaveBeenCalled()
      fetchSpy.mockRestore()
    })
  })
})

describe('migration_applied probe', () => {
  it('describes itself and is registered as a real probe', () => {
    expect(PROBE_DESCRIPTIONS['migration_applied']!('093_pricing_audit_trigger_values.sql'))
      .toBe('migration 093_pricing_audit_trigger_values.sql is recorded in schema_migrations_applied')
    expect(isProbe('migration_applied')).toBe(true)
  })

  it('cannot answer an empty filename, and says so with null rather than false', async () => {
    const { PROBES } = await import('./owner-blockers.server')
    expect(await PROBES['migration_applied']!.run('')).toBeNull()
  })

  it('clears the moment the ledger records the file it was filed against', async () => {
    const executeMock = vi.fn()
    vi.doMock('~/lib/db.server', () => ({ db: { execute: executeMock } }))
    vi.resetModules()
    const { PROBES } = await import('./owner-blockers.server')

    // 1: table_exists check (schema_migrations_applied is present).
    // 2: SELECT ... WHERE filename = $1 — not yet recorded.
    executeMock
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [] })
    expect(await PROBES['migration_applied']!.run('093_pricing_audit_trigger_values.sql')).toBe(false)

    // Same two-query shape, now the row exists: the file was recorded.
    executeMock
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
    expect(await PROBES['migration_applied']!.run('093_pricing_audit_trigger_values.sql')).toBe(true)

    vi.doUnmock('~/lib/db.server')
    vi.resetModules()
  })
})

describe('instagram_token_healthy probe (ticket #13153)', () => {
  afterEach(() => {
    vi.doUnmock('~/lib/instagram-token.server')
    vi.resetModules()
  })

  it('clears the blocker once the expiry-ahead check no longer warns', async () => {
    vi.doMock('~/lib/instagram-token.server', () => ({
      checkInstagramTokenExpiryWarning: async () => ({ warn: false, reason: null, expiresAt: null, lastSuccessAt: null }),
    }))
    const { PROBES } = await import('./owner-blockers.server')
    expect(await PROBES['instagram_token_healthy']!.run('')).toBe(true)
  })

  it('leaves the blocker open while the expiry-ahead check still warns', async () => {
    vi.doMock('~/lib/instagram-token.server', () => ({
      checkInstagramTokenExpiryWarning: async () => ({ warn: true, reason: 'expires in 3.0 days', expiresAt: null, lastSuccessAt: null }),
    }))
    const { PROBES } = await import('./owner-blockers.server')
    expect(await PROBES['instagram_token_healthy']!.run('')).toBe(false)
  })

  it('describes itself', () => {
    expect(PROBE_DESCRIPTIONS['instagram_token_healthy']!(''))
      .toBe('the Instagram token is not close to expiring and refreshes are succeeding')
  })
})

describe('the vocabulary and the runners cannot drift apart', () => {
  it('gives every runner a description, or it is silently not a probe at all', async () => {
    // Caught in the act, 2026-09-02. `PROBES` is built by filtering
    // PROBE_DESCRIPTIONS down to the names that have a runner:
    //
    //   Object.entries(PROBE_DESCRIPTIONS).filter(([n]) => hasOwn(RUNNERS, n))
    //
    // so a runner added WITHOUT a description is dropped from PROBES entirely
    // and disappears with no error anywhere. `credential_live` shipped that way
    // for one commit: the runner existed, the row would have been filed, and
    // the probe would never have run — a blocker that can never clear itself,
    // which is precisely the failure the probe was added to prevent.
    const { PROBES } = await import('./owner-blockers.server')
    const described = Object.keys(PROBE_DESCRIPTIONS)
    const usable = Object.keys(PROBES)
    for (const name of usable) {
      expect(described, `${name} has a runner but no description`).toContain(name)
    }
    // And the other direction: a described probe with no runner is a name the
    // API will accept and nothing will ever evaluate.
    expect(usable.sort()).toEqual(described.sort())
  })

  it('describes the credential probe', () => {
    expect(PROBE_DESCRIPTIONS['credential_live']!('instagram'))
      .toBe('the instagram credential answers an authenticated read')
  })
})
