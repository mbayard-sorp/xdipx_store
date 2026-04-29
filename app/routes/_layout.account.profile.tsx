import { useEffect, useId, useRef, useState } from 'react'
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import {
  data,
  useFetcher,
  useLoaderData,
  useOutletContext,
  useRevalidator,
} from 'react-router'
import { db } from '~/lib/db.server'
import { customerProfileExtras, customerAnniversaries } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { updateProfileProperties } from '~/lib/klaviyo.server'
import { requireCustomer, refreshCustomerSession } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { createCustomerAccessToken } from '~/lib/shopify.server'
import type { CustomerUpdateInput } from '~/lib/shopify.server'
import { FieldGroup, inputClass, fieldDescribedBy } from '~/components/account/FieldGroup'
import { ConfirmDialog } from '~/components/account/ConfirmDialog'
import { Toggle } from '~/components/account/Toggle'
import { Toast } from '~/components/account/Toast'
import { DangerZone } from '~/components/account/DangerZone'
import type { AccountOutletContext } from './_layout.account'

export const meta: MetaFunction = () => [{ title: 'Profile — xdipx' }, { name: 'robots', content: 'noindex, nofollow' }]

// ── Action strategy ─────────────────────────────────────────────────────────
// We return `data({ ok: true, intent }, { headers })` from the action so the
// component can display a per-intent toast AND we can attach a rotated
// Set-Cookie header (when Shopify rotates the access token after email /
// password change) without forcing a full redirect. After a successful save
// the component calls `useRevalidator().revalidate()` to re-run the parent
// `_layout.account.tsx` loader so `customer` in the outlet context refreshes.
// ─────────────────────────────────────────────────────────────────────────────

type ActionResponse =
  | { ok: true; intent: 'personal' | 'email' | 'password' | 'marketing' | 'extras' }
  | { error: string; intent?: 'personal' | 'email' | 'password' | 'marketing' | 'extras' }

