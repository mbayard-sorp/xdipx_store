// Tests for the resumable catalog walk in recomputeCatalog.
//
// The failure these cover: the 07:00 pass used to drain the whole catalog into
// memory, price it from the head, and get SIGKILLed at the 300s ceiling with no
// trace — no response, no thrown error, no checkpoint. Because every run
// restarted at the same head, the tail starved: 2,349 SKUs went seventeen days
// without a reprice while the digest printed GOOD on any nonzero row count.
//
// So the properties worth pinning are: it checkpoints, it resumes from the
// checkpoint rather than the head, it never checkpoints mid-page, and a
// finished day does not start a second walk.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const settingsStore = new Map<string, string>()
const auditRows: Array<Record<string, unknown>> = []
/** Set to simulate the CHECK constraint rejecting a trigger value. */
let auditInsertFails = false

vi.mock('./db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (pred: { key?: string }) => ({
          limit: async () => {
            const key = pred?.key ?? '__unknown__'
            const value = settingsStore.get(key)
            return value === undefined ? [] : [{ value }]
          },
        }),
      }),
    }),
    insert: (table: { __name?: string }) => ({
      values: (row: Record<string, unknown>) => {
        if (table?.__name === 'pipeline_settings') {
          return {
            onConflictDoUpdate: async () => {
              settingsStore.set(String(row['key']), String(row['value']))
            },
          }
        }
        if (auditInsertFails) {
          throw new Error(
            'new row for relation "pricing_audit_log" violates check constraint '
            + '"pricing_audit_log_trigger_check"',
          )
        }
        auditRows.push(row)
        return { returning: async () => [{ id: auditRows.length }] }
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}))

vi.mock('../../db/schema', () => ({
  pricingAuditLog:  { __name: 'pricing_audit_log', id: 'id' },
  pipelineSettings: { __name: 'pipeline_settings', key: 'key', value: 'value' },
}))

// `where(eq(col, val))` has to survive into the mocked select, so eq returns the
// predicate shape the mock reads rather than a real SQL fragment.
vi.mock('drizzle-orm', () => ({
  eq: (_col: unknown, val: unknown) => ({ key: val }),
  sql: Object.assign(() => 'sql', { raw: () => 'sql' }),
  and: () => 'and',
  lt: () => 'lt',
  inArray: () => 'inArray',
}))

vi.mock('./pricing-rules.server', () => ({
  resolvePricingConfig: async () => ({
    velocity_modifier_enabled: false,
    map_behavior: 'ignore_map',
    margin_floor: 0.1,
    groupId: null,
    subGroupId: null,
  }),
  getGroupForProductType: async () => null,
  buildRationale: () => 'rationale',
}))
vi.mock('./pricing-velocity.server', () => ({ computeVelocityBucket: async () => 'steady' }))
vi.mock('./pricing-engine-v2.server', () => ({
  computePrice: () => ({ sell: 10, compareAt: null, marginBefore: 0.5, marginAfter: 0.5 }),
  computeDiscontinuedPrice: () => ({ sell: 10, compareAt: null, marginBefore: 0.5, marginAfter: 0.5 }),
  applyVelocityModifier: (c: unknown) => c,
  enforceMapFloor: (sell: number) => sell,
}))

// One page per call, so the walk's page boundaries are observable.
const pages: Array<{ products: unknown[]; endCursor: string | null; hasNextPage: boolean }> = []
const fetchCalls: Array<string | null | undefined> = []

vi.mock('./shopify.server', () => ({
  updateVariantPricing: async () => undefined,
  normalizeMetafieldKey: (k: string) => k,
  fetchPricingProductsPage: async (opts?: { cursor?: string | null }) => {
    fetchCalls.push(opts?.cursor)
    return pages.shift() ?? { products: [], endCursor: null, hasNextPage: false }
  },
}))

import { recomputeCatalog, readPricingBatchCursor, utcDay, PRICING_BATCH_CURSOR_KEY }
  from './pricing-apply-v2.server'

/**
 * A clock that advances 100ms per read, so "the budget runs out after the first
 * page" is a fact about the test rather than a race against the real clock.
 */
function tickingClock(stepMs = 100): () => number {
  let t = 0
  return () => (t += stepMs)
}

function product(id: string, variantCount = 1) {
  return {
    productId: id,
    productGid: `gid://shopify/Product/${id}`,
    handle: id,
    title: id,
    vendor: 'Acme',
    productType: 'Vibrator',
    metafields: { wholesaleCost: 4, mapPrice: null, originalPrice: 20 },
    variants: Array.from({ length: variantCount }, (_, i) => ({
      variantId: `gid://shopify/ProductVariant/${id}-${i}`,
      sku: `SKU-${id}-${i}`,
      price: 12,
      compareAtPrice: null,
      unitCost: 4,
    })),
  }
}

beforeEach(() => {
  settingsStore.clear()
  auditRows.length = 0
  pages.length = 0
  fetchCalls.length = 0
  auditInsertFails = false
})

