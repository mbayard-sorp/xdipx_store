import type { ContentBlock } from '~/types/cms'
import type { Product } from '~/types'
import { Reveal } from '~/components/motion/Reveal'
import type { RevealVariant } from '~/components/motion/variants'
import { AnnouncementBar }    from './AnnouncementBar'
import { PromoBanner }        from './PromoBanner'
import { EditorialTiles }     from './EditorialTiles'
import { CategoryGrid }       from './CategoryGrid'
import { ProductCarousel }    from './ProductCarousel'
import { EmmaCuratedRail }    from './EmmaCuratedRail'
import { PlayTogetherBanner } from './PlayTogetherBanner'
import { BrandLogoWall }      from './BrandLogoWall'
import { Testimonials }       from './Testimonials'
import { BonusDealSection }   from './BonusDealSection'
import { RichTextBlock }      from './RichTextBlock'
import { TrustBarBlock }      from './TrustBarBlock'
import { EditorBioBlock }     from './EditorBioBlock'
// Merch components v1 (see docs/merch-build-plan.md + merch-spec.md). Each
// block resolves its own product refs from carouselProductMap, keyed by
// block._key — same contract productCarousel/emmaCuratedRail already use.
import { HeadlinerSpotlight } from './HeadlinerSpotlight'
import { CuriosityRail }      from './CuriosityRail'
import { CuriosityChooser }   from './CuriosityChooser'
import { OrFork }             from './OrFork'
import { QuickNavGrid }       from './QuickNavGrid'
import { HonestProof }        from './HonestProof'
import { EmailCaptureBand }   from '~/components/store/EmailCaptureBand'

interface ContentBlockRendererProps {
  block: ContentBlock
  carouselProductMap: Record<string, Product[]>
  bonusDealProduct?: Product | null
}

/** Pinned chrome that must paint immediately — never wrapped in a reveal. */
const NO_REVEAL: ReadonlySet<ContentBlock['_type']> = new Set([
  'announcementBar',
  'trustBar',
  // 1a is the page's one primary CTA — its image is the LCP candidate and
  // must never be gated behind a reveal (the component's own copy column
  // handles its own below-the-fold fade/up internally when needed).
  'headlinerSpotlight',
  // 1g sits high on the page (seeker fast lane) — same "paint immediately"
  // treatment as the trust bar it sits near.
  'quickNavGrid',
])

/** Banner-ish blocks read better with a plain fade than an upward slide. */
const FADE_BLOCKS: ReadonlySet<ContentBlock['_type']> = new Set([
  'promoBanner',
  'orFork',
  'emailCaptureBand',
])

function renderBlock(
  block: ContentBlock,
  carouselProductMap: Record<string, Product[]>,
  bonusDealProduct?: Product | null,
) {
  switch (block._type) {
    case 'announcementBar':
      return <AnnouncementBar block={block} />
    case 'promoBanner':
      return <PromoBanner block={block} />
    case 'editorialTiles':
      return <EditorialTiles block={block} />
    case 'categoryGrid':
      return <CategoryGrid block={block} />
    case 'productCarousel':
      return (
        <ProductCarousel
          block={block}
          products={carouselProductMap[block._key] ?? []}
        />
      )
    case 'emmaCuratedRail':
      return (
        <EmmaCuratedRail
          block={block}
          products={carouselProductMap[block._key] ?? []}
        />
      )
    case 'playTogetherBanner':
      return <PlayTogetherBanner block={block} />
    case 'brandLogoWall':
      return <BrandLogoWall block={block} />
    case 'testimonials':
      return <Testimonials block={block} />
    case 'bonusDeal':
      return <BonusDealSection block={block} product={bonusDealProduct ?? null} />
    case 'trustBar':
      return <TrustBarBlock block={block} />
    case 'richText':
      return <RichTextBlock block={block} />
    case 'editorBio':
      return <EditorBioBlock block={block} />
    // ─── Merch components v1 ────────────────────────────────────────────────
    // Every new block's loader-resolved products land in carouselProductMap
    // under the SAME block._key contract productCarousel/emmaCuratedRail
    // already use (a flat, deduped Product[]). Each component here re-splits
    // that flat list back into its role/tile/side shape by matching handles
    // off the block's own slot data — keeps carouselProductMap's shape
    // (Record<string, Product[]>) unchanged for every other route that reads it.
    case 'headlinerSpotlight': {
      const products = carouselProductMap[block._key] ?? []
      const product = products.find(p => p.handle === block.headlinerProductHandle) ?? products[0] ?? null
      return <HeadlinerSpotlight block={block} product={product} />
    }
    case 'curiosityRail': {
      const products = carouselProductMap[block._key] ?? []
      const byHandle = new Map(products.map(p => [p.handle, p]))
      const productsByRole = {
        ...(block.onRamp?.productHandle && byHandle.has(block.onRamp.productHandle)
          ? { onRamp: byHandle.get(block.onRamp.productHandle)! } : {}),
        ...(block.standby?.productHandle && byHandle.has(block.standby.productHandle)
          ? { standby: byHandle.get(block.standby.productHandle)! } : {}),
        ...(block.headlinerRole?.productHandle && byHandle.has(block.headlinerRole.productHandle)
          ? { headliner: byHandle.get(block.headlinerRole.productHandle)! } : {}),
        ...(block.reach?.productHandle && byHandle.has(block.reach.productHandle)
          ? { reach: byHandle.get(block.reach.productHandle)! } : {}),
      }
      return <CuriosityRail block={block} productsByRole={productsByRole} />
    }
    case 'curiosityChooser': {
      const products = carouselProductMap[block._key] ?? []
      const byHandle = new Map(products.map(p => [p.handle, p]))
      const tiles = block.chooserTiles ?? []
      const productsByTile: Record<string, Product[]> = {}
      for (const tile of tiles) {
        productsByTile[tile._key] = (tile.productHandles ?? [])
          .map(h => byHandle.get(h))
          .filter((p): p is Product => !!p)
      }
      // Default rail: first tile's products if present, else the flat list —
      // loader is expected to seed carouselProductMap[block._key] with a
      // sensible unfiltered default set (see storefront-home.server.ts).
      const defaultProducts = carouselProductMap[`${block._key}:default`] ?? products.slice(0, 3)
      return (
        <CuriosityChooser
          block={block}
          defaultProducts={defaultProducts}
          productsByTile={productsByTile}
        />
      )
    }
    case 'orFork': {
      const products = carouselProductMap[block._key] ?? []
      const byHandle = new Map(products.map(p => [p.handle, p]))
      const productA = block.forkSideA?.productHandle ? byHandle.get(block.forkSideA.productHandle) ?? null : null
      const productB = block.forkSideB?.productHandle ? byHandle.get(block.forkSideB.productHandle) ?? null : null
      return <OrFork block={block} productA={productA} productB={productB} />
    }
    case 'quickNavGrid':
      return <QuickNavGrid block={block} />
    case 'honestProof':
      return <HonestProof block={block} />
    case 'emailCaptureBand':
      return <EmailCaptureBand block={block} />
    default:
      return null
  }
}

export function ContentBlockRenderer({ block, carouselProductMap, bonusDealProduct }: ContentBlockRendererProps) {
  const inner = renderBlock(block, carouselProductMap, bonusDealProduct)
  if (inner === null || NO_REVEAL.has(block._type)) return inner

  const variant: RevealVariant = FADE_BLOCKS.has(block._type) ? 'fade' : 'up'
  return <Reveal variant={variant}>{inner}</Reveal>
}