export async function loader({ request }: LoaderFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)
  if (tokenType === 'account') return { extras: null, anniversaries: [] as { id: number; name: string; date: string }[] }

  const api = customerAPI({ token, tokenType })
  const profile = await api.getProfile()
  if (!profile) return { extras: null, anniversaries: [] as { id: number; name: string; date: string }[] }

  const [row, annivRows] = await Promise.all([
    db.query.customerProfileExtras.findFirst({
      where: eq(customerProfileExtras.customerGid, profile.id),
    }),
    db.select().from(customerAnniversaries)
      .where(eq(customerAnniversaries.customerGid, profile.id)),
  ])

  return {
    extras: {
      genderIdentity:     row?.genderIdentity     ?? null,
      relationshipStatus: row?.relationshipStatus ?? null,
      dateOfBirth:        row?.dateOfBirth        ?? null,
    },
    anniversaries: annivRows.map(r => ({ id: r.id, name: r.name, date: r.date })),
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)
  const api = customerAPI({ token, tokenType })
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '') as
    | 'personal'
    | 'email'
    | 'password'
    | 'marketing'
    | 'extras'
    | ''

  if (tokenType === 'account') {
    return data<ActionResponse>(
      { error: 'Profile editing isn\'t available for Shop-login sessions yet.' },
      { status: 400 },
    )
  }

  if (intent === 'personal') {
    const firstName = String(form.get('firstName') ?? '').trim()
    const lastName  = String(form.get('lastName')  ?? '').trim()
    const rawPhone = String(form.get('phone') ?? '').replace(/\D/g, '')
    // Shopify requires E.164 format. Prepend +1 for 10-digit US numbers.
    const phone = rawPhone.length === 10 ? `+1${rawPhone}` : rawPhone.length === 11 ? `+${rawPhone}` : rawPhone

    const input: CustomerUpdateInput = {
      firstName,
      lastName,
      // Empty string would be rejected by Shopify; only include phone when set.
      ...(phone ? { phone } : {}),
    }

    const result = await api.updateProfile(input)
    if ('error' in result) {
      return data<ActionResponse>({ error: result.error, intent }, { status: 400 })
    }
    return data<ActionResponse>({ ok: true, intent })
  }

  if (intent === 'email') {
    const email = String(form.get('email') ?? '').trim()
    const currentPassword = String(form.get('currentPassword') ?? '')
    if (!email) {
      return data<ActionResponse>({ error: 'Email is required.', intent }, { status: 400 })
    }

    // Re-verify current password as a safety check — the Storefront
    // `customerUpdate` mutation doesn't require it, but collecting + verifying
    // it prevents account takeover if an access token leaks.
    const profile = await api.getProfile()
    if (!profile) {
      return data<ActionResponse>(
        { error: 'Session expired — please sign in again.', intent },
        { status: 401 },
      )
    }
    const verify = await createCustomerAccessToken(profile.email, currentPassword)
    if ('error' in verify) {
      return data<ActionResponse>(
        { error: 'Current password is incorrect.', intent },
        { status: 400 },
      )
    }

    const result = await api.updateProfile({ email })
    if ('error' in result) {
      return data<ActionResponse>({ error: result.error, intent }, { status: 400 })
    }

    // Shopify rotates the access token on email change — refresh the cookie.
    if (result.accessToken) {
      const headers = await refreshCustomerSession(request, result.accessToken)
      return data<ActionResponse>({ ok: true, intent }, { headers })
    }
    return data<ActionResponse>({ ok: true, intent })
  }

  if (intent === 'password') {
    // Design note: the UI also collects "current password" for UX safety,
    // but the Storefront `customerUpdate` mutation authenticates via the
    // customer access token and does NOT accept a current-password field.
    // We re-verify the current password here by calling
    // createCustomerAccessToken(email, currentPassword) — if that fails the
    // user is shown an error and the mutation is NOT attempted. This is a
    // belt-and-suspenders safety check; bypassing it (by calling the API
    // directly) is not a privilege escalation because the attacker already
    // has the access token.
    const currentPassword = String(form.get('currentPassword') ?? '')
    const newPassword     = String(form.get('newPassword')     ?? '')
    const confirmPassword = String(form.get('confirmPassword') ?? '')

    if (!newPassword || newPassword.length < 8) {
      return data<ActionResponse>(
        { error: 'New password must be at least 8 characters.', intent },
        { status: 400 },
      )
    }
    if (newPassword !== confirmPassword) {
      return data<ActionResponse>(
        { error: 'New password and confirmation do not match.', intent },
        { status: 400 },
      )
    }

    // Re-verify current password as a safety check.
    const profile = await api.getProfile()
    if (!profile) {
      return data<ActionResponse>(
        { error: 'Session expired — please sign in again.', intent },
        { status: 401 },
      )
    }
    const verify = await createCustomerAccessToken(profile.email, currentPassword)
    if ('error' in verify) {
      return data<ActionResponse>(
        { error: 'Current password is incorrect.', intent },
        { status: 400 },
      )
    }

    const result = await api.updateProfile({ password: newPassword })
    if ('error' in result) {
      return data<ActionResponse>({ error: result.error, intent }, { status: 400 })
    }
    if (result.accessToken) {
      const headers = await refreshCustomerSession(request, result.accessToken)
      return data<ActionResponse>({ ok: true, intent }, { headers })
    }
    return data<ActionResponse>({ ok: true, intent })
  }

  if (intent === 'marketing') {
    const acceptsMarketing = form.get('acceptsMarketing') === 'on'
    const result = await api.updateProfile({ acceptsMarketing })
    if ('error' in result) {
      return data<ActionResponse>({ error: result.error, intent }, { status: 400 })
    }
    return data<ActionResponse>({ ok: true, intent })
  }

  if (intent === 'extras') {
    const genderIdentity     = String(form.get('genderIdentity')     ?? '').trim() || null
    const relationshipStatus = String(form.get('relationshipStatus') ?? '').trim() || null
    const dateOfBirth        = String(form.get('dateOfBirth')        ?? '').trim() || null
    const annivCount         = parseInt(String(form.get('anniv_count') ?? '0'), 10)

    const profile = await api.getProfile()
    if (!profile) {
      return data<ActionResponse>({ error: 'Session expired — please sign in again.', intent }, { status: 401 })
    }

    const annivRows: { customerGid: string; name: string; date: string }[] = []
    for (let i = 0; i < annivCount; i++) {
      const name = String(form.get(`anniv_name_${i}`) ?? '').trim()
      const date = String(form.get(`anniv_date_${i}`) ?? '').trim()
      if (name && date) annivRows.push({ customerGid: profile.id, name, date })
    }

    await db
      .insert(customerProfileExtras)
      .values({ customerGid: profile.id, genderIdentity, relationshipStatus, dateOfBirth, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: customerProfileExtras.customerGid,
        set: { genderIdentity, relationshipStatus, dateOfBirth, updatedAt: new Date() },
      })

    await db.delete(customerAnniversaries).where(eq(customerAnniversaries.customerGid, profile.id))
    if (annivRows.length > 0) {
      await db.insert(customerAnniversaries).values(annivRows)
    }

    void updateProfileProperties(profile.email, {
      gender_identity:     genderIdentity,
      relationship_status: relationshipStatus,
      date_of_birth:       dateOfBirth,
      anniversaries:       annivRows.length > 0
        ? JSON.stringify(annivRows.map(r => ({ name: r.name, date: r.date })))
        : null,
    })

    return data<ActionResponse>({ ok: true, intent })
  }

  return data<ActionResponse>({ error: 'Unknown intent.' }, { status: 400 })
}

