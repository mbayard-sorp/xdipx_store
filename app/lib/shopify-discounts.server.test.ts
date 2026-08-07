import { describe, it, expect, vi } from 'vitest'
import {
  promoExecuteEnabled,
  detectMapConflict,
  parsePromoBrief,
  decidePromo,
  buildDiscountVariables,
  executeApprovedPromo,
  PROMO_EXECUTE_VALVE,
  type PromoExecuteDeps,
} from './shopify-discounts.server'

// These helpers back the promo executor that mints a LIVE Shopify discount code
// from an approved brief. It is fail-closed: MAP conflicts, missing windows, and
// promos with no resolvable eligible product are refused, never minted. Gated by
// promo_execute_enabled (default OFF). Verified without Shopify or a database.

const CLEAN_BRIEF = `Promo: Late Summer Wind-Down
Code: SLOWEVENING15
Depth: 15%
Window: 2026-08-12 to 2026-08-19
Eligible SKUs: ferri, dolce
Products: https://xdipx.com/products/ferri and https://xdipx.com/products/dolce
Post-discount margin: 27% computed against live price as of 2026-08-07
Price range: the code can reach $59 to $129
MAP check result: clean, all named SKUs are MAP=0
Channel plan: email brief + homepage banner`

const MAP_FLAGGED_BRIEF = CLEAN_BRIEF.replace(
  'MAP check result: clean, all named SKUs are MAP=0',
  'MAP check result: MAP conflict on dolce, it sits below MAP',
)

describe('promoExecuteEnabled', () => {
  it('is off unless the setting is exactly "true"', () => {
    expect(promoExecuteEnabled(null)).toBe(false)
    expect(promoExecuteEnabled('false')).toBe(false)
    expect(promoExecuteEnabled('1')).toBe(false)
    expect(promoExecuteEnabled('true')).toBe(true)
  })
})

describe('detectMapConflict', () => {
  it('flags explicit conflict phrasing', () => {
    expect(detectMapConflict('MAP conflict on dolce')).toBe(true)
    expect(detectMapConflict('this sits below MAP')).toBe(true)
    expect(detectMapConflict('not MAP-compliant')).toBe(true)
    expect(detectMapConflict('MAP violation flagged')).toBe(true)
  })
  it('does not flag a clean MAP note', () => {
    expect(detectMapConflict('MAP check result: clean, all SKUs MAP=0')).toBe(false)
    expect(detectMapConflict('MAP = 0, discountable')).toBe(false)
  })
})

describe('parsePromoBrief', () => {
  it('extracts code, depth, ISO window, and product handles', () => {
    const p = parsePromoBrief(CLEAN_BRIEF)
    expect(p.code).toBe('SLOWEVENING15')
    expect(p.percentage).toBe(15)
    expect(p.startsAt).toBe('2026-08-12T00:00:00Z')
    expect(p.endsAt).toBe('2026-08-19T23:59:59Z')
    expect(p.handles).toEqual(['ferri', 'dolce'])
    expect(p.mapNote?.toLowerCase()).toContain('map')
  })
  it('leaves the window null when there are fewer than two ISO dates', () => {
    const p = parsePromoBrief('Code: X10\nDepth: 10%\nStarts 2026-08-12, ends soon')
    expect(p.startsAt).toBeNull()
    expect(p.endsAt).toBeNull()
  })
})

describe('decidePromo', () => {
  it('passes a clean, complete brief', () => {
    const p = parsePromoBrief(CLEAN_BRIEF)
    expect(decidePromo(p, CLEAN_BRIEF)).toEqual({ ok: true, reason: 'ok' })
  })
  it('refuses a MAP-flagged brief first', () => {
    const p = parsePromoBrief(MAP_FLAGGED_BRIEF)
    expect(decidePromo(p, MAP_FLAGGED_BRIEF)).toEqual({ ok: false, reason: 'map-conflict-flagged' })
  })
  it('refuses when the window is not explicit', () => {
    const text = 'Code: X10\nDepth: 10%\nWindow: starts 2026-08-12'
    expect(decidePromo(parsePromoBrief(text), text)).toEqual({ ok: false, reason: 'no-explicit-window' })
  })
  it('refuses when the end is not after the start', () => {
    const text = 'Code: X10\nDepth: 10%\nWindow: 2026-08-19 to 2026-08-12'
    expect(decidePromo(parsePromoBrief(text), text)).toEqual({ ok: false, reason: 'invalid-window' })
  })
  it('refuses a missing code or depth', () => {
    const noCode = 'Depth: 10%\nWindow: 2026-08-12 to 2026-08-19'
    expect(decidePromo(parsePromoBrief(noCode), noCode).reason).toBe('no-code')
    const noDepth = 'Code: X10\nWindow: 2026-08-12 to 2026-08-19'
    expect(decidePromo(parsePromoBrief(noDepth), noDepth).reason).toBe('no-depth')
  })
})

