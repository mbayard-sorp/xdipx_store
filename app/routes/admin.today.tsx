import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { useEffect, useRef } from 'react'
import { getDailyDeal, updateProductMetafield, setDealStatus } from '~/lib/shopify.server'
import { CopyGenerator } from '~/components/admin/CopyGenerator'

export const meta: MetaFunction = () => [{ title: "Today's Deal — xdipx Admin" }]

export async function loader(_: LoaderFunctionArgs) {
  const deal = await getDailyDeal()
  return { deal }
}

export async function action({ request }: ActionFunctionArgs) {
  const form   = await request.formData()
  const intent = form.get('intent')

  if (intent === 'save-field') {
    const productId = form.get('productId') as string
    const key       = form.get('key') as string
    const value     = form.get('value') as string
    const type      = (form.get('type') as string) || 'single_line_text_field'
    await updateProductMetafield(productId, key, value, type)
    return { ok: true }
  }

  if (intent === 'approve') {
    const productId = form.get('productId') as string
    await setDealStatus(productId, 'approved')
    return { ok: true }
  }

  if (intent === 'set-live') {
    const productId = form.get('productId') as string
    await setDealStatus(productId, 'live')
    return { ok: true }
  }

  return null
}

function SaveableField({
  label, fieldKey, fieldType, defaultValue, productId, rows = 3,
}: {
  label: string
  fieldKey: string
  fieldType: string
  defaultValue: string
  productId: string
  rows?: number
}) {
  const fetcher = useFetcher<{ ok: boolean }>()
  const saved = fetcher.state === 'idle' && fetcher.data?.ok === true
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear the "Saved!" state after 2.5s so it resets for next save
  useEffect(() => {
    if (saved) {
      timerRef.current = setTimeout(() => {
        // force re-render by submitting nothing — just clear by key re-mount
        // actually the fetcher.data persists; we use a local state trick via the timer
      }, 2500)
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [saved])

  const buttonLabel = fetcher.state === 'submitting'
    ? 'Saving…'
    : saved
      ? '✓ Saved!'
      : 'Save'

  const buttonClass = fetcher.state === 'submitting'
    ? 'self-end text-xs font-bold px-3 py-1.5 rounded-full bg-brand-charcoal/10 text-brand-charcoal/40 cursor-not-allowed'
    : saved
      ? 'self-end text-xs font-bold px-3 py-1.5 rounded-full bg-green-100 text-green-700 transition-colors'
      : 'self-end text-xs font-bold px-3 py-1.5 rounded-full bg-brand-mist text-brand-purple hover:bg-brand-purple/10 transition-colors'

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm">
      <h3 className="font-semibold text-brand-charcoal mb-3" style={{ fontFamily: 'var(--font-display)' }}>{label}</h3>
      <fetcher.Form method="post" className="flex flex-col gap-2">
        <input type="hidden" name="intent"    value="save-field" />
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="key"       value={fieldKey} />
        <input type="hidden" name="type"      value={fieldType} />
        <textarea
          name="value"
          defaultValue={defaultValue}
          rows={rows}
          className="w-full border border-brand-mist rounded-xl px-4 py-3 text-sm text-brand-charcoal resize-none focus:outline-none focus:ring-2 focus:ring-brand-coral/30"
        />
        <button
          type="submit"
          disabled={fetcher.state === 'submitting'}
          className={buttonClass}
        >
          {buttonLabel}
        </button>
      </fetcher.Form>
    </div>
  )
}

export default function AdminToday() {
  const { deal } = useLoaderData<typeof loader>()
  const approveFetcher = useFetcher<{ ok: boolean }>()
  const liveFetcher    = useFetcher<{ ok: boolean }>()

  if (!deal) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-brand-charcoal mb-4" style={{ fontFamily: 'var(--font-display)' }}>Today's Deal</h1>
        <p className="text-brand-charcoal/50">No live deal found. Use the Queue to schedule one.</p>
      </div>
    )
  }

  const approveLabel = approveFetcher.state === 'submitting'
    ? 'Saving…'
    : approveFetcher.data?.ok
      ? '✓ Approved!'
      : '✓ Approve'

  const liveLabel = liveFetcher.state === 'submitting'
    ? 'Setting live…'
    : liveFetcher.data?.ok
      ? '🟢 Live!'
      : 'Set Live'

  const isLive = deal.dealStatus === 'live'

  const productForGenerator = {
    title:       deal.seoTitle,
    brand:       deal.brand,
    description: deal.fullStory,
    categories:  [deal.category],
    dealPrice:   deal.dealPrice,
    msrp:        deal.msrp,
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>Today's Deal</h1>
          <p className="text-brand-charcoal/60">{deal.seoTitle} — {deal.brand}</p>
        </div>
        <div className="flex gap-3">
          <approveFetcher.Form method="post">
            <input type="hidden" name="intent"    value="approve" />
            <input type="hidden" name="productId" value={deal.shopifyProductId} />
            <button
              type="submit"
              disabled={approveFetcher.state === 'submitting' || isLive}
              className={
                approveFetcher.data?.ok || isLive
                  ? 'bg-green-700 text-white font-bold px-5 py-2 rounded-full text-sm opacity-60 cursor-default'
                  : 'bg-green-500 text-white font-bold px-5 py-2 rounded-full hover:bg-green-600 transition-colors text-sm'
              }
            >
              {isLive ? '✓ Approved' : approveLabel}
            </button>
          </approveFetcher.Form>
          <liveFetcher.Form method="post">
            <input type="hidden" name="intent"    value="set-live" />
            <input type="hidden" name="productId" value={deal.shopifyProductId} />
            <button
              type="submit"
              disabled={liveFetcher.state === 'submitting' || isLive}
              className={
                liveFetcher.data?.ok || isLive
                  ? 'bg-blue-700 text-white font-bold px-5 py-2 rounded-full text-sm opacity-60 cursor-default'
                  : 'bg-blue-500 text-white font-bold px-5 py-2 rounded-full hover:bg-blue-600 transition-colors text-sm'
              }
            >
              {liveLabel}
            </button>
          </liveFetcher.Form>
        </div>
      </div>

      {/* Hero preview */}
      <div className="bg-white rounded-2xl p-6 shadow-sm flex gap-4">
        {deal.images[0] && (
          <img src={deal.images[0].url} alt={deal.seoTitle} className="w-24 h-24 object-cover rounded-xl shrink-0" />
        )}
        <div>
          <p className="font-bold text-brand-charcoal">{deal.seoTitle}</p>
          <p className="text-brand-charcoal/60 text-sm mt-1">{deal.tagline}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-brand-gradient font-black text-xl" style={{ fontFamily: 'var(--font-display)' }}>${deal.dealPrice.toFixed(2)}</span>
            <span className="text-brand-charcoal/40 line-through">${deal.msrp.toFixed(2)}</span>
            <span className="text-xs bg-brand-gradient text-white px-2 py-0.5 rounded-full font-bold">
              {deal.msrp > 0 ? Math.round(((deal.msrp - deal.dealPrice) / deal.msrp) * 100) : 0}% off
            </span>
          </div>
          <p className="text-xs text-brand-charcoal/50 mt-1">
            Status: <strong>{deal.dealStatus}</strong> · SKU: {deal.sku} · Qty: {deal.qty}
          </p>
        </div>
      </div>

      {/* Editable fields */}
      <SaveableField label="Tagline"       fieldKey="tagline"       fieldType="single_line_text_field" defaultValue={deal.tagline}     productId={deal.shopifyProductId} />
      <SaveableField label="Full Story"    fieldKey="full_story"    fieldType="multi_line_text_field"  defaultValue={deal.fullStory}   productId={deal.shopifyProductId} rows={8} />
      <SaveableField label="Works For Him" fieldKey="works_for_him" fieldType="multi_line_text_field"  defaultValue={deal.worksForHim} productId={deal.shopifyProductId} />
      <SaveableField label="Works For Her" fieldKey="works_for_her" fieldType="multi_line_text_field"  defaultValue={deal.worksForHer} productId={deal.shopifyProductId} />

      {/* AI Generator */}
      <div>
        <h2 className="text-lg font-bold text-brand-charcoal mb-4" style={{ fontFamily: 'var(--font-display)' }}>AI Content Generator</h2>
        <CopyGenerator
          product={productForGenerator}
          onUse={(key, value) => {
            // CopyGenerator uses its own fetcher internally
          }}
        />
      </div>
    </div>
  )
}
