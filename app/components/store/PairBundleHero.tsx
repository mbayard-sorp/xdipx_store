import { useMemo, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { shopifyImageUrl } from '~/lib/shopify-image'
import type { Deal, PairBundleCopy, ProductVariant } from '~/types'
import { PairBundleHeroCarousel } from './PairBundleHeroCarousel'
import { splitUnderscores, renderWithHighlight } from './pairBundleText'
import { Reveal } from '~/components/motion/Reveal'

interface PairBundleHeroProps {
  primary:     Deal
  partner:     Deal
  copy:        PairBundleCopy
  discountPct: number
}

const fmtPrice = (n: number) =>
  `$${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2)}`

function renderDekWithPill(body: string) {
  return splitUnderscores(body).map((p, i) => {
    if (!p.emph) return <span key={i}>{p.text}</span>
    return (
      <span
        key={i}
        style={{
          background:   'linear-gradient(180deg, transparent 60%, var(--color-coral-soft) 60%)',
          color:        'var(--color-coral-deep)',
          fontWeight:   700,
          padding:      '0 2px',
        }}
      >
        {p.text}
      </span>
    )
  })
}

function renderHeadlineItalic(headline: string) {
  const parts = splitUnderscores(headline)
  const hasEm = parts.some(p => p.emph)
  if (hasEm) {
    return parts.map((p, i) =>
      p.emph
        ? (
          <em
            key={i}
            className="relative"
            style={{
              fontFamily: 'var(--font-display)',
              fontStyle:  'italic',
              fontWeight: 700,
              color:      'var(--color-coral)',
            }}
          >
            {p.text}
            <span
              aria-hidden="true"
              className="absolute left-[-2px] right-[-2px] bottom-[-3px] h-2 -z-10"
              style={{
                background: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 220 8' preserveAspectRatio='none'><path d='M2,5 Q 55,1 110,4 T 218,5' stroke='%23FFE28C' stroke-width='6' fill='none' stroke-linecap='round'/></svg>") no-repeat center / 100% 100%`,
              }}
            />
          </em>
        )
        : <span key={i}>{p.text}</span>,
    )
  }
  return <>{headline}</>
}

const truncateWords = (s: string | undefined, n: number) => {
  if (!s) return ''
  const words = s.trim().split(/\s+/)
  return words.length <= n ? s.trim() : `${words.slice(0, n).join(' ')}…`
}

const categoryLabel = (c: Deal['category']) => {
  if (!c || c.length === 0) return ''
  if (c.includes('couples')) return 'Couples'
  if (c.length >= 2 && c.includes('for-him') && c.includes('for-her')) return 'Both'
  if (c.includes('for-him')) return 'For him'
  if (c.includes('for-her')) return 'For her'
  return ''
}

function useVariantPicker(deal: Deal) {
  const optionGroups = useMemo(() => {
    const groups: Record<string, string[]> = {}
    for (const v of deal.variants ?? []) {
      for (const o of v.selectedOptions ?? []) {
        if (!groups[o.name]) groups[o.name] = []
        if (!groups[o.name]!.includes(o.value)) groups[o.name]!.push(o.value)
      }
    }
    const entries = Object.entries(groups).filter(([_, vals]) => vals.length > 1)
    return entries
  }, [deal.variants])

  const firstVariant = deal.variants?.[0]
  const initial = useMemo<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    for (const [name, vals] of optionGroups) {
      const preferred = firstVariant?.selectedOptions.find(o => o.name === name)?.value
      seed[name] = preferred ?? vals[0]!
    }
    return seed
  }, [optionGroups, firstVariant])

  const [selected, setSelected] = useState<Record<string, string>>(initial)

  const selectedVariant: ProductVariant | undefined = useMemo(() => {
    if (!deal.variants?.length) return undefined
    return deal.variants.find(v =>
      v.selectedOptions.every(o => selected[o.name] === o.value),
    )
  }, [deal.variants, selected])

  const variantId = selectedVariant?.id || deal.variantId

  return { optionGroups, selected, setSelected, variantId }
}

/* =============================================================
   Variant + qty disclosure row (shared by mobile + desktop tiles)
   ============================================================= */
