import { requireAdmin } from '~/lib/session.server'
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { db } from '~/lib/db.server'
import { pipelineSettings } from '../../db/schema'
import { kvGet, kvDel, KV_KEYS } from '~/lib/kv.server'
import { orchestrateDealPipeline } from '~/lib/deal-pipeline.server'
import { paginateAllProductsForSanity } from '~/lib/shopify.server'
import { upsertProductPage } from '~/lib/sanity.server'
import { resolveGa4, invalidateGa4Cache } from '~/lib/ga4-config.server'

export const meta: MetaFunction = () => [{ title: 'Pipeline Settings — xdipx Admin' }]

const DEFAULT_BRAND_VOICE = `Brand voice: playful, cheeky, warm, curious. Never clinical. Never sleazy. Write as a trusted, funny friend who isn't embarrassed about the topic. Your goal is to welcome first-time buyers and delight experienced ones. Keep all copy tasteful — suggestive is fine, explicit is not. Always signal discretion, value, and trust. Never use "sex" as an adjective — use "intimate", "pleasure", or "wellness". Never assume the reader's experience level.`

const DEFAULT_FAREWELL_MAX_PROMPTS =
  "I really like you — but it might be easier if you send an email to hello at exdipex dot com and we can help you directly. Once again that's hello at exdipex dot com."
const DEFAULT_FAREWELL_MAX_DURATION = DEFAULT_FAREWELL_MAX_PROMPTS
const DEFAULT_FAREWELL_SILENT = ''

