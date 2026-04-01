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

import stylesheet from './app.css?url'
import { AgeGate } from './components/store/AgeGate'

export const links: LinksFunction = () => [
  // Preconnect for Google Fonts
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
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
    },
  }
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-brand-cream">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
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
