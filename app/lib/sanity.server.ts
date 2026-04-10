import { createClient } from '@sanity/client'
import type { HomepageSections, ContentBlock, AnnouncementMessage, SiteSettings, SanityPage, BlogPostCard, BlogPost, BlogCategory, BlogHomepage } from '~/types/cms'

// Shared field projection reused by homepage + product page queries
const CONTENT_BLOCKS_PROJECTION = `
  _type, _key, active, order,
  // announcementBar
  messages, rotationIntervalMs, bgStyle,
  // promoBanner
  headline, subtext, ctaLabel, ctaLink, layout,
  "image": image{ "url": asset->url, alt },
  // editorialTiles
  eyebrow, heading,
  "tiles": tiles[]{
    label, body, link, linkLabel, emoji,
    "image": image{ "url": asset->url, alt }
  },
  // categoryGrid + testimonials share the field name "items" — use select() to avoid collision
  "items": select(
    _type == "categoryGrid" => items[]{ label, link, emoji, "image": image{ "url": asset->url, alt } },
    _type == "testimonials"  => items[]{ quote, author, rating, verified }
  ),
  columns,
  // productCarousel
  source, shopifyTag, collectionHandle,
  "productHandles": productHandles[]{ handle },
  productLimit, layout,
  // playTogetherBanner
  body, imagePosition,
  // brandLogoWall
  "logos": logos[]{ brand, emoji, link, "logo": logo{ "url": asset->url, alt } },
  // richText — resolve inline image assets; body is also used by playTogetherBanner (plain text)
  "body": select(
    _type == "richText" => body[]{ ..., _type == "image" => { ..., "asset": { "url": asset->url } } },
    body
  ),
  bgColor, maxWidth,
`

const projectId = process.env['SANITY_PROJECT_ID']
const dataset   = process.env['SANITY_DATASET'] ?? 'production'
const apiVersion = '2024-10-01'

// ─── Client ───────────────────────────────────────────────────────────────

function getClient(withToken = false, preview = false) {
  if (!projectId) return null
  // Always include the API token — the dataset requires auth for reads.
  // Use CDN for normal reads (fast), bypass CDN for writes + preview (fresh).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient({ projectId, dataset, apiVersion, useCdn: !withToken && !preview, token: process.env['SANITY_API_TOKEN'], perspective: preview ? 'previewDrafts' : 'published' } as any)
}

export function isPreviewRequest(request: Request): boolean {
  const cookie = request.headers.get('cookie') ?? ''
  return cookie.includes('__sanity_preview=1')
}

// ─── In-memory cache (60s TTL) ────────────────────────────────────────────

let _cache: { data: HomepageSections; ts: number } | null = null

const HOMEPAGE_GROQ = `
  *[_id == "singleton.homepage"][0]{
    _id,
    "sections": sections[active == true] | order(order asc) { ${CONTENT_BLOCKS_PROJECTION} }
  }
`

export async function getHomepageSections(preview = false): Promise<HomepageSections | null> {
  if (!projectId) return null

  // Skip cache in preview mode to always serve latest drafts
  if (!preview && _cache && Date.now() - _cache.ts < 60_000) return _cache.data

  try {
    const client = getClient(false, preview)
    if (!client) return null
    const data = await client.fetch<HomepageSections>(HOMEPAGE_GROQ)
    if (data && !preview) _cache = { data, ts: Date.now() }
    return data ?? null
  } catch (err) {
    console.error('[sanity] getHomepageSections error:', err)
    return _cache?.data ?? null
  }
}

// ─── Mutation helpers (for admin / AI agent use) ──────────────────────────

export async function upsertAnnouncementBar(messages: AnnouncementMessage[]): Promise<void> {
  const client = getClient(true)
  if (!client) throw new Error('Sanity not configured')
  await client.createIfNotExists({ _id: 'singleton.homepage', _type: 'homepageSections', sections: [] })
  await client
    .patch('singleton.homepage')
    .setIfMissing({ sections: [] })
    .set({
      'sections[_type=="announcementBar"].messages': messages,
    })
    .commit()
  _cache = null
}

export async function addCmsBlock(block: Omit<ContentBlock, '_key'>): Promise<void> {
  const client = getClient(true)
  if (!client) throw new Error('Sanity not configured')
  const key = `${block._type}-${Date.now()}`
  await client
    .createIfNotExists({ _id: 'singleton.homepage', _type: 'homepageSections', sections: [] })
  await client
    .patch('singleton.homepage')
    .setIfMissing({ sections: [] })
    .append('sections', [{ ...block, _key: key }])
    .commit()
  _cache = null
}

