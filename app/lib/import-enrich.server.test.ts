import { describe, it, expect } from 'vitest'
import {
  decideEnrichFailure,
  isBatchClaimStuck,
  classifySubmitBlocker,
  explainQualityGateFailure,
  isSubagentLease,
  isNoStockAtPublish,
  SUBAGENT_LEASE_PREFIX,
  ENRICH_MAX_ATTEMPTS,
  STUCK_BATCH_MAX_HOURS,
  type EnrichFunnelSnapshot,
} from './import-enrich.server'
import type { ProductWrites } from './emma-orchestrator.server'

// These pure helpers back the stuck-batch recovery guard in
// collectEnrichmentBatch: a single un-retrievable or never-ending Anthropic
// batch must never freeze the whole enrich->publish tick. They are extracted so
// the retry-vs-park and age-out decisions are verified without a database.

describe('decideEnrichFailure', () => {
  it('re-queues (retry) on the first failure, below the cap', () => {
    // currentAttempts 0 -> enrichAttempts 1, and 1 < ENRICH_MAX_ATTEMPTS (2)
    expect(decideEnrichFailure(0)).toEqual({ action: 'retry', enrichAttempts: 1 })
  })

  it('parks once the attempt reaches the cap', () => {
    // currentAttempts 1 -> enrichAttempts 2, not below the cap
    expect(decideEnrichFailure(1)).toEqual({ action: 'park', enrichAttempts: 2 })
  })

  it('parks for any attempt at or beyond the cap', () => {
    expect(decideEnrichFailure(2).action).toBe('park')
    expect(decideEnrichFailure(5).action).toBe('park')
  })

  it('matches the retry/park boundary implied by ENRICH_MAX_ATTEMPTS', () => {
    // The last retry is the attempt that lands exactly at the cap.
    const lastRetry = decideEnrichFailure(ENRICH_MAX_ATTEMPTS - 2)
    const firstPark = decideEnrichFailure(ENRICH_MAX_ATTEMPTS - 1)
    expect(lastRetry.action).toBe('retry')
    expect(firstPark.action).toBe('park')
    expect(firstPark.enrichAttempts).toBe(ENRICH_MAX_ATTEMPTS)
  })
})

describe('isBatchClaimStuck', () => {
  const now = new Date('2026-08-02T20:00:00.000Z')

  it('is not stuck when the batch was just claimed', () => {
    const claimedAt = new Date(now.getTime() - 60 * 60 * 1000) // 1h ago
    expect(isBatchClaimStuck(claimedAt, now)).toBe(false)
  })

  it('is not stuck just inside the SLA window', () => {
    const claimedAt = new Date(now.getTime() - (STUCK_BATCH_MAX_HOURS - 1) * 3_600_000)
    expect(isBatchClaimStuck(claimedAt, now)).toBe(false)
  })

  it('is stuck once past STUCK_BATCH_MAX_HOURS', () => {
    const claimedAt = new Date(now.getTime() - (STUCK_BATCH_MAX_HOURS + 1) * 3_600_000)
    expect(isBatchClaimStuck(claimedAt, now)).toBe(true)
  })

  it('treats the exact threshold as stuck', () => {
    const claimedAt = new Date(now.getTime() - STUCK_BATCH_MAX_HOURS * 3_600_000)
    expect(isBatchClaimStuck(claimedAt, now)).toBe(true)
  })

  it('never treats a missing anchor as stuck', () => {
    expect(isBatchClaimStuck(null, now)).toBe(false)
    expect(isBatchClaimStuck(undefined, now)).toBe(false)
  })

  it('honours a caller-supplied maxHours override', () => {
    const claimedAt = new Date(now.getTime() - 3 * 3_600_000) // 3h ago
    expect(isBatchClaimStuck(claimedAt, now, 2)).toBe(true)
    expect(isBatchClaimStuck(claimedAt, now, 4)).toBe(false)
  })
})

