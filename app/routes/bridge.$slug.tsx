/**
 * Paid-lane bridge page (Ad Studio v2 PR-D). Served at
 * https://curious.xdipx.com/<slug> and, for previews, /bridge/<slug>?bridgeHost=1.
 *
 * Four page kinds share the slug space: the lead funnel's two-door pages and
 * the advents26 sales page (both defined in code), long-form `salesPage`
 * documents for adult ad networks (Sanity, app/lib/sales-page.ts), and the
 * one-screen `adBridgePage`: a photograph, one headline, one claim, one
 * button to the PDP on the main host. Same page for every visitor, no cloaking, no redirect, no
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
import { SalesPageView, type SalesShopifyData } from '~/components/funnel/SalesPageView'
import { SalesAddOnView } from '~/components/funnel/SalesAddOnView'
import { GawkSalesView } from '~/components/funnel/GawkSalesView'
import { GAWK_SALES_SLUG, GAWK_UPGRADE_HANDLES } from '~/lib/gawk-sales-page'
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
import { mapAllowsDiscountDisplay } from '~/lib/discount-badge'
import { addOnHandles, nextAddOnStep, parseAddOnStep, salesCtaAttr, type SalesPage } from '~/lib/sales-page'
import { claimedExitCode, getExitOffer } from '~/lib/exit-offer.server'
import { getSalesCartId, getSalesPage, setSalesCartCookie } from '~/lib/sales-page.server'
import type { Product } from '~/types'
import { isLeadSmsOptinEnabled } from '~/lib/lead-sms-optin.server'
import { LEAD_OFFER } from '~/lib/lead-interests'
import { getStoredUTM } from '~/lib/attribution.server'
import { trackCtaClick } from '~/lib/analytics.client'
import { isBridgeHost, isBridgeHostRequest, requestHost, BRIDGE_HOST } from '~/lib/bridge-host.server'
import { sanityImageUrl } from '~/lib/sanity-image'
import { getSiteSettings, isPreviewRequest } from '~/lib/sanity.server'
import { addCartDiscountCode, addLinesToCart, createCartWithLines, getCart, getProductByHandle } from '~/lib/shopify.server'
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
  const [page, sales] = await Promise.all([getAdBridgePage(slug, preview), getSalesPage(slug, preview)])
  if (!page && sales && (sales.live || preview)) return salesLoaderData(request, sales, preview)
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
    query: (() => {
      const q = new URLSearchParams(url.search)
      q.delete('c')
      return q.toString()
    })(),
    logo: settings?.logoUrl ? { src: settings.logoUrl, alt: settings.logoAlt || 'xdipx' } : null,
    canonical: `${origin}/advents26`,
  }
}

/** The view's shape for one Shopify product (the page's product or an add-on). */
function salesShopData(product: Product): SalesShopifyData {
  return {
    productId: product.id,
    title: product.title,
    brand: product.brand ?? '',
    variants: product.variants.map(v => ({
      id: v.id,
      title: v.title,
      price: parseFloat(v.price),
      compareAtPrice: v.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
      available: v.availableForSale,
    })),
    images: product.images.map(i => ({ url: i.url, alt: i.altText ?? '' })),
    stock: product.totalInventory ?? null,
    // Same MAP gate as the discovery cards: a MAP at or above compare-at hides the struck price.
    showCompareAt: mapAllowsDiscountDisplay(product.mapPrice, product.compareAtPrice),
  }
}

/**
 * Each add-on's products, in display order: one, or its good, better, best
 * tiers. A product that fails to load is null and gets skipped.
 */
function loadAddOns(page: SalesPage): Promise<(Product | null)[][]> {
  return Promise.all(
    page.addOns.map(a => Promise.all(addOnHandles(a).map(h => getProductByHandle(h).catch(() => null)))),
  )
}

const buyable = (p: Product | null): p is Product => !!p && p.variants.some(v => v.availableForSale)
const screenBuyable = (products: (Product | null)[]) => products.some(buyable)

