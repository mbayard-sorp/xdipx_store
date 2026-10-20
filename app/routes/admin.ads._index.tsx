/**
 * /admin/ads: the console overview (ticket #16411, plan sections 4 and 9.8).
 *
 * Read-only. Spend today, yesterday and month to date with pace against the
 * monthly cap; leads and CPL against the owner's ceiling; attributed orders
 * and CPA against break-even; what is live in the mirror; and an alerts list
 * (disapprovals, token health, stale sync, R7, pending ledger rows). Every
 * figure comes from loadOverview(), which reads Neon only. No platform call
 * happens while this page loads.
 *
 * While ads_spend_enabled is off every tile carries a "Simulation" tag, the
 * same rule the Spend tab follows, so a simulated number is never read as
 * real money.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { isRouteErrorResponse, useLoaderData, useRevalidator, useRouteError } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { loadOverview } from '~/lib/ads/console.server'
import { ageWords, type Overview, type OverviewAlert, type WindowFigures } from '~/lib/ads/console-core'
import { formatMoney, formatRoas } from '~/lib/ad-metrics-core'
import { ErrorSlab } from '~/components/admin/ads/StateSlabs'

export const meta: MetaFunction = () => [{ title: 'Overview - Ads - xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const now = new Date()
  const overview = await loadOverview(undefined, now)
  return { overview, now: now.toISOString() }
}

type Tone = 'plain' | 'good' | 'warn' | 'over'

const TONE: Record<Tone, string> = {
  plain: 'text-ink',
  good: 'text-sage',
  warn: 'text-amber-800',
  over: 'text-red-800',
}

function Tile({ label, value, note, tone = 'plain', simulation }: {
  label: string
  value: string
  note?: string | null
  tone?: Tone
  simulation: boolean
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-paper p-3 md:p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-mono text-[11px] uppercase tracking-wide text-ink-3">{label}</p>
        {simulation && (
          <span className="shrink-0 rounded-full border border-plum/20 bg-plum-soft px-1.5 font-mono text-[9px] uppercase tracking-wide text-plum-2">
            Sim
          </span>
        )}
      </div>
      <p className={`mt-1 font-mono text-base md:text-lg font-semibold tabular-nums ${TONE[tone]}`}>{value}</p>
      {note && <p className="mt-0.5 font-mono text-[11px] leading-snug text-ink-3">{note}</p>}
    </div>
  )
}

function Section({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <section aria-label={kicker} className="space-y-2">
      <p className="kicker">{kicker}</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">{children}</div>
    </section>
  )
}

const UNKNOWN = 'unknown'

function money(cents: number | null | undefined): string {
  return cents == null ? 'n/a' : formatMoney(cents)
}

/** Tone for a cost against its limit: over the limit is red, within 80% of it amber. */
function costTone(cents: number | null, limitCents: number): Tone {
  if (cents == null || !(limitCents > 0)) return 'plain'
  if (cents > limitCents) return 'over'
  if (cents >= limitCents * 0.8) return 'warn'
  return 'good'
}

/** Spend against a cap: under it is not an achievement, so only warn and over get a colour. */
function capTone(cents: number, capCents: number): Tone {
  const t = costTone(cents, capCents)
  return t === 'good' ? 'plain' : t
}

function cplTile(label: string, w: WindowFigures | undefined, ceiling: number, sim: boolean) {
  if (!w) return <Tile key={label} label={label} value={UNKNOWN} simulation={sim} />
  return (
    <Tile
      key={label}
      label={label}
      value={w.cplCents == null ? 'n/a' : formatMoney(w.cplCents)}
      note={`${w.leads} lead${w.leads === 1 ? '' : 's'} on ${formatMoney(w.spendCents)}`}
      tone={costTone(w.cplCents, ceiling)}
      simulation={sim}
    />
  )
}

function cpaTile(label: string, w: WindowFigures | undefined, breakEvenCents: number, sim: boolean) {
  if (!w) return <Tile key={label} label={label} value={UNKNOWN} simulation={sim} />
  return (
    <Tile
      key={label}
      label={label}
      value={w.cpaCents == null ? 'n/a' : formatMoney(w.cpaCents)}
      note={`${w.orders} order${w.orders === 1 ? '' : 's'}, ROAS ${formatRoas(w.netRoas)}`}
      tone={costTone(w.cpaCents, breakEvenCents)}
      simulation={sim}
    />
  )
}

