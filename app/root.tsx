import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteError,
} from 'react-router'
import type { LoaderFunctionArgs, LinksFunction } from 'react-router'

import * as Sentry from '@sentry/react'
import { BotIdClient } from 'botid/client'
import stylesheet from './app.css?url'
import { AgeGate } from './components/store/AgeGate'

const BOTID_PROTECTED_ROUTES = [
  { path: '/api/waitlist',  method: 'POST' },
  { path: '/admin/login',   method: 'POST' },
  { path: '/api/reviews',   method: 'POST' },
]

if (typeof window !== 'undefined') {
  const dsn = (window as unknown as { ENV?: { SENTRY_DSN?: string } }).ENV?.SENTRY_DSN
  if (dsn && !(window as unknown as { __sentryInit?: boolean }).__sentryInit) {
    Sentry.init({ dsn, environment: import.meta.env.MODE, tracesSampleRate: 0 })
    ;(window as unknown as { __sentryInit: boolean }).__sentryInit = true
  }
}

export const links: LinksFunction = () => [
  // Favicons
  { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
  { rel: 'icon', type: 'image/png', href: '/favicon-16x16.png', sizes: '16x16' },
  { rel: 'icon', type: 'image/png', href: '/favicon-32x32.png', sizes: '32x32' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
  { rel: 'manifest', href: '/site.webmanifest' },
  // Preconnect for Google Fonts
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  // Preconnect for Google Analytics
  { rel: 'preconnect', href: 'https://www.googletagmanager.com' },
  // Poppins (display) + Inter (body)
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap',
  },
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

  return {
    utm,
    refCode,
    ENV: {
      GA4_ID:          process.env['GA4_MEASUREMENT_ID'] ?? '',
      AGE_GATE_LEVEL:  process.env['AGE_GATE_LEVEL'] ?? 'click_through',
      SENTRY_DSN:      process.env['SENTRY_DSN'] ?? '',
    },
  }
}

export function Layout({ children }: { children: React.ReactNode }) {
  // GA4_ID is injected via window.ENV in App() — read it here for the head scripts.
  // During SSR we pull from the loader; on the client we read window.ENV.
  const ga4Id = typeof document !== 'undefined'
    ? (window as unknown as { ENV?: { GA4_ID?: string } }).ENV?.GA4_ID ?? ''
    : (process.env['GA4_MEASUREMENT_ID'] ?? '')

  return (
    <html lang="en" className="bg-brand-cream">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <BotIdClient protect={BOTID_PROTECTED_ROUTES} />
        {ga4Id && (
          <>
            <script async src={`https://www.googletagmanager.com/gtag/js?id=${ga4Id}`} />
            <script
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});gtag('js',new Date());gtag('config','${ga4Id}',{send_page_view:false});`,
              }}
            />
          </>
        )}
      </head>
      <body
        className="font-body text-brand-charcoal antialiased"
        style={{ fontFamily: 'var(--font-body)' }}
      >
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
      {/* Age gate renders above everything; self-dismisses on confirmation */}
      <AgeGate verificationLevel={ENV.AGE_GATE_LEVEL as 'click_through' | 'dob_entry' | 'id_verify'} />
      <Outlet />
      {/* Inject public ENV for client-side access */}
      <script
        dangerouslySetInnerHTML={{
          __html: `window.ENV = ${JSON.stringify(ENV)}`,
        }}
      />
    </>
  )
}

export function ErrorBoundary() {
  const error = useRouteError()

  let heading = 'Something went wrong'
  let message = 'An unexpected error occurred. Please try again.'

  if (isRouteErrorResponse(error)) {
    heading = error.status === 404 ? 'Page not found' : `Error ${error.status}`
    message = error.data ?? message
  }

  return (
    <div className="min-h-screen bg-brand-cream flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-6">♥</div>
        <h1
          className="text-3xl font-bold mb-3 text-brand-gradient"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {heading}
        </h1>
        <p className="text-brand-charcoal/70 mb-8">{message}</p>
        <a
          href="/"
          className="inline-block bg-brand-gradient text-white font-semibold px-8 py-3 rounded-full transition-opacity hover:opacity-90"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Back to today's deal ♥
        </a>
      </div>
    </div>
  )
}
