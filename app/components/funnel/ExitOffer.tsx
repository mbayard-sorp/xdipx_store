/**
 * "Don't go yet": an email and phone form that gives a visitor who is leaving
 * a sales page a code to come back with (owner direction 2026-11-01).
 *
 * Exit signals: the cursor leaving through the top of the window on desktop; on
 * touch, a hard flick back up the page or coming back to the tab after leaving
 * it. There is no back-button trap, because that stops someone leaving and the
 * point is to ask once. It shows once per browser per week, and never after a
 * buy button was pressed.
 *
 * The native <dialog> brings the focus trap, Esc and an inert page behind it.
 * The inputs stay uncontrolled with standard names and autocomplete tokens, so
 * browser and password-manager autofill can fill both fields in one tap.
 *
 * Words name no percent or price before signup: the Gawk is at MAP. The code
 * and its terms arrive only in the /api/lead response.
 *
 * This posts with fetch in a try/catch, not useFetcher. A fetcher that cannot
 * reach the server throws to the route's ErrorBoundary, and a dropped signal or
 * an ad blocker stopping BotID's script would swap the whole sales page for the
 * error screen. A form the visitor can walk away from must not risk the page.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { trackCtaClick, trackGenerateLead } from '~/lib/analytics.client'
import { EMAIL_CONSENT_TEXT, PRIVACY_URL, SMS_CONSENT_TEXT, SMS_PENDING_NOTICE } from '~/lib/lead-funnel'
import { trackFbLead } from '~/lib/meta-pixel.client'

type LeadResponse =
  | { ok: true; code: string; terms: string; eventId: string | null; smsPending: boolean }
  | { ok?: false; error: string }

const ERRORS: Record<string, string> = {
  invalid_email: 'That email does not look right. Mind checking it?',
  invalid_phone: 'That number does not look right. Use a 10-digit US number.',
  phone_required: 'Add your number and the code is yours.',
}

function errorText(error: string): string {
  if (ERRORS[error]) return ERRORS[error]
  if (/too many/i.test(error)) return 'Too many tries from here. Give it a minute and try again.'
  return 'Something went wrong on our side. Please try again.'
}

const SEEN_KEY = 'xdipx_exit_offer_seen'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const ARM_AFTER_MS = 8_000
/** A flick counts only once they have read down the page. */
const MIN_DEPTH_PX = 800
const FLICK_PX = 250
const FLICK_WINDOW_MS = 400

function seenRecently(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(SEEN_KEY) ?? 0) < WEEK_MS
  } catch {
    return false
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()))
  } catch {
    // Private mode: it can show again next visit, which does no harm.
  }
}

const FIELD = 'mt-1 block min-h-12 w-full border border-[#BDB4AD] bg-white px-4 text-[16px] text-[#1A1616] focus:border-plum focus:outline-none'

