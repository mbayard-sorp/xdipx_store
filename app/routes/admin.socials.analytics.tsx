/**
 * /admin/socials/analytics (Social Studio v2, Phase 6a, ticket #4914).
 *
 * Instrument band (range toggle, per-platform follower sparkline with current
 * count and delta, totals), then the post table inside ResponsiveTable with
 * the numbers the six-hourly sweep writes to `metrics_json`. Default sort is
 * best-performing by total interactions; header links re-sort through the
 * URL so the loader owns every number on the page.
 *
 * `?format=csv` on the same loader returns the table as a UTF-8 CSV download.
 */
import type { LoaderFunctionArgs } from 'react-router'
import { Link, useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { loadSocialAnalytics, type AnalyticsPost, type FollowerSeries, type PlatformTotals, type EmptyCause } from '~/lib/social-analytics.server'
import {
  ANALYTICS_RANGES,
  buildAnalyticsCsv,
  csvFilename,
  parsePlatform,
  parseRange,
  parseSort,
  viewsOrImpressions,
  type AnalyticsSort,
} from '~/lib/social-analytics'
import { formatLaWallClock } from '~/lib/social-schedule-ui'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import { PlatformChip } from '~/components/admin/social/PostPreviewCard'
import { MetricSparkline } from '~/components/admin/social/MetricSparkline'
import { ExternalIcon, ChartIcon, ImageIcon } from '~/components/admin/social/icons'
import { PLATFORM_LABELS } from '~/components/admin/social/types'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const now = new Date()
  const range = parseRange(url.searchParams.get('range'))
  const platform = parsePlatform(url.searchParams.get('platform'))
  const sort = parseSort(url.searchParams.get('sort'))
  const analytics = await loadSocialAnalytics({ days: range, platform, sort, now })

  if (url.searchParams.get('format') === 'csv') {
    const csv = buildAnalyticsCsv(analytics.posts.map(p => ({
      id: p.id,
      platform: p.platform,
      postedAt: p.postedAt,
      permalink: p.permalink,
      caption: p.caption,
      metrics: p.metrics,
      interactions: p.hasMetrics ? p.interactions : 0,
    })))
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csvFilename(range, now)}"`,
        'Cache-Control': 'no-store',
      },
    })
  }
  return analytics
}

function num(v: number | null | undefined): string {
  return v == null ? '–' : v.toLocaleString('en-US')
}

function href(base: { range: number; platform: string; sort: string }, patch: Partial<{ range: number; platform: string; sort: string; format: string }>): string {
  const q = new URLSearchParams()
  const merged = { ...base, ...patch }
  q.set('range', String(merged.range))
  if (merged.platform !== 'all') q.set('platform', merged.platform)
  if (merged.sort !== 'best') q.set('sort', merged.sort)
  if (merged.format) q.set('format', merged.format)
  return `/admin/socials/analytics?${q.toString()}`
}

