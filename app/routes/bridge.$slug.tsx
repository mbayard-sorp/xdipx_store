/**
 * Paid-lane bridge page (Ad Studio v2 PR-D). Served at
 * https://curious.xdipx.com/<slug> and, for previews, /bridge/<slug>?bridgeHost=1.
 *
 * One screen: a photograph, one headline, one claim, one button to the PDP on
 * the main host. Same page for every visitor, no cloaking, no redirect, no
 * shortener (docs/ads-policy.md M1). This route lives outside `_layout`, so it
 * has no store nav, footer or trust bar. It is host-gated: on any other host
 * it is a plain 404, which means adding `curious.xdipx.com` to the Vercel
 * project is what makes it live (docs/store-team/ad-bridge-host.md).
 *
 * `app/routes/$slug.tsx` re-exports this module so the same page answers at the
 * host root path `/<slug>` and the client router matches the URL it hydrates.
 */

import { useEffect, useState } from 'react'
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useRouteLoaderData } from 'react-router'
import { Analytics } from '~/components/store/Analytics'
import { CookieConsent } from '~/components/store/CookieConsent'
import { plainHeadline, splitHeadline } from '~/lib/ad-bridge-copy'
import { buildBridgeDestination, getAdBridgePage, pickBridgePackshot } from '~/lib/ad-bridge.server'
import { getLaneSubset } from '~/lib/ad-lane-subset.server'
import { trackCtaClick } from '~/lib/analytics.client'
import { isBridgeHost, isBridgeHostRequest, requestHost, BRIDGE_HOST } from '~/lib/bridge-host.server'
import { trackFbPageView } from '~/lib/meta-pixel.client'
import { sanityImageUrl } from '~/lib/sanity-image'
import { isPreviewRequest } from '~/lib/sanity.server'
import { getProductByHandle } from '~/lib/shopify.server'
import { shopifyImageUrl } from '~/lib/shopify-image'
import { useAgeVerified } from '~/lib/use-age-verified'

const IMG_SIZE = 750

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Host gate first: on xdipx.com (or anywhere else) this page does not exist.
  if (!isBridgeHostRequest(request)) throw new Response('Not found', { status: 404 })

  const slug = (params['slug'] ?? '').toLowerCase()
  const preview = isPreviewRequest(request)
  const page = await getAdBridgePage(slug, preview)
  if (!page || (!page.live && !preview)) throw new Response('Not found', { status: 404 })

  // The lane subset supplies a display title with no category word, used as the
  // packshot's alt text. Failure is non-fatal.
  const [product, subset] = await Promise.all([
    getProductByHandle(page.productHandle).catch(() => null),
    getLaneSubset(page.lane, preview).catch(() => []),
  ])
  if (!product && !page.imageUrl) throw new Response('Not found', { status: 404 })

  const displayTitle = subset.find(e => e.productHandle === page.productHandle)?.displayTitle ?? ''

  // The photograph, or the product's position-0 Shopify image on coral-soft
  // (the clean sibling when position 0 is a retail packaging shot).
  const hasPhoto = !!page.imageUrl
  const rawUrl = page.imageUrl ?? (product ? pickBridgePackshot(product.images) : null)
  const image = rawUrl
    ? {
        src: hasPhoto ? sanityImageUrl(rawUrl, { w: IMG_SIZE, h: IMG_SIZE, fit: 'crop' }) : shopifyImageUrl(rawUrl, IMG_SIZE),
        alt: hasPhoto ? page.imageAlt : displayTitle || page.imageAlt || '',
        isPackshot: !hasPhoto,
      }
    : null

  const host = requestHost(request.headers)
  const onBridgeHost = isBridgeHost(host)
  const origin = onBridgeHost ? `https://${BRIDGE_HOST}` : new URL(request.url).origin

  return {
    slug: page.slug,
    headline: page.headline,
    claim: page.claim,
    buttonLabel: page.buttonLabel,
    healthFraming: page.healthFraming,
    destination: buildBridgeDestination(page),
    canonical: `${origin}/${page.slug}`,
    image,
    preview,
    live: page.live,
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: 'Not found' }, { name: 'robots', content: 'noindex' }]
  return [
    { title: `${plainHeadline(data.headline)} | xdipx` },
    { name: 'description', content: data.claim },
    // A paid lander should not compete with the PDP in search.
    { name: 'robots', content: 'noindex' },
    // Canonical points at itself on the bridge host (ads-policy M1).
    { tagName: 'link', rel: 'canonical', href: data.canonical },
  ]
}

export function headers() {
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    'X-Robots-Tag': 'noindex',
  }
}