export async function updateCmsBlock(key: string, patch: Record<string, unknown>): Promise<void> {
  const client = getClient(true)
  if (!client) throw new Error('Sanity not configured')
  // Sanity doesn't support in-array patching by key natively via REST;
  // use the transaction API with a GROQ-targeted patch
  await client
    .patch('singleton.homepage')
    .set(
      Object.fromEntries(
        Object.entries(patch).map(([field, value]) => [`sections[_key=="${key}"].${field}`, value])
      )
    )
    .commit()
  _cache = null
}

export async function removeCmsBlock(key: string): Promise<void> {
  const client = getClient(true)
  if (!client) throw new Error('Sanity not configured')
  await client
    .patch('singleton.homepage')
    .unset([`sections[_key=="${key}"]`])
    .commit()
  _cache = null
}

export function invalidateCmsCache(): void {
  _cache = null
}

// ─── Shopify → Sanity product sync ───────────────────────────────────────────

/**
 * Creates a productPage document in Sanity for a Shopify product if one doesn't
 * already exist. Safe to call repeatedly — uses createIfNotExists (no-op if
 * the doc is already there).
 */
async function uploadImageToSanity(
  writeClient: ReturnType<typeof getClient>,
  imageUrl: string,
  filename: string,
): Promise<string | null> {
  if (!writeClient) return null
  try {
    const res = await fetch(imageUrl)
    if (!res.ok) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    const asset = await writeClient.assets.upload('image', buffer, { filename }) as { url: string }
    return asset.url ?? null
  } catch {
    return null
  }
}

export async function upsertProductPage(params: {
  handle: string
  shopifyProductId: string
  title: string
  imageUrl?: string
}): Promise<{ created: boolean }> {
  const writeClient = getClient(true)
  if (!writeClient) throw new Error('Sanity not configured — SANITY_API_TOKEN or SANITY_PROJECT_ID missing')

  // Check by shopifyHandle first — the doc may exist with a different _id
  // (e.g. manually created docs use "product-{handle}" not "productPage-{handle}")
  const existing = await writeClient.fetch<{ _id: string; previewImageUrl?: string } | null>(
    `*[_type == "productPage" && shopifyHandle == $handle][0]{ _id, previewImageUrl }`,
    { handle: params.handle },
  )

  let docId: string
  let created: boolean

  if (existing) {
    docId = existing._id
    created = false
  } else {
    docId = `productPage-${params.handle}`
    await writeClient.createIfNotExists({
      _id: docId,
      _type: 'productPage',
      shopifyHandle: params.handle,
      shopifyProductId: params.shopifyProductId,
      title: params.title,
    })
    created = true
  }

  // Upload image to Sanity's own CDN so Studio can render it (Shopify CDN is blocked by Studio CSP)
  if (params.imageUrl) {
    const alreadyHasSanityImage = existing?.previewImageUrl?.includes('cdn.sanity.io')
    if (!alreadyHasSanityImage) {
      const sanityUrl = await uploadImageToSanity(
        writeClient,
        params.imageUrl,
        `${params.handle}-preview.jpg`,
      )
      if (sanityUrl) {
        await writeClient.patch(docId).set({ previewImageUrl: sanityUrl }).commit()
      }
    }
  }

  return { created }
}

// ─── Site Settings ────────────────────────────────────────────────────────────

let _settingsCache: { data: SiteSettings; ts: number } | null = null

export async function getSiteSettings(): Promise<SiteSettings | null> {
  if (!projectId) return null
  if (_settingsCache && Date.now() - _settingsCache.ts < 300_000) return _settingsCache.data
  try {
    const client = getClient()
    if (!client) return null
    const data = await client.fetch<SiteSettings>(
      `*[_id == "singleton.siteSettings"][0]{
        _id,
        "logoUrl": logo.asset->url,
        "logoAlt": logo.alt,
        buyButtonText,
        megaMenuBanners[] { _key, menuLabel, position, link, "imageUrl": image.asset->url, "imageAlt": image.alt },
        socialLinks[],
        footerTagline, footerDiscreetHeading, footerDiscreetBody, footerCopyright, footerDisclaimer,
        footerColumns[] { _key, heading, links[] { _key, label, url } }
      }`
    )
    if (data) _settingsCache = { data, ts: Date.now() }
    return data ?? null
  } catch (err) {
    console.error('[sanity] getSiteSettings error:', err)
    return _settingsCache?.data ?? null
  }
}

// ─── Product Page Content ─────────────────────────────────────────────────────

