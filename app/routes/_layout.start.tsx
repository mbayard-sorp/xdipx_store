/**
 * `/start`: the "just looking" door of the paid-lead funnel (owner decision
 * 2026-10-18). Meta ad -> curious.xdipx.com/hello -> Door B lands here with
 * `?interest=<slug>`. The matching tile is picked at the top, all seven stay
 * on the page, and every tile link carries the incoming utm_* params so paid
 * attribution survives the hop to the collection.
 *
 * The pick is remembered in the `xdipx_interest` cookie: the loader sets it
 * when `?interest=` is valid, and a tile click sets it client-side.
 *
 * Paid landing page, so noindex. Interests come from `~/lib/lead-interests`,
 * owned by the lead funnel; never hardcode a slug here.
 */

import type { HeadersFunction, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { data, Link, useLoaderData } from 'react-router'
import { LEAD_INTERESTS, LEAD_OFFER, getLeadInterest, type LeadInterestSlug } from '~/lib/lead-interests'
import {
  INTEREST_COOKIE,
  INTEREST_COOKIE_MAX_AGE,
  LEAD_DOOR_URL,
  carriedParams,
  interestCookieHeader,
  readInterestCookie,
  withCarriedParams,
} from '~/lib/start-page'
import { canonicalUrl, pageTitle, robotsContent } from '~/lib/seo'
import { Reveal } from '~/components/motion/Reveal'
import { trackSelectPromotion } from '~/lib/analytics.client'

/** One line per interest. Copy lives here, not in lead-interests.ts, because only this page shows it. */
const TILE_LINES: Record<LeadInterestSlug, string> = {
  curious: 'Gentle first toys that make saying yes easy.',
  'hands-free': 'Suction and air pulse that do the work while you lie back.',
  wands: 'Deep, rumbly power for anywhere you press it.',
  'for-two': 'Toys you wear together, or hand over the controls.',
  'back-door': 'Tapered, flared-base toys for taking it slow.',
  'for-him': 'Strokers and rings shaped for his body.',
  play: 'Dice, cards and games that turn a night in into foreplay.',
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const fromQuery = getLeadInterest(url.searchParams.get('interest'))
  const picked = fromQuery?.slug ?? readInterestCookie(request.headers.get('Cookie'))
  const carried = carriedParams(url.searchParams)

  const tiles = LEAD_INTERESTS.map(i => ({
    slug: i.slug,
    label: i.label,
    line: TILE_LINES[i.slug],
    href: withCarriedParams(i.destination, carried),
  }))

  return data(
    {
      picked,
      tiles,
      leadHref: withCarriedParams(LEAD_DOOR_URL, carried),
      offer: { percentOff: LEAD_OFFER.percentOff, terms: LEAD_OFFER.terms },
    },
    fromQuery ? { headers: { 'Set-Cookie': interestCookieHeader(fromQuery.slug) } } : undefined,
  )
}

export const headers: HeadersFunction = () => ({
  // Personalized by query and cookie, and may set a cookie: never share a cached copy.
  'Cache-Control': 'private, no-store',
})

export const meta: MetaFunction = () => [
  { title: pageTitle(['Start here']) },
  {
    name: 'description',
    content: 'Pick what you came for and go straight to the shelf Emma keeps for it. Discreet shipping, and your statement reads XDIPX.',
  },
  { name: 'robots', content: robotsContent({ index: false, follow: true }) },
  { tagName: 'link', rel: 'canonical', href: canonicalUrl({ path: '/start' }) },
]

function rememberPick(slug: LeadInterestSlug) {
  document.cookie = `${INTEREST_COOKIE}=${slug}; path=/; max-age=${INTEREST_COOKIE_MAX_AGE}; samesite=lax`
  trackSelectPromotion({
    promotionId: `start_${slug}`,
    promotionName: 'start_interest',
    creativeSlot: slug,
    locationId: 'start',
  })
}

interface Tile {
  slug: LeadInterestSlug
  label: string
  line: string
  href: string
}

function PickedTile({ tile }: { tile: Tile }) {
  return (
    <Link
      to={tile.href}
      onClick={() => rememberPick(tile.slug)}
      data-interest={tile.slug}
      data-picked="true"
      className="group block rounded-[var(--radius-lg)] bg-plum-soft p-6 ring-2 ring-plum transition-colors duration-[var(--duration-base)] hover:bg-plum-soft/70 sm:p-8"
    >
      <span className="kicker !text-plum">Picked for you</span>
      <span className="mt-3 block font-display text-3xl leading-tight text-ink sm:text-4xl">{tile.label}</span>
      <span className="mt-2 block text-base text-ink-2">{tile.line}</span>
      <span className="mt-5 inline-flex items-center rounded-full bg-coral px-5 py-2.5 text-sm font-medium text-paper transition-colors group-hover:bg-plum">
        Show me
      </span>
    </Link>
  )
}

function InterestTile({ tile }: { tile: Tile }) {
  return (
    <Link
      to={tile.href}
      onClick={() => rememberPick(tile.slug)}
      data-interest={tile.slug}
      className="group flex h-full flex-col rounded-[var(--radius)] border border-line bg-paper p-5 transition-colors duration-[var(--duration-base)] hover:border-plum hover:bg-paper-2"
    >
      <span className="font-display text-xl leading-snug text-ink">{tile.label}</span>
      <span className="mt-1.5 block flex-1 text-sm text-ink-3">{tile.line}</span>
      <span className="mt-4 text-sm font-medium text-coral group-hover:text-plum">Take a peek →</span>
    </Link>
  )
}

export default function StartPage() {
  const { picked, tiles, leadHref, offer } = useLoaderData<typeof loader>()
  const pickedTile = picked ? tiles.find(t => t.slug === picked) : undefined
  const rest = pickedTile ? tiles.filter(t => t.slug !== pickedTile.slug) : tiles

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
      <Reveal disabled>
        <p className="kicker">Start here</p>
        <h1 className="mt-3 font-display text-4xl leading-[1.08] text-ink sm:text-5xl">
          What are you <em className="em">curious</em> about?
        </h1>
        <p className="mt-3 max-w-xl text-base text-ink-3 sm:text-lg">
          Tap the one you came for. Each opens a shelf Emma stocks for exactly that, so you get straight to the good part.
        </p>
      </Reveal>

      {pickedTile && (
        <Reveal disabled delay={0.08} className="mt-8">
          <PickedTile tile={pickedTile} />
        </Reveal>
      )}

      <section aria-label="Browse by interest" className="mt-10">
        {pickedTile && <p className="kicker mb-4">Or try another</p>}
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((tile, index) => (
            <Reveal as="li" key={tile.slug} index={index}>
              <InterestTile tile={tile} />
            </Reveal>
          ))}
        </ul>
      </section>

      <Reveal variant="fade" className="mt-12">
        <aside className="rounded-[var(--radius)] bg-coral-soft px-5 py-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:px-6">
          <div>
            <p className="kicker !text-ink-2">A small welcome</p>
            <p className="mt-1.5 text-base text-ink">
              Leave your email and we'll send you a code for {offer.percentOff}% off.
            </p>
            <p className="mt-1 text-xs text-ink-3">{offer.terms}</p>
          </div>
          <a href={leadHref} className="link-coral mt-4 inline-block text-sm font-medium text-ink sm:mt-0 sm:shrink-0">
            Show me
          </a>
        </aside>
      </Reveal>

      <p className="mt-8 text-center text-xs text-ink-3">
        Plain box, plain label. Your statement reads XDIPX.
      </p>
    </div>
  )
}