// Pre-hydration age check. Same localStorage key and 30-day window as
// app/lib/use-age-verified.ts, run inline so a verified visitor never sees the
// gate flash and an unverified one sees it from the first paint.
const AGE_PRECHECK = `try{var r=localStorage.getItem('xdipx_age_verified');if(r){var d=JSON.parse(r);if(d&&d.verified&&Date.now()-d.timestamp<2592000000)document.documentElement.setAttribute('data-age-ok','1')}}catch(e){}`

const GATE_CSS = `html[data-age-ok] [data-age-gate]{display:none}`

function AgeGate() {
  const { verified, confirm } = useAgeVerified()
  const [declined, setDeclined] = useState(false)
  if (verified) return null
  return (
    <div
      data-age-gate
      role="dialog"
      aria-modal="true"
      aria-labelledby="bridge-age-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink px-4"
    >
      <div className="w-full max-w-sm rounded-[var(--radius-lg)] bg-paper p-6 text-center">
        <p className="kicker mb-3 text-ink-3">xdipx</p>
        {declined ? (
          <p id="bridge-age-title" role="status" className="font-display text-xl leading-snug text-ink">
            This page is for adults, so we will keep it closed for now.
          </p>
        ) : (
          <>
            <h2 id="bridge-age-title" className="font-display text-2xl leading-snug text-ink">
              This page is for adults. Are you 18 or older?
            </h2>
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={confirm}
                className="min-h-12 rounded-full bg-ink px-6 font-body text-base font-semibold text-paper"
              >
                Yes, I am 18 or older
              </button>
              <button
                type="button"
                onClick={() => setDeclined(true)}
                className="min-h-12 rounded-full border border-ink/20 px-6 font-body text-base font-semibold text-ink"
              >
                Not yet
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function BridgePage() {
  const d = useLoaderData<typeof loader>()
  const { before, em, after } = splitHeadline(d.headline)

  useEffect(() => {
    trackFbPageView()
  }, [])

  const rootData = useRouteLoaderData('root') as { ENV?: { GA4_ID?: string } } | undefined
  const ga4Id = rootData?.ENV?.GA4_ID ?? ''

  return (
    <main className="min-h-[100svh] bg-paper text-ink">
      <style dangerouslySetInnerHTML={{ __html: GATE_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: AGE_PRECHECK }} />

      {d.preview && !d.live && (
        <p className="bg-plum-soft px-4 py-2 text-center font-body text-xs text-plum-2">
          Preview. This page is not live, so visitors see a 404.
        </p>
      )}

      <div className="mx-auto flex min-h-[100svh] w-full max-w-md flex-col px-4 pb-6 pt-4 md:max-w-5xl md:flex-row md:items-center md:gap-12 md:px-8">
        <div className="md:w-1/2">
          {d.image ? (
            <div
              className={
                'mx-auto aspect-square w-full max-h-[36svh] overflow-hidden rounded-[var(--radius-lg)] md:max-h-none ' +
                (d.image.isPackshot ? 'bg-coral-soft' : 'bg-paper-3')
              }
            >
              {/* The LCP element: eager, high priority, explicit size, never in Reveal. */}
              <img
                src={d.image.src}
                alt={d.image.alt}
                width={IMG_SIZE}
                height={IMG_SIZE}
                loading="eager"
                fetchPriority="high"
                decoding="async"
                className={
                  'h-full w-full ' + (d.image.isPackshot ? 'object-contain p-4 mix-blend-multiply' : 'object-cover')
                }
              />
            </div>
          ) : null}
        </div>

        <div className="mt-5 md:mt-0 md:w-1/2">
          <p className="kicker text-ink-3">xdipx</p>
          <h1 className="mt-2 font-display text-[2rem] leading-[1.08] text-ink md:text-5xl">
            {before}
            {em ? <em className="em">{em}</em> : null}
            {after}
          </h1>
          <p className="mt-3 font-body text-base leading-relaxed text-ink-2">{d.claim}</p>
          {d.healthFraming ? (
            <p className="mt-2 font-body text-sm text-ink-3">
              This is a personal wellness product, not a medical device.
            </p>
          ) : null}
          <a
            href={d.destination}
            data-bridge-cta
            onClick={() => trackCtaClick('bridge_cta', d.slug)}
            className="mt-5 flex min-h-[52px] w-full md:inline-flex items-center justify-center rounded-full bg-coral px-6 font-body text-base font-semibold text-white md:w-auto md:min-w-64"
          >
            {d.buttonLabel}
          </a>
          <p className="mt-4 font-body text-xs text-ink-4">For adults, 18 and over. Billing reads XDIPX.</p>
        </div>
      </div>

      <AgeGate />
      <CookieConsent />
      <Analytics ga4Id={ga4Id} />
    </main>
  )
}
