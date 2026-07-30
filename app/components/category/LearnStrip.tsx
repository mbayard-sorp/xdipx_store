/**
 * Plum-soft Notebook cross-link strip. No products, pure editorial.
 */

import { Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { Reveal } from '~/components/motion/Reveal'
import type { ResolvedCategoryBlock } from '~/types/cms'
import { DISPLAY, BODY } from './consts'

type Block = Extract<ResolvedCategoryBlock, { _type: 'learnStrip' }>

export function LearnStrip({ block }: { block: Block }) {
  return (
    <section id={block.anchorId} data-block={block._type} className="bg-plum-soft py-12 md:py-16">
      <div className="mx-auto max-w-[1320px] px-6 md:px-16">
        <Reveal variant="up" className="mb-6">
          <h2 className="text-[1.6rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.2rem]" style={DISPLAY}>
            {block.heading}
          </h2>
        </Reveal>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3">
          {block.posts.map((post, i) => (
            <Reveal key={post.slug} variant="up" index={i}>
              <Link to={`/notebook/${post.slug}`} className="group block">
                {post.heroImageUrl && (
                  <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius)] bg-paper">
                    <OptimizedImage
                      src={post.heroImageUrl}
                      alt={post.title}
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className="h-full w-full object-cover transition-transform duration-[var(--duration-slow)] group-hover:scale-[1.03]"
                    />
                  </div>
                )}
                <h3 className="mt-3 text-[16px] font-medium leading-snug text-ink" style={BODY}>
                  {post.title}
                </h3>
                {post.excerpt && (
                  <p className="mt-1 line-clamp-2 text-[14px] leading-relaxed text-ink-3" style={BODY}>
                    {post.excerpt}
                  </p>
                )}
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
