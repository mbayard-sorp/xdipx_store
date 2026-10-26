/**
 * The 2026 advent calendar sales page (curious.xdipx.com/advents26), ported
 * from the Claude Design "xdipx Sales Page Template" and its mobile frame.
 * Rendered by app/routes/bridge.$slug.tsx, which owns the age gate, consent
 * banner and analytics shell. Copy lives in app/lib/advent-sales-page.ts;
 * price, images, stock and the variant come from Shopify via the loader.
 *
 * Every buy button is a plain POST form back to this route. The action builds
 * a one-line Shopify cart and 302s straight to its checkout, so the visitor
 * goes from the button to checkout in one step, before or after hydration.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Form } from 'react-router'
import {
  ADVENT_ANNOUNCEMENT,
  ADVENT_CALENDARS,
  ADVENT_COUPLE_IDEAS,
  ADVENT_FAQ,
  ADVENT_ORDER,
  ADVENT_SALE_ENDS_AT,
  ADVENT_SHIP_BY,
  ADVENT_SOLO_IDEAS,
  adventRitual,
  money,
  type AdventCalendar,
  type AdventIdea,
  type AdventKey,
} from '~/lib/advent-sales-page'
import { trackAddToCart, trackBeginCheckout, trackCtaClick } from '~/lib/analytics.client'
import { trackFbViewContent } from '~/lib/meta-pixel.client'
import { shopifyImageUrl } from '~/lib/shopify-image'

export interface AdventShopifyData {
  handle: string
  productId: string
  variantId: string | null
  price: number
  compareAtPrice: number | null
  images: string[]
  /** Shopify's tracked stock, or null when Shopify is not tracking it. */
  stock: number | null
  available: boolean
}

export interface AdventViewData {
  initial: AdventKey
  products: Partial<Record<AdventKey, AdventShopifyData>>
  nowMs: number
  error: string | null
}

const BULBS = ['#C2350F', '#596756', '#C9A2EE', '#F2C94C']

const CSS = `
@keyframes xd-twinkle { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes xd-snow { 0% { transform: translate3d(0,-10vh,0); } 100% { transform: translate3d(var(--drift),110vh,0); } }
[data-advent] details[data-faq] summary::-webkit-details-marker { display: none; }
[data-advent] details[data-faq] summary { list-style: none; }
[data-advent] details[data-faq][open] [data-chev] { transform: rotate(45deg); }
[data-advent] [data-noscroll]::-webkit-scrollbar { display: none; }
@media (prefers-reduced-motion: reduce) { [data-advent] [data-anim] { animation: none !important; } }
`

const wrap = 'mx-auto max-w-[1320px] px-4 sm:px-[clamp(20px,5vw,64px)]'
const section = 'py-14 md:py-[clamp(56px,9vw,104px)]'
const kicker = 'font-mono text-[11px] uppercase tracking-[0.18em] text-ink-4'
const h2 = 'font-display font-normal text-[clamp(1.9rem,4vw,2.9rem)] leading-[1.1] tracking-[-0.01em]'
const accent = 'italic text-plum'

