/**
 * 1c — Curiosity spread rail.
 *
 * Four typed role cards in a fixed price-ladder order: on-ramp ($24) ->
 * standby ($79) -> headliner ($129) -> reach ($189). Standby sits second
 * (fixed anchor a returning browser recognizes). Whole card is the link; no
 * per-card CTA competes with 1a.
 *
 * Binding correction applied: trailing link label is "Show me" (NOT "see the
 * shelf" — CTA whitelist is closed).
 */

import { Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import type { CuriosityRailBlock, CuriosityRailSlot } from '~/types/cms'
import type { Product } from '~/types'

const MONO = { fontFamily: 'var(--font-mono)' } as const
const DISPLAY = { fontFamily: 'var(--font-display)', fontWeight: 450 } as const
const DISPLAY_MED = { fontFamily: 'var(--font-display)', fontWeight: 500 } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

function fmt(n: number): string {
  return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`
}

type Role = 'onRamp' | 'standby' | 'headliner' | 'reach'

interface RoleMeta {
  role: Role
  kicker: string
  kickerColor: string
  tint: string
  border: string
  fromPrice?: boolean
}

const ROLE_META: RoleMeta[] = [
  { role: 'onRamp',    kicker: 'On-ramp · under $30', kickerColor: 'text-sage', tint: 'bg-plum-soft',  border: 'border-line',  fromPrice: true },
  { role: 'standby',   kicker: 'The standby',         kickerColor: 'text-ink-3', tint: 'bg-paper-3',    border: 'border-line' },
  { role: 'headliner', kicker: 'The headliner',       kickerColor: 'text-coral', tint: 'bg-coral-soft', border: 'border-coral' },
  { role: 'reach',     kicker: 'Reach for it',        kickerColor: 'text-plum',  tint: 'bg-plum-soft',  border: 'border-line' },
]

interface ResolvedCard {
  meta: RoleMeta
  slot: CuriosityRailSlot
  product: Product
}

interface CuriosityRailProps {
  block: CuriosityRailBlock
  /** Products keyed by role (onRamp/standby/headliner/reach), only the roles
   *  that resolved to a real product+copy line are included. */
  productsByRole: Partial<Record<Role, Product>>
}

export function CuriosityRail({ block, productsByRole }: CuriosityRailProps) {
  const slots: Partial<Record<Role, CuriosityRailSlot | undefined>> = {
    onRamp: block.onRamp,
    standby: block.standby,
    headliner: block.headlinerRole,
    reach: block.reach,
  }

  const cards: ResolvedCard[] = ROLE_META
    .map(meta => {
      const slot = slots[meta.role]
      const product = productsByRole[meta.role]
      if (!slot || !product) return null
      return { meta, slot, product }
    })
    .filter((c): c is ResolvedCard => c !== null)

  // Missing role product: remaining cards re-flow, ladder order preserved
  // (we just filtered above — order is stable because ROLE_META is fixed).
  if (cards.length === 0) return null

  const eyebrow = block.eyebrow || 'The spread · this week'
  const heading = block.heading || 'Four ways in.'
  const emphasis = block.emphasisWord || 'in'
  const headingParts = heading.includes(emphasis) ? heading.split(emphasis) : [heading, '']
  const ctaLink = block.railCtaLink || '/collections/best-sellers'

  // One-item rail: collapses to a single full-width card, never a lonely 1-of-4 grid.
  const isSingle = cards.length === 1

  return (
    <section className="bg-paper py-4">
      <div className="mx-auto max-w-[1320px]">
        <div className="flex items-baseline justify-between gap-4 px-5 pb-4 md:px-8">
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
              {eyebrow}
            </p>
            <h2 className="text-[26px] leading-[1.1] tracking-[-0.01em] text-ink md:text-[30px]" style={DISPLAY}>
              {headingParts[0]}
              <em className="em">{emphasis}</em>
              {headingParts[1]}
            </h2>
          </div>
          <Link
            to={ctaLink}
            className="link-coral hidden shrink-0 whitespace-nowrap text-[14px] text-ink md:inline-block"
            style={BODY}
          >
            Show me
          </Link>
        </div>

        <div
          className={
            isSingle
              ? 'px-5 md:px-8'
              : 'flex gap-3.5 overflow-x-auto px-5 pb-2 [scrollbar-width:none] md:grid md:grid-cols-4 md:gap-3.5 md:overflow-visible md:px-8 [&::-webkit-scrollbar]:hidden'
          }
        >
          {cards.map(({ meta, slot, product }) => (
            <Link
              key={meta.role}
              to={`/products/${product.handle}`}
              className={`group block overflow-hidden rounded-[var(--radius)] border ${meta.border} ${
                isSingle ? 'w-full' : 'w-[240px] shrink-0 md:w-auto'
              }`}
            >
              <div className={`border-b border-line px-3.5 py-2.5 md:px-3 md:py-[9px]`}>
                <span
                  className={`text-[9px] uppercase tracking-[0.14em] ${meta.kickerColor} md:text-[9px]`}
                  style={MONO}
                >
                  {meta.kicker}
                </span>
              </div>
              <div className={`relative flex aspect-[5/4] items-end justify-center p-2 ${meta.tint}`}>
                {product.images[0]?.url ? (
                  <OptimizedImage
                    src={product.images[0].url}
                    alt={product.images[0].altText || product.title}
                    sizes="240px"
                    className="h-full w-full rounded-[var(--radius-sm)] object-contain transition-transform duration-[var(--duration-base)] group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-3xl text-ink/10" aria-hidden="true">♥</div>
                )}
              </div>
              <div className="flex flex-col gap-1.5 p-3.5 md:gap-[5px] md:p-3">
                <h3 className="line-clamp-2 text-[17px] leading-tight text-ink md:text-[16px]" style={DISPLAY_MED}>
                  {product.title}
                </h3>
                {slot.copyLine && (
                  <p className="line-clamp-2 text-[12.5px] leading-snug text-ink-3 md:text-[12px]" style={BODY}>
                    {slot.copyLine}
                  </p>
                )}
                <p className="text-[13px] font-semibold text-ink md:text-[12.5px]" style={BODY}>
                  {meta.fromPrice ? `from ${fmt(product.price)}` : fmt(product.price)}
                </p>
              </div>
            </Link>
          ))}
        </div>

        <Link
          to={ctaLink}
          className="link-coral mt-3 inline-block px-5 text-[14px] text-ink md:hidden"
          style={BODY}
        >
          Show me
        </Link>
      </div>
    </section>
  )
}