/** Add-on screens depend on the visitor's cart, so the CDN must never keep them. */
const NO_STORE = { 'Cache-Control': 'private, no-store' }

/** This page's URL with `addon=<step>`, keeping UTMs and the dev host override. */
function addOnStepUrl(request: Request, step: number): string {
  const url = new URL(request.url)
  url.searchParams.set('addon', String(step))
  return `${url.pathname}${url.search}`
}

function pageUrl(request: Request): string {
  const url = new URL(request.url)
  url.searchParams.delete('addon')
  return `${url.pathname}${url.search}`
}

/**
 * The products a page's buy buttons may sell besides its own. Only the Gawk page
 * has any: the other Male Roses it steps up to. A product that fails to load is
 * null and gets skipped.
 */
function loadUpgrades(page: SalesPage): Promise<(Product | null)[]> {
  if (page.slug !== GAWK_SALES_SLUG) return Promise.resolve([])
  return Promise.all(GAWK_UPGRADE_HANDLES.map(h => getProductByHandle(h).catch(() => null)))
}

/** Shopify data for a sales page's one product. A product that fails to load is a 404, never faked. */
async function salesLoaderData(request: Request, page: SalesPage, preview: boolean) {
  const step = parseAddOnStep(new URL(request.url).searchParams.get('addon'), page.addOns.length)
  if (step !== null) return salesAddOnLoaderData(request, page, step, preview)

  const [product, settings, upgrades, smsOptin] = await Promise.all([
    getProductByHandle(page.productHandle).catch(() => null),
    getSiteSettings().catch(() => null),
    loadUpgrades(page),
    getExitOffer(page.slug) ? isLeadSmsOptinEnabled() : false,
  ])
  if (!product || product.variants.length === 0) throw data(BRIDGE_404, { status: 404 })
  const shop = salesShopData(product)
  const onHost = isBridgeHost(requestHost(request.headers))
  const origin = onHost ? `https://${BRIDGE_HOST}` : new URL(request.url).origin
  return {
    kind: 'sales' as const,
    page,
    shop,
    hasAddOns: page.addOns.length > 0,
    smsOptin,
    upgrades: upgrades.flatMap(p => (p ? [{ handle: p.handle, shop: salesShopData(p) }] : [])),
    preview,
    logo: settings?.logoUrl ? { src: settings.logoUrl, alt: settings.logoAlt || 'xdipx' } : null,
    canonical: `${origin}/${page.slug}`,
  }
}

/**
 * One add-on screen. It needs the visitor's sales cart; without one (cookie
 * expired, link shared) the visitor goes back to the page. A sold-out add-on
 * is skipped, and past the last one the visitor goes to checkout.
 */
async function salesAddOnLoaderData(request: Request, page: SalesPage, step: number, preview: boolean) {
  const cartId = getSalesCartId(request)
  if (!cartId) throw redirect(pageUrl(request), { headers: NO_STORE })
  const [cart, addOns, settings] = await Promise.all([
    getCart(cartId).catch(() => null),
    loadAddOns(page),
    getSiteSettings().catch(() => null),
  ])
  if (!cart) throw redirect(pageUrl(request), { headers: NO_STORE })
  const available = addOns.map(screenBuyable)
  if (!available[step - 1]) {
    const next = nextAddOnStep(available, step)
    throw redirect(next ? addOnStepUrl(request, next) : cart.checkoutUrl, { headers: NO_STORE })
  }
  const addOn = page.addOns[step - 1]!
  // Sold-out tiers drop off the screen; the rest keep their order.
  const options = (addOns[step - 1] ?? []).flatMap((product, i) => {
    if (!buyable(product)) return []
    const tier = addOn.tiers[i]
    return [{ handle: product.handle, label: tier?.label ?? '', blurb: tier?.blurb ?? '', shop: salesShopData(product) }]
  })
  return data(
    {
      kind: 'salesAddOn' as const,
      slug: page.slug,
      step,
      total: available.filter(Boolean).length,
      position: available.slice(0, step).filter(Boolean).length,
      isLast: nextAddOnStep(available, step) === null,
      addOn,
      options,
      selected: Math.max(0, options.findIndex(o => o.handle === addOn.productHandle)),
      cart: {
        items: cart.lines.map(l => ({ title: l.merchandise.product.title, image: l.merchandise.product.images[0]?.url ?? null })),
        subtotal: parseFloat(cart.cost.subtotalAmount.amount),
      },
      logo: settings?.logoUrl ? { src: settings.logoUrl, alt: settings.logoAlt || 'xdipx' } : null,
      preview,
    },
    { headers: NO_STORE },
  )
}