/**
 * The audit write is wrapped in a try/catch that logs and carries on, which is
 * the right call on a money path -- a shopper-visible price should not be held
 * hostage to its bookkeeping row -- but for months it meant nobody could tell
 * the write was failing at all. `pricing_audit_log_trigger_check` allowed only
 * webhook|batch|manual|clearance_ladder while the code passed 'batch_catchup'
 * and 'batch_continuation', so on 2026-09-03 the continuation passes applied
 * 1,426 price changes and recorded none, and every watcher read green.
 */
describe('swallowed audit writes', () => {
  it('counts them, and still finishes the walk', async () => {
    auditInsertFails = true
    pages.push({ products: [product('a', 3)], endCursor: null, hasNextPage: false })

    const result = await recomputeCatalog({ trigger: 'batch_continuation' })

    expect(result.done).toBe(true)
    expect(result.total).toBe(3)
    expect(result.auditWriteFailures).toBe(3)
    expect(auditRows).toHaveLength(0)
  })

  it('reports zero when the writes land, so the counter means something', async () => {
    pages.push({ products: [product('a', 3)], endCursor: null, hasNextPage: false })

    const result = await recomputeCatalog({ trigger: 'batch_continuation' })

    expect(result.auditWriteFailures).toBe(0)
    expect(auditRows).toHaveLength(3)
  })
})

describe('recomputeCatalog resumable walk', () => {
  it('walks to the end and records done with no cursor', async () => {
    pages.push(
      { products: [product('a')], endCursor: 'c1', hasNextPage: true },
      { products: [product('b')], endCursor: null, hasNextPage: false },
    )

    const result = await recomputeCatalog({ trigger: 'batch' })

    expect(result.done).toBe(true)
    expect(result.total).toBe(2)
    expect(result.pages).toBe(2)
    expect(fetchCalls).toEqual([null, 'c1'])

    const state = await readPricingBatchCursor(utcDay())
    expect(state?.done).toBe(true)
    expect(state?.cursor).toBeNull()
  })

  it('stops at the budget, checkpoints the cursor, and reports not done', async () => {
    pages.push(
      { products: [product('a')], endCursor: 'c1', hasNextPage: true },
      { products: [product('b')], endCursor: 'c2', hasNextPage: true },
    )

    const result = await recomputeCatalog({ trigger: 'batch', budgetMs: 150, now: tickingClock() })

    expect(result.done).toBe(false)
    expect(result.pages).toBe(1)
    expect(result.total).toBe(1)

    const state = await readPricingBatchCursor(utcDay())
    expect(state?.done).toBe(false)
    expect(state?.cursor).toBe('c1')
    expect(state?.dayTotal).toBe(1)
  })

  it('resumes from the checkpoint instead of the catalog head', async () => {
    settingsStore.set(
      PRICING_BATCH_CURSOR_KEY,
      JSON.stringify({ day: utcDay(), cursor: 'c7', done: false, dayTotal: 40 }),
    )
    pages.push({ products: [product('z')], endCursor: null, hasNextPage: false })

    const result = await recomputeCatalog({ trigger: 'batch_continuation', resume: true })

    expect(fetchCalls[0]).toBe('c7')
    expect(result.done).toBe(true)
    // The day's coverage accumulates across slices; this invocation priced one.
    expect(result.dayTotal).toBe(41)
    expect(result.total).toBe(1)
  })

  it('ignores a checkpoint from a previous day and starts at the head', async () => {
    settingsStore.set(
      PRICING_BATCH_CURSOR_KEY,
      JSON.stringify({ day: '2020-01-01', cursor: 'stale', done: false, dayTotal: 999 }),
    )
    pages.push({ products: [product('a')], endCursor: null, hasNextPage: false })

    const result = await recomputeCatalog({ trigger: 'batch', resume: true })

    expect(fetchCalls[0]).toBeNull()
    expect(result.dayTotal).toBe(1)
  })

  it('does not start a second walk once the day is already done', async () => {
    settingsStore.set(
      PRICING_BATCH_CURSOR_KEY,
      JSON.stringify({ day: utcDay(), cursor: null, done: true, dayTotal: 6786 }),
    )

    const result = await recomputeCatalog({ trigger: 'batch_continuation', resume: true })

    expect(fetchCalls).toEqual([])
    expect(result.done).toBe(true)
    expect(result.total).toBe(0)
    expect(result.dayTotal).toBe(6786)
  })

  it('never checkpoints mid-page: every variant on a page is priced before the cursor moves', async () => {
    // A five-variant page with a spent budget still completes the whole page,
    // because a half-page checkpoint would skip the variants it never reached.
    pages.push({ products: [product('a', 5)], endCursor: 'c1', hasNextPage: true })

    const result = await recomputeCatalog({ trigger: 'batch', budgetMs: 150, now: tickingClock() })

    expect(result.total).toBe(5)
    const state = await readPricingBatchCursor(utcDay())
    expect(state?.cursor).toBe('c1')
  })

  it('starts fresh when the stored cursor is unreadable rather than stopping', async () => {
    settingsStore.set(PRICING_BATCH_CURSOR_KEY, 'not json')
    pages.push({ products: [product('a')], endCursor: null, hasNextPage: false })

    const result = await recomputeCatalog({ trigger: 'batch', resume: true })

    expect(fetchCalls[0]).toBeNull()
    expect(result.done).toBe(true)
  })
})
