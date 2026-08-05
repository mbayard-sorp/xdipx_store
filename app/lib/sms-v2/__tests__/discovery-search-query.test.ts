import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchDiagnostics, IvrSearchOpts } from '~/lib/ivr-search.server'

// conv-audit B2: SMS discovery search discarded any brand/model the customer
// named (category ?? customerText) and never forwarded the MATTERS answers.
// These tests pin the query-selection rule and the mattersTags pass-through.

const searchForIvrWithDiagnostics =
  vi.fn<(opts: IvrSearchOpts) => Promise<SearchDiagnostics>>()

vi.mock('~/lib/ivr-search.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/ivr-search.server')>()
  return {
    ...actual, // keep the real STRICT_CATEGORY_TERMS pickSearchQuery relies on
    searchForIvrWithDiagnostics,
  }
})

afterEach(() => {
  searchForIvrWithDiagnostics.mockReset()
})

async function load() {
  return import('../stages/discovery.server')
}

describe('pickSearchQuery (conv-audit B2)', () => {
  it('keeps a named brand/model in the query instead of collapsing to the category', async () => {
    const { pickSearchQuery } = await load()
    // slot-extractor would set category=vibrator for this; the brand must survive.
    expect(pickSearchQuery('Do you have the Lelo Sona 2?', 'vibrator')).toBe(
      'Do you have the Lelo Sona 2?',
    )
    expect(pickSearchQuery('looking for a We-Vibe Chorus', 'vibrator')).toBe(
      'looking for a We-Vibe Chorus',
    )
  })

  it('uses the canonical category term for a bare category browse', async () => {
    const { pickSearchQuery } = await load()
    expect(pickSearchQuery('a vibrator', 'vibrator')).toBe('vibrator')
    expect(pickSearchQuery('got any lube?', 'lube')).toBe('lube')
    // "wand"/"wands" is category vocabulary too; the extracted category is 'vibrator'.
    expect(pickSearchQuery('show me wands under $50', 'vibrator')).toBe('vibrator')
    expect(pickSearchQuery('I want a vibrator for my girlfriend', 'vibrator')).toBe('vibrator')
  })

  it('keeps a descriptor that is not part of the category vocabulary', async () => {
    const { pickSearchQuery } = await load()
    expect(pickSearchQuery('a quiet rabbit for travel', 'vibrator')).toBe(
      'a quiet rabbit for travel',
    )
  })

  it('falls back to the customer text when no category was extracted', async () => {
    const { pickSearchQuery } = await load()
    expect(pickSearchQuery('something waterproof', undefined)).toBe('something waterproof')
  })
})

describe('runSearchBranch forwards MATTERS answers as mattersTags (conv-audit B2)', () => {
  it('passes mergedSlots.matters through to the search', async () => {
    const { runSearchBranch } = await load()
    searchForIvrWithDiagnostics.mockResolvedValue({
      reason: 'matched',
      cards: [
        { title: 'A', handle: 'a', price: 40 } as never,
        { title: 'B', handle: 'b', price: 50 } as never,
      ],
    })

    const ctx = { conversation: {} } as never
    const intent = { intent: 'PRODUCT_LOOKUP', confidence: 0.9, source: 'test' } as never
    const mergedSlots = {
      category: 'vibrator' as const,
      audience: 'for-her' as const,
      matters: ['quiet', 'waterproof'],
    }
    const state = { gate: 'READY', slots: mergedSlots } as never

    await runSearchBranch(ctx, intent, 'a vibrator', mergedSlots, state)

    expect(searchForIvrWithDiagnostics).toHaveBeenCalled()
    const opts = searchForIvrWithDiagnostics.mock.calls[0]![0]
    expect(opts.mattersTags).toEqual(['quiet', 'waterproof'])
    // And the bare-browse query still collapses to the category term.
    expect(opts.query).toBe('vibrator')
  })
})
