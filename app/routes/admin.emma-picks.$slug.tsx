/**
 * Admin · Emma Picks · Detail — edit a group's brief and current-deal picks.
 *
 * Left column:  group brief (name, kind, emma_context, source, counts, active).
 *               Saving a changed brief triggers an immediate regen against the
 *               live deal (trigger='brief_change').
 * Right column: the current-deal run — one row per pick with editable
 *               pairingWhy, remove + reorder controls. Regenerate button
 *               overwrites the whole run (trigger='admin').
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useFetcher, useLoaderData, useNavigate } from 'react-router'
import { useEffect, useState } from 'react'
import { requireAdmin } from '~/lib/session.server'
import { getGroupBySlug, getRunForGroup } from '~/lib/emma-picks.server'
import { getDailyDeal, getProductsByIds } from '~/lib/shopify.server'
import type { EmmaPickEntry } from '../../db/schema'
import type { Product } from '~/types'

export const meta: MetaFunction = ({ data }) => [
  { title: `${(data as { group?: { name: string } } | undefined)?.group?.name ?? 'Group'} — Emma Picks` },
]

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const slug = params['slug']
  if (!slug) throw new Response('Not Found', { status: 404 })

  const group = await getGroupBySlug(slug)
  if (!group) throw new Response('Not Found', { status: 404 })

  const liveDeal = await getDailyDeal().catch(() => null)
  const dealHandle = liveDeal?.handle ?? null

  const run = dealHandle ? await getRunForGroup(group.id, dealHandle) : null

  // Hydrate pick products (if any) for display
  let products: Product[] = []
  if (run && run.picks.length) {
    const ids = run.picks.map(p => p.productGid)
    products = await getProductsByIds(ids).catch(() => [])
  }

  return {
    group,
    liveDeal: liveDeal ? { handle: liveDeal.handle, title: liveDeal.seoTitle } : null,
    run: run ? {
      picks:       run.picks,
      generatedAt: run.generatedAt instanceof Date ? run.generatedAt.toISOString() : String(run.generatedAt),
      trigger:     run.trigger,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      stale:       run.briefHash !== group.briefHash,
    } : null,
    products: products.map(p => ({
      id:    p.id,
      handle: p.handle,
      title: p.title,
      image: p.images?.[0]?.url ?? null,
      price: p.price,
    })),
  }
}

export default function EmmaPickDetailPage() {
  const { group, liveDeal, run, products } = useLoaderData<typeof loader>()
  const briefFetcher    = useFetcher<{ ok: boolean; error?: string; regen?: { triggered: boolean; ok?: boolean; reason?: string } }>()
  const regenFetcher    = useFetcher<{ ok: boolean; error?: string; count?: number }>()
  const pickFetcher     = useFetcher<{ ok: boolean; error?: string }>()
  const deleteFetcher   = useFetcher<{ ok: boolean; error?: string }>()
  const navigate        = useNavigate()

  // Brief form state
  const [name, setName]               = useState(group.name)
  const [kind, setKind]               = useState(group.kind)
  const [emmaContext, setEmmaContext] = useState(group.emmaContext)
  const [sourceType, setSourceType]   = useState(group.sourceType)
  const [sourceValue, setSourceValue] = useState(group.sourceValue)
  const [maxPicks, setMaxPicks]       = useState(String(group.maxPicks))
  const [displayCount, setDisplayCount] = useState(String(group.displayCount))
  const [active, setActive]           = useState(group.active)

  const dirty =
    name !== group.name ||
    kind !== group.kind ||
    emmaContext !== group.emmaContext ||
    sourceType !== group.sourceType ||
    sourceValue !== group.sourceValue ||
    parseInt(maxPicks, 10) !== group.maxPicks ||
    parseInt(displayCount, 10) !== group.displayCount ||
    active !== group.active

  const saving = briefFetcher.state !== 'idle' && briefFetcher.formData?.get('intent') === 'update-group'
  const regenerating = regenFetcher.state !== 'idle'

  // Deleted — navigate away
  useEffect(() => {
    if (deleteFetcher.state === 'idle' && deleteFetcher.data?.ok) {
      navigate('/admin/emma-picks')
    }
  }, [deleteFetcher.state, deleteFetcher.data, navigate])

  const productById = new Map(products.map(p => [p.id, p]))

  const submitBrief = () => {
    briefFetcher.submit(
      {
        intent: 'update-group',
        slug: group.slug,
        name, kind, emmaContext, sourceType, sourceValue, maxPicks, displayCount,
        ...(active ? { active: 'true' } : {}),
      },
      { method: 'post', action: '/api/admin/emma-picks' },
    )
  }

  const regeneratePicks = () => {
    regenFetcher.submit(
      { intent: 'regenerate-picks', slug: group.slug },
      { method: 'post', action: '/api/admin/emma-picks' },
    )
  }

  const editPairingWhy = (productGid: string, pairingWhy: string) => {
    if (!liveDeal) return
    pickFetcher.submit(
      {
        intent: 'edit-pick',
        groupId: String(group.id),
        dealHandle: liveDeal.handle,
        productGid,
        pairingWhy,
      },
      { method: 'post', action: '/api/admin/emma-picks' },
    )
  }

  const removePick = (productGid: string) => {
    if (!liveDeal) return
    pickFetcher.submit(
      {
        intent: 'remove-pick',
        groupId: String(group.id),
        dealHandle: liveDeal.handle,
        productGid,
      },
      { method: 'post', action: '/api/admin/emma-picks' },
    )
  }

  const reorderPicks = (order: string[]) => {
    if (!liveDeal) return
    pickFetcher.submit(
      {
        intent: 'reorder-picks',
        groupId: String(group.id),
        dealHandle: liveDeal.handle,
        order: JSON.stringify(order),
      },
      { method: 'post', action: '/api/admin/emma-picks' },
    )
  }

  const deleteGroup = () => {
    if (!confirm(`Delete group "${group.name}"? This removes all its picks.`)) return
    deleteFetcher.submit(
      { intent: 'delete-group', slug: group.slug },
      { method: 'post', action: '/api/admin/emma-picks' },
    )
  }

  return (
    <div className="max-w-6xl">
      <header className="mb-6">
        <nav className="text-sm text-ink/50 mb-1">
          <a href="/admin/emma-picks" className="hover:text-coral">Emma Picks</a> / {group.slug}
        </nav>
        <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          {group.name}
        </h1>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Brief editor */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-semibold text-ink mb-4">Brief</h2>

          <div className="space-y-3">
            <Field label="Name">
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full rounded-xl border border-line px-3 py-2 text-sm"
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
            <Field label="Emma context">
              <textarea
                value={emmaContext}
                onChange={e => setEmmaContext(e.target.value)}
                rows={4}
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
              <Field label="Source value">
                <input
                  value={sourceValue}
                  onChange={e => setSourceValue(e.target.value)}
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
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
              <span>Active — render on homepage</span>
            </label>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <button
              onClick={deleteGroup}
              className="text-sm text-coral-deep hover:underline"
            >
              Delete group
            </button>
            <button
              onClick={submitBrief}
              disabled={!dirty || saving}
              className="rounded-xl bg-coral text-white px-4 py-2 text-sm font-semibold hover:bg-coral-2 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save brief'}
            </button>
          </div>

          {briefFetcher.state === 'idle' && briefFetcher.data?.ok && (
            <div className="mt-3 rounded-xl border border-sage/30 bg-sage/10 px-3 py-2 text-sm text-sage">
              Saved.
              {briefFetcher.data.regen?.triggered && (
                briefFetcher.data.regen.ok
                  ? ' Picks regenerated against the live deal.'
                  : ` Regen skipped: ${briefFetcher.data.regen.reason ?? 'unknown'}.`
              )}
            </div>
          )}
          {briefFetcher.state === 'idle' && briefFetcher.data && !briefFetcher.data.ok && (
            <div className="mt-3 rounded-xl border border-coral/30 bg-coral/5 px-3 py-2 text-sm text-coral-deep">
              {briefFetcher.data.error ?? 'Save failed.'}
            </div>
          )}
        </section>

        {/* Picks editor */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-ink">
              Current picks
              {liveDeal && <span className="ml-2 text-sm text-ink/50">for {liveDeal.title}</span>}
            </h2>
            <button
              onClick={regeneratePicks}
              disabled={!liveDeal || regenerating}
              className="rounded-xl border border-line px-3 py-1.5 text-sm font-medium hover:bg-cream-2 disabled:opacity-40"
            >
              {regenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
          </div>

          {!liveDeal && (
            <p className="text-sm text-coral-deep">No live deal — picks can't be generated.</p>
          )}

          {liveDeal && !run && (
            <p className="text-sm text-ink/60">
              No run yet for today. Hit Regenerate or save the brief to generate.
            </p>
          )}

          {run && run.picks.length === 0 && (
            <p className="text-sm text-ink/60">Run exists but is empty. Regenerate to try again.</p>
          )}

          {run && run.picks.length > 0 && (
            <>
              <div className="mb-3 text-xs text-ink/50">
                Generated {timeAgo(run.generatedAt)} · trigger: {run.trigger}
                {run.stale && <span className="ml-2 text-coral-deep">· brief changed since — regenerate</span>}
                {typeof run.inputTokens === 'number' && (
                  <> · {run.inputTokens} in / {run.outputTokens ?? 0} out</>
                )}
              </div>
              <PickList
                picks={run.picks}
                productById={productById}
                onEdit={editPairingWhy}
                onRemove={removePick}
                onReorder={reorderPicks}
                busy={pickFetcher.state !== 'idle'}
              />
            </>
          )}

          {regenFetcher.state === 'idle' && regenFetcher.data && !regenFetcher.data.ok && (
            <div className="mt-3 rounded-xl border border-coral/30 bg-coral/5 px-3 py-2 text-sm text-coral-deep">
              Regenerate failed: {regenFetcher.data.error}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// ─── Pick list ──────────────────────────────────────────────────────────────

interface PickProduct { id: string; handle: string; title: string; image: string | null; price: number }

function PickList(props: {
  picks: EmmaPickEntry[]
  productById: Map<string, PickProduct>
  onEdit: (productGid: string, pairingWhy: string) => void
  onRemove: (productGid: string) => void
  onReorder: (order: string[]) => void
  busy: boolean
}) {
  return (
    <ul className="space-y-3">
      {props.picks.map((pick, idx) => {
        const product = props.productById.get(pick.productGid)
        return (
          <PickRow
            key={pick.productGid}
            pick={pick}
            product={product}
            index={idx}
            total={props.picks.length}
            busy={props.busy}
            onEdit={props.onEdit}
            onRemove={props.onRemove}
            onMove={(dir) => {
              const order = props.picks.map(p => p.productGid)
              const from = idx
              const to = dir === 'up' ? from - 1 : from + 1
              if (to < 0 || to >= order.length) return
              const tmp = order[from]!
              order[from] = order[to]!
              order[to] = tmp
              props.onReorder(order)
            }}
          />
        )
      })}
    </ul>
  )
}

function PickRow(props: {
  pick: EmmaPickEntry
  product: PickProduct | undefined
  index: number
  total: number
  busy: boolean
  onEdit: (productGid: string, pairingWhy: string) => void
  onRemove: (productGid: string) => void
  onMove: (dir: 'up' | 'down') => void
}) {
  const [text, setText] = useState(props.pick.pairingWhy)
  const [focused, setFocused] = useState(false)

  const dirty = text !== props.pick.pairingWhy

  return (
    <li className="flex gap-3 rounded-xl border border-line p-3">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-cream-2">
        {props.product?.image && (
          <img src={props.product.image} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink truncate">
              {props.product?.title ?? <span className="text-coral-deep">Product unavailable</span>}
            </div>
            <div className="text-xs text-ink/50 truncate">
              {props.product?.handle ?? props.pick.productGid}
              {props.pick.edited && <span className="ml-2 rounded bg-sun/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink">edited</span>}
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => props.onMove('up')}
              disabled={props.index === 0 || props.busy}
              className="px-2 py-0.5 text-xs rounded border border-line hover:bg-cream-2 disabled:opacity-30"
              aria-label="Move up"
            >↑</button>
            <button
              onClick={() => props.onMove('down')}
              disabled={props.index === props.total - 1 || props.busy}
              className="px-2 py-0.5 text-xs rounded border border-line hover:bg-cream-2 disabled:opacity-30"
              aria-label="Move down"
            >↓</button>
            <button
              onClick={() => props.onRemove(props.pick.productGid)}
              disabled={props.busy}
              className="px-2 py-0.5 text-xs rounded border border-line hover:bg-cream-2 disabled:opacity-30 text-coral-deep"
              aria-label="Remove"
            >×</button>
          </div>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            if (dirty) props.onEdit(props.pick.productGid, text.trim())
          }}
          rows={2}
          className="mt-2 w-full rounded-lg border border-line px-2 py-1.5 text-sm"
        />
        {focused && dirty && (
          <div className="mt-1 text-xs text-ink/50">Blur to save.</div>
        )}
      </div>
    </li>
  )
}

// ─── Utils ──────────────────────────────────────────────────────────────────

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-ink/60 mb-1">{props.label}</span>
      {props.children}
    </label>
  )
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
