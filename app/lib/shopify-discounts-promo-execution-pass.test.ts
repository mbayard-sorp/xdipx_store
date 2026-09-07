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
    const result = await runPromoExecutionPass(deps)

    expect(result).toEqual({ total: 2, minted: 2, refused: 0, skipped: 0 })
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

    expect(result).toEqual({ total: 1, minted: 0, refused: 0, skipped: 1 })
    expect(deps.createDiscount).not.toHaveBeenCalled()
  })

  it('is a clean no-op when there are no approved promo rows', async () => {
    listSuggestionsMock.mockResolvedValue([])

    const result = await runPromoExecutionPass(makeDeps())

    expect(result).toEqual({ total: 0, minted: 0, refused: 0, skipped: 0 })
  })

  it('counts a refusal separately from a mint', async () => {
    listSuggestionsMock.mockResolvedValue([{ id: 52, suggestion: CLEAN_BRIEF }])
    executeMock.mockResolvedValue([])

    const deps = makeDeps({ resolveProductGids: vi.fn(async () => []) })
    const result = await runPromoExecutionPass(deps)

    expect(result).toEqual({ total: 1, minted: 0, refused: 1, skipped: 0 })
  })
})
