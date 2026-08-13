/**
 * `/social`, the single bio-link landing for IG / TikTok / YouTube.
 *
 * Rented-channel arrival surface (social-video strategy §4): age acknowledgment
 * first, chat with Emma above the fold ("my DMs" on social always means this
 * chat), one swappable featured product driven by the additive
 * `singleton.socialLanding` Sanity doc, an email capture tagged
 * source=social-landing, and quiet links out to /discover and the storefront.
 * Mobile-first at 375px; most arrivals are in-app browsers.
 *
 * The AskEmmaWidget itself is mounted once by _layout on every page; the hero
 * CTA opens it via the documented `xdipx:emma:openWith` event rather than
 * mounting a second fixed widget.
 */

import type { HeadersFunction, MetaFunction } from 'react-router'
import { Link, useFetcher, useLoaderData, useRouteLoaderData } from 'react-router'
import { useEffect, useState } from 'react'
import { AgeGatePanel, type VerificationLevel } from '~/components/store/AgeGate'
import { useAgeVerified } from '~/lib/use-age-verified'
import { Reveal } from '~/components/motion/Reveal'
import { getSocialLandingSettings, getEmmaHeroSettings } from '~/lib/sanity.server'
import { getDiscoveryIndex } from '~/lib/discovery.server'
import { getRecentSocialProductHandles } from '~/lib/social-landing.server'
import { withTimeout } from '~/lib/with-timeout.server'
import { buildSocialMeta } from '~/lib/social-meta'
import type { DiscoveryProduct } from '~/types/discovery'

const CANONICAL = 'https://xdipx.com/social'

// Swappable product grid fed from recent product-featuring social posts.
const RECENT_GRID_SIZE = 6
const RECENT_TIMEOUT_MS = 3000
// PDP links carry the source of the arrival: this bio-link is what the
// Instagram profile points at.
const RECENT_UTM = 'utm_source=instagram&utm_medium=social'
const TITLE = 'Start here | xdipx'
const DESCRIPTION =
  'You found us from a video. This is the quiet corner: chat with Emma, see what she is pointing people at, and stay close. Discreet shipping, billed as XDIPX.'

const SANITY_TIMEOUT_MS = 4000

export const headers: HeadersFunction = () => ({
  // Anonymous-safe page (the age gate is client-side); cache like the
  // storefront so in-app browsers get a fast edge hit.
  'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
  'Vercel-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900',
})

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: TITLE },
  { name: 'description', content: DESCRIPTION },
  { tagName: 'link', rel: 'canonical', href: CANONICAL },
  ...buildSocialMeta({
    title: TITLE,
    description: DESCRIPTION,
    url: CANONICAL,
    image: data?.product?.imageUrl ?? null,
  }),
]

// In-stock idiom shared with the discovery inventory floor: untracked
// inventory (null) always passes; a tracked count must be above zero. See
// app/lib/discovery-rules.server.ts.
function inStock(p: DiscoveryProduct): boolean {
  return p.totalInventory === null || p.totalInventory > 0
}

export async function loader() {
  // Swappable product module: singleton.socialLanding.featuredProductHandle
  // wins, falling back to the storefront hero pin
  // (singleton.emmaHeroStorefront.featuredProductHandle), then to no module.
  // Both Sanity legs are bounded and degrade to null so a slow leg can never
  // sink the landing. In parallel we pull the handles of products featured in
  // the last week of social posts to fill the grid below the pin.
  const [settings, emmaHero, recentHandles] = await Promise.all([
    withTimeout(getSocialLandingSettings(), SANITY_TIMEOUT_MS, null, 'getSocialLandingSettings(social)'),
    withTimeout(getEmmaHeroSettings(), SANITY_TIMEOUT_MS, null, 'getEmmaHeroSettings(social)'),
    withTimeout(
      getRecentSocialProductHandles(RECENT_GRID_SIZE),
      RECENT_TIMEOUT_MS,
      [] as string[],
      'getRecentSocialProductHandles(social)',
    ),
  ])

  const candidates = [
    settings?.featuredProductHandle?.trim(),
    emmaHero?.featuredProductHandle?.trim(),
  ].filter((h): h is string => !!h)

  // One index fetch resolves both the pinned module and the recent grid.
  const needIndex = candidates.length > 0 || recentHandles.length > 0
  const index = needIndex ? await getDiscoveryIndex().catch(() => [] as DiscoveryProduct[]) : []

  // The pinned feature is the highest-intent click a curious arrival makes, so
  // it must never point at an unavailable PDP. Require an in-stock match (same
  // idiom as the recent grid below); an out-of-stock pin falls through to the
  // next candidate, then hides the module rather than sending IG traffic to a
  // product they cannot buy.
  let product: DiscoveryProduct | null = null
  if (candidates.length > 0) {
    for (const handle of candidates) {
      const match = index.find(p => p.handle === handle)
      if (match && inStock(match)) {
        product = match
        break
      }
    }
    if (!product) {
      console.warn(
        `[social] no in-stock discovery match for handles ${candidates.join(', ')}, hiding product module`,
      )
    }
  }

  // Resolve recent handles against the index, keep in-stock only, and drop the
  // pinned product so it never appears twice. Order follows most-recent-posted.
  const recentProducts: DiscoveryProduct[] = []
  for (const handle of recentHandles) {
    if (handle === product?.handle) continue
    const match = index.find(p => p.handle === handle)
    if (match && inStock(match)) recentProducts.push(match)
  }

  return {
    heading: settings?.heading ?? null,
    emmaBlurb: settings?.emmaBlurb ?? null,
    product,
    recentProducts,
  }
}

