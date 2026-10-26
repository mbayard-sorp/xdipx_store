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

import { useState } from 'react'
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { data, redirect, useActionData, useLoaderData, useRouteError, useRouteLoaderData } from 'react-router'
import { Analytics } from '~/components/store/Analytics'
import { CookieConsent } from '~/components/store/CookieConsent'
import { BRIDGE_404, STOREFRONT_404, isBridgeError } from '~/lib/bridge-error'
import { plainHeadline, splitHeadline } from '~/lib/ad-bridge-copy'
import { buildBridgeDestination, getAdBridgePage, pickBridgePackshot } from '~/lib/ad-bridge.server'
import { getLaneSubset } from '~/lib/ad-lane-subset.server'
import { LeadFunnelView } from '~/components/funnel/LeadFunnelView'
import { AdventSalesView, type AdventShopifyData } from '~/components/funnel/AdventSalesView'
import {
  ADVENT_CALENDARS,
  ADVENT_DEFAULT,
  ADVENT_ORDER,
  adventByHandle,
  isAdventKey,
  isAdventSalesSlug,
  type AdventKey,
} from '~/lib/advent-sales-page'
import { applyAttributionAttrs } from '~/lib/attribution-cart.server'
import { getLeadFunnelPage, type FunnelUtm } from '~/lib/lead-funnel'
import { isLeadSmsOptinEnabled } from '~/lib/lead-sms-optin.server'
import { LEAD_OFFER } from '~/lib/lead-interests'
import { getStoredUTM } from '~/lib/attribution.server'
import { trackCtaClick } from '~/lib/analytics.client'
import { isBridgeHost, isBridgeHostRequest, requestHost, BRIDGE_HOST } from '~/lib/bridge-host.server'
import { sanityImageUrl } from '~/lib/sanity-image'
import { getSiteSettings, isPreviewRequest } from '~/lib/sanity.server'
import { createCartWithLines, getProductByHandle } from '~/lib/shopify.server'
import { shopifyImageUrl } from '~/lib/shopify-image'
import { useAgeVerified } from '~/lib/use-age-verified'

const IMG_SIZE = 750

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Host gate first: on xdipx.com (or anywhere else) this page does not exist.
  if (!isBridgeHostRequest(request)) throw data(STOREFRONT_404, { status: 404 })

  const slug = (params['slug'] ?? '').toLowerCase()

  // The paid-lead funnel's two-door pages live in code (app/lib/lead-funnel.ts).
  const funnel = getLeadFunnelPage(slug)
  if (funnel) {
    const url = new URL(request.url)
    const stored = getStoredUTM(request)
    const param = (k: string) => url.searchParams.get(`utm_${k}`)
    const utm: FunnelUtm = {
      source: param('source') ?? stored?.source ?? null,
      medium: param('medium') ?? stored?.medium ?? null,
      campaign: param('campaign') ?? stored?.campaign ?? null,
      content: param('content') ?? stored?.content ?? null,
    }
    const onHost = isBridgeHost(requestHost(request.headers))
    const origin = onHost ? `https://${BRIDGE_HOST}` : url.origin
    // Phone + SMS consent render only while an SMS sending path is enabled
    // (blocker 731); /api/lead applies the same switch server-side.
    const smsOptin = await isLeadSmsOptinEnabled()
    return {
      kind: 'funnel' as const,
      page: funnel,
      utm,
      terms: LEAD_OFFER.terms,
      smsOptin,
      canonical: `${origin}/${funnel.slug}`,
    }
  }

  if (isAdventSalesSlug(slug)) return adventLoaderData(request)

  const preview = isPreviewRequest(request)
  const page = await getAdBridgePage(slug, preview)
  if (!page || (!page.live && !preview)) throw data(BRIDGE_404, { status: 404 })

  // The lane subset supplies a display title with no category word, used as the
  // packshot's alt text. Failure is non-fatal.
  const [product, subset] = await Promise.all([
    getProductByHandle(page.productHandle).catch(() => null),
    getLaneSubset(page.lane, preview).catch(() => []),
  ])
  if (!product && !page.imageUrl) throw data(BRIDGE_404, { status: 404 })

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
    kind: 'bridge' as const,
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

/** Shopify data for the five calendars. A product that fails to load is left out, never faked. */
async function adventLoaderData(request: Request) {
  const url = new URL(request.url)
  const c = url.searchParams.get('c')
  const [results, settings] = await Promise.all([
    Promise.all(
      ADVENT_ORDER.map(async k => [k, await getProductByHandle(ADVENT_CALENDARS[k].handle).catch(() => null)] as const),
    ),
    // The store wordmark the navbar uses. Missing logo falls back to the text wordmark.
    getSiteSettings().catch(() => null),
  ])
  const products: Partial<Record<AdventKey, AdventShopifyData>> = {}
  for (const [k, product] of results) {
    if (!product) continue
    const variant = product.variants.find(v => v.availableForSale) ?? product.variants[0] ?? null
    products[k] = {
      handle: product.handle,
      productId: product.id,
      variantId: variant?.id ?? null,
      price: variant ? parseFloat(variant.price) : product.price,
      compareAtPrice: variant?.compareAtPrice ? parseFloat(variant.compareAtPrice) : (product.compareAtPrice ?? null),
      images: product.images.map(i => i.url),
      stock: product.totalInventory ?? null,
      available: product.variants.some(v => v.availableForSale),
    }
  }
  if (Object.keys(products).length === 0) throw data(BRIDGE_404, { status: 404 })
  const initial: AdventKey = isAdventKey(c) && products[c] ? c : products[ADVENT_DEFAULT] ? ADVENT_DEFAULT : (Object.keys(products)[0] as AdventKey)
  const onHost = isBridgeHost(requestHost(request.headers))
  const origin = onHost ? `https://${BRIDGE_HOST}` : url.origin
  return {
    kind: 'advent' as const,
    initial,
    products,
    nowMs: Date.now(),
    logo: settings?.logoUrl ? { src: settings.logoUrl, alt: settings.logoAlt || 'xdipx' } : null,
    canonical: `${origin}/advents26`,
  }
}

