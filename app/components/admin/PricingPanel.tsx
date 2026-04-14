import { useEffect, useMemo, useRef, useState } from 'react'
import { useFetcher } from 'react-router'

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
}

const AUTO_SAVE_MS = 10_000

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

export function PricingPanel({ productId, config, shopifyCost }: Props) {
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

  // Debounced auto-save
  useEffect(() => {
    if (!isDirty) return
    const t = setTimeout(() => {
      fetcher.submit(buildFormData(), { method: 'post' })
    }, AUTO_SAVE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, isDirty])

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