// Backs the no-submit diagnostic in runImportEnrichTick. detectImportEnrichStall
// only ever counts importedUnenriched rows, so a funnel empty at that stage but
// jammed elsewhere (parked out, upstream backlog, ungatherable briefs) raised no
// alert -- the exact silence behind "produced nothing for 75 days". This picks
// the binding blocker and marks which states deserve a loud owner alert.
describe('classifySubmitBlocker', () => {
  const empty: EnrichFunnelSnapshot = {
    pending: 0, importedUnenriched: 0, inFlight: 0, parked: 0, enriched: 0,
  }

  it('is idle (no alert) when the whole funnel is empty', () => {
    const b = classifySubmitBlocker(empty, 'no_unenriched')
    expect(b.kind).toBe('idle')
    expect(b.alertable).toBe(false)
  })

  it('is a healthy batch_in_flight (no alert) when a batch is still collecting', () => {
    const b = classifySubmitBlocker({ ...empty, inFlight: 5 }, 'batch_in_flight')
    expect(b.kind).toBe('batch_in_flight')
    expect(b.alertable).toBe(false)
  })

  it('treats inFlight rows as batch_in_flight even if the reason is stale', () => {
    // Defensive: an inFlight snapshot must never be misread as idle.
    const b = classifySubmitBlocker({ ...empty, inFlight: 2 }, 'no_unenriched')
    expect(b.kind).toBe('batch_in_flight')
    expect(b.alertable).toBe(false)
  })

  it('alerts on an upstream backlog when candidates are stuck at pending', () => {
    const b = classifySubmitBlocker({ ...empty, pending: 12 }, 'no_unenriched')
    expect(b.kind).toBe('upstream_backlog')
    expect(b.alertable).toBe(true)
    expect(b.detail).toContain('12')
  })

  it('alerts when the only remaining candidates are parked', () => {
    const b = classifySubmitBlocker({ ...empty, parked: 7 }, 'no_unenriched')
    expect(b.kind).toBe('all_parked')
    expect(b.alertable).toBe(true)
    expect(b.detail).toContain('7')
  })

  it('alerts on no_briefs when imported drafts cannot produce a brief', () => {
    const b = classifySubmitBlocker({ ...empty, importedUnenriched: 4 }, 'no_briefs')
    expect(b.kind).toBe('no_briefs')
    expect(b.alertable).toBe(true)
    expect(b.detail).toContain('4')
  })

  it('prioritises an in-flight batch over an upstream backlog', () => {
    // A batch mid-collection is healthy backpressure; do not cry backlog while
    // one is draining.
    const b = classifySubmitBlocker({ ...empty, inFlight: 1, pending: 9 }, 'batch_in_flight')
    expect(b.kind).toBe('batch_in_flight')
    expect(b.alertable).toBe(false)
  })

  it('prioritises a live upstream backlog over parked leftovers', () => {
    const b = classifySubmitBlocker({ ...empty, pending: 3, parked: 5 }, 'no_unenriched')
    expect(b.kind).toBe('upstream_backlog')
  })

  it('is a quiet subagent_transport when the Max routine owns generation', () => {
    // Under import_enrich_transport='subagent' the tick never submits — that
    // is the design working, not a jam, even with rows awaiting claim.
    const b = classifySubmitBlocker({ ...empty, importedUnenriched: 9, parked: 2 }, 'subagent_transport')
    expect(b.kind).toBe('subagent_transport')
    expect(b.alertable).toBe(false)
    expect(b.detail).toContain('9')
  })
})

// ─── Subagent (Max) transport helpers ───────────────────────────────────────

describe('isSubagentLease', () => {
  it('recognises subagent lease ids and rejects Anthropic batch ids', () => {
    expect(isSubagentLease(`${SUBAGENT_LEASE_PREFIX}run-2026-08-22`)).toBe(true)
    expect(isSubagentLease('msgbatch_01AbCdEf')).toBe(false)
    expect(isSubagentLease(null)).toBe(false)
    expect(isSubagentLease(undefined)).toBe(false)
    expect(isSubagentLease('')).toBe(false)
  })
})

