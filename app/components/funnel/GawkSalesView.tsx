/**
 * The Gawk Gawk 3000 sales page, ported from the owner's Claude Design file
 * ("Gawk Gawk 3000 Sales Page v2"). Square corners, a warm ground and a coral
 * rule on purpose: this design is its own look, not the store's rounded one.
 * Words and photos live in app/lib/gawk-sales-page.ts; price and stock come
 * from Shopify via the loader, and a discount only shows when Shopify has one.
 *
 * Every CTA is SalesPageView's BuyForm, so it posts to the route's action, works
 * before hydration, and leads to the add-on screen and then checkout.
 */

import { useEffect, type ReactNode } from 'react'
import {
  GAWK_ACTION,
  GAWK_ANATOMY,
  GAWK_BEATS,
  GAWK_BOX,
  GAWK_COMPARE_COLUMNS,
  GAWK_COMPARE_ROWS,
  GAWK_FAQS,
  GAWK_IMAGES as IMG,
  GAWK_PATH,
  GAWK_REASONS,
  GAWK_SPECS,
  GAWK_STATS,
  GAWK_STEPS,
  GAWK_TICKER,
  GAWK_UPGRADES,
  GAWK_VERSUS,
  gawkOffer,
  gawkUpgradeGap,
} from '~/lib/gawk-sales-page'
import { trackCtaClick } from '~/lib/analytics.client'
import { trackFbViewContent } from '~/lib/meta-pixel.client'
import { sanityImageSrcSet, sanityImageUrl } from '~/lib/sanity-image'
import { shopifyImageUrl } from '~/lib/shopify-image'
import { ExitOffer } from './ExitOffer'
import { BuyForm, money, type SalesShopifyData, type SalesViewData } from './SalesPageView'

const COL = 'mx-auto max-w-[1160px]'
const SECTION = 'px-5 py-20'
const SPLIT = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-center gap-14'
const HALVES = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))]'
const GAP_GRID = 'bg-[#DDD6CF] gap-0.5'
const STACK = 'flex flex-col gap-[22px]'
const H2 = 'm-0 font-display font-medium text-[clamp(36px,5vw,54px)] leading-[1.04] tracking-[-0.015em] [text-wrap:balance]'
const BIG = 'm-0 font-display font-medium text-[clamp(40px,6vw,64px)] leading-[1.02] tracking-[-0.02em]'
const BODY = 'm-0 text-[18px] leading-[1.6] text-[#3E3732] [text-wrap:pretty]'
const MUTED = 'text-[#5E5650]'
const FRAME = 'relative overflow-hidden border-t-[3px] border-coral bg-[#F2EFEB]'
const TRUST_LINE = 'flex flex-wrap gap-x-[18px] gap-y-2 text-[14px] text-[#3E3732]'

function Em({ children, light }: { children: ReactNode; light?: boolean }) {
  return <span className={'italic ' + (light ? 'text-[#E9A58F]' : 'text-plum')}>{children}</span>
}

function Kicker({ children, light }: { children: ReactNode; light?: boolean }) {
  return <span className={'font-mono text-[12px] uppercase tracking-[0.1em] ' + (light ? 'text-[#E9A58F]' : 'text-coral')}>{children}</span>
}

function FreeBadge({ light }: { light?: boolean | undefined }) {
  return (
    <span className={'inline-flex items-center whitespace-nowrap border-2 px-2 py-[3px] text-[13px] font-bold tracking-[0.04em] ' + (light ? 'border-white text-white' : 'border-plum bg-white text-plum')}>
      ✓ FREE SHIPPING
    </span>
  )
}

/** A photo that fills its positioned frame. Never the LCP unless `eager`. */
function Fill({ src, alt = '', pos, contain, eager, sizes = '(min-width: 768px) 50vw, 100vw', extra }: {
  src: string
  alt?: string
  pos: string
  contain?: boolean
  eager?: boolean
  sizes?: string
  extra?: string
}) {
  return (
    <img
      src={sanityImageUrl(src, { w: 1200 })}
      srcSet={sanityImageSrcSet(src)}
      sizes={sizes}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      {...(eager ? { fetchPriority: 'high' as const } : {})}
      decoding="async"
      style={{ objectPosition: pos }}
      className={'absolute inset-0 block h-full w-full ' + (contain ? 'object-contain ' : 'object-cover ') + (extra ?? '')}
    />
  )
}