// ── Component ───────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { customer, tokenType } = useOutletContext<AccountOutletContext>()
  const revalidator = useRevalidator()

  // One fetcher per card so state is independent (no contention between
  // saves), plus a dedicated fetcher for the /api/customer/delete resource.
  const { extras, anniversaries: savedAnniversaries } = useLoaderData<typeof loader>()

  const personalFetcher  = useFetcher<typeof action>()
  const emailFetcher     = useFetcher<typeof action>()
  const passwordFetcher  = useFetcher<typeof action>()
  const marketingFetcher = useFetcher<typeof action>()
  const extrasFetcher    = useFetcher<typeof action>()
  const deleteFetcher    = useFetcher<{ error?: string }>()

  type AnnivRow = { name: string; date: string }
  const [annivRows, setAnnivRows] = useState<AnnivRow[]>(
    () => savedAnniversaries ?? []
  )
  useEffect(() => { setAnnivRows(savedAnniversaries ?? []) }, [savedAnniversaries])

  // Toast state — single toast at a time (stacking is a nice-to-have).
  const [toast, setToast] = useState<{
    message: string
    variant: 'success' | 'error'
  } | null>(null)

  // Email card: toggle between plain view and inline edit form.
  const [editingEmail, setEditingEmail] = useState(false)

  // Password visibility toggles (one state each for three fields).
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew,     setShowNew]     = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // Local marketing state for the optimistic toggle.
  const [marketingLocal, setMarketingLocal] = useState(customer.acceptsMarketing)
  useEffect(() => { setMarketingLocal(customer.acceptsMarketing) }, [customer.acceptsMarketing])

  // Client-side password errors (shown inline, no server round-trip).
  const [passwordClientError, setPasswordClientError] = useState<string | null>(null)

  // Phone number formatting.
  function formatPhone(raw: string) {
    let digits = raw.replace(/\D/g, '')
    // Strip leading country code so +18187267258 → 8187267258 for display
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
    digits = digits.slice(0, 10)
    if (digits.length <= 3) return digits
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  const [phoneValue, setPhoneValue] = useState(() => formatPhone(customer.phone ?? ''))
  useEffect(() => { setPhoneValue(formatPhone(customer.phone ?? '')) }, [customer.phone])

  // Delete confirm dialog state.
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteTitleId = useId()

  // Ref to the password form so we can reset it imperatively on success
  // without reaching into the DOM via document.getElementById.
  const passwordFormRef = useRef<HTMLFormElement>(null)

  // ── Fetcher effect: personal ────────────────────────────────────────────
  useEffect(() => {
    if (personalFetcher.state !== 'idle' || !personalFetcher.data) return
    const res = personalFetcher.data
    if ('ok' in res && res.ok) {
      setToast({ message: 'Saved ♥', variant: 'success' })
      revalidator.revalidate()
    }
  }, [personalFetcher.state, personalFetcher.data, revalidator])

  // ── Fetcher effect: email ───────────────────────────────────────────────
  useEffect(() => {
    if (emailFetcher.state !== 'idle' || !emailFetcher.data) return
    const res = emailFetcher.data
    if ('ok' in res && res.ok) {
      setToast({ message: 'Email updated ♥', variant: 'success' })
      setEditingEmail(false)
      revalidator.revalidate()
    }
  }, [emailFetcher.state, emailFetcher.data, revalidator])

  // ── Fetcher effect: password ────────────────────────────────────────────
  useEffect(() => {
    if (passwordFetcher.state !== 'idle' || !passwordFetcher.data) return
    const res = passwordFetcher.data
    if ('ok' in res && res.ok) {
      setToast({ message: 'Password updated ♥', variant: 'success' })
      // Reset the form via the ref — no DOM reach needed.
      passwordFormRef.current?.reset()
      setShowCurrent(false)
      setShowNew(false)
      setShowConfirm(false)
      setPasswordClientError(null)
      // Shopify rotates the access token on password change — re-run the
      // parent loader so the outlet context picks up the fresh profile
      // under the new token. (Matches the email-success branch above.)
      revalidator.revalidate()
    }
  }, [passwordFetcher.state, passwordFetcher.data, revalidator])

  // ── Fetcher effect: marketing (optimistic w/ revert on error) ───────────
  useEffect(() => {
    if (marketingFetcher.state !== 'idle' || !marketingFetcher.data) return
    const res = marketingFetcher.data
    if ('error' in res && res.error) {
      // Server rejected the change — revert local state.
      setMarketingLocal(customer.acceptsMarketing)
      setToast({ message: res.error, variant: 'error' })
    } else if ('ok' in res && res.ok) {
      revalidator.revalidate()
    }
  }, [marketingFetcher.state, marketingFetcher.data, customer.acceptsMarketing, revalidator])

  // ── Fetcher effect: extras ──────────────────────────────────────────────
  useEffect(() => {
    if (extrasFetcher.state !== 'idle' || !extrasFetcher.data) return
    const res = extrasFetcher.data
    if ('ok' in res && res.ok) {
      setToast({ message: 'Saved ♥', variant: 'success' })
      revalidator.revalidate()
    } else if ('error' in res && res.error) {
      setToast({ message: res.error, variant: 'error' })
    }
  }, [extrasFetcher.state, extrasFetcher.data, revalidator])

  // ── Error reads (for inline alerts on each card) ─────────────────────────
  const personalError =
    personalFetcher.data && 'error' in personalFetcher.data ? personalFetcher.data.error : null
  const emailError =
    emailFetcher.data && 'error' in emailFetcher.data ? emailFetcher.data.error : null
  const passwordServerError =
    passwordFetcher.data && 'error' in passwordFetcher.data ? passwordFetcher.data.error : null
  const passwordError = passwordClientError ?? passwordServerError
  const deleteError = deleteFetcher.data?.error ?? null
  const extrasError =
    extrasFetcher.data && 'error' in extrasFetcher.data ? extrasFetcher.data.error : null

  // Handlers
  function handleMarketingToggle(next: boolean) {
    setMarketingLocal(next)
    // NOTE: a native HTML checkbox submits no field when unchecked, but
    // fetcher.submit({...}) always serializes the object as form data — so
    // we send an explicit 'off' string for the "unsubscribe" case. The server
    // reads `form.get('acceptsMarketing') === 'on'`, which maps 'off' → false.
    marketingFetcher.submit(
      { intent: 'marketing', acceptsMarketing: next ? 'on' : 'off' },
      { method: 'post' },
    )
  }

  function handlePasswordSubmit(e: React.FormEvent<HTMLFormElement>) {
    // Read fields via FormData instead of casting form.elements.namedItem,
    // which was unsafe (null → .value throws with no UI feedback).
    const fd = new FormData(e.currentTarget)
    const newPassword     = String(fd.get('newPassword')     ?? '')
    const confirmPassword = String(fd.get('confirmPassword') ?? '')
    if (newPassword.length < 8) {
      e.preventDefault()
      setPasswordClientError('New password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      e.preventDefault()
      setPasswordClientError('New password and confirmation do not match.')
      return
    }
    setPasswordClientError(null)
  }

  function handleDeleteConfirm() {
    setConfirmDelete(false)
    deleteFetcher.submit(null, { method: 'post', action: '/api/customer/delete' })
  }

  // ── Account-API branch: show read-only notice + hide all cards ──────────
  if (tokenType === 'account') {
    return (
      <div className="space-y-6">
        <PageHeading email={customer.email} />

        <div className="bg-white border border-cream-2 rounded-2xl px-6 py-8 text-center space-y-3">
          <p
            className="text-base font-semibold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Profile editing isn't available for Shop-login sessions yet <span className="text-sage">♥</span>
          </p>
          <p className="text-sm text-ink/60">
            Sign in with email and password to edit your profile details.
          </p>
        </div>

        <section className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
          <h2
            className="text-base font-bold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Email
          </h2>
          <p className="text-sm text-ink/80">{customer.email}</p>
        </section>
      </div>
    )
  }

  // ── Storefront branch: the real page ────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeading email={customer.email} />

      {/* Card 1 — Personal details */}
      <section className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
        <h2
          className="text-base font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Personal details
        </h2>

        <personalFetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="personal" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldGroup id="firstName" label="First name">
              <input
                id="firstName"
                name="firstName"
                type="text"
                autoComplete="given-name"
                defaultValue={customer.firstName}
                className={inputClass}
              />
            </FieldGroup>
            <FieldGroup id="lastName" label="Last name">
              <input
                id="lastName"
                name="lastName"
                type="text"
                autoComplete="family-name"
                defaultValue={customer.lastName}
                className={inputClass}
              />
            </FieldGroup>
          </div>

          <FieldGroup id="phone" label="Phone" helper="Optional. We only use this for shipping updates.">
            {/* Hidden input sends raw digits so Shopify receives e.g. +15555555555 */}
            <input type="hidden" name="phone" value={phoneValue.replace(/\D/g, '')} />
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              value={phoneValue}
              onChange={e => setPhoneValue(formatPhone(e.target.value))}
              aria-describedby={fieldDescribedBy('phone', 'Optional. We only use this for shipping updates.', undefined)}
              className={inputClass}
              placeholder="(555) 555-5555"
            />
          </FieldGroup>

          {personalError && (
            <p role="alert" className="text-sm text-red-600">{personalError}</p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={personalFetcher.state !== 'idle'}
              className="px-5 py-2.5 rounded-full text-sm font-bold text-white bg-coral hover:opacity-90 transition-opacity disabled:opacity-60"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {personalFetcher.state !== 'idle' ? 'Saving…' : 'Save ♥'}
            </button>
          </div>
        </personalFetcher.Form>
      </section>

      {/* Card 2 — Tell us about you */}
      <section className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
        <div>
          <h2
            className="text-base font-bold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Tell us about you
          </h2>
          <p className="text-xs text-ink/50 mt-0.5">
            Helps us personalize your deals <span className="text-sage">♥</span>
          </p>
        </div>

        <extrasFetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="extras" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldGroup id="genderIdentity" label="Gender identity">
              <select
                id="genderIdentity"
                name="genderIdentity"
                defaultValue={extras?.genderIdentity ?? ''}
                className={inputClass}
              >
                <option value="">Prefer not to say</option>
                <option value="Man">Man</option>
                <option value="Woman">Woman</option>
                <option value="Other">Other</option>
              </select>
            </FieldGroup>

            <FieldGroup id="relationshipStatus" label="Relationship status">
              <select
                id="relationshipStatus"
                name="relationshipStatus"
                defaultValue={extras?.relationshipStatus ?? ''}
                className={inputClass}
              >
                <option value="">Prefer not to say</option>
                <option value="Single">Single</option>
                <option value="In a Relationship">In a Relationship</option>
                <option value="Other">Other</option>
              </select>
            </FieldGroup>
          </div>

          <FieldGroup id="dateOfBirth" label="Date of birth">
            <input
              id="dateOfBirth"
              name="dateOfBirth"
              type="date"
              defaultValue={extras?.dateOfBirth ?? ''}
              className={inputClass}
            />
          </FieldGroup>
          <p className="text-xs text-ink/40 -mt-2">
            xdipx.com accounts are only available for customers 18 years or over.
          </p>

          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Anniversaries</p>
            <input type="hidden" name="anniv_count" value={annivRows.length} />

            {annivRows.map((row, i) => (
              <div key={i} className="flex gap-2 items-start">
                <div className="flex-1">
                  <input
                    name={`anniv_name_${i}`}
                    type="text"
                    placeholder="Label (e.g. Wedding)"
                    value={row.name}
                    onChange={e => setAnnivRows(prev => prev.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
                    className={inputClass}
                  />
                </div>
                <div className="flex-1">
                  <input
                    name={`anniv_date_${i}`}
                    type="date"
                    value={row.date}
                    onChange={e => setAnnivRows(prev => prev.map((r, j) => j === i ? { ...r, date: e.target.value } : r))}
                    className={inputClass}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setAnnivRows(prev => prev.filter((_, j) => j !== i))}
                  className="mt-3 text-ink/30 hover:text-red-400 transition-colors text-lg leading-none"
                  aria-label="Remove anniversary"
                >
                  ×
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => setAnnivRows(prev => [...prev, { name: '', date: '' }])}
              className="text-sm text-sage hover:text-sun transition-colors font-medium"
            >
              + Add anniversary
            </button>
          </div>

          {extrasError && (
            <p role="alert" className="text-sm text-red-600">{extrasError}</p>
          )}

          <p className="text-xs text-ink/40 leading-relaxed">
            We never share this information with any other companies for marketing purposes other than our own.
            This helps us give you a better experience of the xdipx.com website, and also lets us provide you
            with information about products and topics that are most relevant to you.
          </p>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={extrasFetcher.state !== 'idle'}
              className="px-5 py-2.5 rounded-full text-sm font-bold text-white bg-coral hover:opacity-90 transition-opacity disabled:opacity-60"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {extrasFetcher.state !== 'idle' ? 'Saving…' : 'Save ♥'}
            </button>
          </div>
        </extrasFetcher.Form>
      </section>

      {/* Card 3 — Email */}

      <section className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
        <h2
          className="text-base font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Email
        </h2>

        {!editingEmail ? (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-ink/80 break-all">{customer.email}</p>
            <button
              type="button"
              onClick={() => setEditingEmail(true)}
              className="shrink-0 px-4 py-2 rounded-full text-sm font-semibold text-ink bg-cream-2 hover:bg-cream-2/70 transition-colors"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Change email
            </button>
          </div>
        ) : (
          <emailFetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="email" />

            <FieldGroup id="email" label="New email">
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                defaultValue={customer.email}
                className={inputClass}
              />
            </FieldGroup>

            <FieldGroup
              id="emailCurrentPassword"
              label="Current password"
              helper="Required by Shopify to change your email."
            >
              <input
                id="emailCurrentPassword"
                name="currentPassword"
                type="password"
                required
                autoComplete="current-password"
                aria-describedby={fieldDescribedBy('emailCurrentPassword', 'Required by Shopify to change your email.', undefined)}
                className={inputClass}
              />
            </FieldGroup>

            {emailError && (
              <p role="alert" className="text-sm text-red-600">{emailError}</p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingEmail(false)}
                className="px-4 py-2.5 rounded-full text-sm font-semibold text-ink bg-cream-2 hover:bg-cream-2/70 transition-colors"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={emailFetcher.state !== 'idle'}
                className="px-5 py-2.5 rounded-full text-sm font-bold text-white bg-coral hover:opacity-90 transition-opacity disabled:opacity-60"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {emailFetcher.state !== 'idle' ? 'Updating…' : 'Update email'}
              </button>
            </div>
          </emailFetcher.Form>
        )}
      </section>

      {/* Card 4 — Password */}
      <section className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
        <h2
          className="text-base font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Password
        </h2>

        <passwordFetcher.Form
          ref={passwordFormRef}
          method="post"
          className="space-y-4"
          onSubmit={handlePasswordSubmit}
        >
          <input type="hidden" name="intent" value="password" />

          <FieldGroup id="currentPassword" label="Current password">
            <PasswordField
              id="currentPassword"
              name="currentPassword"
              autoComplete="current-password"
              visible={showCurrent}
              onToggleVisible={() => setShowCurrent((v) => !v)}
            />
          </FieldGroup>

          <FieldGroup id="newPassword" label="New password" helper="At least 8 characters.">
            <PasswordField
              id="newPassword"
              name="newPassword"
              autoComplete="new-password"
              describedBy={fieldDescribedBy('newPassword', 'At least 8 characters.', undefined)}
              visible={showNew}
              onToggleVisible={() => setShowNew((v) => !v)}
            />
          </FieldGroup>

          <FieldGroup id="confirmPassword" label="Confirm new password">
            <PasswordField
              id="confirmPassword"
              name="confirmPassword"
              autoComplete="new-password"
              visible={showConfirm}
              onToggleVisible={() => setShowConfirm((v) => !v)}
            />
          </FieldGroup>

          {passwordError && (
            <p role="alert" className="text-sm text-red-600">{passwordError}</p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={passwordFetcher.state !== 'idle'}
              className="px-5 py-2.5 rounded-full text-sm font-bold text-white bg-coral hover:opacity-90 transition-opacity disabled:opacity-60"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {passwordFetcher.state !== 'idle' ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </passwordFetcher.Form>
      </section>

      {/* Card 5 — Marketing */}
      <section className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
        <h2
          className="text-base font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Marketing
        </h2>

        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p
              id="marketing-label"
              className="text-sm font-semibold text-ink"
            >
              Email me about deals and drops <span className="text-sage">♥</span>
            </p>
            <p className="text-xs text-ink/60 mt-0.5">
              One deal a day, midnight sharp. Unsubscribe anytime.
            </p>
          </div>
          <Toggle
            checked={marketingLocal}
            onChange={handleMarketingToggle}
            labelId="marketing-label"
            disabled={marketingFetcher.state !== 'idle'}
          />
        </div>
      </section>

      {/* Card 6 — Danger zone */}

      <DangerZone>
        <h2
          className="text-base font-bold text-red-700"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Danger zone
        </h2>
        <p className="text-xs text-ink/70 leading-relaxed">
          This removes your profile, addresses, and marketing subscriptions.
          Past orders stay with xdipx for tax and shipping records. This can't
          be undone <span className="text-sage">♥</span>
        </p>

        {deleteError && (
          <p role="alert" className="text-sm text-red-600">{deleteError}</p>
        )}

        <div>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={deleteFetcher.state !== 'idle'}
            className="px-5 py-2.5 rounded-full text-sm font-bold text-red-700 bg-cream-2 hover:bg-cream-2/70 border border-red-200 transition-colors disabled:opacity-60"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {deleteFetcher.state !== 'idle' ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
      </DangerZone>

      <ConfirmDialog
        open={confirmDelete}
        titleId={deleteTitleId}
        title="Delete your account?"
        description="This removes your profile, addresses, and marketing subscriptions. Past orders stay with xdipx for tax and shipping records. This can't be undone."
        confirmLabel="Yes, delete my account"
        cancelLabel="Keep my account"
        variant="destructive"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDelete(false)}
      />

      {toast && (
        <Toast
          message={toast.message}
          variant={toast.variant}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  )
}

// ── Small helpers ───────────────────────────────────────────────────────────

function PageHeading({ email }: { email: string }) {
  return (
    <section className="hidden lg:block">
      <h1
        className="text-2xl font-bold text-ink"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Profile <span className="text-sage">♥</span>
      </h1>
      <p className="text-sm text-ink/50 mt-0.5">{email}</p>
    </section>
  )
}

interface PasswordFieldProps {
  id: string
  name: string
  autoComplete: string
  visible: boolean
  onToggleVisible: () => void
  describedBy?: string | undefined
}

/**
 * Password input with an inline show/hide eye toggle. Kept inline in this
 * route per the phase spec (no dedicated PasswordInput component).
 */
function PasswordField({
  id,
  name,
  autoComplete,
  visible,
  onToggleVisible,
  describedBy,
}: PasswordFieldProps) {
  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        required
        {...(describedBy ? { 'aria-describedby': describedBy } : {})}
        className={`${inputClass} pr-12`}
      />
      <button
        type="button"
        onClick={onToggleVisible}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex items-center justify-center w-11 text-ink/60 hover:text-ink"
      >
        {visible ? (
          <svg aria-hidden="true" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2.46 3.54a.75.75 0 011.08-1.08l14 14a.75.75 0 01-1.08 1.08l-2.05-2.05A9.8 9.8 0 0110 16.25C5.5 16.25 1.74 13.24.46 10a10.1 10.1 0 013.1-4.4L2.46 3.54zM10 6.25c.5 0 .97.1 1.4.28L9.53 8.4A1.75 1.75 0 008.4 9.53L6.53 7.66A3.74 3.74 0 0110 6.25zm0 7.5c-.5 0-.97-.1-1.4-.28l1.87-1.87a1.75 1.75 0 001.13-1.13l1.87 1.87A3.74 3.74 0 0110 13.75z" />
            <path d="M13.47 11.28A3.74 3.74 0 0010 6.25a3.8 3.8 0 00-1.15.18l5.14 5.14c.04-.1.08-.2.1-.29zM10 3.75A9.8 9.8 0 0116.44 6.1 10.1 10.1 0 0119.54 10a10 10 0 01-3.15 4.43l-1.43-1.43A8.27 8.27 0 0017.9 10 8.27 8.27 0 0010 5.25c-.6 0-1.2.06-1.77.17L6.89 3.92A9.8 9.8 0 0110 3.75z" />
          </svg>
        ) : (
          <svg aria-hidden="true" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 3.75C5.5 3.75 1.74 6.76.46 10c1.28 3.24 5.04 6.25 9.54 6.25s8.26-3.01 9.54-6.25C18.26 6.76 14.5 3.75 10 3.75zm0 10.5a4.25 4.25 0 110-8.5 4.25 4.25 0 010 8.5z" />
            <circle cx="10" cy="10" r="2.25" />
          </svg>
        )}
      </button>
    </div>
  )
}