/**
 * The advent page's buy buttons post here. Build a one-line cart for the
 * calendar, stamp attribution, and send the visitor straight to Shopify
 * checkout. Only the five calendar handles are accepted.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (!isBridgeHostRequest(request)) throw data(STOREFRONT_404, { status: 404 })
  if (!isAdventSalesSlug(params['slug'] ?? '')) throw data(BRIDGE_404, { status: 404 })

  const form = await request.formData()
  const cal = adventByHandle(String(form.get('handle') ?? ''))
  if (!cal) return { error: 'That calendar is not on this page. Pick one below.' }

  try {
    const product = await getProductByHandle(cal.handle)
    const variant = product?.variants.find(v => v.availableForSale)
    if (!variant) return { error: `The ${cal.short} calendar just sold out. Another one below might fit.` }
    const cart = await createCartWithLines([{ variantId: variant.id, quantity: 1 }])
    await applyAttributionAttrs(cart.id, request, [{ key: '_landing', value: 'curious/advents26' }])
    return redirect(cart.checkoutUrl)
  } catch (err) {
    console.error('[advents26] checkout failed', cal.handle, err)
    return { error: 'Checkout did not open on our side. Give it another tap.' }
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: 'Not found' }, { name: 'robots', content: 'noindex' }]
  if (data.kind === 'advent') {
    return [
      { title: 'Advent calendars 2026 | xdipx' },
      { name: 'description', content: 'The 2026 Lovehoney, Womanizer, We-Vibe and Arcwave advent calendars. Ships discreet, billed as XDIPX.' },
      { name: 'robots', content: 'noindex' },
      { tagName: 'link', rel: 'canonical', href: data.canonical },
    ]
  }
  if (data.kind === 'funnel') {
    return [
      { title: `${plainHeadline(data.page.headline)} | xdipx` },
      { name: 'description', content: data.page.intro },
      { name: 'robots', content: 'noindex' },
      { tagName: 'link', rel: 'canonical', href: data.canonical },
    ]
  }
  return [
    { title: `${plainHeadline(data.headline)} | xdipx` },
    { name: 'description', content: data.claim },
    // A paid lander should not compete with the PDP in search.
    { name: 'robots', content: 'noindex' },
    // Canonical points at itself on the bridge host (ads-policy M1).
    { tagName: 'link', rel: 'canonical', href: data.canonical },
  ]
}

/**
 * Funnel-native error view for the bridge host (ticket #16146, ads-policy M1):
 * the bridge host never serves a xdipx.com page. A storefront 404 (loader marks
 * it `bridge: false`) is re-thrown so the root boundary renders it as before.
 */
export function ErrorBoundary() {
  const error = useRouteError()
  if (!isBridgeError(error)) throw error
  return (
    <main data-bridge-error className="flex min-h-[100svh] items-center justify-center bg-paper px-4 text-ink">
      <div className="w-full max-w-sm text-center">
        <p className="kicker text-ink-3">xdipx</p>
        <h1 className="mt-2 font-display text-[2rem] leading-[1.08] text-ink">Something went wrong on our side</h1>
        <p className="mt-3 font-body text-base leading-relaxed text-ink-2">
          The page is still here. Give it another go.
        </p>
        <a
          href="/hello"
          className="mt-5 flex min-h-[52px] w-full items-center justify-center rounded-full bg-coral px-6 font-body text-base font-semibold text-white"
        >
          Show me
        </a>
      </div>
    </main>
  )
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

type LoaderData = Awaited<ReturnType<typeof loader>>
type BridgeData = Extract<LoaderData, { kind: 'bridge' }>

export default function BridgeRoute() {
  const d = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()

  // The Meta PageView (browser pixel plus its CAPI copy) comes from
  // MetaPageViews in root.tsx, which covers this host too.

  const rootData = useRouteLoaderData('root') as { ENV?: { GA4_ID?: string } } | undefined
  const ga4Id = rootData?.ENV?.GA4_ID ?? ''

  return (
    <main className="min-h-[100svh] bg-paper text-ink">
      {/* The advent sales page runs without the age gate (owner direction 2026-10-26). */}
      {d.kind !== 'advent' ? (
        <>
          <style dangerouslySetInnerHTML={{ __html: GATE_CSS }} />
          <script dangerouslySetInnerHTML={{ __html: AGE_PRECHECK }} />
        </>
      ) : null}
      {d.kind === 'funnel' ? (
        <LeadFunnelView page={d.page} utm={d.utm} terms={d.terms} smsOptin={d.smsOptin} />
      ) : d.kind === 'advent' ? (
        <AdventSalesView d={{ initial: d.initial, products: d.products, nowMs: d.nowMs, logo: d.logo, error: actionData?.error ?? null }} />
      ) : (
        <BridgeView d={d} />
      )}
      {d.kind !== 'advent' ? <AgeGate /> : null}
      <CookieConsent />
      <Analytics ga4Id={ga4Id} />
    </main>
  )
}

function BridgeView({ d }: { d: BridgeData }) {
  const { before, em, after } = splitHeadline(d.headline)
  return (
    <>

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
    </>
  )
}
