/**
 * The two-door page of the paid-lead funnel (curious.xdipx.com/<slug>).
 * One question, then Door A (the code, for a name and an email) or Door B
 * (just looking, on to /start). Rendered by app/routes/bridge.$slug.tsx,
 * which owns the age gate, consent banner and analytics shell.
 *
 * The phone input and the SMS consent box exist only while `smsOptin` is on
 * (the lead_sms_optin_enabled kill switch, default on, owner blocker 731):
 * with the switch off there is nothing to consent to, so the page does not
 * ask. The prop defaults to false so a caller that forgets it asks for less,
 * never more.
 */

import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { splitHeadline } from '~/lib/ad-bridge-copy'
import { trackCtaClick, trackGenerateLead } from '~/lib/analytics.client'
import {
  buildStartUrl,
  EMAIL_CONSENT_TEXT,
  PRIVACY_URL,
  SMS_CONSENT_TEXT,
  type FunnelUtm,
  type LeadFunnelPage,
} from '~/lib/lead-funnel'
import { LEAD_INTERESTS, type LeadInterestSlug } from '~/lib/lead-interests'
import { trackFbLead } from '~/lib/meta-pixel.client'

type LeadResponse =
  | { ok: true; code: string; terms: string; shopUrl: string; eventId: string | null }
  | { ok?: false; error: string }

const ERRORS: Record<string, string> = {
  first_name_required: 'What should we call you?',
  invalid_email: 'That email does not look right. Mind checking it?',
  invalid_phone: 'That number does not look right. Use a 10-digit US number, or leave it blank.',
  phone_required_for_sms: 'Add your number to get texts, or untick the box.',
}

function errorText(error: string): string {
  if (ERRORS[error]) return ERRORS[error]
  if (/too many/i.test(error)) return 'Too many tries from here. Give it a minute and try again.'
  return 'Something went wrong on our side. Please try again.'
}

const field =
  'mt-1 block min-h-12 w-full rounded-[var(--radius)] border border-ink/15 bg-paper px-4 font-body text-base text-ink placeholder:text-ink-4 focus:border-plum focus:outline-none'

