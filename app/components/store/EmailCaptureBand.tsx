/**
 * 1i — Email capture band ("Emma's list").
 *
 * Discretion-forward, lives late in the page, never a modal. Reuses the same
 * Klaviyo POST action pattern as `EmailSubscribe` (fetcher.Form -> /api/waitlist,
 * native form post, works with zero JS). Success state replaces the form with
 * height reserved so nothing shifts; error renders inline below the field with
 * form values preserved.
 */

import { useFetcher } from 'react-router'
import { useEffect, useState } from 'react'
import type { EmailCaptureBandBlock } from '~/types/cms'

const DISPLAY = { fontFamily: 'var(--font-display)', fontWeight: 450 } as const
const BODY = { fontFamily: 'var(--font-body)' } as const
const MONO = { fontFamily: 'var(--font-mono)' } as const

interface EmailCaptureBandProps {
  block?: EmailCaptureBandBlock | undefined
  /** Renders the half-height footer variant — heading only, no form. */
  footerVariant?: boolean
}

export function EmailCaptureBand({ block, footerVariant = false }: EmailCaptureBandProps) {
  const fetcher = useFetcher()
  const [clientError, setClientError] = useState('')

  const data = fetcher.data as { ok?: boolean; error?: string } | undefined
  const success = data?.ok === true
  const serverError = data?.error
  const isPending = fetcher.state !== 'idle'

  useEffect(() => {
    if (serverError) setClientError(serverError)
  }, [serverError])

  const eyebrow = block?.eyebrow || "Emma's list"
  const heading = block?.heading || 'A quiet note when something good arrives.'
  const emphasis = block?.emphasisWord || 'arrives'
  const headingParts = heading.includes(emphasis) ? heading.split(emphasis) : [heading, '']
  const subcopy = block?.subcopy
    || "Now and then, not weekly. Plain subject lines your lock screen can show anyone."
  const buttonLabel = block?.buttonLabel && block.buttonLabel === 'Show me' ? block.buttonLabel : 'Show me'
  const finePrint = block?.finePrint
    || 'Unsubscribe anytime. Your inbox stays as discreet as your doorstep.'

  if (footerVariant) {
    return (
      <section className="bg-paper-2 px-6 py-6 text-center md:px-16">
        <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
          {eyebrow}
        </p>
        <h2 className="text-[18px] leading-tight text-ink" style={DISPLAY}>
          {headingParts[0]}
          <em className="em">{emphasis}</em>
          {headingParts[1]}
        </h2>
      </section>
    )
  }

  return (
    <section className="bg-paper-2 px-6 py-8 md:px-12 md:py-10">
      <div className="mx-auto grid max-w-[1320px] gap-6 md:grid-cols-2 md:items-center md:gap-10">
        <div>
          <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
            {eyebrow}
          </p>
          <h2 className="text-[26px] leading-[1.15] text-ink md:text-[30px]" style={DISPLAY}>
            {headingParts[0]}
            <em className="em">{emphasis}</em>
            {headingParts[1]}
          </h2>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-3 md:mt-0 md:text-[14px]" style={BODY}>
            {subcopy}
          </p>
        </div>

        <div>
          {/* Height-reserved so success never shifts layout. */}
          <div className="min-h-[52px]">
            {success ? (
              <p className="text-[16px] text-sage" style={DISPLAY}>
                You're on the list. <span aria-hidden="true">♥</span>
              </p>
            ) : (
              <fetcher.Form
                method="post"
                action="/api/waitlist"
                className="flex flex-col gap-2.5 md:flex-row"
              >
                <input type="hidden" name="intent" value="subscribe" />
                <label htmlFor="email-capture-band" className="sr-only">Email address</label>
                <input
                  id="email-capture-band"
                  type="email"
                  name="email"
                  required
                  placeholder="your@email.com"
                  aria-invalid={clientError ? true : undefined}
                  aria-describedby={clientError ? 'email-capture-band-error' : undefined}
                  className="rounded-full border border-line-2 bg-paper px-[18px] py-[13px] text-[14px] text-ink placeholder-ink-4 focus:border-plum focus:outline-none md:flex-1"
                  style={BODY}
                  onChange={() => clientError && setClientError('')}
                />
                <button
                  type="submit"
                  disabled={isPending}
                  className="whitespace-nowrap rounded-full bg-ink px-[22px] py-[13px] text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  style={BODY}
                >
                  {isPending ? 'Joining…' : buttonLabel}
                </button>
              </fetcher.Form>
            )}
            {!success && clientError && (
              <p id="email-capture-band-error" role="alert" className="mt-2 text-[12px] text-coral">
                That email looks unfinished.
              </p>
            )}
          </div>
          {!success && (
            <p className="mt-3 text-[11px] text-ink-4" style={BODY}>
              {finePrint}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
