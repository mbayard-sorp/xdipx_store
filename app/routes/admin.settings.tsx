import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { useState, useRef, useEffect } from 'react'
import { db } from '~/lib/db.server'
import { pipelineSettings } from '../../db/schema'
import { kvGet, kvDel, KV_KEYS } from '~/lib/kv.server'
import { orchestrateDealPipeline } from '~/lib/deal-pipeline.server'
import { getDealByShopifyId, shopifyAdmin } from '~/lib/shopify.server'
import { upsertProductPage } from '~/lib/sanity.server'
import { dealHistory } from '../../db/schema'
import { eq } from 'drizzle-orm'

export const meta: MetaFunction = () => [{ title: 'Pipeline Settings — xdipx Admin' }]

const DEFAULTS: Record<string, string> = {
  feedUrl:       process.env['NALPAC_FEED_URL'] ?? '',
  daysAhead:     '2',
  blockedBrands: '',
  minProfit:     '0',
}

export async function loader(_: LoaderFunctionArgs) {
  const rows = await db.select().from(pipelineSettings)
  const settings: Record<string, string> = { ...DEFAULTS }
  for (const row of rows) settings[row.key] = row.value

  const feedTimestamp = await kvGet<string>(KV_KEYS.feedCacheTimestamp)
  const candidates    = await kvGet<unknown[]>('feed:top-candidates')

  // Use DB + Admin API (no CDN cache) — same pattern as admin.today.tsx
  const [liveRow] = await db
    .select()
    .from(dealHistory)
    .where(eq(dealHistory.status, 'live'))
    .limit(1)

  let liveDeal = null
  if (liveRow?.shopifyProductId) {
    const deal = await getDealByShopifyId(liveRow.shopifyProductId)
    if (deal) {
      liveDeal = {
        productId:      deal.shopifyProductId,
        productName:    deal.seoTitle,
        brand:          deal.brand,
        category:       liveRow.categories?.[0] ?? deal.category,
        tagline:        deal.tagline,
        dealPrice:      deal.dealPrice,
        msrp:           deal.msrp,
        imageUrls:      deal.images.map(i => i.url),
        fullStory:      deal.fullStory,
        worksForHim:    deal.worksForHim,
        worksForHer:    deal.worksForHer,
        featureBullets: deal.featureBullets,
        specifications: deal.specifications,
        whatsInTheBox:  deal.boxContents?.join(', '),
      }
    }
  }

  return {
    settings,
    feedTimestamp,
    candidateCount: candidates?.length ?? 0,
    liveDeal,
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

// ─── Video Generation Section ──────────────────────────────────────────────────

interface GenerateVideoResponse {
  ok?: boolean
  token?: string
  previewUrl?: string
  narratorScript?: string
  reactionText?: string[]
  endTagline?: string
  format?: string
  formatRationale?: string
  voiceName?: string
  error?: string
}

interface PublishVideoResponse {
  ok?: boolean
  mediaId?: string
  ready?: boolean
  thumbnailSet?: { home_page: boolean; pdp: boolean }
  error?: string
}

function VideoGeneratorSection({ liveDeal }: {
  liveDeal: {
    productId: string
    productName: string
    brand: string
    category: string
    tagline?: string
    dealPrice?: number
    msrp?: number
    imageUrls: string[]
    fullStory?: string
    worksForHim?: string
    worksForHer?: string
    featureBullets?: string[]
    specifications?: string
    whatsInTheBox?: string
  } | null
}) {
  const [customPrompt, setCustomPrompt] = useState('')
  const [durationSeconds, setDurationSeconds] = useState(10)
  const [selectedFormat, setSelectedFormat] = useState<string>('auto')
  const [selectedVoice, setSelectedVoice] = useState<string>('Bella')
  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [result, setResult] = useState<GenerateVideoResponse | null>(null)
  const [publishResult, setPublishResult] = useState<PublishVideoResponse | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [pubError, setPubError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Reset publish result when a new video is generated
  useEffect(() => {
    setPublishResult(null)
    setPubError(null)
  }, [result?.token])

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    if (!liveDeal) return
    setGenerating(true)
    setResult(null)
    setGenError(null)
    setPublishResult(null)

    try {
      const fd = new FormData()
      fd.set('productId',   liveDeal.productId)
      fd.set('productName', liveDeal.productName)
      fd.set('brand',       liveDeal.brand)
      fd.set('category',    liveDeal.category)
      fd.set('tagline',     liveDeal.tagline ?? '')
      fd.set('dealPrice',   String(liveDeal.dealPrice ?? ''))
      fd.set('msrp',        String(liveDeal.msrp ?? ''))
      fd.set('imageUrls',   JSON.stringify(liveDeal.imageUrls))
      fd.set('customPrompt', customPrompt)
      fd.set('durationSeconds', String(durationSeconds))
      if (selectedFormat !== 'auto') fd.set('format', selectedFormat)
      fd.set('voice', selectedVoice)
      if (liveDeal.fullStory)      fd.set('fullStory',      liveDeal.fullStory)
      if (liveDeal.worksForHim)    fd.set('worksForHim',    liveDeal.worksForHim)
      if (liveDeal.worksForHer)    fd.set('worksForHer',    liveDeal.worksForHer)
      if (liveDeal.specifications) fd.set('specifications', liveDeal.specifications)
      if (liveDeal.whatsInTheBox)  fd.set('whatsInTheBox',  liveDeal.whatsInTheBox)
      if (liveDeal.featureBullets?.length) fd.set('featureBullets', JSON.stringify(liveDeal.featureBullets))

      const res = await fetch('/api/generate-video', { method: 'POST', body: fd })
      const data = await res.json() as GenerateVideoResponse
      if (!res.ok || data.error) {
        setGenError(data.error ?? 'Generation failed')
      } else {
        setResult(data)
      }
    } catch (err) {
      setGenError(String(err))
    } finally {
      setGenerating(false)
    }
  }

  async function handlePublish() {
    if (!result?.token || !liveDeal) return
    setPublishing(true)
    setPubError(null)

    try {
      const fd = new FormData()
      fd.set('token',       result.token)
      fd.set('productId',   liveDeal.productId)
      fd.set('productName', liveDeal.productName)

      const res = await fetch('/api/publish-video', { method: 'POST', body: fd })
      const data = await res.json() as PublishVideoResponse
      if (!res.ok || data.error) {
        setPubError(data.error ?? 'Upload failed')
      } else {
        setPublishResult(data)
      }
    } catch (err) {
      setPubError(String(err))
    } finally {
      setPublishing(false)
    }
  }

  const published = Boolean(publishResult?.ok)

  return (
    <section className="bg-white rounded-2xl shadow-sm overflow-hidden">
      {/* Section header */}
      <div className="px-6 pt-6 pb-4 border-b border-brand-mist">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #F04E37, #FF8C38)' }}
          >
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-bold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
              Video Generator
            </h2>
            <p className="text-xs text-brand-charcoal/50 mt-0.5">
              Generate a 10-second product ad for today's live deal
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Live deal context */}
        {liveDeal ? (
          <div className="rounded-xl bg-brand-mist/60 px-4 py-3 flex items-center gap-3">
            {liveDeal.imageUrls[0] && (
              <img
                src={liveDeal.imageUrls[0]}
                alt=""
                className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
              />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-brand-charcoal truncate">{liveDeal.productName}</p>
              <p className="text-xs text-brand-charcoal/50">{liveDeal.brand} · {liveDeal.category}</p>
            </div>
            <span className="ml-auto flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700">
              Live
            </span>
          </div>
        ) : (
          <div className="rounded-xl bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-700">
            No live deal found. Activate a deal first.
          </div>
        )}

        {/* Prompt customisation */}
        <form onSubmit={handleGenerate} className="space-y-4">
          <div>
            <label
              htmlFor="video-custom-prompt"
              className="block text-sm font-semibold text-brand-charcoal mb-1"
            >
              Custom direction
              <span className="ml-2 text-xs font-normal text-brand-charcoal/40">(optional)</span>
            </label>
            <p className="text-xs text-brand-charcoal/50 mb-2">
              Guide the tone, reference a specific feature, set a scene. Claude handles the rest.
            </p>
            <textarea
              id="video-custom-prompt"
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              placeholder={'e.g. "Make the skeptic sound like a tired husband who secretly wants one" or "Focus on the air-pulse feature, reference blooming flowers"'}
              rows={3}
              disabled={generating || !liveDeal}
              className="w-full border border-brand-mist rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-purple/30 placeholder:text-brand-charcoal/30 disabled:opacity-50 disabled:cursor-not-allowed transition-shadow"
            />
          </div>

          {/* Duration, Format + Voice selectors */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="video-duration" className="block text-xs font-semibold text-brand-charcoal/60 mb-1 uppercase tracking-wider">
                Duration
              </label>
              <div className="relative">
                <input
                  id="video-duration"
                  type="number"
                  value={durationSeconds}
                  onChange={e => setDurationSeconds(Math.max(8, Math.min(60, Number(e.target.value))))}
                  min={8}
                  max={60}
                  step={1}
                  disabled={generating || !liveDeal}
                  className="w-full border border-brand-mist rounded-xl px-3 py-2.5 pr-10 text-sm bg-white text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-brand-purple/30 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-brand-charcoal/40 pointer-events-none">
                  sec
                </span>
              </div>
            </div>
            <div>
              <label htmlFor="video-format" className="block text-xs font-semibold text-brand-charcoal/60 mb-1 uppercase tracking-wider">
                Format
              </label>
              <select
                id="video-format"
                value={selectedFormat}
                onChange={e => setSelectedFormat(e.target.value)}
                disabled={generating || !liveDeal}
                className="w-full border border-brand-mist rounded-xl px-3 py-2.5 text-sm bg-white text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-brand-purple/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="auto">Auto (category-based)</option>
                <option value="sitcom_sketch">Sitcom Sketch</option>
                <option value="fake_testimonial">Fake Testimonial</option>
                <option value="educational">Educational (bad expert)</option>
                <option value="breaking_news">Breaking News</option>
                <option value="absurdist_narrator">Absurdist Narrator</option>
              </select>
            </div>
            <div>
              <label htmlFor="video-voice" className="block text-xs font-semibold text-brand-charcoal/60 mb-1 uppercase tracking-wider">
                Voice
              </label>
              <select
                id="video-voice"
                value={selectedVoice}
                onChange={e => setSelectedVoice(e.target.value)}
                disabled={generating || !liveDeal}
                className="w-full border border-brand-mist rounded-xl px-3 py-2.5 text-sm bg-white text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-brand-purple/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="Rachel">Rachel</option>
                <option value="Bella">Bella</option>
                <option value="Erin">Erin</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={generating || !liveDeal}
            className="relative flex items-center gap-2.5 px-6 py-2.5 rounded-full text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-brand-coral/40 focus:ring-offset-2"
            style={{ background: 'linear-gradient(to right, #F04E37, #FF8C38)' }}
          >
            {generating ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Generating… (~45s)
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Generate Video
              </>
            )}
          </button>
        </form>

        {/* Generation error */}
        {genError && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{genError}</span>
          </div>
        )}

        {/* Preview + dialogue */}
        {result?.ok && result.previewUrl && (
          <div className="space-y-5 pt-2">
            {/* Divider */}
            <div className="border-t border-brand-mist" />

            {/* Script metadata */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-brand-mist/60 px-3 py-2">
                <span className="font-semibold text-brand-charcoal/50 uppercase tracking-wider">Format</span>
                <p className="text-brand-charcoal font-medium mt-0.5 capitalize">{result.format?.replace(/_/g, ' ')}</p>
              </div>
              <div className="rounded-lg bg-brand-mist/60 px-3 py-2">
                <span className="font-semibold text-brand-charcoal/50 uppercase tracking-wider">Voice</span>
                <p className="text-brand-charcoal font-medium mt-0.5">{result.voiceName ?? 'Bella'}</p>
              </div>
              <div className="rounded-lg bg-brand-mist/60 px-3 py-2 col-span-2">
                <span className="font-semibold text-brand-charcoal/50 uppercase tracking-wider">Why this format</span>
                <p className="text-brand-charcoal mt-0.5 leading-relaxed">{result.formatRationale}</p>
              </div>
            </div>

            {/* Narrator script + reactions */}
            {result.narratorScript && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider">Narrator script</p>
                <div className="rounded-xl bg-brand-charcoal/5 border border-brand-mist px-4 py-3">
                  <p className="text-sm text-brand-charcoal leading-relaxed italic">
                    &ldquo;{result.narratorScript}&rdquo;
                  </p>
                </div>

                {result.reactionText && result.reactionText.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider pt-1">Reactions</p>
                    <div className="flex flex-col gap-2">
                      {result.reactionText.map((r, i) => (
                        <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                          <span className="text-xs bg-brand-cream border border-brand-mist rounded-full px-3 py-1.5 text-brand-charcoal/70">
                            {r}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {result.endTagline && (
                  <p className="text-xs text-brand-charcoal/40 text-center pt-1 italic">
                    End card: &ldquo;{result.endTagline}&rdquo;
                  </p>
                )}
              </div>
            )}

            {/* Video player */}
            <div className="rounded-2xl overflow-hidden bg-brand-charcoal aspect-square relative">
              <video
                ref={videoRef}
                src={result.previewUrl}
                controls
                playsInline
                preload="metadata"
                className="w-full h-full object-contain"
              />
            </div>

            {/* Publish controls */}
            {!published ? (
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handlePublish}
                  disabled={publishing}
                  className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-purple/40 focus:ring-offset-2"
                  style={{ background: '#7B2FBE' }}
                >
                  {publishing ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Uploading to Shopify…
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      Upload to Shopify
                    </>
                  )}
                </button>

                <button
                  onClick={handleGenerate}
                  disabled={generating || !liveDeal}
                  className="px-5 py-2.5 rounded-full text-sm font-semibold text-brand-charcoal bg-brand-mist hover:bg-brand-mist/70 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-charcoal/20 focus:ring-offset-2"
                >
                  Regenerate
                </button>
              </div>
            ) : (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 space-y-1">
                <p className="text-sm font-semibold text-green-700 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Video uploaded to Shopify
                </p>
                <p className="text-xs text-green-600">
                  Media ID: <span className="font-mono">{publishResult?.mediaId}</span>
                  {publishResult?.ready && ' · Status: Ready'}
                </p>
                {publishResult?.thumbnailSet?.home_page && (
                  <p className="text-xs text-green-600">Set as primary thumbnail on PDP and home hero.</p>
                )}
                <button
                  onClick={() => { setResult(null); setPublishResult(null) }}
                  className="mt-2 text-xs font-semibold text-green-700 underline underline-offset-2"
                >
                  Generate another video
                </button>
              </div>
            )}

            {/* Publish error */}
            {pubError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {pubError}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AdminSettingsPage() {
  const { settings, feedTimestamp, candidateCount, liveDeal } = useLoaderData<typeof loader>()
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

      {/* ── Video Generator ──────────────────────────────────────────────────── */}
      <VideoGeneratorSection liveDeal={liveDeal} />
    </div>
  )
}
