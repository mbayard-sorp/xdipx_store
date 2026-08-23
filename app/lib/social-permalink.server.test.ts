// Permalink resolution (Phase 4, #4939). No network: the Graph GET is injected.
import { describe, it, expect, vi } from 'vitest'
import { permalinkFor } from './social-permalink.server'
import { X_HANDLE } from './social-publish/x-limits'

describe('permalinkFor', () => {
  it('builds an X permalink synchronously on the store handle', async () => {
    const igGet = vi.fn()
    await expect(permalinkFor('x', '1957', { igGet })).resolves.toBe(`https://x.com/${X_HANDLE}/status/1957`)
    expect(igGet).not.toHaveBeenCalled()
  })

  it('asks Instagram for the permalink field of the media id', async () => {
    const igGet = vi.fn(async () => ({ ok: true as const, data: { permalink: 'https://www.instagram.com/p/abc/' } }))
    await expect(permalinkFor('instagram', '17900', { igGet, igToken: 't' }))
      .resolves.toBe('https://www.instagram.com/p/abc/')
    expect(igGet).toHaveBeenCalledWith('/17900', { fields: 'permalink' })
  })

  it('returns null, never throws, when Instagram fails or the token is missing', async () => {
    await expect(permalinkFor('instagram', '1', {
      igGet: async () => ({ ok: false as const, error: { message: 'nope' } }), igToken: 't',
    })).resolves.toBeNull()
    await expect(permalinkFor('instagram', '1', {
      igGet: async () => { throw new Error('net') }, igToken: 't',
    })).resolves.toBeNull()
    await expect(permalinkFor('instagram', '1', {
      igGet: async () => ({ ok: true as const, data: {} }), igToken: 't',
    })).resolves.toBeNull()
    const igGet = vi.fn()
    await expect(permalinkFor('instagram', '1', { igGet, igToken: null })).resolves.toBeNull()
    expect(igGet).not.toHaveBeenCalled()
  })

  it('returns null for a missing id or an unknown platform', async () => {
    await expect(permalinkFor('x', null)).resolves.toBeNull()
    await expect(permalinkFor('tiktok', '1', { igToken: 't' })).resolves.toBeNull()
  })
})
