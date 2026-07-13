import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { data } from 'react-router'
import { getBlogPost, getNotebookSettings, isPreviewRequest } from '~/lib/sanity.server'
import { getProductsByHandles } from '~/lib/shopify.server'
import { BlogHero } from '~/components/blog/BlogHero'
import { BlogBody } from '~/components/blog/BlogBody'
import { TableOfContents } from '~/components/blog/TableOfContents'
import { BreadcrumbNav } from '~/components/blog/BreadcrumbNav'
import { ShareButtons } from '~/components/common/ShareButtons'
import { buildSocialMeta } from '~/lib/social-meta'
import { RelatedPosts } from '~/components/blog/RelatedPosts'
import { ReadingProgress } from '~/components/blog/ReadingProgress'
import { PostPagination } from '~/components/blog/PostPagination'
import { SeriesNav } from '~/components/blog/SeriesNav'
import { NotebookSubscribe } from '~/components/blog/NotebookSubscribe'
import { SanityImage } from '~/components/common/SanityImage'
import { Reveal } from '~/components/motion/Reveal'
import { BlogStructuredData } from '~/components/seo/BlogStructuredData'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { ItemListStructuredData } from '~/components/seo/ItemListStructuredData'
import type { Product } from '~/types'

export async function loader({ params, request }: LoaderFunctionArgs) {
  const slug = params['slug'] ?? ''
  const preview = isPreviewRequest(request)
  const [post, notebookSettings] = await Promise.all([
    getBlogPost(slug, preview),
    getNotebookSettings(),
  ])

  if (!post) throw data('Post not found', { status: 404 })

  const productHandles = (post.body ?? [])
    .filter((b: any) => b._type === 'blogProductEmbed' && b.productHandle)
    .map((b: any) => b.productHandle as string)

  let productMap: Record<string, Product> = {}
  if (productHandles.length > 0) {
    const uniqueHandles = [...new Set(productHandles)]
    const products = await getProductsByHandles(uniqueHandles)
    productMap = Object.fromEntries(products.map(p => [p.handle, p]))
  }

  return { post, productMap, notebookSettings }
}

export const meta: MetaFunction<typeof loader> = ({ data: loaderData }) => {
  if (!loaderData) return [{ title: 'Post not found — xdipx' }]
  const { post } = loaderData
  const title = (post.seoTitle ?? post.title) + ' — The Notebook | xdipx'
  const description = post.seoDescription ?? post.excerpt
  // The designed share card is the default og:image; the route itself
  // redirects to an editor-supplied ogImage when one exists.
  const image = `https://xdipx.com/og/notebook/${post.slug}.png`
  const canonical = `https://xdipx.com/notebook/${post.slug}`

  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: canonical },
    { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: `${canonical}.md` },
    ...buildSocialMeta({ title, description, url: canonical, image, type: 'article' }),
    { property: 'article:published_time', content: post.publishedAt },
    ...(post._updatedAt ? [{ property: 'article:modified_time', content: post._updatedAt }] : []),
    ...(post.author ? [{ property: 'article:author', content: post.author.name }] : []),
    ...(post.tags ?? []).map(tag => ({ property: 'article:tag', content: tag })),
    ...(post.noIndex ? [{ name: 'robots', content: 'noindex' }] : []),
  ]
}

