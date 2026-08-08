import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchDiagnostics, IvrSearchOpts } from '~/lib/ivr-search.server'

// ticket #622: the filtered-to-zero retry ladder in runSearchBranch dropped
// priceMax, then subtype, then audience, but never the productTypeDial itself,
// so one wrong dial classification (e.g. a wand request tagged 'lube') made
// matching products permanently unreachable. A final retry now drops the dial
// and searches on the query text alone.

const searchForIvrWithDiagnostics =
  vi.fn<(opts: IvrSearchOpts) => Promise<SearchDiagnostics>>()

vi.mock('~/lib/ivr-search.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/ivr-search.server')>()
  return { ...actual, searchForIvrWithDiagnostics }
})

afterEach(() => {
  searchForIvrWithDiagnostics.mockReset()
})

describe('DISCOVERY filtered-to-zero dial-drop last resort (ticket #622)', () => {
  it('surfaces products on the final retry when the dial is wrong', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { runSearchBranch } = await import('~/lib/sms-v2/stages/discovery.server')

    // Any search still carrying a productTypeDial filters to zero (the dial is
    // misclassified); only the dial-dropped, query-only retry finds products.
    searchForIvrWithDiagnostics.mockImplementation(async (opts) => {
      if (opts.productTypeDial) return { reason: 'filtered-to-zero', cards: [] }
      return {
        reason: 'matched',
        cards: [
          { title: 'Real Wand', handle: 'real-wand', price: 42 } as never,
          { title: 'Other Wand', handle: 'other-wand', price: 55 } as never,
        ],
      }
    })

    const ctx = { conversation: {} } as never
    const intent = { intent: 'NAME_ITEM', confidence: 0.9, source: 'test' } as never
    const mergedSlots = { category: 'lube' } as never // wrong dial for a wand query
    const state = { gate: 'READY', slots: mergedSlots } as never

    const res = await runSearchBranch(ctx, intent, 'show me a wand', mergedSlots, state)

    // The wrong-dial searches all filtered to zero; the last retry dropped the
    // dial and surfaced products, so the reply is the multi-result list, not the
    // "coming up empty" fallback.
    expect(res.segments[0]!.prose).toContain('Real Wand')

    const calls = searchForIvrWithDiagnostics.mock.calls
    const firstOpts = calls[0]![0]
    const lastOpts = calls.at(-1)![0]
    expect(firstOpts.productTypeDial).toBe('lube') // dial was applied first
    expect(lastOpts.productTypeDial).toBeUndefined() // dial dropped on the last retry
    expect(lastOpts.query).toBe(firstOpts.query) // query text preserved
    // Logged so a misclassifying dial is visible.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropping productTypeDial'))

    warn.mockRestore()
  })

  it('does not engage the retry ladder when the first search matches', async () => {
    const { runSearchBranch } = await import('~/lib/sms-v2/stages/discovery.server')
    searchForIvrWithDiagnostics.mockResolvedValue({
      reason: 'matched',
      cards: [
        { title: 'A', handle: 'a', price: 40 } as never,
        { title: 'B', handle: 'b', price: 50 } as never,
      ],
    })

    const ctx = { conversation: {} } as never
    const intent = { intent: 'NAME_ITEM', confidence: 0.9, source: 'test' } as never
    const mergedSlots = { category: 'vibrator' } as never
    const state = { gate: 'READY', slots: mergedSlots } as never

    await runSearchBranch(ctx, intent, 'a vibrator', mergedSlots, state)
    expect(searchForIvrWithDiagnostics).toHaveBeenCalledTimes(1)
  })
})