const DEFAULTS: Record<string, string> = {
  feedUrl:                  process.env['NALPAC_FEED_URL'] ?? '',
  daysAhead:                '2',
  blockedBrands:            '',
  minProfit:                '0',
  vaultDiscountPct:         '25',
  brandVoice:               DEFAULT_BRAND_VOICE,
  enrichmentMode:           'api',
  ivrFarewellMaxPrompts:    DEFAULT_FAREWELL_MAX_PROMPTS,
  ivrFarewellMaxDuration:   DEFAULT_FAREWELL_MAX_DURATION,
  ivrFarewellSilent:        DEFAULT_FAREWELL_SILENT,
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const rows = await db.select().from(pipelineSettings)
  const settings: Record<string, string> = { ...DEFAULTS }
  for (const row of rows) settings[row.key] = row.value

  const feedTimestamp = await kvGet<string>(KV_KEYS.feedCacheTimestamp)
  const candidates    = await kvGet<unknown[]>('feed:top-candidates')

  const ga4 = await resolveGa4()

  return {
    settings,
    feedTimestamp,
    candidateCount: candidates?.length ?? 0,
    ga4,
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form   = await request.formData()
  const intent = form.get('intent') as string

  console.log('[admin.settings action] intent:', JSON.stringify(intent))

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

    // Changing the GA4 measurement ID invalidates the resolver cache so the
    // new value is picked up on the next SSR render rather than waiting for
    // the 5-min TTL.
    if (key === 'ga4MeasurementId') {
      await invalidateGa4Cache()
    }

    return { ok: true, saved: key }
  }

  if (intent === 'ga4-ping') {
    const ga4 = await resolveGa4()
    if (!ga4.id) {
      return { ok: false, ga4Ping: { ok: false, error: 'No GA4 measurement ID configured.' } }
    }
    // GA4 Measurement Protocol heartbeat. Requires an API Secret created in
    // GA4 Admin → Data Streams → Web → Measurement Protocol API secrets.
    // Without it we can still validate the gtag.js URL is reachable.
    const apiSecret = process.env['GA4_API_SECRET']?.trim()
    try {
      // Always validate the gtag.js URL is reachable from this region.
      const gtagRes = await fetch(`https://www.googletagmanager.com/gtag/js?id=${ga4.id}`, { method: 'HEAD' })
      const gtagOk = gtagRes.ok

      let mpOk: boolean | null = null
      let mpStatus: number | null = null
      if (apiSecret) {
        const mpRes = await fetch(
          `https://www.google-analytics.com/mp/collect?measurement_id=${ga4.id}&api_secret=${apiSecret}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: `admin-health-${Date.now()}`,
              events: [{ name: 'admin_health_check', params: { source: 'admin_settings' } }],
            }),
          },
        )
        mpOk = mpRes.ok
        mpStatus = mpRes.status
      }

      return {
        ok: true,
        ga4Ping: {
          ok: gtagOk && (mpOk === null || mpOk === true),
          measurementId: ga4.id,
          source: ga4.source,
          gtagOk,
          gtagStatus: gtagRes.status,
          mpOk,
          mpStatus,
          hasApiSecret: Boolean(apiSecret),
          checkedAt: new Date().toISOString(),
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, ga4Ping: { ok: false, error: msg } }
    }
  }

  if (intent === 'run-pipeline') {
    const minMarginPct = Math.min(Math.max(parseFloat(form.get('minMargin') as string ?? '40'), 0), 99) / 100
    const result = await orchestrateDealPipeline(minMarginPct)
    return { ok: true, pipeline: result }
  }

  if (intent === 'sync-sanity') {
    try {
      let created = 0
      let skipped = 0

      await paginateAllProductsForSanity(async products => {
        await Promise.all(products.map(async p => {
          const gid = `gid://shopify/Product/${p.id}`
          const result = await upsertProductPage({
            handle: p.handle,
            shopifyProductId: gid,
            title: p.title,
            imageUrl: p.images[0]?.src,
          }).catch(err => {
            console.error(`[sync-sanity] failed for ${p.handle}:`, err)
            return { created: false }
          })
          if (result.created) created++
          else skipped++
        }))
      })

      return { ok: true, syncSanity: { created, skipped } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[sync-sanity] fatal:', msg)
      return { ok: false, syncSanity: null, error: msg }
    }
  }

  return null
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AdminSettingsPage() {
  const { settings, feedTimestamp, candidateCount, ga4 } = useLoaderData<typeof loader>()
  const fetcher         = useFetcher<typeof action>()
  const pipelineFetcher = useFetcher<typeof action>()
  const ga4Fetcher      = useFetcher<typeof action>()

  const ga4Ping = ga4Fetcher.data && 'ga4Ping' in ga4Fetcher.data
    ? (ga4Fetcher.data as { ga4Ping: {
        ok: boolean
        error?: string
        measurementId?: string
        source?: string
        gtagOk?: boolean
        gtagStatus?: number
        mpOk?: boolean | null
        mpStatus?: number | null
        hasApiSecret?: boolean
        checkedAt?: string
      } }).ga4Ping
    : null

  const pipelineResult = pipelineFetcher.data && 'pipeline' in pipelineFetcher.data
    ? pipelineFetcher.data.pipeline
    : null

  const syncResult = fetcher.data && 'syncSanity' in fetcher.data
    ? fetcher.data.syncSanity
    : null
  const syncError = fetcher.data && 'error' in fetcher.data && 'syncSanity' in fetcher.data
    ? (fetcher.data as { error: string }).error
    : null

  function SaveForm({ label, settingKey, type = 'text', description, min, max, inputWidth, multiline, rows }: {
    label: string
    settingKey: string
    type?: string
    description?: string
    min?: number
    max?: number
    inputWidth?: string
    multiline?: boolean
    rows?: number
  }) {
    return (
      <fetcher.Form method="post" className="space-y-1">
        <input type="hidden" name="intent" value="save-setting" />
        <input type="hidden" name="key"    value={settingKey} />
        <label className="block text-sm font-semibold text-ink">
          {label}
        </label>
        {description && (
          <p className="text-xs text-ink/50">{description}</p>
        )}
        <div className={`flex flex-col gap-2 ${multiline ? '' : 'md:flex-row md:items-center md:gap-3'} pt-1`}>
          {multiline ? (
            <textarea
              name="value"
              defaultValue={settings[settingKey] ?? ''}
              rows={rows ?? 4}
              className="w-full border border-cream-2 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage/30 font-body leading-relaxed"
            />
          ) : (
            <input
              type={type}
              name="value"
              defaultValue={settings[settingKey] ?? ''}
              className={`w-full ${inputWidth ? `md:${inputWidth}` : 'md:flex-1'} border border-cream-2 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage/30`}
              min={min}
              max={max}
            />
          )}
          <button
            type="submit"
            className={`text-sm font-semibold px-4 py-2 bg-cream-2 text-sage rounded-full hover:bg-sage/10 transition-colors whitespace-nowrap ${multiline ? 'self-start' : ''}`}
          >
            Save
          </button>
        </div>
      </fetcher.Form>
    )
  }

  return (
    <div className="max-w-2xl space-y-8">
      <h1
        className="text-2xl font-bold text-ink"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Settings
      </h1>

      {/* Analytics */}
      <section className="bg-white rounded-2xl p-6 shadow-sm space-y-6">
        <h2 className="text-base font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Analytics
        </h2>

        {/* Health badge — shows where the active GA4 ID is being resolved from
            so a misconfigured Vercel env var (the most recent outage cause)
            is visible at a glance. */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between rounded-xl border border-cream-2 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                ga4.source === 'none' ? 'bg-coral' : 'bg-sage'
              }`}
            />
            <span className="text-ink/70">
              GA4 active:{' '}
              <span className="font-mono text-ink">
                {ga4.id || '(none)'}
              </span>
            </span>
            <span className="text-ink/40">
              ·{' '}
              {ga4.source === 'env'
                ? 'from GA4_MEASUREMENT_ID env var'
                : ga4.source === 'db'
                  ? 'from pipeline_settings (DB)'
                  : 'not configured — analytics disabled'}
            </span>
          </div>
          <ga4Fetcher.Form method="post">
            <input type="hidden" name="intent" value="ga4-ping" />
            <button
              type="submit"
              disabled={ga4Fetcher.state !== 'idle' || !ga4.id}
              className="text-xs font-semibold px-3 py-1.5 bg-cream-2 text-sage rounded-full hover:bg-sage/10 transition-colors disabled:opacity-40"
            >
              {ga4Fetcher.state !== 'idle' ? 'Pinging…' : 'Run health check'}
            </button>
          </ga4Fetcher.Form>
        </div>

        {ga4Ping && (
          <div
            className={`rounded-xl px-4 py-3 text-xs space-y-1 ${
              ga4Ping.ok ? 'bg-sage/10 text-ink' : 'bg-coral/10 text-ink'
            }`}
          >
            {ga4Ping.error ? (
              <div>Error: {ga4Ping.error}</div>
            ) : (
              <>
                <div>
                  gtag.js load:{' '}
                  <span className="font-mono">
                    {ga4Ping.gtagOk ? 'OK' : 'FAIL'} ({ga4Ping.gtagStatus})
                  </span>
                </div>
                <div>
                  Measurement Protocol:{' '}
                  {ga4Ping.hasApiSecret ? (
                    <span className="font-mono">
                      {ga4Ping.mpOk ? 'OK' : 'FAIL'} ({ga4Ping.mpStatus})
                    </span>
                  ) : (
                    <span className="text-ink/50">
                      skipped — set GA4_API_SECRET env var to enable
                    </span>
                  )}
                </div>
                {ga4Ping.checkedAt && (
                  <div className="text-ink/40">
                    Checked {new Date(ga4Ping.checkedAt).toLocaleString()}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <SaveForm
          label="GA4 Measurement ID"
          settingKey="ga4MeasurementId"
          description="Google Analytics 4 measurement ID (e.g. G-XXXXXXXXXX). Used as a fallback when the GA4_MEASUREMENT_ID env var is empty."
        />
      </section>

      {/* Feed Settings */}
      <section className="bg-white rounded-2xl p-6 shadow-sm space-y-6">
        <h2 className="text-base font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
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
          min={1}
          max={7}
          description="How many days ahead to schedule the next deal (1–7). Default: 2."
        />

        <SaveForm
          label="Blocked Brands"
          settingKey="blockedBrands"
          description="Comma-separated list of brand names to exclude from deal selection. Case-insensitive. e.g. Acme, Foobar, Some Brand"
        />

        <SaveForm
          label="Deal Close Price Adjustment"
          settingKey="vaultDiscountPct"
          type="number"
          min={5}
          max={60}
          inputWidth="w-20"
          description="When a deal ends, the new Everyday Price will be MSRP less the value below when it leaves the buy box."
        />

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-6 text-sm text-ink/60 pt-2 border-t border-cream-2">
          <span>
            Last feed run:{' '}
            <span className="font-medium text-ink">
              {feedTimestamp
                ? new Date(feedTimestamp).toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET'
                : 'Never'}
            </span>
          </span>
          <span>
            Candidates in cache:{' '}
            <span className="font-medium text-ink">{candidateCount}</span>
          </span>
        </div>
      </section>

      {/* Pipeline */}
      <section className="bg-white rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="text-base font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Pipeline
        </h2>
        <p className="text-sm text-ink/60">
          Manually run the full pipeline: fetch feed → select deal → create Shopify product →
          generate AI copy → push metafields → stage for review.
        </p>

        {/* Enrichment Mode toggle — controls how the cron-driven Nalpac
            automation generates AI copy. `api` is the default sync path
            (real-time, full price). `batch` uses Anthropic's Batch API
            (50% off, async — results within 24h, usually minutes). */}
        <fetcher.Form method="post" className="space-y-1">
          <input type="hidden" name="intent" value="save-setting" />
          <input type="hidden" name="key"    value="enrichmentMode" />
          <label className="block text-sm font-semibold text-ink">
            Enrichment Mode
          </label>
          <p className="text-xs text-ink/50">
            <strong>API</strong> — sync, real-time, full price. Use for admin "regenerate now" actions.<br />
            <strong>Batch</strong> — Anthropic Batch API, 50% off, async (results within 24h, usually minutes).
            Use this when the Nalpac automation runs nightly and you don't need instant results.
          </p>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3 pt-1">
            <select
              name="value"
              defaultValue={settings['enrichmentMode'] ?? 'api'}
              className="w-full md:flex-1 border border-cream-2 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage/30"
            >
              <option value="api">API — sync, full price</option>
              <option value="batch">Batch — async, 50% off</option>
            </select>
            <button
              type="submit"
              className="text-sm font-semibold px-4 py-2 bg-cream-2 text-sage rounded-full hover:bg-sage/10 transition-colors whitespace-nowrap"
            >
              Save
            </button>
          </div>
        </fetcher.Form>

        <SaveForm
          label="Minimum Profit per Unit"
          settingKey="minProfit"
          type="number"
          min={0}
          inputWidth="w-20"
          description="Only select products with at least this much profit per unit (deal price − wholesale cost). Enter a dollar amount, e.g. 10 for $10 minimum."
        />

        <div className="pt-2 border-t border-cream-2">
          <pipelineFetcher.Form method="post" className="flex flex-col gap-3 md:flex-row md:items-end">
            <input type="hidden" name="intent" value="run-pipeline" />
            <div>
              <label className="block text-xs font-semibold text-ink/50 mb-1">
                Min Gross Margin
              </label>
              <div className="relative w-full md:w-28">
                <input
                  type="number"
                  name="minMargin"
                  defaultValue="40"
                  min="0"
                  max="99"
                  step="1"
                  className="w-full border border-cream-2 rounded-xl pl-3 pr-7 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage/30"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink/40">%</span>
              </div>
            </div>
            <button
              type="submit"
              disabled={pipelineFetcher.state !== 'idle'}
              className="w-full md:w-auto text-sm font-semibold px-5 py-2.5 bg-coral text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {pipelineFetcher.state !== 'idle' ? '⏳ Running…' : '▶ Run Pipeline Now'}
            </button>
          </pipelineFetcher.Form>
        </div>

        {pipelineResult && (
          <div className={`rounded-xl p-4 text-sm space-y-1 ${pipelineResult.staged ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
            {pipelineResult.staged ? (
              <>
                <p>
                  ✓ Staged <strong>{pipelineResult.sku}</strong> for{' '}
                  <strong>{pipelineResult.dealDate}</strong> — ready for review in the Deal Queue.
                </p>
                {pipelineResult.copyJobId && (
                  <p className="text-xs text-green-600">
                    Copy generation queued.{' '}
                    <a
                      href={`/admin/async-jobs?jobId=${pipelineResult.copyJobId}`}
                      className="underline font-semibold"
                    >
                      Track batch job
                    </a>
                    {' '}— fields apply automatically when the batch completes.
                  </p>
                )}
              </>
            ) : (
              <p>⚠ Pipeline did not stage a deal: {pipelineResult.reason}</p>
            )}
          </div>
        )}
      </section>

      {/* ── Sanity Sync ──────────────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-base font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
            Sanity Product Sync
          </h2>
          <p className="text-sm text-ink/60 mt-1">
            Creates a Sanity <code className="text-xs bg-cream-2 px-1 py-0.5 rounded">productPage</code> stub
            for every Shopify product that doesn't have one yet. Safe to run multiple times — existing docs are skipped.
            New products added to Shopify in future will sync automatically via webhook.
          </p>
        </div>

        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="sync-sanity" />
          <button
            type="submit"
            disabled={fetcher.state !== 'idle'}
            className="text-sm font-semibold px-5 py-2.5 bg-cream-2 text-sage rounded-full hover:bg-sage/10 transition-colors disabled:opacity-50"
          >
            {fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'sync-sanity'
              ? '⏳ Syncing…'
              : '↻ Sync all Shopify products → Sanity'}
          </button>
        </fetcher.Form>

        {syncResult && (
          <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
            ✓ Done — <strong>{syncResult.created}</strong> new doc{syncResult.created !== 1 ? 's' : ''} created,{' '}
            <strong>{syncResult.skipped}</strong> already existed.
          </div>
        )}
        {syncError && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 font-mono break-all">
            {syncError}
          </div>
        )}
      </section>

    </div>
  )
}
