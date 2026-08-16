/**
 * /admin/outreach — read a pitch, edit it, send it.
 *
 * The outreach pipeline shipped with a send arm, an inbox ear, a valve, and a
 * cap, but the only way to reach any of it was curl against
 * /api/team/outreach with a team token. So drafted pitches sat in suggestion
 * rows nobody could act on. This page is the missing middle: the prospect
 * list, the thread, the composer seeded from the scout's draft, and the two
 * controls that decide whether anything can leave at all.
 *
 * Two rules shape it. Nothing here bypasses a guard: Send calls the same
 * sendOutreachEmail() the API calls, so the valve, the daily cap, the queued
 * status, the contact address, and the 7-day quiet period all still apply, and
 * the page shows which one is blocking before you click rather than after.
 * And nothing here fabricates: the composer is seeded from copy an agent
 * actually wrote, with an empty subject when the draft had none, because the
 * owner sending a subject line Claude invented is the failure this page exists
 * to prevent.
 *
 * Data flows loader -> useLoaderData; every write posts to the route action.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation, useSearchParams } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import {
  adoptPitch,
  getOutreachOverview,
  getProspectDetail,
  listProspects,
  listUnadoptedPitches,
  queueProspect,
  setOutreachDailyCap,
  setOutreachValve,
  setProspectContactEmail,
  setProspectStatusByOwner,
} from '~/lib/outreach-admin.server'
import { sendOutreachEmail } from '~/lib/outreach.server'
import { buildFooter, DEDUPE_WINDOW_DAYS } from '~/lib/outreach-core'
import {
  agePhrase,
  canQueue,
  describeSendBlock,
  OWNER_SETTABLE_STATUSES,
  seedDraftFromSuggestion,
} from '~/lib/outreach-admin'

export const meta: MetaFunction = () => [{ title: 'Outreach — xdipx Admin' }]

const STATUS_COLORS: Record<string, string> = {
  new:              'bg-paper-3 text-ink-3',
  researching:      'bg-paper-3 text-ink-3',
  queued:           'bg-coral-soft text-coral',
  sent:             'bg-plum-soft text-plum',
  replied_positive: 'bg-sage/20 text-sage',
  replied_negative: 'bg-paper-3 text-ink-4',
  bounced:          'bg-red-100 text-red-700',
  on_hold:          'bg-paper-3 text-ink-4',
  landed:           'bg-sage/20 text-sage',
  rejected:         'bg-paper-3 text-ink-4',
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const selectedId = Number(url.searchParams.get('prospect') ?? 0)
  const pitchId = Number(url.searchParams.get('pitch') ?? 0)

  const [overview, prospects, unadopted] = await Promise.all([
    getOutreachOverview(),
    listProspects(),
    listUnadoptedPitches(),
  ])
  const detail = selectedId ? await getProspectDetail(selectedId) : null

  const pitches = detail?.pitches ?? []
  const activePitch = pitches.find(p => p.id === pitchId) ?? pitches[0] ?? null
  const seed = seedDraftFromSuggestion(activePitch?.suggestion)

  return {
    overview,
    prospects: prospects.map(p => ({
      ...p,
      updatedAt: p.updatedAt.toISOString(),
      lastOutboundAt: p.lastOutboundAt?.toISOString() ?? null,
    })),
    unadopted: unadopted.map(p => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
    })),
    detail: detail && {
      prospect: {
        ...detail.prospect,
        updatedAt: detail.prospect.updatedAt.toISOString(),
        lastOutboundAt: detail.prospect.lastOutboundAt?.toISOString() ?? null,
      },
      messages: detail.messages.map(m => ({
        ...m,
        sentAt: m.sentAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
      pitches: pitches.map(p => ({
        id: p.id,
        status: p.status,
        linked: p.linked,
        createdAt: p.createdAt.toISOString(),
        suggestion: p.suggestion,
      })),
      blockedReason: detail.sendGuard.ok ? null : describeSendBlock(detail.sendGuard.reason),
      activePitchId: activePitch?.id ?? null,
      seed,
    },
    footerPreview: buildFooter(process.env['OUTREACH_POSTAL_ADDRESS']),
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  const id = Number(form.get('id') ?? 0)

  if (intent === 'valve') {
    return setOutreachValve(String(form.get('value') ?? '') === 'on')
  }
  if (intent === 'cap') {
    return setOutreachDailyCap(Number(form.get('cap') ?? NaN))
  }
  if (intent === 'queue') {
    return queueProspect(id)
  }
  if (intent === 'status') {
    return setProspectStatusByOwner(id, String(form.get('status') ?? ''))
  }
  if (intent === 'contact') {
    return setProspectContactEmail(id, String(form.get('email') ?? ''))
  }
  if (intent === 'adopt') {
    const result = await adoptPitch({
      suggestionId: Number(form.get('suggestionId') ?? 0),
      domain: String(form.get('domain') ?? ''),
      email: String(form.get('email') ?? '') || null,
      channel: String(form.get('channel') ?? 'email'),
      name: String(form.get('name') ?? '') || null,
    })
    if (result.ok && result.prospectId) {
      // Land on the prospect that was just created, composer already seeded
      // from the draft it came from.
      return redirect(`/admin/outreach?prospect=${result.prospectId}`)
    }
    return result
  }
  if (intent === 'send') {
    const subject = String(form.get('subject') ?? '').trim()
    const text = String(form.get('text') ?? '').trim()
    if (!id || !subject || !text) {
      return { ok: false, message: 'A subject and a body are both required.' }
    }
    // Every guard lives in sendOutreachEmail; this route adds none of its own
    // and weakens none of them. A refusal comes back as { sent: false }.
    const result = await sendOutreachEmail({ prospectId: id, subject, text })
    return result.sent
      ? { ok: true, message: `Sent. The thread is now on file${result.messageId ? ` (${result.messageId})` : ''}.` }
      : { ok: false, message: `Not sent: ${describeSendBlock(result.error ?? 'unknown error')}` }
  }
  return { ok: false, message: 'Unknown intent.' }
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-mono ${STATUS_COLORS[status] ?? STATUS_COLORS['new']}`}>
      {status}
    </span>
  )
}

function ValveCard({
  overview,
}: {
  overview: { valveOn: boolean; dailyCap: number; sentToday: number }
}) {
  const { valveOn, dailyCap, sentToday } = overview
  return (
    <div className="rounded-md border border-line p-4 mb-6 bg-paper-2">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">Sending</span>
            <span className={`px-2 py-0.5 rounded-md text-xs font-mono ${valveOn ? 'bg-coral-soft text-coral' : 'bg-paper-3 text-ink-3'}`}>
              {valveOn ? 'ON' : 'OFF'}
            </span>
          </div>
          <p className="text-xs text-ink-3 mt-1">
            {valveOn
              ? 'Pitches sent from this page leave over SMTP immediately.'
              : 'The valve is off. Nothing can leave, from this page or from an agent.'}
            {' '}
            <span className="font-mono">outreach_send_enabled</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-ink-3">
            <span className="font-semibold text-ink">{sentToday}</span> / {dailyCap} sent today
          </span>
          <Form method="post" className="flex items-center gap-2">
            <input type="hidden" name="intent" value="cap" />
            <label className="text-xs text-ink-3" htmlFor="cap">Cap</label>
            <input
              id="cap" name="cap" type="number" min={0} max={100} defaultValue={dailyCap}
              className="w-16 px-2 py-1 rounded-md border border-line text-sm"
            />
            <button type="submit" className="px-2 py-1 rounded-md border border-line text-xs text-ink-3 hover:bg-paper-3">
              Save
            </button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="valve" />
            <input type="hidden" name="value" value={valveOn ? 'off' : 'on'} />
            <button
              type="submit"
              onClick={e => {
                if (!valveOn && !confirm('Turn sending ON? Pitches you send from this page will go out for real.')) {
                  e.preventDefault()
                }
              }}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold ${valveOn ? 'bg-paper-3 text-ink-3 hover:bg-line' : 'bg-coral text-white hover:bg-coral-2'}`}
            >
              {valveOn ? 'Turn sending off' : 'Turn sending on'}
            </button>
          </Form>
        </div>
      </div>
    </div>
  )
}

type LoaderData = Awaited<ReturnType<typeof loader>>
type ProspectListRow = LoaderData['prospects'][number]
type Detail = NonNullable<LoaderData['detail']>

function ProspectTable({ rows, selectedId }: { rows: ProspectListRow[]; selectedId: number }) {
  return (
    <ResponsiveTable>
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-ink-4">
            <th className="pb-2 pr-3 font-medium">Prospect</th>
            <th className="pb-2 px-3 font-medium">Status</th>
            <th className="pb-2 px-3 font-medium">Contact</th>
            <th className="pb-2 px-3 font-medium">Last pitch</th>
            <th className="pb-2 pl-3 font-medium">Replies</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.id} className={`border-t border-line align-top ${p.id === selectedId ? 'bg-plum-soft/40' : ''}`}>
              <td className="py-3 pr-3">
                <Link to={`?prospect=${p.id}`} className="font-semibold text-ink link-coral" preventScrollReset>
                  {p.name ?? p.domain}
                </Link>
                <div className="text-xs text-ink-4 font-mono">{p.domain}</div>
                {p.source && <div className="text-xs text-ink-4 mt-0.5">via {p.source}</div>}
              </td>
              <td className="py-3 px-3 whitespace-nowrap"><StatusPill status={p.status} /></td>
              <td className="py-3 px-3 text-xs text-ink-3">
                {p.contactEmail ?? <em className="text-ink-4">none</em>}
                <div className="text-ink-4">{p.contactChannel}</div>
              </td>
              <td className="py-3 px-3 text-xs text-ink-3 whitespace-nowrap">
                {agePhrase(p.lastOutboundAt)}
              </td>
              <td className="py-3 pl-3 text-xs whitespace-nowrap">
                {p.inboundCount > 0
                  ? <span className="text-sage font-semibold">{p.inboundCount}</span>
                  : <span className="text-ink-4">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ResponsiveTable>
  )
}

type UnadoptedPitch = LoaderData['unadopted'][number]

/**
 * Drafted pitches the pipeline cannot see yet. Adopting one files the prospect
 * and links the draft to it; the guessed fields stay editable because the
 * extractor reads prose, not a schema.
 */