/** `buy` is the page's own BuyForm. Its action reads the cookie /api/lead set and puts the code on the cart. */
export function ExitOffer({ slug, smsOptin, buy }: { slug: string; smsOptin: boolean; buy: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const email = useRef<HTMLInputElement>(null)
  const tracked = useRef(false)
  const [smsConsent, setSmsConsent] = useState(false)
  const [result, setResult] = useState<LeadResponse | null>(null)
  const [busy, setBusy] = useState(false)

  const success = result && 'ok' in result && result.ok ? result : null
  const error = result && !('ok' in result && result.ok) ? (result as { error: string }).error : null

  useEffect(() => {
    if (seenRecently()) return
    let armed = false
    let done = false
    let peak = 0
    let lastY = window.scrollY
    let lastAt = performance.now()
    let hiddenAt = 0
    const armTimer = window.setTimeout(() => { armed = true }, ARM_AFTER_MS)

    const open = (trigger: string) => {
      if (!armed || done) return
      done = true
      markSeen()
      dialog.current?.showModal()
      // Touch keeps the keyboard down until they tap, so the headline gets read first.
      if (window.matchMedia('(pointer: fine)').matches) email.current?.focus()
      trackCtaClick('exit_offer_shown', trigger)
    }
    // A press on any buy button means they are not leaving.
    const onSubmit = () => { done = true }
    const onMouseOut = (e: MouseEvent) => {
      if (!e.relatedTarget && e.clientY <= 0) open('cursor')
    }
    const onScroll = () => {
      const y = window.scrollY
      const now = performance.now()
      peak = Math.max(peak, y)
      if (now - lastAt >= FLICK_WINDOW_MS || y > lastY) {
        lastY = y
        lastAt = now
      } else if (peak > MIN_DEPTH_PX && lastY - y >= FLICK_PX) {
        open('flick')
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      else if (hiddenAt) open('tab_return')
    }

    document.addEventListener('submit', onSubmit, true)
    document.addEventListener('mouseout', onMouseOut)
    document.addEventListener('visibilitychange', onVisibility)
    const touch = window.matchMedia('(pointer: coarse)').matches
    if (touch) window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.clearTimeout(armTimer)
      document.removeEventListener('submit', onSubmit, true)
      document.removeEventListener('mouseout', onMouseOut)
      document.removeEventListener('visibilitychange', onVisibility)
      if (touch) window.removeEventListener('scroll', onScroll)
    }
  }, [])

  // The pixel's Lead dedupes against the server's CAPI Lead by event id.
  useEffect(() => {
    if (!success || tracked.current) return
    tracked.current = true
    if (success.eventId) trackFbLead(`curious-${slug}`, success.eventId)
    trackGenerateLead('bridge')
  }, [success, slug])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    const form = new FormData(e.currentTarget)
    setBusy(true)
    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: String(form.get('email') ?? ''),
          phone: smsOptin ? String(form.get('phone') ?? '') : '',
          smsConsent: smsOptin && smsConsent,
          slug,
          company: String(form.get('xdx_hp') ?? ''),
        }),
      })
      setResult((await res.json()) as LeadResponse)
    } catch {
      setResult({ error: 'network' })
    } finally {
      setBusy(false)
    }
  }

  const close = () => dialog.current?.close()

  return (
    <dialog
      ref={dialog}
      data-exit-offer
      aria-labelledby="exit-offer-title"
      // Tap the page behind to dismiss. A tap inside the panel lands on a child, not the dialog.
      onClick={e => { if (e.target === dialog.current) close() }}
      className="m-auto max-h-[100dvh] w-[calc(100%-32px)] max-w-[440px] overflow-y-auto border-0 border-t-[3px] border-solid border-coral bg-white p-0 text-[#1A1616] backdrop:bg-[#1A1616]/70"
    >
      <div className="relative flex flex-col gap-3.5 px-6 pb-6 pt-7">
        <button type="button" onClick={close} aria-label="Close" className="absolute right-1 top-1 flex h-11 w-11 cursor-pointer items-center justify-center border-0 bg-transparent text-[24px] leading-none text-[#3E3732]">×</button>

        {success ? (
          <div role="status" className="flex flex-col gap-3.5">
            <h2 id="exit-offer-title" className="m-0 pr-8 font-display text-[34px] font-medium leading-[1.05] tracking-[-0.015em]">Here's your <span className="italic text-plum">code.</span></h2>
            <p className="m-0 border-2 border-dashed border-coral px-4 py-3 text-center font-mono text-[28px] tracking-[0.08em]">{success.code}</p>
            <p className="m-0 text-[15px] leading-[1.5] text-[#3E3732]">{success.terms}</p>
            <p className="m-0 text-[15px] leading-[1.5] text-[#3E3732]">We saved it in this browser, so the buy buttons on this page use it for you. On another device, enter it at checkout.</p>
            {success.smsPending ? <p className="m-0 text-[15px] leading-[1.5] text-[#3E3732]">{SMS_PENDING_NOTICE}</p> : null}
            {buy}
            <button type="button" onClick={close} className="min-h-11 cursor-pointer border-0 bg-transparent text-[15px] text-[#3E3732] underline">Keep reading</button>
          </div>
        ) : (
          <form method="post" action="/api/lead" autoComplete="on" onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5">
            <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-coral">Before you close this</span>
            <h2 id="exit-offer-title" className="m-0 font-display text-[clamp(38px,9vw,46px)] font-medium leading-[1.02] tracking-[-0.02em]">Don't go <span className="italic text-plum">yet.</span></h2>
            <p className="m-0 text-[17px] leading-[1.5] text-[#3E3732] [text-wrap:pretty]">
              {smsOptin
                ? 'Leave your email and number and we’ll give you a code that takes money off your first Gawk. Use it now or come back with it later.'
                : 'Leave your email and we’ll give you a code that takes money off your first Gawk. Use it now or come back with it later.'}
            </p>

            {/* Honeypot. Not named "company": address autofill would fill that, and a real signup would vanish. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label>
                Leave this empty
                <input name="xdx_hp" type="text" tabIndex={-1} autoComplete="off" />
              </label>
            </div>

            <label className="block text-[14px] font-semibold">
              Email
              <input ref={email} name="email" type="email" autoComplete="email" inputMode="email" enterKeyHint="next" autoCapitalize="none" spellCheck={false} required maxLength={254} className={FIELD} />
            </label>
            {smsOptin ? (
              <>
                <label className="block text-[14px] font-semibold">
                  Phone
                  <input name="phone" type="tel" autoComplete="tel" inputMode="tel" enterKeyHint="done" required maxLength={32} className={FIELD} />
                </label>
                <label className="flex items-start gap-3 text-[12px] leading-relaxed text-[#3E3732]">
                  <input type="checkbox" checked={smsConsent} onChange={e => setSmsConsent(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-plum" />
                  <span>{SMS_CONSENT_TEXT}</span>
                </label>
              </>
            ) : null}

            {error ? <p role="alert" className="m-0 text-[14px] font-semibold text-coral">{errorText(error)}</p> : null}

            <button type="submit" disabled={busy} className="flex min-h-[52px] w-full cursor-pointer items-center justify-center border-0 bg-coral px-6 text-[18px] font-bold text-white hover:bg-plum disabled:opacity-60">
              {busy ? 'One moment…' : 'Show me'}
            </button>
            <button type="button" onClick={close} className="min-h-11 cursor-pointer border-0 bg-transparent text-[15px] text-[#3E3732] underline">No thanks</button>
            <p className="m-0 text-[12px] text-[#5E5650]">
              {EMAIL_CONSENT_TEXT} <a href={PRIVACY_URL} className="underline">Privacy policy</a>
            </p>
          </form>
        )}
      </div>
    </dialog>
  )
}
