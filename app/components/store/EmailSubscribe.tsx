import { useFetcher } from 'react-router'
import { useEffect, useState } from 'react'

export function EmailSubscribe() {
  const fetcher = useFetcher()
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (fetcher.data && (fetcher.data as { ok?: boolean }).ok) setSubmitted(true)
  }, [fetcher.data])

  const isPending = fetcher.state !== 'idle'

  return (
    <section className="bg-brand-mist py-16 px-4">
      <div className="max-w-xl mx-auto text-center">
        <p className="text-brand-purple text-2xl mb-2" aria-hidden="true">♥</p>
        <h2
          className="text-2xl md:text-3xl font-bold text-brand-charcoal mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Get tomorrow's deal before it drops.
        </h2>
        <p className="text-brand-charcoal/60 mb-8">
          No spam. No fluff. Just one email when the next deal goes live.
        </p>

        {submitted ? (
          <div className="fade-in">
            <p
              className="text-brand-purple text-xl font-semibold"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              You're in. ♥
            </p>
            <p className="text-brand-charcoal/60 text-sm mt-1">
              Check your inbox tonight. Something good is coming.
            </p>
          </div>
        ) : (
          <fetcher.Form method="post" action="/api/waitlist" className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <input type="hidden" name="intent" value="subscribe" />
            <input
              type="email"
              name="email"
              required
              placeholder="your@email.com"
              className="flex-1 px-4 py-3 rounded-full border border-brand-mist bg-white text-brand-charcoal placeholder-brand-charcoal/40 focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
            />
            <button
              type="submit"
              disabled={isPending}
              className="bg-brand-gradient text-white font-bold px-6 py-3 rounded-full transition-opacity hover:opacity-90 disabled:opacity-60 whitespace-nowrap"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {isPending ? 'Joining...' : 'Dip In ♥'}
            </button>
          </fetcher.Form>
        )}

        <p className="text-brand-charcoal/40 text-xs mt-4">
          Unsubscribe anytime. We're not needy.
        </p>
      </div>
    </section>
  )
}
