import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Form, useLoaderData, useSearchParams } from 'react-router'
import { desc, eq } from 'drizzle-orm'
import { requireAdmin } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { voicemails } from '~/../db/schema'

export const meta: MetaFunction = () => [{ title: 'Voicemails — xdipx Admin' }]

type VoicemailRow = typeof voicemails.$inferSelect
type Status = 'new' | 'reviewed' | 'resolved'
const STATUSES: Status[] = ['new', 'reviewed', 'resolved']

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const filter = (url.searchParams.get('status') as Status | null) ?? 'new'

  const rows = await db
    .select()
    .from(voicemails)
    .where(STATUSES.includes(filter) ? eq(voicemails.status, filter) : eq(voicemails.status, 'new'))
    .orderBy(desc(voicemails.createdAt))
    .limit(100)

  return { rows, filter }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const id = Number(form.get('id'))
  const nextStatus = String(form.get('status') ?? '') as Status
  if (!Number.isFinite(id) || !STATUSES.includes(nextStatus)) {
    return new Response('bad request', { status: 400 })
  }
  await db.update(voicemails).set({ status: nextStatus }).where(eq(voicemails.id, id))
  return Response.json({ ok: true })
}

function fmtPhone(raw: string | null): string {
  if (!raw) return '—'
  const d = raw.replace(/\D+/g, '')
  if (d.length === 11 && d.startsWith('1')) {
    return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  }
  return raw
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function AdminVoicemails() {
  const { rows, filter } = useLoaderData<typeof loader>()
  const [params] = useSearchParams()

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1
          className="text-2xl font-bold text-brand-charcoal"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Voicemails
        </h1>
        <div className="flex gap-1 text-sm">
          {STATUSES.map((s) => {
            const active = filter === s
            return (
              <a
                key={s}
                href={`?status=${s}`}
                className={[
                  'px-3 py-1.5 rounded-full font-medium capitalize transition-colors',
                  active
                    ? 'bg-brand-purple text-white'
                    : 'bg-white text-brand-charcoal hover:bg-brand-mist',
                ].join(' ')}
              >
                {s}
              </a>
            )
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-brand-charcoal/60 italic">
          No {filter} voicemails.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((vm) => (
            <VoicemailCard key={vm.id} vm={vm} filter={filter} paramsStr={params.toString()} />
          ))}
        </ul>
      )}
    </div>
  )
}

function VoicemailCard({
  vm,
  filter,
  paramsStr,
}: {
  vm: VoicemailRow
  filter: Status
  paramsStr: string
}) {
  const callback = vm.callbackNumber ?? vm.fromNumber
  return (
    <li className="bg-white rounded-2xl p-4 shadow-sm border border-brand-mist">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-brand-charcoal/60 mb-1">
            <span>{fmtDate(vm.createdAt)}</span>
            <span>•</span>
            <span>from {fmtPhone(vm.fromNumber)}</span>
            {vm.contextOrderNumber && (
              <>
                <span>•</span>
                <span>order #{vm.contextOrderNumber}</span>
              </>
            )}
          </div>

          <p
            className="text-brand-charcoal font-medium mb-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {vm.summary}
          </p>

          <div className="flex items-center gap-3 text-sm mb-3">
            <a
              href={`tel:${callback}`}
              className="text-brand-purple hover:underline font-medium"
            >
              Call back {fmtPhone(callback)}
            </a>
          </div>

          {vm.recordingUrl && (
            <audio
              controls
              preload="none"
              src={`/api/admin/voicemail-audio/${vm.id}`}
              className="w-full max-w-md mb-3"
            />
          )}

          <details>
            <summary className="text-xs text-brand-charcoal/60 cursor-pointer hover:text-brand-charcoal">
              Transcript
            </summary>
            <pre className="mt-2 p-3 bg-brand-mist rounded-lg text-xs whitespace-pre-wrap font-body text-brand-charcoal/80 max-h-64 overflow-auto">
              {vm.transcript}
            </pre>
          </details>
        </div>

        <Form method="post" className="flex flex-col gap-1 shrink-0">
          <input type="hidden" name="id" value={vm.id} />
          {STATUSES.filter((s) => s !== filter).map((s) => (
            <button
              key={s}
              type="submit"
              name="status"
              value={s}
              className="text-xs px-3 py-1.5 rounded-lg bg-brand-mist hover:bg-brand-purple hover:text-white text-brand-charcoal font-medium capitalize transition-colors"
            >
              Mark {s}
            </button>
          ))}
        </Form>
      </div>
      <input type="hidden" value={paramsStr} readOnly hidden />
    </li>
  )
}