export async function getProductPageBlocks(handle: string): Promise<ContentBlock[]> {
  if (!projectId) return []
  try {
    const client = getClient()
    if (!client) return []
    const data = await client.fetch<{ sections: ContentBlock[] } | null>(
      `*[_type == "productPage" && shopifyHandle == $handle][0]{
        "sections": contentBlocks[active == true] | order(order asc) { ${CONTENT_BLOCKS_PROJECTION} }
      }`,
      { handle }
    )
    return data?.sections ?? []
  } catch (err) {
    console.error('[sanity] getProductPageBlocks error:', err)
    return []
  }
}

// ─── Generic Pages ─────────────────────────────────────────────────────────────

export async function getPage(slug: string, preview = false): Promise<SanityPage | null> {
  if (!projectId) { console.warn('[sanity] getPage: no projectId'); return null }
  try {
    const client = getClient(false, preview)
    if (!client) { console.warn('[sanity] getPage: no client'); return null }
    console.log('[sanity] getPage fetching slug:', slug)
    const result = await client.fetch<SanityPage | null>(
      `*[_type == "page" && slug.current == $slug][0]{
        _id,
        title,
        "slug": slug.current,
        seoTitle,
        seoDescription,
        "sections": sections[] { ${CONTENT_BLOCKS_PROJECTION} }
      }`,
      { slug },
    )
    console.log('[sanity] getPage result:', result ? `found "${result.title}"` : 'null')
    return result
  } catch (err) {
    console.error('[sanity] getPage error:', err)
    return null
  }
}

export async function getPageList(): Promise<{ title: string; slug: string }[]> {
  if (!projectId) return []
  try {
    const client = getClient()
    if (!client) return []
    return await client.fetch<{ title: string; slug: string }[]>(
      `*[_type == "page"] | order(title asc) { title, "slug": slug.current }`,
    )
  } catch (err) {
    console.error('[sanity] getPageList error:', err)
    return []
  }
}

// ─── Blog Homepage ───────────────────────────────────────────────────────────

export async function getBlogHomepage(preview = false): Promise<BlogHomepage | null> {
  if (!projectId) return null
  try {
    const client = getClient(false, preview)
    if (!client) return null
    return await client.fetch<BlogHomepage | null>(
      `*[_id == "singleton.blogHomepage"][0]{
        heading, subtext,
        "heroImageUrl": heroImage.asset->url,
        heroImageAlt
      }`,
    )
  } catch (err) {
    console.error('[sanity] getBlogHomepage error:', err)
    return null
  }
}

// ─── Blog ────────────────────────────────────────────────────────────────────

const _blogCache = new Map<string, { data: unknown; ts: number }>()
const BLOG_CACHE_TTL = 60_000       // 60s
const BLOG_CAT_CACHE_TTL = 300_000  // 5min

function getCachedBlog<T>(key: string, ttl: number): T | null {
  const entry = _blogCache.get(key)
  if (entry && Date.now() - entry.ts < ttl) return entry.data as T
  return null
}

function setCachedBlog(key: string, data: unknown) {
  _blogCache.set(key, { data, ts: Date.now() })
}

export function invalidateBlogCache(): void {
  _blogCache.clear()
}

const BLOG_POST_CARD_PROJECTION = `
  _id, title, "slug": slug.current, excerpt, publishedAt, featured,
  "heroImageUrl": heroImage.asset->url, heroImageAlt,
  "author": author->{ name, "slug": slug.current, bio, "avatarUrl": avatar.asset->url, role },
  "category": category->{ name, "slug": slug.current, color }
`

export function calculateReadingTime(body: unknown[]): number {
  const text = (body ?? [])
    .filter((b: any) => b._type === 'block')
    .map((b: any) => (b.children ?? []).map((c: any) => c.text ?? '').join(''))
    .join(' ')
  return Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length / 200))
}