function Disclosure({
  open,
  optionGroups,
  selected,
  setSelected,
  qty,
  setQty,
}: {
  open:         boolean
  optionGroups: [string, string[]][]
  selected:     Record<string, string>
  setSelected:  (next: Record<string, string>) => void
  qty:          number
  setQty:       (n: number) => void
}) {
  return (
    <div
      className="overflow-hidden transition-[max-height,margin-top] duration-300 ease-out"
      style={{ maxHeight: open ? '320px' : '0px', marginTop: open ? '12px' : '0px' }}
    >
      {optionGroups.map(([name, values]) => {
        const isColor = /colou?r/i.test(name)
        return (
          <div
            key={name}
            className="flex items-center gap-2.5 flex-wrap p-3 bg-cream-2 border border-dashed border-line-2 rounded-[10px] mb-2"
          >
            <span className="text-[10.5px] tracking-[0.1em] uppercase font-bold text-muted mr-0.5" style={{ fontFamily: 'var(--font-body)' }}>
              {name}
            </span>
            {values.map(val => {
              const active = selected[name] === val
              if (isColor) {
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setSelected({ ...selected, [name]: val })}
                    className="w-[22px] h-[22px] rounded-full border-[1.2px] border-ink"
                    style={{
                      background: val,
                      outline: active ? '2px solid var(--color-ink)' : 'none',
                      outlineOffset: active ? '2px' : '0',
                    }}
                    aria-label={val}
                    title={val}
                  />
                )
              }
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => setSelected({ ...selected, [name]: val })}
                  className={`px-[11px] py-[5px] rounded-full border-[1.2px] border-ink text-[12px] font-semibold ${active ? 'bg-ink text-cream' : 'bg-paper text-ink'}`}
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  {val}
                </button>
              )
            })}
          </div>
        )
      })}

      <div className="flex items-center gap-2.5 flex-wrap p-3 bg-cream-2 border border-dashed border-line-2 rounded-[10px]">
        <span className="text-[10.5px] tracking-[0.1em] uppercase font-bold text-muted mr-0.5" style={{ fontFamily: 'var(--font-body)' }}>
          Qty
        </span>
        <div className="inline-flex items-center border-[1.2px] border-ink rounded-full overflow-hidden">
          <button
            type="button"
            onClick={() => setQty(Math.max(1, qty - 1))}
            className="px-2.5 py-1 text-[14px] font-bold bg-paper hover:bg-cream-2 disabled:opacity-40"
            disabled={qty <= 1}
            aria-label="Decrease quantity"
          >−</button>
          <span className="px-2.5 py-1 text-[14px] font-bold" style={{ fontFamily: 'var(--font-display)' }}>{qty}</span>
          <button
            type="button"
            onClick={() => setQty(Math.min(9, qty + 1))}
            className="px-2.5 py-1 text-[14px] font-bold bg-paper hover:bg-cream-2 disabled:opacity-40"
            disabled={qty >= 9}
            aria-label="Increase quantity"
          >+</button>
        </div>
      </div>
    </div>
  )
}

/* =============================================================
   Mobile pair tile (bordered cream card, centered image)
   ============================================================= */
