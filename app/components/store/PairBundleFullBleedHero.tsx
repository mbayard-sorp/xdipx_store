import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useFetcher, useRouteLoaderData } from 'react-router'
import type { loader as layoutLoader } from '~/routes/_layout'
import type { Deal, PairBundleCopy, ProductVariant } from '~/types'
import { PairBundleHeroCarousel } from './PairBundleHeroCarousel'
import { CircleOptionSelector } from './CircleOptionSelector'
import { splitUnderscores, renderWithHighlight } from './pairBundleText'

interface PairBundleFullBleedHeroProps {
  primary:     Deal
  partner:     Deal
  copy:        PairBundleCopy
  discountPct: number
  /** Optional trust bar rendered between the price/buy strip and the carousel. */
  trustBar?:   ReactNode
  /** Sanity-defined color label → CSS color overrides (PDP-style). */
  swatches?:   Record<string, string>
}

const fmtPrice = (n: number) =>
  `$${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2)}`

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

  // Start with NO option selected — user must explicitly pick before adding.
  const [selected, setSelected] = useState<Record<string, string>>({})

  const isReady = optionGroups.every(([name]) => !!selected[name])

  const selectedVariant: ProductVariant | undefined = useMemo(() => {
    if (!deal.variants?.length) return undefined
    if (!isReady) return undefined
    return deal.variants.find(v =>
      v.selectedOptions.every(o => selected[o.name] === o.value),
    )
  }, [deal.variants, selected, isReady])

  const variantId = isReady ? (selectedVariant?.id || deal.variantId) : undefined

  const missingOption = optionGroups.find(([name]) => !selected[name])?.[0] ?? null

  return { optionGroups, selected, setSelected, variantId, isReady, missingOption }
}

const isColorOption = (name: string) => /colou?r/i.test(name)

/* =============================================================
   Mobile pair tile (bordered cream card, centered image)
   ============================================================= */
