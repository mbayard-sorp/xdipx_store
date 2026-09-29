// ticket #12097 (ADR-007 decision 4): the real Nalpac cost-change webhook now
// reprices through recomputeVariant (v2), never v1's decideAndApply. DB and
// every collaborator (Shopify, KV, the v2 pricing engine) are mocked out,
// mirroring cost-sync.server.test.ts's established pattern for the same
// recomputeVariant seam.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NalpacCostChangeEvent } from './pricing-webhook.server'

const kvStore = new Map<string, unknown>()
const kvGet = vi.fn(async (key: string) => (kvStore.has(key) ? kvStore.get(key) : null))
const kvSet = vi.fn(async (key: string, value: unknown, _ttl?: number) => {
  kvStore.set(key, value)
})
vi.mock('./kv.server', () => ({
  kvGet: (key: string) => kvGet(key),
  kvSet: (key: string, value: unknown, ttl?: number) => kvSet(key, value, ttl),
}))

// getPipelineSetting chains select().from().where().limit(1); each test
// queues one resolved value per call via stubSetting below.
const dbSelect = vi.fn()
vi.mock('./db.server', () => ({ db: { select: dbSelect, insert: vi.fn() } }))

vi.mock('../../db/schema', () => ({
  pipelineSettings: { key: 'key', value: 'value' },
  pricingAuditLog: { trigger: 'trigger', occurredAt: 'occurred_at' },
}))

type Match = {
  productId: string
  productGid: string
  handle: string
  title: string
  vendor: string | null
  variant: { variantId: string; sku: string; title: string; price: number; compareAtPrice: number | null }
  metafields: { wholesaleCost: number | null; mapPrice: number | null; originalPrice: number | null }
}

function match(overrides: Partial<Match> & { sku: string; variantId: string }): Match {
  return {
    productId: 'gid://shopify/Product/1',
    productGid: 'gid://shopify/Product/1',
    handle: 'test-product',
    title: 'Test Product',
    vendor: 'SomeVendor',
    variant: { variantId: overrides.variantId, sku: overrides.sku, title: 'Default Title', price: 19.99, compareAtPrice: null },
    metafields: { wholesaleCost: 8, mapPrice: null, originalPrice: 20 },
    ...overrides,
  }
}

const findVariantsBySkus = vi.fn(async (_skus: string[]) => [] as Match[])
const updateProductMetafield = vi.fn(async (_productId: string, _key: string, _value: string, _type?: string) => {})
vi.mock('./shopify.server', () => ({
  findVariantsBySkus: (skus: string[]) => findVariantsBySkus(skus),
  updateProductMetafield: (...args: [string, string, string, string?]) => updateProductMetafield(...args),
}))

interface FakeRecomputeResult {
  status: 'auto_applied' | 'pending' | 'skipped_no_change' | 'rejected'
  auditId: number | null
  applied: boolean
  error?: string
}
const recomputeVariant = vi.fn(async (_params: { variantId: string; trigger: string }): Promise<FakeRecomputeResult> => ({
  status: 'auto_applied',
  auditId: 1,
  applied: true,
}))
vi.mock('./pricing-apply-v2.server', () => ({
  recomputeVariant: (params: { variantId: string; trigger: string }) => recomputeVariant(params),
}))

function ev(overrides: Partial<NalpacCostChangeEvent> & { sku: string }): NalpacCostChangeEvent {
  return { ...overrides }
}

