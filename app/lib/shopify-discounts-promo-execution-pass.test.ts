/**
 * Ticket #8022: runPromoExecutionPass() is the loop that used to be inlined
 * in scripts/execute-approved-promos.ts::main(), extracted so both the daily
 * /cron/promo-execute job and the weekly script call one implementation.
 *
 * Separate file from shopify-discounts.server.test.ts because this function
 * (unlike executeApprovedPromo) reaches outside its deps seam for the
 * suggestion list and the already-handled check, so it needs
 * ~/lib/team.server and ~/lib/db.server mocked at the module level.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listSuggestionsMock = vi.hoisted(() => vi.fn())
const executeMock = vi.hoisted(() => vi.fn())

vi.mock('~/lib/team.server', () => ({
  listSuggestions: listSuggestionsMock,
  addSuggestionNote: vi.fn(async () => {}),
}))
vi.mock('~/lib/db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => executeMock(),
      }),
    }),
  },
}))

import { runPromoExecutionPass, type PromoExecuteDeps } from '~/lib/shopify-discounts.server'

function makeDeps(overrides: Partial<PromoExecuteDeps> = {}): PromoExecuteDeps {
  return {
    getSetting: vi.fn(async () => 'true'),
    resolveProductGids: vi.fn(async (sel: { handles: string[]; skus: string[] }) =>
      [...sel.handles, ...sel.skus].map((_, i) => `gid://shopify/Product/${i + 1}`),
    ),
    createDiscount: vi.fn(async () => ({ id: 'gid://shopify/DiscountCodeNode/9', userErrors: [] })),
    sendOwnerEmail: vi.fn(async () => ({ sent: true })),
    addNote: vi.fn(async () => {}),
    ...overrides,
  }
}

const CLEAN_BRIEF = `Code: SLOWEVENING15
Depth: 15%
Window: 2026-08-12 to 2026-08-19
Products: https://xdipx.com/products/ferri
MAP check result: clean, all named SKUs are MAP=0`

// Ticket #12076: executeApprovedPromo now checks the parsed window's startsAt
// against the clock, so a test that expects a mint must pin `now` before
// CLEAN_BRIEF's window, or the suite goes flaky as real time marches past
// 2026-08-12.
const BEFORE_TEST_WINDOW = new Date('2026-07-01T00:00:00Z')

beforeEach(() => {
  listSuggestionsMock.mockReset()
  executeMock.mockReset()
})

describe('runPromoExecutionPass', () => {
  it('mints every approved, unhandled promo and reports counts', async () => {
    listSuggestionsMock.mockResolvedValue([
      { id: 50, suggestion: CLEAN_BRIEF },
      { id: 51, suggestion: CLEAN_BRIEF },
    ])
    executeMock.mockResolvedValue([]) // neither row has a handled note yet

    const deps = makeDeps()
    const result = await runPromoExecutionPass(deps, BEFORE_TEST_WINDOW)

    expect(result).toEqual({ total: 2, minted: 2, refused: 0, skipped: 0, failed: 0 })
    expect(deps.createDiscount).toHaveBeenCalledTimes(2)
    expect(listSuggestionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ team: 'strategy', kinds: ['promo'], statuses: ['approved'] }),
    )
  })

  it('skips a row that already carries a handled note, minting nothing for it', async () => {
    listSuggestionsMock.mockResolvedValue([{ id: 50, suggestion: CLEAN_BRIEF }])
    executeMock.mockResolvedValue([{ ref: 'Shopify discount code minted: SLOWEVENING15 (...)' }])

    const deps = makeDeps()
    const result = await runPromoExecutionPass(deps)

    expect(result).toEqual({ total: 1, minted: 0, refused: 0, skipped: 1, failed: 0 })
    expect(deps.createDiscount).not.toHaveBeenCalled()
  })

  it('is a clean no-op when there are no approved promo rows', async () => {
    listSuggestionsMock.mockResolvedValue([])

    const result = await runPromoExecutionPass(makeDeps())

    expect(result).toEqual({ total: 0, minted: 0, refused: 0, skipped: 0, failed: 0 })
  })

  it('counts a refusal separately from a mint', async () => {
    listSuggestionsMock.mockResolvedValue([{ id: 52, suggestion: CLEAN_BRIEF }])
    executeMock.mockResolvedValue([])

    const deps = makeDeps({ resolveProductGids: vi.fn(async () => []) })
    const result = await runPromoExecutionPass(deps)

    expect(result).toEqual({ total: 1, minted: 0, refused: 1, skipped: 0, failed: 0 })
  })

  // Ticket #22341: row #20830 (LUBE15) failed its first mint attempt on
  // Shopify's 100-product limit, and the old handled-note regex treated ANY
  // "mint FAILED" note as handled forever, so /cron/promo-execute silently
  // skipped it on every later pass with no retry and no `failed` count.
  describe('transient mint-failure retry (ticket #22341)', () => {
    it('retries a row carrying one prior transient shopify-error note', async () => {
      listSuggestionsMock.mockResolvedValue([{ id: 20830, suggestion: CLEAN_BRIEF }])
      executeMock.mockResolvedValue([{ ref: 'Promo mint FAILED (shopify-error: 429 Too Many Requests). No code created.' }])

      const deps = makeDeps()
      const result = await runPromoExecutionPass(deps, BEFORE_TEST_WINDOW)

      expect(result).toEqual({ total: 1, minted: 1, refused: 0, skipped: 0, failed: 0 })
      expect(deps.createDiscount).toHaveBeenCalledOnce()
    })

    it('stops retrying once a row has burned 3 transient shopify-error attempts', async () => {
      listSuggestionsMock.mockResolvedValue([{ id: 20830, suggestion: CLEAN_BRIEF }])
      executeMock.mockResolvedValue([
        { ref: 'Promo mint FAILED (shopify-error: 429). No code created.' },
        { ref: 'Promo mint FAILED (shopify-error: 429). No code created.' },
        { ref: 'Promo mint FAILED (shopify-error: 429). No code created.' },
      ])

      const deps = makeDeps()
      const result = await runPromoExecutionPass(deps, BEFORE_TEST_WINDOW)

      expect(result).toEqual({ total: 1, minted: 0, refused: 0, skipped: 1, failed: 0 })
      expect(deps.createDiscount).not.toHaveBeenCalled()
    })

    it('never retries a row carrying a terminal shopify-user-error note', async () => {
      listSuggestionsMock.mockResolvedValue([{ id: 51, suggestion: CLEAN_BRIEF }])
      executeMock.mockResolvedValue([{ ref: 'Promo mint FAILED (shopify-user-error: Code must be unique). No code created.' }])

      const deps = makeDeps()
      const result = await runPromoExecutionPass(deps, BEFORE_TEST_WINDOW)

      expect(result).toEqual({ total: 1, minted: 0, refused: 0, skipped: 1, failed: 0 })
      expect(deps.createDiscount).not.toHaveBeenCalled()
    })

    it('counts a fresh mint failure under `failed`, not `skipped`', async () => {
      listSuggestionsMock.mockResolvedValue([{ id: 20830, suggestion: CLEAN_BRIEF }])
      executeMock.mockResolvedValue([])

      const deps = makeDeps({ createDiscount: vi.fn(async () => { throw new Error('503') }) })
      const result = await runPromoExecutionPass(deps, BEFORE_TEST_WINDOW)

      expect(result).toEqual({ total: 1, minted: 0, refused: 0, skipped: 0, failed: 1 })
    })
  })
})
