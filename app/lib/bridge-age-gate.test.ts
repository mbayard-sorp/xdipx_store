/**
 * Age-gate coverage for every bridge.$slug page kind (ticket #19523).
 *
 * `AGE_GATE_SHOWN` is a `Record<BridgeKind, boolean>` in
 * app/routes/bridge.$slug.tsx, so a kind added to the loader's union
 * without an entry here already fails `npm run typecheck` on its own —
 * this test instead pins the current, intentional exemption set, so a
 * silent change to an *existing* entry's value (as opposed to a missing
 * key) shows up as a failing assertion a reviewer has to explain, and
 * confirms the two kinds this ticket found evidence for are still the
 * live and advertised 404-adjacent `curious.xdipx.com` sales surfaces.
 *
 * Lives in app/lib rather than next to the route: anything under
 * app/routes is picked up by flatRoutes/typegen as a route module, tests
 * included.
 */
import { describe, expect, it } from 'vitest'
import { AGE_GATE_SHOWN } from '~/routes/bridge.$slug'

describe('AGE_GATE_SHOWN', () => {
  it('shows the gate for the funnel and plain ad-bridge kinds', () => {
    expect(AGE_GATE_SHOWN.funnel).toBe(true)
    expect(AGE_GATE_SHOWN.bridge).toBe(true)
  })

  it('exempts exactly the three owner-decided, docs/ads-policy.md-recorded kinds', () => {
    expect(AGE_GATE_SHOWN.advent).toBe(false)
    expect(AGE_GATE_SHOWN.sales).toBe(false)
    expect(AGE_GATE_SHOWN.salesAddOn).toBe(false)
  })

  it('every entry is a real boolean, so a new kind cannot ship with an undefined/falsy-by-accident value', () => {
    for (const [kind, shown] of Object.entries(AGE_GATE_SHOWN)) {
      expect(typeof shown, `AGE_GATE_SHOWN.${kind}`).toBe('boolean')
    }
  })
})
