import { describe, expect, it } from 'vitest'
import {
  canonicalDedupeKey,
  dedupeTokens,
  findNearDuplicate,
  hadDateStamp,
  MAX_DEDUPE_KEY_LENGTH,
  similarity,
} from './dedupe-key'

/**
 * The four keys that motivated this module, all filed on 2026-08-24 for one
 * defect: /api/team/conversion-status 500ing because migration 082 was never
 * applied to prod.
 */
const TICKET_5099 = 'conversion-status-500-regression'
const TICKET_5146 = 'qa:conversion-status-500-2026-08-24'
const BLOCKER_20 = 'migration-082-outbox-rename-unapplied'
const BLOCKER_21 = 'apply-migration-082-capi-outbox-rename'

describe('canonicalDedupeKey', () => {
  it('lowercases, slugs, and collapses separator runs', () => {
    expect(canonicalDedupeKey('QA:Conversion Status__500')).toBe('qa-conversion-status-500')
    expect(canonicalDedupeKey('  spaced   out  ')).toBe('spaced-out')
  })

  it('is idempotent, because it runs on both write and lookup', () => {
    for (const raw of [TICKET_5099, TICKET_5146, BLOCKER_20, BLOCKER_21]) {
      const once = canonicalDedupeKey(raw)
      expect(canonicalDedupeKey(once)).toBe(once)
    }
  })

  it('strips date stamps from recurring keys, so a daily check reuses one row', () => {
    // The actual bug: today's key and tomorrow's key must be the same row.
    expect(canonicalDedupeKey('qa:conversion-status-500-2026-08-24'))
      .toBe(canonicalDedupeKey('qa:conversion-status-500-2026-08-25'))
    expect(canonicalDedupeKey(TICKET_5146)).toBe('qa-conversion-status-500')
  })

  it('accepts every date shape a filer is likely to reach for', () => {
    for (const dated of [
      'render-fail-2026-08-24',
      'render-fail-2026/08/24',
      'render-fail-20260824',
      'render-fail-2026-08',
    ]) {
      expect(canonicalDedupeKey(dated)).toBe('render-fail')
    }
  })

  it('keeps the date when the caller declares a per-occurrence scope', () => {
    // import-enrich.server.ts files one campaign per day of new products.
    // Collapsing those into a single row would lose every day but the first.
    const mon = canonicalDedupeKey('new-products:enrich:2026-08-24', { scope: 'daily' })
    const tue = canonicalDedupeKey('new-products:enrich:2026-08-25', { scope: 'daily' })
    expect(mon).toBe('new-products-enrich-2026-08-24')
    expect(mon).not.toBe(tue)
  })

  it('does not mistake ids or ticket numbers for dates', () => {
    expect(canonicalDedupeKey('autofile:pr-894')).toBe('autofile-pr-894')
    expect(canonicalDedupeKey('product-98765432')).toBe('product-98765432')
    expect(canonicalDedupeKey('migration-082')).toBe('migration-082')
    // 2026 alone is a plausible id, and is left alone.
    expect(canonicalDedupeKey('sku-2026')).toBe('sku-2026')
    // 20261324 has no thirteenth month.
    expect(canonicalDedupeKey('batch-20261324')).toBe('batch-20261324')
  })

  it('caps at the column width with a hash of the full key', () => {
    const long = `render-failure-${'segment-'.repeat(20)}tail`
    const key = canonicalDedupeKey(long)
    expect(key.length).toBeLessThanOrEqual(MAX_DEDUPE_KEY_LENGTH)
    // Two long keys sharing a prefix still dedupe apart.
    expect(key).not.toBe(canonicalDedupeKey(`${long}-other`))
  })

  it('returns empty for a key with no usable characters', () => {
    expect(canonicalDedupeKey('---')).toBe('')
    expect(canonicalDedupeKey('')).toBe('')
  })
})

describe('hadDateStamp', () => {
  it('reports whether canonicalization dropped a date', () => {
    expect(hadDateStamp(TICKET_5146)).toBe(true)
    expect(hadDateStamp(TICKET_5099)).toBe(false)
  })
})

