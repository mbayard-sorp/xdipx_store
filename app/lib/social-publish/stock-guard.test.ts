// Publish-time stock guard (ticket #2212). The one implementation both publish
// paths (admin.socials.tsx's manual post-media intent and the scheduler tick
// in social-publish-job.server.ts) call, so these cases pin the shared
// contract rather than either caller's own wiring. No network call: the
// lookup is always injected here.
import { describe, expect, it, vi } from 'vitest'
import { checkLinkedProductStock } from './stock-guard.server'

describe('checkLinkedProductStock', () => {
  it('is a no-op when the row carries no product linkage', async () => {
    const lookup = vi.fn()
    const result = await checkLinkedProductStock(null, lookup)
    expect(result).toEqual({ ok: true })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('is a no-op for undefined too', async () => {
    const lookup = vi.fn()
    const result = await checkLinkedProductStock(undefined, lookup)
    expect(result).toEqual({ ok: true })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('passes when the linked product is available for sale', async () => {
    const lookup = vi.fn(async () => true)
    const result = await checkLinkedProductStock('gid://shopify/Product/1', lookup)
    expect(result).toEqual({ ok: true })
    expect(lookup).toHaveBeenCalledWith('gid://shopify/Product/1')
  })

  it('blocks when the linked product is out of stock', async () => {
    const lookup = vi.fn(async () => false)
    const result = await checkLinkedProductStock('gid://shopify/Product/2', lookup)
    expect(result.ok).toBe(false)
    expect(result.detail).toBe('Linked product gid://shopify/Product/2 is out of stock.')
  })

  it('fails closed when availability cannot be determined at all', async () => {
    const lookup = vi.fn(async () => null)
    const result = await checkLinkedProductStock('gid://shopify/Product/3', lookup)
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/could not be verified/)
  })

  it('fails closed when the lookup throws', async () => {
    const lookup = vi.fn(async () => { throw new Error('network blip') })
    const result = await checkLinkedProductStock('gid://shopify/Product/4', lookup)
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/could not be verified/)
  })
})
