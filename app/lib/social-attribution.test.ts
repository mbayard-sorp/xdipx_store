/**
 * Attribution-coverage guard for the /social bio-link surface (ticket #2815).
 *
 * /social is the one merchandising surface that carries UTM-tagged PDP links: it
 * is the front door Instagram/TikTok/YouTube arrivals land on, so every product
 * click has to attribute back to that arrival. The attribution lives in a
 * per-link helper, `pdpHref(handle)`, which appends the social UTM.
 *
 * The bug this guards against (run #282): a surface introduces the UTM helper
 * for the newest module (the recent-post grid) while a pre-existing, MORE
 * prominent link on the same page (the pinned feature — the highest-intent
 * click) keeps a bare `/products/...` link and silently loses its attribution.
 * That is invisible to typecheck and to the eye; only a coverage check catches
 * it. This test is that check, run on every PR by CI instead of by hand in the
 * review pass: it fails if any `/products/` link on the surface bypasses the
 * helper, and asserts the pinned/hero link specifically is covered.
 *
 * A source-level assertion (not a render test) so it stays cheap and needs no
 * route/DOM harness; it reads the route module the same way the manual grep the
 * ticket describes would.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const SOCIAL_ROUTE = fileURLToPath(new URL('../routes/_layout.social.tsx', import.meta.url))
const src = readFileSync(SOCIAL_ROUTE, 'utf8')

describe('/social PDP-link attribution coverage (ticket #2815)', () => {
  it('routes every /products/ link through the pdpHref UTM helper, with none left bare', () => {
    // A bare product link literal is `to={`/products/...`}` or the href form.
    // Every product link on this surface must instead be `to={pdpHref(...)}`.
    const bareProductLink = /(?:to|href)=\{`\/products\//g
    const bare = src.match(bareProductLink) ?? []
    expect(
      bare,
      'a /products/ link on /social bypasses pdpHref and loses its social UTM (ticket #2815)',
    ).toEqual([])

    // And the helper is actually the thing wiring the links.
    expect(src).toMatch(/to=\{pdpHref\(/)
  })

  it('covers the pinned/hero feature link specifically, the highest-intent click', () => {
    // The pinned feature (`product`) is the click most likely to predate the
    // helper and least likely to be re-checked; it is the one that regressed.
    expect(src).toMatch(/to=\{pdpHref\(product\.handle\)\}/)
  })

  it('makes pdpHref attach real UTM attribution, not just a bare path', () => {
    // The helper's body must reference the arrival-source query, so it returns a
    // UTM-tagged path rather than a bare /products/ one.
    expect(src).toMatch(/function pdpHref\([\s\S]*?RECENT_UTM/)
    // And that query carries a real source + medium, not an empty tag.
    expect(src).toMatch(/RECENT_UTM\s*=\s*'utm_source=[^']*utm_medium=/)
  })
})
