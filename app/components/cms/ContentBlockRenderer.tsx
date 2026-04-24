import type { ContentBlock } from '~/types/cms'
import type { Product } from '~/types'
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

interface ContentBlockRendererProps {
  block: ContentBlock
  carouselProductMap: Record<string, Product[]>
  bonusDealProduct?: Product | null
}

export function ContentBlockRenderer({ block, carouselProductMap, bonusDealProduct }: ContentBlockRendererProps) {
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
    default:
      return null
  }
}
