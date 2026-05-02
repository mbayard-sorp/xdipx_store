/**
 * /admin/sms-tester — local SMS conversation simulator.
 *
 * Routes inbound text + a "from" phone through processSmsMessage() with
 * simulated: true. Skips Twilio signature verification but enforces every
 * other production gate (STOP/HELP/age, opt-out, rate limit, Claude). Rows
 * are tagged simulated=true in sms_messages so they never bleed into a real
 * customer's history loader.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from 'react-router'
import { useEffect, useRef } from 'react'
import { and, asc, eq } from 'drizzle-orm'
import { requireAdmin } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { smsAgeConsent, smsMessages, smsOptouts } from '../../db/schema'
import { processSmsMessage, type ProcessSmsResult } from '~/lib/sms-processor.server'
import { processSmsMessageV2 } from '~/lib/sms-v2/processor.server'
import { withTurnLogging } from '~/lib/sms-v2/turn-logger.server'
import { pickPipelineVersion } from '~/lib/sms-v2/pipeline-flag.server'

export const meta: MetaFunction = () => [{ title: 'SMS Tester — xdipx Admin' }]

interface ThreadMessage {
  id: number
  direction: 'inbound' | 'outbound'
  body: string
  mediaUrl: string | null
  createdAt: string
}

interface PhoneState {
  ageConsented: boolean
  optedOut: boolean
}

interface LoaderData {
  phone: string
  thread: ThreadMessage[]
  state: PhoneState
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const phone = (url.searchParams.get('phone') ?? '').trim()

  let thread: ThreadMessage[] = []
  let state: PhoneState = { ageConsented: false, optedOut: false }

  if (phone) {
    const rows = await db
      .select({
        id: smsMessages.id,
        direction: smsMessages.direction,
        body: smsMessages.body,
        mediaUrl: smsMessages.mediaUrl,
        createdAt: smsMessages.createdAt,
      })
      .from(smsMessages)
      .where(and(eq(smsMessages.phone, phone), eq(smsMessages.simulated, true)))
      .orderBy(asc(smsMessages.createdAt))
      .limit(100)

    thread = rows.map((r) => ({
      id: r.id,
      direction: r.direction === 'inbound' ? 'inbound' : 'outbound',
      body: r.body,
      mediaUrl: r.mediaUrl,
      createdAt: r.createdAt.toISOString(),
    }))

    const [consent, optout] = await Promise.all([
      db.select({ phone: smsAgeConsent.phone }).from(smsAgeConsent).where(eq(smsAgeConsent.phone, phone)).limit(1),
      db.select({ id: smsOptouts.id }).from(smsOptouts).where(eq(smsOptouts.phone, phone)).limit(1),
    ])
    state = { ageConsented: consent.length > 0, optedOut: optout.length > 0 }
  }

  return { phone, thread, state } satisfies LoaderData
}

interface ActionData {
  ok: boolean
  outcome?: ProcessSmsResult['outcome']
  reply?: string | null
  phone?: string
  error?: string
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? 'send')
  const phone = String(form.get('phone') ?? '').trim()

  if (!phone) return { ok: false, error: 'phone is required' } satisfies ActionData

  if (intent === 'reset') {
    // Wipe simulated thread + age-consent + opt-out for this phone so the
    // next test starts fresh from age-gate.
    await db.delete(smsMessages).where(and(eq(smsMessages.phone, phone), eq(smsMessages.simulated, true)))
    await db.delete(smsAgeConsent).where(eq(smsAgeConsent.phone, phone))
    await db.delete(smsOptouts).where(eq(smsOptouts.phone, phone))
    return { ok: true, phone, outcome: 'empty' } satisfies ActionData
  }

  const body = String(form.get('body') ?? '').trim()
  if (!body) return { ok: false, error: 'body is required', phone } satisfies ActionData

  const version = pickPipelineVersion(phone)
  const processFn = version === 'v2' ? processSmsMessageV2 : processSmsMessage

  const result = await withTurnLogging(
    { from: phone, body, simulated: true },
    processFn,
    version,
  )
  return {
    ok: true,
    outcome: result.outcome,
    reply: result.reply,
    phone,
  } satisfies ActionData
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function SmsTester() {
  const { phone, thread, state } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'
  const [params] = useSearchParams()
  const phoneFromUrl = params.get('phone') ?? phone

  const sendFormRef = useRef<HTMLFormElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // Clear the message textarea once the action settles. navigation.state
  // returns to 'idle' after the submit completes — at that point the new
  // turn is in the thread and the input should reset.
  useEffect(() => {
    if (navigation.state === 'idle' && bodyRef.current) {
      bodyRef.current.value = ''
    }
  }, [navigation.state])

  // Submit on Enter; Shift+Enter inserts a newline (standard chat UX).
  function onBodyKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      const trimmed = e.currentTarget.value.trim()
      if (!trimmed || !phoneFromUrl) return
      sendFormRef.current?.requestSubmit()
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 font-body text-ink">
      <h1 className="font-display text-2xl font-bold mb-2">SMS Tester</h1>
      <p className="text-muted text-sm mb-6">
        Talk to Emma over a simulated SMS thread — same brain, same gates, no real text sent. Rows are
        tagged <code className="bg-cream-2 px-1 rounded">simulated=true</code> in <code className="bg-cream-2 px-1 rounded">sms_messages</code> and
        do not appear in real customer history.
      </p>

      <Form method="get" className="mb-6 flex gap-2 items-end">
        <label className="flex-1">
          <span className="block text-xs uppercase tracking-wide text-muted mb-1">From phone (E.164)</span>
          <input
            type="text"
            name="phone"
            defaultValue={phoneFromUrl}
            placeholder="+15555550123"
            className="w-full rounded border border-line bg-paper px-3 py-2 font-mono"
          />
        </label>
        <button type="submit" className="rounded bg-ink text-cream px-4 py-2 font-display font-bold">
          Load thread
        </button>
      </Form>

      {phone && (
        <div className="mb-4 flex flex-wrap gap-3 text-xs">
          <span className={`rounded-full px-2 py-1 ${state.ageConsented ? 'bg-sage/30 text-ink' : 'bg-cream-2 text-muted'}`}>
            Age consent: {state.ageConsented ? 'YES' : 'no'}
          </span>
          <span className={`rounded-full px-2 py-1 ${state.optedOut ? 'bg-coral/30 text-ink' : 'bg-cream-2 text-muted'}`}>
            Opted out: {state.optedOut ? 'YES' : 'no'}
          </span>
          <span className="rounded-full px-2 py-1 bg-cream-2 text-muted">
            Messages: {thread.length}
          </span>
        </div>
      )}

      {thread.length > 0 && (
        <div className="mb-6 space-y-2 rounded-lg border border-line bg-paper p-4 max-h-[500px] overflow-y-auto">
          {thread.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.direction === 'inbound' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg overflow-hidden text-sm ${
                  m.direction === 'inbound'
                    ? 'bg-coral text-paper'
                    : 'bg-cream-2 text-ink'
                }`}
              >
                {m.mediaUrl && (
                  <img
                    src={m.mediaUrl}
                    alt=""
                    className="block w-full max-h-60 object-cover bg-paper"
                    loading="lazy"
                  />
                )}
                <div className="px-3 py-2 whitespace-pre-wrap">{m.body}</div>
              </div>
              <span className="text-[10px] text-muted mt-0.5">
                {m.direction === 'inbound' ? 'Customer' : 'Emma'} · {formatTime(m.createdAt)}
                {m.mediaUrl ? ' · MMS' : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {actionData?.outcome && (
        <div className="mb-4 rounded border border-line bg-cream-2 px-3 py-2 text-sm">
          <strong className="font-display">Last turn:</strong> {actionData.outcome}
          {actionData.reply ? <> — Emma replied <em>"{actionData.reply}"</em></> : <> (no reply sent)</>}
        </div>
      )}
      {actionData && !actionData.ok && (
        <div className="mb-4 rounded border border-coral bg-coral/10 px-3 py-2 text-sm text-coral-deep">
          {actionData.error}
        </div>
      )}

      <Form ref={sendFormRef} method="post" className="space-y-3">
        <input type="hidden" name="phone" value={phoneFromUrl} />
        <input type="hidden" name="intent" value="send" />
        <label className="block">
          <span className="block text-xs uppercase tracking-wide text-muted mb-1">
            Send as customer <span className="text-muted/70">(Enter sends, Shift+Enter for newline)</span>
          </span>
          <textarea
            ref={bodyRef}
            name="body"
            rows={3}
            placeholder="Type a message you want Emma to receive…"
            onKeyDown={onBodyKeyDown}
            className="w-full rounded border border-line bg-paper px-3 py-2 font-body"
          />
        </label>
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={!phoneFromUrl || isSubmitting}
            className="rounded bg-coral text-paper px-4 py-2 font-display font-bold disabled:opacity-50"
          >
            {isSubmitting ? 'Sending…' : 'Send to Emma'}
          </button>
        </div>
      </Form>

      {phoneFromUrl && (
        <Form method="post" className="mt-4">
          <input type="hidden" name="phone" value={phoneFromUrl} />
          <input type="hidden" name="intent" value="reset" />
          <button
            type="submit"
            className="text-xs text-muted underline hover:text-ink"
          >
            Reset thread (clears simulated messages, age-consent, and opt-out for this phone)
          </button>
        </Form>
      )}

      <details className="mt-6 text-xs text-muted">
        <summary className="cursor-pointer">Cheat sheet</summary>
        <ul className="mt-2 space-y-1 list-disc pl-5">
          <li>First message from a fresh phone gets the 18+ gate. Reply <code>YES</code> to consent.</li>
          <li>Type <code>STOP</code> to opt out, <code>START</code> to resume, <code>HELP</code> for the program message.</li>
          <li>Use any E.164-shaped phone (e.g. <code>+15555550123</code>); it does not have to be real.</li>
          <li>Reset wipes all simulator state for the phone so you can rerun from scratch.</li>
        </ul>
      </details>
    </div>
  )
}
