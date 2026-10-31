/**
 * One add-on screen on a sales page (curious.xdipx.com/<slug>?addon=<step>).
 * Shown after a buy button, before checkout: one accessory, a take-it button
 * and a plain no-thanks. Rendered by app/routes/bridge.$slug.tsx, which owns
 * the cart cookie and the redirects; both buttons are native POST forms, so
 * they work before hydration.
 */

import { useState } from 'react'
import { Form } from 'react-router'
import { trackAddToCart, trackBeginCheckout } from '~/lib/analytics.client'
import { shopifyImageUrl } from '~/lib/shopify-image'
import { bulkUnitPrice, type SalesAddOn } from '~/lib/sales-page'
import { Heading, money, type SalesShopifyData } from './SalesPageView'

export interface SalesAddOnViewData {
  step: number
  /** Buyable add-ons on this page, and this screen's place among them. */
  total: number
  position: number
  isLast: boolean
  addOn: SalesAddOn
  /** What this screen sells: one product, or good, better, best tiers. */
  options: { handle: string; label: string; blurb: string; shop: SalesShopifyData }[]
  /** The option selected when the screen opens. */
  selected: number
  cart: { items: { title: string; image: string | null }[]; subtotal: number }
  logo: { src: string; alt: string } | null
  error: string | null
}