function MobilePairItem({
  deal, tag, tagSide, qty, setQty, optionGroups, selected, setSelected, open, onToggle,
}: {
  deal:         Deal
  tag:          string
  tagSide:      'left' | 'right'
  qty:          number
  setQty:       (n: number) => void
  optionGroups: [string, string[]][]
  selected:     Record<string, string>
  setSelected:  (next: Record<string, string>) => void
  open:         boolean
  onToggle:     () => void
}) {
  const img     = deal.images[0]
  const blurb   = truncateWords(deal.tagline, 20)
  const cat     = categoryLabel(deal.category)
  const brandEb = [deal.brand, cat].filter(Boolean).join(' · ')

  return (
    <div className="relative flex flex-col bg-cream rounded-[16px] border-[1.2px] border-line-2 overflow-hidden">
      <span
        className={`absolute z-10 text-[22px] leading-none top-3 ${tagSide === 'left' ? 'left-4 -rotate-[4deg] text-coral' : 'right-4 rotate-[3deg] text-sage'}`}
        style={{ fontFamily: 'var(--font-script)' }}
      >
        {tag}
      </span>

      <Link
        to={`/products/${deal.handle}`}
        className="flex items-center justify-center pt-7 pb-3 px-5"
      >
        {img ? (
          <img
            src={shopifyImageUrl(img.url, 320)}
            alt={img.altText ?? deal.seoTitle}
            className="max-h-[160px] w-auto"
            style={{ filter: 'drop-shadow(0 10px 20px rgba(21,18,17,0.12))' }}
            loading="eager"
            fetchPriority="high"
          />
        ) : null}
      </Link>

      <div className="px-5 pb-5">
        {brandEb && (
          <div className="text-[10.5px] tracking-[0.14em] uppercase font-bold text-muted mb-1" style={{ fontFamily: 'var(--font-body)' }}>
            {brandEb}
          </div>
        )}
        <div className="text-[19px] font-bold leading-tight mb-1.5" style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>
          {deal.seoTitle}
        </div>
        {blurb && (
          <p className="text-[12.5px] leading-[1.45] text-ink-2 mb-2.5" style={{ fontFamily: 'var(--font-body)' }}>
            {blurb}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[17px] font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {fmtPrice(deal.dealPrice)}
          </span>
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1 text-[12px] font-bold text-ink hover:text-coral underline decoration-[1.5px] underline-offset-[3px] whitespace-nowrap"
            style={{ fontFamily: 'var(--font-body)' }}
            aria-expanded={open}
          >
            {optionGroups.length > 0 ? 'Pick size' : 'Adjust qty'}
            <span
              className="inline-block text-[10px] transition-transform duration-200"
              style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >▾</span>
          </button>
        </div>

        <Disclosure open={open} optionGroups={optionGroups} selected={selected} setSelected={setSelected} qty={qty} setQty={setQty} />
      </div>
    </div>
  )
}

/* =============================================================
   Desktop pair tile (tape + script anno + big image + script emma-say)
   ============================================================= */
function DesktopPairItem({
  deal, side, tape, anno, qty, setQty, optionGroups, selected, setSelected, open, onToggle,
}: {
  deal:         Deal
  side:         'left' | 'right'
  tape:         string
  anno:         string
  qty:          number
  setQty:       (n: number) => void
  optionGroups: [string, string[]][]
  selected:     Record<string, string>
  setSelected:  (next: Record<string, string>) => void
  open:         boolean
  onToggle:     () => void
}) {
  const img     = deal.images[0]
  const say     = truncateWords(deal.tagline, 10)
  const cat     = categoryLabel(deal.category)
  const brandEb = [deal.brand, cat].filter(Boolean).join(' · ')

  const tapeStyle = side === 'left'
    ? { left: '22px', transform: 'rotate(-2deg)', background: 'var(--color-butter)', color: 'var(--color-ink)' }
    : { right: '22px', transform: 'rotate(2deg)', background: 'var(--color-sage)', color: 'var(--color-cream)' }
  const annoStyle = side === 'left'
    ? { left: '120px', transform: 'rotate(-3deg)', color: 'var(--color-coral)' }
    : { right: '120px', transform: 'rotate(2deg)', color: 'var(--color-sage)' }

  return (
    <div className="relative flex flex-col px-10 pt-10 pb-7 min-h-[560px]">
      <span
        className="absolute top-[22px] z-[3] whitespace-nowrap"
        style={{
          ...tapeStyle,
          padding:       '4px 11px',
          fontFamily:    'var(--font-body)',
          fontWeight:    800,
          fontSize:      '10.5px',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          border:        '1.2px solid var(--color-ink)',
          boxShadow:     '2px 2px 0 var(--color-ink)',
          borderRadius:  '2px',
        }}
      >
        {tape}
      </span>
      <span
        className="absolute top-[26px] z-[3] whitespace-nowrap"
        style={{
          ...annoStyle,
          fontFamily: 'var(--font-script)',
          fontSize:   '22px',
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        {anno}
      </span>

      <Link
        to={`/products/${deal.handle}`}
        className="relative flex-1 flex items-center justify-center -mx-10 pt-6 pb-4 min-h-[320px] overflow-hidden"
      >
        {img ? (
          <>
            <img
              src={shopifyImageUrl(img.url, 800)}
              alt={img.altText ?? deal.seoTitle}
              className="w-full h-auto max-h-[440px] object-contain transition-transform duration-300 hover:scale-[1.03]"
              style={{ filter: 'drop-shadow(0 18px 30px rgba(21,18,17,0.16))' }}
              loading="eager"
              fetchPriority="high"
            />
            <span
              aria-hidden="true"
              className="absolute left-1/2 bottom-3 -translate-x-1/2"
              style={{
                width:  '260px',
                height: '18px',
                background: 'radial-gradient(ellipse, rgba(21,18,17,0.18), transparent 70%)',
                filter: 'blur(2px)',
                zIndex: -1,
              }}
            />
          </>
        ) : null}
      </Link>

      <div className="pt-[18px]" style={{ borderTop: '1px dashed var(--color-line-2)' }}>
        {brandEb && (
          <div className="mb-1.5 text-muted" style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: '10.5px', letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            {brandEb}
          </div>
        )}
        <div
          className="mb-2 leading-[1.15]"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '22px', letterSpacing: '-0.01em' }}
        >
          {deal.seoTitle}
        </div>
        {say && (
          <div
            className="flex items-baseline gap-1.5 mb-3.5"
            style={{ fontFamily: 'var(--font-script)', fontSize: '19px', color: 'var(--color-ink-2)', lineHeight: 1.25 }}
          >
            <span className="text-coral font-bold" style={{ fontFamily: 'var(--font-body)', fontSize: '14px' }}>—</span>
            <span>{say}</span>
          </div>
        )}

        <div
          className="flex items-baseline justify-between gap-[18px] pt-2.5 mt-2.5"
          style={{ borderTop: '1px solid var(--color-line)' }}
        >
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '22px', letterSpacing: '-0.01em' }}>
            {fmtPrice(deal.dealPrice)}
          </span>
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1 text-ink hover:text-coral underline whitespace-nowrap"
            style={{
              fontFamily:           'var(--font-body)',
              fontWeight:           700,
              fontSize:             '12px',
              textDecorationThickness: '1.5px',
              textUnderlineOffset:  '3px',
            }}
            aria-expanded={open}
          >
            {optionGroups.length > 0 ? 'Pick size' : 'Adjust qty'}
            <span
              className="inline-block text-[10px] transition-transform duration-200"
              style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >▾</span>
          </button>
        </div>

        <Disclosure open={open} optionGroups={optionGroups} selected={selected} setSelected={setSelected} qty={qty} setQty={setQty} />
      </div>
    </div>
  )
}

