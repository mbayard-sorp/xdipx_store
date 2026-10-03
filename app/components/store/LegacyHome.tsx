/**
 * The legacy daily-deal homepage render (ticket #13146). Extracted verbatim
 * from `_layout._index.tsx`'s default export so it can be code-split: variant
 * 'b' (the live storefront) is what actually renders in production, but the
 * route module's static imports pulled this component and its six
 * EmmaHero/BundleHero/.../EndorsementHero dependencies into the SAME client
 * chunk as variant b, so every visitor downloaded ~20-30 KB (compressed) of
 * code that never ran. `_layout._index.tsx` now loads this via `React.lazy`
 * instead of a static import, so it only ships to a visitor actually seeing
 * variant 'legacy' (the default until `HOME_VARIANT=b` is set) or previewing
 * it with `?variant=legacy`.
 *
 * Reads its own loader data and outlet context via hooks rather than props,
 * matching how the inline render used to work — this component only ever
 * mounts as a descendant of the `_layout._index` route, so both are in scope.
 */
import { useEffect } from 'react'
import { Link, useLoaderData, useOutletContext } from 'react-router'
import type { loader } from '~/routes/_layout._index'
import { EmmaHero } from '~/components/store/EmmaHero'
import { BundleHero } from '~/components/store/BundleHero'
import { QuietEndorsementHero } from '~/components/store/QuietEndorsementHero'
import { PairBundleHero } from '~/components/store/PairBundleHero'
import { PairBundleFullBleedHero } from '~/components/store/PairBundleFullBleedHero'
import { EndorsementHero } from '~/components/store/EndorsementHero'
import { ProductCarousel } from '~/components/cms/ProductCarousel'
import { EmmaContextRow } from '~/components/home/EmmaContextRow'
import { EmailSubscribe } from '~/components/store/EmailSubscribe'
import { ContentBlockRenderer } from '~/components/cms/ContentBlockRenderer'
import { TrustBarBlock } from '~/components/cms/TrustBarBlock'
import { ProductStructuredData } from '~/components/seo/ProductStructuredData'
import { categoryToLegacyString } from '~/types'
import type { TrustBarBlock as TrustBarBlockType } from '~/types/cms'
import { trackViewItem, trackViewItemList, trackDealView, type GA4Item } from '~/lib/analytics.client'

