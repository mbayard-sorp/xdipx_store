import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { db } from '~/lib/db.server'
import { pipelineSettings } from '../../db/schema'
import { kvGet, kvDel, KV_KEYS } from '~/lib/kv.server'
import { orchestrateDealPipeline } from '~/lib/deal-pipeline.server'
import { shopifyAdmin } from '~/lib/shopify.server'
import { upsertProductPage } from '~/lib/sanity.server'

export const meta: MetaFunction = () => [{ title: 'Pipeline Settings — xdipx Admin' }]

const DEFAULTS: Record<string, string> = {
  feedUrl:           process.env['NALPAC_FEED_URL'] ?? '',
  daysAhead:         '2',
  blockedBrands:     '',
  minProfit:         '0',
  vaultDiscountPct:  '25',
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

    return { ok: true, saved: key }
  }

  if (intent === 'run-pipeline') {
    const minMarginPct = Math.min(Math.max(parseFloat(form.get('minMargin') as string ?? '40'), 0), 99) / 100
    const result = await orchestrateDealPipeline(minMarginPct)
    return { ok: true, pipeline: result }
  }

  if (intent === 'sync-sanity') {
    try {
      interface RestProduct { id: number; handle: string; title: string; images: { src: string }[] }
      let created = 0
      let skipped = 0
      let sinceId = 0

      for (const status of ['active', 'draft', 'archived'] as const) {
        sinceId = 0
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { products } = await shopifyAdmin<{ products: RestProduct[] }>(
            `/products.json?limit=250&since_id=${sinceId}&status=${status}&fields=id,handle,title,images`
          )
          console.log(`[sync-sanity] status=${status} page sinceId=${sinceId} count:`, products?.length ?? 0)
          if (!products?.length) break

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

          if (products.length < 250) break
          sinceId = products[products.length - 1]!.id
        }
      }

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
  const { settings, feedTimestamp, candidateCount } = useLoaderData<typeof loader>()
  const fetcher         = useFetcher<typeof action>()
  const pipelineFetcher = useFetcher<typeof action>()

  const pipelineResult = pipelineFetcher.data && 'pipeline' in pipelineFetcher.data
    ? pipelineFetcher.data.pipeline
    : null

  const syncResult = fetcher.data && 'syncSanity' in fetcher.data
    ? fetcher.data.syncSanity
    : null
  const syncError = fetcher.data && 'error' in fetcher.data && 'syncSanity' in fetcher.data
    ? (fetcher.data as { error: string }).error
    : null

  function SaveForm({ label, settingKey, type = 'text', description, min, max, inputWidth }: {
    label: string
    settingKey: string
    type?: string
    description?: string
    min?: number
    max?: number
    inputWidth?: string
  }) {
    return (
      <fetcher.Form method="post" className="space-y-1">
        <input type="hidden" name="intent" value="save-setting" />
        <input type="hidden" name="key"    value={settingKey} />
        <label className="block text-sm font-semibold text-brand-charcoal">
          {label}
        </label>
        {description && (
          <p className="text-xs text-brand-charcoal/50">{description}</p>
        )}
        <div className="flex gap-3 items-center pt-1">
          <input
            type={type}
            name="value"
            defaultValue={settings[settingKey] ?? ''}
            className={`${inputWidth ?? 'flex-1'} border border-brand-mist rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-purple/30`}
            min={min}
            max={max}
          />
          <button
            type="submit"
            className="text-sm font-semibold px-4 py-2 bg-brand-mist text-brand-purple rounded-full hover:bg-brand-purple/10 transition-colors whitespace-nowrap"
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
        className="text-2xl font-bold text-brand-charcoal"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Settings
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
          label="Vault Discount %"
          settingKey="vaultDiscountPct"
          type="number"
          min={5}
          max={60}
          inputWidth="w-20"
          description="Default discount off MSRP for products after their deal ends. e.g. 25 = vault price is 25% below MSRP."
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

        <SaveForm
          label="Minimum Profit per Unit"
          settingKey="minProfit"
          type="number"
          min={0}
          inputWidth="w-20"
          description="Only select products with at least this much profit per unit (deal price − wholesale cost). Enter a dollar amount, e.g. 10 for $10 minimum."
        />

        <div className="pt-2 border-t border-brand-mist">
          <pipelineFetcher.Form method="post" className="flex items-end gap-3">
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
              disabled={pipelineFetcher.state !== 'idle'}
              className="text-sm font-semibold px-5 py-2.5 bg-brand-gradient text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {pipelineFetcher.state !== 'idle' ? '⏳ Running…' : '▶ Run Pipeline Now'}
            </button>
          </pipelineFetcher.Form>
        </div>

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

      {/* ── Sanity Sync ──────────────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-base font-bold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
            Sanity Product Sync
          </h2>
          <p className="text-sm text-brand-charcoal/60 mt-1">
            Creates a Sanity <code className="text-xs bg-brand-mist px-1 py-0.5 rounded">productPage</code> stub
            for every Shopify product that doesn't have one yet. Safe to run multiple times — existing docs are skipped.
            New products added to Shopify in future will sync automatically via webhook.
          </p>
        </div>

        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="sync-sanity" />
          <button
            type="submit"
            disabled={fetcher.state !== 'idle'}
            className="text-sm font-semibold px-5 py-2.5 bg-brand-mist text-brand-purple rounded-full hover:bg-brand-purple/10 transition-colors disabled:opacity-50"
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
