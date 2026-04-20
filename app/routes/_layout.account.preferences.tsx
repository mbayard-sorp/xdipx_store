import { useEffect, useId, useRef, useState } from 'react'
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useRevalidator,
} from 'react-router'
import { requireCustomer } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import {
  getProfileSubscriptions,
  subscribeToList,
  unsubscribeFromList,
} from '~/lib/klaviyo.server'
import { Toggle } from '~/components/account/Toggle'
import { Toast } from '~/components/account/Toast'
import { ConfirmDialog } from '~/components/account/ConfirmDialog'

export const meta: MetaFunction = () => [{ title: 'Preferences — xdipx' }]

// ── Types + copy constants ───────────────────────────────────────────────────

type PreferenceKey = 'daily_deal' | 'waitlist'

interface PreferenceRow {
  listId: string
  key: PreferenceKey
  label: string
  description: string
  subscribed: boolean
}

type ActionResponse =
  | { ok: true; intent: 'toggle'; listId: string; subscribed: boolean }
  | { ok: true; intent: 'unsubscribe-all' }
  | { error: string; intent?: 'toggle' | 'unsubscribe-all'; listId?: string }

// Copy for each row lives at module scope so the loader AND the success-toast
// effects can reference it without passing `rows` through the effect deps
// (which would cause the success handler to re-fire after revalidate()).
const ROW_LABELS: Record<PreferenceKey, string> = {
  daily_deal: 'One deal a day, delivered ♥',
  waitlist:   'Back-in-stock alerts',
}
const ROW_DESCRIPTIONS: Record<PreferenceKey, string> = {
  daily_deal: "Tonight's drop, in your inbox at midnight.",
  waitlist:   "We'll email you the moment a waitlisted product returns.",
}

// ── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)
  const api = customerAPI({ token, tokenType })
  const profile = await api.getProfile()
  if (!profile) throw redirect('/account/login')

  const subs = await getProfileSubscriptions(profile.email)

  // Build a map from listId → subscribed for easy lookup
  const subsMap = new Map(subs.map(s => [s.listId, s.subscribed]))

  const DAILY_DEAL_LIST_ID = process.env['KLAVIYO_LIST_ID_DAILY_DEAL']
  const WAITLIST_LIST_ID   = process.env['KLAVIYO_LIST_ID_WAITLIST']

  const rows: PreferenceRow[] = []

  if (DAILY_DEAL_LIST_ID) {
    rows.push({
      listId: DAILY_DEAL_LIST_ID,
      key: 'daily_deal',
      label: ROW_LABELS.daily_deal,
      description: ROW_DESCRIPTIONS.daily_deal,
      subscribed: subsMap.get(DAILY_DEAL_LIST_ID) ?? false,
    })
  }

  if (WAITLIST_LIST_ID) {
    rows.push({
      listId: WAITLIST_LIST_ID,
      key: 'waitlist',
      label: ROW_LABELS.waitlist,
      description: ROW_DESCRIPTIONS.waitlist,
      subscribed: subsMap.get(WAITLIST_LIST_ID) ?? false,
    })
  }

  return { email: profile.email, rows }
}