export function LeadFunnelView({
  page,
  utm,
  terms,
  smsOptin = false,
}: {
  page: LeadFunnelPage
  utm: FunnelUtm
  terms: string
  smsOptin?: boolean
}) {
  const { before, em, after } = splitHeadline(page.headline)
  const [interest, setInterest] = useState<LeadInterestSlug | null>(null)
  const [smsConsent, setSmsConsent] = useState(false)
  const fetcher = useFetcher<LeadResponse>()
  const tracked = useRef(false)

  const result = fetcher.data
  const success = result && 'ok' in result && result.ok ? result : null
  const error = result && !('ok' in result && result.ok) ? (result as { error: string }).error : null
  const busy = fetcher.state !== 'idle'

  // Report the signup once it lands: browser pixel (deduped against the
  // server's CAPI Lead by event id) and GA4 generate_lead.
  useEffect(() => {
    if (!success || tracked.current) return
    tracked.current = true
    if (success.eventId) trackFbLead(`curious-${page.slug}`, success.eventId)
    trackGenerateLead('bridge')
  }, [success, page.slug])

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    fetcher.submit(
      {
        firstName: String(form.get('firstName') ?? ''),
        email: String(form.get('email') ?? ''),
        phone: smsOptin ? String(form.get('phone') ?? '') : '',
        smsConsent: smsOptin && smsConsent,
        interest,
        slug: page.slug,
        company: String(form.get('company') ?? ''),
      },
      { method: 'post', action: '/api/lead', encType: 'application/json' },
    )
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-8 pt-6 md:max-w-2xl md:px-8 md:pt-12">
      <p className="kicker text-ink-3">xdipx</p>
      <h1 className="mt-2 font-display text-[2rem] leading-[1.08] text-ink md:text-5xl">
        {before}
        {em ? <em className="em">{em}</em> : null}
        {after}
      </h1>
      <p className="mt-3 font-body text-base leading-relaxed text-ink-2">{page.intro}</p>

      <fieldset className="mt-6">
        <legend className="font-body text-base font-semibold text-ink">{page.question}</legend>
        <div role="radiogroup" className="mt-3 flex flex-wrap gap-2">
          {LEAD_INTERESTS.map(i => {
            const on = interest === i.slug
            return (
              <button
                key={i.slug}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setInterest(on ? null : i.slug)}
                className={
                  'min-h-11 rounded-full border px-4 font-body text-sm font-semibold transition-colors ' +
                  (on ? 'border-plum bg-plum text-paper' : 'border-ink/15 bg-paper text-ink hover:border-plum')
                }
              >
                {i.label}
              </button>
            )
          })}
        </div>
      </fieldset>

      <section className="mt-6 rounded-[var(--radius-lg)] bg-coral-soft p-5" aria-labelledby="door-a-title">
        {success ? (
          <div role="status">
            <h2 id="door-a-title" className="font-display text-2xl leading-snug text-ink">
              {page.successTitle}
            </h2>
            <p className="mt-3 font-mono text-3xl tracking-wider text-ink">{success.code}</p>
            <p className="mt-2 font-body text-sm text-ink-2">{success.terms}</p>
            <p className="mt-2 font-body text-sm text-ink-2">
              The button below puts it on your cart, or enter it at checkout.
            </p>
            <a
              href={success.shopUrl}
              onClick={() => trackCtaClick('lead_shop_with_code', interest ?? 'none')}
              className="mt-4 flex min-h-[52px] w-full items-center justify-center rounded-full bg-coral px-6 font-body text-base font-semibold text-white"
            >
              {page.successButton}
            </a>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <h2 id="door-a-title" className="font-display text-2xl leading-snug text-ink">
              {page.doorATitle}
            </h2>
            <p className="mt-1 font-body text-sm text-ink-2">{terms}</p>

            {/* Honeypot: hidden from people, filled by naive bots. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label>
                Company
                <input name="company" type="text" tabIndex={-1} autoComplete="off" />
              </label>
            </div>

            <label className="mt-4 block font-body text-sm font-semibold text-ink">
              First name
              <input name="firstName" type="text" autoComplete="given-name" required maxLength={60} className={field} />
            </label>
            <label className="mt-3 block font-body text-sm font-semibold text-ink">
              Email
              <input name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} className={field} />
            </label>
            {smsOptin ? (
              <>
                <label className="mt-3 block font-body text-sm font-semibold text-ink">
                  Phone <span className="font-normal text-ink-3">(optional)</span>
                  <input name="phone" type="tel" autoComplete="tel" inputMode="tel" maxLength={32} className={field} />
                </label>
                <label className="mt-3 flex items-start gap-3 font-body text-xs leading-relaxed text-ink-2">
                  <input
                    type="checkbox"
                    checked={smsConsent}
                    onChange={e => setSmsConsent(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-plum"
                  />
                  <span>{SMS_CONSENT_TEXT}</span>
                </label>
              </>
            ) : null}

            {error ? (
              <p role="alert" className="mt-3 font-body text-sm font-semibold text-coral">
                {errorText(error)}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="mt-4 flex min-h-[52px] w-full items-center justify-center rounded-full bg-coral px-6 font-body text-base font-semibold text-white disabled:opacity-60"
            >
              {busy ? 'One moment…' : page.doorAButton}
            </button>
            <p className="mt-3 font-body text-xs text-ink-3">
              {EMAIL_CONSENT_TEXT}{' '}
              <a href={PRIVACY_URL} className="link-coral">
                Privacy policy
              </a>
            </p>
          </form>
        )}
      </section>

      <section className="mt-4 rounded-[var(--radius-lg)] border border-ink/10 p-5" aria-labelledby="door-b-title">
        <h2 id="door-b-title" className="font-display text-xl leading-snug text-ink">
          {page.doorBTitle}
        </h2>
        <a
          href={buildStartUrl(interest, utm, page.slug)}
          onClick={() => trackCtaClick('lead_just_looking', interest ?? 'none')}
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-full border border-ink/20 px-6 font-body text-base font-semibold text-ink md:w-auto md:inline-flex"
        >
          {page.doorBButton}
        </a>
      </section>

      <p className="mt-6 font-body text-xs text-ink-4">For adults, 18 and over. Billing reads XDIPX.</p>
    </div>
  )
}