function openEmmaChat() {
  window.dispatchEvent(new CustomEvent('xdipx:emma:openWith', { detail: {} }))
}

function formatPrice(product: DiscoveryProduct): string {
  const min = `$${product.price.toFixed(2).replace(/\.00$/, '')}`
  if (product.priceMax && product.priceMax > product.price) {
    return `${min}–$${product.priceMax.toFixed(2).replace(/\.00$/, '')}`
  }
  return min
}

// PDP link that carries the social arrival source so the visit attributes back
// to the bio link this page sits behind. Used by every PDP link on the page,
// the pinned feature and the recent grid alike, so IG->PDP is measured on the
// primary click, not only the secondary tiles.
function pdpHref(handle: string): string {
  return `/products/${handle}?${RECENT_UTM}`
}

export default function SocialLanding() {
  const { heading, emmaBlurb, product, recentProducts } = useLoaderData<typeof loader>()
  const { verified } = useAgeVerified()
  const rootData = useRouteLoaderData<{ ENV?: { AGE_GATE_LEVEL?: string } }>('root')
  const ageGateLevel = (rootData?.ENV?.AGE_GATE_LEVEL ?? 'click_through') as VerificationLevel

  return (
    <div className="bg-paper min-h-[70vh]">
      <div className="mx-auto w-full max-w-md px-4 py-8 sm:py-12 md:max-w-lg">
        {!verified ? (
          <div className="flex flex-col items-center gap-6">
            <AgeGatePanel verificationLevel={ageGateLevel} />
            <p className="text-center text-sm text-ink-3">
              Emma is on the other side. One tap and you are in.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            {/* Hero: chat with Emma, above the fold */}
            <section className="text-center">
              <p className="kicker mb-3">you found us</p>
              <h1
                className="text-3xl leading-tight text-ink sm:text-4xl"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 450 }}
              >
                So this is where the <em className="em">good</em> part happens.
              </h1>
              <p className="mx-auto mt-4 max-w-sm text-base leading-relaxed text-ink-3">
                I am Emma. When I say my DMs are open, this is what I mean. Ask me
                the thing you would not type into a search bar and I will find you
                something worth wanting.
              </p>
              <button
                type="button"
                onClick={openEmmaChat}
                className="mt-6 inline-flex items-center justify-center rounded-full bg-coral px-8 py-3.5 text-base font-semibold text-white transition-opacity hover:opacity-90 active:scale-95"
                style={{ fontFamily: 'var(--font-body)' }}
              >
                Show me
              </button>
              <p className="mt-2 text-xs text-ink-4">Opens the chat. She is online.</p>
            </section>

            {/* Swappable featured product, Sanity-driven, degrades to hidden */}
            {product && (
              <Reveal variant="up" as="section">
                <h2 className="kicker mb-3 text-center">
                  {heading ?? 'the one from the video'}
                </h2>
                <Link
                  to={pdpHref(product.handle)}
                  className="block overflow-hidden rounded-[22px] border border-line bg-paper-2 transition-shadow hover:shadow-md"
                >
                  {product.imageUrl && (
                    <img
                      src={product.imageUrl}
                      alt={product.imageAlt ?? product.title}
                      className="aspect-square w-full bg-paper-3 object-cover"
                      loading="lazy"
                      width={480}
                      height={480}
                    />
                  )}
                  <div className="p-5">
                    <h3
                      className="text-xl text-ink"
                      style={{ fontFamily: 'var(--font-display)', fontWeight: 450 }}
                    >
                      {product.title}
                    </h3>
                    <p className="mt-1 text-sm font-medium text-ink-3">{formatPrice(product)}</p>
                    {emmaBlurb && (
                      <p className="mt-3 text-sm leading-relaxed text-ink-3">{emmaBlurb}</p>
                    )}
                    <span className="link-coral mt-4 inline-block text-sm font-semibold">
                      Take a peek →
                    </span>
                  </div>
                </Link>
              </Reveal>
            )}

            {/* Swappable grid: products from the last week of social posts.
                Fed straight from social_posts, so it stays current without a
                manual sync; hidden entirely when nothing recent is in stock. */}
            {recentProducts.length > 0 && (
              <Reveal variant="up" as="section">
                <h2 className="kicker mb-4 text-center">lately on my feed</h2>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {recentProducts.map(p => (
                    <li key={p.handle}>
                      <Link
                        to={pdpHref(p.handle)}
                        className="group block overflow-hidden rounded-[18px] border border-line bg-paper-2 transition-shadow hover:shadow-md"
                      >
                        {p.imageUrl ? (
                          <img
                            src={p.imageUrl}
                            alt={p.imageAlt ?? p.title}
                            className="aspect-square w-full bg-paper-3 object-cover"
                            loading="lazy"
                            width={240}
                            height={240}
                          />
                        ) : (
                          <div className="aspect-square w-full bg-paper-3" />
                        )}
                        <div className="p-3">
                          <h3 className="line-clamp-2 text-sm leading-snug text-ink">{p.title}</h3>
                          <p className="mt-1 text-xs font-medium text-ink-3">{formatPrice(p)}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Reveal>
            )}

            {/* Email capture, source-tagged, no urgency */}
            <Reveal variant="up" as="section">
              <SocialEmailCapture />
            </Reveal>

            {/* Quiet links */}
            <Reveal variant="fade" as="section">
              <div className="flex flex-col items-center gap-3 border-t border-line pt-8 text-center">
                <Link to="/discover" className="link-coral text-sm font-semibold">
                  Find your fit →
                </Link>
                <p className="text-xs text-ink-4">
                  Three questions and I reshape the shelf around you.
                </p>
                <Link to="/" className="link-coral mt-2 text-sm font-semibold">
                  Take a peek →
                </Link>
                <p className="text-xs text-ink-4">Or wander the whole shelf.</p>
              </div>
            </Reveal>
          </div>
        )}
      </div>
    </div>
  )
}

function SocialEmailCapture() {
  const fetcher = useFetcher()
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const data = fetcher.data as { ok?: boolean; error?: string } | undefined
    if (!data) return
    if (data.ok) setSubmitted(true)
    if (data.error) setError(data.error)
  }, [fetcher.data])

  const isPending = fetcher.state !== 'idle'

  return (
    <div className="rounded-[22px] bg-coral-soft px-5 py-7 text-center sm:px-8">
      <h2
        className="text-2xl text-ink"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 450 }}
      >
        Stay close.
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-3">
        One email now and then. What is new on the shelf, what is worth it, written
        the way I talk. Nothing you would need to explain.
      </p>

      {submitted ? (
        <p
          className="mt-5 text-lg font-semibold text-sage"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          You are in. ♥
        </p>
      ) : (
        <>
          <fetcher.Form
            method="post"
            action="/api/waitlist"
            className="mx-auto mt-5 flex max-w-sm flex-col gap-3 sm:flex-row"
          >
            <input type="hidden" name="intent" value="subscribe" />
            <input type="hidden" name="source" value="social-landing" />
            <label htmlFor="social-email" className="sr-only">
              Email address
            </label>
            <input
              id="social-email"
              type="email"
              name="email"
              required
              placeholder="your@email.com"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'social-email-error' : undefined}
              className="flex-1 rounded-full border border-line bg-paper px-4 py-3 text-ink placeholder-ink-4 focus:outline-none focus:ring-2 focus:ring-coral/40"
              onChange={() => error && setError('')}
            />
            <button
              type="submit"
              disabled={isPending}
              className="whitespace-nowrap rounded-full bg-ink px-6 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              {isPending ? 'One sec…' : 'Keep me posted ♥'}
            </button>
          </fetcher.Form>
          {error && (
            <p id="social-email-error" role="alert" className="mt-2 text-xs text-red-500">
              {error}
            </p>
          )}
        </>
      )}
      <p className="mt-3 text-xs text-ink-4">Unsubscribe anytime. No hard feelings.</p>
    </div>
  )
}