// The subagent transport must apply the exact same acceptance rules as the
// batch collect path; explainQualityGateFailure is that shared predicate with
// a named reason for the generating routine.
describe('explainQualityGateFailure', () => {
  const good: ProductWrites = {
    productTypeDial:    'vibrator',
    tagline:            'A quiet little rumble for slow evenings',
    seoMetaDescription: 'x'.repeat(120),
    descriptionHtml:    '<p>Emma’s take on this quiet, travel-ready bullet vibrator.</p>',
    moodTags:           ['Playful'],
    audienceTags:       ['Me'],
    mattersTags:        ['Quiet'],
    sensationDialV2: {
      items: [
        { label: 'Intensity',         value: 5 },
        { label: 'Quietness',         value: 3 },
        { label: 'Body',              value: 4 },
        { label: 'Battery',           value: 3 },
        { label: 'Beginner-friendly', value: 2 },
      ],
    },
  }

  it('passes a complete payload', () => {
    expect(explainQualityGateFailure(good)).toBeNull()
  })

  it('names the missing description', () => {
    expect(explainQualityGateFailure({ ...good, descriptionHtml: '  ' })).toContain('descriptionHtml')
  })

  it('names a short seoMetaDescription', () => {
    expect(explainQualityGateFailure({ ...good, seoMetaDescription: 'too short' })).toContain('seoMetaDescription')
  })

  it('names an unknown productTypeDial', () => {
    expect(explainQualityGateFailure({ ...good, productTypeDial: 'gizmo' as ProductWrites['productTypeDial'] })).toContain('productTypeDial')
  })

  it('names empty discovery tags — the invisibility failure mode', () => {
    expect(explainQualityGateFailure({ ...good, moodTags: [] })).toContain('moodTags')
    expect(explainQualityGateFailure({ ...good, audienceTags: [] })).toContain('audienceTags')
    expect(explainQualityGateFailure({ ...good, mattersTags: [] })).toContain('mattersTags')
  })

  it('rejects a clustered sensation dial with the spread diagnostics', () => {
    const clustered: ProductWrites = {
      ...good,
      sensationDialV2: {
        items: [
          { label: 'Intensity', value: 5 },
          { label: 'Quietness', value: 5 },
          { label: 'Body',      value: 4 },
          { label: 'Battery',   value: 4 },
          { label: 'Beginner',  value: 5 },
        ],
      },
    }
    const reason = explainQualityGateFailure(clustered)
    expect(reason).toContain('sensation dial spread')
  })

  it('rejects a missing dial (fewer than 5 values)', () => {
    const reason = explainQualityGateFailure({ ...good, sensationDialV2: { items: [] } })
    expect(reason).toContain('sensation dial spread')
  })
})

// Ticket #18007: 111 of 408 publishes since 2026-10-05 went live unbuyable
// because publishEnrichedProducts activated a candidate on a stale
// import-time quantity while the batch's own fresh feed read already showed
// zero stock everywhere. isNoStockAtPublish is the gate extracted so the
// held-vs-normal decision is verified without a database or live Shopify call.
describe('isNoStockAtPublish (#18007)', () => {
  it('holds a candidate whose fresh feed read shows zero stock on both sources', () => {
    const freshQtyBySku = new Map([['sku-1', { nalpacQty: 0, entrenueQty: 0 }]])
    expect(isNoStockAtPublish('sku-1', freshQtyBySku)).toBe(true)
  })

  it('does not hold a candidate with stock on either source', () => {
    const freshQtyBySku = new Map([
      ['sku-nalpac', { nalpacQty: 5, entrenueQty: 0 }],
      ['sku-entrenue', { nalpacQty: 0, entrenueQty: 3 }],
    ])
    expect(isNoStockAtPublish('sku-nalpac', freshQtyBySku)).toBe(false)
    expect(isNoStockAtPublish('sku-entrenue', freshQtyBySku)).toBe(false)
  })

  it('treats a null quantity from either source as zero, not as "unknown"', () => {
    const freshQtyBySku = new Map([['sku-null', { nalpacQty: null, entrenueQty: null }]])
    expect(isNoStockAtPublish('sku-null', freshQtyBySku)).toBe(true)
  })

  it('never holds a SKU absent from the map (feed fetch failed, or SKU unknown to the feed) — existing best-effort behavior', () => {
    const freshQtyBySku = new Map([['sku-1', { nalpacQty: 0, entrenueQty: 0 }]])
    expect(isNoStockAtPublish('sku-not-in-feed', freshQtyBySku)).toBe(false)
  })

  it('never holds anything when the feed fetch failed entirely (empty map)', () => {
    expect(isNoStockAtPublish('sku-1', new Map())).toBe(false)
  })
})
