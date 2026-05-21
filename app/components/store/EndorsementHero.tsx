import { useEffect, useMemo, useState } from 'react'
import { Link, useFetcher, useRouteLoaderData } from 'react-router'
import type { loader as layoutLoader } from '~/routes/_layout'
import type { Deal, EndorsementCopy } from '~/types'
import { CircleOptionSelector } from './CircleOptionSelector'
import { OptimizedImage } from './OptimizedImage'

interface EndorsementHeroProps {
  deal:             Deal
  copy:             EndorsementCopy
  /** Show "· free shipping" beside the price (driven by admin homepage flag). */
  showFreeShipping: boolean
  /** Sanity-defined color label → CSS color overrides (PDP-style). */
  swatches?:        Record<string, string>
}

const fmtPrice = (n: number) =>
  `$${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2)}`

const isColorOption = (name: string) => /colou?r/i.test(name)
const isSizeOption  = (name: string) => /^size$/i.test(name)

/**
 * Render an Emma quote with `_emphasis_` segments highlighted in coral.
 * The generator may put `\n` between sentences for editorial readability,
 * but at render time we collapse them to a single space and let the
 * browser wrap naturally (text-wrap: balance) — hard breaks produced
 * jagged, uneven lines that read as unintended.
 */
function renderQuote(quote: string) {
  const flat = quote.replace(/\s*\n+\s*/g, ' ').trim()
  const parts = flat.split(/(_[^_]+_)/g)
  return parts.map((part, i) => {
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
      return (
        <span
          key={i}
          className="text-coral"
          style={{ fontStyle: 'italic' }}
        >
          {part.slice(1, -1)}
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export function EndorsementHero({ deal, copy, showFreeShipping, swatches = {} }: EndorsementHeroProps) {
  const root = useRouteLoaderData<typeof layoutLoader>('routes/_layout')
  const emmaPersona = root?.emmaPersona ?? null

  const fetcher = useFetcher<{ ok?: boolean; error?: string }>()
  const isPending = fetcher.state !== 'idle'

  // Variant resolution — start unselected for multi-variant products.
  const variants     = deal.variants ?? []
  const options      = (deal.options ?? []).filter(o => o.values.length > 1)
  const multiVariant = variants.length > 1
  const colorOpt     = options.find(o => isColorOption(o.name))
  const sizeOpt      = options.find(o => isSizeOption(o.name))

  const [selected, setSelected] = useState<Record<string, string>>({})
  // Pulse the variant selectors and surface a callout when the shopper
  // taps Add-to-Cart without picking a required option. Self-clears after
  // the toast fades. Mirrors the pair-bundle template's UX.
  const [highlight, setHighlight] = useState(false)
  const [toastState, setToastState] = useState<{ message: string; nonce: number } | null>(null)

  useEffect(() => {
    if (!toastState) return
    const t = setTimeout(() => {
      setToastState(null)
      setHighlight(false)
    }, 2500)
    return () => clearTimeout(t)
  }, [toastState])

  const isReady = options.every(o => !!selected[o.name])
  /** Name of the first unfilled option ("Color" / "Size") — drives the
   *  CTA button label and the toast message. */
  const missingOption = options.find(o => !selected[o.name])?.name ?? null
  const selectedVariant = useMemo(() => {
    if (!multiVariant) return variants[0]
    if (!isReady) return undefined
    return variants.find(v =>
      v.selectedOptions.every(o => selected[o.name] === o.value),
    )
  }, [variants, selected, isReady, multiVariant])

  const variantId = selectedVariant?.id ?? deal.variantId ?? ''
  const inStock   = selectedVariant?.availableForSale ?? (multiVariant ? false : deal.qty > 0)
  const price     = selectedVariant ? parseFloat(selectedVariant.price) : deal.dealPrice

  const image = deal.images[0]
  const pdpHref = `/products/${deal.handle}`

  const note = copy.noteLabel ?? 'quiet endorsement'
  const alsoIntoLabel = copy.alsoIntoLabel || "I'm also into"

  // Discount math for the gold price bar. Honors MAP restriction so we
  // never advertise a discount on items where price compression isn't
  // permitted by the brand.
  const mapRestricted = (deal as { mapRestricted?: boolean }).mapRestricted
    ?? (deal.mapPrice > 0 && deal.mapPrice >= deal.msrp)
  const showStrike    = !mapRestricted && deal.msrp > price
  const savings       = showStrike ? deal.msrp - price : 0
  const discountPct   = showStrike && deal.msrp > 0
    ? Math.round((savings / deal.msrp) * 100)
    : 0

  return (
    <section className="bg-cream">
      <div className="max-w-6xl mx-auto px-4 pt-8 md:pt-14 pb-3 grid gap-6 md:grid-cols-[1.25fr_1fr] md:items-stretch">
        {/* ============================================================
            LEFT — Emma says editorial card
            ============================================================ */}
        <article className="relative bg-paper rounded-[var(--radius-lg)] p-6 md:p-10 flex flex-col gap-6 overflow-visible">
          {/* Sticky-note label, tilted, anchored to top-left */}
          {note && (
            <span
              className="absolute -top-3 left-6 -rotate-2 z-10 inline-block px-3 py-1.5 rounded-md shadow-sm border border-ink/80 text-coral-deep text-[11px] font-bold tracking-[0.04em] whitespace-nowrap"
              style={{
                background:  'var(--color-butter)',
                fontFamily:  'var(--font-script)',
              }}
            >
              {note}
            </span>
          )}

          {/* Emma byline — avatar + EMMA SAYS + intro tagline */}
          <header className="flex items-center gap-3 mt-2">
            {emmaPersona?.avatarUrl ? (
              <img
                src={emmaPersona.avatarUrl}
                alt={emmaPersona.avatarAlt || emmaPersona.displayName || 'Emma'}
                width={56}
                height={56}
                className="w-14 h-14 rounded-full object-cover shrink-0"
                style={{
                  border:    '1.5px solid var(--color-ink)',
                  boxShadow: '2px 2px 0 var(--color-ink)',
                }}
                loading="eager"
              />
            ) : (
              <span
                aria-hidden="true"
                className="w-14 h-14 shrink-0 rounded-full bg-coral text-white inline-flex items-center justify-center text-lg leading-none"
                style={{
                  border:     '1.5px solid var(--color-ink)',
                  boxShadow:  '2px 2px 0 var(--color-ink)',
                  fontFamily: 'var(--font-display)',
                  fontWeight: 800,
                }}
              >
                E
              </span>
            )}
            <div className="flex flex-col min-w-0">
              <span
                className="text-ink text-[11px] tracking-[0.22em] uppercase font-bold"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Emma says
              </span>
              <span className="text-muted text-xs italic truncate">
                {copy.emmaIntro}
              </span>
            </div>
          </header>

          {/* Editorial pull quote — large script. textWrap: balance lets the
              browser pick line breaks that read evenly instead of honoring
              the model's hard newlines, which produced jagged line lengths. */}
          <Link to={pdpHref} className="block group">
            <p
              className="text-ink text-2xl md:text-3xl leading-[1.25] italic group-hover:opacity-90 transition-opacity max-w-[34ch]"
              style={{ fontFamily: 'var(--font-script)', textWrap: 'balance' }}
            >
              &ldquo;{renderQuote(copy.quote)}&rdquo;
            </p>
          </Link>

          {/* CTA row — secondary "I'm also into" only. Primary buy lives in
              the gold price bar below; we don't duplicate it here. */}
          {copy.alsoIntoCollectionHandle && (
            <div className="mt-auto pt-2 flex flex-wrap items-center gap-3">
              <Link
                to={`/collections/${copy.alsoIntoCollectionHandle}`}
                className="inline-flex items-center gap-2 bg-paper text-ink font-bold px-5 py-3 rounded-full border border-ink/80 hover:bg-cream-2 transition-colors"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {alsoIntoLabel}
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}
        </article>

        {/* ============================================================
            RIGHT — product card (image + didactic + buy)
            ============================================================ */}
        <article className="relative rounded-[var(--radius-lg)] border border-line bg-cream-2 flex flex-col min-h-[380px] md:min-h-0">
          {/* Image — its own overflow-hidden so the rounded-corner clip lives
              here, not on the parent. Lifting it off the parent lets the
              pulse-outline ring around the variant selectors below extend
              past the card edge instead of getting clipped. */}
          <Link to={pdpHref} className="relative flex-1 block bg-cream-2 overflow-hidden rounded-t-[var(--radius-lg)]">
            {image ? (
              <OptimizedImage
                src={image.url}
                alt={image.altText ?? deal.seoTitle}
                className="absolute inset-0 w-full h-full object-cover"
                priority
                sizes="(max-width: 768px) 100vw, 50vw"
              />
            ) : null}
          </Link>

          {/* Didactic — title + price on left, selectors on right; ATC below */}
          <div className="bg-paper border-t border-line">
            <div className="px-5 py-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <Link to={pdpHref} className="block group">
                  <p
                    className="text-ink text-base md:text-lg italic leading-tight group-hover:opacity-90 transition-opacity line-clamp-2"
                    style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
                  >
                    {deal.seoTitle}
                  </p>
                </Link>
              </div>

              {/* Variant selectors — color and size circles. Each is wrapped
                  in a div that gets `pulse-outline` when the shopper has
                  tapped Buy without picking that option (matches the pair-
                  bundle template behavior). */}
              {(colorOpt || sizeOpt) && (
                <div className="flex items-center gap-2 shrink-0">
                  {colorOpt && (
                    <div className={highlight && !selected[colorOpt.name] ? 'pulse-outline rounded-full' : undefined}>
                      <CircleOptionSelector
                        optionName={colorOpt.name}
                        values={colorOpt.values}
                        {...(selected[colorOpt.name] ? { selected: selected[colorOpt.name] } : {})}
                        onSelect={v => setSelected(prev => ({ ...prev, [colorOpt.name]: v }))}
                        onClear={() => setSelected(prev => {
                          const next = { ...prev }
                          delete next[colorOpt.name]
                          return next
                        })}
                        kind="color"
                        swatches={swatches}
                        variants={variants}
                        selectedOptions={selected}
                      />
                    </div>
                  )}
                  {sizeOpt && (
                    <div className={highlight && !selected[sizeOpt.name] ? 'pulse-outline rounded-full' : undefined}>
                      <CircleOptionSelector
                        optionName={sizeOpt.name}
                        values={sizeOpt.values}
                        {...(selected[sizeOpt.name] ? { selected: selected[sizeOpt.name] } : {})}
                        onSelect={v => setSelected(prev => ({ ...prev, [sizeOpt.name]: v }))}
                        onClear={() => setSelected(prev => {
                          const next = { ...prev }
                          delete next[sizeOpt.name]
                          return next
                        })}
                        kind="size"
                        variants={variants}
                        selectedOptions={selected}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        </article>
      </div>

      {/* ============================================================
          GOLD PRICE BAR — full-width strip below the hero cards.
          Mirrors the pair-bundle buy bar styling: butter→amber gradient,
          coral price, optional strike-through MSRP, black ribbon for the
          discount %, and a coral Add-to-Cart button on the right.
          Renders only when there's a meaningful price to surface.
          ============================================================ */}
      {price > 0 && (
        <div className="max-w-6xl mx-auto px-4 -mt-2">
          {/* No overflow-hidden on the wrapper — the rounded clip lives on the
              gradient section so the toast that floats up out of the buy
              button can extend past the price bar without getting cut off. */}
          <article
            className="relative bg-paper rounded-[var(--radius-lg)]"
            style={{ boxShadow: '0 30px 60px -30px rgba(21,18,17,0.2)' }}
          >
            <section
              className="relative grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 px-6 md:px-10 py-6 md:py-8 items-center rounded-[var(--radius-lg)]"
              style={{
                background: 'linear-gradient(180deg, var(--color-butter) 0%, #FFD76B 100%)',
              }}
            >
              <div className="flex items-baseline gap-3.5 flex-wrap">
                <span
                  style={{
                    fontFamily:    'var(--font-display)',
                    fontWeight:    700,
                    fontSize:      'clamp(34px, 5vw, 52px)',
                    color:         'var(--color-coral-deep)',
                    letterSpacing: '-0.025em',
                    lineHeight:    1,
                  }}
                >
                  {fmtPrice(price)}
                </span>
                {showStrike && (
                  <span
                    className="text-muted line-through"
                    style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: '22px' }}
                  >
                    {fmtPrice(deal.msrp)}
                  </span>
                )}
                {discountPct > 0 && (
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
                      {discountPct}%
                    </strong>{' '}
                    off
                  </span>
                )}
                {showFreeShipping && (
                  <span className="text-ink/70 italic" style={{ fontFamily: 'var(--font-display)', fontSize: '14px' }}>
                    · free shipping
                  </span>
                )}
              </div>

              <fetcher.Form
                method="post"
                action="/api/cart"
                className="md:justify-self-end relative"
              >
                {toastState && (
                  <div
                    key={toastState.nonce}
                    role="status"
                    aria-live="polite"
                    className="float-up-fade absolute bottom-full left-1/2 mb-3 z-30 pointer-events-none whitespace-nowrap"
                  >
                    <div
                      className="inline-flex items-center gap-2 bg-white border border-cream-2 rounded-full shadow-lg px-4 py-2 text-[13px] font-semibold text-ink"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
                      {toastState.message}
                    </div>
                  </div>
                )}
                <input type="hidden" name="intent"    value="add-item" />
                <input type="hidden" name="variantId" value={variantId} />
                <input type="hidden" name="quantity"  value="1" />
                <button
                  type="submit"
                  /* Stay clickable while a variant is unpicked so the click-
                     guard below can fire and pulse the missing selector.
                     Only disable once the variant is fully resolved and the
                     resolved variant is actually unavailable. */
                  disabled={isPending || (isReady && !inStock)}
                  onClick={(e) => {
                    // Block the submit on the click side (more reliable than
                    // fetcher.Form onSubmit). When a required option is
                    // unfilled, fire the toast and flip `highlight` so the
                    // unfilled selectors pulse — same UX as pair-bundle.
                    if (multiVariant && !isReady) {
                      e.preventDefault()
                      e.stopPropagation()
                      const opt = (missingOption ?? 'option').toLowerCase()
                      setToastState({ message: `Please select a ${opt}`, nonce: Date.now() })
                      setHighlight(true)
                    }
                  }}
                  className="inline-flex items-center gap-2.5 rounded-full bg-coral text-cream transition-[transform,box-shadow] duration-100 hover:-translate-x-px hover:-translate-y-px disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{
                    padding:    '14px 28px',
                    border:     '2px solid var(--color-ink)',
                    boxShadow:  '4px 4px 0 var(--color-ink)',
                    fontFamily: 'var(--font-body)',
                    fontWeight: 800,
                    fontSize:   '15px',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = '5px 5px 0 var(--color-ink)' }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = '4px 4px 0 var(--color-ink)' }}
                >
                  <span>{
                    isPending
                      ? 'Adding…'
                      : (multiVariant && !isReady)
                        ? (() => {
                            const missing: string[] = []
                            if (colorOpt && !selected[colorOpt.name]) missing.push('Color')
                            if (sizeOpt  && !selected[sizeOpt.name])  missing.push('Size')
                            return `Select a ${missing.join(' or ')}`
                          })()
                        : 'Add to Cart'
                  }</span>
                  <span style={{ color: 'var(--color-butter)', fontSize: '17px' }}>♥</span>
                </button>
              </fetcher.Form>
            </section>
          </article>
        </div>
      )}

    </section>
  )
}
