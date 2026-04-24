import { createClient } from '@sanity/client'
import type { HomepageSections, ContentBlock, AnnouncementMessage, SiteSettings, SanityPage, BlogPostCard, BlogPost, BlogCategory, BlogHomepage, BlogAuthor, EmmaHeroSettings, EmmaPersona, EmmaPreset, Editor } from '~/types/cms'
import { cached, invalidateCache } from '~/lib/kv.server'

// Shared field projection reused by homepage + product page queries.
// Inline blocks project all their own fields; reference entries (emmaCuratedRail)
// dereference and surface as flattened block-shaped objects with _type == 'emmaCuratedRail'.
// Only "live" rails surface — drafts and archived rails are filtered out post-projection.
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
  // categoryGrid + testimonials use inline item objects; trustBar uses references.
  // Keep them in separate fields — combining them via select() silently null-derefs
  // the trustBar references (GROQ quirk). TrustBarBlock reads trustItems.
  "items": select(
    _type == "categoryGrid" => items[]{ label, link, emoji, "image": image{ "url": asset->url, alt } },
    _type == "testimonials" => items[]{ quote, author, rating, verified }
  ),
  "trustItems": select(
    _type == "trustBar" => items[]->{ icon, headline, subheadline, active }
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
  // editorBio — dereference the editor singleton at query time so the block
  // always renders live data without a second round-trip.
  variant, headingOverride, hideLongBio, hideSocials, showCta,
  "editor": select(
    _type == "editorBio" => *[_id == "singleton.editor"][0]{
      name, role,
      "photoUrl": photo.asset->url,
      "photoAlt": photo.alt,
      shortBio, longBio,
      "picksSince": picksSince,
      instagram, email
    }
  ),
`

const projectId = process.env['SANITY_PROJECT_ID']
const dataset   = process.env['SANITY_DATASET'] ?? 'production'
const apiVersion = '2024-10-01'

// ─── Client ───────────────────────────────────────────────────────────────

function getClient(withToken = false, preview = false, perspective?: 'raw' | 'published' | 'previewDrafts') {
  if (!projectId) return null
  // Always include the API token — the dataset requires auth for reads.
  // Use CDN for normal reads (fast), bypass CDN for writes + preview (fresh).
  const resolvedPerspective = perspective ?? (preview ? 'previewDrafts' : 'published')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient({ projectId, dataset, apiVersion, useCdn: !withToken && !preview, token: process.env['SANITY_API_TOKEN'], perspective: resolvedPerspective } as any)
}

export function isPreviewRequest(request: Request): boolean {
  const cookie = request.headers.get('cookie') ?? ''
  return cookie.includes('__sanity_preview=1')
}

// ─── Two-tier cache (memory + KV) ─────────────────────────────────────────
// Uses the shared `cached()` helper so new Fluid Compute instances warm from
// KV instead of paying the Sanity round-trip on first request.

// Resolve mixed inline blocks + emmaCuratedRail references in a single pass.
// References get dereferenced and flattened to look like inline blocks; status
// and active are read from the dereferenced rail document.
const SECTIONS_WITH_REFS_PROJECTION = `
  sections[]{
    _key,
    ...select(
      // Named reference array items (e.g. emmaCuratedRailRef) store _type as the
      // custom name, not "reference" — so match by the presence of _ref instead.
      defined(_ref) => @->{
        _id, _type, active, order, heading, eyebrow, emmaAside, status, target,
        "productHandles": productHandles[]{ handle },
        layout, bgStyle, ctaLink, ctaLabel
      },
      { ${CONTENT_BLOCKS_PROJECTION} }
    )
  }[active == true && (status == "live" || !defined(status))]
`

const HOMEPAGE_GROQ = `
  *[_id == "singleton.homepage"][0]{
    _id,
    "sections": ${SECTIONS_WITH_REFS_PROJECTION}
  }
`

// v2 redesign — Emma hero settings singleton
const EMMA_HERO_GROQ = `
  *[_id == "singleton.emmaHero"][0]{
    heroVariant, eyebrow, headline, body, aside, pullQuote, pairProductHandle
  }
`

export async function getEmmaHeroSettings(preview = false): Promise<EmmaHeroSettings | null> {
  if (!projectId) return null

  const fetcher = async (): Promise<EmmaHeroSettings | null> => {
    try {
      const client = getClient(false, preview)
      if (!client) return null
      return (await client.fetch<EmmaHeroSettings>(EMMA_HERO_GROQ)) ?? null
    } catch (err) {
      console.error('[sanity] getEmmaHeroSettings error:', err)
      return null
    }
  }

  if (preview) return fetcher()
  return cached('sanity:emma-hero', 60, fetcher)
}

// Editor persona singleton — powers hero byline + /about E-E-A-T
const EDITOR_GROQ = `
  *[_id == "singleton.editor"][0]{
    name,
    role,
    "photoUrl": photo.asset->url,
    "photoAlt": photo.alt,
    shortBio,
    longBio,
    "picksSince": picksSince,
    instagram,
    email
  }
`

export async function getEditor(preview = false): Promise<Editor | null> {
  if (!projectId) return null

  const fetcher = async (): Promise<Editor | null> => {
    try {
      const client = getClient(false, preview)
      if (!client) return null
      const raw = await client.fetch<Partial<Editor> | null>(EDITOR_GROQ)
      if (!raw?.name) return null
      return {
        name:       raw.name,
        role:       raw.role ?? 'Editor',
        photoUrl:   raw.photoUrl ?? null,
        photoAlt:   raw.photoAlt ?? null,
        shortBio:   raw.shortBio ?? null,
        longBio:    raw.longBio ?? null,
        picksSince: raw.picksSince ?? null,
        instagram:  raw.instagram ?? null,
        email:      raw.email ?? null,
      }
    } catch (err) {
      console.error('[sanity] getEditor error:', err)
      return null
    }
  }

  if (preview) return fetcher()
  return cached('sanity:editor', 300, fetcher)
}

// v2 redesign — Emma presets for Ask Emma rail
const EMMA_PRESETS_GROQ = `
  *[_type == "emmaPreset"] | order(order asc, label asc){
    label, "slug": slug.current, narratorCopy, moodTags, audienceTags, mattersTags, priceMax, featured, order
  }
`

export async function getEmmaPresets(preview = false): Promise<EmmaPreset[]> {
  if (!projectId) return []

  const fetcher = async (): Promise<EmmaPreset[]> => {
    try {
      const client = getClient(false, preview)
      if (!client) return []
      return (await client.fetch<EmmaPreset[]>(EMMA_PRESETS_GROQ)) ?? []
    } catch (err) {
      console.error('[sanity] getEmmaPresets error:', err)
      return []
    }
  }

  if (preview) return fetcher()
  return cached('sanity:emma-presets', 300, fetcher)
}

export async function getHomepageSections(preview = false): Promise<HomepageSections | null> {
  if (!projectId) return null

  const fetcher = async (): Promise<HomepageSections | null> => {
    try {
      const client = getClient(false, preview)
      if (!client) return null
      return (await client.fetch<HomepageSections>(HOMEPAGE_GROQ)) ?? null
    } catch (err) {
      console.error('[sanity] getHomepageSections error:', err)
      return null
    }
  }

  // Always serve latest drafts in preview — bypass cache.
  if (preview) return fetcher()
  return cached('sanity:homepage', 60, fetcher)
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
  invalidateCache('sanity:homepage')
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
  invalidateCache('sanity:homepage')
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
  invalidateCache('sanity:homepage')
}

export async function removeCmsBlock(key: string): Promise<void> {
  const client = getClient(true)
  if (!client) throw new Error('Sanity not configured')
  await client
    .patch('singleton.homepage')
    .unset([`sections[_key=="${key}"]`])
    .commit()
  invalidateCache('sanity:homepage')
}

export function invalidateCmsCache(): void {
  invalidateCache('sanity:homepage')
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
  imageUrl?: string | undefined
  // Enriched fields for search
  vendor?: string | undefined
  tags?: string[] | undefined
  tagline?: string | undefined
  description?: string | undefined
  seoDescription?: string | undefined
  category?: string | undefined
  price?: number | undefined
  compareAtPrice?: number | undefined
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

  // Patch enriched search fields if provided
  const searchFields: Record<string, unknown> = {}
  if (params.vendor !== undefined) searchFields.vendor = params.vendor
  if (params.tags !== undefined) searchFields.tags = params.tags
  if (params.tagline !== undefined) searchFields.tagline = params.tagline
  if (params.description !== undefined) searchFields.description = params.description
  if (params.seoDescription !== undefined) searchFields.seoDescription = params.seoDescription
  if (params.category !== undefined) searchFields.category = params.category
  if (params.price !== undefined) searchFields.price = params.price
  if (params.compareAtPrice !== undefined) searchFields.compareAtPrice = params.compareAtPrice

  if (Object.keys(searchFields).length > 0) {
    await writeClient.patch(docId).set(searchFields).commit()
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

// ─── Emma Picks (generated hero copy) ─────────────────────────────────────────
// One doc per featured product. Regenerating a pick replaces the whole doc so
// the content stays authoritative and the dataset stays searchable over time.

export async function upsertEmmaPick(params: {
  productId: string
  productHandle: string
  productTitle?: string | undefined
  brand?: string | undefined
  category?: string | undefined
  dealDate: string
  variant: 'loving' | 'bundle' | 'quote'
  eyebrow: string
  headline: string
  body: string
  aside: string
  pullQuote?: string | undefined
  voiceHash: string
  generatedAt: string
}): Promise<void> {
  const writeClient = getClient(true)
  if (!writeClient) throw new Error('Sanity not configured — SANITY_API_TOKEN or SANITY_PROJECT_ID missing')

  const doc: Record<string, unknown> = {
    _id: `emmaPick-${params.productHandle}`,
    _type: 'emmaPick',
    productId: params.productId,
    productHandle: params.productHandle,
    dealDate: params.dealDate,
    variant: params.variant,
    eyebrow: params.eyebrow,
    headline: params.headline,
    body: params.body,
    aside: params.aside,
    voiceHash: params.voiceHash,
    generatedAt: params.generatedAt,
  }
  if (params.productTitle !== undefined) doc.productTitle = params.productTitle
  if (params.brand !== undefined) doc.brand = params.brand
  if (params.category !== undefined) doc.category = params.category
  if (params.pullQuote !== undefined) doc.pullQuote = params.pullQuote

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await writeClient.createOrReplace(doc as any)
}

// ─── Site Settings ────────────────────────────────────────────────────────────

export async function getSiteSettings(): Promise<SiteSettings | null> {
  if (!projectId) return null
  return cached('sanity:site-settings', 300, async () => {
    try {
      const client = getClient()
      if (!client) return null
      const data = await client.fetch<SiteSettings>(
        `*[_id == "singleton.siteSettings"][0]{
          _id,
          "logoUrl": logo.asset->url,
          "logoAlt": logo.alt,
          buyButtonText,
          "siteBanner": siteBanner{ enabled, link, "imageUrl": image.asset->url, "imageAlt": coalesce(alt, image.alt) },
          megaMenuBanners[] { _key, menuLabel, position, link, "imageUrl": image.asset->url, "imageAlt": image.alt },
          socialLinks[],
          footerTagline, footerDiscreetHeading, footerDiscreetBody, footerCopyright, footerDisclaimer,
          footerColumns[] { _key, heading, links[] { _key, label, url } }
        }`
      )
      return data ?? null
    } catch (err) {
      console.error('[sanity] getSiteSettings error:', err)
      return null
    }
  })
}

// ─── Emma Persona ─────────────────────────────────────────────────────────────
// Thin projection of the Editor singleton for consumers that only need the
// avatar + display name (cart drawer, etc.). Single source of truth is
// `singleton.editor`.

export async function getEmmaPersona(): Promise<EmmaPersona | null> {
  if (!projectId) return null
  return cached('sanity:emma-persona', 300, async () => {
    try {
      const client = getClient()
      if (!client) return null
      const data = await client.fetch<{ avatarUrl: string | null; avatarAlt: string | null; displayName: string | null } | null>(
        `*[_id == "singleton.editor"][0]{
          "avatarUrl":   photo.asset->url,
          "avatarAlt":   coalesce(photo.alt, name, "Emma"),
          "displayName": coalesce(name, "Emma")
        }`
      )
      return data ?? null
    } catch (err) {
      console.error('[sanity] getEmmaPersona error:', err)
      return null
    }
  })
}

// ─── Product Page Content ─────────────────────────────────────────────────────

export async function getProductPageBlocks(handle: string): Promise<ContentBlock[]> {
  if (!projectId) return []
  try {
    const client = getClient()
    if (!client) return []
    const data = await client.fetch<{ sections: ContentBlock[] } | null>(
      `*[_type == "productPage" && shopifyHandle == $handle][0]{
        "sections": contentBlocks[]{
          _key,
          ...select(
            _type == "reference" => @->{
              _id, _type, active, order, heading, eyebrow, emmaAside, status, target,
              "productHandles": productHandles[]{ handle },
              layout, bgStyle, ctaLink, ctaLabel
            },
            { ${CONTENT_BLOCKS_PROJECTION} }
          )
        }[active == true && (status == "live" || !defined(status))]
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
  authorSlug?: string
} = {}): Promise<{ posts: BlogPostCard[]; total: number }> {
  if (!projectId) return { posts: [], total: 0 }

  const page = opts.page ?? 1
  const perPage = opts.perPage ?? 12
  const start = (page - 1) * perPage
  const end = start + perPage

  const cacheKey = `posts:${page}:${perPage}:${opts.category ?? ''}:${opts.featured ?? ''}:${opts.authorSlug ?? ''}`
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
    if (opts.authorSlug) {
      filter += ` && author->slug.current == $authorSlug`
      params.authorSlug = opts.authorSlug
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

export async function getBlogAuthor(slug: string): Promise<(BlogAuthor & { joinedAt?: string; postCount?: number }) | null> {
  if (!projectId) return null
  try {
    const client = getClient()
    if (!client) return null
    const data = await client.fetch<(BlogAuthor & { joinedAt?: string; postCount?: number }) | null>(
      `*[_type == "blogAuthor" && slug.current == $slug][0] {
        name, "slug": slug.current, bio, "avatarUrl": avatar.asset->url, role,
        "joinedAt": coalesce(joinedAt, _createdAt),
        "postCount": count(*[_type == "blogPost" && status == "published" && author._ref == ^._id])
      }`,
      { slug },
    )
    return data ?? null
  } catch (err) {
    console.error('[sanity] getBlogAuthor error:', err)
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

// ─── Emma Curated Rails (agent-generated, draft → live) ──────────────────────

export interface EmmaRailDraftInput {
  heading: string
  eyebrow?: string
  emmaAside?: string
  productHandles: string[]
  layout?: 'carousel' | 'grid' | 'grid-3'
  bgStyle?: 'white' | 'cream' | 'mist' | 'charcoal' | 'purple'
  ctaLink?: string
  ctaLabel?: string
  target: 'homepage' | 'pdp'
  rationale?: string
  sourceDealId: string
  order?: number
}

export interface EmmaRailDocument extends EmmaRailDraftInput {
  _id: string
  status: 'draft' | 'approved' | 'live' | 'archived'
  active: boolean
  generatedAt: string
}

/**
 * Create a new Emma rail as a draft (drafts.<id>). Returns the draft _id so the
 * admin flyout can edit it before publishing.
 */
export async function createEmmaRailDraft(input: EmmaRailDraftInput): Promise<{ _id: string }> {
  const writeClient = getClient(true)
  if (!writeClient) throw new Error('Sanity not configured')

  // Sanity doc IDs only allow [a-zA-Z0-9_.-]. Strip the gid:// prefix and
  // replace illegal chars (slashes, colons) with dashes.
  const safeDealId = input.sourceDealId
    .replace(/^gid:\/\/shopify\/Product\//, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
  const baseId = `emmaRail-${safeDealId}-${input.target}-${Date.now()}`
  const draftId = `drafts.${baseId}`

  const doc: Record<string, unknown> = {
    _id: draftId,
    _type: 'emmaCuratedRail',
    active: true,
    status: 'draft',
    order: input.order ?? 50,
    heading: input.heading,
    target: input.target,
    sourceDealId: input.sourceDealId,
    generatedAt: new Date().toISOString(),
    productHandles: input.productHandles.map((handle, i) => ({
      _type: 'productRef',
      _key: `ph-${i}-${Math.random().toString(36).slice(2, 8)}`,
      handle,
    })),
    layout: input.layout ?? 'carousel',
    bgStyle: input.bgStyle ?? 'cream',
  }
  if (input.eyebrow !== undefined)   doc.eyebrow   = input.eyebrow
  if (input.emmaAside !== undefined) doc.emmaAside = input.emmaAside
  if (input.ctaLink !== undefined)   doc.ctaLink   = input.ctaLink
  if (input.ctaLabel !== undefined)  doc.ctaLabel  = input.ctaLabel
  if (input.rationale !== undefined) doc.rationale = input.rationale

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await writeClient.create(doc as any)
  return { _id: draftId }
}

/**
 * Patch a rail document by id. Accepts both draft and published ids.
 */
export async function patchEmmaRail(
  id: string,
  patch: Partial<{
    heading: string
    eyebrow: string
    emmaAside: string
    productHandles: string[]
    layout: 'carousel' | 'grid' | 'grid-3'
    bgStyle: 'white' | 'cream' | 'mist' | 'charcoal' | 'purple'
    ctaLink: string
    ctaLabel: string
    status: 'draft' | 'approved' | 'live' | 'archived'
    active: boolean
    order: number
    target: 'homepage' | 'pdp'
  }>,
): Promise<void> {
  const writeClient = getClient(true)
  if (!writeClient) throw new Error('Sanity not configured')

  const set: Record<string, unknown> = { ...patch }
  if (patch.productHandles) {
    set.productHandles = patch.productHandles.map((handle, i) => ({
      _type: 'productRef',
      _key: `ph-${i}-${Math.random().toString(36).slice(2, 8)}`,
      handle,
    }))
  }
  await writeClient.patch(id).set(set).commit()
  invalidateCache('sanity:homepage')
}

/**
 * Publish a draft (drafts.<id> → <id>) — Sanity's standard publish flow.
 * Then patches status to 'live' on the published doc.
 */
export async function publishEmmaRailDraft(draftId: string): Promise<{ _id: string }> {
  const writeClient = getClient(true)
  if (!writeClient) throw new Error('Sanity not configured')

  if (!draftId.startsWith('drafts.')) {
    // Already published — just bump status
    await writeClient.patch(draftId).set({ status: 'live' }).commit()
    invalidateCache('sanity:homepage')
    return { _id: draftId }
  }

  const publishedId = draftId.slice('drafts.'.length)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const draft = await writeClient.getDocument(draftId) as any
  if (!draft) throw new Error(`Draft not found: ${draftId}`)

  // Strip _id and _rev so Sanity assigns the published id
  const { _id: _omit, _rev: _omitRev, ...rest } = draft

  await writeClient
    .transaction()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .createOrReplace({ ...(rest as any), _id: publishedId, status: 'live' })
    .delete(draftId)
    .commit()

  invalidateCache('sanity:homepage')
  return { _id: publishedId }
}

/**
 * Insert a reference to a rail document into homepageSections.sections[].
 */
export async function addRailRefToHomepage(railId: string): Promise<void> {
  const writeClient = getClient(true)
  if (!writeClient) throw new Error('Sanity not configured')
  await writeClient.createIfNotExists({
    _id: 'singleton.homepage',
    _type: 'homepageSections',
    sections: [],
  })
  await writeClient
    .patch('singleton.homepage')
    .setIfMissing({ sections: [] })
    .append('sections', [{
      _type: 'emmaCuratedRailRef',
      _key: `rail-${railId}-${Date.now()}`,
      _ref: railId,
    }])
    .commit()
  invalidateCache('sanity:homepage')
}

/**
 * Insert a reference to a rail document into a productPage's contentBlocks[].
 * Uses the productPage doc's shopifyHandle to locate the doc.
 */
export async function addRailRefToProductPage(handle: string, railId: string): Promise<void> {
  const writeClient = getClient(true)
  if (!writeClient) throw new Error('Sanity not configured')
  const doc = await writeClient.fetch<{ _id: string } | null>(
    `*[_type == "productPage" && shopifyHandle == $handle][0]{ _id }`,
    { handle },
  )
  if (!doc) throw new Error(`No productPage for handle "${handle}"`)
  await writeClient
    .patch(doc._id)
    .setIfMissing({ contentBlocks: [] })
    .append('contentBlocks', [{
      _type: 'emmaCuratedRailRef',
      _key: `rail-${railId}-${Date.now()}`,
      _ref: railId,
    }])
    .commit()
}

/**
 * Remove a rail reference from homepageSections.sections[].
 */
export async function removeRailRefFromHomepage(railId: string): Promise<void> {
  const writeClient = getClient(true)
  if (!writeClient) throw new Error('Sanity not configured')
  await writeClient
    .patch('singleton.homepage')
    .unset([`sections[_ref=="${railId}"]`])
    .commit()
  invalidateCache('sanity:homepage')
}

/**
 * Query rails by source deal id. Used by the lifecycle hooks (archive on
 * rotation, un-archive on recycled deal).
 */
export async function getRailsByDealId(
  dealId: string,
  opts?: { target?: 'homepage' | 'pdp'; status?: EmmaRailDocument['status'] },
): Promise<{ _id: string; target: 'homepage' | 'pdp'; status: EmmaRailDocument['status'] }[]> {
  if (!projectId) return []
  const writeClient = getClient(true)
  if (!writeClient) return []
  let filter = `_type == "emmaCuratedRail" && sourceDealId == $dealId && !(_id in path("drafts.**"))`
  if (opts?.target) filter += ` && target == "${opts.target}"`
  if (opts?.status) filter += ` && status == "${opts.status}"`
  return writeClient.fetch<{ _id: string; target: 'homepage' | 'pdp'; status: EmmaRailDocument['status'] }[]>(
    `*[${filter}]{ _id, target, status }`,
    { dealId },
  )
}

/**
 * Archive all homepage-targeted live rails for a deal. Called by the rotator
 * when the deal stops being today's pick. Rails flip status="archived" and
 * are pulled out of homepageSections. PDP rails are left alone (they're
 * evergreen cross-sells on the canonical product URL).
 */
export async function archiveHomepageRailsForDeal(dealId: string): Promise<{ archived: string[] }> {
  const writeClient = getClient(true)
  if (!writeClient) return { archived: [] }
  const rails = await getRailsByDealId(dealId, { target: 'homepage', status: 'live' })
  if (!rails.length) return { archived: [] }
  const archived: string[] = []
  for (const r of rails) {
    try {
      await writeClient.patch(r._id).set({ status: 'archived', active: false }).commit()
      await removeRailRefFromHomepage(r._id)
      archived.push(r._id)
    } catch (err) {
      console.error('[sanity] archiveHomepageRailsForDeal failed for', r._id, err)
    }
  }
  invalidateCache('sanity:homepage')
  return { archived }
}

/**
 * Un-archive previously archived homepage rails for a recycled deal. Returns
 * the rail ids that were re-livened so the caller can decide whether to skip
 * regeneration (if any rails were restored, the deal already has homepage rails).
 */
export async function unarchiveHomepageRailsForDeal(dealId: string): Promise<{ unarchived: string[] }> {
  const writeClient = getClient(true)
  if (!writeClient) return { unarchived: [] }
  const rails = await getRailsByDealId(dealId, { target: 'homepage', status: 'archived' })
  if (!rails.length) return { unarchived: [] }
  const unarchived: string[] = []
  for (const r of rails) {
    try {
      await writeClient.patch(r._id).set({ status: 'live', active: true }).commit()
      await addRailRefToHomepage(r._id)
      unarchived.push(r._id)
    } catch (err) {
      console.error('[sanity] unarchiveHomepageRailsForDeal failed for', r._id, err)
    }
  }
  invalidateCache('sanity:homepage')
  return { unarchived }
}

/**
 * Fetch full rail draft documents for a deal — used by the admin flyout to
 * show drafts pending review. Returns drafts and any unpublished (status==draft) docs.
 */
export async function getRailDraftsForDeal(dealId: string): Promise<EmmaRailDocument[]> {
  if (!projectId) return []
  // Need raw perspective so drafts.* documents come back too.
  const writeClient = getClient(true, false, 'raw')
  if (!writeClient) return []
  return writeClient.fetch<EmmaRailDocument[]>(
    `*[_type == "emmaCuratedRail" && sourceDealId == $dealId] | order(generatedAt desc){
      _id, status, active, order, heading, eyebrow, emmaAside, target,
      "productHandles": productHandles[].handle,
      layout, bgStyle, ctaLink, ctaLabel, sourceDealId, generatedAt, rationale
    }`,
    { dealId },
  )
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
