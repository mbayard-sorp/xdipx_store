/**
 * Route tests for `/start` (app/routes/_layout.start.tsx): interest
 * pre-selection, invalid-slug fallback, the remembered-pick cookie, and UTM
 * carry-through onto every tile link.
 *
 * Lives in app/lib rather than next to the route: anything under app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 */

import { describe, expect, it } from 'vitest'
import { loader } from '~/routes/_layout.start'
import { LEAD_INTERESTS, LEAD_OFFER } from '~/lib/lead-interests'
import { readInterestCookie } from '~/lib/start-page'

type LoaderResult = Awaited<ReturnType<typeof loader>>

async function run(query: string, cookie?: string): Promise<LoaderResult> {
  const request = new Request(`https://xdipx.com/start${query}`, {
    headers: cookie ? { Cookie: cookie } : {},
  })
  return loader({ request, params: {}, context: {} } as Parameters<typeof loader>[0])
}

function setCookie(result: LoaderResult): string | null {
  return new Headers(result.init?.headers).get('Set-Cookie')
}

describe('/start loader', () => {
  it('pre-selects a valid ?interest and remembers it in a 180-day cookie', async () => {
    const result = await run('?interest=wands')
    expect(result.data.picked).toBe('wands')
    expect(result.data.tiles).toHaveLength(LEAD_INTERESTS.length)

    const cookie = setCookie(result)
    expect(cookie).toContain('xdipx_interest=wands')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain(`Max-Age=${60 * 60 * 24 * 180}`)
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).not.toMatch(/HttpOnly/i)
  })

  it('falls back to no pick and sets no cookie for an invalid slug', async () => {
    const result = await run('?interest=not-a-real-slug')
    expect(result.data.picked).toBeNull()
    expect(result.data.tiles).toHaveLength(LEAD_INTERESTS.length)
    expect(setCookie(result)).toBeNull()
  })

  it('falls back to no pick with no interest at all', async () => {
    const result = await run('')
    expect(result.data.picked).toBeNull()
    expect(setCookie(result)).toBeNull()
  })

  it('uses the remembered cookie when the query has no valid interest', async () => {
    const result = await run('?interest=nope', 'other=1; xdipx_interest=for-two')
    expect(result.data.picked).toBe('for-two')
    expect(setCookie(result)).toBeNull()
  })

  it('prefers the query over the cookie', async () => {
    const result = await run('?interest=play', 'xdipx_interest=for-two')
    expect(result.data.picked).toBe('play')
  })

  it('carries utm_* params onto every tile link and the lead door, and drops the rest', async () => {
    const result = await run(
      '?interest=hands-free&utm_source=meta&utm_medium=paid_social&utm_campaign=curious_oct&utm_content=ad 7&gclid=x&foo=bar',
    )
    for (const tile of result.data.tiles) {
      const dest = LEAD_INTERESTS.find(i => i.slug === tile.slug)!.destination
      const url = new URL(tile.href, 'https://xdipx.com')
      expect(url.pathname).toBe(dest)
      expect(url.searchParams.get('utm_source')).toBe('meta')
      expect(url.searchParams.get('utm_medium')).toBe('paid_social')
      expect(url.searchParams.get('utm_campaign')).toBe('curious_oct')
      expect(url.searchParams.get('utm_content')).toBe('ad 7')
      expect(url.searchParams.has('foo')).toBe(false)
      expect(url.searchParams.has('interest')).toBe(false)
    }
    const lead = new URL(result.data.leadHref)
    expect(lead.origin + lead.pathname).toBe('https://curious.xdipx.com/hello')
    expect(lead.searchParams.get('utm_campaign')).toBe('curious_oct')
  })

  it('links tiles to the bare destination when there are no utm params', async () => {
    const result = await run('?interest=curious')
    expect(result.data.tiles.map(t => t.href)).toEqual(LEAD_INTERESTS.map(i => i.destination))
  })

  it('states the full CURIOUS15 terms', async () => {
    const result = await run('')
    expect(result.data.offer.terms).toBe(LEAD_OFFER.terms)
    expect(result.data.offer.terms).not.toMatch(/first order/i)
  })
})

describe('readInterestCookie', () => {
  it('ignores unknown slugs and missing headers', () => {
    expect(readInterestCookie(null)).toBeNull()
    expect(readInterestCookie('xdipx_interest=bogus')).toBeNull()
    expect(readInterestCookie('xdipx_interest=back-door')).toBe('back-door')
  })
})