function PitchInbox({ pitches }: { pitches: UnadoptedPitch[] }) {
  if (pitches.length === 0) return null
  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold text-ink mb-1">
        Drafted pitches, not yet in the pipeline
        <span className="ml-2 text-xs font-normal text-ink-4">{pitches.length}</span>
      </h2>
      <p className="text-xs text-ink-3 mb-3">
        Written by the offsite-scout, with no prospect row to send from. Adopt one to file it,
        then queue and send it above.
      </p>
      <ul className="space-y-3">
        {pitches.map(p => (
          <li key={p.suggestionId} className="rounded-md border border-line p-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-semibold text-ink text-sm">{p.target.name ?? p.target.domain ?? `draft #${p.suggestionId}`}</span>
              <span className="text-xs text-ink-4 font-mono">#{p.suggestionId} &middot; {p.status}</span>
              <span className="text-xs text-ink-4">{agePhrase(p.createdAt)}</span>
            </div>
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-ink-3">read the draft</summary>
              <div className="mt-2 whitespace-pre-wrap text-xs text-ink-3 bg-paper-2 rounded-md p-3 max-h-72 overflow-y-auto">
                {p.suggestion}
              </div>
            </details>
            <Form method="post" className="flex flex-col gap-2 mt-3 md:flex-row md:items-center md:flex-wrap">
              <input type="hidden" name="intent" value="adopt" />
              <input type="hidden" name="suggestionId" value={p.suggestionId} />
              <input type="hidden" name="name" value={p.target.name ?? ''} />
              <input type="hidden" name="channel" value={p.target.channel} />
              <input
                name="domain" required defaultValue={p.target.domain ?? ''} placeholder="domain"
                className="px-2 py-1 rounded-md border border-line text-sm md:w-56"
              />
              <input
                name="email" type="email" defaultValue={p.target.email ?? ''}
                placeholder={p.target.channel === 'email' ? 'contact email' : `${p.target.channel}, no email in draft`}
                className="px-2 py-1 rounded-md border border-line text-sm md:w-64"
              />
              <button type="submit" className="px-3 py-1.5 rounded-md border border-line text-xs text-ink-3 hover:bg-paper-2 self-start">
                Adopt
              </button>
            </Form>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Thread({ messages }: { messages: Detail['messages'] }) {
  if (messages.length === 0) {
    return <p className="text-sm text-ink-4">No messages yet.</p>
  }
  return (
    <ul className="space-y-3">
      {messages.map(m => (
        <li key={m.id} className={`rounded-md border p-3 text-sm ${m.direction === 'out' ? 'border-line bg-paper-2' : 'border-plum-soft bg-plum-soft/30'}`}>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-4">
            <span className="font-mono">{m.direction === 'out' ? 'sent' : 'reply'}</span>
            <span>{(m.sentAt ?? m.createdAt).slice(0, 16).replace('T', ' ')}</span>
            {m.classification && (
              <span className="px-1.5 py-0.5 rounded bg-paper-3 font-mono">{m.classification}</span>
            )}
          </div>
          {m.subject && <div className="font-semibold text-ink mt-1">{m.subject}</div>}
          {m.bodyText && (
            <div className="mt-1 whitespace-pre-wrap text-ink-3 text-xs max-h-64 overflow-y-auto">{m.bodyText}</div>
          )}
        </li>
      ))}
    </ul>
  )
}

function Composer({ detail, footerPreview }: { detail: Detail; footerPreview: string }) {
  const { prospect, pitches, seed, activePitchId, blockedReason } = detail
  const nav = useNavigation()
  const busy = nav.state !== 'idle'

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-ink mb-2">Compose</h3>

      {pitches.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {pitches.map(p => (
            <Link
              key={p.id}
              to={`?prospect=${prospect.id}&pitch=${p.id}`}
              preventScrollReset
              className={`px-2 py-1 rounded-md text-xs border ${p.id === activePitchId ? 'border-coral text-coral' : 'border-line text-ink-3 hover:bg-paper-2'}`}
            >
              draft #{p.id}{p.linked ? ' (linked)' : ''}
            </Link>
          ))}
        </div>
      )}

      {pitches.length === 0 && (
        <p className="text-xs text-ink-4 mb-3">
          No pitch draft on file for this domain. Write the email yourself, or wait for the
          offsite-scout to file one.
        </p>
      )}

      <Form method="post" className="space-y-3">
        <input type="hidden" name="intent" value="send" />
        <input type="hidden" name="id" value={prospect.id} />

        <div>
          <label className="block text-xs text-ink-3 mb-1" htmlFor="subject">Subject</label>
          <input
            id="subject" name="subject" type="text" required maxLength={300}
            key={`subject-${activePitchId ?? 'blank'}`}
            defaultValue={seed.subject}
            placeholder="No subject in the draft. Write one."
            className="w-full px-3 py-2 rounded-md border border-line text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-ink-3 mb-1" htmlFor="text">Body</label>
          <textarea
            id="text" name="text" required rows={14}
            key={`text-${activePitchId ?? 'blank'}`}
            defaultValue={seed.body}
            className="w-full px-3 py-2 rounded-md border border-line text-sm font-mono"
          />
          <p className="text-xs text-ink-4 mt-1">
            Sent as plain text to <span className="font-mono">{prospect.contactEmail ?? 'no address on file'}</span>.
            This footer is appended automatically:
          </p>
          <pre className="text-xs text-ink-4 bg-paper-2 rounded-md p-2 mt-1 whitespace-pre-wrap">{footerPreview.trim()}</pre>
        </div>

        {blockedReason ? (
          <p className="text-sm px-3 py-2 rounded-md bg-paper-3 text-ink-3">{blockedReason}</p>
        ) : (
          <p className="text-xs text-ink-4">
            One pitch per prospect per {DEDUPE_WINDOW_DAYS} days. Sending moves this prospect to
            &lsquo;sent&rsquo; and starts watching for a reply.
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !!blockedReason}
          onClick={e => {
            if (!confirm(`Send this email to ${prospect.contactEmail}? It leaves immediately and cannot be recalled.`)) {
              e.preventDefault()
            }
          }}
          className="px-4 py-2 rounded-md bg-coral text-white text-sm font-semibold hover:bg-coral-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? 'Sending…' : `Send to ${prospect.contactEmail ?? '…'}`}
        </button>
      </Form>
    </div>
  )
}

function DetailPanel({ detail, footerPreview }: { detail: Detail; footerPreview: string }) {
  const { prospect, messages, pitches, activePitchId } = detail
  const activePitch = pitches.find(p => p.id === activePitchId) ?? null

  return (
    <div className="mt-8 rounded-md border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-display text-ink">{prospect.name ?? prospect.domain}</h2>
          <div className="text-xs text-ink-4 font-mono">{prospect.domain}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={prospect.status} />
          {canQueue(prospect.status) && prospect.status !== 'queued' && (
            <Form method="post">
              <input type="hidden" name="intent" value="queue" />
              <input type="hidden" name="id" value={prospect.id} />
              <button type="submit" className="px-2 py-1 rounded-md bg-coral text-white text-xs font-semibold hover:bg-coral-2">
                Queue
              </button>
            </Form>
          )}
          <Form method="post" className="flex items-center gap-1">
            <input type="hidden" name="intent" value="status" />
            <input type="hidden" name="id" value={prospect.id} />
            <select name="status" defaultValue="" className="px-2 py-1 rounded-md border border-line text-xs">
              <option value="" disabled>Set status…</option>
              {OWNER_SETTABLE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="submit" className="px-2 py-1 rounded-md border border-line text-xs text-ink-3 hover:bg-paper-2">
              Set
            </button>
          </Form>
        </div>
      </div>

      {(prospect.policyNote || prospect.notes) && (
        <div className="mt-3 text-xs text-ink-3 space-y-1">
          {prospect.policyNote && <div><span className="font-semibold">Policy: </span>{prospect.policyNote}</div>}
          {prospect.notes && <div><span className="font-semibold">Notes: </span>{prospect.notes}</div>}
        </div>
      )}

      <Form method="post" className="flex flex-col gap-2 mt-3 md:flex-row md:items-center">
        <input type="hidden" name="intent" value="contact" />
        <input type="hidden" name="id" value={prospect.id} />
        <label className="text-xs text-ink-3" htmlFor="email">Contact email</label>
        <input
          id="email" name="email" type="email" defaultValue={prospect.contactEmail ?? ''}
          placeholder="editor@example.com"
          className="px-2 py-1 rounded-md border border-line text-sm md:w-72"
        />
        <button type="submit" className="px-2 py-1 rounded-md border border-line text-xs text-ink-3 hover:bg-paper-2 self-start">
          Save
        </button>
      </Form>

      {activePitch && (
        <details className="mt-4" open={messages.length === 0}>
          <summary className="cursor-pointer text-sm font-semibold text-ink">
            Pitch draft #{activePitch.id}
            <span className="ml-2 text-xs font-normal text-ink-4">
              {activePitch.linked ? 'linked to this prospect' : 'matched by domain'} &middot; {activePitch.status}
            </span>
          </summary>
          <div className="mt-2 whitespace-pre-wrap text-xs text-ink-3 bg-paper-2 rounded-md p-3 max-h-80 overflow-y-auto">
            {activePitch.suggestion}
          </div>
        </details>
      )}

      <h3 className="text-sm font-semibold text-ink mt-6 mb-2">Thread</h3>
      <Thread messages={messages} />

      <Composer detail={detail} footerPreview={footerPreview} />
    </div>
  )
}

export default function AdminOutreach() {
  const { overview, prospects, unadopted, detail, footerPreview } = useLoaderData<typeof loader>()
  const result = useActionData<typeof action>()
  const [params] = useSearchParams()
  const selectedId = Number(params.get('prospect') ?? 0)

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-display text-ink mb-1">Outreach</h1>
      <p className="text-sm text-ink-3 mb-5">
        Guest-post and brand-partner pitches. Agents draft them and never send; you read, edit,
        and send from here.
      </p>

      {result?.message && (
        <p className={`text-sm mb-4 px-3 py-2 rounded-md ${result.ok ? 'bg-plum-soft text-plum' : 'bg-red-100 text-red-700'}`}>
          {result.message}
        </p>
      )}

      <ValveCard overview={overview} />

      {prospects.length === 0 ? (
        <p className="text-ink-3 py-6">
          No prospects yet. Seed the vetted list with{' '}
          <span className="font-mono text-xs">npx tsx scripts/seed-outreach-prospects.ts</span>.
        </p>
      ) : (
        <ProspectTable rows={prospects} selectedId={selectedId} />
      )}

      {detail
        ? <DetailPanel detail={detail} footerPreview={footerPreview} />
        : prospects.length > 0 && (
            <p className="text-sm text-ink-4 mt-6">Pick a prospect to read its thread and send a pitch.</p>
          )}

      <PitchInbox pitches={unadopted} />
    </div>
  )
}
