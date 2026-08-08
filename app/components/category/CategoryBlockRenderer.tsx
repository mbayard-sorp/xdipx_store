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
import { DropMasthead, type DropTone } from './DropMasthead'
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

/**
 * Section rhythm is color, not whitespace (doctrine §1): the page must never
 * ship six pale grounds in a row. Aisle `categoryPage` docs commonly resolve to
 * an all-pale stack (masthead, jump-to, several shelves, trust) with no tinted
 * block in the mix, so we hand one mid-run shelf a plum-soft ground to give the
 * eye a beat. Sale runs on the quiet paper mandate (`dropTone==='quiet'`), so no
 * tint is injected there. Classifying an unknown block as pale is the safe
 * direction: it can only add a tint, never leave a pale run uncounted.
 */
const INHERENTLY_TINTED = new Set(['justLanded', 'learnStrip', 'sensationLegend'])
const MAX_PALE_RUN = 4

export function tintedShelfKeys(blocks: ResolvedCategoryBlock[], dropTone?: DropTone): Set<string> {
  const keys = new Set<string>()
  if (dropTone === 'quiet') return keys
  let run = 0
  for (const block of blocks) {
    // dropTone==='quiet' already returned above, so a dropMasthead here is the
    // tinted (New) treatment and counts as a non-pale ground.
    const inherentlyTinted =
      INHERENTLY_TINTED.has(block._type) || block._type === 'dropMasthead'
    if (inherentlyTinted) {
      run = 0
      continue
    }
    run += 1
    if (run >= MAX_PALE_RUN && block._type === 'shelfSection') {
      keys.add(block.key)
      run = 0
    }
  }
  return keys
}

/** Renders one resolved block. Exported for callers that already iterate
 *  their own list (kept internal-only for now; `CategoryBlockRenderer` below
 *  is the route-facing entry point). */
function renderOne(block: ResolvedCategoryBlock, dropTone?: DropTone, tinted = false) {
  switch (block._type) {
    case 'categoryMasthead':
      return <CategoryMasthead block={block} />
    case 'dropMasthead':
      return <DropMasthead block={block} tone={dropTone} />
    case 'shelfNav':
      return <ShelfNav block={block} />
    case 'sensationLegend':
      return <SensationLegend block={block} />
    case 'editorialFeature':
      return <EditorialFeature block={block} />
    case 'shelfSection':
      return <ShelfSection block={block} tinted={tinted} />
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
export function CategoryBlockRenderer({
  blocks,
  dropTone,
}: {
  blocks: ResolvedCategoryBlock[]
  /** Sale renders its dropMasthead on the quiet paper ground; New stays tinted. */
  dropTone?: DropTone
}) {
  const tintedKeys = tintedShelfKeys(blocks, dropTone)
  return (
    <>
      {blocks.map(block => (
        <Fragment key={block.key}>{renderOne(block, dropTone, tintedKeys.has(block.key))}</Fragment>
      ))}
    </>
  )
}