describe('processNalpacCostChanges (ticket #12097, ADR-007 decision 4)', () => {
  afterEach(() => {
    vi.clearAllMocks()
    kvStore.clear()
  })

  // getPipelineSetting reads via db.select(...).from(...).where(...).limit(1);
  // queue one resolved value per call, in call order, since two settings are
  // read per non-short-circuit invocation (enabled, then throttle secs).
  function stubSetting(value: string | null) {
    dbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(value != null ? [{ value }] : []),
        }),
      }),
    } as unknown as ReturnType<typeof dbSelect>)
  }

  it('reprices through recomputeVariant, never decideAndApply, and syncs fresh cost/MAP metafields first', async () => {
    stubSetting('true') // pricing_webhook_enabled
    stubSetting('30')   // pricing_webhook_throttle_secs
    findVariantsBySkus.mockResolvedValueOnce([match({ sku: 'SKU1', variantId: 'gid://shopify/ProductVariant/1' })])
    recomputeVariant.mockResolvedValueOnce({ status: 'auto_applied', auditId: 42, applied: true })

    const { processNalpacCostChanges } = await import('./pricing-webhook.server')
    const result = await processNalpacCostChanges([ev({ sku: 'SKU1', wholesale: 7.5, mapPrice: 15 })], 'webhook')

    expect(updateProductMetafield).toHaveBeenCalledWith('gid://shopify/Product/1', 'wholesale_cost', '7.5', 'number_decimal')
    expect(updateProductMetafield).toHaveBeenCalledWith('gid://shopify/Product/1', 'map_price', '15', 'number_decimal')
    expect(recomputeVariant).toHaveBeenCalledWith({ variantId: 'gid://shopify/ProductVariant/1', trigger: 'webhook' })
    expect(result.autoApplied).toBe(1)
    expect(result.changesCreated).toBe(1)
    expect(result.pending).toBe(0)
    expect(result.failed).toBe(0)
  })

  it('does not write a metafield the event does not carry a fresh value for', async () => {
    stubSetting('true')
    stubSetting('30')
    findVariantsBySkus.mockResolvedValueOnce([match({ sku: 'SKU1', variantId: 'gid://shopify/ProductVariant/1' })])

    const { processNalpacCostChanges } = await import('./pricing-webhook.server')
    await processNalpacCostChanges([ev({ sku: 'SKU1' })], 'webhook')

    expect(updateProductMetafield).not.toHaveBeenCalled()
    expect(recomputeVariant).toHaveBeenCalledTimes(1)
  })

  it('maps a pending verdict and a rejected verdict to the result counters', async () => {
    stubSetting('true')
    stubSetting('30')
    findVariantsBySkus.mockResolvedValueOnce([
      match({ sku: 'SKU1', variantId: 'gid://shopify/ProductVariant/1' }),
      match({ sku: 'SKU2', variantId: 'gid://shopify/ProductVariant/2' }),
    ])
    recomputeVariant
      .mockResolvedValueOnce({ status: 'pending', auditId: 1, applied: false })
      .mockResolvedValueOnce({ status: 'rejected', auditId: 2, applied: false, error: 'below MAP' })

    const { processNalpacCostChanges } = await import('./pricing-webhook.server')
    const result = await processNalpacCostChanges([ev({ sku: 'SKU1' }), ev({ sku: 'SKU2' })], 'webhook')

    expect(result.pending).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.autoApplied).toBe(0)
    expect(result.errors).toContainEqual({ sku: 'SKU2', message: 'below MAP' })
  })

  it('does not count changesCreated or bump any status bucket on skipped_no_change', async () => {
    stubSetting('true')
    stubSetting('30')
    findVariantsBySkus.mockResolvedValueOnce([match({ sku: 'SKU1', variantId: 'gid://shopify/ProductVariant/1' })])
    recomputeVariant.mockResolvedValueOnce({ status: 'skipped_no_change', auditId: null, applied: false })

    const { processNalpacCostChanges } = await import('./pricing-webhook.server')
    const result = await processNalpacCostChanges([ev({ sku: 'SKU1' })], 'webhook')

    expect(result.changesCreated).toBe(0)
    expect(result.autoApplied).toBe(0)
    expect(result.pending).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.processedCount).toBe(1)
  })

  it('short-circuits when pricing_webhook_enabled is false, never touching Shopify or recomputeVariant', async () => {
    stubSetting('false')

    const { processNalpacCostChanges } = await import('./pricing-webhook.server')
    const result = await processNalpacCostChanges([ev({ sku: 'SKU1' })], 'webhook')

    expect(result.errors).toContainEqual({ sku: '*', message: 'webhook disabled' })
    expect(findVariantsBySkus).not.toHaveBeenCalled()
    expect(recomputeVariant).not.toHaveBeenCalled()
  })

  it('reports an unknown SKU without calling recomputeVariant for it', async () => {
    stubSetting('true')
    stubSetting('30')
    findVariantsBySkus.mockResolvedValueOnce([]) // SKU not carried in Shopify

    const { processNalpacCostChanges } = await import('./pricing-webhook.server')
    const result = await processNalpacCostChanges([ev({ sku: 'GHOST-SKU' })], 'webhook')

    expect(result.unknownSkus).toEqual(['GHOST-SKU'])
    expect(recomputeVariant).not.toHaveBeenCalled()
  })

  it('fails closed per-SKU when recomputeVariant throws, without aborting the batch', async () => {
    stubSetting('true')
    stubSetting('30')
    findVariantsBySkus.mockResolvedValueOnce([
      match({ sku: 'SKU1', variantId: 'gid://shopify/ProductVariant/1' }),
      match({ sku: 'SKU2', variantId: 'gid://shopify/ProductVariant/2' }),
    ])
    recomputeVariant
      .mockRejectedValueOnce(new Error('shopify 500'))
      .mockResolvedValueOnce({ status: 'auto_applied', auditId: 9, applied: true })

    const { processNalpacCostChanges } = await import('./pricing-webhook.server')
    const result = await processNalpacCostChanges([ev({ sku: 'SKU1' }), ev({ sku: 'SKU2' })], 'webhook')

    expect(result.failed).toBe(1)
    expect(result.autoApplied).toBe(1)
    expect(result.errors).toContainEqual({ sku: 'SKU1', message: 'shopify 500' })
  })
})