export function GawkSalesView({ d }: { d: SalesViewData & { upgrades: { handle: string; shop: SalesShopifyData }[]; smsOptin: boolean } }) {
  const { page, shop } = d
  const variant = shop.variants.find(v => v.available) ?? shop.variants[0]
  const price = variant?.price ?? 0
  const offer = gawkOffer(price, shop.showCompareAt ? (variant?.compareAtPrice ?? null) : null)
  const p = money(price)
  const getIt = offer ? `Get it ${offer.label} →` : 'Get it →'

  // Only what's in stock and really costs more shows, so a sold-out Rose just drops off.
  const upgrades = GAWK_UPGRADES.flatMap(u => {
    const up = d.upgrades.find(x => x.handle === u.handle)?.shop
    const v = up?.variants.find(x => x.available)
    const gap = gawkUpgradeGap(price, v?.price)
    return up && v && gap ? [{ ...u, shop: up, variant: v, gap }] : []
  })
  const heroUpgrade = upgrades.find(u => u.featured) ?? upgrades[0]

  useEffect(() => {
    trackFbViewContent({ content_ids: [shop.productId], value: price, currency: 'USD' })
    // Once per page view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.productId])

  const Cta = ({ children, size = 19, width = 'max-w-[440px]', tone = 'bg-coral hover:bg-plum' }: { children: ReactNode; size?: 18 | 19 | 20; width?: string; tone?: string }) => (
    <BuyForm
      shop={shop}
      variant={variant}
      beginCheckout={!d.hasAddOns}
      formClassName="w-full"
      className={
        'flex w-full cursor-pointer justify-center border-0 px-6 font-bold text-white ' +
        { 18: 'py-[15px] text-[18px] ', 19: 'py-[17px] text-[19px] ', 20: 'py-[18px] text-[20px] ' }[size] +
        tone + ' ' + width
      }
    >
      {children}
    </BuyForm>
  )

  const Struck = ({ light }: { light?: boolean | undefined }) =>
    offer ? <span className={'text-[18px] line-through ' + (light ? 'text-[#BDB4AD]' : 'text-[#6B625C]')}>{money(offer.was)}</span> : null

  const PriceRow = ({ light }: { light?: boolean | undefined }) => (
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-display text-[38px]">{p}</span>
      <Struck light={light} />
      <FreeBadge light={light} />
    </div>
  )

  return (
    <div data-sales data-sales-design="gawk" className="flex flex-col overflow-x-hidden bg-[#F2EFEB] pb-[70px] font-body text-[#1A1616] antialiased">
      {d.preview && !page.live ? (
        <p className="bg-plum-soft px-4 py-2 text-center text-xs text-plum-2">Preview. This page is not live, so visitors see a 404.</p>
      ) : null}

      <div data-screen-label="Top bar" className="flex flex-wrap items-center justify-center gap-2.5 bg-[#1A1616] px-4 py-[9px] text-center text-[13px] text-white">
        {offer ? <span className="bg-plum px-[7px] py-0.5 font-bold">{offer.label}</span> : null}
        <span><strong>The viral stroker</strong> · Free discreet shipping · Statement reads XDIPX</span>
      </div>

      <header className="flex items-center justify-between gap-4 border-b border-[#DDD6CF] bg-white px-5 py-3">
        {d.logo ? (
          <img src={d.logo.src} alt={d.logo.alt} width={68} height={28} className="block h-7 w-auto" />
        ) : (
          <div className="text-[22px] font-semibold tracking-[0.02em]">xdipx</div>
        )}
        <BuyForm shop={shop} variant={variant} beginCheckout={!d.hasAddOns} className="cursor-pointer border-0 bg-coral px-3.5 py-[9px] text-[14px] font-semibold text-white hover:bg-plum">
          {getIt}
        </BuyForm>
      </header>

      {d.error ? (
        <p role="alert" className="bg-coral-soft px-5 py-3 text-center text-sm text-ink">{d.error}</p>
      ) : null}

      {/* 01 Hero */}
      <section data-screen-label="01 Hero" className="border-t-[3px] border-coral bg-white">
        <div className={COL + ' ' + HALVES + ' items-stretch'}>
          <div className="relative min-h-[520px] overflow-hidden bg-[#F2EFEB]">
            {/* The LCP element: eager, high priority, never in Reveal. */}
            <Fill src={IMG.hero} alt="Gawk Gawk 3000" pos="50% 20%" eager />
            <div className="absolute left-4 top-4"><FreeBadge /></div>
            <div className="absolute bottom-0 right-0 flex flex-col items-end">
              <span className="bg-plum px-3.5 py-2 text-[30px] font-bold text-white">{offer ? offer.label : p}</span>
              <span className="bg-coral px-3.5 py-[5px] font-mono text-[12px] uppercase tracking-[0.08em] text-white">Plain box</span>
            </div>
          </div>
          <div className="flex flex-col justify-center gap-[22px] px-[clamp(20px,5vw,56px)] py-11">
            <div className="flex items-center gap-2.5">
              <div className="h-0.5 w-8 bg-coral" />
              <Kicker>The Male Rose · Gawk Gawk 3000</Kicker>
            </div>
            <div className="flex">
              <span className="inline-flex items-center whitespace-nowrap bg-[#1A1616] px-[9px] py-[5px] text-[13px] font-bold tracking-[0.04em] text-white">THE VIRAL STROKER</span>
            </div>
            <h1 className="m-0 font-display text-[clamp(42px,6vw,68px)] font-medium leading-[1.02] tracking-[-0.02em] [text-wrap:balance]">
              Soft lips that <Em>spin</Em> around your cock.
            </h1>
            <p className="m-0 max-w-[480px] text-[18px] leading-[1.5] text-[#3E3732] [text-wrap:pretty]">
              The stroker that went viral. Soft lips, a textured cup, a full 360° spin while it vibrates. You just hold the handle.
            </p>
            <div className="flex flex-wrap items-baseline gap-3.5">
              <span className="font-display text-[44px] font-medium">{p}</span>
              {offer ? (
                <>
                  <span className="text-[20px] text-[#6B625C] line-through">{money(offer.was)}</span>
                  <span className="bg-plum px-2 py-1 text-[15px] font-bold text-white">Save {money(offer.save)}</span>
                </>
              ) : null}
              <FreeBadge />
            </div>
            <Cta size={20} width="max-w-[480px]">{offer ? `See it spin, ${offer.label} →` : 'See it spin →'}</Cta>
            <div className={TRUST_LINE}>
              <span>✓ Discreet plain box</span><span>✓ Billed as XDIPX</span><span>✓ 30-day returns</span>
            </div>
            {heroUpgrade ? (
              <a
                data-gawk-step-up
                href="#rose-upgrade"
                onClick={() => trackCtaClick('gawk_upsell', 'hero')}
                className="group block max-w-[480px] border-2 border-[#1A1616] bg-[#1A1616] text-white no-underline transition-colors hover:border-plum hover:bg-plum"
              >
                <div className="grid grid-cols-[84px_minmax(0,1fr)] items-stretch">
                  <div className="relative bg-white">
                    {heroUpgrade.shop.images[0] ? (
                      <img src={shopifyImageUrl(heroUpgrade.shop.images[0].url, 240)} alt={heroUpgrade.name} loading="lazy" className="absolute inset-0 block h-full w-full object-contain p-1.5" />
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1 px-4 py-3">
                    <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#E9A58F]">Or go all in · {money(heroUpgrade.gap)} more</span>
                    <span className="font-display text-[22px] leading-[1.15]">{heroUpgrade.name}: it <em>thrusts</em> too.</span>
                    <span className="text-[14px] leading-snug text-[#DDD6CF]">Everything the Gawk does, and it strokes you on its own. See the upgrades <span className="whitespace-nowrap font-semibold text-white">↓</span></span>
                  </div>
                </div>
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap justify-center gap-x-7 gap-y-2 bg-coral px-5 py-3.5 font-mono text-[13px] uppercase tracking-[0.08em] text-white">
        {GAWK_TICKER.map(t => <span key={t}>{t}</span>)}
      </div>

      {/* 02 Picture this */}
      <section data-screen-label="02 Picture this" className={SECTION + ' bg-white'}>
        <div className={COL + ' ' + SPLIT}>
          <div className={FRAME + ' aspect-[4/5]'}><Fill src={IMG.picture} pos="50% 25%" /></div>
          <div className={STACK}>
            <Kicker>Picture this</Kicker>
            <h2 className={H2}>It's late. You're already hard. <Em>Now imagine her mouth.</Em></h2>
            <p className={BODY}>You know the feeling. The video is good, you're worked up, and your hand is doing the same thing it's done a thousand times. It's fine. It's not head.</p>
            <p className={BODY}>Now picture soft lips sliding down over you. Slick, snug at the tip. Then they start to turn, slowly at first, a full circle around your cock, while a low vibration builds underneath.</p>
            <p className={BODY}>You don't have to do anything. Hold the handle. Speed it up. Slow it down. Switch the vibration. Edge as long as you can stand it.</p>
            <p className="m-0 font-display text-[26px] leading-[1.3]">That's the Gawk Gawk 3000. <Em>That's why it went viral.</Em></p>
            <Cta>Give me that feeling →</Cta>
          </div>
        </div>
      </section>

      {/* 03 Head on demand */}
      <section data-screen-label="03 Head on demand" className={SECTION}>
        <div className={COL + ' flex flex-col gap-9'}>
          <div className="flex max-w-[760px] flex-col gap-3.5">
            <Kicker>Why it went viral</Kicker>
            <h2 className="m-0 font-display text-[clamp(36px,5vw,56px)] font-medium leading-[1.04] tracking-[-0.015em] [text-wrap:balance]">Head on <Em>demand.</Em> Whenever you want it.</h2>
            <p className={BODY}>No asking. No waiting. No one else's schedule. Slide in, press the button, and soft lips start turning around your cock while ten vibration modes hum underneath. It doesn't get tired. It doesn't stop until you do.</p>
          </div>
          <div className={FRAME + ' aspect-[16/9] max-h-[620px] w-full bg-white'}><Fill src={IMG.head} pos="50% 35%" sizes="(min-width: 1160px) 1160px, 100vw" /></div>
          <div className={'grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] ' + GAP_GRID}>
            {GAWK_STATS.map(s => (
              <div key={s.title} className="flex flex-col gap-2 bg-white px-6 py-7">
                <span className={'font-display text-[56px] leading-none text-coral ' + (s.italic ? 'italic' : '')}>{s.big}</span>
                <span className="text-[17px] font-bold">{s.title}</span>
                <span className={'text-[15px] leading-[1.5] ' + MUTED}>{s.body}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 04 Grab it */}
      <section data-screen-label="04 Grab it" className="relative overflow-hidden bg-[#1A1616] text-white">
        <div className="relative flex min-h-[clamp(460px,56vw,680px)] items-end">
          <Fill src={IMG.grab} alt="Man holding the Gawk Gawk 3000" pos="60% 40%" sizes="100vw" />
          <div className="relative mx-auto w-full max-w-[1160px] px-5 py-10">
            <div className="flex max-w-[560px] flex-col gap-4 border-t-[3px] border-coral bg-[#1A1616] px-[clamp(20px,4vw,40px)] py-8">
              <Kicker light>Fits in one hand</Kicker>
              <h2 className="m-0 font-display text-[clamp(34px,4.6vw,50px)] font-medium leading-[1.04] tracking-[-0.015em] [text-wrap:balance]">Grab it. Hold it. <Em light>Let it work.</Em></h2>
              <p className="m-0 text-[17px] leading-[1.55] text-[#D9D2CC] [text-wrap:pretty]">Long handle, solid grip, rose-gold buttons under your thumb. It's the only thing you'll need to hold tonight.</p>
              <Cta size={18} width="">{getIt}</Cta>
            </div>
          </div>
        </div>
      </section>

      {/* 05 CTA */}
      <section data-screen-label="05 CTA" className="bg-[#1A1616] px-5 py-16 text-white">
        <div className="mx-auto flex max-w-[900px] flex-col items-center gap-5 text-center">
          <span className="bg-plum px-2.5 py-1 text-[16px] font-bold">{offer ? offer.label : 'Free shipping'}</span>
          <h2 className={BIG}>It spins. <Em light>You cum.</Em></h2>
          <p className="m-0 max-w-[560px] text-[18px] leading-[1.5] text-[#D9D2CC] [text-wrap:pretty]">That's the whole pitch. {p}, shipped free{offer ? `, down from ${money(offer.was)}` : ''}.</p>
          <Cta size={20} width="mx-auto max-w-[440px]">{getIt}</Cta>
          <span className="text-[14px] text-[#BDB4AD]">Free shipping · Plain box · Billed as XDIPX · 30-day returns</span>
        </div>
      </section>

      {/* 06 Keep watching */}
      <section data-screen-label="06 Keep watching" className={SECTION + ' bg-[#F2EFEB]'}>
        <div className={COL + ' ' + SPLIT}>
          <div className={STACK}>
            <Kicker>Keep watching</Kicker>
            <h2 className={H2}>One hand on the handle. <Em>Your eyes stay on the screen.</Em></h2>
            <p className={BODY}>Your hand stops being the engine. The motor spins, the lips grip, the vibes pulse. All you do is hold on and enjoy the show.</p>
            <div className={'flex flex-col ' + GAP_GRID}>
              {['✕ No rhythm to keep up', '✕ No wrist cramp halfway through the good part', '✕ No losing it right before the end'].map(t => (
                <div key={t} className="bg-white px-[18px] py-4 text-[17px] font-semibold">{t}</div>
              ))}
              <div className="bg-white px-[18px] py-4 text-[17px] font-semibold text-plum">✓ Just lips, spinning, until you cum</div>
            </div>
            <Cta>Let it do the work →</Cta>
          </div>
          <div className={FRAME + ' aspect-[4/5]'}><Fill src={IMG.watching} pos="55% 30%" /></div>
        </div>
      </section>

      {/* 07 Ten ways */}
      <section data-screen-label="07 Ten ways" className={SECTION + ' bg-white'}>
        <div className={COL + ' grid grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] items-center gap-12'}>
          <div className={FRAME + ' aspect-[9/13]'}><Fill src={IMG.final} pos="50% 25%" /></div>
          <div className="flex flex-col gap-[26px]">
            <Kicker>What happens when you put it on</Kicker>
            <h2 className={H2}>Ten vibrations. Five spins. <Em>One pair of lips</Em> on your cock.</h2>
            <div className={'flex flex-col ' + GAP_GRID}>
              {GAWK_BEATS.map(b => (
                <div key={b.n} className="grid grid-cols-[56px_minmax(0,1fr)] items-baseline gap-4 bg-white px-1 py-[18px]">
                  <span className="font-mono text-[13px] text-coral">{b.n}</span>
                  <div className="flex flex-col gap-1">
                    <span className="text-[18px] font-bold">{b.t}</span>
                    <span className={'text-[16px] leading-[1.5] ' + MUTED}>{b.d}</span>
                  </div>
                </div>
              ))}
            </div>
            <Cta width="">I want head on demand →</Cta>
          </div>
        </div>
      </section>

      {/* 08 Viral */}
      <section data-screen-label="08 Viral" className="bg-[#1A1616] text-white">
        <div className={COL + ' ' + HALVES}>
          <div className="relative min-h-[420px] overflow-hidden bg-white"><Fill src={IMG.viral} pos="60% 30%" /></div>
          <div className="flex flex-col justify-center gap-5 px-[clamp(20px,5vw,56px)] py-14">
            <Kicker light>The viral stroker</Kicker>
            <h2 className={H2 + ' text-white'}>It went viral for <Em light>one reason.</Em></h2>
            <p className="m-0 text-[18px] leading-[1.6] text-[#D9D2CC] [text-wrap:pretty]">The name gets the click. The feeling is the rest of it: soft lips turning around you, vibration underneath, your hand doing nothing but holding on. Put your cock in and find out why.</p>
            <PriceRow light />
            <Cta>Find out why →</Cta>
          </div>
        </div>
      </section>

      {/* 09 The path */}
      <section data-screen-label="09 The path" className={SECTION + ' border-t-[3px] border-coral bg-[#F2EFEB]'}>
        <div className={COL + ' flex flex-col gap-9'}>
          <div className="flex max-w-[780px] flex-col gap-3.5">
            <Kicker>How you get one</Kicker>
            <h2 className={H2}>It went viral. <Em>Your turn.</Em></h2>
            <p className={BODY}>It's in stock and ready to ship. All that's left is finding out what everyone was talking about.</p>
          </div>
          <div className={'grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] ' + GAP_GRID}>
            {GAWK_PATH.map(s => (
              <div key={s.label} className="flex flex-col gap-2 bg-white px-[22px] py-[26px]">
                <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-coral">{s.label}</span>
                <span className="font-display text-[28px] leading-[1.1]">{s.title}{s.em ? <> <Em>{s.em}</Em></> : null}</span>
                <span className={'text-[15px] leading-[1.5] ' + MUTED}>{s.body}</span>
              </div>
            ))}
          </div>
          <Cta>Grab one →</Cta>
        </div>
      </section>

      {/* 10 Versus hand */}
      <section data-screen-label="10 Versus hand" className={SECTION}>
        <div className="mx-auto flex max-w-[900px] flex-col gap-8">
          <div className="flex flex-col items-center gap-3.5 text-center">
            <Kicker>Be honest</Kicker>
            <h2 className={H2}>Your hand <Em>can't do this.</Em></h2>
          </div>
          <div className="flex flex-col border-t-[3px] border-coral bg-white">
            <div className={'grid grid-cols-[minmax(0,.8fr)_minmax(0,1.1fr)_minmax(0,1fr)] gap-3 border-b border-[#DDD6CF] px-5 py-3.5 font-mono text-[12px] uppercase tracking-[0.08em] ' + MUTED}>
              <span /><span className="text-coral">Gawk Gawk 3000</span><span>Your hand</span>
            </div>
            {GAWK_VERSUS.map(v => (
              <div key={v.k} className="grid grid-cols-[minmax(0,.8fr)_minmax(0,1.1fr)_minmax(0,1fr)] gap-3 border-b border-[#F2EFEB] px-5 py-4 text-[16px] leading-[1.4]">
                <span className="font-bold">{v.k}</span><span>{v.us}</span><span className="text-[#6B625C]">{v.them}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 11 Six reasons */}
      <section data-screen-label="11 Six reasons" className={SECTION + ' bg-white'}>
        <div className={COL + ' flex flex-col gap-9'}>
          <div className="flex max-w-[760px] flex-col gap-3.5">
            <Kicker>Why it lives in the nightstand</Kicker>
            <h2 className={H2}>Six reasons you'll <Em>never go back</Em> to your hand.</h2>
          </div>
          <div className={'grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] ' + GAP_GRID}>
            {GAWK_REASONS.map((r, i) => (
              <div key={r.t} className="flex flex-col gap-2.5 bg-white px-6 py-7">
                <span className="font-display text-[40px] italic leading-none text-plum">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-[19px] font-bold">{r.t}</span>
                <span className={'text-[16px] leading-[1.55] ' + MUTED}>{r.d}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 12 CTA */}
      <section data-screen-label="12 CTA cumming" className="bg-coral px-5 py-16 text-white">
        <div className="mx-auto flex max-w-[900px] flex-col items-center gap-5 text-center">
          <h2 className={BIG}>Stop reading. <span className="italic">Start cumming.</span></h2>
          <span className="text-[17px]">You've read enough.</span>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <span className="font-display text-[40px]">{p}</span>
            {offer ? <span className="text-[18px] line-through">{money(offer.was)}</span> : null}
            <FreeBadge light />
          </div>
          <Cta size={20} width="mx-auto max-w-[440px]" tone="bg-[#1A1616] hover:bg-plum">{getIt}</Cta>
          <span className="text-[14px]">Plain box · Billed as XDIPX · 30-day returns</span>
        </div>
      </section>

      {/* 13 Believe the hype */}
      <section data-screen-label="13 Believe the hype" className={SECTION + ' bg-white'}>
        <div className={COL + ' flex flex-col gap-9'}>
          <div className="flex max-w-[760px] flex-col gap-3.5">
            <Kicker>The real thing, up close</Kicker>
            <h2 className={H2}>Believe the <Em>hype.</Em> It gives head.</h2>
            <p className={BODY}>Clear textured cup so you can see what's waiting for you. Long black handle that stays in your grip. Rose-gold controls under your thumb. The cup pops off to rinse.</p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-4">
            <div className="relative aspect-[3/4] overflow-hidden bg-[#F2EFEB]"><Fill src={IMG.inHand} alt="Gawk Gawk 3000 in hand" pos="50% 50%" sizes="(min-width: 768px) 33vw, 100vw" /></div>
            <div className="relative aspect-[3/4] overflow-hidden border border-[#DDD6CF] bg-white"><Fill src={IMG.packshot} alt="Gawk Gawk 3000" pos="50% 50%" contain sizes="(min-width: 768px) 33vw, 100vw" /></div>
            <div className="relative aspect-[3/4] overflow-hidden border border-[#DDD6CF] bg-white"><Fill src={IMG.detail} alt="Gawk Gawk 3000 detail" pos="50% 50%" contain sizes="(min-width: 768px) 33vw, 100vw" /></div>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,200px),1fr))] gap-px">
            {GAWK_SPECS.map(s => (
              <div key={s.k} className="flex flex-col gap-1 bg-white px-[18px] py-4 shadow-[0_0_0_1px_#DDD6CF]">
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-coral">{s.k}</span>
                <span className="text-[16px] leading-[1.4]">{s.v}</span>
              </div>
            ))}
            <div className="col-span-full">
              <Cta size={18} width="">{getIt}</Cta>
            </div>
          </div>
        </div>
      </section>

      {/* 14 In action */}
      <section data-screen-label="14 In action" className={SECTION + ' bg-white'}>
        <div className={COL + ' flex flex-col gap-10'}>
          <div className="flex max-w-[780px] flex-col gap-3.5">
            <Kicker>See it in action</Kicker>
            <h2 className={H2}>This is what it looks like <Em>going down.</Em></h2>
            <p className={BODY}>No guessing from a product shot. Clear cup, so you can see exactly how the lips take you in, how the sleeve wraps the shaft, and how it all ends.</p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] items-start gap-6">
            {GAWK_ACTION.map(a => (
              <div key={a.title} className="flex flex-col gap-3.5">
                <div className={FRAME + ' aspect-[3/4] bg-white'}><Fill src={IMG[a.img]} pos="50% 40%" sizes="(min-width: 768px) 33vw, 100vw" /></div>
                <span className="font-display text-[26px] leading-[1.15]">{a.title}</span>
                <span className={'text-[16px] leading-[1.55] ' + MUTED}>{a.body}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div className="w-full sm:w-[440px]"><Cta>I want that →</Cta></div>
            <FreeBadge />
          </div>
        </div>
      </section>

      {/* 15 Anatomy */}
      <section data-screen-label="15 Anatomy" className={SECTION + ' bg-[#F2EFEB]'}>
        <div className={COL + ' ' + SPLIT}>
          <div className={FRAME + ' aspect-[4/5] bg-white'}><Fill src={IMG.detail} pos="50% 50%" contain /></div>
          <div className={STACK}>
            <Kicker>Anatomy of head on demand</Kicker>
            <h2 className={H2}>Every inch built to <Em>get you off.</Em></h2>
            <div className={'flex flex-col ' + GAP_GRID}>
              {GAWK_ANATOMY.map(a => (
                <div key={a.k} className="grid grid-cols-[minmax(0,120px)_minmax(0,1fr)] items-baseline gap-4 bg-white px-[18px] py-4">
                  <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-coral">{a.k}</span>
                  <span className="text-[16px] leading-[1.5]">{a.v}</span>
                </div>
              ))}
            </div>
            <Cta>{getIt}</Cta>
          </div>
        </div>
      </section>

      {/* 16 CTA spin */}
      <section data-screen-label="16 CTA spin" className="border-t-[3px] border-coral px-5 py-[72px]">
        <div className={COL + ' ' + HALVES + ' bg-white'}>
          <div className="relative min-h-[340px] overflow-hidden"><Fill src={IMG.spin} pos="40% 30%" /></div>
          <div className="flex flex-col justify-center gap-[18px] px-[clamp(20px,4vw,48px)] py-10">
            <div className="flex items-center gap-2.5">
              {offer ? <span className="bg-plum px-2 py-1 text-[15px] font-bold text-white">{offer.label}</span> : null}
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-coral">Free shipping · Plain box</span>
            </div>
            <h2 className="m-0 font-display text-[clamp(34px,4.4vw,48px)] font-medium leading-[1.04] tracking-[-0.015em] [text-wrap:balance]">Soft lips spin <Em>360°</Em> around your cock until you cum.</h2>
            <PriceRow />
            <Cta width="">See it spin →</Cta>
          </div>
        </div>
      </section>

      {/* 17 Do the math */}
      <section data-screen-label="17 Do the math" className={SECTION + ' bg-white'}>
        <div className={COL + ' ' + SPLIT}>
          <div className={STACK}>
            <Kicker>Do the math</Kicker>
            <h2 className={H2}>{p} once. <Em>Head every night after.</Em></h2>
            <p className={BODY}>Less than a nice dinner. Less than a few months of the premium sites you're on right now. And unlike those, this one actually touches you.</p>
            <div className={'flex flex-col border-t-[3px] border-coral ' + GAP_GRID}>
              {[
                ...(offer ? [{ k: 'Regular price', v: <span className="text-[#6B625C] line-through">{money(offer.was)}</span> }] : []),
                { k: offer ? 'Today' : 'Price', v: <span className="text-coral">{p}</span> },
                { k: 'Shipping', v: <span className="text-plum">Free</span> },
                { k: 'Returns', v: '30 days' },
              ].map(r => (
                <div key={r.k} className="flex items-baseline justify-between gap-4 bg-white px-5 py-4">
                  <span className={'text-[16px] ' + MUTED}>{r.k}</span>
                  <span className="font-display text-[24px]">{r.v}</span>
                </div>
              ))}
            </div>
            <Cta>{offer ? `Lock in ${offer.label} →` : 'Lock it in →'}</Cta>
          </div>
          <div className={FRAME + ' aspect-square'}>
            <Fill src={IMG.math} alt="Man holding the Gawk Gawk 3000" pos="32% 42%" extra="origin-[32%_42%] scale-[1.7]" />
          </div>
        </div>
      </section>

      {/* 18 Tonight */}
      <section data-screen-label="18 Tonight" className={SECTION}>
        <div className={COL + ' flex flex-col gap-8'}>
          <div className="flex max-w-[760px] flex-col gap-3.5">
            <Kicker>How it goes</Kicker>
            <h2 className={H2}>Box opens. Lube in. <Em>Lips on.</Em></h2>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-4">
            {GAWK_STEPS.map(s => (
              <div key={s.n} className="flex flex-col gap-2.5 border-t-[3px] border-coral bg-white px-5 py-[22px]">
                <span className="font-display text-[40px] italic leading-none text-plum">{s.n}</span>
                <span className="text-[18px] font-bold">{s.t}</span>
                <span className={'text-[15px] leading-[1.5] ' + MUTED}>{s.d}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 19 In the box */}
      <section data-screen-label="19 In the box" className={SECTION + ' border-t-[3px] border-coral bg-[#F2EFEB]'}>
        <div className={COL + ' ' + SPLIT}>
          <div className={FRAME + ' aspect-[4/5]'}><Fill src={IMG.box} pos="40% 30%" /></div>
          <div className={STACK}>
            <Kicker>What shows up at your door</Kicker>
            <h2 className={H2}>Everything you need. <Em>Shipping's on us.</Em></h2>
            <div className={'flex flex-col ' + GAP_GRID}>
              {GAWK_BOX.map(b => (
                <div key={b.t} className="grid grid-cols-[28px_minmax(0,1fr)] items-baseline gap-3 bg-white px-[18px] py-4">
                  <span className="font-bold text-plum">✓</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[17px] font-bold">{b.t}</span>
                    <span className={'text-[15px] ' + MUTED}>{b.d}</span>
                  </div>
                </div>
              ))}
            </div>
            <PriceRow />
            <Cta>Send me one →</Cta>
          </div>
        </div>
      </section>

      {/* 20 Discreet */}
      <section data-screen-label="20 Discreet" className={SECTION + ' bg-white'}>
        <div className={COL + ' flex flex-col gap-5'}>
          <Kicker>Nobody's business</Kicker>
          <h2 className={H2}>Nobody knows <Em>but you.</Em></h2>
          <p className="m-0 max-w-[620px] text-[18px] leading-[1.55] text-[#3E3732] [text-wrap:pretty]">It shows up looking like nothing. Your bank sees four letters. Your roommate, your wife, your mailman see a brown box.</p>
          <Cta width="max-w-[420px]">Ship it discreetly →</Cta>
        </div>
      </section>

      {/* 21 Guarantee */}
      <section data-screen-label="21 Guarantee" className={SECTION + ' border-t border-[#DDD6CF] bg-[#F2EFEB]'}>
        <div className="mx-auto flex max-w-[820px] flex-col items-center gap-5 text-center">
          <div className="flex h-40 w-40 flex-col items-center justify-center rounded-full border-[3px] border-coral bg-white">
            <span className="font-display text-[64px] leading-[0.9] text-coral">30</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.1em]">day returns</span>
          </div>
          <h2 className={H2}>Try it. <Em>The only risk is finding out what you've been missing.</Em></h2>
          <p className={BODY}>30-day returns on unopened boxes, and if something's wrong with it, we make it right. It ships free, it ships plain, and it bills as XDIPX.</p>
          <div className="flex flex-wrap justify-center gap-2.5">
            <FreeBadge />
            {['✓ PLAIN BOX', '✓ BILLED AS XDIPX', '✓ 18+ ONLY'].map(t => (
              <span key={t} className="border-2 border-[#1A1616] px-2 py-[3px] text-[13px] font-bold">{t}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Upgrades: the other Male Roses. Not in the owner's design file; added on his direction 2026-10-31. */}
      {upgrades.length ? (
        <section id="rose-upgrade" data-screen-label="Upgrade" className="scroll-mt-4 bg-[#1A1616] px-5 py-20 text-white">
          <div className={COL + ' flex flex-col gap-10'}>
            <div className="flex max-w-[760px] flex-col gap-4">
              <Kicker light>The rest of the Roses</Kicker>
              <h2 className={H2}>The Gawk gives you the swirl. Step up and get the <Em light>bob</Em>.</h2>
              <p className="m-0 text-[18px] leading-[1.6] text-[#DDD6CF] [text-wrap:pretty]">
                The Gawk spins and vibrates. The two above it also slide up and down on their own, so your hand can finally let go.
              </p>
            </div>

            <div data-rose-cards className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-3">
              {upgrades.map(u => (
                <article
                  key={u.handle}
                  className={'relative flex flex-col bg-white text-[#1A1616] ' + (u.featured ? 'order-first border-[3px] border-coral md:order-none md:-my-4' : 'border-[3px] border-transparent')}
                >
                  <div className={'px-4 py-2 font-mono text-[12px] uppercase tracking-[0.1em] ' + (u.featured ? 'bg-coral text-white' : 'bg-[#F2EFEB] text-[#3E3732]')}>{u.tag}</div>
                  <div className="relative aspect-square bg-white">
                    {u.shop.images[0] ? (
                      <img src={shopifyImageUrl(u.shop.images[0].url, 640)} alt={u.name} loading="lazy" className="absolute inset-0 block h-full w-full object-contain p-4" />
                    ) : null}
                    <span className="absolute bottom-3 right-3 bg-plum px-2.5 py-1 text-[15px] font-bold text-white">{money(u.gap)} more</span>
                  </div>
                  <div className="flex flex-1 flex-col gap-3.5 p-5">
                    <h3 className="m-0 font-mono text-[12px] font-normal uppercase tracking-[0.1em] text-coral">{u.name}</h3>
                    <div className="font-display text-[27px] font-medium leading-[1.1] [text-wrap:balance]">{u.headline}</div>
                    <p className="m-0 text-[16px] leading-[1.5] text-[#3E3732] [text-wrap:pretty]">{u.pitch}</p>
                    <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[15px] leading-snug">
                      {u.adds.map(a => (
                        <li key={a} className="grid grid-cols-[18px_minmax(0,1fr)] gap-1.5"><span className="font-bold text-plum">✓</span><span>{a}</span></li>
                      ))}
                    </ul>
                    <div className="mt-auto flex flex-col gap-3 pt-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-display text-[34px] leading-none">{money(u.variant.price)}</span>
                        <FreeBadge />
                      </div>
                      <BuyForm
                        shop={u.shop}
                        variant={u.variant}
                        beginCheckout={!d.hasAddOns}
                        formClassName="w-full"
                        className={'flex w-full cursor-pointer justify-center border-0 px-6 py-[15px] text-[18px] font-bold text-white ' + (u.featured ? 'bg-coral hover:bg-plum' : 'bg-[#1A1616] hover:bg-plum')}
                      >
                        {u.cta}
                      </BuyForm>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div data-rose-compare className="bg-white text-[#1A1616]">
              <div className="grid grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))] items-center border-b-[3px] border-coral text-center text-[13px] font-bold sm:text-[15px]">
                <div />
                {GAWK_COMPARE_COLUMNS.map(c => <div key={c} className="px-0.5 py-3">{c}</div>)}
              </div>
              {GAWK_COMPARE_ROWS.map(r => (
                <div key={r.label} className="grid grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))] items-center border-b border-[#DDD6CF] text-center text-[14px] sm:text-[16px]">
                  <div className="py-2.5 pl-3 text-left leading-tight sm:pl-5">{r.label}</div>
                  {r.has.map((yes, i) => (
                    <div key={GAWK_COMPARE_COLUMNS[i]} aria-label={yes ? 'Yes' : 'No'} className={yes ? 'font-bold text-plum' : 'text-[#B5ACA5]'}>{yes ? '✓' : '·'}</div>
                  ))}
                </div>
              ))}
            </div>

            <div className="flex flex-col items-center gap-3 text-center">
              <p className="m-0 text-[17px] text-[#DDD6CF]">All of them ship free, in the same plain box, billed as XDIPX. Happy with the one that went viral?</p>
              <Cta width="max-w-[440px]" tone="bg-transparent border-2 border-solid border-white hover:bg-white hover:text-[#1A1616]">{`Keep the Gawk, ${p} →`}</Cta>
            </div>
          </div>
        </section>
      ) : null}

      {/* 22 Offer */}
      <section data-screen-label="22 Offer" className="bg-plum px-5 py-[72px] text-white">
        <div className="mx-auto flex max-w-[900px] flex-col items-center gap-[18px] text-center">
          <span className="font-mono text-[13px] uppercase tracking-[0.1em]">Free shipping · Plain box</span>
          <div className="font-display text-[clamp(80px,14vw,160px)] font-medium leading-[0.9] tracking-[-0.03em]">{offer ? offer.label : p}</div>
          <p className="m-0 max-w-[560px] text-[20px] leading-[1.45] [text-wrap:pretty]">
            The viral Gawk Gawk 3000, shipped free, for <strong>{p}</strong>{offer ? ` instead of ${money(offer.was)}` : ''}. You're already in the mood. Don't waste it.
          </p>
          <Cta size={20} width="mx-auto max-w-[440px]" tone="bg-coral hover:bg-[#1A1616]">{offer ? `Claim ${offer.label} →` : 'Claim yours →'}</Cta>
          <div className="flex flex-wrap items-center justify-center gap-2.5 text-[14px]">
            <FreeBadge light /><span>Discreet · Billed as XDIPX · 30-day returns</span>
          </div>
        </div>
      </section>

      {/* 23 PS */}
      <section data-screen-label="23 PS" className={SECTION + ' bg-white'}>
        <div className={COL + ' ' + SPLIT}>
          <div className="flex max-w-[560px] flex-col gap-5">
            <Kicker>One last thing</Kicker>
            <p className="m-0 font-display text-[30px] leading-[1.25]">Look.</p>
            <p className={BODY}>You're here because something on your screen got you going and you clicked. Good instinct.</p>
            <p className={BODY}>Right now the Gawk Gawk 3000 is <strong>{offer ? offer.label : p}</strong>, ships <strong>free</strong> in a plain box, and shows up on your statement as XDIPX. Nobody has to know. Change your mind before you open it and it can come back within 30 days.</p>
            <p className={BODY}>Or close this tab, go back to your hand, and keep wondering.</p>
            <div className="flex flex-col gap-2.5 border-l-[3px] border-plum pl-4">
              <p className="m-0 text-[17px] leading-[1.55]"><strong>P.S.</strong> The rotation is intense. Start on the lowest speed. Seriously.</p>
              <p className="m-0 text-[17px] leading-[1.55]"><strong>P.P.S.</strong> Water-based lube only. You can add a bottle on the next screen, and two or more cost less each.</p>
            </div>
            <Cta>Okay, I'm in →</Cta>
          </div>
          <div className={FRAME + ' aspect-square'}><Fill src={IMG.ps} pos="50% 30%" /></div>
        </div>
      </section>

      {/* 24 Final CTA */}
      <section data-screen-label="24 Final CTA" className="border-t-[3px] border-coral bg-white">
        <div className={COL + ' ' + HALVES}>
          <div className="flex flex-col justify-center gap-[22px] px-[clamp(20px,5vw,56px)] py-14">
            <h2 className="m-0 font-display text-[clamp(40px,5.6vw,62px)] font-medium leading-[1.02] tracking-[-0.02em] [text-wrap:balance]">You're already hard. <Em>Let it finish the job.</Em></h2>
            <p className="m-0 text-[18px] leading-[1.5] text-[#3E3732] [text-wrap:pretty]">The viral one. Soft lips, a full spin, ten vibes, a plain box at your door.</p>
            <div className="flex flex-wrap items-baseline gap-3.5">
              <span className="font-display text-[44px]">{p}</span>
              {offer ? <span className="text-[20px] text-[#6B625C] line-through">{money(offer.was)}</span> : null}
            </div>
            <Cta size={20} width="max-w-[480px]">{getIt}</Cta>
            <div className={TRUST_LINE + ' items-center'}>
              <FreeBadge /><span>✓ Discreet plain box</span><span>✓ Billed as XDIPX</span><span>✓ 30-day returns</span>
            </div>
          </div>
          <div className="relative min-h-[520px] overflow-hidden bg-[#F2EFEB]"><Fill src={IMG.final} pos="50% 20%" /></div>
        </div>
      </section>

      {/* 25 FAQ: native details so answers open before hydration; `name` keeps one open at a time. */}
      <section data-screen-label="25 FAQ" className={SECTION}>
        <div className="mx-auto flex max-w-[820px] flex-col gap-7">
          <h2 className="m-0 font-display text-[clamp(34px,4.6vw,48px)] font-medium leading-[1.05] tracking-[-0.015em]">Straight <Em>answers.</Em></h2>
          <div className={'flex flex-col border-t-[3px] border-coral ' + GAP_GRID}>
            {GAWK_FAQS.map((f, i) => (
              <details key={f.q} name="gawk-faq" open={i === 0} className="group bg-white">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 px-[22px] py-5 text-[17px] font-semibold [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="flex-none font-mono text-[20px] text-coral group-open:hidden">+</span>
                  <span className="hidden flex-none font-mono text-[20px] text-coral group-open:inline">−</span>
                </summary>
                <div className="px-[22px] pb-[22px] text-[16px] leading-[1.55] text-[#3E3732] [text-wrap:pretty]">{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="flex flex-col items-center gap-2.5 bg-[#1A1616] px-5 py-8 text-center text-[13px] text-[#BDB4AD]">
        {d.logo ? <img src={d.logo.src} alt={d.logo.alt} className="block h-6 w-auto bg-white px-2 py-1 box-content" /> : null}
        <span>© 2026 xdipx · You must be 18 or older to shop · Plain packaging · Billed as XDIPX</span>
      </footer>

      {/* Pinned buy bar, server-rendered and always on, so it never waits on JS. */}
      <div data-sticky-buy className="fixed inset-x-0 bottom-0 z-20 flex justify-center border-t-[3px] border-coral bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_rgba(26,22,22,0.12)]">
        <div className="flex w-full max-w-[1160px] items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <img src={sanityImageUrl(IMG.packshot, { w: 96 })} alt="" width={44} height={44} className="h-11 w-11 flex-none bg-[#F2EFEB] object-contain" />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[14px] font-bold">Gawk Gawk 3000 · <span className="text-coral">In stock</span></span>
              <span className="text-[13px] text-[#3E3732]">
                <strong>{p}</strong> {offer ? <span className="text-[#6B625C] line-through">{money(offer.was)}</span> : null} · <span className="font-bold text-plum">Free shipping</span>
              </span>
            </div>
          </div>
          <BuyForm shop={shop} variant={variant} beginCheckout={!d.hasAddOns} className="flex min-h-11 flex-none cursor-pointer items-center border-0 bg-coral px-[18px] py-[13px] text-[16px] font-bold text-white hover:bg-plum">
            {offer ? `${offer.label} →` : 'Get it →'}
          </BuyForm>
        </div>
      </div>

      {variant?.available ? (
        <ExitOffer
          slug={page.slug}
          smsOptin={d.smsOptin}
          buy={
            <BuyForm shop={shop} variant={variant} beginCheckout={!d.hasAddOns} formClassName="w-full" className="flex min-h-[52px] w-full cursor-pointer items-center justify-center border-0 bg-coral px-6 text-[18px] font-bold text-white hover:bg-plum">
              I'll take it ♥
            </BuyForm>
          }
        />
      ) : null}
    </div>
  )
}
