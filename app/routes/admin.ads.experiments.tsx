/**
 * /admin/ads/experiments: the experiment log (ticket #16436, plan sections
 * 3.3, 8, 9.2 and 9.5).
 *
 * The loader lists experiments (optional ?status= filter) with each arm's
 * spend, impressions, leads and orders since starts_at, measured against the
 * section 9.2 floors. An arm under a floor shows "not yet readable" and why.
 * A leader shows only when every arm clears its floors.
 *
 * The action takes create, start, decide and abandon, and only from an owner
 * session. Nothing on this page decides anything by itself.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, isRouteErrorResponse, useFetcher, useLoaderData, useRevalidator, useRouteError } from 'react-router'
import { useEffect, useRef, useState } from 'react'
import { getAdminUser, requireAdmin } from '~/lib/session.server'
import {
  abandonExperiment,
  createExperiment,
  decideExperiment,
  loadExperimentsPage,
  startExperiment,
  type EntityOption,
  type ExperimentCard,
} from '~/lib/ads/experiments.server'
import {
  EXPERIMENT_METRICS,
  EXPERIMENT_STATUSES,
  EXPERIMENT_VARIABLES,
  FLOORS,
  IllegalExperimentTransitionError,
  MAX_ARMS,
  MIN_ARMS,
  formatCents,
  formatMetric,
  isExperimentStatus,
  parseNewExperiment,
  type AdExperimentMetric,
  type AdExperimentStatus,
} from '~/lib/ads/experiments-core'
import { ErrorSlab } from '~/components/admin/ads/StateSlabs'

export const meta: MetaFunction = () => [{ title: 'Experiments - Ads - xdipx Admin' }]

const ACTION_PATH = '/admin/ads/experiments'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const raw = url.searchParams.get('status')
  const status = isExperimentStatus(raw) ? raw : null
  const [page, admin] = await Promise.all([loadExperimentsPage(status), getAdminUser(request)])
  return { status, cards: page.cards, options: page.options, isOwner: admin?.role === 'owner' }
}

type ActionResult =
  | { ok: true; intent: string; id: number }
  | { ok: false; intent: string; error: string }

export async function action({ request }: ActionFunctionArgs): Promise<ActionResult> {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  const admin = await getAdminUser(request)
  if (!admin || admin.role !== 'owner') {
    return { ok: false, intent, error: 'Only the owner can change experiments.' }
  }
  const actor = admin.email || 'owner'
  const str = (k: string) => String(form.get(k) ?? '')
  try {
    if (intent === 'create') {
      const choices = form.getAll('armChoice').map(String)
      const labels = form.getAll('armLabel').map(String)
      const parsed = parseNewExperiment({
        hypothesis: str('hypothesis'),
        variable: str('variable'),
        primaryMetric: str('primaryMetric'),
        minSpend: str('minSpend'),
        notes: str('notes'),
        arms: choices.map((choice, i) => ({ choice, label: labels[i] ?? '' })),
      })
      if (!parsed.ok) return { ok: false, intent, error: parsed.error }
      const row = await createExperiment(parsed.value)
      return { ok: true, intent, id: row.id }
    }
    const id = Number(form.get('id'))
    if (!Number.isInteger(id) || id <= 0) return { ok: false, intent, error: 'That experiment id is not valid.' }
    if (intent === 'start') {
      await startExperiment(id)
      return { ok: true, intent, id }
    }
    if (intent === 'decide') {
      const verdict = str('verdict').trim()
      if (!verdict) return { ok: false, intent, error: 'Write the verdict before you decide.' }
      await decideExperiment(id, verdict, actor)
      return { ok: true, intent, id }
    }
    if (intent === 'abandon') {
      await abandonExperiment(id, actor)
      return { ok: true, intent, id }
    }
    return { ok: false, intent, error: 'Unknown action.' }
  } catch (err) {
    if (err instanceof IllegalExperimentTransitionError) return { ok: false, intent, error: err.message }
    return { ok: false, intent, error: err instanceof Error ? err.message : 'That did not save.' }
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<AdExperimentStatus, string> = {
  planned: 'Planned', running: 'Running', decided: 'Decided', abandoned: 'Abandoned',
}
const STATUS_TONE: Record<AdExperimentStatus, string> = {
  planned: 'border-line bg-paper-2 text-ink-3',
  running: 'border-coral/30 bg-coral-soft text-ink',
  decided: 'border-plum/20 bg-plum-soft text-plum-2',
  abandoned: 'border-line bg-paper-3 text-ink-4',
}
const METRIC_LABEL: Record<AdExperimentMetric, string> = { cpl: 'CPL', cpa: 'CPA', roas: 'ROAS' }
const VARIABLE_LABEL: Record<string, string> = {
  hook: 'Hook', format: 'Format', product: 'Product', audience: 'Audience', placement: 'Placement',
}

const pill = 'inline-flex min-h-11 items-center rounded-full border px-4 font-mono text-[11px] uppercase tracking-wide touch-manipulation md:min-h-9'
const input = 'w-full min-h-11 rounded-xl border border-line bg-paper px-3 text-base md:text-sm text-ink focus:border-plum focus:outline-none'
const primaryBtn = 'inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-5 text-sm font-medium text-paper hover:bg-ink-2 disabled:opacity-60 touch-manipulation'
const quietBtn = 'inline-flex min-h-11 items-center justify-center rounded-full border border-line bg-paper px-5 text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-60 touch-manipulation'

export default function ExperimentsPage() {
  const { status, cards, options, isOwner } = useLoaderData<typeof loader>()
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl md:text-2xl text-ink">Experiments</h1>
          <p className="mt-1 max-w-prose text-sm text-ink-3">
            Each experiment changes one lever across two to four arms. Spend is too low for significance tests, so each arm is shown against the plan's floors and you write the verdict.
          </p>
        </div>
      </header>

      <nav aria-label="Filter by status" className="flex flex-wrap gap-1">
        <FilterPill to={ACTION_PATH} active={status == null} label="All" />
        {EXPERIMENT_STATUSES.map(s => (
          <FilterPill key={s} to={`${ACTION_PATH}?status=${s}`} active={status === s} label={STATUS_LABEL[s]} />
        ))}
      </nav>

      {isOwner
        ? <CreateForm options={options} />
        : <p className="rounded-2xl border border-line bg-paper-2 p-4 text-sm text-ink-3">Only the owner can create, start, decide or abandon experiments.</p>}

      {cards.length === 0
        ? <SlotModelEmpty filtered={status != null} />
        : (
          <ul className="space-y-4">
            {cards.map(card => (
              <li key={card.experiment.id}><ExperimentCardView card={card} isOwner={isOwner} /></li>
            ))}
          </ul>
        )}
    </div>
  )
}

function FilterPill({ to, active, label }: { to: string; active: boolean; label: string }) {
  return (
    <Link
      to={to}
      prefetch="intent"
      aria-current={active ? 'page' : undefined}
      className={`${pill} ${active ? 'border-coral bg-coral-soft text-ink' : 'border-line bg-paper text-ink-3 hover:border-ink-4'}`}
    >
      {label}
    </Link>
  )
}

function SlotModelEmpty({ filtered }: { filtered: boolean }) {
  return (
    <section className="rounded-2xl border border-line bg-paper-2 p-4 md:p-5">
      <p className="kicker text-ink-3">{filtered ? 'Nothing here yet' : 'No experiments yet'}</p>
      <h2 className="mt-1 font-display text-lg text-ink">How the slot model runs</h2>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
        <li>Proven ad set: 70 percent of the budget, at most 3 ads.</li>
        <li>Test ad set: 30 percent of the budget, at most 3 ads, same audience as Proven.</li>
        <li>The bench lives in Ad Studio, never in Ads Manager, and holds at most 9 ideas.</li>
        <li>New ads enter Test in one Monday batch, and each batch changes one lever: hook, format or product.</li>
        <li>Kill at $40 spent with CPL above 1.5x the Proven median, or after 10 days or $60 without graduating. Graduate at 10 leads with CPL at or below the Proven median.</li>
      </ol>
    </section>
  )
}

// ─── Create ──────────────────────────────────────────────────────────────────

function CreateForm({ options }: { options: EntityOption[] }) {
  const fetcher = useFetcher<ActionResult>()
  const formRef = useRef<HTMLFormElement>(null)
  const [armCount, setArmCount] = useState(MIN_ARMS)
  const [open, setOpen] = useState(false)
  const pending = fetcher.state !== 'idle'
  const result = fetcher.data
  const error = result && !result.ok && result.intent === 'create' ? result.error : null

  useEffect(() => {
    if (fetcher.state === 'idle' && result?.ok && result.intent === 'create') {
      formRef.current?.reset()
      setArmCount(MIN_ARMS)
    }
  }, [fetcher.state, result])

  return (
    <details
      open={open}
      onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="rounded-2xl border border-line bg-paper"
    >
      <summary className="flex min-h-11 cursor-pointer items-center px-4 font-medium text-ink touch-manipulation">
        New experiment
      </summary>
      <fetcher.Form ref={formRef} method="post" action={ACTION_PATH} className="space-y-4 border-t border-line p-4" aria-busy={pending}>
        <input type="hidden" name="intent" value="create" />
        <label className="block">
          <span className="text-sm font-medium text-ink">Hypothesis</span>
          <textarea name="hypothesis" required rows={3} maxLength={500} className={`${input} mt-1 py-2`}
            placeholder="A question hook gets a lower CPL than a benefit hook on the same product." />
        </label>

        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <label className="block md:flex-1">
            <span className="text-sm font-medium text-ink">Lever</span>
            <select name="variable" required className={`${input} mt-1`} defaultValue="hook">
              {EXPERIMENT_VARIABLES.map(v => <option key={v} value={v}>{VARIABLE_LABEL[v]}</option>)}
            </select>
          </label>
          <label className="block md:flex-1">
            <span className="text-sm font-medium text-ink">Primary metric</span>
            <select name="primaryMetric" required className={`${input} mt-1`} defaultValue="cpl">
              {EXPERIMENT_METRICS.map(m => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
            </select>
          </label>
          <label className="block md:w-40">
            <span className="text-sm font-medium text-ink">Min spend per arm ($)</span>
            <input name="minSpend" inputMode="decimal" defaultValue="40" className={`${input} mt-1`} />
          </label>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-ink">Arms</legend>
          {options.length === 0 && (
            <p className="text-sm text-ink-3">The entity mirror is empty, so there is nothing to pick yet. The entity sync fills it.</p>
          )}
          {Array.from({ length: armCount }, (_, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-xl border border-line bg-paper-2 p-3 md:flex-row md:items-center">
              <span className="font-mono text-[11px] uppercase tracking-wide text-ink-3 md:w-12">Arm {String.fromCharCode(65 + i)}</span>
              <select name="armChoice" required className={`${input} md:flex-1`} defaultValue="" aria-label={`Arm ${String.fromCharCode(65 + i)} entity`}>
                <option value="" disabled>Pick an ad, ad set or campaign</option>
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input name="armLabel" maxLength={60} placeholder="Label (optional)" className={`${input} md:w-48`} aria-label={`Arm ${String.fromCharCode(65 + i)} label`} />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {armCount < MAX_ARMS && (
              <button type="button" className={quietBtn} onClick={() => setArmCount(n => Math.min(MAX_ARMS, n + 1))}>Add an arm</button>
            )}
            {armCount > MIN_ARMS && (
              <button type="button" className={quietBtn} onClick={() => setArmCount(n => Math.max(MIN_ARMS, n - 1))}>Remove the last arm</button>
            )}
          </div>
        </fieldset>

        <label className="block">
          <span className="text-sm font-medium text-ink">Notes</span>
          <textarea name="notes" rows={2} className={`${input} mt-1 py-2`} />
        </label>

        {error && <p role="alert" className="rounded-xl border border-coral/30 bg-coral-soft px-3 py-2 text-sm text-ink">{error}</p>}
        {result?.ok && result.intent === 'create' && !pending && (
          <p role="status" className="text-sm text-sage">Saved as planned. Start it when the ads are live.</p>
        )}
        <button type="submit" disabled={pending || options.length === 0} className={primaryBtn}>
          {pending ? 'Saving...' : 'Save as planned'}
        </button>
      </fetcher.Form>
    </details>
  )
}

// ─── Card ────────────────────────────────────────────────────────────────────

const fmtDate = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null

function ExperimentCardView({ card, isOwner }: { card: ExperimentCard; isOwner: boolean }) {
  const { experiment: x, comparison: c } = card
  const metric = x.primaryMetric
  const started = fmtDate(x.startsAt)
  const ended = fmtDate(x.endsAt)
  return (
    <article className="rounded-2xl border border-line bg-paper p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${STATUS_TONE[x.status]}`}>{STATUS_LABEL[x.status]}</span>
        <span className="font-mono text-[11px] uppercase tracking-wide text-ink-3">
          #{x.id} · {VARIABLE_LABEL[x.variable] ?? x.variable} · {METRIC_LABEL[metric]} · min {formatCents(x.minSpendCents)}
        </span>
      </div>
      <h2 className="mt-2 text-base font-medium text-ink">{x.hypothesis}</h2>
      {started && (
        <p className="mt-1 font-mono text-[11px] text-ink-3">
          {started}{ended ? ` to ${ended}` : ' to today'} · {c.days} {c.days === 1 ? 'day' : 'days'}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {c.arms.map((r, i) => {
          const leader = c.leaderIndex === i
          return (
            <section key={`${r.arm.platform}|${r.arm.externalId}`}
              className={`min-w-0 rounded-xl border p-3 ${leader ? 'border-plum/40 bg-plum-soft' : 'border-line bg-paper-2'}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 font-medium text-ink">{r.arm.label}</p>
                {leader && <span className="shrink-0 rounded-full bg-plum px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-paper">Leads</span>}
              </div>
              <p className="mt-0.5 truncate font-mono text-[11px] text-ink-4" title={r.arm.externalId}>
                {r.arm.level} {r.arm.externalId} · {r.arm.platform}
              </p>
              <p className="mt-2 font-mono text-lg font-semibold tabular-nums text-ink">
                {METRIC_LABEL[metric]} {formatMetric(metric, r.value)}
              </p>
              <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] text-ink-3">
                <dt>Spend</dt><dd className="text-right tabular-nums">{formatCents(r.metrics.spendCents)}</dd>
                <dt>Impressions</dt><dd className="text-right tabular-nums">{r.metrics.impressions.toLocaleString('en-US')}</dd>
                <dt>Leads</dt><dd className="text-right tabular-nums">{r.metrics.leads}</dd>
                <dt>Orders</dt><dd className="text-right tabular-nums">{r.metrics.orders}</dd>
              </dl>
              {r.readable
                ? <p className="mt-2 text-[13px] text-sage">Readable</p>
                : <p className="mt-2 text-[13px] text-ink-3">Not yet readable: {r.reason}</p>}
            </section>
          )
        })}
      </div>
      {c.note && x.status === 'running' && <p className="mt-3 text-sm text-ink-3">{c.note}</p>}
      <FloorLine metric={metric} />

      {x.verdict && (
        <div className="mt-4 rounded-xl border border-line bg-paper-2 p-3">
          <p className="kicker text-ink-3">Verdict{x.decidedBy ? ` by ${x.decidedBy}` : ''}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{x.verdict}</p>
        </div>
      )}
      {x.status === 'abandoned' && !x.verdict && x.decidedBy && (
        <p className="mt-3 text-sm text-ink-4">Abandoned by {x.decidedBy}.</p>
      )}

      {isOwner && (x.status === 'planned' || x.status === 'running') && (
        <ExperimentActions id={x.id} status={x.status} />
      )}
    </article>
  )
}

function FloorLine({ metric }: { metric: AdExperimentMetric }) {
  const text = metric === 'cpl'
    ? `Floor for CPL: ${FLOORS.cplLeads} leads and ${FLOORS.cplImpressions.toLocaleString('en-US')} impressions per arm, plus the minimum spend.`
    : metric === 'cpa'
      ? `Floor for CPA: ${FLOORS.cpaLeads} leads and ${FLOORS.cpaDays} days per arm, plus the minimum spend. Ten orders per arm is out of reach at this spend.`
      : `Floor for ROAS: ${FLOORS.roasOrders} orders per arm, plus the minimum spend.`
  return <p className="mt-2 font-mono text-[11px] leading-snug text-ink-4">{text}</p>
}

function ExperimentActions({ id, status }: { id: number; status: 'planned' | 'running' }) {
  const fetcher = useFetcher<ActionResult>()
  const [mode, setMode] = useState<'idle' | 'decide' | 'abandon'>('idle')
  const pending = fetcher.state !== 'idle'
  const pendingIntent = pending ? String(fetcher.formData?.get('intent') ?? '') : null
  const error = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null

  return (
    <div className="mt-4 border-t border-line pt-4" aria-busy={pending}>
      {mode === 'decide' ? (
        <fetcher.Form method="post" action={ACTION_PATH} className="space-y-3">
          <input type="hidden" name="intent" value="decide" />
          <input type="hidden" name="id" value={id} />
          <label className="block">
            <span className="text-sm font-medium text-ink">Verdict</span>
            <textarea name="verdict" required rows={3} className={`${input} mt-1 py-2`}
              placeholder="What you are keeping, what you are killing, and why." />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={primaryBtn}>{pendingIntent === 'decide' ? 'Saving...' : 'Save the verdict'}</button>
            <button type="button" disabled={pending} className={quietBtn} onClick={() => setMode('idle')}>Cancel</button>
          </div>
        </fetcher.Form>
      ) : mode === 'abandon' ? (
        <fetcher.Form method="post" action={ACTION_PATH} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="intent" value="abandon" />
          <input type="hidden" name="id" value={id} />
          <p className="w-full text-sm text-ink-2">Abandon this experiment? It stays in the log with no verdict.</p>
          <button type="submit" disabled={pending} className={primaryBtn}>{pendingIntent === 'abandon' ? 'Abandoning...' : 'Yes, abandon it'}</button>
          <button type="button" disabled={pending} className={quietBtn} onClick={() => setMode('idle')}>Keep it</button>
        </fetcher.Form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {status === 'planned' && (
            <fetcher.Form method="post" action={ACTION_PATH}>
              <input type="hidden" name="intent" value="start" />
              <input type="hidden" name="id" value={id} />
              <button type="submit" disabled={pending} className={primaryBtn}>{pendingIntent === 'start' ? 'Starting...' : 'Start'}</button>
            </fetcher.Form>
          )}
          {status === 'running' && (
            <button type="button" disabled={pending} className={primaryBtn} onClick={() => setMode('decide')}>Decide</button>
          )}
          <button type="button" disabled={pending} className={quietBtn} onClick={() => setMode('abandon')}>Abandon</button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded-xl border border-coral/30 bg-coral-soft px-3 py-2 text-sm text-ink">{error}</p>}
    </div>
  )
}

export function ErrorBoundary() {
  const error = useRouteError()
  const revalidator = useRevalidator()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl md:text-2xl text-ink">Experiments</h1>
      <ErrorSlab
        title="Couldn't load the experiments."
        message={message}
        onRetry={() => revalidator.revalidate()}
        retrying={revalidator.state === 'loading'}
      />
    </div>
  )
}
