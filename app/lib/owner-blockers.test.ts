/**
 * Pure-function tests for the owner blocker list. The DB-touching paths
 * (fileBlocker, verifyBlockers) are exercised against Neon in the seed script;
 * what is worth locking down here is the identifier guard that stands between
 * agent-supplied probe args and SQL, and the email rendering, since the whole
 * feature is judged by whether that email is readable.
 */

import { describe, it, expect } from 'vitest'
import {
  BLOCKER_CATEGORIES,
  PROBE_DESCRIPTIONS,
  blockerEmailSubject,
  describeProbe,
  isIdent,
  isProbe,
  renderBlockerEmail,
  type OwnerBlocker,
} from '~/lib/owner-blockers-core'

function blocker(over: Partial<OwnerBlocker> = {}): OwnerBlocker {
  return {
    id: 1,
    dedupeKey: 'console:test',
    title: 'Do the thing',
    detail: null,
    unblocks: null,
    whereToGo: null,
    category: 'console',
    priority: 3,
    status: 'open',
    source: 'blocker-scout',
    sourceRef: null,
    evidence: null,
    verifyProbe: null,
    verifyArg: null,
    lastVerifiedAt: null,
    lastVerifyOk: null,
    firstSeenAt: '2026-08-01T00:00:00.000Z',
    lastSeenAt: '2026-08-01T00:00:00.000Z',
    ageDays: 0,
    ...over,
  }
}

describe('isIdent', () => {
  it('accepts plain lowercase SQL identifiers', () => {
    expect(isIdent('owner_blockers')).toBe(true)
    expect(isIdent('t1')).toBe(true)
    expect(isIdent('_private')).toBe(true)
  })

  it('rejects anything that could break out of an identifier position', () => {
    for (const bad of [
      'owner_blockers; DROP TABLE users',
      'owner blockers',
      'owner-blockers',
      '"owner_blockers"',
      'Owner_Blockers',   // uppercase would need quoting to resolve
      '1table',
      '',
      'a'.repeat(64),     // past the pg identifier limit
      'tbl--comment',
      "tbl'",
    ]) {
      expect(isIdent(bad), bad).toBe(false)
    }
  })
})

describe('isProbe', () => {
  it('recognises every registered probe and nothing else', () => {
    for (const name of Object.keys(PROBE_DESCRIPTIONS)) expect(isProbe(name)).toBe(true)
    expect(isProbe('drop_everything')).toBe(false)
    expect(isProbe(null)).toBe(false)
    expect(isProbe(42)).toBe(false)
    // Prototype keys must not read as registered probes.
    expect(isProbe('toString')).toBe(false)
    expect(isProbe('constructor')).toBe(false)
  })
})

describe('describeProbe', () => {
  it('phrases what would clear a row', () => {
    expect(describeProbe('setting_true', 'trend_scout_enabled'))
      .toBe('pipeline_settings.trend_scout_enabled is true')
    expect(describeProbe('table_exists', 'owner_blockers')).toBe('table owner_blockers exists')
    expect(describeProbe('routine_ran', 'content|daily|7'))
      .toBe('content/daily ran in the last 7 days')
  })

  it('returns null when there is no usable probe', () => {
    expect(describeProbe(null, null)).toBeNull()
    expect(describeProbe('nonsense', 'x')).toBeNull()
  })
})

describe('renderBlockerEmail', () => {
  it('says so plainly when nothing is waiting', () => {
    const html = renderBlockerEmail([], [], 'https://xdipx.com')
    expect(html).toContain('Nothing is waiting on you today')
    expect(html).not.toContain('<ol')
  })

  it('numbers the list and carries where-to-go and unblocks', () => {
    const html = renderBlockerEmail([
      blocker({
        title: 'Enable billing on GCP project xdipx-store-image-gen',
        whereToGo: 'GCP console',
        unblocks: 'Imagen fallback for hero images',
        ageDays: 3,
      }),
    ], [], 'https://xdipx.com')
    expect(html).toContain('<ol')
    expect(html).toContain('Enable billing on GCP project xdipx-store-image-gen')
    expect(html).toContain('GCP console')
    expect(html).toContain('Imagen fallback for hero images')
    expect(html).toContain('open 3 days')
  })

  it('says which rows have no auto-check, so an unclosable row is visible as such', () => {
    const withProbe = renderBlockerEmail(
      [blocker({ verifyProbe: 'setting_true', verifyArg: 'seo_curation_enabled' })],
      [], 'https://xdipx.com',
    )
    expect(withProbe).toContain('clears itself when')
    expect(withProbe).not.toContain('no auto-check')

    const without = renderBlockerEmail([blocker()], [], 'https://xdipx.com')
    expect(without).toContain('no auto-check')
  })

  it('escapes owner-visible text rather than trusting it', () => {
    // Titles can originate in a mined transcript, which is third-party text.
    const html = renderBlockerEmail(
      [blocker({ title: '<script>alert(1)</script>', detail: 'a & b' })],
      [], 'https://xdipx.com',
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('a &amp; b')
  })

  it('lists what cleared recently, so progress is visible', () => {
    const html = renderBlockerEmail([], [blocker({ title: 'Applied migration 078' })], 'https://xdipx.com')
    expect(html).toContain('Cleared in the last 7 days')
    expect(html).toContain('Applied migration 078')
  })
})

describe('blockerEmailSubject', () => {
  it('reports the count', () => {
    expect(blockerEmailSubject([])).toBe('xdipx: nothing waiting on you')
    expect(blockerEmailSubject([blocker()])).toBe('xdipx: 1 thing needs you')
    expect(blockerEmailSubject([blocker(), blocker({ id: 2 })])).toBe('xdipx: 2 things need you')
  })

  it('surfaces the oldest age once something has been sitting', () => {
    const s = blockerEmailSubject([blocker({ ageDays: 1 }), blocker({ id: 2, ageDays: 11 })])
    expect(s).toBe('xdipx: 2 things need you, oldest 11 days')
  })

  it('stays quiet about age while everything is fresh', () => {
    expect(blockerEmailSubject([blocker({ ageDays: 2 })])).toBe('xdipx: 1 thing needs you')
  })
})

describe('BLOCKER_CATEGORIES', () => {
  it('includes the kinds of work an agent structurally cannot do', () => {
    for (const c of ['migration', 'valve', 'console', 'credential', 'approval', 'merge']) {
      expect(BLOCKER_CATEGORIES as readonly string[]).toContain(c)
    }
  })
})
