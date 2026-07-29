import { useEffect, useState } from 'react'
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useLocation,
  useRouteError,
  useRouteLoaderData,
} from 'react-router'
import { data } from 'react-router'
import type { LoaderFunctionArgs, LinksFunction } from 'react-router'

import { BotIdClient } from 'botid/client'
import stylesheet from './app.css?url'
// Same physical files app.css's @fontsource @font-face rules reference — Vite
// dedupes them into one hashed asset, so these ?url imports resolve to the
// exact URLs the stylesheet will request (preload hits, never a double fetch).
import newsreaderLatinWoff2 from '@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2?url'
import dmSansLatinWoff2 from '@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2?url'
import { BRAND_TITLE, BRAND_DESCRIPTION } from '~/lib/brand'
import { SITE_ORIGIN } from '~/lib/social-meta'
import { captureUTM } from '~/lib/attribution.server'
import { resolveGa4 } from '~/lib/ga4-config.server'

const BOTID_PROTECTED_ROUTES = [
  { path: '/api/waitlist',  method: 'POST' },
  { path: '/api/reviews',   method: 'POST' },
]

// botid serializes its runtime via Function.toString(), which produces
// different source on Node vs the browser. SSR-rendering it causes a
// hydration mismatch in <Layout> that breaks event handlers on the page
// (e.g. the wishlist heart). Mount it after hydration instead — the
// script still loads in time for any protected POST.
function BotIdMount() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null
  return <BotIdClient protect={BOTID_PROTECTED_ROUTES} />
}

// Initialize Sentry after hydration rather than at module-eval time, and load
// the SDK itself via a dynamic import rather than a static one. A static
// `import * as Sentry from '@sentry/react'` pulls the ~30KB gz Sentry chunk
// into the root module's modulepreload list, where it competes with the LCP
// hero image for bandwidth (this was ~66% of mobile LCP resource-load-delay).
// The dynamic import removes the chunk from that graph entirely; idle
// scheduling then keeps the fetch off the hydration-critical path too.
// window.ENV is set by the inline script in <App>, which has run by the time
// this effect fires.
function SentryInit() {
  useEffect(() => {
    const dsn = (window as unknown as { ENV?: { SENTRY_DSN?: string } }).ENV?.SENTRY_DSN
    if (!dsn || (window as unknown as { __sentryInit?: boolean }).__sentryInit) return
    // Set the guard before the dynamic import resolves so a StrictMode
    // double-mount can't race two Sentry.init() calls.
    ;(window as unknown as { __sentryInit: boolean }).__sentryInit = true
    const run = () => {
      import('@sentry/react').then((Sentry) => {
        Sentry.init({ dsn, environment: import.meta.env.MODE, tracesSampleRate: 0.1 })
      })
    }
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
    if (ric) {
      ric(run)
    } else {
      setTimeout(run, 2000)
    }
  }, [])
  return null
}

// Core Web Vitals → GA4, mount-gated like SentryInit so the observer setup
// never competes with hydration. Events go through the same window.gtag →
// dataLayer path as every analytics.client event, so the consent-mode default
// ('analytics_storage: denied' until the banner grants it) gates these
// identically — no second consent code path. The dynamic import keeps
// web-vitals out of the entry chunk.
function WebVitalsReport() {
  useEffect(() => {
    const w = window as unknown as { __webVitalsInit?: boolean; gtag?: (...args: unknown[]) => void }
    if (w.__webVitalsInit) return
    w.__webVitalsInit = true
    import('web-vitals').then(({ onLCP, onCLS, onINP, onTTFB }) => {
      const report = (metric: { name: string; value: number; id: string; rating: string }) => {
        w.gtag?.('event', 'web_vitals', {
          metric_name: metric.name,
          // CLS is a small float; GA4 metrics want integers. Standard trick:
          // CLS × 1000, everything else rounded ms.
          metric_value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
          metric_id: metric.id,
          metric_rating: metric.rating,
          page_path: location.pathname,
          non_interaction: true,
        })
      }
      onLCP(report)
      onCLS(report)
      onINP(report)
      onTTFB(report)
    })
  }, [])
  return null
}