export default function SocialsAnalytics() {
  const a = useLoaderData<typeof loader>()
  const base = { range: a.range, platform: a.platform, sort: a.sort }
  const totalPosts = a.totals.reduce((s, t) => s + t.posts, 0)
  const totalInteractions = a.totals.reduce((s, t) => s + t.interactions, 0)
  const measured = a.totals.reduce((s, t) => s + t.withMetrics, 0)
  const avg = measured ? Math.round((totalInteractions / measured) * 10) / 10 : 0

  return (
    <section className="space-y-4">
      {/* Toolbar: title, range toggle, platform filter, export */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl text-ink">Analytics</h2>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Range" className="inline-flex rounded-lg border border-line bg-paper-2 p-0.5">
            {ANALYTICS_RANGES.map(r => (
              <Link
                key={r}
                to={href(base, { range: r })}
                aria-current={a.range === r ? 'page' : undefined}
                className={`inline-flex h-10 min-w-[44px] items-center justify-center rounded-md px-3 font-mono text-xs tabular-nums ${
                  a.range === r ? 'bg-paper text-ink border border-line' : 'text-ink-3 hover:text-ink'
                }`}
              >
                {r}d
              </Link>
            ))}
          </nav>
          <nav aria-label="Platform" className="inline-flex rounded-lg border border-line bg-paper-2 p-0.5">
            {(['all', 'instagram', 'x'] as const).map(p => (
              <Link
                key={p}
                to={href(base, { platform: p })}
                aria-current={a.platform === p ? 'page' : undefined}
                className={`inline-flex h-10 min-w-[44px] items-center justify-center rounded-md px-3 text-xs font-medium ${
                  a.platform === p ? 'bg-paper text-ink border border-line' : 'text-ink-3 hover:text-ink'
                }`}
              >
                {p === 'all' ? 'All' : PLATFORM_LABELS[p]}
              </Link>
            ))}
          </nav>
          <a
            href={href(base, { format: 'csv' })}
            download
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-ink px-4 text-sm font-medium text-ink hover:bg-paper-2"
          >
            Export CSV
          </a>
        </div>
      </div>

      {/* Instrument band */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-line bg-paper p-4">
          <p className="kicker text-ink-3">Last {a.range} days</p>
          <dl className="mt-3 grid grid-cols-3 gap-2">
            <Stat label="Posts" value={num(totalPosts)} />
            <Stat label="Interactions" value={num(totalInteractions)} />
            <Stat label="Avg / post" value={measured ? num(avg) : '–'} />
          </dl>
          {a.best && (
            <p className="mt-3 text-xs text-ink-3">
              Best: <span className="font-mono tabular-nums text-ink">#{a.best.id}</span>{' '}
              <span className="font-mono tabular-nums text-ink">{num(a.best.interactions)}</span> interactions on {PLATFORM_LABELS[a.best.platform] ?? a.best.platform}
            </p>
          )}
        </div>
        {a.followers.map(f => (
          <FollowerCard key={f.platform} series={f} totals={a.totals.find(t => t.platform === f.platform)} />
        ))}
      </div>

      {/* Table or empty state */}
      {a.emptyCause ? (
        <EmptyState cause={a.emptyCause} range={a.range} />
      ) : (
        <div className="rounded-2xl border border-line bg-paper p-4">
          <ResponsiveTable>
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  <th scope="col" className="py-2 pr-3 w-14">Post</th>
                  <th scope="col" className="py-2 pr-3 w-24">Platform</th>
                  <th scope="col" className="py-2 pr-3 w-44"><SortLink base={base} sort="recent" current={a.sort}>Posted (LA)</SortLink></th>
                  <th scope="col" className="py-2 pr-3">Caption</th>
                  <th scope="col" className="py-2 pr-3 text-right"><SortLink base={base} sort="likes" current={a.sort}>Likes</SortLink></th>
                  <th scope="col" className="py-2 pr-3 text-right"><SortLink base={base} sort="comments" current={a.sort}>Comments</SortLink></th>
                  <th scope="col" className="py-2 pr-3 text-right"><SortLink base={base} sort="saves" current={a.sort}>Saves</SortLink></th>
                  <th scope="col" className="py-2 pr-3 text-right"><SortLink base={base} sort="views" current={a.sort}>Views</SortLink></th>
                  <th scope="col" className="py-2 pr-3 text-right"><SortLink base={base} sort="best" current={a.sort}>Total</SortLink></th>
                  <th scope="col" className="py-2 w-12"><span className="sr-only">Live post</span></th>
                </tr>
              </thead>
              <tbody>
                {a.posts.map(p => <PostRow key={p.id} post={p} />)}
              </tbody>
            </table>
          </ResponsiveTable>
          <p className="mt-3 font-mono text-[11px] text-ink-3">
            {a.posts.length} posted {a.posts.length === 1 ? 'row' : 'rows'} since {formatLaWallClock(a.since)}.
            {' '}Numbers refresh every 6 hours{a.sweepEnabled ? '' : ' once the metrics sweep valve is on'}; a dash means the platform never reported that field.
          </p>
        </div>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-1 font-mono text-lg tabular-nums text-ink">{value}</dd>
    </div>
  )
}

function FollowerCard({ series, totals }: { series: FollowerSeries; totals: PlatformTotals | undefined }) {
  const delta = series.delta
  const deltaText = delta == null ? null : `${delta > 0 ? '+' : ''}${delta.toLocaleString('en-US')}`
  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="kicker text-ink-3">{PLATFORM_LABELS[series.platform]} followers</p>
        {totals && (
          <span className="font-mono text-[11px] tabular-nums text-ink-3">
            {totals.posts} {totals.posts === 1 ? 'post' : 'posts'} · {num(totals.interactions)} int.
          </span>
        )}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-2xl tabular-nums text-ink">{series.current == null ? '–' : series.current.toLocaleString('en-US')}</p>
          <p className="mt-1 font-mono text-xs tabular-nums text-ink-3">
            {deltaText != null ? `${deltaText} over ${series.points.length} readings` : series.platform === 'x' ? 'X follower count is not captured' : 'no readings in range yet'}
          </p>
        </div>
        <MetricSparkline
          label={`${PLATFORM_LABELS[series.platform]} followers`}
          points={series.points.map(p => ({ at: p.at, value: p.followers }))}
          className={delta != null && delta < 0 ? 'text-coral' : 'text-plum'}
        />
      </div>
    </div>
  )
}

function SortLink({ base, sort, current, children }: { base: { range: number; platform: string; sort: string }; sort: AnalyticsSort; current: AnalyticsSort; children: string }) {
  const active = current === sort
  return (
    <Link
      to={href(base, { sort })}
      aria-sort={active ? 'descending' : undefined}
      className={`inline-flex min-h-[44px] items-center gap-1 hover:text-ink ${active ? 'text-ink' : ''}`}
    >
      {children}
      {active && <span aria-hidden="true">↓</span>}
    </Link>
  )
}

function PostRow({ post }: { post: AnalyticsPost }) {
  const m = post.metrics
  return (
    <tr className="border-b border-line last:border-0 align-middle">
      <td className="py-2 pr-3">
        <div className="h-12 w-12 overflow-hidden rounded-md border border-line bg-paper-3" style={{ aspectRatio: '1 / 1' }}>
          {post.thumbUrl ? (
            <img src={post.thumbUrl} alt="" width={48} height={48} loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-ink-4"><ImageIcon size={16} /></div>
          )}
        </div>
      </td>
      <td className="py-2 pr-3"><PlatformChip platform={post.platform} /></td>
      <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink-3 whitespace-nowrap">{formatLaWallClock(post.postedAt) ?? '–'}</td>
      <td className="py-2 pr-3 text-ink">
        <span className="block max-w-[28rem] truncate" title={post.caption}>{post.caption || <span className="text-ink-4">(no caption)</span>}</span>
        <span className="font-mono text-[11px] tabular-nums text-ink-4">#{post.id}{post.isVideo ? ' · video' : ''}</span>
      </td>
      <td className="py-2 pr-3 text-right font-mono tabular-nums">{num(m.likes)}</td>
      <td className="py-2 pr-3 text-right font-mono tabular-nums">{num(m.comments)}</td>
      <td className="py-2 pr-3 text-right font-mono tabular-nums">{num(m.saves)}</td>
      <td className="py-2 pr-3 text-right font-mono tabular-nums">{num(viewsOrImpressions(m))}</td>
      <td className="py-2 pr-3 text-right font-mono tabular-nums text-ink">{post.hasMetrics ? num(post.interactions) : '–'}</td>
      <td className="py-2 text-right">
        {post.permalink ? (
          <a
            href={post.permalink}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open live post #${post.id}`}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink"
          >
            <ExternalIcon size={16} />
          </a>
        ) : null}
      </td>
    </tr>
  )
}

const EMPTY_COPY: Record<Exclude<EmptyCause, null>, { title: string; cause: (range: number) => string; fix: string }> = {
  no_posts: {
    title: 'Nothing posted in this range',
    cause: r => `No social_posts row has status posted in the last ${r} days.`,
    fix: 'Widen the range, or approve a draft in the Queue and let the hourly publish tick ship it.',
  },
  not_captured: {
    title: 'Metrics not captured yet',
    cause: () => 'Posts exist in range but none has numbers in metrics_json yet.',
    fix: 'The metrics sweep runs every 6 hours and refreshes the newest rows first; check back after the next tick.',
  },
  sweep_off: {
    title: 'Metrics sweep valve is off',
    cause: () => 'Posts exist in range but social_metrics_sweep_enabled is off, so nothing is reading the platforms.',
    fix: 'Turn the valve on from the social tab of /admin/homepage-team (X reads are metered, so this is an owner spend decision).',
  },
}

function EmptyState({ cause, range }: { cause: Exclude<EmptyCause, null>; range: number }) {
  const c = EMPTY_COPY[cause]
  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-line bg-paper p-6 text-center md:p-10">
      <ChartIcon size={24} className="mx-auto text-ink-4" />
      <h3 className="mt-3 font-display text-lg text-ink">{c.title}</h3>
      <p className="mt-2 text-sm text-ink-3"><span className="font-medium text-ink">Cause.</span> {c.cause(range)}</p>
      <p className="mt-1 text-sm text-ink-3"><span className="font-medium text-ink">Fix.</span> {c.fix}</p>
      {cause === 'no_posts' && range < 90 && (
        <Link to={`/admin/socials/analytics?range=90`} className="mt-4 inline-flex h-11 items-center rounded-lg bg-coral px-4 text-sm font-medium text-white hover:bg-coral-2">
          Show 90 days
        </Link>
      )}
    </section>
  )
}
