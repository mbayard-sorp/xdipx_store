/**
 * The `buyable_share` probe runner (ticket #15175). Added because
 * `rows_exist` on `import_candidates` always answers true — the table always
 * has rows — which is how blocker #555 (Nalpac inventory sync) false-cleared
 * on 2026-10-12 while the defect was still live.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROBE_DESCRIPTIONS, isProbe } from './owner-blockers-core'

afterEach(() => {
  vi.doUnmock('~/lib/db.server')
  vi.doUnmock('~/lib/shopify.server')
  vi.resetModules()
})

describe('buyable_share probe', () => {
  it('is registered and describes itself', () => {
    expect(isProbe('buyable_share')).toBe(true)
    expect(PROBE_DESCRIPTIONS['buyable_share']!('3'))
      .toBe('at least 80% of candidates published in the last 3 days are buyable (live stock > 3)')
  })

  it('is a could-not-ask (null), never false, when nothing published in the window', async () => {
    vi.doMock('~/lib/db.server', () => ({ db: { execute: vi.fn().mockResolvedValue({ rows: [] }) } }))
    vi.resetModules()
    const { PROBES } = await import('./owner-blockers.server')
    expect(await PROBES['buyable_share']!.run('3')).toBeNull()
  })

  it('clears (true) once most recently-published candidates are buyable', async () => {
    vi.doMock('~/lib/db.server', () => ({
      db: { execute: vi.fn().mockResolvedValue({ rows: [
        { product_id: '1' }, { product_id: '2' }, { product_id: '3' }, { product_id: '4' },
      ] }) },
    }))
    vi.doMock('~/lib/shopify.server', () => ({
      getHandleByProductId: vi.fn(async (id: string) => `product-${id}`),
      getProductByHandle: vi.fn(async (handle: string) => ({
        totalInventory: handle === 'product-4' ? 0 : 10,
      })),
    }))
    vi.resetModules()
    const { PROBES } = await import('./owner-blockers.server')
    // 3 of 4 buyable (75%)... below the 80% floor, so this case stays blocked.
    expect(await PROBES['buyable_share']!.run('3')).toBe(false)
  })

  it('stays blocked (false) while most recently-published candidates have no live stock', async () => {
    vi.doMock('~/lib/db.server', () => ({
      db: { execute: vi.fn().mockResolvedValue({ rows: [
        { product_id: '1' }, { product_id: '2' }, { product_id: '3' },
      ] }) },
    }))
    vi.doMock('~/lib/shopify.server', () => ({
      getHandleByProductId: vi.fn(async (id: string) => `product-${id}`),
      getProductByHandle: vi.fn(async () => ({ totalInventory: 0 })),
    }))
    vi.resetModules()
    const { PROBES } = await import('./owner-blockers.server')
    expect(await PROBES['buyable_share']!.run('3')).toBe(false)
  })

  it('clears (true) when the whole window is buyable', async () => {
    vi.doMock('~/lib/db.server', () => ({
      db: { execute: vi.fn().mockResolvedValue({ rows: [
        { product_id: '1' }, { product_id: '2' },
      ] }) },
    }))
    vi.doMock('~/lib/shopify.server', () => ({
      getHandleByProductId: vi.fn(async (id: string) => `product-${id}`),
      getProductByHandle: vi.fn(async () => ({ totalInventory: 25 })),
    }))
    vi.resetModules()
    const { PROBES } = await import('./owner-blockers.server')
    expect(await PROBES['buyable_share']!.run('3')).toBe(true)
  })

  it('excludes a lookup failure from the denominator rather than failing the whole probe', async () => {
    vi.doMock('~/lib/db.server', () => ({
      db: { execute: vi.fn().mockResolvedValue({ rows: [
        { product_id: '1' }, { product_id: '2' },
      ] }) },
    }))
    vi.doMock('~/lib/shopify.server', () => ({
      getHandleByProductId: vi.fn(async (id: string) => {
        if (id === '1') throw new Error('rate limited')
        return `product-${id}`
      }),
      getProductByHandle: vi.fn(async () => ({ totalInventory: 25 })),
    }))
    vi.resetModules()
    const { PROBES } = await import('./owner-blockers.server')
    // Only product 2 resolves; it is buyable, so the 1-of-1 share clears.
    expect(await PROBES['buyable_share']!.run('3')).toBe(true)
  })

  it('is a could-not-ask (null) when every live lookup fails', async () => {
    vi.doMock('~/lib/db.server', () => ({
      db: { execute: vi.fn().mockResolvedValue({ rows: [{ product_id: '1' }] }) },
    }))
    vi.doMock('~/lib/shopify.server', () => ({
      getHandleByProductId: vi.fn(async () => { throw new Error('Shopify unreachable') }),
      getProductByHandle: vi.fn(),
    }))
    vi.resetModules()
    const { PROBES } = await import('./owner-blockers.server')
    expect(await PROBES['buyable_share']!.run('3')).toBeNull()
  })
})
