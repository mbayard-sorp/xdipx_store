import { useFetcher } from 'react-router'
import { useEffect, useState } from 'react'
import { Reveal } from '~/components/motion/Reveal'
import type { NotebookSettings } from '~/types/cms'

interface NotebookSubscribeProps {
  /** 'index' = coral-soft band (index/series pages); 'post' = paper-3 band inside a post. */
  variant?: 'index' | 'post'
  settings?: NotebookSettings | null
}

/**
 * Inline newsletter band (art direction §4): a calm value exchange in the
 * reading flow, never a popup or overlay. Posts to the existing /api/waitlist
 * Klaviyo pipeline.
 */
export function NotebookSubscribe({ variant = 'index', settings }: NotebookSubscribeProps) {
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
  const heading = settings?.newsletterHeading ?? 'The Notebook, in your inbox.'
  const body = settings?.newsletterBody ?? "One send, once-ish a week. Only the ones worth reading. Unsubscribe anytime, we're not needy."
  const buttonLabel = settings?.newsletterButtonLabel ?? 'Show me'

  const bandClass = variant === 'index' ? 'bg-coral-soft' : 'bg-paper-3'
  const buttonClass =
    variant === 'index'
      ? 'bg-ink text-white hover:bg-ink-2'
      : 'bg-coral text-white hover:bg-coral-2'

  return (
    <Reveal variant="up" as="section" className={`${bandClass} rounded-lg p-6 md:p-8`}>
      <div className="md:flex md:items-center md:justify-between md:gap-8">
        <div className="mb-4 md:mb-0 md:max-w-sm">
          <h2
            className="text-ink text-xl md:text-2xl leading-snug"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
          >
            {heading}
          </h2>
          <p className="text-sm text-ink-3 mt-1.5 leading-[1.55]">{body}</p>
        </div>

        {submitted ? (
          <p
            className="text-ink text-lg fade-in md:shrink-0"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
          >
            You're in. Watch your inbox.
          </p>
        ) : (
          <div className="md:shrink-0 md:w-96">
            <fetcher.Form method="post" action="/api/waitlist" className="flex flex-col sm:flex-row gap-2.5">
              <input type="hidden" name="intent" value="subscribe" />
              <label htmlFor="notebook-subscribe" className="sr-only">Email address</label>
              <input
                id="notebook-subscribe"
                type="email"
                name="email"
                required
                placeholder="your@email.com"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'notebook-subscribe-error' : undefined}
                className="flex-1 px-4 py-2.5 rounded-full border border-line bg-paper text-ink placeholder-ink-4 focus:outline-none focus:ring-2 focus:ring-coral/40"
                onChange={() => error && setError('')}
              />
              <button
                type="submit"
                disabled={isPending}
                className={`${buttonClass} press font-medium px-6 py-2.5 rounded-full transition-colors disabled:opacity-60 whitespace-nowrap`}
              >
                {isPending ? 'One sec…' : buttonLabel}
              </button>
            </fetcher.Form>
            {error && (
              <p id="notebook-subscribe-error" role="alert" className="text-red-500 text-xs mt-2">{error}</p>
            )}
          </div>
        )}
      </div>
    </Reveal>
  )
}
