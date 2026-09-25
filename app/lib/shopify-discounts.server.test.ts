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

// Excerpt of the real #6757 (LUBE20) brief text that false-positived as a MAP
// conflict on 2026-09-08: exclusion-rationale prose explaining why 9 SKUs were
// left OUT of the promo's scope trips the "breaches MAP" alternative even
// though it is not a verdict on the promo itself. The same brief states an
// explicit "MAP CHECK CLEAN" verdict a little further on.
const MAP_EXCLUSION_RATIONALE_BRIEF =
  '9 excluded already at MAP floor / zero headroom (further discount breaches MAP -- ' +
  '75267 Intimate Earth Mojo Clove Anal Glide, 77096 LELO Water-Based Moisturizer). ' +
  '42 SKUs remain, all map_price null -> fully discountable, MAP CHECK CLEAN.'

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
  // Ticket #9366 (split from #9319, defect D): #6757 (LUBE20) false-positived
  // on 2026-09-08 because "further discount breaches MAP" sits inside
  // exclusion-rationale prose ("9 excluded already at MAP floor / ...").
  it('does not flag a MAP-fail phrase sitting inside exclusion-rationale prose (#6757)', () => {
    expect(detectMapConflict(MAP_EXCLUSION_RATIONALE_BRIEF)).toBe(false)
  })
  it('still flags a real conflict verdict elsewhere in a brief that also excludes SKUs', () => {
    // The exclusion-context guard must not mask an unrelated, real conflict
    // verdict that appears far enough away in the same brief.
    const text = `${MAP_EXCLUSION_RATIONALE_BRIEF}\n\nSeparately: MAP conflict on a different SKU, not eligible.`
    expect(detectMapConflict(text)).toBe(true)
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
  it('reads the explicit clean verdict on the #6757 exclusion-rationale brief', () => {
    expect(detectMapClean(MAP_EXCLUSION_RATIONALE_BRIEF)).toBe(true)
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

// Real live suggestion #9321 (BULLETWEEK20 CORRECTED), reproduced verbatim.
// Refused 'no-eligible-products' before this fix — extractSkus's old
// labelled-list-only pattern found nothing, because this brief never writes
// "SKU:" or "SKUs" immediately before a number list; it writes a lead-in
// sentence naming a count, then a "; "-delimited "<SKU> <name> $<price> ->
// <pct>%" list. All 12 SKUs verified live against production Shopify
// 2026-09-22 (see the PR body for the resolved product ids/titles).
const BULLETWEEK20_BRIEF =
  'BULLETWEEK20 CORRECTED -- supersedes #8023. 20% off code BULLETWEEK20, window ' +
  '2026-09-28 to 2026-10-04, scoped to exactly 12 SKUs (down from 21). MAP check on all 12: ' +
  'map_price = 0.0, fully discountable (confirmed live via Shopify Admin GraphQL, 2026-09-14). ' +
  'Post-discount margin computed against LIVE Shopify variant price as of 2026-09-14, all ' +
  'healthy and well above the 25% floor, no category-license needed for these 12: ' +
  '99352 Camtoyz Fouria $53.99 -> 30.5%; 98578 Syntra Bullet $21.99 -> 28.9%; ' +
  '99388 Shine On Glowing Pink $38.99 -> 29.5% (stock 12, watch); 99662 Minnie\'s Wink Aqua ' +
  '$37.99 -> 29.4%; 96768 Mini\'s Leopard Print $30.99 -> 29.2%; 76970 Prints Charming Buzzed ' +
  'Mini $25.99 -> 30.3%; 76963 Prints Charming Canna Queen $34.99 -> 31.2%; 76964 Prints ' +
  'Charming Bullet $34.99 -> 31.2%; 94262 Prowler RED Anal Plug $22.99 -> 29.5%; ' +
  '74849 Beat Rechargeable Bullet $30.99 -> 29.4%; 84141 ROMP Riot $26.99 -> 30.5%; ' +
  '93182 WINX Star Tickles $20.99 -> 28.8%.\n' +
  'EXCLUDED from #8023\'s original 21, margin-negative at 20% off against live price: ' +
  '93291 BANG! 7X ($13.99, wholesale $14.99, -33.9%), 96159 Blaze Dual Massager Kit ' +
  '($42.99, wholesale $35.85, -4.2%). EXCLUDED for thin stock (under 10 units): ' +
  '75956 Frenzy Power Bullet (1 unit), 81359 Happy Rabbit (5 units).'

// Real live suggestion #9322 (COUPLESCONTROL20), reproduced verbatim. Same
// refusal, same root cause, same fix. All 8 SKUs verified live 2026-09-22.
const COUPLESCONTROL20_BRIEF =
  'COUPLESCONTROL20 -- 20% off code, window 2026-10-05 to 2026-10-11, category sale on the ' +
  'couples remote/app-controlled category. ' +
  '8 SKUs survive MAP-clean (map_price=0.0) with positive post-discount margin, all ACTIVE, ' +
  'availableForSale and stock-healthy as of 2026-09-14: 97482 App-Controlled Lush Anal Butt ' +
  'Plug $124.99 -> 31.0% (stock 1450); 74252 Remote Control BANG! Bullet $30.99 -> 29.4% (91); ' +
  '98310 Remote Control Lay Panty Vibrator $70.99 -> 30.5% (171); 83219 Remote-Controlled ' +
  'Gossip Pop Rocker $57.99 -> 30.9% (37); 84140 Cello Remote G-Spot Egg $35.99 -> 30.5% (64); ' +
  '97905 The Beat Remote G-Spot $44.99 -> 30.4% (17); 97099 Love Language Couples Game ' +
  '$22.99 -> 10.3% (63, category-license invoked); 85192 Rose Petal Sexy Surprises Kit ' +
  '$7.99 -> 6.1% (158, category-license invoked). None negative.\n' +
  'EXCLUDED, off scope: everything MAP=MSRP and everything MAP<MSRP-at-floor where 20% off ' +
  'would price below MAP (80519, 93780, 97097, 97549, 97169, 93752). 93281 Rotating Nexus ' +
  'Tornado excluded on thin stock (6 units).'

describe('extractSkus', () => {
  it('reads SKU numbers from a labelled list and ignores counts and prices', () => {
    expect(extractSkus(LIVE_BRIEF_51)).toEqual(['84740', '84743', '84747', '84748'])
    // "SKUs (1503 MAP-locked ...)" is a count, not a scope: the paren breaks the label.
    expect(extractSkus('about 60% of SKUs (1503 MAP-locked) are floored')).toEqual([])
  })

  // Ticket #10737: 3 of the last 4 approved promo briefs refused
  // 'no-eligible-products' on exactly this shape.
  it('reads all 12 SKUs from the real BULLETWEEK20 margin-list brief (#9321)', () => {
    const skus = extractSkus(BULLETWEEK20_BRIEF)
    expect(skus).toEqual([
      '99352', '98578', '99388', '99662', '96768', '76970',
      '76963', '76964', '94262', '74849', '84141', '93182',
    ])
  })

  it('reads all 8 SKUs from the real COUPLESCONTROL20 margin-list brief (#9322)', () => {
    const skus = extractSkus(COUPLESCONTROL20_BRIEF)
    expect(skus).toEqual([
      '97482', '74252', '98310', '83219', '84140', '97905', '97099', '85192',
    ])
  })

  it('never picks up an EXCLUDED SKU, which never carries the "-> pct%" arrow', () => {
    const skus = extractSkus(BULLETWEEK20_BRIEF)
    for (const excluded of ['93291', '96159', '75956', '81359']) {
      expect(skus).not.toContain(excluded)
    }
    const couplesSkus = extractSkus(COUPLESCONTROL20_BRIEF)
    for (const excluded of ['80519', '93780', '97097', '93281']) {
      expect(couplesSkus).not.toContain(excluded)
    }
  })

  it('does not mistake a lead-in count or a nearby date for the SKU owning a later margin figure', () => {
    // "12" (the count) and "2026-09-14" (the confirmation date) both precede
    // the first real entry by a long stretch of prose; neither must be
    // captured as if it owned "99352 Camtoyz Fouria $53.99 -> 30.5%".
    const skus = extractSkus(BULLETWEEK20_BRIEF)
    expect(skus).not.toContain('2026')
    expect(skus).not.toContain('12')
    expect(skus[0]).toBe('99352')
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
    // Depth: 0% is a percentage-code candidate (matches the bare NN% check)
    // whose stated depth is out of the valid 1-99 range, so parsePromoBrief
    // still resolves percentage to null and this is a real 'no-depth' case,
    // not 'not-applicable' — a brief with literally zero percent anywhere
    // (the old fixture here) is the not-applicable case, tested below.
    const noDepth = 'Code: X10\nWindow: 2026-08-12 to 2026-08-19\nDepth: 0%'
    expect(decidePromo(parsePromoBrief(noDepth), noDepth).reason).toBe('no-depth')
  })

  // Ticket #9366 (split from #9319, defect C): a brief describing a
  // non-percentage mechanism (free-shipping threshold, bundle, loyalty perk)
  // has no bare NN% anywhere and can never pass this pipeline's later checks
  // meaningfully — it is the wrong mechanism, not a malformed percent brief.
  it('refuses a non-percentage mechanism as not-applicable, before any other check', () => {
    const freeShipping = 'Code: X10\nWindow: 2026-08-12 to 2026-08-19\nLower the free-shipping threshold from $99 to $59.'
    expect(decidePromo(parsePromoBrief(freeShipping), freeShipping)).toEqual({ ok: false, reason: 'not-applicable' })
    // Checked before the MAP-conflict check too: a non-percentage brief that
    // happens to mention "MAP violation" in passing is still not-applicable,
    // not map-conflict-flagged.
    const freeShippingWithMapWord = `${freeShipping}\nNote: unrelated MAP violation on a different SKU.`
    expect(decidePromo(parsePromoBrief(freeShippingWithMapWord), freeShippingWithMapWord).reason).toBe('not-applicable')
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

  // Ticket #9366 (split from #9319, defect C): a non-percentage mechanism
  // refuses silently — no owner email, since there is no percentage-code
  // defect for the owner to fix by re-reading the same brief every day.
  it('refuses a non-percentage-mechanism row silently, without emailing the owner', async () => {
    const deps = makeDeps()
    const freeShipping = 'Code: X10\nWindow: 2026-08-12 to 2026-08-19\nLower the free-shipping threshold from $99 to $59.'
    const res = await executeApprovedPromo({ id: 55, suggestion: freeShipping }, deps)
    expect(res.minted).toBe(false)
    expect(res.refused).toBe(true)
    expect(res.reason).toBe('not-applicable')
    expect(res.ownerEmailed).toBe(false)
    expect(deps.createDiscount).not.toHaveBeenCalled()
    expect(deps.sendOwnerEmail).not.toHaveBeenCalled()
    expect(deps.addNote).toHaveBeenCalledOnce()
    const [, noteRef] = (deps.addNote as any).mock.calls[0]
    expect(noteRef).toContain('REFUSED (not-applicable)')
  })

  it('refuses rather than minting a catalog-wide code when no product resolves', async () => {
    const deps = makeDeps({ resolveProductGids: vi.fn(async () => []) })
    const res = await executeApprovedPromo({ id: 52, suggestion: CLEAN_BRIEF }, deps)
    expect(res.refused).toBe(true)
    expect(res.reason).toBe('no-eligible-products')
    expect(deps.createDiscount).not.toHaveBeenCalled()
  })

  // Ticket #10737 regression: #9321 (BULLETWEEK20) and #9322 (COUPLESCONTROL20)
  // were refused 'no-eligible-products' — every one of their SKUs is a real,
  // live, resolvable product, but extractSkus's old labelled-list-only pattern
  // found nothing in this margin-list brief shape, so resolveProductGids was
  // asked to resolve zero SKUs and correctly (per its own contract) came back
  // empty. This asserts the SKUs actually reach resolveProductGids now.
  it('mints BULLETWEEK20 end to end, resolving all 12 real SKUs (#9321)', async () => {
    const deps = makeDeps()
    const res = await executeApprovedPromo({ id: 9321, suggestion: BULLETWEEK20_BRIEF }, deps)
    expect(res.minted).toBe(true)
    expect(res.code).toBe('BULLETWEEK20')
    const sel = (deps.resolveProductGids as any).mock.calls[0][0]
    expect(sel.skus).toEqual([
      '99352', '98578', '99388', '99662', '96768', '76970',
      '76963', '76964', '94262', '74849', '84141', '93182',
    ])
    expect(deps.createDiscount).toHaveBeenCalledOnce()
  })

  it('mints COUPLESCONTROL20 end to end, resolving all 8 real SKUs (#9322)', async () => {
    const deps = makeDeps()
    const res = await executeApprovedPromo({ id: 9322, suggestion: COUPLESCONTROL20_BRIEF }, deps)
    expect(res.minted).toBe(true)
    const sel = (deps.resolveProductGids as any).mock.calls[0][0]
    expect(sel.skus).toEqual([
      '97482', '74252', '98310', '83219', '84140', '97905', '97099', '85192',
    ])
    expect(deps.createDiscount).toHaveBeenCalledOnce()
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
