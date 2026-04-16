import { useEffect, useMemo, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import type { ProductVariant } from '~/types'

type PricingConfig = {
  dealPrice: number
  msrp: number
  wholesaleCost: number
  mapPrice: number
  pctOffMsrp: number
  vaultPriceOverride: number | null
}

type Props = {
  productId: string
  config: PricingConfig
  shopifyCost: number | null
  variants?: ProductVariant[] | undefined
}

function fmtMoney(n: number): string {
  if (!isFinite(n)) return '—'
  return `$${n.toFixed(2)}`
}

function fmtPct(n: number): string {
  if (!isFinite(n)) return '—'
  return `${n.toFixed(1)}%`
}

function profitClass(n: number): string {
  return n > 0 ? 'text-green-600' : 'text-red-600'
}

export function PricingPanel({ productId, config, shopifyCost, variants }: Props) {
  const fetcher = useFetcher<{ ok: boolean }>()

  const [dealPrice, setDealPrice]                 = useState(config.dealPrice.toFixed(2))
  const [msrp, setMsrp]                           = useState(config.msrp.toFixed(2))
  const [wholesaleCost, setWholesaleCost]         = useState(config.wholesaleCost.toFixed(2))
  const [mapPrice, setMapPrice]                   = useState(config.mapPrice.toFixed(2))
  const [pctOffMsrp, setPctOffMsrp]               = useState(config.pctOffMsrp.toFixed(2))
  const [vaultOverride, setVaultOverride]         = useState(
    config.vaultPriceOverride != null ? config.vaultPriceOverride.toFixed(2) : '',
  )

  const num = (s: string) => {
    const n = parseFloat(s)
    return isNaN(n) ? 0 : n
  }
  const dealPriceN     = num(dealPrice)
  const msrpN          = num(msrp)
  const wholesaleN     = num(wholesaleCost)
  const pctN           = Math.max(0, Math.min(100, num(pctOffMsrp)))

  // Section 1: Deal
  const dealProfit      = dealPriceN - wholesaleN
  const dealMarginPct   = dealPriceN > 0 ? (1 - wholesaleN / dealPriceN) * 100 : NaN

  // Section 2: Everyday
  const everydayPrice   = msrpN - msrpN * (pctN / 100)

  // Section 3: Cost & Margins (based on Everyday Price)
  const unitProfit      = everydayPrice - wholesaleN
  const unitMarginPct   = everydayPrice > 0 ? (unitProfit / everydayPrice) * 100 : NaN

  const buildFormData = () => {
    const fd = new FormData()
    fd.set('intent', 'save-pricing')
    fd.set('productId', productId)
    fd.set('dealPrice', dealPriceN.toString())
    fd.set('msrp', msrpN.toString())
    fd.set('wholesaleCost', wholesaleN.toString())
    fd.set('mapPrice', num(mapPrice).toString())
    fd.set('pctOffMsrp', pctN.toString())
    fd.set('vaultPriceOverride', vaultOverride.trim())
    return fd
  }

  // Track whether local state has diverged from last saved snapshot
  const snapshot = useMemo(
    () => JSON.stringify({ dealPrice, msrp, wholesaleCost, mapPrice, pctOffMsrp, vaultOverride }),
    [dealPrice, msrp, wholesaleCost, mapPrice, pctOffMsrp, vaultOverride],
  )
  const savedSnapshotRef = useRef<string>(snapshot)
  const isDirty = snapshot !== savedSnapshotRef.current

  // When save succeeds, update snapshot
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.ok === true) {
      savedSnapshotRef.current = snapshot
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data])

  const saving = fetcher.state !== 'idle'
  const saved  = !saving && fetcher.data?.ok === true && !isDirty

  const statusText =
    saving ? 'Saving…' :
    isDirty ? 'Unsaved changes' :
    saved   ? '✓ Saved'        :
              ''

  const onSaveNow = () => {
    fetcher.submit(buildFormData(), { method: 'post' })
  }

  const moneyInput = (name: string, value: string, onChange: (v: string) => void) => (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-brand-charcoal/40">$</span>
      <input
        type="number"
        name={name}
        value={value}
        onChange={e => onChange(e.target.value)}
        step="0.01"
        min="0"
        className="w-full border border-brand-mist rounded-xl pl-6 pr-3 py-2 text-sm text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-brand-coral/30"
      />
    </div>
  )

  const pctInput = (name: string, value: string, onChange: (v: string) => void) => (
    <div className="relative">
      <input
        type="number"
        name={name}
        value={value}
        onChange={e => onChange(e.target.value)}
        step="0.1"
        min="0"
        max="100"
        className="w-full border border-brand-mist rounded-xl pl-3 pr-7 py-2 text-sm text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-brand-coral/30"
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-brand-charcoal/40">%</span>
    </div>
  )

  return (
    <div className="border-t border-brand-mist mt-3 pt-3 space-y-4">
      {variants && variants.length > 1 && (
        <VariantPricingSection variants={variants} />
      )}

      {/* Section 1: Deal Pricing */}
      <section>
        <h4 className="text-xs font-bold uppercase tracking-wide text-brand-charcoal/70 mb-2"
            style={{ fontFamily: 'var(--font-display)' }}>
          Deal Pricing
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-brand-charcoal/50 block mb-1">Deal Price</label>
            {moneyInput('dealPrice', dealPrice, setDealPrice)}
          </div>
          <div>
            <label className="text-xs font-medium text-brand-charcoal/50 block mb-1">Profit Margin</label>
            <div className="px-3 py-2 text-sm text-brand-charcoal/70 border border-dashed border-brand-mist rounded-xl bg-brand-mist/30">
              {fmtPct(dealMarginPct)} <span className="text-brand-charcoal/40">(calculated)</span>
            </div>
          </div>
        </div>
        <div className="mt-3">
          <label className="text-xs font-medium text-brand-charcoal/50 block mb-1">
            Vault Price Override <span className="text-brand-charcoal/40">(leave empty for auto-calc)</span>
          </label>
          {moneyInput('vaultPriceOverride', vaultOverride, setVaultOverride)}
        </div>
        <p className="text-xs text-brand-charcoal/60 mt-2">
          Profit/Per: <strong className={profitClass(dealProfit)}>{fmtMoney(dealProfit)}</strong>
          &nbsp;·&nbsp;Margin: <strong className={profitClass(dealMarginPct)}>{fmtPct(dealMarginPct)}</strong>
        </p>
      </section>

      {/* Section 2: Everyday Pricing */}
      <section className="border-t border-brand-mist pt-4">
        <h4 className="text-xs font-bold uppercase tracking-wide text-brand-charcoal/70 mb-2"
            style={{ fontFamily: 'var(--font-display)' }}>
          Everyday Pricing
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-brand-charcoal/50 block mb-1">MSRP</label>
            {moneyInput('msrp', msrp, setMsrp)}
          </div>
          <div>
            <label className="text-xs font-medium text-brand-charcoal/50 block mb-1">% off MSRP</label>
            {pctInput('pctOffMsrp', pctOffMsrp, setPctOffMsrp)}
          </div>
        </div>
        <p className="text-xs text-brand-charcoal/60 mt-2">
          Everyday Price: <strong className="text-brand-charcoal">{fmtMoney(everydayPrice)}</strong>
        </p>
      </section>

      {/* Section 3: Cost & Margins */}
      <section className="border-t border-brand-mist pt-4">
        <h4 className="text-xs font-bold uppercase tracking-wide text-brand-charcoal/70 mb-2"
            style={{ fontFamily: 'var(--font-display)' }}>
          Cost &amp; Margins
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-brand-charcoal/50 block mb-1">Wholesale Cost</label>
            {moneyInput('wholesaleCost', wholesaleCost, setWholesaleCost)}
          </div>
          <div>
            <label className="text-xs font-medium text-brand-charcoal/50 block mb-1">MAP</label>
            {moneyInput('mapPrice', mapPrice, setMapPrice)}
          </div>
        </div>
        {shopifyCost !== null && (
          <div className="flex items-center gap-2 text-xs text-brand-charcoal/50 mt-2">
            <span>Shopify cost on file:</span>
            <span className="font-semibold text-brand-charcoal">${shopifyCost.toFixed(2)}</span>
            {shopifyCost !== wholesaleN && (
              <span className="text-amber-600 font-medium">⚠ differs from wholesale cost above</span>
            )}
          </div>
        )}
        <p className="text-xs text-brand-charcoal/60 mt-2">
          Profit/Unit: <strong className={profitClass(unitProfit)}>{fmtMoney(unitProfit)}</strong>
          &nbsp;·&nbsp;Margin: <strong className={profitClass(unitMarginPct)}>{fmtPct(unitMarginPct)}</strong>
          &nbsp;·&nbsp;Cost: <strong className="text-brand-charcoal">{fmtMoney(wholesaleN)}</strong>
        </p>
      </section>

      <div className="flex items-center justify-between border-t border-brand-mist pt-3">
        <span className={
          saving ? 'text-xs text-brand-charcoal/50' :
          isDirty ? 'text-xs text-amber-600 font-medium' :
          saved ? 'text-xs text-green-600 font-medium' :
          'text-xs text-brand-charcoal/40'
        }>
          {statusText}
        </span>
        <button
          type="button"
          onClick={onSaveNow}
          disabled={saving}
          className={
            saving
              ? 'text-xs font-bold px-3 py-1.5 rounded-full bg-brand-charcoal/10 text-brand-charcoal/40 cursor-not-allowed'
              : 'text-xs font-bold px-3 py-1.5 rounded-full bg-brand-mist text-brand-purple hover:bg-brand-purple/10 transition-colors'
          }
        >
          Save Pricing
        </button>
      </div>
    </div>
  )
}

