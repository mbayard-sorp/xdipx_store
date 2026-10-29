/**
 * Long-form sales page on curious.xdipx.com/<slug>, one product per page.
 * Rendered by app/routes/bridge.$slug.tsx, which owns the consent banner and
 * analytics shell. Words and section order come from the Sanity `salesPage`
 * document (app/lib/sales-page.ts); price, images, variants and stock come
 * from Shopify via the loader. Visual language follows AdventSalesView.
 *
 * Every buy button is a plain POST form back to the route, so it works before
 * hydration. The action builds the cart, stamps attribution and 302s on.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Form } from 'react-router'
import { splitHeadline } from '~/lib/ad-bridge-copy'
import { trackAddToCart, trackBeginCheckout } from '~/lib/analytics.client'
import { showDiscountBadge } from '~/lib/discount-badge'
import { trackFbViewContent } from '~/lib/meta-pixel.client'
import { sanityImageUrl } from '~/lib/sanity-image'
import { shopifyImageUrl } from '~/lib/shopify-image'
import type { SalesImage, SalesPage, SalesSection, SalesTone } from '~/lib/sales-page'

export interface SalesVariant {
  id: string
  title: string
  price: number
  compareAtPrice: number | null
  available: boolean
}

export interface SalesShopifyData {
  productId: string
  title: string
  brand: string
  variants: SalesVariant[]
  images: { url: string; alt: string }[]
  /** Shopify's tracked stock, or null when Shopify is not tracking it. */
  stock: number | null
  /** False when MAP rules forbid showing a struck compare-at price. */
  showCompareAt: boolean
}

export interface SalesViewData {
  page: SalesPage
  shop: SalesShopifyData
  /** With add-ons the buy button leads to them, so begin_checkout waits for the last screen. */
  hasAddOns: boolean
  logo: { src: string; alt: string } | null
  preview: boolean
  error: string | null
}

/** Real stock is shown only when it is low enough to be useful to know. */
const STOCK_LINE_MAX = 20

const CSS = `
[data-sales] details[data-faq] summary::-webkit-details-marker { display: none; }
[data-sales] details[data-faq] summary { list-style: none; }
[data-sales] details[data-faq][open] [data-chev] { transform: rotate(45deg); }
[data-sales] [data-noscroll]::-webkit-scrollbar { display: none; }
`

const wrap = 'mx-auto max-w-[1320px] px-4 sm:px-[clamp(20px,5vw,64px)]'
const section = 'py-14 md:py-[clamp(56px,9vw,104px)]'
const h2 = 'font-display font-normal text-[clamp(1.9rem,4vw,2.9rem)] leading-[1.1] tracking-[-0.01em]'

const TONE_BG: Record<SalesTone, string> = {
  paper: 'bg-paper',
  'paper-2': 'bg-paper-2',
  'plum-soft': 'bg-plum-soft',
  'coral-soft': 'bg-coral-soft',
  ink: 'bg-ink',
}

export const money = (n: number) => '$' + (Number.isInteger(n) ? String(n) : n.toFixed(2))

export function Heading({
  text,
  dark,
  emClass,
  as: Tag = 'h2',
  className,
}: {
  text: string
  dark?: boolean
  emClass?: string
  as?: 'h1' | 'h2'
  className: string
}) {
  const { before, em, after } = splitHeadline(text)
  return (
    <Tag className={className + (dark ? ' text-paper-3' : '')}>
      {before}
      {em ? <span className={'italic ' + (emClass ?? (dark ? 'text-[#C9A2EE]' : 'text-plum'))}>{em}</span> : null}
      {after}
    </Tag>
  )
}

function Kicker({ text, dark, color }: { text: string; dark?: boolean; color?: string }) {
  if (!text) return null
  return <div className={'mb-3.5 font-mono text-[11px] uppercase tracking-[0.18em] ' + (color ?? (dark ? 'text-coral-2' : 'text-ink-4'))}>{text}</div>
}

function sanityImg(img: SalesImage, w: number) {
  return sanityImageUrl(img.url, { w })
}

/**
 * The buy button. A native POST form, so it works before hydration and the
 * server's 302 is followed by the browser directly.
 */