// ── Action ───────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)
  const api = customerAPI({ token, tokenType })
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')

  if (intent === 'toggle') {
    const listId     = String(form.get('listId') ?? '')
    const subscribed = String(form.get('subscribed') ?? '') === 'on'

    const profile = await api.getProfile()
    if (!profile) {
      return data<ActionResponse>(
        { error: 'Session expired — please sign in again.', intent: 'toggle', listId },
        { status: 401 },
      )
    }

    // We call subscribeToList / unsubscribeFromList DIRECTLY instead of going
    // through `updatePreferences`, which internally swallows per-entry errors.
    // The account-delete flow wants best-effort cleanup; /account/preferences
    // wants the opposite — if Klaviyo rejects the call, the user should see it.
    try {
      if (subscribed) {
        await subscribeToList(listId, profile.email)
      } else {
        await unsubscribeFromList(listId, profile.email)
      }
    } catch (err) {
      console.error('[preferences.toggle] failed:', err)
      return data<ActionResponse>(
        { error: 'Could not update that preference. Please try again.', intent: 'toggle', listId },
        { status: 500 },
      )
    }

    return data<ActionResponse>({ ok: true, intent: 'toggle', listId, subscribed })
  }

  if (intent === 'unsubscribe-all') {
    const profile = await api.getProfile()
    if (!profile) {
      return data<ActionResponse>(
        { error: 'Session expired — please sign in again.', intent: 'unsubscribe-all' },
        { status: 401 },
      )
    }

    // Same reason as `toggle`: the library `unsubscribeAll` is best-effort and
    // would report success even when every call fails. Expand the known list
    // ids inline and track per-list failures so the UI can tell the truth.
    const knownListIds = [
      process.env['KLAVIYO_LIST_ID_DAILY_DEAL'],
      process.env['KLAVIYO_LIST_ID_WAITLIST'],
    ].filter((id): id is string => !!id)

    const failures: string[] = []
    for (const listId of knownListIds) {
      try {
        await unsubscribeFromList(listId, profile.email)
      } catch (err) {
        console.error(`[preferences.unsubscribe-all] failed for list=${listId}:`, err)
        failures.push(listId)
      }
    }
    if (failures.length > 0) {
      return data<ActionResponse>(
        { error: 'Could not unsubscribe from all lists. Please try again.', intent: 'unsubscribe-all' },
        { status: 500 },
      )
    }

    return data<ActionResponse>({ ok: true, intent: 'unsubscribe-all' })
  }

  return data<ActionResponse>({ error: 'Unknown intent.' }, { status: 400 })
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PreferencesPage() {
  const { email, rows } = useLoaderData<typeof loader>()
  const revalidator = useRevalidator()

  // Per-row fetchers — must call hooks unconditionally (one per known row)
  const dailyDealFetcher = useFetcher<typeof action>()
  const waitlistFetcher  = useFetcher<typeof action>()
  const unsubAllFetcher  = useFetcher<typeof action>()

  // Optimistic local subscription state, keyed by listId
  const [localSubs, setLocalSubs] = useState<Record<string, boolean>>(
    () => Object.fromEntries(rows.map(r => [r.listId, r.subscribed])),
  )

  // Re-sync localSubs from loader after revalidation — but NEVER while a
  // fetcher is in-flight. Otherwise one fetcher's success → revalidate() →
  // rows change would stomp a second fetcher's still-pending optimistic state.
  useEffect(() => {
    if (dailyDealFetcher.state !== 'idle' || waitlistFetcher.state !== 'idle') return
    setLocalSubs(Object.fromEntries(rows.map(r => [r.listId, r.subscribed])))
  }, [rows, dailyDealFetcher.state, waitlistFetcher.state])

  // Track pre-submit values so we can revert on error accurately.
  // A Map keyed by listId lets each row keep its own snapshot.
  const prevByList = useRef<Map<string, boolean>>(new Map())

  // Toast state
  const [toast, setToast] = useState<{
    message: string
    variant: 'success' | 'error'
  } | null>(null)

  // Unsubscribe-all confirm dialog
  const [confirmUnsubAll, setConfirmUnsubAll] = useState(false)
  const unsubAllTitleId = useId()

  // Unique id base for aria-labelledby
  const baseId = useId()

  // ── Fetcher helpers ──────────────────────────────────────────────────────

  function fetcherForRow(key: PreferenceKey) {
    return key === 'daily_deal' ? dailyDealFetcher : waitlistFetcher
  }

  function handleToggle(row: PreferenceRow) {
    const fetcher = fetcherForRow(row.key)
    const next = !(localSubs[row.listId] ?? false)
    // Only record the pre-submit snapshot when the fetcher is idle. On rapid
    // double-clicks the in-flight submission is cancelled and replaced with
    // the new one, so the correct "revert target" is STILL the pre-first-click
    // value, not the already-optimistic state from the previous press.
    if (fetcher.state === 'idle') {
      prevByList.current.set(row.listId, localSubs[row.listId] ?? false)
    }
    // Optimistic update
    setLocalSubs(prev => ({ ...prev, [row.listId]: next }))
    fetcher.submit(
      { intent: 'toggle', listId: row.listId, subscribed: next ? 'on' : 'off' },
      { method: 'post' },
    )
  }

  // ── Fetcher effects: state-transition guards ────────────────────────────
  //
  // React Router persists `fetcher.data` after completion, and calling
  // `revalidator.revalidate()` inside the success branch triggers a second
  // render with the SAME fetcher.data + the SAME idle state. Without a guard,
  // the effect would fire twice — double-toasting and double-revalidating.
  //
  // Solution: stash the previous state in a ref and only act on the
  // `submitting/loading → idle` transition.
  const dailyDealPrevState = useRef(dailyDealFetcher.state)
  const waitlistPrevState  = useRef(waitlistFetcher.state)
  const unsubAllPrevState  = useRef(unsubAllFetcher.state)

  // Shared toggle-fetcher handler so the two toggle effects stay identical.
  function handleToggleResult(
    key: PreferenceKey,
    res: NonNullable<typeof dailyDealFetcher.data>,
  ) {
    if ('error' in res && res.error) {
      // Revert to pre-submit value
      if (res.listId !== undefined) {
        const prevVal = prevByList.current.get(res.listId)
        if (prevVal !== undefined) {
          const listId = res.listId
          setLocalSubs(prev => ({ ...prev, [listId]: prevVal }))
        }
      }
      setToast({ message: res.error, variant: 'error' })
      return
    }
    if ('ok' in res && res.ok && res.intent === 'toggle') {
      setToast({ message: `${ROW_LABELS[key]} updated ♥`, variant: 'success' })
      revalidator.revalidate()
    }
  }

  // ── Fetcher effect: daily deal toggle ────────────────────────────────────
  useEffect(() => {
    const prev = dailyDealPrevState.current
    dailyDealPrevState.current = dailyDealFetcher.state
    if (prev === 'idle' || dailyDealFetcher.state !== 'idle') return
    if (!dailyDealFetcher.data) return
    handleToggleResult('daily_deal', dailyDealFetcher.data)
    // handleToggleResult + revalidator are stable-enough for this file;
    // adding them to deps would re-fire and defeat the transition guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyDealFetcher.state, dailyDealFetcher.data])

  // ── Fetcher effect: waitlist toggle ──────────────────────────────────────
  useEffect(() => {
    const prev = waitlistPrevState.current
    waitlistPrevState.current = waitlistFetcher.state
    if (prev === 'idle' || waitlistFetcher.state !== 'idle') return
    if (!waitlistFetcher.data) return
    handleToggleResult('waitlist', waitlistFetcher.data)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitlistFetcher.state, waitlistFetcher.data])

  // ── Fetcher effect: unsubscribe-all ──────────────────────────────────────
  useEffect(() => {
    const prev = unsubAllPrevState.current
    unsubAllPrevState.current = unsubAllFetcher.state
    if (prev === 'idle' || unsubAllFetcher.state !== 'idle') return
    if (!unsubAllFetcher.data) return
    const res = unsubAllFetcher.data
    if ('error' in res && res.error) {
      setToast({ message: res.error, variant: 'error' })
      return
    }
    if ('ok' in res && res.ok) {
      // Flip every localSubs to false
      setLocalSubs(prev => Object.fromEntries(Object.keys(prev).map(k => [k, false])))
      setToast({ message: "You've been unsubscribed from everything ♥", variant: 'success' })
      revalidator.revalidate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unsubAllFetcher.state, unsubAllFetcher.data])

  function handleUnsubAllConfirm() {
    setConfirmUnsubAll(false)
    unsubAllFetcher.submit({ intent: 'unsubscribe-all' }, { method: 'post' })
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeading email={email} />

      {/* Main card — Email updates */}
      <section className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
        <h2
          className="text-base font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Email updates
        </h2>

        {rows.length === 0 ? (
          <p className="text-sm text-ink/60 py-2">
            No email preferences configured yet.
          </p>
        ) : (
          <div className="divide-y divide-cream-2">
            {rows.map((row) => {
              const fetcher = fetcherForRow(row.key)
              const labelId = `${baseId}-${row.key}`
              const isDisabled = fetcher.state !== 'idle' || unsubAllFetcher.state !== 'idle'

              return (
                <div
                  key={row.listId}
                  className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <p
                      id={labelId}
                      className="text-sm font-semibold text-ink"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      {row.label}
                    </p>
                    <p className="text-xs text-ink/60 mt-0.5">
                      {row.description}
                    </p>
                  </div>
                  <Toggle
                    checked={localSubs[row.listId] ?? false}
                    onChange={() => handleToggle(row)}
                    labelId={labelId}
                    disabled={isDisabled}
                  />
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Unsubscribe from all — soft CTA block */}
      <section className="bg-cream-2/50 rounded-2xl p-5 space-y-3 text-center">
        <p className="text-sm text-ink/60">
          We never share your email. Unsubscribe from everything with one tap{' '}
          <span className="text-sage">♥</span>
        </p>
        <div>
          <button
            type="button"
            onClick={() => setConfirmUnsubAll(true)}
            disabled={unsubAllFetcher.state !== 'idle'}
            className="px-5 py-2.5 rounded-full text-sm font-bold text-red-700 bg-white hover:bg-white/80 border border-red-200 transition-colors disabled:opacity-60"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {unsubAllFetcher.state !== 'idle' ? 'Unsubscribing…' : 'Unsubscribe from all'}
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmUnsubAll}
        titleId={unsubAllTitleId}
        title="Unsubscribe from everything?"
        description="You'll stop getting daily deals and back-in-stock alerts. You can re-subscribe anytime from this page."
        confirmLabel="Yes, unsubscribe"
        cancelLabel="Keep my subscriptions"
        variant="destructive"
        onConfirm={handleUnsubAllConfirm}
        onCancel={() => setConfirmUnsubAll(false)}
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

// ── Small helpers ─────────────────────────────────────────────────────────────

function PageHeading({ email }: { email: string }) {
  return (
    <section className="hidden lg:block">
      <h1
        className="text-2xl font-bold text-ink"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Preferences <span className="text-sage">♥</span>
      </h1>
      <p className="text-sm text-ink/50 mt-0.5">{email}</p>
    </section>
  )
}