/**
 * The advent page's buy buttons post here. Build a one-line cart for the
 * calendar, stamp attribution, and send the visitor straight to Shopify
 * checkout. Only the five calendar handles are accepted.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (!isBridgeHostRequest(request)) throw data(STOREFRONT_404, { status: 404 })
  const slug = (params['slug'] ?? '').toLowerCase()
  if (!isAdventSalesSlug(slug)) return salesAction(request, slug)

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

/** Pick the variant a form asked for, only if it belongs to `product` and is in stock. */
function pickVariant(product: Product | null, wanted: string) {
  return wanted
    ? product?.variants.find(v => v.id === wanted && v.availableForSale)
    : product?.variants.find(v => v.availableForSale)
}

/**
 * A sales page's forms post here.
 *
 * The buy buttons (no intent) build a one-line cart for the chosen variant of
 * the page's own product (any other variant id is refused) and stamp
 * attribution, including which button was clicked. With buyable add-ons the visitor goes to the first add-on
 * screen, the cart id riding in a short host-only cookie; without, straight
 * to Shopify checkout.
 *
 * An add-on screen posts intent=addon with its step and take=1 or take=0.
 * Taking it adds the chosen variant of that step's product to the same cart.
 * Either way the visitor moves to the next buyable add-on, then to checkout.
 */
async function salesAction(request: Request, slug: string) {
  const preview = isPreviewRequest(request)
  const page = await getSalesPage(slug, preview)
  if (!page || (!page.live && !preview)) throw data(BRIDGE_404, { status: 404 })

  const form = await request.formData()
  const wanted = String(form.get('variantId') ?? '')

  if (form.get('intent') === 'addon') {
    const step = parseAddOnStep(String(form.get('step') ?? ''), page.addOns.length)
    const cartId = getSalesCartId(request)
    if (step === null || !cartId) return redirect(pageUrl(request))
    try {
      const addOns = await loadAddOns(page)
      let cart = null
      if (form.get('take') === '1') {
        // The variant must belong to one of this screen's own products.
        const variant = (addOns[step - 1] ?? []).map(p => pickVariant(p, wanted)).find(Boolean)
        if (!variant) return { error: 'That one just sold out. You can skip it and keep going.' }
        const offers = page.addOns[step - 1]?.bulkOffers ?? []
        // Only a quantity this screen offers; anything else is one bottle at full price.
        const offer = offers.find(o => o.quantity === Number(form.get('quantity')))
        cart = await addLinesToCart(cartId, [{ variantId: variant.id, quantity: offer?.quantity ?? 1 }])
        if (offer && !(await addCartDiscountCode(cartId, offer.code))) {
          // The screen promised this price, so a dead code has to reach Sentry.
          console.error('[sales-page] bulk code did not apply', slug, offer.code)
        }
      }
      const next = nextAddOnStep(addOns.map(screenBuyable), step)
      if (next) return redirect(addOnStepUrl(request, next))
      cart ??= await getCart(cartId)
      return redirect(cart ? cart.checkoutUrl : pageUrl(request))
    } catch (err) {
      console.error('[sales-page] add-on failed', slug, step, err)
      return { error: 'That did not go through on our side. Give it another tap.' }
    }
  }

  try {
    const [product, addOns, upgrades] = await Promise.all([getProductByHandle(page.productHandle), loadAddOns(page), loadUpgrades(page)])
    // The variant must belong to this page's product or one it steps up to.
    const variant = [product, ...upgrades].map(p => pickVariant(p, wanted)).find(Boolean)
    if (!variant) return { error: 'That one just sold out. Pick another option above, or check back soon.' }
    const cart = await createCartWithLines([{ variantId: variant.id, quantity: 1 }])
    await applyAttributionAttrs(cart.id, request, [{ key: '_landing', value: `curious/${page.slug}` }, ...salesCtaAttr(form.get('spot'))])
    // A claimed exit code goes on the cart here. It covers this page's own product only.
    const exitCode = claimedExitCode(request, page.slug)
    if (exitCode && variant === pickVariant(product, wanted) && !(await addCartDiscountCode(cart.id, exitCode))) {
      // The form promised this price, so a dead code has to reach Sentry.
      console.error('[sales-page] exit code did not apply', slug, exitCode)
    }
    const next = nextAddOnStep(addOns.map(screenBuyable), 0)
    if (next) return redirect(addOnStepUrl(request, next), { headers: { 'Set-Cookie': setSalesCartCookie(cart.id) } })
    return redirect(cart.checkoutUrl)
  } catch (err) {
    console.error('[sales-page] checkout failed', slug, err)
    return { error: 'Checkout did not open on our side. Give it another tap.' }
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: 'Not found' }, { name: 'robots', content: 'noindex' }]
  if (data.kind === 'salesAddOn') {
    return [{ title: `${plainHeadline(data.addOn.headline) || data.options[data.selected]?.shop.title} | xdipx` }, { name: 'robots', content: 'noindex' }]
  }
  if (data.kind === 'sales') {
    return [
      { title: `${data.page.seoTitle || plainHeadline(data.page.headline)} | xdipx` },
      { name: 'description', content: data.page.subhead },
      { name: 'robots', content: 'noindex' },
      { tagName: 'link', rel: 'canonical', href: data.canonical },
    ]
  }
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