export async function getBlogPosts(opts: {
  page?: number
  perPage?: number
  category?: string
  featured?: boolean
} = {}): Promise<{ posts: BlogPostCard[]; total: number }> {
  if (!projectId) return { posts: [], total: 0 }

  const page = opts.page ?? 1
  const perPage = opts.perPage ?? 12
  const start = (page - 1) * perPage
  const end = start + perPage

  const cacheKey = `posts:${page}:${perPage}:${opts.category ?? ''}:${opts.featured ?? ''}`
  const cached = getCachedBlog<{ posts: BlogPostCard[]; total: number }>(cacheKey, BLOG_CACHE_TTL)
  if (cached) return cached

  try {
    const client = getClient()
    if (!client) return { posts: [], total: 0 }

    let filter = `_type == "blogPost" && status == "published"`
    const params: Record<string, unknown> = {}

    if (opts.category) {
      filter += ` && category->slug.current == $category`
      params.category = opts.category
    }
    if (opts.featured) {
      filter += ` && featured == true`
    }

    const [rawPosts, total] = await Promise.all([
      client.fetch<Omit<BlogPostCard, 'readingTime'>[]>(
        `*[${filter}] | order(publishedAt desc) [${start}...${end}] { ${BLOG_POST_CARD_PROJECTION}, "bodyText": body[_type == "block"]{ "text": children[].text } }`,
        params,
      ),
      client.fetch<number>(`count(*[${filter}])`, params),
    ])

    const posts: BlogPostCard[] = (rawPosts ?? []).map((p: any) => {
      const words = (p.bodyText ?? []).flatMap((b: any) => (b.text ?? []).join('')).join(' ')
      const readingTime = Math.max(1, Math.ceil(words.split(/\s+/).filter(Boolean).length / 200))
      const { bodyText: _, ...rest } = p
      return { ...rest, readingTime }
    })

    const result = { posts, total }
    setCachedBlog(cacheKey, result)
    return result
  } catch (err) {
    console.error('[sanity] getBlogPosts error:', err)
    return { posts: [], total: 0 }
  }
}

export async function getBlogPost(slug: string, preview = false): Promise<BlogPost | null> {
  if (!projectId) return null

  const cacheKey = `post:${slug}`
  if (!preview) {
    const cached = getCachedBlog<BlogPost>(cacheKey, BLOG_CACHE_TTL)
    if (cached) return cached
  }

  try {
    const client = getClient(false, preview)
    if (!client) return null

    const filter = preview
      ? `_type == "blogPost" && slug.current == $slug`
      : `_type == "blogPost" && slug.current == $slug && status == "published"`

    const raw = await client.fetch<any>(
      `*[${filter}][0]{
        ${BLOG_POST_CARD_PROJECTION},
        _updatedAt,
        body[]{
          ...,
          _type == "blogImage" => {
            ...,
            "image": image{ "url": asset->url, alt },
            "secondImage": secondImage{ "url": asset->url }
          }
        },
        seoTitle, seoDescription, noIndex,
        "ogImageUrl": ogImage.asset->url,
        tags,
        "relatedPosts": relatedPosts[]->{
          ${BLOG_POST_CARD_PROJECTION}
        }
      }`,
      { slug },
    )

    if (!raw) return null

    const readingTime = calculateReadingTime(raw.body ?? [])
    const relatedPosts = (raw.relatedPosts ?? []).map((rp: any) => ({
      ...rp,
      readingTime: 0, // don't fetch body for related posts
    }))

    const post: BlogPost = { ...raw, readingTime, relatedPosts }
    if (!preview) setCachedBlog(cacheKey, post)
    return post
  } catch (err) {
    console.error('[sanity] getBlogPost error:', err)
    return null
  }
}

export async function getBlogCategories(): Promise<BlogCategory[]> {
  if (!projectId) return []

  const cacheKey = 'blogCategories'
  const cached = getCachedBlog<BlogCategory[]>(cacheKey, BLOG_CAT_CACHE_TTL)
  if (cached) return cached

  try {
    const client = getClient()
    if (!client) return []
    const data = await client.fetch<BlogCategory[]>(
      `*[_type == "blogCategory"] | order(name asc) {
        name, "slug": slug.current, description, color, seoTitle, seoDescription
      }`,
    )
    if (data) setCachedBlog(cacheKey, data)
    return data ?? []
  } catch (err) {
    console.error('[sanity] getBlogCategories error:', err)
    return []
  }
}

export async function getBlogPostsForSitemap(): Promise<{ slug: string; publishedAt: string; _updatedAt: string }[]> {
  if (!projectId) return []
  try {
    const client = getClient()
    if (!client) return []
    return await client.fetch(
      `*[_type == "blogPost" && status == "published"] | order(publishedAt desc) {
        "slug": slug.current, publishedAt, _updatedAt
      }`,
    )
  } catch (err) {
    console.error('[sanity] getBlogPostsForSitemap error:', err)
    return []
  }
}

export async function getProductHandlesForSitemap(): Promise<{ handle: string; _updatedAt: string }[]> {
  if (!projectId) return []
  try {
    const client = getClient()
    if (!client) return []
    return await client.fetch(
      `*[_type == "productPage" && defined(shopifyHandle)] | order(title asc) {
        "handle": shopifyHandle, _updatedAt
      }`,
    )
  } catch (err) {
    console.error('[sanity] getProductHandlesForSitemap error:', err)
    return []
  }
}