export const links: LinksFunction = () => [
  // Favicons
  { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
  { rel: 'icon', type: 'image/png', href: '/favicon-16x16.png', sizes: '16x16' },
  { rel: 'icon', type: 'image/png', href: '/favicon-32x32.png', sizes: '32x32' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
  { rel: 'manifest', href: '/site.webmanifest' },
  // Preconnect for Shopify CDN — the LCP hero image and gallery come from
  // cdn.shopify.com on every product/homepage view. No crossOrigin: <img> and
  // image-preload fetches are no-cors, and a credentialless (anonymous) socket
  // can't be reused for them — Lighthouse flagged the old anonymous preconnect
  // as an unused connection. (googletagmanager.com lost its preconnect when
  // gtm.js moved to idle-time loading; a warm socket that early is wasted.)
  { rel: 'preconnect', href: 'https://cdn.shopify.com' },
  // Sanity CDN serves avatars, editorial tiles, and notebook card images.
  { rel: 'preconnect', href: 'https://cdn.sanity.io' },
  // Fonts (Newsreader / DM Sans / JetBrains Mono / Caveat) are self-hosted via
  // @fontsource and bundled into app.css — no cross-origin Google Fonts
  // request, no render-blocking external stylesheet. See app/app.css.
  // Preload only the two latin subsets that style above-the-fold text
  // (display + body, ~95KB); without these the browser discovers fonts only
  // after the stylesheet downloads and parses, putting them at the end of the
  // critical chain. Font requests are always CORS, hence crossOrigin.
  { rel: 'preload', as: 'font', type: 'font/woff2', href: newsreaderLatinWoff2, crossOrigin: 'anonymous' },
  { rel: 'preload', as: 'font', type: 'font/woff2', href: dmSansLatinWoff2, crossOrigin: 'anonymous' },
  { rel: 'stylesheet', href: stylesheet },
]

export async function loader({ request }: LoaderFunctionArgs) {
  // Capture UTM + ref params into the __xdipx_utm / __xdipx_ref cookies (30d)
  // so api.cart can stamp them onto cart attributes and api.waitlist onto
  // Klaviyo profiles. Cookies are only written when params are present, so
  // most requests stay Set-Cookie-free (and edge-cacheable).
  const { utm, refCode, cookies: utmCookies } = captureUTM(request)

  const ga4 = await resolveGa4()

  const headers = new Headers()
  for (const cookie of utmCookies) headers.append('Set-Cookie', cookie)

  return data({
    utm,
    refCode,
    ENV: {
      GA4_ID:            ga4.id,
      GA4_SOURCE:        ga4.source,
      GTM_ID:            process.env['GTM_CONTAINER_ID']   ?? '',
      AGE_GATE_LEVEL:    process.env['AGE_GATE_LEVEL']     ?? 'click_through',
      SENTRY_DSN:        process.env['SENTRY_DSN']         ?? '',
      EMMA_TEXT_NUMBER:  process.env['EMMA_TEXT_NUMBER']   ?? '',
      // META_PIXEL_ID is public (the id appears in browser JS anyway).
      // META_CAPI_TOKEN must NEVER be included here.
      META_PIXEL_ID:     process.env['META_PIXEL_ID']      ?? '',
    },
  }, { headers })
}

export function Layout({ children }: { children: React.ReactNode }) {
  // GA4_ID resolves via env var first, then `pipeline_settings.ga4MeasurementId`
  // — see app/lib/ga4-config.server.ts. The root loader puts the resolved value
  // on window.ENV.GA4_ID, which we read here so the gtag.js <script> renders
  // during SSR. The process.env fallback covers the error-boundary path where
  // loader data may be absent.
  const rootData = useRouteLoaderData('root') as
    | { ENV?: { GA4_ID?: string; GTM_ID?: string; META_PIXEL_ID?: string } }
    | undefined
  const ga4Id = typeof document !== 'undefined'
    ? (window as unknown as { ENV?: { GA4_ID?: string } }).ENV?.GA4_ID ?? ''
    : rootData?.ENV?.GA4_ID ?? (process.env['GA4_MEASUREMENT_ID'] ?? '')
  const gtmId = typeof document !== 'undefined'
    ? (window as unknown as { ENV?: { GTM_ID?: string } }).ENV?.GTM_ID ?? ''
    : rootData?.ENV?.GTM_ID ?? (process.env['GTM_CONTAINER_ID'] ?? '')
  const pixelId = typeof document !== 'undefined'
    ? (window as unknown as { ENV?: { META_PIXEL_ID?: string } }).ENV?.META_PIXEL_ID ?? ''
    : rootData?.ENV?.META_PIXEL_ID ?? (process.env['META_PIXEL_ID'] ?? '')

  // Analytics loads in two stages. The bootstrap runs inline before first
  // paint: consent-mode defaults (denied until the banner grants) plus the
  // gtag and fbq queue stubs, so every event or consent update fired from app
  // code is queued from the start. The heavy third-party payloads (gtm.js /
  // gtag.js / fbevents.js, ~265KB combined) load only on first interaction or
  // post-load idle — loaded eagerly in <head> they compete with the
  // render-blocking stylesheet and LCP hero image for bandwidth on throttled
  // mobile connections. Queued dataLayer/fbq calls replay when the scripts
  // arrive, so nothing is lost.
  //
  // GA4 loads directly only when GTM is NOT present: with a gtmId the GTM
  // container owns the GA4 config tag, and loading gtag/js here too would pull
  // GA4 twice and double-fire events.
  //
  // The Meta pixel id is public (visible in browser JS regardless); the CAPI
  // token is server-only and never appears here or in window.ENV.
  const analyticsBootstrap = [
    (ga4Id || gtmId)
      ? `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});`
      : '',
    pixelId
      ? `!function(f){if(f.fbq)return;var n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[]}(window);fbq('consent','revoke');fbq('init','${pixelId}');`
      : '',
  ].join('')

  const deferredLoads = [
    gtmId
      ? `window.dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});inject('https://www.googletagmanager.com/gtm.js?id=${gtmId}');`
      : '',
    (!gtmId && ga4Id)
      ? `inject('https://www.googletagmanager.com/gtag/js?id=${ga4Id}');gtag('js',new Date());gtag('config','${ga4Id}',{send_page_view:false});`
      : '',
    pixelId ? `inject('https://connect.facebook.net/en_US/fbevents.js');` : '',
  ].join('')

  const analyticsLoader = deferredLoads
    ? `(function(){var done=false;function inject(src){var s=document.createElement('script');s.async=true;s.src=src;document.head.appendChild(s)}function go(){if(done)return;done=true;${deferredLoads}}['pointerdown','keydown','touchstart','scroll'].forEach(function(e){addEventListener(e,go,{once:true,passive:true})});function idle(){'requestIdleCallback' in window?requestIdleCallback(go,{timeout:3000}):setTimeout(go,2000)}document.readyState==='complete'?idle():addEventListener('load',idle);setTimeout(go,8000);})();`
    : ''

  return (
    <html lang="en" className="bg-cream">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <BotIdMount />
        {analyticsBootstrap && (
          <script dangerouslySetInnerHTML={{ __html: analyticsBootstrap }} />
        )}
        {analyticsLoader && (
          <script dangerouslySetInnerHTML={{ __html: analyticsLoader }} />
        )}
      </head>
      <body
        className="font-body text-ink antialiased"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        {/* WebSite JSON-LD lives in _layout.tsx (WebsiteStructuredData), next to
            Organization JSON-LD so both sitewide entities render together and
            don't duplicate — removing the inline copy that used to render here. */}
        {gtmId && (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
              height="0"
              width="0"
              style={{ display: 'none', visibility: 'hidden' }}
            />
          </noscript>
        )}
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  const { ENV } = useLoaderData<typeof loader>()

  return (
    <>
      <Outlet />
      {/* Inject public ENV for client-side access */}
      <script
        dangerouslySetInnerHTML={{
          __html: `window.ENV = ${JSON.stringify(ENV)}`,
        }}
      />
      <SentryInit />
      <WebVitalsReport />
    </>
  )
}

export function ErrorBoundary() {
  const error = useRouteError()
  const location = useLocation()

  // Friendly, brand-voice copy for the user-facing page.
  // The raw status code goes into a hidden HTML comment so we keep it for
  // debugging without ever letting Google index "Error 499" as the page title
  // or snippet (which is exactly what was happening in search results).
  let heading = 'Something went sideways'
  let message = "Try reloading, or take me back to today's pick."
  let status: number | null = null

  if (isRouteErrorResponse(error)) {
    status = error.status
    if (error.status === 404) {
      heading = 'Page not found'
      message = "That link's gone walkabout. Today's pick is right this way."
    } else if (error.status === 410) {
      heading = "That deal's been retired"
      message = "It had its day. Here's what Emma's picking now."
    }
  }

  // Only a genuinely gone/missing page may carry `noindex`. A transient 5xx, a
  // 499 (render aborted mid-stream on a slow cold instance), or any unknown
  // render error must NEVER emit noindex: Google treats noindex as a sticky,
  // semi-permanent signal and will drop the URL for what was a momentary blip.
  // Those cases fall through with no robots meta so Googlebot simply retries.
  const isPermanentlyUnindexable = status === 404 || status === 410

  // Brand-safe SEO title + noindex so error pages never get indexed.
  // React 19 hoists <title>/<meta>/<link> from anywhere in the tree into <head>.
  // BRAND_TITLE and BRAND_DESCRIPTION come from app/lib/brand.ts — single source
  // of truth shared with the homepage meta export.

  // Canonical comes from each route's `meta` export, which React Router does
  // not run when that route errors, so before this every error page shipped
  // brand-generic markup with no canonical at all. Identical HTML across many
  // URLs is precisely the input Google's dedup wants: it clustered them and
  // elected `/` as the representative, leaving 337 URLs (2026-07-29) sitting in
  // "Duplicate without user-selected canonical" pointing at the homepage,
  // including pages as unmistakably distinct as /discover. Declaring the URL's
  // own canonical here keeps an errored page a document of its own, so a
  // transient failure costs a retry instead of the URL's identity.
  //
  // 404/410 are left out on purpose: those carry `noindex`, and Google ignores
  // a canonical on a page it has been told not to index.
  const selfCanonical = `${SITE_ORIGIN}${location.pathname}`

  return (
    <>
      <title>{BRAND_TITLE}</title>
      {isPermanentlyUnindexable ? (
        <meta name="robots" content="noindex, nofollow" />
      ) : (
        <link rel="canonical" href={selfCanonical} />
      )}
      <meta name="description" content={BRAND_DESCRIPTION} />
      {/* Keep the status code visible to ops without putting it in the title. */}
      {status !== null && (
        <meta name="x-error-status" content={String(status)} />
      )}
      <div className="min-h-screen bg-cream flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-6">♥</div>
          <h1
            className="text-3xl font-bold mb-3 text-coral"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {heading}
          </h1>
          <p className="text-ink/70 mb-8">{message}</p>
          <a
            href="/"
            className="inline-block bg-coral text-white font-semibold px-8 py-3 rounded-full transition-opacity hover:opacity-90"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Take me to today's pick ♥
          </a>
        </div>
      </div>
    </>
  )
}