export function SalesAddOnView({ d }: { d: SalesAddOnViewData }) {
  const [optionIndex, setOptionIndex] = useState(d.selected)
  const [quantity, setQuantity] = useState(1)
  const option = d.options[optionIndex] ?? d.options[0]!
  const { shop } = option
  const firstAvailable = shop.variants.find(v => v.available) ?? shop.variants[0]
  const [variantId, setVariantId] = useState(firstAvailable?.id ?? '')
  const variant = shop.variants.find(v => v.id === variantId) ?? firstAvailable
  const price = variant?.price ?? 0
  const compareAt = shop.showCompareAt && variant?.compareAtPrice && variant.compareAtPrice > price ? variant.compareAtPrice : null
  const offer = d.addOn.bulkOffers.find(o => o.quantity === quantity)
  const unit = offer ? bulkUnitPrice(price, offer.percent) : price
  const total = Math.round(unit * quantity * 100) / 100
  const image = shop.images[0]
  const item = { item_id: shop.productId, item_name: shop.title, item_brand: shop.brand, ...(variant ? { item_variant: variant.title } : {}), price: unit, quantity }
  // Shopify lists the newest line first, so the page's own product is the last one.
  const added = d.cart.items[d.cart.items.length - 1]

  return (
    <div data-sales-addon className="flex min-h-[100svh] flex-col bg-paper font-body text-ink">
      <header className="mx-auto flex w-full max-w-[640px] items-center justify-between gap-6 px-4 py-5">
        {d.logo ? (
          <img src={d.logo.src} alt={d.logo.alt} width={149} height={60} className="block h-7 w-auto" />
        ) : (
          <div className="text-[22px] font-semibold tracking-[0.02em]">xdipx</div>
        )}
        {d.total > 1 ? (
          <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-4">
            {d.position} of {d.total}
          </div>
        ) : null}
      </header>

      <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-5 px-4 pb-10">
        {added ? (
          <div role="status" className="flex items-center gap-3 rounded-[18px] bg-paper-2 px-4 py-3">
            <div className="h-11 w-11 flex-none overflow-hidden rounded-[10px] bg-paper-3">
              {added.image ? <img src={shopifyImageUrl(added.image, 96)} alt="" className="block h-full w-full object-cover" /> : null}
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <div className="flex justify-between gap-3 font-semibold">
                <span className="text-sage">♥ In your bag</span>
                <span>{money(d.cart.subtotal)}</span>
              </div>
              <div className="truncate text-ink-3">{[...d.cart.items].reverse().map(i => i.title).join(', ')}</div>
            </div>
          </div>
        ) : null}

        {d.error ? (
          <p role="alert" className="rounded-[14px] bg-coral-soft px-4 py-3 text-sm text-ink">
            {d.error}
          </p>
        ) : null}

        <div className="aspect-square w-full overflow-hidden rounded-[22px] bg-paper-3">
          {image ? (
            <img
              src={shopifyImageUrl(image.url, 750)}
              alt={image.alt || shop.title}
              width={750}
              height={750}
              loading="eager"
              fetchPriority="high"
              className="block h-full w-full object-cover"
            />
          ) : null}
        </div>

        <div>
          <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-4">One more thing</div>
          <Heading
            as="h1"
            text={d.addOn.headline || shop.title}
            className="mb-2 font-display text-[clamp(1.9rem,6vw,2.6rem)] font-normal leading-[1.08] tracking-[-0.01em]"
          />
          {d.addOn.headline && d.options.length === 1 ? <div className="text-[15px] text-ink-3">{shop.title}</div> : null}
        </div>

        <p className="text-[16.5px] leading-[1.6] text-ink-2">{d.addOn.pitch}</p>

        {d.options.length > 1 ? (
          <fieldset data-addon-tiers className="flex flex-col gap-2.5">
            <legend className="sr-only">Pick one</legend>
            {d.options.map((o, i) => {
              const v = o.shop.variants.find(x => x.available) ?? o.shop.variants[0]
              const on = i === optionIndex
              return (
                <button
                  key={o.handle}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setOptionIndex(i)}
                  className={
                    'grid min-h-[64px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border-2 px-4 py-3 text-left ' +
                    (on ? 'border-plum bg-plum-soft' : 'border-ink/12 bg-paper')
                  }
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-[10.5px] uppercase tracking-[0.14em] text-plum">{o.label}</span>
                    <span className="mt-0.5 block text-[15px] font-medium leading-snug">{o.shop.title}</span>
                    {o.blurb ? <span className="mt-0.5 block text-[13.5px] leading-snug text-ink-3">{o.blurb}</span> : null}
                  </span>
                  <span className="text-base font-semibold">{v ? money(v.price) : ''}</span>
                </button>
              )
            })}
          </fieldset>
        ) : (
          <div className="flex items-baseline gap-3">
            <span className="text-[26px] font-semibold">{money(price)}</span>
            {compareAt ? <s className="text-lg text-ink-4">{money(compareAt)}</s> : null}
          </div>
        )}

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

        {d.addOn.bulkOffers.length ? (
          <fieldset data-addon-bulk>
            <legend className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-4">{d.addOn.bulkLine || 'The more you take, the better the price'}</legend>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-2">
              {[{ quantity: 1, percent: 0 }, ...d.addOn.bulkOffers].map(o => {
                const on = o.quantity === quantity
                return (
                  <button
                    key={o.quantity}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setQuantity(o.quantity)}
                    className={'min-h-[64px] rounded-[14px] border-2 px-2 py-2 text-center ' + (on ? 'border-plum bg-plum-soft' : 'border-ink/12 bg-paper')}
                  >
                    <span className="block text-[15px] font-semibold">{o.quantity === 1 ? '1 bottle' : `${o.quantity} bottles`}</span>
                    <span className="block text-[13px] text-ink-3">{money(bulkUnitPrice(price, o.percent))} each</span>
                    {o.percent ? <span className="block text-[12.5px] font-semibold text-coral">{o.percent}% off</span> : null}
                  </button>
                )
              })}
            </div>
          </fieldset>
        ) : null}

        <div className="mt-2 flex flex-col gap-3">
          <Form
            method="post"
            reloadDocument
            onSubmit={() => {
              trackAddToCart(item)
              if (d.isLast) trackBeginCheckout([item], d.cart.subtotal + total)
            }}
          >
            <input type="hidden" name="intent" value="addon" />
            <input type="hidden" name="step" value={d.step} />
            <input type="hidden" name="take" value="1" />
            <input type="hidden" name="variantId" value={variant?.id ?? ''} />
            <input type="hidden" name="quantity" value={quantity} />
            <button
              type="submit"
              data-addon-take
              disabled={!variant?.available}
              className="min-h-[56px] w-full rounded-full bg-coral px-8 text-base font-medium text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              I'll take it ♥ · {money(total)}
            </button>
          </Form>
          <Form
            method="post"
            reloadDocument
            onSubmit={() => {
              if (d.isLast) trackBeginCheckout([], d.cart.subtotal)
            }}
          >
            <input type="hidden" name="intent" value="addon" />
            <input type="hidden" name="step" value={d.step} />
            <input type="hidden" name="take" value="0" />
            <button type="submit" data-addon-skip className="min-h-12 w-full rounded-full px-6 text-[15px] text-ink-3 underline-offset-4 hover:underline">
              {d.isLast ? 'No thanks, take me to checkout' : 'No thanks'}
            </button>
          </Form>
        </div>

        <p className="mt-auto pt-6 text-center font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-4">
          Plain box · Billed as XDIPX
        </p>
      </main>
    </div>
  )
}
