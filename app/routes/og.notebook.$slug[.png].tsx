/**
 * /og/notebook/{slug}.png — designed share card for a Notebook post (image
 * brief §5). Referenced as the default og:image on posts with no explicit
 * ogImage; an explicit ogImage redirects here so the URL stays stable either
 * way. Long CDN cache — the card only changes when the post title does.
 */
import type { LoaderFunctionArgs } from 'react-router'
import { data, redirect } from 'react-router'
import { getBlogPost } from '~/lib/sanity.server'
import { renderNotebookOgCard } from '~/lib/og-card.server'

export async function loader({ params }: LoaderFunctionArgs) {
  const slug = params['slug'] ?? ''
  const post = await getBlogPost(slug)
  if (!post) throw data('Post not found', { status: 404 })

  // An editor-supplied ogImage always wins over the generated card.
  if (post.ogImageUrl) return redirect(post.ogImageUrl, 302)

  const png = await renderNotebookOgCard({
    title: post.title,
    ...(post.category ? { categoryName: post.category.name, categorySlug: post.category.slug } : {}),
    ...(post.heroImageUrl ? { heroImageUrl: post.heroImageUrl } : {}),
    ...(post.extras?.series ? { kicker: `The Notebook · ${post.extras.series.title}` } : {}),
  })

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
    },
  })
}
