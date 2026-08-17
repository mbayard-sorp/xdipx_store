import { useFetcher } from 'react-router'
import { useEffect, useRef, useState } from 'react'
import { trackGenerateLead, type LeadLocation } from '~/lib/analytics.client'

interface EmailSubscribeProps {
  heading?: string
  subcopy?: string
  buttonLabel?: string
  /** GA4 lead attribution: which surface captured the address. Email capture
      is the primary month-one success metric of paid search, so every render
      site names itself (ticket #3424). */
  location?: LeadLocation
}

export function EmailSubscribe({
  heading = "Get tomorrow's deal before it drops.",
  subcopy = 'No spam. No fluff. Just one email when the next deal goes live.',
  buttonLabel = 'Dip In ♥',
  location = 'home',
}: EmailSubscribeProps = {}) {
  const fetcher = useFetcher()
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const leadFired = useRef(false)

  useEffect(() => {
    const data = fetcher.data as { ok?: boolean; error?: string } | undefined
    if (!data) return
    if (data.ok) {
      setSubmitted(true)
      // Fire once per successful capture; the ref dedupes StrictMode
      // double-effects and later fetcher.data re-renders.
      if (!leadFired.current) {
        leadFired.current = true
        trackGenerateLead(location)
      }
    }
    if (data.error) setError(data.error)
  }, [fetcher.data, location])

  const isPending = fetcher.state !== 'idle'

  return (
    <section className="bg-cream-2 py-16 px-4">
      <div className="max-w-xl mx-auto text-center">
        <p className="text-sage text-2xl mb-2" aria-hidden="true">♥</p>
        <h2
          className="text-2xl md:text-3xl text-ink mb-2"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 450 }}
        >
          {heading}
        </h2>
        <p className="text-ink/60 mb-8">{subcopy}</p>

        {submitted ? (
          <div className="fade-in">
            <p
              className="text-sage text-xl font-semibold"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              You're in. ♥
            </p>
            <p className="text-ink/60 text-sm mt-1">
              Check your inbox tonight. Something good is coming.
            </p>
          </div>
        ) : (
          <>
            <fetcher.Form method="post" action="/api/waitlist" className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
              <input type="hidden" name="intent" value="subscribe" />
              <label htmlFor="email-subscribe" className="sr-only">Email address</label>
              <input
                id="email-subscribe"
                type="email"
                name="email"
                required
                placeholder="your@email.com"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'email-subscribe-error' : undefined}
                className="flex-1 px-4 py-3 rounded-full border border-cream-2 bg-white text-ink placeholder-ink/50 focus:outline-none focus:ring-2 focus:ring-sage/50"
                onChange={() => error && setError('')}
              />
              <button
                type="submit"
                disabled={isPending}
                className="bg-coral text-white font-medium px-6 py-3 rounded-full transition-opacity hover:opacity-90 disabled:opacity-60 whitespace-nowrap"
                style={{ fontFamily: 'var(--font-body)' }}
              >
                {isPending ? 'Joining...' : buttonLabel}
              </button>
            </fetcher.Form>
            {error && (
              <p id="email-subscribe-error" role="alert" className="text-red-500 text-xs mt-2">{error}</p>
            )}
          </>
        )}

        <p className="text-ink/40 text-xs mt-4">
          Unsubscribe anytime. We're not needy.
        </p>
      </div>
    </section>
  )
}