/* =============================================================
   The hero
   ============================================================= */
export function PairBundleHero({ primary, partner, copy, discountPct }: PairBundleHeroProps) {
  const fetcher = useFetcher()
  const isPending = fetcher.state !== 'idle'

  const primaryPicker = useVariantPicker(primary)
  const partnerPicker = useVariantPicker(partner)
  const [qtyA, setQtyA] = useState(1)
  const [qtyB, setQtyB] = useState(1)
  const [openA, setOpenA] = useState(false)
  const [openB, setOpenB] = useState(false)

  const combinedDeal = primary.dealPrice * qtyA + partner.dealPrice * qtyB
  const pct          = Math.max(0, Math.min(50, Math.round(discountPct)))
  const bundlePrice  = Math.round(combinedDeal * (1 - pct / 100) * 100) / 100
  const savings      = Math.round((combinedDeal - bundlePrice) * 100) / 100

  const primaryMapped = primary.mapRestricted ?? (primary.mapPrice > 0 && primary.mapPrice >= primary.msrp)
  const partnerMapped = partner.mapRestricted ?? (partner.mapPrice > 0 && partner.mapPrice >= partner.msrp)
  const showStrike    = !primaryMapped && !partnerMapped && combinedDeal > bundlePrice

  const whyCards = (copy.whyCards ?? []).slice(0, 3)

  return (
    <section className="bg-cream">
      <div className="max-w-6xl mx-auto px-4 pt-8 md:pt-14">

        {/* Shared cart form — targeted by all CTAs via form="pair-bundle-form" */}
        <fetcher.Form id="pair-bundle-form" method="post" action="/api/cart" className="hidden">
          <input type="hidden" name="intent" value="addMany" />
          <input type="hidden" name="variantId_0" value={primaryPicker.variantId} />
          <input type="hidden" name="quantity_0"  value={qtyA} />
          <input type="hidden" name="variantId_1" value={partnerPicker.variantId} />
          <input type="hidden" name="quantity_1"  value={qtyB} />
          <input type="hidden" name="cartTag"     value="pair_bundle" />
        </fetcher.Form>

        {/* ================= MOBILE ================= */}
        <div className="md:hidden">
          <div className="relative bg-paper rounded-[var(--radius-xl)] border border-line p-6 overflow-hidden">
            <Reveal disabled variant="up" delay={0.05}>
            <div className="flex flex-wrap items-start justify-between gap-4 mb-2.5">
              <span
                className="inline-flex items-center gap-1.5 px-[13px] py-1.5 rounded-full text-[11.5px] font-extrabold uppercase tracking-[0.12em]"
                style={{
                  background:  'var(--color-coral-soft)',
                  color:       'var(--color-coral-deep)',
                  border:      '1.2px solid var(--color-coral)',
                  fontFamily:  'var(--font-body)',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 21s-7.5-4.6-9.5-9.1C1 8 3 4 7 4c2 0 3.7 1.2 5 3 1.3-1.8 3-3 5-3 4 0 6 4 4.5 7.9C19.5 16.4 12 21 12 21z" />
                </svg>
                {copy.eyebrow}
              </span>
              <span
                className="text-[14px] italic text-muted text-right leading-snug max-w-[320px]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {copy.subhead}
              </span>
            </div>

            <h1
              className="text-ink text-[32px] italic mb-1.5 max-w-[880px]"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.08 }}
            >
              {copy.headline}
            </h1>
            <p
              className="text-[15px] text-muted max-w-[640px] leading-[1.5] mb-7"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              {renderWithHighlight(copy.body ?? '')}
            </p>
            </Reveal>

            <div className="relative mb-6 overflow-visible bg-transparent">
              <div className="grid grid-cols-1 relative">
                <MobilePairItem
                  deal={primary}
                  tag={copy.primaryTag || 'this one'}
                  tagSide="left"
                  qty={qtyA}
                  setQty={setQtyA}
                  optionGroups={primaryPicker.optionGroups}
                  selected={primaryPicker.selected}
                  setSelected={primaryPicker.setSelected}
                  open={openA}
                  onToggle={() => setOpenA(v => !v)}
                />

                <div className="relative flex items-center justify-center py-3.5">
                  <svg
                    className="absolute left-8 right-8 top-1/2 -translate-y-1/2 h-10 w-[calc(100%-4rem)]"
                    viewBox="0 0 320 40"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path d="M 0 20 C 60 0, 120 40, 160 20 S 260 0, 320 20" stroke="#151211" strokeWidth="2" strokeDasharray="4 3" fill="none" strokeLinecap="round" />
                  </svg>
                  <div className="relative z-[2] flex items-center gap-2.5">
                    <div
                      className="w-[46px] h-[46px] rounded-full flex items-center justify-center text-cream"
                      style={{
                        background:  'var(--color-coral)',
                        border:      '1.5px solid var(--color-ink)',
                        boxShadow:   '2px 2px 0 var(--color-ink)',
                        fontFamily:  'var(--font-display)',
                        fontStyle:   'italic',
                        fontWeight:  800,
                        fontSize:    '22px',
                        lineHeight:  1,
                      }}
                      aria-hidden="true"
                    >
                      &amp;
                    </div>
                    {copy.knotCaption ? (
                      <div
                        className="whitespace-nowrap px-2.5 py-0.5"
                        style={{
                          background:   'var(--color-butter)',
                          border:       '1.2px solid var(--color-ink)',
                          borderRadius: '6px',
                          transform:    'rotate(-2deg)',
                          boxShadow:    '1.5px 1.5px 0 var(--color-ink)',
                          fontFamily:   'var(--font-script)',
                          fontSize:     '17px',
                          color:        'var(--color-ink)',
                        }}
                      >
                        {copy.knotCaption}
                      </div>
                    ) : null}
                  </div>
                </div>

                <MobilePairItem
                  deal={partner}
                  tag={copy.partnerTag || 'and this'}
                  tagSide="right"
                  qty={qtyB}
                  setQty={setQtyB}
                  optionGroups={partnerPicker.optionGroups}
                  selected={partnerPicker.selected}
                  setSelected={partnerPicker.setSelected}
                  open={openB}
                  onToggle={() => setOpenB(v => !v)}
                />
              </div>
            </div>

          </div>
        </div>

        {/* ================= DESKTOP (hi-fi) ================= */}
        <article
          className="hidden md:block relative bg-paper overflow-hidden"
          style={{
            border:       '1.5px solid var(--color-ink)',
            borderRadius: '10px',
            boxShadow:    '0 30px 60px -30px rgba(21,18,17,0.2)',
          }}
        >
          {/* ---------- HEAD ---------- */}
          <header
            className="relative grid grid-cols-[1fr_auto] gap-8 px-10 pt-9 pb-7"
            style={{ borderBottom: '1px dashed var(--color-line-2)' }}
          >
            <div aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-1.5 bg-coral" />

            <Reveal disabled variant="up" delay={0.05}>
              <div className="flex items-center gap-3.5 mb-4">
                <span
                  className="w-[42px] h-[42px] rounded-full bg-coral text-cream inline-flex items-center justify-center shrink-0"
                  style={{
                    border:     '1.5px solid var(--color-ink)',
                    boxShadow:  '2px 2px 0 var(--color-ink)',
                    fontFamily: 'var(--font-display)',
                    fontWeight: 800,
                    fontSize:   '17px',
                  }}
                >
                  E
                </span>
                <div>
                  <div
                    className="mb-0.5"
                    style={{
                      fontFamily:     'var(--font-body)',
                      fontWeight:     800,
                      fontSize:       '11px',
                      letterSpacing:  '0.14em',
                      textTransform:  'uppercase',
                      color:          'var(--color-coral-deep)',
                    }}
                  >
                    ♥ {copy.eyebrow}
                  </div>
                  <div
                    className="italic text-muted"
                    style={{ fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: 400 }}
                  >
                    {copy.subhead}
                  </div>
                </div>
              </div>

              <h2
                className="italic mb-3.5 max-w-[720px]"
                style={{
                  fontFamily:    'var(--font-display)',
                  fontStyle:     'italic',
                  fontWeight:    500,
                  fontSize:      '52px',
                  lineHeight:    1.03,
                  letterSpacing: '-0.022em',
                }}
              >
                {renderHeadlineItalic(copy.headline)}
              </h2>

              <p
                className="text-ink-2 max-w-[680px]"
                style={{ fontFamily: 'var(--font-body)', fontSize: '14.5px', lineHeight: 1.6 }}
              >
                {renderDekWithPill(copy.body ?? '')}
              </p>
            </Reveal>

            <div
              className="text-right italic text-muted self-start max-w-[260px]"
              style={{ fontFamily: 'var(--font-display)', fontSize: '13.5px', lineHeight: 1.5 }}
            >
              <div
                className="mb-1.5 text-ink not-italic"
                style={{
                  fontFamily:     'var(--font-body)',
                  fontWeight:     800,
                  fontSize:       '11px',
                  letterSpacing:  '0.16em',
                  textTransform:  'uppercase',
                }}
              >
                Emma&#39;s curated pair
              </div>
              {copy.subhead}
            </div>
          </header>

          {/* ---------- TIED STAGE ---------- */}
          <section
            className="relative grid grid-cols-2 bg-cream-2"
            style={{
              borderTop:    '1px solid var(--color-line)',
              borderBottom: '1px solid var(--color-line)',
            }}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'radial-gradient(ellipse at 20% 20%, rgba(255,75,31,0.06), transparent 45%), radial-gradient(ellipse at 80% 80%, rgba(124,143,120,0.08), transparent 45%)',
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute"
              style={{
                left:        '50%',
                top:         '40px',
                bottom:      '40px',
                borderLeft:  '1.5px dashed var(--color-line-2)',
                transform:   'translateX(-50%)',
              }}
            />

            <DesktopPairItem
              deal={primary}
              side="left"
              tape="This one"
              anno={copy.primaryTag || '♥ start here'}
              qty={qtyA}
              setQty={setQtyA}
              optionGroups={primaryPicker.optionGroups}
              selected={primaryPicker.selected}
              setSelected={primaryPicker.setSelected}
              open={openA}
              onToggle={() => setOpenA(v => !v)}
            />
            <DesktopPairItem
              deal={partner}
              side="right"
              tape="And this"
              anno={copy.partnerTag || '★ the glide'}
              qty={qtyB}
              setQty={setQtyB}
              optionGroups={partnerPicker.optionGroups}
              selected={partnerPicker.selected}
              setSelected={partnerPicker.setSelected}
              open={openB}
              onToggle={() => setOpenB(v => !v)}
            />

            {/* knot overlay */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute z-[4]"
              style={{
                top:       '50%',
                left:      '50%',
                transform: 'translate(-50%, -55%)',
                width:     '300px',
                height:    '160px',
              }}
            >
              <svg
                className="w-full h-full overflow-visible"
                viewBox="0 0 300 160"
                preserveAspectRatio="none"
              >
                <path
                  d="M 10,80 C 60,40 100,110 150,80 C 200,50 240,120 290,80"
                  fill="none"
                  stroke="var(--color-ink)"
                  strokeWidth="2"
                  strokeDasharray="6 5"
                  strokeLinecap="round"
                  opacity="0.6"
                />
              </svg>
              {copy.knotCaption && (
                <span
                  className="absolute whitespace-nowrap -translate-x-1/2"
                  style={{
                    top:        'calc(50% - 56px)',
                    left:       '50%',
                    fontFamily: 'var(--font-script)',
                    fontSize:   '19px',
                    color:      'var(--color-coral-deep)',
                  }}
                >
                  — {copy.knotCaption} —
                </span>
              )}
              <div
                className="absolute flex items-center justify-center text-cream"
                style={{
                  top:          '50%',
                  left:         '50%',
                  transform:    'translate(-50%, -50%) rotate(-8deg)',
                  width:        '56px',
                  height:       '56px',
                  borderRadius: '999px',
                  background:   'var(--color-coral)',
                  border:       '2.5px solid var(--color-ink)',
                  boxShadow:    '3px 3px 0 var(--color-ink)',
                  fontFamily:   'var(--font-display)',
                  fontStyle:    'italic',
                  fontWeight:   800,
                  fontSize:     '30px',
                }}
              >
                &amp;
              </div>
            </div>
          </section>

        </article>
      </div>

      {/* ================= CAROUSEL (full-bleed) ================= */}
      <PairBundleHeroCarousel
        whyCards={whyCards}
        emmaQuote={copy.emmaQuote ?? ''}
        momentTitle={copy.momentTitle ?? 'how to make this pair click'}
        moments={copy.moments ?? []}
      />

      {/* ================= BOTTOM HALF ================= */}
      <div className="max-w-6xl mx-auto px-4 pb-8 md:pb-14 pt-6 md:pt-8">

        {/* ================= MOBILE (bottom) ================= */}
        <div className="md:hidden">
          <div className="relative bg-paper rounded-[var(--radius-xl)] border border-line p-6 overflow-hidden">
            <div
              className="grid grid-cols-1 gap-5 p-6 rounded-[16px] bg-cream-2"
              style={{ border: '1.2px solid var(--color-ink)' }}
            >
              <div className="flex flex-wrap items-baseline gap-3.5">
                <span className="text-coral" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '38px', letterSpacing: '-0.01em' }}>
                  {fmtPrice(bundlePrice)}
                </span>
                {showStrike && (
                  <span className="text-muted line-through text-[18px]" style={{ fontFamily: 'var(--font-display)' }}>
                    {fmtPrice(combinedDeal)}
                  </span>
                )}
                {savings > 0 && (
                  <span
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-[0.04em]"
                    style={{
                      background: 'var(--color-butter)',
                      border:     '1.2px solid var(--color-ink)',
                      fontFamily: 'var(--font-body)',
                    }}
                  >
                    save {fmtPrice(savings)} as a pair
                  </span>
                )}
                <p className="w-full text-[11.5px] text-muted mt-0.5" style={{ fontFamily: 'var(--font-body)' }}>
                  Shipping free on this pair · plain packaging · 30-day returns
                </p>
              </div>
            </div>

            {copy.bannerLine && (
              <p className="text-center mt-5 italic text-[13px] text-muted" style={{ fontFamily: 'var(--font-body)' }}>
                {copy.bannerLine}
              </p>
            )}
          </div>

          {/* Mobile sticky CTA */}
          <div
            className="sticky bottom-0 left-0 right-0 -mx-4 px-4 pt-6 pb-3.5 mt-4 z-20"
            style={{
              background: 'linear-gradient(180deg, rgba(250,244,234,0) 0%, var(--color-cream) 30%)',
            }}
          >
            <button
              type="submit"
              form="pair-bundle-form"
              disabled={isPending}
              className="w-full inline-flex items-center justify-between gap-2.5 px-5 py-4 rounded-full bg-coral text-cream disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                border:     '1.5px solid var(--color-ink)',
                boxShadow:  '3px 3px 0 var(--color-ink)',
                fontFamily: 'var(--font-body)',
                fontWeight: 800,
                fontSize:   '14.5px',
              }}
            >
              <span>{isPending ? 'Adding…' : 'I\u2019ll take both \u2665'}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '16px' }}>
                {fmtPrice(bundlePrice)}
              </span>
            </button>
          </div>
        </div>

        {/* ================= DESKTOP (bottom) ================= */}
        <article
          className="hidden md:block relative bg-paper overflow-hidden"
          style={{
            border:       '1.5px solid var(--color-ink)',
            borderRadius: '10px',
            boxShadow:    '0 30px 60px -30px rgba(21,18,17,0.2)',
          }}
        >
          {/* ---------- BUY BAR (climax) ---------- */}
          <section
            className="relative grid grid-cols-[1fr_auto] gap-8 px-10 py-8 items-center"
            style={{
              background:  'linear-gradient(180deg, var(--color-butter) 0%, #FFD76B 100%)',
              borderTop:   '1.5px solid var(--color-ink)',
            }}
          >
            <div
              aria-hidden="true"
              className="absolute left-5 right-5 h-1"
              style={{
                top: '-2px',
                background: 'repeating-linear-gradient(90deg, var(--color-ink) 0 8px, transparent 8px 14px)',
              }}
            />

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-3.5 flex-wrap">
                <span
                  style={{
                    fontFamily:    'var(--font-display)',
                    fontWeight:    700,
                    fontSize:      '52px',
                    color:         'var(--color-coral-deep)',
                    letterSpacing: '-0.025em',
                    lineHeight:    1,
                  }}
                >
                  {fmtPrice(bundlePrice)}
                </span>
                {showStrike && (
                  <span
                    className="text-muted line-through"
                    style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: '22px' }}
                  >
                    {fmtPrice(combinedDeal)}
                  </span>
                )}
                {savings > 0 && (
                  <span
                    className="bg-ink text-cream relative"
                    style={{
                      padding:        '6px 14px 6px 18px',
                      borderRadius:   '2px',
                      fontFamily:     'var(--font-body)',
                      fontWeight:     800,
                      fontSize:       '11px',
                      letterSpacing:  '0.12em',
                      textTransform:  'uppercase',
                      clipPath:       'polygon(0 0, 100% 0, calc(100% - 10px) 50%, 100% 100%, 0 100%)',
                    }}
                  >
                    save{' '}
                    <strong style={{ color: 'var(--color-butter)', margin: '0 2px' }}>
                      {fmtPrice(savings)}
                    </strong>{' '}
                    as a pair
                  </span>
                )}
              </div>

              <div
                className="flex gap-2.5 flex-wrap text-ink-2"
                style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: '12.5px' }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-[5px] h-[5px] rounded-full bg-coral" />Ships free
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-[5px] h-[5px] rounded-full bg-coral" />Plain envelope
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-[5px] h-[5px] rounded-full bg-coral" />30-day returns
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 items-end">
              <button
                type="submit"
                form="pair-bundle-form"
                disabled={isPending}
                className="inline-flex items-center gap-2.5 rounded-full bg-coral text-cream transition-[transform,box-shadow] duration-100 hover:-translate-x-px hover:-translate-y-px disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  padding:    '16px 32px',
                  border:     '2px solid var(--color-ink)',
                  boxShadow:  '4px 4px 0 var(--color-ink)',
                  fontFamily: 'var(--font-body)',
                  fontWeight: 800,
                  fontSize:   '16px',
                }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '5px 5px 0 var(--color-ink)' }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = '4px 4px 0 var(--color-ink)' }}
              >
                <span>{isPending ? 'Adding…' : "I\u2019ll take both"}</span>
                <span style={{ color: 'var(--color-butter)', fontSize: '17px' }}>♥</span>
              </button>
            </div>
          </section>

          {/* ---------- SIGNATURE ---------- */}
          {copy.bannerLine && (
            <footer
              className="flex items-center justify-center gap-3 px-10 py-[18px] bg-paper text-muted italic"
              style={{ fontFamily: 'var(--font-display)', fontSize: '14px' }}
            >
              <span className="text-coral font-bold not-italic" style={{ fontFamily: 'var(--font-body)' }}>—</span>
              <span>{copy.bannerLine}</span>
            </footer>
          )}
        </article>
      </div>
    </section>
  )
}