describe('dedupeTokens', () => {
  it('drops severity, lane, and "something is wrong" noise', () => {
    expect([...dedupeTokens('qa:conversion-status-500-2026-08-24')].sort())
      .toEqual(['500', 'conversion', 'status'])
    expect([...dedupeTokens('conversion-status-500-regression')].sort())
      .toEqual(['500', 'conversion', 'status'])
  })
})

describe('similarity', () => {
  it('scores the two conversion-status tickets as the same signal', () => {
    expect(similarity(TICKET_5099, TICKET_5146)).toBe(1)
  })

  it('scores the two migration-082 blockers above the flagging bar', () => {
    expect(similarity(BLOCKER_20, BLOCKER_21)).toBeGreaterThanOrEqual(0.8)
  })

  it('keeps unrelated signals apart', () => {
    expect(similarity('checkout-probe-timeout', 'sitemap-stale-urls')).toBe(0)
  })
})

describe('findNearDuplicate', () => {
  const live = [
    { id: 5099, dedupeKey: TICKET_5099 },
    { id: 4001, dedupeKey: 'checkout-probe-timeout' },
    { id: 4002, dedupeKey: null },
  ]

  it('finds the twin that exact matching missed', () => {
    const hit = findNearDuplicate(canonicalDedupeKey(TICKET_5146), live)
    expect(hit?.candidate.id).toBe(5099)
    expect(hit?.score).toBe(1)
  })

  it('returns null when nothing is close', () => {
    expect(findNearDuplicate('runpod-endpoint-missing', live)).toBeNull()
  })

  it('ignores the row that already owns the identical key', () => {
    expect(findNearDuplicate(TICKET_5099, live)).toBeNull()
  })

  it('will not flag on a key too thin to be distinctive', () => {
    // Two identity tokens can hit 1.0 off coincidence; below the floor we stay
    // quiet rather than pointing a human at a false twin.
    expect(findNearDuplicate('probe-timeout', live)).toBeNull()
  })

  it('does not confuse the X and Instagram removal watchers', () => {
    // Both watchers file structurally identical keys that differ only by
    // platform. This is the shape most at risk of a false positive, and the
    // distinguishing token has to be enough to keep them apart.
    const watchers = [{ id: 1, dedupeKey: 'ig-removal-watch-token-unhealthy' }]
    const hit = findNearDuplicate('x-removal-watch-token-unhealthy', watchers)
    expect(hit).toBeNull()
  })
})

/**
 * Regression cover for the dead new-product weekly cap.
 *
 * `server/webhooks.ts` filed rows keyed `new-product:<handle>` and then counted
 * this week's rows with `LIKE 'new-product:%'`. Because every key written through
 * `createSuggestion` is canonicalised — colons become dashes — the stored key was
 * `new-product-<handle>` and the count matched nothing, forever. `weeklyCount` was
 * permanently 0, so a cap of three launches a week never fired once: 122 rows in
 * six days, all auto-approved into a lane that could not drain them.
 *
 * The property that matters is not the literal string, it is that the prefix a
 * reader searches for is derived from the same function the writer stores through.
 */
describe('new-product dedupe key: reader and writer agree', () => {
  const stem = canonicalDedupeKey('new-product')

  it('canonicalises the colon form the webhook used to write', () => {
    expect(canonicalDedupeKey('new-product:some-handle')).toBe('new-product-some-handle')
  })

  it('the raw colon prefix matches nothing that is actually stored', () => {
    // This is the bug, pinned: searching the pre-canonical form can never hit.
    expect(canonicalDedupeKey('new-product:some-handle').startsWith('new-product:')).toBe(false)
  })

  it('a key built from the derived stem survives canonicalisation intact', () => {
    const written = canonicalDedupeKey(`${stem}-some-handle`)
    expect(written).toBe(`${stem}-some-handle`)
    expect(written.startsWith(`${stem}-`)).toBe(true)
  })

  it('holds for handles carrying separators the canonicaliser rewrites', () => {
    for (const handle of ['we-vibe_chorus', 'lelo.sona/2', 'njoy pure wand']) {
      const written = canonicalDedupeKey(`${stem}-${handle}`)
      expect(written.startsWith(`${stem}-`)).toBe(true)
    }
  })
})
