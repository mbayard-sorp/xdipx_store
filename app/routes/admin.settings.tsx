import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { db } from '~/lib/db.server'
import { pipelineSettings } from '../../db/schema'
import { kvGet, kvDel, KV_KEYS } from '~/lib/kv.server'
import { orchestrateDealPipeline } from '~/lib/deal-pipeline.server'
import { eq } from 'drizzle-orm'

export const meta: MetaFunction = () => [{ title: 'Pipeline Settings — xdipx Admin' }]

const DEFAULTS: Record<string, string> = {
  feedUrl:   process.env['NALPAC_FEED_URL'] ?? '',
  daysAhead: '2',
}

export async function loader(_: LoaderFunctionArgs) {
  const rows = await db.select().from(pipelineSettings)
  const settings: Record<string, string> = { ...DEFAULTS }
  for (const row of rows) settings[row.key] = row.value

  const feedTimestamp = await kvGet<string>(KV_KEYS.feedCacheTimestamp)
  const candidates    = await kvGet<unknown[]>('feed:top-candidates')

  return {
    settings,
    feedTimestamp,
    candidateCount: candidates?.length ?? 0,
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const form   = await request.formData()
  const intent = form.get('intent') as string

  if (intent === 'save-setting') {
    const key   = form.get('key')   as string
    const value = form.get('value') as string
    if (!key || value === null) return { ok: false, error: 'Missing key or value' }

    await db
      .insert(pipelineSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: pipelineSettings.key, set: { value, updatedAt: new Date() } })

    // Changing feed URL invalidates the cached feed
    if (key === 'feedUrl') {
      await kvDel(KV_KEYS.feedCache)
      await kvDel(KV_KEYS.feedCacheTimestamp)
    }

    return { ok: true, saved: key }
  }

  if (intent === 'run-pipeline') {
    const minMarginPct = Math.min(Math.max(parseFloat(form.get('minMargin') as string ?? '40'), 0), 99) / 100
    const result = await orchestrateDealPipeline(minMarginPct)
    return { ok: true, pipeline: result }
  }

  return null
}

export default function AdminSettingsPage() {
  const { settings, feedTimestamp, candidateCount } = useLoaderData<typeof loader>()
  const fetcher = useFetcher<typeof action>()

  const pipelineResult = fetcher.data && 'pipeline' in fetcher.data
    ? fetcher.data.pipeline
    : null

  function SaveForm({ label, settingKey, type = 'text', description }: {
    label: string
    settingKey: string
    type?: string
    description?: string
  }) {
    return (
      <fetcher.Form method="post" className="flex gap-3 items-start">
        <input type="hidden" name="intent" value="save-setting" />
        <input type="hidden" name="key"    value={settingKey} />
        <div className="flex-1">
          <label className="block text-sm font-semibold text-brand-charcoal mb-1">
            {label}
          </label>
          {description && (
            <p className="text-xs text-brand-charcoal/50 mb-2">{description}</p>
          )}
          <input
            type={type}
            name="value"
            defaultValue={settings[settingKey] ?? ''}
            className="w-full border border-brand-mist rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
            min={type === 'number' ? 1 : undefined}
            max={type === 'number' ? 7 : undefined}
          />
        </div>
        <button
          type="submit"
          className="mt-6 text-sm font-semibold px-4 py-2 bg-brand-mist text-brand-purple rounded-full hover:bg-brand-purple/10 transition-colors whitespace-nowrap"
        >
          Save
        </button>
      </fetcher.Form>
    )
  }

  return (
    <div className="max-w-2xl space-y-8">
      <h1
        className="text-2xl font-bold text-brand-charcoal"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Pipeline Settings
      </h1>

      {/* Feed Settings */}
      <section className="bg-white rounded-2xl p-6 shadow-sm space-y-6">
        <h2 className="text-base font-bold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
          Feed Settings
        </h2>

        <SaveForm
          label="Feed URL"
          settingKey="feedUrl"
          description="Nalpac CSV product feed URL. Changing this clears the feed cache immediately."
        />

        <SaveForm
          label="Days Ahead"
          settingKey="daysAhead"
          type="number"
          description="How many days ahead to schedule the next deal (1–7). Default: 2."
        />

        <div className="flex items-center gap-6 text-sm text-brand-charcoal/60 pt-2 border-t border-brand-mist">
          <span>
            Last feed run:{' '}
            <span className="font-medium text-brand-charcoal">
              {feedTimestamp
                ? new Date(feedTimestamp).toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET'
                : 'Never'}
            </span>
          </span>
          <span>
            Candidates in cache:{' '}
            <span className="font-medium text-brand-charcoal">{candidateCount}</span>
          </span>
        </div>
      </section>

      {/* Pipeline */}
      <section className="bg-white rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="text-base font-bold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
          Pipeline
        </h2>
        <p className="text-sm text-brand-charcoal/60">
          Manually run the full pipeline: fetch feed → select deal → create Shopify product →
          generate AI copy → push metafields → stage for review.
        </p>

        <fetcher.Form method="post" className="flex items-end gap-3">
          <input type="hidden" name="intent" value="run-pipeline" />
          <div>
            <label className="block text-xs font-semibold text-brand-charcoal/50 mb-1">
              Min Gross Margin
            </label>
            <div className="relative w-28">
              <input
                type="number"
                name="minMargin"
                defaultValue="40"
                min="0"
                max="99"
                step="1"
                className="w-full border border-brand-mist rounded-xl pl-3 pr-7 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-brand-charcoal/40">%</span>
            </div>
          </div>
          <button
            type="submit"
            disabled={fetcher.state !== 'idle'}
            className="text-sm font-semibold px-5 py-2.5 bg-brand-gradient text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {fetcher.state !== 'idle' ? '⏳ Running…' : '▶ Run Pipeline Now'}
          </button>
        </fetcher.Form>

        {pipelineResult && (
          <div className={`rounded-xl p-4 text-sm ${pipelineResult.staged ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
            {pipelineResult.staged ? (
              <>
                ✓ Staged <strong>{pipelineResult.sku}</strong> for{' '}
                <strong>{pipelineResult.dealDate}</strong> — ready for review in the Deal Queue.
              </>
            ) : (
              <>⚠ Pipeline did not stage a deal: {pipelineResult.reason}</>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