export default function NotebookPostPage() {
  const { post, productMap, notebookSettings } = useLoaderData<typeof loader>()

  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'Notebook', href: '/notebook' },
    ...(post.category ? [{ label: post.category.name, href: `/notebook/category/${post.category.slug}` }] : []),
    { label: post.title },
  ]

  const breadcrumbSchema = [
    { name: 'Home', url: 'https://xdipx.com/' },
    { name: 'Notebook', url: 'https://xdipx.com/notebook' },
    ...(post.category ? [{ name: post.category.name, url: `https://xdipx.com/notebook/category/${post.category.slug}` }] : []),
    { name: post.title, url: `https://xdipx.com/notebook/${post.slug}` },
  ]

  // Guide-category posts that embed products are "best X for Y" listicles —
  // emit ItemList JSON-LD (in body order) so AI engines and Google can extract
  // the ranked picks. Built from the same blogProductEmbed blocks the reader
  // sees, so the structured list stays 1:1 with visible content.
  const isGuide = post.category?.slug === 'guides'
  const guideItems = isGuide
    ? (post.body ?? [])
        .filter((b: any) => b._type === 'blogProductEmbed' && b.productHandle)
        .map((b: any) => productMap[b.productHandle as string])
        .filter((p): p is Product => Boolean(p))
        .map(p => ({
          name:  p.title,
          url:   `https://xdipx.com/products/${p.handle}`,
          image: p.images?.[0]?.url ?? null,
        }))
    : []

  const sources = post.extras?.sources ?? []

  return (
    <article className="max-w-[75rem] mx-auto px-4 md:px-6 xl:px-8 py-6 sm:py-10">
      <ReadingProgress />
      <BlogStructuredData post={post} readingTime={post.readingTime} />
      <BreadcrumbStructuredData items={breadcrumbSchema} />
      {guideItems.length > 0 && (
        <ItemListStructuredData
          name={post.seoTitle ?? post.title}
          url={`https://xdipx.com/notebook/${post.slug}`}
          items={guideItems}
        />
      )}

      <BreadcrumbNav items={breadcrumbs} />

      <div className="mt-6">
        <BlogHero post={post} readingTime={post.readingTime} />
      </div>

      <div className="mt-10 lg:grid lg:grid-cols-[1fr_260px] lg:gap-12">
        {/* Main content */}
        <div className="min-w-0 max-w-[65ch] mx-auto lg:mx-0">
          <BlogBody body={post.body ?? []} productMap={productMap} />

          {/* Sources & review — the trust footer (art direction §7) */}
          {(sources.length > 0 || post.extras?.reviewedNote) && (
            <Reveal variant="fade" as="section" className="mt-8 bg-paper-2 rounded-lg p-5 md:p-6">
              <p className="kicker mb-2.5">Sources &amp; review</p>
              <p className="text-sm text-ink-3 leading-[1.55]">
                {post.extras?.reviewedNote ??
                  'Facts in this piece trace to product specs, materials, and patterns in verified reviews.'}
              </p>
              {sources.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {sources.map((s, i) => (
                    <li key={i} className="text-sm text-ink-2">
                      {s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-coral underline decoration-1 underline-offset-2 hover:text-coral-2 transition-colors"
                        >
                          {s.label}
                        </a>
                      ) : (
                        s.label
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Reveal>
          )}

          <SeriesNav extras={post.extras} />

          <div className="mt-10 pt-8 border-t border-line">
            <ShareButtons
              url={`https://xdipx.com/notebook/${post.slug}`}
              title={post.title}
              image={post.ogImageUrl ?? post.heroImageUrl ?? null}
            />

            {post.author && (
              <div className="mt-8 flex items-start gap-4 bg-paper border border-line rounded-lg p-5">
                {post.author.avatarUrl ? (
                  <SanityImage
                    src={post.author.avatarUrl}
                    alt={post.author.name}
                    widths={[112, 168]}
                    fallbackWidth={112}
                    width={56}
                    height={56}
                    className="w-14 h-14 rounded-full object-cover shrink-0 bg-paper-3"
                  />
                ) : (
                  <div
                    className="w-14 h-14 rounded-full bg-paper-3 text-ink flex items-center justify-center text-xl shrink-0"
                    style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
                  >
                    {post.author.name.charAt(0)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <Link
                    to={`/notebook/by/${post.author.slug}`}
                    className="text-ink hover:text-coral transition-colors text-lg"
                    style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
                  >
                    {post.author.name}
                  </Link>
                  {post.author.role && <p className="kicker mt-0.5">{post.author.role}</p>}
                  {post.author.bio && (
                    <p className="text-sm text-ink-3 mt-2 leading-[1.55]">{post.author.bio}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3">
                    <Link
                      to={`/notebook/by/${post.author.slug}`}
                      className="link-coral text-coral text-sm font-medium"
                    >
                      More from {post.author.name} →
                    </Link>
                    {(post.author.socialLinks ?? []).map(s =>
                      s.url ? (
                        <a
                          key={s.url}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-ink-3 hover:text-coral transition-colors capitalize"
                        >
                          {s.platform === 'x' ? 'X' : s.platform}
                        </a>
                      ) : null,
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sticky rail (desktop only) */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-4">
            <TableOfContents body={post.body ?? []} />

            <div className="border border-line rounded-lg p-4">
              <p
                className="text-ink text-base leading-tight"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
              >
                Rather just ask Emma?
              </p>
              <p className="text-[13px] text-ink-3 mt-2 leading-[1.5]">
                She'll message back over text or email. No call, no pressure.
              </p>
              <Link to="/contact" className="link-coral text-coral text-sm font-medium inline-block mt-3">
                Ask Emma →
              </Link>
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile TOC */}
      <div className="lg:hidden mt-6">
        <TableOfContents body={post.body ?? []} />
      </div>

      <PostPagination prevPost={post.prevPost} nextPost={post.nextPost} />

      <div className="mt-12">
        <NotebookSubscribe variant="post" settings={notebookSettings} />
      </div>

      <RelatedPosts posts={post.relatedPosts ?? []} />
    </article>
  )
}
