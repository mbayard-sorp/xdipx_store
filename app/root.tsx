import { useEffect, useState } from 'react'
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteError,
  useRouteLoaderData,
} from 'react-router'
import type { LoaderFunctionArgs, LinksFunction } from 'react-router'

import * as Sentry from '@sentry/react'
import { BotIdClient } from 'botid/client'
import stylesheet from './app.css?url'
import { BRAND_TITLE, BRAND_DESCRIPTION } from '~/lib/brand'
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

// Initialize Sentry after hydration rather than at module-eval time. Running
// Sentry.init() synchronously while the client bundle evaluates competes with
// React hydration for the main thread and hurts INP; deferring to a mount
// effect keeps the critical path clear. window.ENV is set by the inline script
// in <App>, which has run by the time this effect fires.
function SentryInit() {
  useEffect(() => {
    const dsn = (window as unknown as { ENV?: { SENTRY_DSN?: string } }).ENV?.SENTRY_DSN
    if (dsn && !(window as unknown as { __sentryInit?: boolean }).__sentryInit) {
      Sentry.init({ dsn, environment: import.meta.env.MODE, tracesSampleRate: 0.1 })
      ;(window as unknown as { __sentryInit: boolean }).__sentryInit = true
    }
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
  // Preconnect for Google Analytics
  { rel: 'preconnect', href: 'https://www.googletagmanager.com' },
  // Preconnect for Shopify CDN — the LCP hero image and gallery come from
  // cdn.shopify.com on every product/homepage view. crossOrigin saves a
  // round-trip on the cross-origin TCP+TLS handshake.
  { rel: 'preconnect', href: 'https://cdn.shopify.com', crossOrigin: 'anonymous' },
  // Fonts (Newsreader / DM Sans / JetBrains Mono / Caveat) are now self-hosted
  // via @fontsource and bundled into app.css — no cross-origin Google Fonts
  // request, no render-blocking external stylesheet. See app/app.css.
  { rel: 'stylesheet', href: stylesheet },
]

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)

  // Capture UTM params on every request
  const utm = {
    source:   url.searchParams.get('utm_source'),
    medium:   url.searchParams.get('utm_medium'),
    campaign: url.searchParams.get('utm_campaign'),
    content:  url.searchParams.get('utm_content'),
  }
  const refCode = url.searchParams.get('ref')

  const ga4 = await resolveGa4()

  return {
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
  }
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

  return (
    <html lang="en" className="bg-cream">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <BotIdMount />
        {(ga4Id || gtmId) && (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});`,
            }}
          />
        )}
        {gtmId && (
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');`,
            }}
          />
        )}
        {/* Load GA4 directly only when GTM is NOT present. When gtmId is set the
            GTM container owns the GA4 config tag, so loading gtag/js here too
            would pull GA4 twice and double-fire events. The consent-default
            script above still defines window.gtag (→ dataLayer.push), so
            analytics.client events flow through GTM either way. */}
        {ga4Id && !gtmId && (
          <>
            <script async src={`https://www.googletagmanager.com/gtag/js?id=${ga4Id}`} />
            <script
              dangerouslySetInnerHTML={{
                __html: `gtag('js',new Date());gtag('config','${ga4Id}',{send_page_view:false});`,
              }}
            />
          </>
        )}
        {/* Meta Pixel — consent-revoke-by-default mirrors the GA4 pattern above.
            fbq('consent','revoke') fires BEFORE fbq('init') so no events are
            sent until the visitor grants consent via the cookie banner. The
            pixel id is public (visible in browser JS regardless); the CAPI
            token is server-only and never appears here or in window.ENV. */}
        {pixelId && (
          <script
            dangerouslySetInnerHTML={{
              __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('consent','revoke');fbq('init','${pixelId}');`,
            }}
          />
        )}
      </head>
      <body
        className="font-body text-ink antialiased"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        {/* WebSite JSON-LD: enables the sitelinks search box (in-SERP search
            input under the brand result). Static — no loader data needed.
            Organization JSON-LD lives in _layout.tsx so it can read
            socialLinks from the Sanity-backed layout loader. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type':    'WebSite',
              url:        'https://xdipx.com',
              name:       'xdipx',
              potentialAction: {
                '@type':       'SearchAction',
                target:        'https://xdipx.com/search?q={search_term_string}',
                'query-input': 'required name=search_term_string',
              },
            }),
          }}
        />
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
    </>
  )
}

export function ErrorBoundary() {
  const error = useRouteError()

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
  // React 19 hoists <title>/<meta> from anywhere in the tree into <head>.
  // BRAND_TITLE and BRAND_DESCRIPTION come from app/lib/brand.ts — single source
  // of truth shared with the homepage meta export.

  return (
    <>
      <title>{BRAND_TITLE}</title>
      {isPermanentlyUnindexable && (
        <meta name="robots" content="noindex, nofollow" />
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
