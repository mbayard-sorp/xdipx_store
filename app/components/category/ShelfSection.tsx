/**
 * A merchandised product shelf: heading + see-all, optional intro/sort
 * rationale, 2-col (mobile) / 4-col (desktop) grid of CategoryProductCard.
 * Fires view_item_list once per mount (StorefrontHome's ProductGrid pattern)
 * and select_item on card click, list id `category:{collectionHandle}:{anchorId}`.
 */

import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { Reveal } from '~/components/motion/Reveal'
import { CategoryProductCard } from './CategoryProductCard'
import { trackViewItemList, trackSelectItem, type GA4Item } from '~/lib/analytics.client'
import type { ResolvedCategoryBlock } from '~/types/cms'
import { MONO, DISPLAY, BODY } from './consts'

type Block = Extract<ResolvedCategoryBlock, { _type: 'shelfSection' }>
type CategoryProduct = Block['products'][number]

/** exactOptionalPropertyTypes forbids `item_brand: string | undefined`, so the
 *  key is only present when there's a brand to report. */
function toGA4Item(p: CategoryProduct, listId: string, index?: number): GA4Item {
  return {
    item_id: p.handle,
    item_name: p.title,
    ...(p.brand ? { item_brand: p.brand } : {}),
    price: p.price,
    ...(index != null ? { index } : {}),
    item_list_id: listId,
    item_list_name: listId,
  }
}

export function ShelfSection({ block }: { block: Block }) {
  const listId = `category:${block.collectionHandle}:${block.anchorId}`

  const firedView = useRef(false)
  useEffect(() => {
    if (firedView.current || block.products.length === 0) return
    firedView.current = true
    const items: GA4Item[] = block.products.map((p, i) => toGA4Item(p, listId, i))
    trackViewItemList(listId, listId, items)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (block.products.length === 0) return null

  return (
    <section id={block.anchorId} data-block={block._type} className="bg-paper py-12 md:py-16">
      <div className="mx-auto max-w-[1320px] px-6 md:px-16">
        <Reveal variant="up" className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[1.7rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.3rem]" style={DISPLAY}>
              {block.title}
            </h2>
            {block.intro && (
              <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-ink-3" style={BODY}>
                {block.intro}
              </p>
            )}
            {block.sortRationale && (
              <p className="mt-1.5 text-[13px] italic text-ink-4" style={BODY}>
                {block.sortRationale}
              </p>
            )}
          </div>
          <Link
            to={`/collections/${block.collectionHandle}`}
            className="link-coral shrink-0 text-[14px] font-medium text-ink"
            style={MONO}
          >
            {block.seeAllLabel}
          </Link>
        </Reveal>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {block.products.map((p, i) => (
            <Reveal key={p.id} variant="up" index={i}>
              <CategoryProductCard
                product={p}
                priority={i === 0}
                onSelect={() => trackSelectItem(listId, listId, toGA4Item(p, listId), i)}
              />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