function variantLabel(v: ProductVariant): string {
  if (v.selectedOptions?.length) {
    return v.selectedOptions.map(o => o.value).join(' / ')
  }
  return v.title || 'Variant'
}

type VariantEdits = Record<string, { price: string; compareAtPrice: string }>

function VariantPricingSection({ variants }: { variants: ProductVariant[] }) {
  const saveFetcher = useFetcher<{ ok: boolean }>()
  const syncFetcher = useFetcher<{ ok: boolean }>()

  const initial = useMemo<VariantEdits>(() => {
    const acc: VariantEdits = {}
    for (const v of variants) {
      acc[v.id] = {
        price: parseFloat(v.price || '0').toFixed(2),
        compareAtPrice: v.compareAtPrice ? parseFloat(v.compareAtPrice).toFixed(2) : '',
      }
    }
    return acc
  }, [variants])

  const [edits, setEdits] = useState<VariantEdits>(initial)
  const savedRef = useRef<VariantEdits>(initial)
  const [selectedId, setSelectedId] = useState<string>(variants[0]?.id ?? '')

  useEffect(() => {
    if (saveFetcher.state === 'idle' && saveFetcher.data?.ok === true) {
      savedRef.current = { ...savedRef.current, ...edits }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFetcher.state, saveFetcher.data])

  useEffect(() => {
    if (syncFetcher.state === 'idle' && syncFetcher.data?.ok === true) {
      const selected = edits[selectedId]
      if (!selected) return
      const applied: VariantEdits = {}
      for (const v of variants) applied[v.id] = { ...selected }
      setEdits(applied)
      savedRef.current = applied
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncFetcher.state, syncFetcher.data])

  const selected = edits[selectedId]
  const selectedSaved = savedRef.current[selectedId]
  const isSelectedDirty =
    !!selected && !!selectedSaved &&
    (selected.price !== selectedSaved.price || selected.compareAtPrice !== selectedSaved.compareAtPrice)

  const savedPrices = variants.map(v => savedRef.current[v.id]?.price ?? '')
  const hasMismatch = new Set(savedPrices).size > 1

  const saving = saveFetcher.state !== 'idle'
  const syncing = syncFetcher.state !== 'idle'

  const updateField = (field: 'price' | 'compareAtPrice', value: string) => {
    setEdits(e => {
      const current = e[selectedId] ?? { price: '', compareAtPrice: '' }
      return { ...e, [selectedId]: { ...current, [field]: value } }
    })
  }

  const saveSelected = () => {
    if (!selected) return
    const priceN = parseFloat(selected.price)
    if (!isFinite(priceN) || priceN < 0) return
    const fd = new FormData()
    fd.set('intent', 'save-variant-pricing')
    fd.set('variantGid', selectedId)
    fd.set('price', priceN.toFixed(2))
    fd.set('compareAtPrice', selected.compareAtPrice.trim())
    saveFetcher.submit(fd, { method: 'post' })
  }

  const syncAll = () => {
    if (!selected) return
    const ok = window.confirm(
      `Apply ${selected.price ? '$' + selected.price : '(empty)'} to all ${variants.length} variants? This overwrites every variant's price in Shopify.`,
    )
    if (!ok) return
    const priceN = parseFloat(selected.price)
    if (!isFinite(priceN) || priceN < 0) return
    const fd = new FormData()
    fd.set('intent', 'sync-all-variants-pricing')
    fd.set('variantGids', JSON.stringify(variants.map(v => v.id)))
    fd.set('price', priceN.toFixed(2))
    fd.set('compareAtPrice', selected.compareAtPrice.trim())
    syncFetcher.submit(fd, { method: 'post' })
  }

  const moneyInput = (name: string, value: string, onChange: (v: string) => void) => (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-brand-charcoal/40">$</span>
      <input
        type="number"
        name={name}
        value={value}
        onChange={e => onChange(e.target.value)}
        step="0.01"
        min="0"
        className="w-full border border-brand-mist rounded-xl pl-6 pr-3 py-2 text-sm text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-brand-coral/30"
      />
    </div>
  )

  const saveStatus =
    saving  ? 'Saving…' :
    syncing ? 'Applying to all…' :
    isSelectedDirty ? 'Unsaved changes' :
    saveFetcher.data?.ok ? '✓ Saved' :
    syncFetcher.data?.ok ? '✓ Applied to all' :
    ''

  return (
    <section className="rounded-xl border border-brand-mist bg-brand-mist/30 p-4">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-xs font-bold uppercase tracking-wide text-brand-charcoal/70"
            style={{ fontFamily: 'var(--font-display)' }}>
          Variant Pricing
        </h4>
        <span className="text-[10px] uppercase tracking-wide text-brand-charcoal/40">
          Pushes to Shopify
        </span>
      </div>
      <p className="text-xs text-brand-charcoal/60 mb-3">
        Edit each variant's price and compare-at price. Saves push directly to Shopify.
      </p>

      {hasMismatch && (
        <div className="mb-3 text-xs px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
          ⚠ Prices differ across variants. Use "Apply to all" to normalize.
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mb-3">
        {variants.map(v => {
          const isSel = v.id === selectedId
          const priceNow = edits[v.id]?.price ?? ''
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setSelectedId(v.id)}
              className={
                isSel
                  ? 'text-xs font-semibold px-3 py-1.5 rounded-full bg-brand-purple text-white'
                  : 'text-xs font-medium px-3 py-1.5 rounded-full bg-white text-brand-charcoal/70 border border-brand-mist hover:bg-brand-mist/60 transition-colors'
              }
            >
              {variantLabel(v)}
              <span className={isSel ? 'ml-1.5 text-white/70' : 'ml-1.5 text-brand-charcoal/40'}>
                ${priceNow}
              </span>
            </button>
          )
        })}
      </div>

      {selected && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-brand-charcoal/50 block mb-1">Price</label>
              {moneyInput('variantPrice', selected.price, v => updateField('price', v))}
            </div>
            <div>
              <label className="text-xs font-medium text-brand-charcoal/50 block mb-1">
                Compare At <span className="text-brand-charcoal/40">(optional)</span>
              </label>
              {moneyInput('variantCompareAtPrice', selected.compareAtPrice, v => updateField('compareAtPrice', v))}
            </div>
          </div>

          <div className="flex items-center justify-between mt-3">
            <span className={
              saving || syncing ? 'text-xs text-brand-charcoal/50' :
              isSelectedDirty ? 'text-xs text-amber-600 font-medium' :
              (saveFetcher.data?.ok || syncFetcher.data?.ok) ? 'text-xs text-green-600 font-medium' :
              'text-xs text-brand-charcoal/40'
            }>
              {saveStatus}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={syncAll}
                disabled={saving || syncing}
                className={
                  saving || syncing
                    ? 'text-xs font-bold px-3 py-1.5 rounded-full bg-brand-charcoal/10 text-brand-charcoal/40 cursor-not-allowed'
                    : 'text-xs font-bold px-3 py-1.5 rounded-full bg-white text-brand-charcoal border border-brand-mist hover:bg-brand-mist/60 transition-colors'
                }
              >
                Apply to all {variants.length} variants
              </button>
              <button
                type="button"
                onClick={saveSelected}
                disabled={saving || syncing}
                className={
                  saving || syncing
                    ? 'text-xs font-bold px-3 py-1.5 rounded-full bg-brand-charcoal/10 text-brand-charcoal/40 cursor-not-allowed'
                    : 'text-xs font-bold px-3 py-1.5 rounded-full bg-brand-purple text-white hover:bg-brand-purple/90 transition-colors'
                }
              >
                Save Variant
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
