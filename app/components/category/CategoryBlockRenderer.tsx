/**
 * Switches on a resolved category/drop-page block's `_type` and renders the
 * matching component. Each block component owns its own `<section>` root
 * (id={anchorId}, data-block={_type}) and its own Reveal usage internally,
 * mirroring how StorefrontHome's bands are composed. Unknown/unrecognized
 * types render nothing rather than throwing, matching the resolver's own
 * per-block failure isolation (category-page.server.ts).
 */

import { Fragment } from 'react'
import type { ResolvedCategoryBlock } from '~/types/cms'
import { CategoryMasthead } from './CategoryMasthead'
import { DropMasthead } from './DropMasthead'
import { ShelfNav } from './ShelfNav'
import { SensationLegend } from './SensationLegend'
import { EditorialFeature } from './EditorialFeature'
import { ShelfSection } from './ShelfSection'
import { LearnStrip } from './LearnStrip'
import { BenefitEditorial } from './BenefitEditorial'
import { CategoryTrust } from './CategoryTrust'
import { ChooserBlock } from './ChooserBlock'
import { CategoryFaq } from './CategoryFaq'
import { JustLanded } from './JustLanded'
import { DropTimeline } from './DropTimeline'
import { MakersNote } from './MakersNote'
import { ComingSoon } from './ComingSoon'

/** Renders one resolved block. Exported for callers that already iterate
 *  their own list (kept internal-only for now; `CategoryBlockRenderer` below
 *  is the route-facing entry point). */
function renderOne(block: ResolvedCategoryBlock) {
  switch (block._type) {
    case 'categoryMasthead':
      return <CategoryMasthead block={block} />
    case 'dropMasthead':
      return <DropMasthead block={block} />
    case 'shelfNav':
      return <ShelfNav block={block} />
    case 'sensationLegend':
      return <SensationLegend block={block} />
    case 'editorialFeature':
      return <EditorialFeature block={block} />
    case 'shelfSection':
      return <ShelfSection block={block} />
    case 'learnStrip':
      return <LearnStrip block={block} />
    case 'benefitEditorial':
      return <BenefitEditorial block={block} />
    case 'categoryTrust':
      return <CategoryTrust block={block} />
    case 'chooserBlock':
      return <ChooserBlock block={block} />
    case 'faqBlock':
      return <CategoryFaq block={block} />
    case 'justLanded':
      return <JustLanded block={block} />
    case 'dropTimeline':
      return <DropTimeline block={block} />
    case 'makersNote':
      return <MakersNote block={block} />
    case 'comingSoon':
      return <ComingSoon block={block} />
    default:
      return null
  }
}

/**
 * Route-facing entry point: renders a page's full resolved block list in
 * order. One `<Fragment key>` per block, matching how StorefrontHome
 * composes its own band list.
 */
export function CategoryBlockRenderer({ blocks }: { blocks: ResolvedCategoryBlock[] }) {
  return (
    <>
      {blocks.map(block => (
        <Fragment key={block.key}>{renderOne(block)}</Fragment>
      ))}
    </>
  )
}