function paceLine(o: Overview): string {
  if (!o.pace || !o.spend) return 'Pace unknown: the insights read failed.'
  const p = o.pace
  const cap = o.settings.monthlyCapCents
  const where = o.spend.monthCents > p.onPlanCents ? 'ahead of' : o.spend.monthCents < p.onPlanCents ? 'behind' : 'on'
  const pct = p.projectedPct == null ? '' : ` (${p.projectedPct}% of the cap)`
  return `Month to date ${formatMoney(o.spend.monthCents)} of ${formatMoney(cap)}, day ${p.daysElapsed} of ${p.daysInMonth}. `
    + `On this pace the month ends near ${formatMoney(p.projectedCents)}${pct}, ${where} a straight line to the cap (${formatMoney(p.onPlanCents)} by today).`
}

function AlertRow({ alert }: { alert: OverviewAlert }) {
  const tone = alert.severity === 'alert'
    ? 'border-red-300 bg-red-50 text-red-800'
    : 'border-amber-300 bg-amber-50 text-amber-800'
  return (
    <li className="flex flex-col gap-2 border-b border-line py-3 last:border-b-0 md:flex-row md:items-start md:justify-between md:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 font-mono text-[10px] uppercase tracking-wide ${tone}`}>
            {alert.severity === 'alert' ? 'Alert' : 'Watch'}
          </span>
          <p className="min-w-0 break-words text-sm font-medium text-ink">{alert.title}</p>
        </div>
        {alert.detail && <p className="mt-1 break-words text-xs text-ink-3">{alert.detail}</p>}
      </div>
      {alert.href && (
        <a
          href={alert.href}
          target="_blank"
          rel="noreferrer"
          className="link-coral shrink-0 inline-flex min-h-11 items-center text-sm md:min-h-0"
        >
          Open in Ads Manager
        </a>
      )}
    </li>
  )
}

function since(iso: string | null, nowIso: string): string {
  if (!iso) return 'never'
  return `${ageWords(Date.parse(nowIso) - Date.parse(iso))} ago`
}

const R7_WORDS: Record<Overview['r7']['state'], string> = {
  fired: 'Fired today. Every ad is paused.',
  near: 'Close. Spend is at 80% of the daily cap or more.',
  armed: 'Armed. It pauses every ad if spend passes the daily cap.',
  unknown: 'Unknown: the rule events read failed.',
}

function HealthRow({ label, value, flag }: { label: string; value: string; flag?: boolean | undefined }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line py-2 last:border-b-0 md:flex-row md:items-baseline md:justify-between md:gap-4">
      <dt className="font-mono text-[11px] uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className={`text-sm md:text-right ${flag ? 'text-amber-800' : 'text-ink'}`}>{value}</dd>
    </div>
  )
}