function BuyForm({
  shop,
  variant,
  beginCheckout,
  className,
  children,
}: {
  shop: SalesShopifyData
  variant: SalesVariant | undefined
  beginCheckout: boolean
  className: string
  children: ReactNode
}) {
  const canBuy = !!variant?.available
  return (
    <Form
      method="post"
      reloadDocument
      onSubmit={() => {
        if (!variant) return
        const item = { item_id: shop.productId, item_name: shop.title, item_brand: shop.brand, item_variant: variant.title, price: variant.price, quantity: 1 }
        trackAddToCart(item)
        if (beginCheckout) trackBeginCheckout([item], variant.price)
      }}
    >
      <input type="hidden" name="variantId" value={variant?.id ?? ''} />
      <button type="submit" data-sales-cta disabled={!canBuy} className={className + (canBuy ? '' : ' cursor-not-allowed opacity-50')}>
        {canBuy ? children : 'Sold out'}
      </button>
    </Form>
  )
}

export function SalesPageView({ d }: { d: SalesViewData }) {
  const { page, shop } = d
  const firstAvailable = shop.variants.find(v => v.available) ?? shop.variants[0]
  const [variantId, setVariantId] = useState(firstAvailable?.id ?? '')
  const [img, setImg] = useState(0)

  const variant = shop.variants.find(v => v.id === variantId) ?? firstAvailable
  const price = variant?.price ?? 0
  const compareAt = shop.showCompareAt && variant?.compareAtPrice && variant.compareAtPrice > price ? variant.compareAtPrice : null
  const savePct = compareAt ? Math.round((1 - price / compareAt) * 100) : 0
  const priceStr = money(price)
  const canBuy = !!variant?.available
  const stockLine = canBuy && shop.stock !== null && shop.stock > 0 && shop.stock <= STOCK_LINE_MAX ? shop.stock : null

  // The hero image (when set) leads; the Shopify gallery follows.
  const gallery: { src: (w: number) => string; alt: string }[] = [
    ...(page.heroImage ? [{ src: (w: number) => sanityImg(page.heroImage!, w), alt: page.heroImage.alt || shop.title }] : []),
    ...shop.images.map(i => ({ src: (w: number) => shopifyImageUrl(i.url, w), alt: i.alt || shop.title })),
  ]
  const active = gallery[Math.min(img, Math.max(0, gallery.length - 1))]
  const thumb = shop.images[0]?.url

  useEffect(() => {
    trackFbViewContent({ content_ids: [shop.productId], value: price, currency: 'USD' })
    // Once per page view, not per variant change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.productId])

  const buyBtn =
    'rounded-full bg-coral px-8 py-[17px] font-body text-base font-medium text-white transition hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(194,53,15,0.24)]'
  const cta = page.buttonLabel

  return (
    <div data-sales className="overflow-x-hidden bg-paper font-body text-ink">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {d.preview && !page.live ? (
        <p className="bg-plum-soft px-4 py-2 text-center text-xs text-plum-2">Preview. This page is not live, so visitors see a 404.</p>
      ) : null}

      {page.announcement ? (
        <div className="bg-ink px-4 py-2.5 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[#C9BCC4]">{page.announcement}</div>
      ) : null}

      <header className={wrap + ' flex items-center justify-between gap-6 py-5'}>
        {d.logo ? (
          <img src={d.logo.src} alt={d.logo.alt} width={149} height={60} className="block h-7 w-auto sm:h-8" />
        ) : (
          <div className="text-[22px] font-semibold tracking-[0.02em]">xdipx</div>
        )}
        <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-4">Ships discreet</div>
      </header>

      {d.error ? (
        <p role="alert" className={wrap + ' mb-4'}>
          <span className="block rounded-[14px] bg-coral-soft px-4 py-3 text-sm text-ink">{d.error}</span>
        </p>
      ) : null}

      {/* HERO */}
      <section data-screen-label="Hero" className={wrap + ' flex flex-wrap items-start gap-8 pb-12 pt-3 md:gap-[clamp(32px,5vw,72px)] md:pb-[clamp(48px,7vw,88px)]'}>
        <div className="flex min-w-[280px] flex-[1_1_440px] flex-col gap-3">
          <div className="relative aspect-square w-full overflow-hidden rounded-[22px] bg-paper-3 shadow-[inset_0_0_0_1px_rgba(26,20,24,0.05)]">
            {showDiscountBadge(savePct) ? (
              <div className="absolute left-4 top-4 z-[1] whitespace-nowrap rounded-full bg-coral px-4 py-[9px] text-[15px] font-semibold text-white shadow-[0_6px_18px_rgba(194,53,15,0.28)]">
                Save {savePct}%
              </div>
            ) : null}
            {active ? (
              // The LCP element: eager, high priority, explicit size, never in Reveal.
              <img
                src={active.src(750)}
                alt={active.alt}
                width={750}
                height={750}
                loading="eager"
                fetchPriority="high"
                className="block h-full w-full object-cover"
              />
            ) : null}
          </div>
          {gallery.length > 1 ? (
            <div data-noscroll className="flex gap-2.5 overflow-x-auto p-0.5 [scrollbar-width:none]">
              {gallery.map((g, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setImg(i)}
                  aria-label={`Image ${i + 1}`}
                  className={'h-[76px] w-[76px] flex-none overflow-hidden rounded-[14px] border-2 bg-paper-3 p-0 ' + (i === img ? 'border-ink' : 'border-transparent')}
                >
                  <img src={g.src(160)} alt="" width={76} height={76} loading="lazy" className="block h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex min-w-[280px] flex-[1_1_400px] flex-col gap-[22px] md:pt-6">
          <div>
            <Kicker text={page.kicker} />
            <Heading as="h1" text={page.headline} className="mb-3.5 font-display text-[clamp(2.2rem,5vw,3.4rem)] font-normal leading-[1.06] tracking-[-0.015em]" />
            <div className="text-[15px] leading-normal text-ink-3">{shop.title}</div>
          </div>
          <p className="font-display text-[1.3rem] leading-[1.45]">{page.subhead}</p>

          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-[30px] font-semibold">{priceStr}</span>
            {compareAt ? (
              <>
                <s className="text-lg text-ink-4">{money(compareAt)}</s>
                <span className="rounded-full border border-coral/35 px-2.5 py-[5px] font-mono text-[11px] uppercase tracking-[0.12em] text-coral">
                  You save {money(Math.round((compareAt - price) * 100) / 100)}
                </span>
              </>
            ) : null}
          </div>

          {shop.variants.length > 1 ? (
            <fieldset>
              <legend className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-4">Pick yours</legend>
              <div className="flex flex-wrap gap-2">
                {shop.variants.map(v => (
                  <button
                    key={v.id}
                    type="button"
                    disabled={!v.available}
                    aria-pressed={v.id === variant?.id}
                    onClick={() => setVariantId(v.id)}
                    className={
                      'min-h-11 rounded-full border px-4 text-sm ' +
                      (v.id === variant?.id ? 'border-ink bg-ink text-paper' : 'border-ink/15 bg-paper text-ink') +
                      (v.available ? '' : ' cursor-not-allowed line-through opacity-50')
                    }
                  >
                    {v.title}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          {stockLine !== null ? <div className="text-[13.5px] font-semibold text-coral">Only {stockLine} left</div> : null}

          <BuyForm shop={shop} variant={variant} beginCheckout={!d.hasAddOns} className={buyBtn + ' w-full sm:w-auto'}>{cta}</BuyForm>

          <div className="flex flex-col gap-2.5 border-t border-line pt-5 text-sm text-ink-3">
            {page.heroPoints.map(pt => (
              <div key={pt} className="flex gap-[9px]">
                <span className="text-sage">♥</span> {pt}
              </div>
            ))}
            <div className="flex gap-[9px]">
              <span className="text-sage">♥</span> Plain box, plain label. Your statement reads XDIPX
            </div>
          </div>
        </div>
      </section>

      {page.sections.map(s => (
        <Section
          key={s.key}
          s={s}
          renderBuy={className => (
            <BuyForm shop={shop} variant={variant} beginCheckout={!d.hasAddOns} className={className}>
              {cta} · {priceStr}
            </BuyForm>
          )}
        />
      ))}

      {/* FINAL CTA */}
      <section data-screen-label="Final CTA" className="bg-ink">
        <div className={wrap + ' py-[72px] text-center md:py-[clamp(72px,11vw,128px)]'}>
          <Heading
            text={page.closer}
            dark
            className="mx-auto mb-[34px] max-w-[20ch] font-display text-[clamp(2.1rem,5vw,3.6rem)] font-normal leading-[1.12] tracking-[-0.01em]"
          />
          <div className="flex justify-center">
            <BuyForm shop={shop} variant={variant} beginCheckout={!d.hasAddOns} className={buyBtn}>
              {cta} · {priceStr}
            </BuyForm>
          </div>
          {page.closerLine ? <div className="mx-auto mt-4 max-w-[52ch] text-sm text-[#C9BCC4]">{page.closerLine}</div> : null}
        </div>
      </section>

      {/* Pinned buy bar, server-rendered and always on, so it never waits on JS. */}
      <div data-sticky-buy className="fixed inset-x-0 bottom-0 z-20 border-t border-ink/10 bg-paper/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(26,20,24,0.08)] backdrop-blur-[10px]">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-3 px-4 py-3 sm:gap-5 sm:px-[clamp(16px,5vw,64px)]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-11 w-11 flex-none overflow-hidden rounded-[10px] bg-paper-3">
              {thumb ? <img src={shopifyImageUrl(thumb, 96)} alt="" className="block h-full w-full object-cover" /> : null}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                {priceStr}
                {compareAt ? <s className="ml-2 font-normal text-ink-4">{money(compareAt)}</s> : null}
              </div>
              {stockLine !== null ? <div className="text-[12.5px] font-semibold text-coral">{stockLine} left</div> : null}
            </div>
          </div>
          <BuyForm shop={shop} variant={variant} beginCheckout={!d.hasAddOns} className="whitespace-nowrap rounded-full bg-coral px-5 py-[13px] text-[15px] font-medium text-white sm:px-[26px]">{cta}</BuyForm>
        </div>
      </div>

      <footer className={wrap + ' flex flex-wrap justify-between gap-x-7 gap-y-3 pb-24 pt-8 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-4'}>
        <span>© 2026 xdipx · You must be 18 or older to shop.</span>
        <span>Plain packaging · Billed as XDIPX</span>
      </footer>
    </div>
  )
}

function Section({ s, renderBuy }: { s: SalesSection; renderBuy: (className: string) => ReactNode }) {
  const dark = s.tone === 'ink'
  const body = 'text-[16.5px] leading-[1.65] ' + (dark ? 'text-[#C9BCC4]' : 'text-ink-3')
  const card = 'rounded-[22px] p-6 md:p-7 ' + (dark ? 'border border-paper-3/10 bg-[#261E23]' : 'bg-paper')

  if (s.type === 'buyBand') {
    return (
      <section data-screen-label="Buy band" className="bg-coral">
        <div className={wrap + ' flex flex-wrap items-center justify-between gap-x-14 gap-y-7 py-12 text-white md:py-[clamp(48px,7vw,80px)]'}>
          <div className="flex-[1_1_440px]">
            <Kicker text={s.kicker} color="text-white" />
            <Heading text={s.heading} emClass="" className="mb-3 font-display text-[clamp(2rem,4.5vw,3.2rem)] font-normal leading-[1.08] tracking-[-0.01em]" />
            {s.body ? <p className="max-w-[52ch] text-[16.5px] leading-[1.6]">{s.body}</p> : null}
          </div>
          {renderBuy('rounded-full bg-ink px-8 py-[17px] text-base font-medium text-white transition hover:-translate-y-0.5')}
        </div>
      </section>
    )
  }

  if (s.type === 'image') {
    return (
      <figure data-screen-label="Image" className={wrap + ' py-8'}>
        <img
          src={sanityImg(s.image, 1320)}
          srcSet={`${sanityImg(s.image, 640)} 640w, ${sanityImg(s.image, 1000)} 1000w, ${sanityImg(s.image, 1320)} 1320w`}
          sizes="(min-width: 1320px) 1320px, 100vw"
          alt={s.image.alt}
          loading="lazy"
          decoding="async"
          className="block h-auto w-full rounded-[22px] bg-paper-3"
        />
        {s.caption ? <figcaption className="mt-3 text-center text-sm text-ink-4">{s.caption}</figcaption> : null}
      </figure>
    )
  }

  return (
    <section data-screen-label={s.type} className={TONE_BG[s.tone]}>
      <div className={(s.type === 'faq' ? 'mx-auto max-w-[820px] px-4 sm:px-[clamp(20px,5vw,64px)] ' : wrap + ' ') + section}>
        {s.type === 'story' ? (
          <div className="flex flex-wrap items-center gap-8 md:gap-[clamp(32px,5vw,72px)]">
            <div className="max-w-[60ch] flex-[1_1_420px]">
              <Kicker text={s.kicker} dark={dark} />
              {s.heading ? <Heading text={s.heading} dark={dark} className={h2 + ' mb-[18px]'} /> : null}
              <div className="flex flex-col gap-[18px]">
                {s.paragraphs.map((p, i) => (
                  <p key={i} className={body}>
                    {p}
                  </p>
                ))}
              </div>
            </div>
            {s.image ? (
              <div className="flex-[1_1_360px] overflow-hidden rounded-[22px] bg-paper-3">
                <img src={sanityImg(s.image, 800)} alt={s.image.alt} loading="lazy" decoding="async" className="block h-auto w-full" />
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <Kicker text={s.kicker} dark={dark} />
            <Heading text={s.heading} dark={dark} className={h2 + ' mb-9 max-w-[22ch]'} />
            {s.type === 'features' ? (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3.5">
                {s.items.map(f => (
                  <div key={f.label + f.value} className={card}>
                    <div className={'mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] ' + (dark ? 'text-[#C9BCC4]' : 'text-ink-4')}>{f.label}</div>
                    <div className={'font-display text-[1.25rem] leading-[1.3] ' + (dark ? 'text-paper-3' : '')}>{f.value}</div>
                  </div>
                ))}
              </div>
            ) : s.type === 'steps' ? (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,230px),1fr))] gap-x-6 gap-y-7">
                {s.steps.map((st, i, a) => (
                  <div key={st.title} className={'border-t-2 pt-5 ' + (i === a.length - 1 ? 'border-plum' : dark ? 'border-paper-3/20' : 'border-ink/12')}>
                    <div className={'mb-3 font-mono text-[11px] uppercase tracking-[0.16em] ' + (dark ? 'text-[#C9A2EE]' : 'text-plum')}>{st.label || `Step ${i + 1}`}</div>
                    <h3 className={'mb-2.5 font-display text-[1.45rem] font-normal leading-[1.2] ' + (dark ? 'text-paper-3' : '')}>{st.title}</h3>
                    <p className={'text-[15.5px] leading-[1.65] ' + (dark ? 'text-[#C9BCC4]' : 'text-ink-3')}>{st.body}</p>
                  </div>
                ))}
              </div>
            ) : s.type === 'comparison' ? (
              <div>
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className={'font-mono text-[10.5px] uppercase tracking-[0.14em] ' + (dark ? 'text-[#C9BCC4]' : 'text-ink-4')}>
                      <th className="py-3 pr-4 font-normal" />
                      <th className={'rounded-t-[14px] px-3 py-3 font-medium md:px-4 ' + (dark ? 'bg-[#261E23] text-paper-3' : 'bg-white/60 text-plum')}>{s.usLabel}</th>
                      <th className="px-3 py-3 font-normal md:px-4">{s.themLabel}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.rows.map(r => (
                      <tr key={r.feature} className={'border-t ' + (dark ? 'border-paper-3/10' : 'border-ink/10')}>
                        <th scope="row" className={'py-4 pr-3 text-sm font-medium md:pr-4 ' + (dark ? 'text-paper-3' : '')}>{r.feature}</th>
                        <td className={'px-3 py-4 text-[15px] md:px-4 ' + (dark ? 'bg-[#261E23] text-paper-3' : 'bg-white/60')}>{r.us}</td>
                        <td className={'px-3 py-4 text-[15px] md:px-4 ' + (dark ? 'text-[#C9BCC4]' : 'text-ink-3')}>{r.them}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : s.type === 'proof' ? (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-[18px]">
                {s.reviews.map(r => (
                  <figure key={r.quote} className={card}>
                    <blockquote className={'font-display text-[1.2rem] leading-[1.45] ' + (dark ? 'text-paper-3' : '')}>“{r.quote}”</blockquote>
                    <figcaption className={'mt-4 font-mono text-[10.5px] uppercase tracking-[0.14em] ' + (dark ? 'text-[#C9BCC4]' : 'text-ink-4')}>
                      {r.name || 'Verified buyer'}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : s.type === 'faq' ? (
              <div>
                {s.items.map(q => (
                  <details key={q.q} data-faq className={'border-t ' + (dark ? 'border-paper-3/15' : 'border-ink/10')}>
                    <summary className={'flex cursor-pointer items-center justify-between gap-5 py-6 font-display text-[1.3rem] ' + (dark ? 'text-paper-3' : '')}>
                      {q.q}
                      <span data-chev className="text-2xl leading-none text-ink-4 transition-transform duration-300">
                        +
                      </span>
                    </summary>
                    <p className={'max-w-[60ch] pb-[26px] ' + body}>{q.a}</p>
                  </details>
                ))}
                <div className={'border-t ' + (dark ? 'border-paper-3/15' : 'border-ink/10')} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}