export default function LegacyHome() {
  const loaderData = useLoaderData<typeof loader>()
  const { buyButtonText } = useOutletContext<{ buyButtonText: string }>()

  // Only ever rendered by `_layout._index.tsx` when `loaderData.variant ===
  // 'legacy'`, which is what narrows every field below; this guard is a type
  // satisfier for the union, not a real runtime branch.
  if (loaderData.variant !== 'legacy') return null

  const {
    deal, bundle, forHim, forHer, bonusDeal,
    cmsData, carouselProductMap,
    emmaHero, pairDeal, homepageSettings, pairBundleDeal,
    emmaContextRows, pairSwatches,
  } = loaderData

  // ── GA4: track deal view + item lists ───────────────────────────────────
  useEffect(() => {
    if (!deal) return
    const item: GA4Item = {
      item_id: deal.shopifyProductId,
      item_name: deal.seoTitle,
      item_brand: deal.brand,
      item_category: categoryToLegacyString(deal.category),
      price: deal.dealPrice,
    }
    trackViewItem(item, deal.dealPrice)
    trackDealView(deal.handle, deal.seoTitle, deal.dealPrice)
  }, [deal?.handle])

  useEffect(() => {
    if (forHim.length > 0) {
      trackViewItemList('for_him', 'For Him', forHim.map((p, i) => ({
        item_id: p.id, item_name: p.title, ...(p.brand ? { item_brand: p.brand } : {}), price: p.price, index: i,
      })))
    }
    if (forHer.length > 0) {
      trackViewItemList('for_her', 'For Her', forHer.map((p, i) => ({
        item_id: p.id, item_name: p.title, ...(p.brand ? { item_brand: p.brand } : {}), price: p.price, index: i,
      })))
    }
  }, [forHim, forHer])

  // Split CMS sections: those that sit above BonusDeal/Vault vs below
  const cmsSections = cmsData?.sections ?? []
  // announcementBar is handled in _layout.tsx — exclude it here
  const allContentBlocks = cmsSections.filter(s => s._type !== 'announcementBar')
  // Lift Emma-curated rails out of the regular content stream so they render
  // directly below the hero, matching the editorial intent (rails are deal-
  // specific cross-sell, not bottom-of-page CMS modules).
  const emmaCuratedRails = allContentBlocks.filter(
    (b): b is import('~/types/cms').EmmaCuratedRailBlock => b._type === 'emmaCuratedRail',
  )
  // For the pair_bundle_fullbleed and endorsement templates, lift the first
  // trust bar out of the regular content stream so it can render directly
  // below the price strip inside the hero.
  const isFullBleedPair = !!(deal && homepageSettings.template === 'pair_bundle_fullbleed' && pairBundleDeal && deal.pairBundleCopy)
  const isEndorsement   = !!(deal && homepageSettings.template === 'endorsement' && deal.endorsementCopy)
  const liftedTrustBar  = (isFullBleedPair || isEndorsement)
    ? (allContentBlocks.find((b): b is TrustBarBlockType => b._type === 'trustBar') ?? null)
    : null
  const liftedKeys = new Set<string>(emmaCuratedRails.map(b => b._key))
  if (liftedTrustBar) liftedKeys.add(liftedTrustBar._key)
  const contentBlocks = allContentBlocks.filter(b => !liftedKeys.has(b._key))

  // MAP-restricted: prefer the Shopify metafield; fall back to MAP-vs-MSRP heuristic
  // for legacy products without the `map_restricted` flag set.
  const mapRestricted = !!(deal && (deal.mapRestricted ?? (deal.mapPrice > 0 && deal.mapPrice >= deal.msrp)))

  // Priority: Shopify `xdipx.emma_hero` metafield (Claude-generated on promotion)
  // → Sanity `emmaHero` doc (manual editorial override) → component defaults.
  const shopifyEmma = deal?.emmaHero
  const heroVariant = shopifyEmma?.variant ?? emmaHero?.heroVariant ?? 'loving'
  const heroCopy = shopifyEmma
    ? {
        eyebrow:  shopifyEmma.eyebrow,
        headline: shopifyEmma.headline,
        body:     shopifyEmma.body,
        aside:    shopifyEmma.aside,
        ...(shopifyEmma.pullQuote ? { pullQuote: shopifyEmma.pullQuote } : {}),
      }
    : emmaHero
      ? {
          ...(emmaHero.eyebrow   ? { eyebrow:   emmaHero.eyebrow }   : {}),
          ...(emmaHero.headline  ? { headline:  emmaHero.headline }  : {}),
          ...(emmaHero.body      ? { body:      emmaHero.body }      : {}),
          ...(emmaHero.aside     ? { aside:     emmaHero.aside }     : {}),
          ...(emmaHero.pullQuote ? { pullQuote: emmaHero.pullQuote } : {}),
        }
      : undefined

  return (
    <>
      {bundle ? (
        <BundleHero bundle={bundle} buyButtonText={buyButtonText} />
      ) : deal && homepageSettings.template === 'pair_bundle' && pairBundleDeal && deal.pairBundleCopy ? (
        <>
          <PairBundleHero
            primary={deal}
            partner={pairBundleDeal}
            copy={deal.pairBundleCopy}
            discountPct={homepageSettings.pairDiscountPct}
          />
          <ProductStructuredData deal={deal} />
        </>
      ) : deal && homepageSettings.template === 'pair_bundle_fullbleed' && pairBundleDeal && deal.pairBundleCopy ? (
        <>
          <PairBundleFullBleedHero
            primary={deal}
            partner={pairBundleDeal}
            copy={deal.pairBundleCopy}
            discountPct={homepageSettings.pairDiscountPct}
            trustBar={liftedTrustBar ? <TrustBarBlock block={liftedTrustBar} frameless /> : null}
            swatches={pairSwatches ?? {}}
          />
          <ProductStructuredData deal={deal} />
        </>
      ) : deal && homepageSettings.template === 'endorsement' && deal.endorsementCopy ? (
        <>
          <EndorsementHero
            deal={deal}
            copy={deal.endorsementCopy}
            showFreeShipping={homepageSettings.showFreeShipping}
            swatches={pairSwatches ?? {}}
          />
          {/* Emma contextual rails — sit between the hero and the trust bar.
              Each rail links to its configured collection; empty / unconfigured
              rails are skipped so half-edited drafts don't render dead links.
              The first rail is positioned as "Staff Picks" and the second as
              "Try something new" — admin-editable rail titles still render
              as the curated headline beneath. */}
          {deal.endorsementCopy.rails && deal.endorsementCopy.rails.filter(r => r.collectionHandle && r.title).length > 0 && (
            <section className="bg-cream">
              <div className="max-w-6xl mx-auto px-4 pt-3 pb-3 grid gap-3 md:grid-cols-2">
                {deal.endorsementCopy.rails
                  .filter(r => r.collectionHandle && r.title)
                  .slice(0, 2)
                  .map((rail, i) => (
                    <Link
                      key={rail.collectionHandle}
                      to={`/collections/${rail.collectionHandle}`}
                      className="group block rounded-[var(--radius-lg)] border border-line bg-paper px-5 py-4 hover:bg-cream-2 transition-colors"
                    >
                      <p className="text-[11px] uppercase tracking-[0.18em] text-coral font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                        {i === 0 ? 'Staff Picks' : 'Try something new'}
                      </p>
                      <p className="mt-1 text-base md:text-lg italic text-ink group-hover:text-coral transition-colors" style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>
                        {rail.title} <span aria-hidden="true">→</span>
                      </p>
                    </Link>
                  ))}
              </div>
            </section>
          )}
          {/* Trust bar — anchors the foot of the endorsement section, below
              the rails. Lifted out of the regular content stream upstream so
              it only renders here for the endorsement template. */}
          {liftedTrustBar && (
            <div className="bg-cream">
              <div className="max-w-6xl mx-auto px-4 pt-3 pb-10 md:pb-14">
                <TrustBarBlock block={liftedTrustBar} frameless />
              </div>
            </div>
          )}
          <ProductStructuredData deal={deal} />
        </>
      ) : deal && homepageSettings.template === 'quiet_endorsement' && deal.quietEndorsementCopy ? (
        <>
          <QuietEndorsementHero deal={deal} showFreeShipping={homepageSettings.showFreeShipping} />
          <ProductStructuredData deal={deal} />
        </>
      ) : deal ? (
        <>
          <EmmaHero
            deal={deal}
            variant={heroVariant}
            mapRestricted={mapRestricted}
            {...(heroCopy ? { copy: heroCopy } : {})}
            pairDeal={pairDeal}
          />

          <ProductStructuredData deal={deal} />
        </>
      ) : (
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <p className="text-sage text-5xl mb-4">♥</p>
          <h1
            className="text-3xl font-bold text-ink mb-3"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Something good is coming.
          </h1>
          <p className="text-ink/60">
            Emma's next pick is just around the corner.
          </p>
        </div>
      )}

      {/* ── Emma curated rails (admin-published cross-sell, lifted to sit
            directly under the hero so deal-specific rails read as part of
            the editorial spread). ──────────────────────────────────────── */}
      {emmaCuratedRails.map(block => (
        <ContentBlockRenderer
          key={block._key}
          block={block}
          carouselProductMap={carouselProductMap}
          bonusDealProduct={bonusDeal}
        />
      ))}

      {/* ── Emma context rows (AI-personalized rails under the hero) ──────── */}
      {emmaContextRows && emmaContextRows.length > 0 && emmaContextRows.map(row => (
        <EmmaContextRow key={row.rail.id} row={row} />
      ))}

      {/* ── CMS content blocks (ordered by Sanity `order` field) ──────────── */}
      {contentBlocks.map(block => (
        <ContentBlockRenderer
          key={block._key}
          block={block}
          carouselProductMap={carouselProductMap}
          bonusDealProduct={bonusDeal}
        />
      ))}

      {/* ── Hardcoded sections (shown when no CMS carousel blocks replace them) */}
      {!contentBlocks.some(b => b._type === 'productCarousel') && (
        <>
          <ProductCarousel
            heading="Dialed in. Just for him. ♥"
            eyebrow="For Him"
            ctaLink="/for-him"
            ctaLabel="See all →"
            bgStyle="mist"
            products={forHim}
          />
          <ProductCarousel
            heading="Made for her. Obviously. ♥"
            eyebrow="For Her"
            ctaLink="/for-her"
            ctaLabel="See all →"
            bgStyle="cream"
            products={forHer}
          />
        </>
      )}

      <EmailSubscribe />
    </>
  )
}