export default function AdsOverview() {
  const { overview: o, now } = useLoaderData<typeof loader>()
  const sim = o.simulation
  const s = o.settings
  const w = o.windows
  const c = o.counts

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-xl md:text-2xl text-ink">Overview</h1>
        <p className="font-mono text-[11px] text-ink-3">Meta, from the mirror. UTC day {o.today}.</p>
      </header>

      {sim && (
        <p className="rounded-2xl border border-plum/20 bg-plum-soft px-4 py-3 text-sm text-plum-2">
          Simulation. Spend is off, so no ad money moves. The figures below are what the mirror holds and are tagged Sim until spend is on.
        </p>
      )}
      {o.failed.length > 0 && (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Some reads failed ({o.failed.join(', ')}). Figures that depend on them say unknown.
        </p>
      )}

      <Section kicker="Spend">
        <Tile
          label="Today"
          value={o.spend ? formatMoney(o.spend.todayCents) : UNKNOWN}
          note={`cap ${formatMoney(s.dailyCapCents)}`}
          tone={o.spend ? capTone(o.spend.todayCents, s.dailyCapCents) : 'plain'}
          simulation={sim}
        />
        <Tile label="Yesterday" value={o.spend ? formatMoney(o.spend.yesterdayCents) : UNKNOWN} simulation={sim} />
        <Tile
          label="Month to date"
          value={o.spend ? formatMoney(o.spend.monthCents) : UNKNOWN}
          note={`cap ${formatMoney(s.monthlyCapCents)}`}
          simulation={sim}
        />
        <Tile
          label="Month projected"
          value={o.pace ? formatMoney(o.pace.projectedCents) : UNKNOWN}
          note={o.pace?.projectedPct != null ? `${o.pace.projectedPct}% of cap` : null}
          tone={o.pace ? capTone(o.pace.projectedCents, s.monthlyCapCents) : 'plain'}
          simulation={sim}
        />
      </Section>
      <p className="text-sm text-ink-2">{paceLine(o)}</p>

      <Section kicker="Leads">
        <Tile
          label="Leads today"
          value={w ? String(w.today.leads) : UNKNOWN}
          note={w ? `CPL ${money(w.today.cplCents)}` : null}
          simulation={sim}
        />
        {cplTile('CPL 7d', w?.d7, s.leadCplCeilingCents, sim)}
        {cplTile('CPL 30d', w?.d30, s.leadCplCeilingCents, sim)}
        <Tile label="CPL ceiling" value={formatMoney(s.leadCplCeilingCents)} note="owner-set list price" simulation={sim} />
      </Section>

      <Section kicker="Orders">
        {cpaTile('CPA 7d', w?.d7, o.breakEven.cpaCents, sim)}
        {cpaTile('CPA 30d', w?.d30, o.breakEven.cpaCents, sim)}
        <Tile
          label="Break-even CPA"
          value={formatMoney(o.breakEven.cpaCents)}
          note={`AOV ${formatMoney(o.breakEven.aovCents)} at ${o.breakEven.marginPct}% margin`}
          simulation={sim}
        />
        <Tile
          label="Pending actions"
          value={o.pendingActions == null ? UNKNOWN : String(o.pendingActions)}
          note="proposed in the ledger"
          tone={o.pendingActions ? 'warn' : 'plain'}
          simulation={sim}
        />
      </Section>

      <Section kicker="Live in the mirror">
        <Tile label="Campaigns" value={c ? `${c.campaign.active} / ${c.campaign.total}` : UNKNOWN} note="active / total" simulation={sim} />
        <Tile label="Ad sets" value={c ? `${c.adset.active} / ${c.adset.total}` : UNKNOWN} note="active / total" simulation={sim} />
        <Tile label="Ads" value={c ? `${c.ad.active} / ${c.ad.total}` : UNKNOWN} note="active / total" simulation={sim} />
        <Tile
          label="With problems"
          value={c ? String(c.campaign.problems + c.adset.problems + c.ad.problems) : UNKNOWN}
          note="disapproved or with issues"
          tone={c && c.campaign.problems + c.adset.problems + c.ad.problems > 0 ? 'over' : 'plain'}
          simulation={sim}
        />
      </Section>

      <section aria-label="Alerts" className="space-y-2">
        <p className="kicker">Alerts</p>
        <div className="rounded-2xl border border-line bg-paper px-4">
          {o.alerts.length === 0 ? (
            <p className="py-4 text-sm text-ink-3">No alerts. Nothing is disapproved, the syncs are current and R7 has not fired today.</p>
          ) : (
            <ul>
              {o.alerts.map(a => <AlertRow key={a.key} alert={a} />)}
            </ul>
          )}
        </div>
      </section>

      <section aria-label="Health" className="space-y-2">
        <p className="kicker">Health</p>
        <dl className="rounded-2xl border border-line bg-paper px-4">
          <HealthRow
            label="Token"
            value={o.tokenHealth == null
              ? 'Not yet reported'
              : o.tokenHealth.map(h => `${h.channel} ${h.state}, checked ${since(h.checkedAt, now)}`).join('. ')}
          />
          <HealthRow
            label="Entity sync"
            value={o.freshness ? since(o.freshness.lastEntitySyncAt, now) : UNKNOWN}
            flag={o.freshness?.entityStale}
          />
          <HealthRow
            label="Insights pull"
            value={o.freshness ? since(o.freshness.lastInsightsPullAt, now) : UNKNOWN}
            flag={o.freshness?.insightsStale}
          />
          <HealthRow label="R7 spend guard" value={R7_WORDS[o.r7.state]} flag={o.r7.state === 'fired' || o.r7.state === 'near'} />
        </dl>
      </section>
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
      <h1 className="font-display text-xl md:text-2xl text-ink">Overview</h1>
      <ErrorSlab
        title="Couldn't load the overview."
        message={message}
        onRetry={() => revalidator.revalidate()}
        retrying={revalidator.state === 'loading'}
      />
    </div>
  )
}
