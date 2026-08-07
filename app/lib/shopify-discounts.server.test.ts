import { describe, it, expect, vi } from 'vitest'
import {
  promoExecuteEnabled,
  detectMapConflict,
  detectMapClean,
  extractPromoCode,
  extractSkus,
  parsePromoBrief,
  decidePromo,
  buildDiscountVariables,
  executeApprovedPromo,
  PROMO_EXECUTE_VALVE,
  type PromoExecuteDeps,
} from './shopify-discounts.server'

// These helpers back the promo executor that mints a LIVE Shopify discount code
// from an approved brief. It is fail-closed: MAP conflicts, briefs that never
// state MAP compliance, missing windows, and promos with no resolvable eligible
// product are refused, never minted. Gated by promo_execute_enabled (default
// OFF). Verified without Shopify or a database.

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

// The real promo-manager format, reproduced from live suggestion #51. It states
// the code inline after the "PROMO n" header, names eligible products by Nalpac
// SKU number (not by /products/ link), verdicts MAP as "MAP CHECK PASS", and
// separately explains a scoping guardrail with the phrase "would sell below MAP".
// That last phrase is what the first implementation false-flagged as a conflict.
const EM = String.fromCharCode(0x2014) // em-dash, kept out of the source literal
const LIVE_BRIEF_51 =
  `PROMO 2 (propose-only, owner mints in Shopify) ${EM} FIRSTLOOK10, a shallow ` +
  `first-order welcome code scoped only to fully-discountable (map_price=0) starter SKUs. ` +
  `DEPTH: 10% off (deliberately shallow, not the 45-50%-off daily-deal tier). ` +
  `SKU SCOPE, MAP CHECK PASS (map_price=0 confirmed per-SKU): Screaming O Bullet ` +
  `Vibrators (SKUs 84740/84743/84747/84748; wholesale $5.45, MSRP $13.80-15.05). ` +
  `STANDING GUARDRAIL: mint the code restricted to a tagged welcome-eligible collection ` +
  `containing ONLY map_price=0 SKUs, because any further code discount on those would ` +
  `sell below MAP. WINDOW: 2026-07-27 through 2026-08-09 for this proposal.`

describe('promoExecuteEnabled', () => {
  it('is off unless the setting is exactly "true"', () => {
    expect(promoExecuteEnabled(null)).toBe(false)
    expect(promoExecuteEnabled('false')).toBe(false)
    expect(promoExecuteEnabled('1')).toBe(false)
    expect(promoExecuteEnabled('true')).toBe(true)
  })
})

describe('detectMapConflict', () => {
  it('flags an explicit MAP-fail verdict', () => {
    expect(detectMapConflict('MAP conflict on dolce')).toBe(true)
    expect(detectMapConflict('MAP CHECK FAIL')).toBe(true)
    expect(detectMapConflict('not MAP-compliant')).toBe(true)
    expect(detectMapConflict('MAP violation flagged')).toBe(true)
    expect(detectMapConflict('this promo violates MAP')).toBe(true)
  })
  it('does not flag a clean MAP note', () => {
    expect(detectMapConflict('MAP check result: clean, all SKUs MAP=0')).toBe(false)
    expect(detectMapConflict('MAP = 0, discountable')).toBe(false)
    expect(detectMapConflict('MAP CHECK PASS')).toBe(false)
  })
  it('does not flag guardrail-rationale prose that merely says "below MAP"', () => {
    // The regression: bare, conditional "would sell below MAP" explains a
    // guardrail, it is not a verdict that this promo breaches MAP.
    expect(detectMapConflict('any further discount on those would sell below MAP')).toBe(false)
    expect(detectMapConflict(LIVE_BRIEF_51)).toBe(false)
  })
})

