/**
 * /admin/conversations, the conversation transcript and quality viewer.
 *
 * Until now nothing read the conversation-surface tables: emma_chat_sessions /
 * emma_chat_turns are the on-site Emma widget (writer only), and reviewing SMS
 * meant raw SQL against sms_turns. This page gives the owner one place to read
 * yesterday's conversations and filter to the flagged ones from a phone.
 *
 * Two sources, one list:
 *   - web  = emma_chat_sessions (+ emma_chat_turns for the transcript)
 *   - sms  = sms_turns grouped by conversation_id (its own channel column is
 *            carried through, so an sms_turns row logged as channel='web' shows
 *            as web)
 *
 * Flags are inherent to each source: web sessions can show `checkout` (the
 * session shared a checkout URL); sms conversations can show `fabrication`,
 * `softBeat`, and `checkout` (a CHECKOUT/POST_CHECKOUT stage). Filtering by a
 * flag a channel cannot raise simply returns nothing for that channel, which is
 * the honest answer.
 *
 * Read-only. Data flows loader -> useLoaderData; every query lives here in the
 * server-only loader.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, useLoaderData } from 'react-router'
import { sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { requireAdmin } from '~/lib/session.server'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'

export const meta: MetaFunction = () => [{ title: 'Conversations, xdipx Admin' }]

const ROW_CAP = 200

type Channel = 'all' | 'web' | 'sms'
type Flag = 'all' | 'checkout' | 'fabrication' | 'softBeat'

interface SessionRow {
  key: string // web:<id> | sms:<conversationId>
  source: 'web' | 'sms'
  channel: string
  startedAt: string
  turns: number
  tokens: number | null
  flags: string[]
  label: string
}

interface TranscriptTurn {
  at: string
  who: string
  text: string
  meta: string | null
}

function isChannel(v: string | null): v is Channel {
  return v === 'all' || v === 'web' || v === 'sms'
}
function isFlag(v: string | null): v is Flag {
  return v === 'all' || v === 'checkout' || v === 'fabrication' || v === 'softBeat'
}

function maskPhone(raw: string | null): string {
  if (!raw) return 'unknown'
  const d = raw.replace(/\D+/g, '')
  if (d.length >= 4) return `••• ${d.slice(-4)}`
  return 'unknown'
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const url = new URL(request.url)
  const channel: Channel = isChannel(url.searchParams.get('channel')) ? (url.searchParams.get('channel') as Channel) : 'all'
  const flag: Flag = isFlag(url.searchParams.get('flag')) ? (url.searchParams.get('flag') as Flag) : 'all'
  const date = (url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10)).slice(0, 10)
  const selected = url.searchParams.get('session')

  // Day window [date 00:00, date+1 00:00) in the DB's own clock.
  const dayStart = sql`${date}::date`
  const dayEnd = sql`(${date}::date + interval '1 day')`

  const wantWeb = channel !== 'sms'
  const wantSms = channel !== 'web'

  // Web sessions from the on-site Emma widget. checkout flag = a checkout URL
  // was shared; the widget has no per-session token accounting, so tokens null.
  const webRows: SessionRow[] =
    wantWeb && flag !== 'fabrication' && flag !== 'softBeat'
      ? (
          await db.execute<{
            id: number
            started_at: string
            turns: number
            checkout: boolean
            customer_gid: string | null
            first_handle: string | null
          }>(sql`
            SELECT s.id,
                   s.created_at AS started_at,
                   s.turn_count AS turns,
                   (s.checkout_shared_at IS NOT NULL) AS checkout,
                   s.customer_gid,
                   s.first_product_handle AS first_handle
            FROM emma_chat_sessions s
            WHERE s.created_at >= ${dayStart} AND s.created_at < ${dayEnd}
            ORDER BY s.created_at DESC
            LIMIT ${ROW_CAP}
          `)
        ).rows.map((r) => ({
          key: `web:${r.id}`,
          source: 'web' as const,
          channel: 'web',
          startedAt: new Date(r.started_at).toISOString(),
          turns: Number(r.turns ?? 0),
          tokens: null,
          flags: r.checkout ? ['checkout'] : [],
          label: r.customer_gid ? 'signed in' : r.first_handle ? `→ ${r.first_handle}` : 'guest',
        }))
      : []

  // SMS conversations, grouped by conversation_id. Flags aggregate across the
  // conversation's turns; channel carries the row's own value.
  const smsRows: SessionRow[] = wantSms
    ? (
        await db.execute<{
          cid: string
          channel: string
          started_at: string
          turns: number
          tokens: number
          phone: string | null
          fabrication: boolean
          soft_beat: boolean
          checkout: boolean
        }>(sql`
          SELECT conversation_id::text AS cid,
                 max(channel) AS channel,
                 min(created_at) AS started_at,
                 count(*) AS turns,
                 coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0) AS tokens,
                 max(phone) AS phone,
                 bool_or(fabrication_caught IS NOT NULL AND fabrication_caught NOT IN ('none', '')) AS fabrication,
                 bool_or(soft_beat) AS soft_beat,
                 bool_or(coalesce(stage_out, '') ILIKE '%CHECKOUT%' OR coalesce(stage_in, '') ILIKE '%CHECKOUT%') AS checkout
          FROM sms_turns
          WHERE created_at >= ${dayStart} AND created_at < ${dayEnd}
          GROUP BY conversation_id
          ORDER BY min(created_at) DESC
          LIMIT ${ROW_CAP}
        `)
      ).rows.map((r) => {
        const flags: string[] = []
        if (r.checkout) flags.push('checkout')
        if (r.fabrication) flags.push('fabrication')
        if (r.soft_beat) flags.push('softBeat')
        return {
          key: `sms:${r.cid}`,
          source: 'sms' as const,
          channel: r.channel || 'sms',
          startedAt: new Date(r.started_at).toISOString(),
          turns: Number(r.turns ?? 0),
          tokens: Number(r.tokens ?? 0),
          flags,
          label: maskPhone(r.phone),
        }
      })
    : []

  let sessions = [...webRows, ...smsRows].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
  if (channel !== 'all') sessions = sessions.filter((s) => s.channel === channel)
  if (flag !== 'all') sessions = sessions.filter((s) => s.flags.includes(flag))
  const truncated = sessions.length > ROW_CAP
  sessions = sessions.slice(0, ROW_CAP)

  const stats = {
    sessions: sessions.length,
    flagged: sessions.filter((s) => s.flags.length > 0).length,
    checkout: sessions.filter((s) => s.flags.includes('checkout')).length,
    turns: sessions.reduce((a, s) => a + s.turns, 0),
  }

  // Drill-in transcript for the selected session, if any and if it is in view.
  let transcript: { row: SessionRow; turns: TranscriptTurn[] } | null = null
  const selectedRow = selected ? sessions.find((s) => s.key === selected) : null
  if (selectedRow) {
    if (selectedRow.source === 'web') {
      const id = Number(selectedRow.key.slice('web:'.length))
      const turns = (
        await db.execute<{ role: string; text: string; products: string[] | null; created_at: string }>(sql`
          SELECT role, text, products, created_at
          FROM emma_chat_turns
          WHERE session_id = ${id} AND hidden = false
          ORDER BY created_at ASC
          LIMIT 500
        `)
      ).rows.map((t) => ({
        at: new Date(t.created_at).toISOString(),
        who: t.role === 'user' ? 'Visitor' : 'Emma',
        text: t.text,
        meta: t.products && t.products.length > 0 ? `products: ${t.products.join(', ')}` : null,
      }))
      transcript = { row: selectedRow, turns }
    } else {
      const cid = selectedRow.key.slice('sms:'.length)
      const rows = (
        await db.execute<{
          direction: string
          customer_msg: string | null
          emma_msg: string | null
          intent: string | null
          stage_out: string | null
          fabrication_caught: string | null
          soft_beat: boolean
          created_at: string
        }>(sql`
          SELECT direction, customer_msg, emma_msg, intent, stage_out,
                 fabrication_caught, soft_beat, created_at
          FROM sms_turns
          WHERE conversation_id = ${cid}::uuid
          ORDER BY created_at ASC
          LIMIT 500
        `)
      ).rows
      const turns: TranscriptTurn[] = []
      for (const t of rows) {
        const at = new Date(t.created_at).toISOString()
        if (t.customer_msg) turns.push({ at, who: 'Customer', text: t.customer_msg, meta: t.intent ? `intent: ${t.intent}` : null })
        if (t.emma_msg) {
          const marks: string[] = []
          if (t.stage_out) marks.push(t.stage_out)
          if (t.fabrication_caught && t.fabrication_caught !== 'none') marks.push(`fabrication: ${t.fabrication_caught}`)
          if (t.soft_beat) marks.push('softBeat')
          turns.push({ at, who: 'Emma', text: t.emma_msg, meta: marks.length > 0 ? marks.join(' · ') : null })
        }
      }
      transcript = { row: selectedRow, turns }
    }
  }

  return { sessions, stats, truncated, filters: { channel, flag, date }, transcript }
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
    </div>
  )
}

function FlagPill({ flag }: { flag: string }) {
  const tone =
    flag === 'fabrication'
      ? 'bg-coral-soft text-plum-2'
      : flag === 'softBeat'
        ? 'bg-plum-soft text-plum-2'
        : 'bg-paper-3 text-ink-3'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{flag}</span>
}

const CHANNELS: Channel[] = ['all', 'web', 'sms']
const FLAGS: Flag[] = ['all', 'checkout', 'fabrication', 'softBeat']

export default function AdminConversationsPage() {
  const { sessions, stats, truncated, filters, transcript } = useLoaderData<typeof loader>()

  function withParam(key: string, value: string): string {
    const p = new URLSearchParams()
    p.set('channel', filters.channel)
    p.set('flag', filters.flag)
    p.set('date', filters.date)
    p.set(key, value)
    p.delete('session')
    return `?${p.toString()}`
  }
  function sessionHref(key: string): string {
    const p = new URLSearchParams()
    p.set('channel', filters.channel)
    p.set('flag', filters.flag)
    p.set('date', filters.date)
    p.set('session', key)
    return `?${p.toString()}`
  }

  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  return (
    <div className="max-w-6xl p-4 md:p-8">
      <h1 className="mb-6 text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
        Conversations
      </h1>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sessions" value={stats.sessions} />
        <Stat label="Flagged" value={stats.flagged} />
        <Stat label="Checkout shared" value={stats.checkout} />
        <Stat label="Turns" value={stats.turns} />
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
        <div className="flex items-center gap-1">
          {CHANNELS.map((c) => (
            <Link
              key={c}
              to={withParam('channel', c)}
              className={`rounded-full px-3 py-1.5 text-sm ${filters.channel === c ? 'bg-ink text-white' : 'bg-paper-3 text-ink-3'}`}
            >
              {c}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {FLAGS.map((f) => (
            <Link
              key={f}
              to={withParam('flag', f)}
              className={`rounded-full px-3 py-1.5 text-sm ${filters.flag === f ? 'bg-ink text-white' : 'bg-paper-3 text-ink-3'}`}
            >
              {f}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Link to={withParam('date', today)} className={`rounded-full px-3 py-1.5 text-sm ${filters.date === today ? 'bg-ink text-white' : 'bg-paper-3 text-ink-3'}`}>
            Today
          </Link>
          <Link to={withParam('date', yesterday)} className={`rounded-full px-3 py-1.5 text-sm ${filters.date === yesterday ? 'bg-ink text-white' : 'bg-paper-3 text-ink-3'}`}>
            Yesterday
          </Link>
          <form method="get" className="flex items-center gap-1">
            <input type="hidden" name="channel" value={filters.channel} />
            <input type="hidden" name="flag" value={filters.flag} />
            <input
              type="date"
              name="date"
              defaultValue={filters.date}
              className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink"
            />
            <button type="submit" className="rounded-lg bg-paper-3 px-3 py-1.5 text-sm text-ink-3">
              Go
            </button>
          </form>
        </div>
      </div>

      {truncated && (
        <p className="mb-3 text-xs text-ink-3">Showing the first {ROW_CAP} sessions for this day. Narrow by channel or flag to see the rest.</p>
      )}

      {/* Session list */}
      <ResponsiveTable className="mb-8">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="py-2 pr-3 font-medium">Started (UTC)</th>
              <th className="py-2 pr-3 font-medium">Channel</th>
              <th className="py-2 pr-3 font-medium">Who</th>
              <th className="py-2 pr-3 font-medium">Turns</th>
              <th className="py-2 pr-3 font-medium">Tokens</th>
              <th className="py-2 pr-3 font-medium">Flags</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-ink-3">
                  No conversations match this day and filter.
                </td>
              </tr>
            ) : (
              sessions.map((s) => (
                <tr key={s.key} className="border-b border-line/60">
                  <td className="py-2 pr-3 text-ink">{fmtTime(s.startedAt)}</td>
                  <td className="py-2 pr-3 text-ink-3">{s.channel}</td>
                  <td className="py-2 pr-3 text-ink-3">{s.label}</td>
                  <td className="py-2 pr-3 text-ink">{s.turns}</td>
                  <td className="py-2 pr-3 text-ink-3">{s.tokens === null ? '-' : s.tokens.toLocaleString()}</td>
                  <td className="py-2 pr-3">
                    <span className="flex flex-wrap gap-1">
                      {s.flags.length === 0 ? <span className="text-ink-4">-</span> : s.flags.map((f) => <FlagPill key={f} flag={f} />)}
                    </span>
                  </td>
                  <td className="py-2">
                    <Link to={sessionHref(s.key)} className="link-coral font-medium">
                      Read
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ResponsiveTable>

      {/* Drill-in transcript */}
      {transcript && (
        <section className="rounded-2xl border border-line bg-paper-2 p-4 md:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-ink">
              {transcript.row.channel} conversation, {fmtTime(transcript.row.startedAt)}
            </h2>
            <span className="flex flex-wrap gap-1">
              {transcript.row.flags.map((f) => (
                <FlagPill key={f} flag={f} />
              ))}
            </span>
          </div>
          {transcript.turns.length === 0 ? (
            <p className="text-sm text-ink-3">No visible turns recorded for this session.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {transcript.turns.map((t, i) => {
                const mine = t.who === 'Emma'
                return (
                  <li key={i} className={`flex flex-col ${mine ? 'items-start' : 'items-end'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${mine ? 'bg-coral-soft text-ink' : 'bg-paper-3 text-ink'}`}>
                      <div className="mb-0.5 text-xs font-medium text-ink-3">
                        {t.who} · {fmtTime(t.at)}
                      </div>
                      <div className="whitespace-pre-wrap text-sm leading-relaxed">{t.text}</div>
                      {t.meta && <div className="mt-1 text-xs text-ink-4">{t.meta}</div>}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      )}
    </div>
  )
}
