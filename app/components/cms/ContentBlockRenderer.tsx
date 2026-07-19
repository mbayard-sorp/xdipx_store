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
import { NotebookRail }       from '~/components/blog/NotebookRail'

interface ContentBlockRendererProps {
  block: ContentBlock
  carouselProductMap: Record<string, Product[]>
  bonusDealProduct?: Product | null
}

/** Pinned chrome that must paint immediately — never wrapped in a reveal. */
const NO_REVEAL: ReadonlySet<ContentBlock['_type']> = new Set([
  'announcementBar',
  'trustBar',
])

/** Banner-ish blocks read better with a plain fade than an upward slide. */
const FADE_BLOCKS: ReadonlySet<ContentBlock['_type']> = new Set([
  'promoBanner',
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
    case 'relatedGuides':
      // Curated Notebook picks for a PDP. Blocks render outside the PDP's
      // content container, so wrap to the same max width. Published-only +
      // shape normalization happens in getProductPageBlocks.
      return block.guides.length > 0 ? (
        <div className="max-w-6xl mx-auto px-4">
          <NotebookRail posts={block.guides} heading={block.heading || 'Related guides'} />
        </div>
      ) : null
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