export function headers({ loaderHeaders }: { loaderHeaders: Headers }) {
  // Add-on screens set their own no-store; everything else is the same for every visitor.
  const own = loaderHeaders.get('Cache-Control')
  if (own) return { 'Cache-Control': own, 'X-Robots-Tag': 'noindex' }
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    // The inline GA4 default differs for US visitors (analytics-default.ts).
    Vary: 'X-Vercel-IP-Country',
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
      {/* The advent and long-form sales pages run without the age gate (owner
          direction 2026-10-26 and 2026-10-29: the adult networks that send this
          traffic already gate 18+). */}
      {d.kind !== 'advent' && d.kind !== 'sales' && d.kind !== 'salesAddOn' ? (
        <>
          <style dangerouslySetInnerHTML={{ __html: GATE_CSS }} />
          <script dangerouslySetInnerHTML={{ __html: AGE_PRECHECK }} />
        </>
      ) : null}
      {d.kind === 'funnel' ? (
        <LeadFunnelView page={d.page} utm={d.utm} terms={d.terms} smsOptin={d.smsOptin} />
      ) : d.kind === 'sales' ? (
        d.page.slug === GAWK_SALES_SLUG ? (
          <GawkSalesView d={{ page: d.page, shop: d.shop, upgrades: d.upgrades, smsOptin: d.smsOptin, hasAddOns: d.hasAddOns, logo: d.logo, preview: d.preview, error: actionData?.error ?? null }} />
        ) : (
          <SalesPageView d={{ page: d.page, shop: d.shop, hasAddOns: d.hasAddOns, logo: d.logo, preview: d.preview, error: actionData?.error ?? null }} />
        )
      ) : d.kind === 'salesAddOn' ? (
        <SalesAddOnView d={{ ...d, error: actionData?.error ?? null }} />
      ) : d.kind === 'advent' ? (
        <AdventSalesView d={{ initial: d.initial, products: d.products, query: d.query, logo: d.logo, error: actionData?.error ?? null }} />
      ) : (
        <BridgeView d={d} />
      )}
      {d.kind !== 'advent' && d.kind !== 'sales' && d.kind !== 'salesAddOn' ? <AgeGate /> : null}
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