describe('detectMapClean', () => {
  it('requires an explicit clean verdict', () => {
    expect(detectMapClean('MAP CHECK PASS')).toBe(true)
    expect(detectMapClean('MAP check result: clean')).toBe(true)
    expect(detectMapClean('map_price=0 confirmed')).toBe(true)
    expect(detectMapClean(LIVE_BRIEF_51)).toBe(true)
  })
  it('is false when the brief never states MAP compliance', () => {
    expect(detectMapClean('Code: X10\nDepth: 10%\nWindow: 2026-08-12 to 2026-08-19')).toBe(false)
    expect(detectMapClean('this sits below MAP')).toBe(false)
  })
})

describe('extractPromoCode', () => {
  it('reads an explicit Code: line', () => {
    expect(extractPromoCode(CLEAN_BRIEF)).toBe('SLOWEVENING15')
  })
  it('reads a code stated inline after the PROMO header', () => {
    expect(extractPromoCode(LIVE_BRIEF_51)).toBe('FIRSTLOOK10')
  })
  it('never returns a section label as a code', () => {
    expect(extractPromoCode('PROMO plan. DEPTH and WINDOW only, no code here.')).toBeNull()
  })
})

describe('extractSkus', () => {
  it('reads SKU numbers from a labelled list and ignores counts and prices', () => {
    expect(extractSkus(LIVE_BRIEF_51)).toEqual(['84740', '84743', '84747', '84748'])
    // "SKUs (1503 MAP-locked ...)" is a count, not a scope: the paren breaks the label.
    expect(extractSkus('about 60% of SKUs (1503 MAP-locked) are floored')).toEqual([])
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
    expect(p.skus).toEqual([])
    expect(p.mapNote?.toLowerCase()).toContain('map')
  })
  it('parses the live inline format: inline code, SKU scope, prose window', () => {
    const p = parsePromoBrief(LIVE_BRIEF_51)
    expect(p.code).toBe('FIRSTLOOK10')
    expect(p.percentage).toBe(10)
    expect(p.startsAt).toBe('2026-07-27T00:00:00Z')
    expect(p.endsAt).toBe('2026-08-09T23:59:59Z')
    expect(p.handles).toEqual([])
    expect(p.skus).toEqual(['84740', '84743', '84747', '84748'])
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
  it('passes the live MAP-clean brief #51', () => {
    const p = parsePromoBrief(LIVE_BRIEF_51)
    expect(decidePromo(p, LIVE_BRIEF_51)).toEqual({ ok: true, reason: 'ok' })
  })
  it('refuses a MAP-flagged brief first', () => {
    const p = parsePromoBrief(MAP_FLAGGED_BRIEF)
    expect(decidePromo(p, MAP_FLAGGED_BRIEF)).toEqual({ ok: false, reason: 'map-conflict-flagged' })
  })
  it('refuses a structurally complete brief that never confirms MAP', () => {
    const text = 'Code: X10\nDepth: 10%\nWindow: 2026-08-12 to 2026-08-19\nProducts: https://xdipx.com/products/ferri'
    expect(decidePromo(parsePromoBrief(text), text)).toEqual({ ok: false, reason: 'map-not-confirmed' })
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
    resolveProductGids: vi.fn(async (sel: { handles: string[]; skus: string[] }) =>
      [...sel.handles, ...sel.skus].map((_, i) => `gid://shopify/Product/${i + 1}`),
    ),
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

  it('mints the live MAP-clean brief #51 end to end, resolving SKUs to products', async () => {
    const deps = makeDeps()
    const res = await executeApprovedPromo({ id: 51, suggestion: LIVE_BRIEF_51 }, deps)
    expect(res.minted).toBe(true)
    expect(res.code).toBe('FIRSTLOOK10')
    // resolveProductGids is asked for the parsed SKUs, not /products/ handles.
    const sel = (deps.resolveProductGids as any).mock.calls[0][0]
    expect(sel.handles).toEqual([])
    expect(sel.skus).toEqual(['84740', '84743', '84747', '84748'])
    expect(deps.createDiscount).toHaveBeenCalledOnce()
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
