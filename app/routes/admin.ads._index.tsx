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
 * Two cards from ticket #16686 sit under the tiles. Signal health compares
 * the latest pixel snapshot's Lead count with the leads /api/lead stored and
 * shows event match quality; it goes red past a 20% gap or under EMQ 6.
 * Burn to date shows spend, leads, CPL, orders, CAC and contribution per
 * channel since first spend and over 28 days, against break-even.
 *
 * While ads_spend_enabled is off every tile carries a "Simulation" tag, the
 * same rule the Spend tab follows, so a simulated number is never read as
 * real money.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { isRouteErrorResponse, useLoaderData, useRevalidator, useRouteError } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { loadOverview } from '~/lib/ads/console.server'
import { loadSignalCards } from '~/lib/ads/health-snapshots-console.server'
import { ageWords, type Burn, type BurnFigures, type Overview, type OverviewAlert, type WindowFigures } from '~/lib/ads/console-core'
import { EMQ_FLOOR, LEAD_GAP_MAX, type SignalHealth } from '~/lib/ads/health-snapshots-core'
import { formatMoney, formatRoas } from '~/lib/ad-metrics-core'
import { ErrorSlab } from '~/components/admin/ads/StateSlabs'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'

export const meta: MetaFunction = () => [{ title: 'Overview - Ads - xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const now = new Date()
  const [overview, cards] = await Promise.all([
    loadOverview(undefined, now),
    loadSignalCards(now).catch((err: unknown) => {
      console.error('[admin.ads] signal cards failed', err)
      return null
    }),
  ])
  return { overview, cards, now: now.toISOString() }
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
  const { overview: o, cards, now } = useLoaderData<typeof loader>()
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

      <SignalHealthCard health={cards?.signalHealth ?? null} failed={cards == null || cards.signalHealth == null} />
      <BurnCard burn={cards?.burn ?? null} failed={cards == null || cards.burn == null} />

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

// ---------------------------------------------------------------------------
// Signal health and Burn to date (ticket #16686)
// ---------------------------------------------------------------------------

const STATE_PILL: Record<SignalHealth['state'], { label: string; cls: string }> = {
  red: { label: 'Red', cls: 'border-red-300 bg-red-50 text-red-800' },
  amber: { label: 'Watch', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  ok: { label: 'OK', cls: 'border-line bg-paper-2 text-sage' },
  empty: { label: 'No reading', cls: 'border-line bg-paper-2 text-ink-3' },
}

function pct(v: number | null): string {
  return v == null ? 'n/a' : `${Math.round(v * 100)}%`
}

function SignalHealthCard({ health, failed }: { health: SignalHealth | null; failed: boolean }) {
  const pill = STATE_PILL[health?.state ?? 'empty']
  return (
    <section aria-label="Signal health" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="kicker">Signal health</p>
        <span className={`rounded-full border px-2 font-mono text-[10px] uppercase tracking-wide ${pill.cls}`}>{pill.label}</span>
        {health?.snapshot && (
          <span className={`font-mono text-[11px] ${health.snapshot.stale ? 'text-amber-800' : 'text-ink-3'}`}>
            pixel snapshot {health.snapshot.age}{health.source ? `, from ${health.source}` : ''}
          </span>
        )}
      </div>
      <div className="space-y-3 rounded-2xl border border-line bg-paper p-4">
        {!health ? (
          <p className="text-sm text-ink-3">
            {failed
              ? 'Signal health is unknown: the snapshot read failed. Migration 136 may not be applied yet.'
              : 'No reading yet.'}
          </p>
        ) : health.state === 'empty' ? (
          <p className="text-sm text-ink-3">
            No pixel snapshot yet. The daily ads routine records one through /api/team/ad-health-snapshot after it reads dataset quality in the Meta Ads MCP. Until then nothing here says whether Meta sees the leads we store.
          </p>
        ) : (
          <>
            {health.reasons.length > 0 && (
              <ul className="space-y-1">
                {health.reasons.map(r => (
                  <li key={r} className={`text-sm ${health.state === 'red' ? 'text-red-800' : 'text-amber-800'}`}>{r}</li>
                ))}
              </ul>
            )}
            {health.leads.length > 0 && (
              <ResponsiveTable>
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[11px] uppercase tracking-wide text-ink-3">
                      <th className="py-1 pr-3 font-normal">Window</th>
                      <th className="py-1 pr-3 font-normal">Meta Lead events</th>
                      <th className="py-1 pr-3 font-normal">Leads we stored</th>
                      <th className="py-1 font-normal">Gap</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {health.leads.map(l => (
                      <tr key={l.window} className="border-t border-line">
                        <td className="py-1.5 pr-3 font-mono text-xs">{l.window}</td>
                        <td className="py-1.5 pr-3">{l.meta == null ? 'not reported' : l.meta}</td>
                        <td className="py-1.5 pr-3">{l.ours}</td>
                        <td className={`py-1.5 ${l.gap != null && l.gap > LEAD_GAP_MAX ? 'font-semibold text-red-800' : 'text-ink'}`}>{pct(l.gap)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ResponsiveTable>
            )}
            {health.events.length > 0 && (
              <div>
                <p className="font-mono text-[11px] uppercase tracking-wide text-ink-3">Event match quality, red under {EMQ_FLOOR}</p>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {health.events.map(e => (
                    <li
                      key={e.event}
                      className={`rounded-full border px-2.5 py-0.5 font-mono text-xs ${e.emq != null && e.emq < EMQ_FLOOR ? 'border-red-300 bg-red-50 text-red-800' : 'border-line bg-paper-2 text-ink'}`}
                    >
                      {e.event} {e.emq == null ? 'n/a' : e.emq.toFixed(1)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {health && health.attributedLeads7d != null && (
          <p className="text-xs text-ink-3">
            Meta attributed {health.attributedLeads7d} lead{health.attributedLeads7d === 1 ? '' : 's'} to ads in the last 7 days (insights mirror). Leads we stored count every /api/lead signup, paid or not.
          </p>
        )}
      </div>
    </section>
  )
}

function signedMoney(cents: number): string {
  return cents < 0 ? `-${formatMoney(-cents)}` : formatMoney(cents)
}

function BurnCells({ f, breakEvenCents }: { f: BurnFigures; breakEvenCents: number }) {
  const cacTone = f.cacCents == null ? '' : f.cacCents > breakEvenCents ? 'text-red-800' : 'text-sage'
  return (
    <>
      <td className="py-1.5 pr-3">{formatMoney(f.spendCents)}</td>
      <td className="py-1.5 pr-3">{f.leads}</td>
      <td className="py-1.5 pr-3">{money(f.cplCents)}</td>
      <td className="py-1.5 pr-3">{f.orders}</td>
      <td className={`py-1.5 pr-3 ${cacTone}`}>
        {f.cacCents == null ? (f.spendCents > 0 ? 'no orders' : 'n/a') : formatMoney(f.cacCents)}
      </td>
      <td className={`py-1.5 ${f.contributionCents < 0 ? 'font-semibold text-red-800' : 'text-ink'}`}>{signedMoney(f.contributionCents)}</td>
    </>
  )
}

function BurnRowPair({ label, first, sinceFirst, d28, breakEvenCents, total }: {
  label: string
  first: string | null
  sinceFirst: BurnFigures
  d28: BurnFigures
  breakEvenCents: number
  total: boolean
}) {
  const cls = total ? 'font-semibold' : ''
  return (
    <>
      <tr className={`border-t border-line ${cls}`}>
        <td className="py-1.5 pr-3 align-top font-mono text-xs" rowSpan={2}>{label}</td>
        <td className="py-1.5 pr-3 text-xs text-ink-3">{first ? `since ${first}` : 'never spent'}</td>
        <BurnCells f={sinceFirst} breakEvenCents={breakEvenCents} />
      </tr>
      <tr className={cls}>
        <td className="py-1.5 pr-3 text-xs text-ink-3">last 28d</td>
        <BurnCells f={d28} breakEvenCents={breakEvenCents} />
      </tr>
    </>
  )
}

function BurnCard({ burn, failed }: { burn: Burn | null; failed: boolean }) {
  const lines = burn
    ? [
        ...burn.rows.map(r => ({ key: r.platform, label: r.platform, first: r.firstSpendDay, sinceFirst: r.sinceFirst, d28: r.d28 })),
        ...(burn.rows.length > 1
          ? [{ key: '__total', label: 'All channels', first: burn.total.firstSpendDay, sinceFirst: burn.total.sinceFirst, d28: burn.total.d28 }]
          : []),
      ]
    : []
  return (
    <section aria-label="Burn to date" className="space-y-2">
      <p className="kicker">Burn to date</p>
      <div className="space-y-3 rounded-2xl border border-line bg-paper p-4">
        {!burn ? (
          <p className="text-sm text-ink-3">{failed ? 'Burn to date is unknown: the spend read failed.' : 'No reading yet.'}</p>
        ) : burn.rows.length === 0 ? (
          <p className="text-sm text-ink-3">
            No spend or attributed orders recorded yet. The hourly insights pull fills this once a channel with a token spends.
          </p>
        ) : (
          <>
            <ResponsiveTable>
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[11px] uppercase tracking-wide text-ink-3">
                    <th className="py-1 pr-3 font-normal">Channel</th>
                    <th className="py-1 pr-3 font-normal">Window</th>
                    <th className="py-1 pr-3 font-normal">Spend</th>
                    <th className="py-1 pr-3 font-normal">Leads</th>
                    <th className="py-1 pr-3 font-normal">CPL</th>
                    <th className="py-1 pr-3 font-normal">Orders</th>
                    <th className="py-1 pr-3 font-normal">CAC</th>
                    <th className="py-1 font-normal">Contribution</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {lines.map(r => (
                    <BurnRowPair
                      key={r.key}
                      label={r.label}
                      first={r.first}
                      sinceFirst={r.sinceFirst}
                      d28={r.d28}
                      breakEvenCents={burn.breakEven.cpaCents}
                      total={r.key === '__total'}
                    />
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
            <p className="text-xs text-ink-3">
              Spend and leads are what each platform reports at ad level. Orders and revenue are attributed orders. CAC turns red above the {formatMoney(burn.breakEven.cpaCents)} break-even
              (AOV {formatMoney(burn.breakEven.aovCents)} at {burn.breakEven.marginPct}% margin). Contribution is net revenue at that margin minus spend.
            </p>
          </>
        )}
      </div>
    </section>
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