function Lights() {
  const d = Array.from({ length: 21 }, (_, i) => (i ? `Q${i * 50 - 25} 14 ` : 'M') + `${i * 50} 2`).join(' ')
  return (
    <div aria-hidden className="relative h-[30px] overflow-hidden bg-paper">
      <svg width="100%" height="14" preserveAspectRatio="none" viewBox="0 0 1000 14" className="absolute left-0 top-0 block">
        <path d={d} fill="none" stroke="rgba(26,20,24,0.25)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute inset-0 flex justify-around">
        {Array.from({ length: 40 }, (_, i) => (
          <span
            key={i}
            data-anim
            style={{
              width: 7,
              height: 11,
              marginTop: i % 2 ? 10 : 6,
              borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
              background: BULBS[i % 4],
              boxShadow: `0 0 10px ${BULBS[i % 4]}`,
              animation: `xd-twinkle ${1.8 + (i % 5) * 0.4}s ease-in-out ${((i * 0.37) % 2).toFixed(2)}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

function Snow() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: 46 }, (_, i) => {
        const s = 2 + ((i * 7) % 5)
        return (
          <span
            key={i}
            data-anim
            style={
              {
                position: 'absolute',
                top: 0,
                left: `${(i * 37) % 100}%`,
                width: s,
                height: s,
                borderRadius: '50%',
                background: `rgba(244,243,241,${0.25 + (i % 4) * 0.12})`,
                '--drift': `${(i % 2 ? 1 : -1) * (10 + ((i * 13) % 30))}px`,
                animation: `xd-snow ${9 + ((i * 3) % 9)}s linear -${((i * 1.7) % 14).toFixed(1)}s infinite`,
              } as React.CSSProperties
            }
          />
        )
      })}
    </div>
  )
}

function useCountdown(initialNow: number) {
  const [now, setNow] = useState(initialNow)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const end = new Date(ADVENT_SALE_ENDS_AT).getTime()
  const ms = Math.max(0, end - now)
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = Math.floor(ms / 864e5)
  const h = Math.floor(ms / 36e5) % 24
  const m = Math.floor(ms / 6e4) % 60
  const s = Math.floor(ms / 1e3) % 60
  return {
    live: ms > 0,
    units: [
      { v: pad(d), l: 'days' },
      { v: pad(h), l: 'hrs' },
      { v: pad(m), l: 'min' },
      { v: pad(s), l: 'sec' },
    ],
    short: `${d}d ${pad(h)}h ${pad(m)}m`,
    endLabel: new Date(end).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' }),
  }
}

function Timer({ units, big = false }: { units: { v: string; l: string }[]; big?: boolean }) {
  return (
    <div className="flex gap-1.5" role="timer" aria-label="Time left at the advent price">
      {units.map(u => (
        <div
          key={u.l}
          className={
            'rounded-[10px] bg-ink text-center text-paper-3 ' + (big ? 'min-w-16 px-2 pb-2 pt-2.5' : 'min-w-[52px] px-1.5 pb-1.5 pt-[7px]')
          }
        >
          <div className={'font-mono font-medium leading-[1.1] ' + (big ? 'text-2xl' : 'text-lg')}>{u.v}</div>
          <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#C9BCC4]">{u.l}</div>
        </div>
      ))}
    </div>
  )
}

/**
 * The buy button. A native POST form, so it works before hydration and the
 * server's 302 to Shopify checkout is followed by the browser directly.
 */
function BuyForm({
  cal,
  shop,
  className,
  children,
}: {
  cal: AdventCalendar
  shop: AdventShopifyData | undefined
  className: string
  children: ReactNode
}) {
  const canBuy = !!shop?.available && !!shop.variantId
  return (
    <Form
      method="post"
      reloadDocument
      onSubmit={() => {
        if (!shop) return
        const item = { item_id: shop.productId, item_name: cal.title, item_brand: cal.brands.join(', '), price: shop.price, quantity: 1 }
        trackAddToCart(item)
        trackBeginCheckout([item], shop.price)
      }}
    >
      <input type="hidden" name="handle" value={cal.handle} />
      <button type="submit" disabled={!canBuy} className={className + (canBuy ? '' : ' cursor-not-allowed opacity-50')}>
        {canBuy ? children : 'Sold out for 2026'}
      </button>
    </Form>
  )
}

function IdeaCard({ idea, dark }: { idea: AdventIdea; dark: boolean }) {
  const cal = ADVENT_CALENDARS[idea.key]
  return (
    <article
      className={
        'flex flex-col gap-4 rounded-[22px] p-[30px] ' + (dark ? 'border border-paper-3/10 bg-[#261E23]' : 'bg-paper')
      }
    >
      <div className={'font-mono text-[10.5px] uppercase leading-[1.6] tracking-[0.14em] ' + (dark ? 'text-[#C9BCC4]' : 'text-ink-4')}>
        {idea.label}
        <br />
        {cal.short} {cal.days}-day
      </div>
      <h3 className={'font-display text-[1.55rem] font-normal leading-[1.25] ' + (dark ? 'text-paper-3' : '')}>{idea.title}</h3>
      {idea.body.map((p, i) => (
        <p key={i} className={'text-[15.5px] leading-[1.7] ' + (dark ? 'text-[#C9BCC4]' : 'text-ink-3')}>
          {p}
        </p>
      ))}
    </article>
  )
}

export function AdventSalesView({ d }: { d: AdventViewData }) {
  const [key, setKey] = useState<AdventKey>(d.initial)
  const [img, setImg] = useState(0)
  const timer = useCountdown(d.nowMs)

  const p = ADVENT_CALENDARS[key]
  const shop = d.products[key]
  const gallery = shop?.images.length ? shop.images : []
  const active = gallery[Math.min(img, Math.max(0, gallery.length - 1))]
  const price = shop?.price ?? 0
  const valuePct = Math.round((1 - price / p.value) * 100)
  const priceStr = money(price)
  const valueStr = money(p.value)
  const saveStr = money(Math.round((p.value - price) * 100) / 100)
  const stock = shop?.stock ?? null
  const stockLine = shop?.available && stock !== null && stock > 0 ? stock : null

  useEffect(() => {
    if (shop) trackFbViewContent({ content_ids: [shop.productId], value: shop.price, currency: 'USD' })
  }, [shop])

  function pick(k: AdventKey) {
    setKey(k)
    setImg(0)
    trackCtaClick('advent_lineup', k)
    const url = new URL(window.location.href)
    url.searchParams.set('c', k)
    window.history.replaceState(window.history.state, '', url)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const buyBtn = 'rounded-full bg-coral px-8 py-[17px] font-body text-base font-medium text-white transition hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(194,53,15,0.24)]'
  const cta = "I'll take it ♥"

  const doors = Array.from({ length: p.days }, (_, i) => {
    const last = i === p.days - 1
    const rib = last ? 'rgba(255,255,255,0.28)' : 'rgba(194,53,15,0.16)'
    const base = last ? '#7A2BB8' : '#FFFFFF'
    return {
      n: i + 1,
      last,
      bg: `linear-gradient(90deg, transparent 45%, ${rib} 45%, ${rib} 55%, transparent 55%), linear-gradient(transparent 45%, ${rib} 45%, ${rib} 55%, transparent 55%), ${base}`,
    }
  })

  const lineup = [...ADVENT_ORDER].sort((a, b) => (d.products[b]?.price ?? 0) - (d.products[a]?.price ?? 0))

  return (
    <div data-advent className="overflow-x-hidden bg-paper font-body text-ink">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="bg-ink px-4 py-2.5 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[#C9BCC4]">
        {ADVENT_ANNOUNCEMENT}
      </div>
      <Lights />

      <header className={wrap + ' flex items-center justify-between gap-6 py-5'}>
        <div className="text-[22px] font-semibold tracking-[0.02em]">xdipx</div>
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
            <div className="absolute -right-[58px] top-[30px] z-[1] w-[230px] rotate-45 border-y border-dashed border-white/45 bg-plum py-2 text-center font-mono text-[10.5px] uppercase tracking-[0.2em] text-white shadow-[0_4px_12px_rgba(26,20,24,0.18)]">
              Holiday 2026
            </div>
            <div className="absolute left-4 top-4 z-[1] whitespace-nowrap rounded-full bg-coral px-4 py-[9px] text-[15px] font-semibold text-white shadow-[0_6px_18px_rgba(194,53,15,0.28)]">
              Save {valuePct}%
            </div>
            {active ? (
              // The LCP element: eager, high priority, explicit size, never in Reveal.
              <img
                src={shopifyImageUrl(active, 750)}
                alt={p.title}
                width={750}
                height={750}
                loading="eager"
                fetchPriority="high"
                className="block h-full w-full object-cover"
              />
            ) : null}
          </div>
          <div data-noscroll className="flex gap-2.5 overflow-x-auto p-0.5 [scrollbar-width:none]">
            {gallery.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => setImg(i)}
                aria-label={`Image ${i + 1}`}
                className={'h-[76px] w-[76px] flex-none overflow-hidden rounded-[14px] border-2 bg-paper-3 p-0 ' + (i === img ? 'border-ink' : 'border-transparent')}
              >
                <img src={shopifyImageUrl(src, 160)} alt="" width={76} height={76} loading="lazy" className="block h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-w-[280px] flex-[1_1_400px] flex-col gap-[22px] md:pt-6">
          <div className="flex flex-wrap items-center gap-2">
            {p.brands.map(b => (
              <span key={b} className="rounded-full border border-ink/12 px-[11px] py-[5px] font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
                {b}
              </span>
            ))}
          </div>
          <div>
            <h1 className="mb-3.5 font-display text-[clamp(2.2rem,5vw,3.4rem)] font-normal leading-[1.06] tracking-[-0.015em]">
              {p.headline} <span className={accent}>{p.headlineAccent}</span>
            </h1>
            <div className="text-[15px] leading-normal text-ink-3">{p.title}</div>
          </div>
          <p className="font-display text-[1.3rem] italic leading-[1.4]">{p.tagline}</p>

          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-[30px] font-semibold">{priceStr}</span>
            <span className="rounded-full border border-coral/35 px-2.5 py-[5px] font-mono text-[11px] uppercase tracking-[0.12em] text-coral">
              You save {saveStr}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[18px] bg-plum-soft px-5 py-4">
            <div className="font-display text-[1.25rem] leading-[1.3]">
              Valued at <strong className="font-medium text-plum">{valueStr}</strong> in products. You pay {priceStr}.
            </div>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-plum">{valuePct}% less</span>
          </div>

          {timer.live || stockLine !== null ? (
            <div className="flex flex-col gap-3.5 rounded-[18px] border border-coral/30 px-5 py-[18px]">
              {timer.live ? (
                <div className="flex flex-wrap items-center justify-between gap-x-[18px] gap-y-2.5">
                  <div className="text-sm font-semibold">Advent pricing ends in</div>
                  <Timer units={timer.units} />
                </div>
              ) : null}
              {stockLine !== null ? (
                <div className="text-[13.5px] font-semibold text-coral">Only {stockLine} left at this price</div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <BuyForm cal={p} shop={shop} className={buyBtn}>
              {cta}
            </BuyForm>
            <a href="#emma" className="rounded-full border border-ink/15 px-[22px] py-4 text-[15px] font-medium hover:border-ink/30">
              Find your fit →
            </a>
          </div>

          <div className="flex flex-col gap-2.5 border-t border-line pt-5 text-sm text-ink-3">
            <div className="flex gap-[9px]"><span className="text-sage">♥</span> Ships in plain packaging, no product names on the label</div>
            <div className="flex gap-[9px]"><span className="text-sage">♥</span> Billed as XDIPX</div>
            <div className="flex gap-[9px]"><span className="text-sage">♥</span> Ships before {ADVENT_SHIP_BY} to arrive by Dec 1</div>
          </div>
        </div>
      </section>

      {/* DOORS */}
      <section data-screen-label="Doors" className="bg-paper-2">
        <div className={wrap + ' ' + section + ' flex flex-wrap items-center gap-8 md:gap-[clamp(32px,5vw,72px)]'}>
          <div className="max-w-[440px] flex-[1_1_320px]">
            <div className={kicker + ' mb-4'}>How it works</div>
            <h2 className={h2 + ' mb-[18px]'}>
              {p.days} doors. Open one a <span className={accent}>night</span>.
            </h2>
            <p className="text-[16.5px] leading-[1.65] text-ink-3">{p.ritual}</p>
          </div>
          <div className="grid flex-[1_1_440px] grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2.5">
            {doors.map(door => (
              <div
                key={door.n}
                className={'flex aspect-square items-center justify-center rounded-[14px] border border-line font-display text-2xl ' + (door.last ? 'text-white' : 'text-ink')}
                style={{ background: door.bg }}
              >
                {door.n}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* EMMA'S TAKE */}
      <section id="emma" data-screen-label="Emma's take">
        <div className={wrap + ' ' + section + ' flex flex-wrap gap-8 md:gap-[clamp(32px,5vw,72px)]'}>
          <div className="flex-[1_1_460px]">
            <div className="mb-6 flex items-center gap-[13px]">
              <div className="h-[46px] w-[46px] flex-none rounded-full bg-[#D7C6B8] shadow-[0_0_0_3px_rgba(89,103,86,0.30)]" />
              <div className="leading-[1.35]">
                <div className="text-sm font-semibold">Emma's take</div>
                <div className="text-[13.5px] text-ink-3">Hand-checked, not auto-listed.</div>
              </div>
            </div>
            <div className="flex max-w-[58ch] flex-col gap-[18px]">
              {p.editorial.map((para, i) => (
                <p key={i} className="font-display text-[1.3rem] leading-normal">
                  {para}
                </p>
              ))}
            </div>
          </div>
          <div className="flex flex-[1_1_320px] flex-col gap-4">
            <div className="rounded-[22px] bg-plum-soft p-7">
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-plum">Made for</div>
              <p className="text-base leading-[1.6]">{p.fitFor}</p>
            </div>
            <div className="rounded-[22px] border border-ink/10 p-7">
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-4">Skip it if</div>
              <p className="text-base leading-[1.6] text-ink-3">{p.skipIf}</p>
            </div>
          </div>
        </div>
      </section>

      {/* VALUE MATH */}
      <section data-screen-label="Value" className="bg-paper-2">
        <div className={wrap + ' ' + section}>
          <div className={kicker + ' mb-3.5'}>Do the math</div>
          <h2 className={h2 + ' mb-3.5 max-w-[22ch]'}>
            A whole collection, for the price of <span className={accent}>one</span> good toy.
          </h2>
          <p className="mb-9 max-w-[56ch] text-[16.5px] leading-[1.65] text-ink-3">
            Bought one at a time, everything behind these doors would cost {valueStr}. Here it's one box, one checkout, one plain package.
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3.5">
            {[
              { l: 'Valued at', v: valueStr },
              { l: 'You pay', v: priceStr },
              { l: 'Product behind each door', v: money(Math.round((p.value / p.days) * 100) / 100) },
            ].map(c => (
              <div key={c.l} className="rounded-[22px] border border-line bg-paper p-7">
                <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-4">{c.l}</div>
                <div className="font-display text-[clamp(2.2rem,4vw,3rem)] leading-none">{c.v}</div>
              </div>
            ))}
            <div className="rounded-[22px] bg-coral p-7 text-white">
              <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.16em]">What each night costs you</div>
              <div className="font-display text-[clamp(2.2rem,4vw,3rem)] leading-none">{money(Math.round((price / p.days) * 100) / 100)}</div>
            </div>
          </div>
        </div>
      </section>

      {/* RITUAL */}
      <section data-screen-label="Ritual">
        <div className={wrap + ' ' + section}>
          <div className={kicker + ' mb-3.5'}>What December looks like</div>
          <h2 className={h2 + ' mb-10 max-w-[20ch]'}>
            The countdown becomes the <span className={accent}>best part</span> of your night.
          </h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,230px),1fr))] gap-x-6 gap-y-7">
            {adventRitual(p.days).map((r, i, a) => (
              <div key={r.when} className={'border-t-2 pt-5 ' + (i === a.length - 1 ? 'border-plum' : 'border-ink/12')}>
                <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-plum">{r.when}</div>
                <h3 className="mb-2.5 font-display text-[1.45rem] font-normal leading-[1.2]">{r.title}</h3>
                <p className="text-[15.5px] leading-[1.65] text-ink-3">{r.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOR TWO */}
      <section data-screen-label="Couples stories" className="bg-paper-3">
        <div className={wrap + ' ' + section}>
          <div className={kicker + ' mb-3.5'}>For two</div>
          <h2 className={h2 + ' mb-3.5 max-w-[20ch]'}>
            Ways to make it a <span className={accent}>tradition</span>.
          </h2>
          <p className="mb-10 max-w-[54ch] text-[16.5px] leading-[1.65] text-ink-3">
            Buy it once on a whim. Here's how it tends to stick.
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-[18px]">
            {ADVENT_COUPLE_IDEAS.map(s => (
              <IdeaCard key={s.title} idea={s} dark={false} />
            ))}
          </div>
          <div className="mt-7 text-[12.5px] text-ink-4">Ideas for how to open it, not customer reviews.</div>
        </div>
      </section>

      {/* FOR YOURSELF */}
      <section data-screen-label="Solo stories" className="relative overflow-hidden bg-ink">
        <Snow />
        <div className={wrap + ' ' + section + ' relative'}>
          <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.18em] text-coral-2">For yourself</div>
          <h2 className={h2 + ' mb-3.5 max-w-[22ch] text-paper-3'}>
            The smartest way to build a <span className="italic text-[#C9A2EE]">collection</span>.
          </h2>
          <p className="mb-10 max-w-[54ch] text-[16.5px] leading-[1.65] text-[#C9BCC4]">
            No partner required. A December gift to yourself counts.
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-[18px]">
            {ADVENT_SOLO_IDEAS.map(s => (
              <IdeaCard key={s.title} idea={s} dark />
            ))}
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-t border-paper-3/10 pt-7">
            <div className="font-display text-[1.35rem] text-paper-3">
              This year: {valueStr} of product, yours for {priceStr}.
            </div>
            <BuyForm cal={p} shop={shop} className="rounded-full bg-coral px-7 py-[15px] text-[15px] font-medium text-white">
              {cta}
            </BuyForm>
          </div>
          <div className="mt-7 text-[12.5px] text-ink-4">Ideas for how to open it, not customer reviews.</div>
        </div>
      </section>

      {/* DETAILS */}
      <section data-screen-label="Details" className="bg-paper-3">
        <div className={wrap + ' ' + section}>
          <h2 className={h2 + ' mb-8'}>
            The <span className={accent}>details</span>.
          </h2>
          <div className="mb-3.5 grid grid-cols-[repeat(auto-fill,minmax(min(100%,140px),1fr))] gap-3.5 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
            {gallery.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => {
                  setImg(i)
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                aria-label={`View image ${i + 1}`}
                className="aspect-square overflow-hidden rounded-[18px] bg-paper p-0 transition hover:-translate-y-[3px]"
              >
                <img src={shopifyImageUrl(src, 400)} alt={`${p.title} image ${i + 1}`} loading="lazy" className="block h-full w-full object-cover" />
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5">
            {p.features.map(f => (
              <div key={f.k + f.v} className="rounded-[18px] bg-paper p-[22px]">
                <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-4">{f.k}</div>
                <div className="font-display text-[1.25rem] leading-[1.3]">{f.v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMPARE */}
      <section data-screen-label="Compare">
        <div className={wrap + ' ' + section}>
          <div className={kicker + ' mb-3.5'}>The 2026 lineup</div>
          <h2 className={h2 + ' mb-8'}>
            Pick your <span className={accent}>countdown</span>.
          </h2>
          <div className="flex flex-col border-t border-ink/10">
            {lineup.map(k => {
              const c = ADVENT_CALENDARS[k]
              const s = d.products[k]
              const cur = k === key
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => pick(k)}
                  aria-current={cur ? 'true' : undefined}
                  className={'grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-[18px] border-b border-ink/10 px-3 py-4 text-left ' + (cur ? 'bg-plum-soft' : 'bg-paper')}
                >
                  <div className="h-16 w-16 overflow-hidden rounded-[12px] bg-paper-3">
                    {s?.images[0] ? <img src={shopifyImageUrl(s.images[0], 160)} alt="" loading="lazy" className="block h-full w-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 font-display text-[1.2rem] leading-[1.25]">
                      {c.short} · {c.days}-day
                    </div>
                    <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-4">
                      Valued at {money(c.value)} · {c.brands.join(' · ')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-semibold">{s ? money(s.price) : ''}</div>
                    <div className="text-[13px] font-medium text-coral">{cur ? 'Viewing' : 'Take a peek →'}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* URGENCY */}
      <section data-screen-label="Urgency" className="bg-coral">
        <div className={wrap + ' flex flex-wrap items-center justify-between gap-x-14 gap-y-7 py-12 text-white md:py-[clamp(48px,7vw,80px)]'}>
          <div className="flex-[1_1_440px]">
            <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em]">One run. No restocks.</div>
            <h2 className="mb-4 font-display text-[clamp(2rem,4.5vw,3.2rem)] font-normal leading-[1.08] tracking-[-0.01em]">
              When they're gone, they're gone until <span className="italic">next December</span>.
            </h2>
            <p className="max-w-[52ch] text-[16.5px] leading-[1.6]">
              Advent calendars are made once a year in a single run.
              {timer.live ? ` ${priceStr} is the advent price, and it ends ${timer.endLabel}.` : ''} Order by {ADVENT_SHIP_BY} so door one is ready on December 1.
            </p>
          </div>
          <div className="flex flex-[0_1_auto] flex-col items-start gap-3.5">
            {timer.live ? <Timer units={timer.units} big /> : null}
            <BuyForm cal={p} shop={shop} className="rounded-full bg-ink px-8 py-[17px] text-base font-medium text-white transition hover:-translate-y-0.5">
              {cta}
            </BuyForm>
            {stockLine !== null ? <div className="text-sm font-semibold">Only {stockLine} left at {priceStr}</div> : null}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section data-screen-label="FAQ" className="bg-paper-2">
        <div className={'mx-auto max-w-[820px] px-4 sm:px-[clamp(20px,5vw,64px)] ' + section}>
          <h2 className={h2 + ' mb-9'}>
            Questions, <span className={accent}>answered</span>.
          </h2>
          {ADVENT_FAQ.map(q => (
            <details key={q.q} data-faq className="border-t border-ink/10">
              <summary className="flex cursor-pointer items-center justify-between gap-5 py-6 font-display text-[1.3rem]">
                {q.q}
                <span data-chev className="text-2xl leading-none text-ink-4 transition-transform duration-300">+</span>
              </summary>
              <p className="max-w-[60ch] pb-[26px] text-base leading-[1.65] text-ink-3">{q.a}</p>
            </details>
          ))}
          <div className="border-t border-ink/10" />
        </div>
      </section>

      {/* FINAL CTA */}
      <section data-screen-label="Final CTA" className="relative overflow-hidden bg-ink">
        <Snow />
        <div className={wrap + ' relative py-[72px] text-center md:py-[clamp(72px,11vw,128px)]'}>
          <div className="mb-6 font-mono text-[11px] uppercase tracking-[0.18em] text-coral-2">Door one opens December 1</div>
          <h2 className="mx-auto mb-[34px] max-w-[20ch] font-display text-[clamp(2.1rem,5vw,3.6rem)] font-normal leading-[1.12] tracking-[-0.01em] text-paper-3">
            {p.closer}
          </h2>
          <div className="flex justify-center">
            <BuyForm cal={p} shop={shop} className={buyBtn}>
              {cta} · {priceStr}
            </BuyForm>
          </div>
          <div className="mt-4 text-sm text-[#C9BCC4]">{valueStr} of products inside.</div>
        </div>
      </section>

      {/* Pinned buy bar, server-rendered and always on at every width, so it never waits on JS. */}
      <div data-sticky-buy className="fixed inset-x-0 bottom-0 z-20 pb-[env(safe-area-inset-bottom)] border-t border-ink/10 bg-paper/95 shadow-[0_-8px_24px_rgba(26,20,24,0.08)] backdrop-blur-[10px]">
          <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-3 px-4 py-3 sm:gap-5 sm:px-[clamp(16px,5vw,64px)]">
            <div className="flex min-w-0 items-center gap-3">
              <div className="h-11 w-11 flex-none overflow-hidden rounded-[10px] bg-paper-3">
                {gallery[0] ? <img src={shopifyImageUrl(gallery[0], 96)} alt="" className="block h-full w-full object-cover" /> : null}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold">
                  {priceStr} <span className="font-normal text-plum">· {valueStr} value</span>
                </div>
                {timer.live || stockLine !== null ? (
                  <div className="text-[12.5px] font-semibold text-coral">
                    {[timer.live ? `Ends in ${timer.short}` : null, stockLine !== null ? `${stockLine} left` : null].filter(Boolean).join(' · ')}
                  </div>
                ) : null}
              </div>
            </div>
            <BuyForm cal={p} shop={shop} className="whitespace-nowrap rounded-full bg-coral px-5 py-[13px] text-[15px] font-medium text-white sm:px-[26px]">
              {cta}
            </BuyForm>
          </div>
      </div>

      <footer className={wrap + ' flex flex-wrap justify-between gap-x-7 gap-y-3 pb-24 pt-8 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-4'}>
        <span>© 2026 xdipx · You must be 18 or older to shop.</span>
        <span>Plain packaging · Billed as XDIPX</span>
      </footer>
    </div>
  )
}