function MobilePairItem({
  deal, selected, setSelected, swatches, highlightColor,
}: {
  deal:           Deal
  selected:       Record<string, string>
  setSelected:    (next: Record<string, string>) => void
  swatches:       Record<string, string>
  highlightColor: boolean
}) {
  const img = deal.images[0]
  const colorOpt = (deal.options ?? []).find(o => isColorOption(o.name))

  return (
    <div className="relative flex flex-col bg-cream rounded-[16px] border-[1.2px] border-line-2">
      <Link
        to={`/products/${deal.handle}`}
        className="flex items-center justify-center pt-7 pb-3 px-5"
      >
        {img ? (
          <img
            src={img.url}
            alt={img.altText ?? deal.seoTitle}
            className="max-h-[160px] w-auto"
            style={{ filter: 'drop-shadow(0 10px 20px rgba(21,18,17,0.12))' }}
            loading="eager"
            fetchPriority="high"
          />
        ) : null}
      </Link>

      <div className="px-5 pb-5">
        <div className="flex items-center justify-between gap-3">
          <div
            className="flex-1 min-w-0 text-left text-[19px] font-bold leading-tight"
            style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}
          >
            {deal.seoTitle}
          </div>
          {colorOpt && colorOpt.values.length > 1 && (
            <div className={highlightColor ? 'pulse-outline' : undefined}>
              <CircleOptionSelector
                optionName={colorOpt.name}
                values={colorOpt.values}
                {...(selected[colorOpt.name] ? { selected: selected[colorOpt.name] } : {})}
                onSelect={(v) => setSelected({ ...selected, [colorOpt.name]: v })}
                onClear={() => {
                  const next = { ...selected }
                  delete next[colorOpt.name]
                  setSelected(next)
                }}
                kind="color"
                swatches={swatches}
                variants={deal.variants ?? []}
                selectedOptions={selected}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* =============================================================
   Desktop pair tile (tape + script anno + big image + script emma-say)
   ============================================================= */
function DesktopPairItem({
  deal, selected, setSelected, swatches, highlightColor,
}: {
  deal:           Deal
  selected:       Record<string, string>
  setSelected:    (next: Record<string, string>) => void
  swatches:       Record<string, string>
  highlightColor: boolean
}) {
  const img      = deal.images[0]
  const colorOpt = (deal.options ?? []).find(o => isColorOption(o.name))

  return (
    <div className="relative flex flex-col px-10 pt-10 pb-7">
      <Link
        to={`/products/${deal.handle}`}
        className="relative flex items-start justify-center -mx-10 pt-6 pb-4 overflow-hidden"
      >
        {img ? (
          <>
            <img
              src={img.url}
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

      <div className="pt-[18px] flex-1 flex flex-col" style={{ borderTop: '1px dashed var(--color-line-2)' }}>
        <div className="flex items-center justify-between gap-3">
          <div
            className="flex-1 min-w-0 text-left leading-[1.15]"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '22px', letterSpacing: '-0.01em' }}
          >
            {deal.seoTitle}
          </div>
          {colorOpt && colorOpt.values.length > 1 && (
            <div className={highlightColor ? 'pulse-outline' : undefined}>
              <CircleOptionSelector
                optionName={colorOpt.name}
                values={colorOpt.values}
                {...(selected[colorOpt.name] ? { selected: selected[colorOpt.name] } : {})}
                onSelect={(v) => setSelected({ ...selected, [colorOpt.name]: v })}
                onClear={() => {
                  const next = { ...selected }
                  delete next[colorOpt.name]
                  setSelected(next)
                }}
                kind="color"
                swatches={swatches}
                variants={deal.variants ?? []}
                selectedOptions={selected}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* =============================================================
   The hero
   ============================================================= */
export function PairBundleFullBleedHero({ primary, partner, copy, discountPct, trustBar, swatches = {} }: PairBundleFullBleedHeroProps) {
  const fetcher = useFetcher()
  const isPending = fetcher.state !== 'idle'

  const layoutData  = useRouteLoaderData<typeof layoutLoader>('routes/_layout')
  const emmaPersona = layoutData?.emmaPersona ?? null

  const primaryPicker = useVariantPicker(primary)
  const partnerPicker = useVariantPicker(partner)

  // `nonce` lets us re-trigger the float-up-fade animation when the user
  // clicks Buy multiple times — keying off it forces React to remount.
  const [toastState, setToastState] = useState<{ message: string; nonce: number } | null>(null)
  const [highlightSide, setHighlightSide] = useState<'primary' | 'partner' | null>(null)

  // Self-clear so the highlight pulse stops when the float-up-fade finishes.
  useEffect(() => {
    if (!toastState) return
    const t = setTimeout(() => {
      setToastState(null)
      setHighlightSide(null)
    }, 2500)
    return () => clearTimeout(t)
  }, [toastState])

  // Guard the cart submission: if either picker is missing a required option,
  // block the submit, surface a callout, and pulse the relevant selector.
  const handleBuyBundleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (!primaryPicker.isReady) {
      e.preventDefault()
      const opt = (primaryPicker.missingOption ?? 'option').toLowerCase()
      setToastState({ message: `Please select a ${opt}`, nonce: Date.now() })
      setHighlightSide('primary')
      return
    }
    if (!partnerPicker.isReady) {
      e.preventDefault()
      const opt = (partnerPicker.missingOption ?? 'option').toLowerCase()
      setToastState({ message: `Please select a ${opt}`, nonce: Date.now() })
      setHighlightSide('partner')
      return
    }
  }

  const combinedDeal = primary.dealPrice + partner.dealPrice
  const combinedMsrp = primary.msrp + partner.msrp
  const pct          = Math.max(0, Math.min(50, Math.round(discountPct)))
  const bundlePrice  = Math.round(combinedDeal * (1 - pct / 100) * 100) / 100
  const savings      = Math.round((combinedMsrp - bundlePrice) * 100) / 100

  const primaryMapped = primary.mapRestricted ?? (primary.mapPrice > 0 && primary.mapPrice >= primary.msrp)
  const partnerMapped = partner.mapRestricted ?? (partner.mapPrice > 0 && partner.mapPrice >= partner.msrp)
  const showStrike    = !primaryMapped && !partnerMapped && combinedMsrp > bundlePrice

  const whyCards = (copy.whyCards ?? []).slice(0, 3)

  return (
    <section className="bg-cream">

      {/* Shared cart form — targeted by all CTAs via form="pair-bundle-form" */}
      <fetcher.Form
        id="pair-bundle-form"
        method="post"
        action="/api/cart"
        className="hidden"
        onSubmit={handleBuyBundleSubmit}
      >
        <input type="hidden" name="intent" value="addMany" />
        <input type="hidden" name="variantId_0" value={primaryPicker.variantId ?? ''} />
        <input type="hidden" name="quantity_0"  value="1" />
        <input type="hidden" name="variantId_1" value={partnerPicker.variantId ?? ''} />
        <input type="hidden" name="quantity_1"  value="1" />
        <input type="hidden" name="cartTag"     value="pair_bundle" />
      </fetcher.Form>


      {/* ===== TOP HALF (eyebrow → tied stage) ===== */}
      <div className="px-4">

        {/* ================= MOBILE (top) ================= */}
        <div className="md:hidden">
          <div className="relative bg-paper border border-line border-b-0 p-6">
            {/* Emma's intro — mobile (avatar + message + tel/message links) */}
            <div
              className="flex items-start gap-3 mb-5 pb-5"
              style={{ borderBottom: '1px dashed var(--color-line-2)' }}
            >
              {emmaPersona?.avatarUrl ? (
                <img
                  src={emmaPersona.avatarUrl}
                  alt={emmaPersona.avatarAlt || emmaPersona.displayName || 'Emma'}
                  width={64}
                  height={64}
                  className="w-16 h-16 rounded-full object-cover shrink-0"
                  style={{
                    border:    '1.5px solid var(--color-ink)',
                    boxShadow: '2px 2px 0 var(--color-ink)',
                  }}
                  loading="eager"
                />
              ) : (
                <span
                  className="w-16 h-16 rounded-full bg-coral text-cream inline-flex items-center justify-center shrink-0"
                  style={{
                    border:     '1.5px solid var(--color-ink)',
                    boxShadow:  '2px 2px 0 var(--color-ink)',
                    fontFamily: 'var(--font-display)',
                    fontWeight: 800,
                    fontSize:   '26px',
                  }}
                  aria-hidden="true"
                >
                  E
                </span>
              )}
              <div className="min-w-0">
                <p
                  style={{
                    fontFamily: 'var(--font-body)',
                    fontWeight: 500,
                    fontSize:   '13px',
                    color:      'var(--color-ink)',
                    lineHeight: 1.45,
                  }}
                >
                  Hi, I&rsquo;m Emma! Think of me as your shopping sidekick. Message or call anytime while you browse, and I&rsquo;ll help you find what you need or answer anything you&rsquo;re wondering about.
                </p>
                <div
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2"
                  style={{
                    fontFamily: 'var(--font-body)',
                    fontWeight: 700,
                    fontSize:   '13px',
                  }}
                >
                  <a
                    href="tel:+16239001188"
                    className="inline-flex items-center gap-1.5 underline decoration-[1.5px] underline-offset-[3px] hover:opacity-80"
                    style={{ color: 'var(--color-coral)' }}
                  >
                    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2.5 4.25C2.5 3.28 3.28 2.5 4.25 2.5h1.69c.78 0 1.46.55 1.62 1.32l.45 2.16c.14.66-.13 1.34-.69 1.71l-1.16.77a11.5 11.5 0 005.38 5.38l.77-1.16a1.6 1.6 0 011.71-.69l2.16.45c.77.16 1.32.84 1.32 1.62v1.69c0 .97-.78 1.75-1.75 1.75H14.5C7.6 17.5 2.5 12.4 2.5 5.5v-1.25z" />
                    </svg>
                    (623) 900-1188
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window === 'undefined') return
                      window.dispatchEvent(
                        new CustomEvent('xdipx:emma:openWith', {
                          detail: {
                            prompt: "Hi Emma! I could use a hand finding what I'm looking for.",
                          },
                        }),
                      )
                    }}
                    className="inline-flex items-center gap-1.5 underline decoration-[1.5px] underline-offset-[3px] hover:opacity-80"
                    style={{ color: 'var(--color-coral)', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: '13px' }}
                  >
                    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2.5 4.5A1.5 1.5 0 014 3h12a1.5 1.5 0 011.5 1.5v9A1.5 1.5 0 0116 15H7.41l-3.7 3.05A.6.6 0 012.5 17.6V4.5z" />
                    </svg>
                    Message Emma
                  </button>
                </div>
              </div>
            </div>

            <h1
              className="text-ink text-[32px] italic mb-7 max-w-[880px]"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.08 }}
            >
              {copy.headline}
            </h1>

            <div className="relative mb-6 overflow-visible bg-transparent">
              <div className="grid grid-cols-1 relative">
                <MobilePairItem
                  deal={primary}
                  selected={primaryPicker.selected}
                  setSelected={primaryPicker.setSelected}
                  swatches={swatches}
                  highlightColor={highlightSide === 'primary'}
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
                  selected={partnerPicker.selected}
                  setSelected={partnerPicker.setSelected}
                  swatches={swatches}
                  highlightColor={highlightSide === 'partner'}
                />
              </div>
            </div>
          </div>
        </div>
        {/* ================= DESKTOP (top: header + tied stage) ================= */}
        <article
          className="hidden md:block relative bg-paper"
          style={{
            boxShadow:    '0 30px 60px -30px rgba(21,18,17,0.2)',
          }}
        >
          {/* ---------- HEAD (two-column: Emma left, headline right) ---------- */}
          <header
            className="relative px-10 pt-9 pb-7 flex items-stretch gap-8"
            style={{ borderBottom: '1px dashed var(--color-line-2)' }}
          >
            <div aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-1.5 bg-coral" />

            {/* LEFT — Emma's section: avatar + greeting (natural width) */}
            <div className="flex items-start gap-4 shrink-0 max-w-[420px]">
              {emmaPersona?.avatarUrl ? (
                <img
                  src={emmaPersona.avatarUrl}
                  alt={emmaPersona.avatarAlt || emmaPersona.displayName || 'Emma'}
                  width={84}
                  height={84}
                  className="w-[84px] h-[84px] rounded-full object-cover shrink-0"
                  style={{
                    border:    '1.5px solid var(--color-ink)',
                    boxShadow: '2px 2px 0 var(--color-ink)',
                  }}
                  loading="eager"
                />
              ) : (
                <span
                  className="w-[84px] h-[84px] rounded-full bg-coral text-cream inline-flex items-center justify-center shrink-0"
                  style={{
                    border:     '1.5px solid var(--color-ink)',
                    boxShadow:  '2px 2px 0 var(--color-ink)',
                    fontFamily: 'var(--font-display)',
                    fontWeight: 800,
                    fontSize:   '34px',
                  }}
                  aria-hidden="true"
                >
                  E
                </span>
              )}
              <div className="min-w-0">
                <p
                  style={{
                    fontFamily: 'var(--font-body)',
                    fontWeight: 500,
                    fontSize:   '13.5px',
                    color:      'var(--color-ink)',
                    lineHeight: 1.45,
                  }}
                >
                  Hi, I&rsquo;m Emma! Think of me as your shopping sidekick. Message or call anytime while you browse, and I&rsquo;ll help you find what you need or answer anything you&rsquo;re wondering about.
                </p>
                <div
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2"
                  style={{
                    fontFamily: 'var(--font-body)',
                    fontWeight: 700,
                    fontSize:   '13.5px',
                  }}
                >
                  <a
                    href="tel:+16239001188"
                    className="inline-flex items-center gap-1.5 underline decoration-[1.5px] underline-offset-[3px] hover:opacity-80"
                    style={{ color: 'var(--color-coral)' }}
                  >
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2.5 4.25C2.5 3.28 3.28 2.5 4.25 2.5h1.69c.78 0 1.46.55 1.62 1.32l.45 2.16c.14.66-.13 1.34-.69 1.71l-1.16.77a11.5 11.5 0 005.38 5.38l.77-1.16a1.6 1.6 0 011.71-.69l2.16.45c.77.16 1.32.84 1.32 1.62v1.69c0 .97-.78 1.75-1.75 1.75H14.5C7.6 17.5 2.5 12.4 2.5 5.5v-1.25z" />
                    </svg>
                    (623) 900-1188
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window === 'undefined') return
                      window.dispatchEvent(
                        new CustomEvent('xdipx:emma:openWith', {
                          detail: {
                            prompt: "Hi Emma! I could use a hand finding what I'm looking for.",
                          },
                        }),
                      )
                    }}
                    className="inline-flex items-center gap-1.5 underline decoration-[1.5px] underline-offset-[3px] hover:opacity-80"
                    style={{ color: 'var(--color-coral)', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: '13.5px' }}
                  >
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2.5 4.5A1.5 1.5 0 014 3h12a1.5 1.5 0 011.5 1.5v9A1.5 1.5 0 0116 15H7.41l-3.7 3.05A.6.6 0 012.5 17.6V4.5z" />
                    </svg>
                    Message Emma
                  </button>
                </div>
              </div>
            </div>

            {/* RIGHT — headline (flexes to fill remaining space, text vertically centered) */}
            <div className="flex-1 min-w-0 flex items-center">
              <h2
                className="italic m-0 w-full"
                style={{
                  fontFamily:    'var(--font-display)',
                  fontStyle:     'italic',
                  fontWeight:    500,
                  fontSize:      'clamp(22px, 3.4vw, 56px)',
                  lineHeight:    1.03,
                  letterSpacing: '-0.022em',
                  textWrap:      'balance',
                }}
              >
                {renderHeadlineItalic(copy.headline)}
              </h2>
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
              selected={primaryPicker.selected}
              setSelected={primaryPicker.setSelected}
              swatches={swatches}
              highlightColor={highlightSide === 'primary'}
            />
            <DesktopPairItem
              deal={partner}
              selected={partnerPicker.selected}
              setSelected={partnerPicker.setSelected}
              swatches={swatches}
              highlightColor={highlightSide === 'partner'}
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

      {/* ===== PRICE & BUY STRIP (above carousel) ===== */}
      <div className="px-4">

        {/* ================= MOBILE (price + buy) ================= */}
        <div className="md:hidden">
          <div className="relative bg-paper border border-line border-t-0 border-b-0 px-6 pb-6">
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
                    {fmtPrice(combinedMsrp)}
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
              </div>

              <div className="relative">
                {toastState && (
                  <div
                    key={toastState.nonce}
                    role="status"
                    aria-live="polite"
                    className="float-up-fade absolute bottom-full left-1/2 mb-2 z-10 pointer-events-none whitespace-nowrap"
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
                <button
                  type="submit"
                  form="pair-bundle-form"
                  disabled={isPending}
                  className="w-full inline-flex items-center justify-between gap-2.5 px-5 py-3.5 rounded-full bg-coral text-cream disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{
                    border:     '1.5px solid var(--color-ink)',
                    boxShadow:  '3px 3px 0 var(--color-ink)',
                    fontFamily: 'var(--font-body)',
                    fontWeight: 800,
                    fontSize:   '14.5px',
                  }}
                >
                  <span>{isPending ? 'Adding…' : 'Buy the bundle ♥'}</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px' }}>
                    {fmtPrice(bundlePrice)}
                  </span>
                </button>
              </div>

              <p className="text-[11.5px] text-muted text-center" style={{ fontFamily: 'var(--font-body)' }}>
                Shipping free on this pair · plain packaging · 30-day returns
              </p>
            </div>
          </div>
        </div>

        {/* ================= DESKTOP (buy bar) ================= */}
        <article
          className="hidden md:block relative bg-paper"
          style={{
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
                    {fmtPrice(combinedMsrp)}
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

            </div>

            <div className="flex flex-col gap-2 items-end">
              <div className="relative">
                {toastState && (
                  <div
                    key={toastState.nonce}
                    role="status"
                    aria-live="polite"
                    className="float-up-fade absolute bottom-full left-1/2 mb-3 z-10 pointer-events-none whitespace-nowrap"
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
                  <span>{isPending ? 'Adding…' : "Buy the bundle"}</span>
                  <span style={{ color: 'var(--color-butter)', fontSize: '17px' }}>♥</span>
                </button>
              </div>
            </div>
          </section>
        </article>
      </div>

      {trustBar ? <div className="px-4">{trustBar}</div> : null}

      <PairBundleHeroCarousel
        whyCards={whyCards}
        emmaQuote=""
        momentTitle={copy.momentTitle ?? 'how to make this pair click'}
        moments={copy.moments ?? []}
      />

      {/* ===== BOTTOM HALF (buy bar → signature) ===== */}
      <div className="px-4 pb-8 md:pb-14">

        {/* ================= MOBILE (bottom: emma quote) ================= */}
        <div className="md:hidden">
          <div className="relative bg-paper border border-line border-t-0 p-6">
            {copy.emmaQuote && (
              <div className="text-center">
                <span
                  aria-hidden="true"
                  className="block text-coral leading-none mb-1 select-none"
                  style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 800, fontSize: '44px' }}
                >
                  &ldquo;
                </span>
                <p
                  className="text-ink italic leading-[1.4]"
                  style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: '19px', letterSpacing: '-0.005em' }}
                >
                  {renderWithHighlight(copy.emmaQuote)}
                </p>
                <p className="mt-2.5 text-coral-deep" style={{ fontFamily: 'var(--font-script)', fontSize: '18px' }}>
                  — Emma
                </p>
              </div>
            )}
          </div>

        </div>

        {/* ================= DESKTOP (bottom: emma quote) ================= */}
        <article
          className="hidden md:block relative bg-paper"
          style={{
            boxShadow:    '0 30px 60px -30px rgba(21,18,17,0.2)',
          }}
        >
          {/* ---------- EMMA PULL QUOTE ---------- */}
          {copy.emmaQuote && (
            <section
              className="relative px-10 py-12 bg-paper text-center overflow-hidden"
              style={{ borderTop: '1px dashed var(--color-line-2)' }}
            >
              {primary.images[0] && (
                <Link
                  to={`/products/${primary.handle}`}
                  aria-label={primary.seoTitle}
                  className="hidden lg:block absolute left-8 xl:left-16 top-1/2 -translate-y-1/2 transition-transform duration-300 hover:scale-[1.04] hover:-rotate-1"
                  style={{ transform: 'translateY(-50%) rotate(-4deg)' }}
                >
                  <img
                    src={primary.images[0].url}
                    alt=""
                    className="w-[120px] xl:w-[140px] h-auto"
                    style={{ filter: 'drop-shadow(0 14px 24px rgba(21,18,17,0.18))' }}
                    loading="lazy"
                  />
                </Link>
              )}

              {partner.images[0] && (
                <Link
                  to={`/products/${partner.handle}`}
                  aria-label={partner.seoTitle}
                  className="hidden lg:block absolute right-8 xl:right-16 top-1/2 -translate-y-1/2 transition-transform duration-300 hover:scale-[1.04] hover:rotate-1"
                  style={{ transform: 'translateY(-50%) rotate(4deg)' }}
                >
                  <img
                    src={partner.images[0].url}
                    alt=""
                    className="w-[120px] xl:w-[140px] h-auto"
                    style={{ filter: 'drop-shadow(0 14px 24px rgba(21,18,17,0.18))' }}
                    loading="lazy"
                  />
                </Link>
              )}

              <span
                aria-hidden="true"
                className="block text-coral leading-none mb-2 select-none"
                style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 800, fontSize: '60px' }}
              >
                &ldquo;
              </span>
              <p
                className="text-ink italic leading-[1.35] max-w-3xl mx-auto"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 'clamp(20px, 2.2vw, 28px)', letterSpacing: '-0.01em' }}
              >
                {renderWithHighlight(copy.emmaQuote)}
              </p>
              <p className="mt-5 text-coral-deep" style={{ fontFamily: 'var(--font-script)', fontSize: '22px' }}>
                — Emma
              </p>
              <div aria-hidden="true" className="mt-3 mx-auto h-[2px] w-14 bg-coral" />
            </section>
          )}
        </article>
      </div>

    </section>
  )
}