describe('buildDiscountVariables', () => {
  it('sends percent as a 0..1 decimal and scopes to the given products', () => {
    const v = buildDiscountVariables({
      code: 'SLOWEVENING15',
      percentage: 15,
      startsAt: '2026-08-12T00:00:00Z',
      endsAt: '2026-08-19T23:59:59Z',
      productGids: ['gid://shopify/Product/1', 'gid://shopify/Product/2'],
    }) as any
    const d = v.basicCodeDiscount
    expect(d.code).toBe('SLOWEVENING15')
    expect(d.title).toBe('SLOWEVENING15')
    expect(d.customerGets.value.percentage).toBeCloseTo(0.15)
    expect(d.customerGets.items.products.productsToAdd).toHaveLength(2)
    expect(d.startsAt).toBe('2026-08-12T00:00:00Z')
    expect(d.endsAt).toBe('2026-08-19T23:59:59Z')
  })
})

function makeDeps(overrides: Partial<PromoExecuteDeps> = {}): PromoExecuteDeps {
  return {
    getSetting: vi.fn(async () => 'true'),
    resolveProductGids: vi.fn(async (h: string[]) => h.map((_, i) => `gid://shopify/Product/${i + 1}`)),
    createDiscount: vi.fn(async () => ({ id: 'gid://shopify/DiscountCodeNode/9', userErrors: [] })),
    sendOwnerEmail: vi.fn(async () => ({ sent: true })),
    addNote: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('executeApprovedPromo', () => {
  it('does nothing when the valve is off', async () => {
    const deps = makeDeps({ getSetting: vi.fn(async () => null) })
    const res = await executeApprovedPromo({ id: 1, suggestion: CLEAN_BRIEF }, deps)
    expect(res).toEqual({ minted: false, reason: 'valve-off' })
    expect(deps.createDiscount).not.toHaveBeenCalled()
    expect(deps.resolveProductGids).not.toHaveBeenCalled()
    expect(deps.sendOwnerEmail).not.toHaveBeenCalled()
  })

  it('reads the valve by the documented key', async () => {
    const getSetting = vi.fn(async () => null)
    await executeApprovedPromo({ id: 1, suggestion: CLEAN_BRIEF }, makeDeps({ getSetting }))
    expect(getSetting).toHaveBeenCalledWith(PROMO_EXECUTE_VALVE)
  })

  it('mints a live code, emails the owner, and records the code on the ticket', async () => {
    const deps = makeDeps()
    const res = await executeApprovedPromo({ id: 50, suggestion: CLEAN_BRIEF }, deps)
    expect(res.minted).toBe(true)
    expect(res.code).toBe('SLOWEVENING15')
    expect(res.discountId).toBe('gid://shopify/DiscountCodeNode/9')
    expect(deps.createDiscount).toHaveBeenCalledOnce()
    expect(deps.sendOwnerEmail).toHaveBeenCalledOnce()
    const [noteId, noteRef] = (deps.addNote as any).mock.calls[0]
    expect(noteId).toBe(50)
    expect(noteRef).toContain('SLOWEVENING15')
  })

  it('refuses a MAP-flagged row loudly and never mints', async () => {
    const deps = makeDeps()
    const res = await executeApprovedPromo({ id: 51, suggestion: MAP_FLAGGED_BRIEF }, deps)
    expect(res.minted).toBe(false)
    expect(res.refused).toBe(true)
    expect(res.reason).toBe('map-conflict-flagged')
    expect(deps.createDiscount).not.toHaveBeenCalled()
    expect(deps.sendOwnerEmail).toHaveBeenCalledOnce()          // loud
    expect(deps.addNote).toHaveBeenCalledOnce()                 // loud
  })

  it('refuses rather than minting a catalog-wide code when no product resolves', async () => {
    const deps = makeDeps({ resolveProductGids: vi.fn(async () => []) })
    const res = await executeApprovedPromo({ id: 52, suggestion: CLEAN_BRIEF }, deps)
    expect(res.refused).toBe(true)
    expect(res.reason).toBe('no-eligible-products')
    expect(deps.createDiscount).not.toHaveBeenCalled()
  })

  it('reports a Shopify userError without throwing and does not claim a mint', async () => {
    const deps = makeDeps({
      createDiscount: vi.fn(async () => ({ id: null, userErrors: [{ message: 'Code has already been taken' }] })),
    })
    const res = await executeApprovedPromo({ id: 53, suggestion: CLEAN_BRIEF }, deps)
    expect(res.minted).toBe(false)
    expect(res.reason).toContain('shopify-user-error')
    expect(deps.addNote).toHaveBeenCalledOnce()
    expect(deps.sendOwnerEmail).not.toHaveBeenCalled()          // not a mint, not a guard refusal
  })

  it('reports a thrown Shopify error', async () => {
    const deps = makeDeps({ createDiscount: vi.fn(async () => { throw new Error('429') }) })
    const res = await executeApprovedPromo({ id: 54, suggestion: CLEAN_BRIEF }, deps)
    expect(res.minted).toBe(false)
    expect(res.reason).toContain('shopify-error')
  })
})
