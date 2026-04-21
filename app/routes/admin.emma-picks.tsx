/**
 * Admin · Emma Picks — list of context groups.
 * Create new groups and drill into a group's detail page to see and edit
 * the current-deal picks.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, useFetcher, useLoaderData, useNavigate } from 'react-router'
import { useEffect, useRef, useState } from 'react'
import { requireAdmin } from '~/lib/session.server'
import { listGroups, getRunForGroup } from '~/lib/emma-picks.server'
import { getDailyDeal } from '~/lib/shopify.server'

export const meta: MetaFunction = () => [{ title: 'Emma Picks — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const [groups, liveDeal] = await Promise.all([
    listGroups({}),
    getDailyDeal().catch(() => null),
  ])
  const dealHandle = liveDeal?.handle ?? null

  // Fetch latest run per group for the live deal so the list can show a
  // generated-at timestamp and pick count.
  const runs = dealHandle
    ? await Promise.all(groups.map(g => getRunForGroup(g.id, dealHandle)))
    : []

  return {
    liveDeal: liveDeal ? { handle: liveDeal.handle, title: liveDeal.seoTitle } : null,
    groups: groups.map((g, i) => {
      const run = runs[i] ?? null
      return {
        ...g,
        run: run ? {
          generatedAt: run.generatedAt instanceof Date ? run.generatedAt.toISOString() : String(run.generatedAt),
          pickCount:   run.picks.length,
          trigger:     run.trigger,
          stale:       run.briefHash !== g.briefHash,
        } : null,
      }
    }),
  }
}

type CreateFetcherData = { ok?: boolean; error?: string; group?: { slug: string } }

export default function EmmaPicksListPage() {
  const { groups, liveDeal } = useLoaderData<typeof loader>()
  const fetcher = useFetcher<CreateFetcherData>()
  const navigate = useNavigate()
  const [showNew, setShowNew] = useState(false)
  const lastIntentRef = useRef<string | null>(null)

  // Track what intent we last submitted so we can act on fetcher.data
  // after it settles (formData is only present while submitting).
  if (fetcher.state !== 'idle') {
    const intent = fetcher.formData?.get('intent')
    if (typeof intent === 'string') lastIntentRef.current = intent
  }
  const creating = fetcher.state !== 'idle' && lastIntentRef.current === 'create-group'

  useEffect(() => {
    if (fetcher.state !== 'idle') return
    if (lastIntentRef.current !== 'create-group') return
    if (fetcher.data?.ok && fetcher.data.group?.slug) {
      const slug = fetcher.data.group.slug
      lastIntentRef.current = null
      navigate(`/admin/emma-picks/${slug}`)
    }
  }, [fetcher.state, fetcher.data, navigate])

  return (
    <div className="max-w-5xl">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
            Emma Picks
          </h1>
          <p className="text-sm text-ink/60 mt-1">
            Context groups Emma uses to build personalized product rails under the hero deal.
            {liveDeal ? (
              <> Live deal: <span className="font-medium text-ink">{liveDeal.title}</span>.</>
            ) : (
              <> <span className="text-coral-deep">No live deal set.</span></>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="shrink-0 rounded-xl bg-coral text-white px-4 py-2 text-sm font-semibold hover:bg-coral-2"
        >
          New group
        </button>
      </header>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="bg-cream-2 text-ink/70">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Kind</th>
              <th className="text-left px-4 py-3 font-medium">Source</th>
              <th className="text-left px-4 py-3 font-medium">Active</th>
              <th className="text-left px-4 py-3 font-medium">Last run</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/50">
                No groups yet — create one to get started.
              </td></tr>
            )}
            {groups.map(g => (
              <tr key={g.id} className="border-t border-line">
                <td className="px-4 py-3">
                  <Link to={`/admin/emma-picks/${g.slug}`} className="font-medium text-ink hover:text-coral">
                    {g.name}
                  </Link>
                  <div className="text-xs text-ink/50">{g.slug}</div>
                </td>
                <td className="px-4 py-3 text-ink/70">{g.kind}</td>
                <td className="px-4 py-3 text-ink/70">
                  <span className="text-xs uppercase tracking-wide text-ink/50">{g.sourceType}</span>{' '}
                  <span className="font-mono text-xs">{truncate(g.sourceValue, 32)}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={
                    g.active
                      ? 'inline-flex items-center gap-1 rounded-full bg-sage/15 text-sage px-2 py-0.5 text-xs font-medium'
                      : 'inline-flex items-center gap-1 rounded-full bg-ink/10 text-ink/60 px-2 py-0.5 text-xs font-medium'
                  }>
                    {g.active ? 'active' : 'paused'}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink/70">
                  {g.run ? (
                    <div className="text-xs">
                      <div>{g.run.pickCount} picks · {g.run.trigger}</div>
                      <div className="text-ink/50">{timeAgo(g.run.generatedAt)}{g.run.stale ? ' · brief changed' : ''}</div>
                    </div>
                  ) : (
                    <span className="text-xs text-ink/50">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={`/admin/emma-picks/${g.slug}`}
                    className="text-sm font-medium text-coral hover:text-coral-deep"
                  >
                    Edit →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewGroupModal
          onClose={() => setShowNew(false)}
          onCreate={(payload) => {
            fetcher.submit(payload, {
              method: 'post',
              action: '/api/admin/emma-picks',
              encType: 'application/x-www-form-urlencoded',
            })
          }}
          submitting={creating}
          error={fetcher.state === 'idle' && fetcher.data && !fetcher.data.ok
            ? fetcher.data.error ?? null
            : null}
        />
      )}
    </div>
  )
}

// ─── New group modal ────────────────────────────────────────────────────────

function NewGroupModal(props: {
  onClose: () => void
  onCreate: (payload: Record<string, string>) => void
  submitting: boolean
  error: string | null
}) {
  const [name, setName]               = useState('')
  const [kind, setKind]               = useState<'pairing' | 'alternative' | 'adjacent'>('pairing')
  const [emmaContext, setEmmaContext] = useState('')
  const [sourceType, setSourceType]   = useState<'tag' | 'collection' | 'manual'>('tag')
  const [sourceValue, setSourceValue] = useState('')
  const [maxPicks, setMaxPicks]       = useState('10')
  const [displayCount, setDisplayCount] = useState('4')

  const canSubmit = name.trim().length > 0 && emmaContext.trim().length > 0 && sourceValue.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={props.onClose}>
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          New context group
        </h2>
        <p className="mt-1 text-sm text-ink/60">
          Give Emma the brief. She'll pick {displayCount || '4'}-of-{maxPicks || '10'} each midnight, personalized per visitor.
        </p>

        <div className="mt-4 space-y-3">
          <Field label="Name">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Pairs with today's deal"
              className="w-full rounded-xl border border-line px-3 py-2 text-sm"
              autoFocus
            />
          </Field>
          <Field label="Kind">
            <select
              value={kind}
              onChange={e => setKind(e.target.value as typeof kind)}
              className="w-full rounded-xl border border-line px-3 py-2 text-sm"
            >
              <option value="pairing">pairing — goes well with</option>
              <option value="alternative">alternative — not for you, try these</option>
              <option value="adjacent">adjacent — same vibe</option>
            </select>
          </Field>
          <Field label="Emma context (the brief)">
            <textarea
              value={emmaContext}
              onChange={e => setEmmaContext(e.target.value)}
              placeholder="Lubes Emma would reach for alongside whatever's in the hero. Water-based first, silicone if it's long-session."
              rows={3}
              className="w-full rounded-xl border border-line px-3 py-2 text-sm"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Source type">
              <select
                value={sourceType}
                onChange={e => setSourceType(e.target.value as typeof sourceType)}
                className="w-full rounded-xl border border-line px-3 py-2 text-sm"
              >
                <option value="tag">Shopify tag</option>
                <option value="collection">Collection handle</option>
                <option value="manual">Manual (GID list)</option>
              </select>
            </Field>
            <Field label={sourceType === 'manual' ? 'JSON array of product GIDs' : sourceType === 'tag' ? 'Tag name' : 'Collection handle'}>
              <input
                value={sourceValue}
                onChange={e => setSourceValue(e.target.value)}
                placeholder={sourceType === 'manual' ? '["gid://shopify/Product/..."]' : sourceType === 'tag' ? 'lube' : 'lubes-and-lotions'}
                className="w-full rounded-xl border border-line px-3 py-2 text-sm font-mono"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Pool size (3–12)">
              <input
                type="number" min={3} max={12}
                value={maxPicks}
                onChange={e => setMaxPicks(e.target.value)}
                className="w-full rounded-xl border border-line px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Displayed per visit">
              <input
                type="number" min={1} max={12}
                value={displayCount}
                onChange={e => setDisplayCount(e.target.value)}
                className="w-full rounded-xl border border-line px-3 py-2 text-sm"
              />
            </Field>
          </div>
        </div>

        {props.error && (
          <div className="mt-3 rounded-xl border border-coral/30 bg-coral/5 px-3 py-2 text-sm text-coral-deep">
            {props.error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={props.onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-ink/70 hover:bg-cream-2"
          >
            Cancel
          </button>
          <button
            disabled={!canSubmit || props.submitting}
            onClick={() => props.onCreate({
              intent: 'create-group',
              name, kind, emmaContext, sourceType, sourceValue, maxPicks, displayCount,
              active: 'true',
            })}
            className="rounded-xl bg-coral text-white px-4 py-2 text-sm font-semibold hover:bg-coral-2 disabled:opacity-50"
          >
            {props.submitting ? 'Creating…' : 'Create group'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-ink/60 mb-1">{props.label}</span>
      {props.children}
    </label>
  )
}

// ─── Utils ──────────────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const now  = Date.now()
  const secs = Math.max(0, Math.floor((now - then) / 1000))
  if (secs < 60)       return `${secs}s ago`
  if (secs < 3600)     return `${Math.floor(secs / 60)}m ago`
  if (secs < 86_400)   return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86_400)}d ago`
}
