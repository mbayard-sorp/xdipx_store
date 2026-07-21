import { createClient } from '@sanity/client'
import type { SanityImageAssetDocument } from '@sanity/client'
import { createHash } from 'node:crypto'
import { toHTML } from '@portabletext/to-html'
import type { HomepageSections, ContentBlock, AnnouncementMessage, SiteSettings, SanityPage, BlogPostCard, BlogPost, BlogCategory, BlogHomepage, BlogAuthor, BlogSeries, BlogCategoryExtras, NotebookSettings, GlossaryTerm, EmmaHeroSettings, EmmaPersona, EmmaPreset, Editor, ProductFaq, TrustBarBlock, HomeConfig } from '~/types/cms'
import type { ProductTypeDial } from '~/types'
import { cached, invalidateCache } from '~/lib/kv.server'
import { normalizeTagList } from '~/lib/tag-normalize'
import { optimizeSanityImageUrls, sanityImageUrl } from '~/lib/sanity-image'

/**
 * Sanity arrays of objects require a unique `_key` per item. Generated from
 * a stable content hash (sha1 prefix) so re-writes are idempotent and editor
 * hand-edits aren't replaced as "new items" on the next backfill.
 *
 * Falls back to an index-suffixed hash on collisions.
 */
function withSanityKey<T extends object>(items: T[], hashOf: (item: T) => string): (T & { _key: string })[] {
  const seen = new Set<string>()
  return items.map((item, i) => {
    const base = createHash('sha1').update(hashOf(item)).digest('hex').slice(0, 12)
    let key = base
    if (seen.has(key)) key = `${base}${i.toString(36)}`
    seen.add(key)
    return { ...item, _key: key }
  })
}

type PortableTextBlocks = Parameters<typeof toHTML>[0]

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
  // wayfinderMosaic — shares eyebrow/heading (above) plus its own emphasis word.
  // "tiles" above is editorialTiles-shaped (no _key) — wayfinderMosaic tiles need
  // _key (the image bridge addresses tiles by _key), so they get their own field
  // name to avoid colliding with the editorialTiles projection. select() keeps
  // every other block type null-safe.
  emphasis,
  "wayfinderTiles": select(
    _type == "wayfinderMosaic" => tiles[]{
      _key, label, link, emmaAside,
      "image": image{ "url": asset->url, alt }
    }
  ),
  "promo": select(
    _type == "wayfinderMosaic" => promo{
      eyebrow, heading, emphasis, body, ctaLabel, ctaLink,
      "image": image{ "url": asset->url, alt }
    }
  ),
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
  // relatedGuides — dereference the curated blogPost picks to NotebookRail card
  // shape at query time. The status field rides along so getProductPageBlocks
  // can drop unpublished picks before they reach the storefront.
  "guides": select(
    _type == "relatedGuides" => guides[]->{
      _id, title, "slug": slug.current, excerpt, publishedAt, featured,
      "heroImageUrl": heroImage.asset->url, heroImageAlt, status
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
  const client = createClient({ projectId, dataset, apiVersion, useCdn: !withToken && !preview, token: process.env['SANITY_API_TOKEN'], perspective: resolvedPerspective } as any)
  // Read path only (every write/raw-snapshot caller passes withToken=true):
  // rewrite bare asset->url strings to CDN-transformed URLs so raw multi-MB
  // originals never reach a loader. See optimizeSanityImageUrls.
  if (!withToken) {
    const rawFetch = client.fetch.bind(client)
    client.fetch = (async (...args: Parameters<typeof rawFetch>) =>
      optimizeSanityImageUrls(await rawFetch(...args))) as typeof client.fetch
  }
  return client
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

// v2 redesign — Emma hero settings singleton, merged with the additive hero
// deep-link CTA singleton (singleton.emmaHeroStorefront). The emmaHeroSettings
// schema is frozen under the additive-only rule, so the CTA fields live apart
// and get folded into one EmmaHeroSettings payload here.
const EMMA_HERO_GROQ = `
{
  "settings": *[_id == "singleton.emmaHero"][0]{
    heroVariant, eyebrow, headline, body, aside, pullQuote, pairProductHandle
  },
  "cta": *[_id == "singleton.emmaHeroStorefront"][0]{
    primaryCtaLabel, primaryCtaLink, featuredProductHandle
  }
}
`

export async function getEmmaHeroSettings(preview = false): Promise<EmmaHeroSettings | null> {
  if (!projectId) return null

  const fetcher = async (): Promise<EmmaHeroSettings | null> => {
    try {
      const client = getClient(false, preview)
      if (!client) return null
      const raw = await client.fetch<{
        settings: EmmaHeroSettings | null
        cta: Pick<EmmaHeroSettings, 'primaryCtaLabel' | 'primaryCtaLink' | 'featuredProductHandle'> | null
      } | null>(EMMA_HERO_GROQ)
      if (!raw?.settings && !raw?.cta) return null
      return { ...raw.settings, ...raw.cta }
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

/**
 * Upload a raw image buffer (e.g. from fal.ai / Imagen generation) straight to
 * Sanity's asset store. Unlike the private `uploadImageToSanity` above (which
 * fetches a URL and only returns the CDN url), this returns the asset `_id`
 * too — callers need it to build a `sanityImageRef` for array-in-array patches
 * (tile/promo images) where a bare url string would null-deref the GROQ
 * `image{ "url": asset->url }` projection.
 */
export async function uploadBufferToSanity(
  buffer: Buffer,
  filename: string,
  contentType?: string,
): Promise<{ assetId: string; url: string }> {
  const client = getClient(true)
  if (!client) throw new Error('Sanity not configured')
  const asset: SanityImageAssetDocument = await client.assets.upload('image', buffer, {
    filename,
    ...(contentType ? { contentType } : {}),
  })
  return { assetId: asset._id, url: asset.url }
}

/**
 * Build the exact shape the `image{ "url": asset->url, alt }` GROQ projection
 * requires. A bare url string null-derefs `asset->url` — homepage image fields
 * always need a real `{ _type:'image', asset:{ _ref } }` reference.
 */
export function sanityImageRef(assetId: string, alt: string): {
  _type: 'image'
  asset: { _type: 'reference'; _ref: string }
  alt: string
} {
  return { _type: 'image', asset: { _type: 'reference', _ref: assetId }, alt }
}

/**
 * Patch an image onto one tile inside `sections[_key==blockKey].tiles[]` —
 * the array-in-array case `updateCmsBlock` can't express (it only patches a
 * field directly on the section, not a nested array item). Tiles are targeted
 * by `_key`, never by index.
 */
export async function updateCmsTileImage(
  blockKey: string,
  tileKey: string,
  assetId: string,
  alt: string,
): Promise<void> {
  const client = getClient(true)
  if (!client) throw new Error('Sanity not configured')
  await client
    .patch('singleton.homepage')
    .set({
      [`sections[_key=="${blockKey}"].tiles[_key=="${tileKey}"].image`]: sanityImageRef(assetId, alt),
    })
    .commit()
  invalidateCache('sanity:homepage')
}

/**
 * Patch an image onto a block's `promo.image` field — the single nested-field
 * case (no array-in-array addressing needed, but still one level deeper than
 * `updateCmsBlock` can reach in one field name).
 */
export async function updateCmsPromoImage(
  blockKey: string,
  assetId: string,
  alt: string,
): Promise<void> {
  const client = getClient(true)
  if (!client) throw new Error('Sanity not configured')
  await client
    .patch('singleton.homepage')
    .set({
      [`sections[_key=="${blockKey}"].promo.image`]: sanityImageRef(assetId, alt),
    })
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

const HOMEPAGE_DOC_ID = 'singleton.homepage'

/**
 * Full raw homepage singleton document (every field + section, incl. inactive
 * ones) — used to snapshot a last-good copy for the homepage healthcheck.
 * Returns null when Sanity is unconfigured or the doc doesn't exist.
 */
export async function getHomepageDocRaw(): Promise<Record<string, unknown> | null> {
  const client = getClient(true, false, 'raw')
  if (!client) return null
  const doc = await client.getDocument(HOMEPAGE_DOC_ID)
  return (doc as Record<string, unknown> | undefined) ?? null
}

/**
 * Restore (publish) a previously-snapshotted homepage singleton, used by the
 * healthcheck to roll back a broken auto-publish. Strips Sanity system fields,
 * forces the canonical id/type, and busts the CMS cache.
 */
export async function restoreHomepageDoc(snapshot: Record<string, unknown>): Promise<void> {
  const client = getClient(true, false, 'raw')
  if (!client) throw new Error('Sanity not configured — cannot restore homepage doc')
  // Drop ALL top-level system fields (_rev, _updatedAt, _createdAt, _originalId,
  // …) — nested _key/_type inside sections[] are content and must survive.
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(snapshot)) {
    if (!k.startsWith('_')) rest[k] = v
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.createOrReplace({ ...rest, _id: HOMEPAGE_DOC_ID, _type: 'homepageSections' } as any)
  invalidateCmsCache()
}

// ─── Shopify → Sanity product sync ───────────────────────────────────────────

/**
 * Wraps a plain string into a single-block portable-text array so it fits
 * schema fields typed as `array of block`. Search (search.server.ts,
 * ivr-search.server.ts) queries `pt::text(description)` — storing a raw
 * string throws an "expected array" schema error in Studio.
 */
function stringToPortableText(text: string): { _type: 'block'; _key: string; style: 'normal'; markDefs: []; children: { _type: 'span'; _key: string; text: string; marks: [] }[] }[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  return [{
    _type: 'block',
    _key: `d${Math.random().toString(36).slice(2, 10)}`,
    style: 'normal',
    markDefs: [],
    children: [{
      _type: 'span',
      _key: `s${Math.random().toString(36).slice(2, 10)}`,
      text: trimmed,
      marks: [],
    }],
  }]
}

async function uploadImageToSanity(
  writeClient: ReturnType<typeof getClient>,
  imageUrl: string,
  filename: string,
): Promise<string | null> {
  if (!writeClient) return null
  // Surface failures: previously this swallowed errors silently and the caller
  // had no way to retry or warn. Now we throw on fetch/upload failure and let
  // the caller decide (bulk-import wraps the whole upsert in retry+warnings).
  const res = await fetch(imageUrl)
  if (!res.ok) {
    throw new Error(`image fetch ${res.status} ${imageUrl}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  const asset = await writeClient.assets.upload('image', buffer, { filename }) as { url: string }
  return asset.url ?? null
}

export async function upsertProductPage(params: {
  handle: string
  shopifyProductId: string
  /** Optional on archive-only updates — required on first create. */
  title?: string
  imageUrl?: string | undefined
  /** PDP hero background image (Shopify CDN URL). Stored on the productPage as `moodImageUrl`. */
  moodImageUrl?: string | undefined
  // Enriched fields for search
  vendor?: string | undefined
  tags?: string[] | undefined
  tagline?: string | undefined
  description?: string | undefined
  seoTitle?: string | undefined
  seoDescription?: string | undefined
  /** Phase 2 — multi-select audience tags. */
  category?: Array<'for-him' | 'for-her' | 'couples'> | undefined
  // Emma discovery — auto-filled by bulk-import orchestrator. Drives chat / IVR / SMS filters.
  // Phase 1 rebuild — accepts the expanded ProductTypeDial enum (19 values) plus
  // the legacy values during the transitional Sanity-migration window. Stored
  // as a free-form string in Sanity productPage.productTypeDial.
  productTypeDial?: ProductTypeDial | string | undefined
  /** Phase 1 rebuild — new D1 hierarchical-taxonomy subtype, scoped to the
   *  parent productTypeDial. Stored as a string; validated at the orchestrator
   *  boundary against PRODUCT_SUBTYPES_BY_TYPE. */
  productSubtypeDial?: string | undefined
  moodTags?: string[] | undefined
  audienceTags?: string[] | undefined
  mattersTags?: string[] | undefined
  // IVR / voice surfaces — purpose-built for IVR / chat / SMS where descriptionHtml can't render.
  ivrExperience?: string[] | undefined
  ivrUseCase?: string[] | undefined
  ivrFeatures?: string[] | undefined
  // PDP FAQs — productPage.productFaqs[]. Renders visibly + emits FAQPage JSON-LD. Sanity-only.
  productFaqs?: Array<{ question: string; answer: string; category: string }> | undefined
  // Care & Specs — mirrors of Shopify metafields (xdipx.care_instructions /
  // .specifications / .box_contents). Source-of-truth lives on Shopify; the
  // backfill writes both surfaces from the same orchestrator output so Sanity
  // search projections + Studio editorial UX have the full picture.
  careInstructions?: string[] | undefined
  specifications?: string[] | undefined
  boxContents?: string[] | undefined
  // Sensation dial v2 — self-describing { items: [{label, value, proposed?}] }.
  // Mirror of xdipx.sensation_dial_v2.
  sensationDialV2?: { items: Array<{ label: string; value: number; proposed?: boolean }> } | undefined
  /** Manufacturer's verbatim title — mirror of xdipx.original_title. Stable
   *  source-of-truth for legal / sourcing / re-augmentation. */
  originalTitle?: string | undefined
  /** Soft-delete flag — search filters drop archived productPages. Set true when
   *  Nalpac flags the product as discontinued, false to un-archive. */
  archived?: boolean | undefined
  /** WS2c — import-time stub visibility gate. Opt-out semantics: pass `true`
   *  only when this call just created a stub for a Shopify DRAFT product;
   *  leave undefined otherwise so existing docs (and their current
   *  visibility) are untouched. Cleared to `false` by `markProductPageLive`
   *  when the product activates. See studio/schemas/productPage.js. */
  hiddenUntilLive?: boolean | undefined
}): Promise<{ created: boolean }> {
  // Use 'raw' perspective so drafts.* docs come back too — without it, the image block
  // can't see a draft that's masking the published version in Studio.
  const writeClient = getClient(true, false, 'raw')
  if (!writeClient) throw new Error('Sanity not configured — SANITY_API_TOKEN or SANITY_PROJECT_ID missing')

  // Check by shopifyHandle first — the doc may exist with a different _id
  // (e.g. manually created docs use "product-{handle}" not "productPage-{handle}").
  // Prefer the published version when both exist so our subsequent patches target it first.
  const existing = await writeClient.fetch<{ _id: string; previewImageUrl?: string } | null>(
    `*[_type == "productPage" && shopifyHandle == $handle] | order(_id asc)[0]{ _id, previewImageUrl }`,
    { handle: params.handle },
  )

  let docId: string
  let created: boolean

  if (existing) {
    docId = existing._id
    created = false
  } else {
    if (!params.title) {
      // First-create requires a title — without it the doc would fail Studio
      // validation and search projection. Archive-only callers should always
      // hit an existing doc; if they don't, log and bail.
      console.warn(`[upsertProductPage] no productPage doc for handle "${params.handle}" — skipping (archive/upsert without title)`)
      return { created: false }
    }
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
  // Title — keep Sanity in sync with Shopify product.title across re-runs.
  // Was previously only set on create, leaving stale titles on existing docs.
  if (params.title !== undefined) searchFields.title = params.title
  if (params.vendor !== undefined) searchFields.vendor = params.vendor
  if (params.tags !== undefined) {
    searchFields.tags = params.tags
    // Keep normalizedTags in lockstep — derived from tags via the canonical
    // slugifier so /search and /view-all faceted filtering can match
    // admin-curated taxonomy values against real product tags.
    searchFields.normalizedTags = normalizeTagList(params.tags)
  }
  if (params.tagline !== undefined) searchFields.tagline = params.tagline
  // description is a portable-text array in the schema (searchable via pt::text).
  // Wrap the raw string in a single block so it round-trips cleanly and search still hits.
  if (params.description !== undefined) searchFields.description = stringToPortableText(params.description)
  if (params.seoDescription !== undefined) searchFields.seoDescription = params.seoDescription
  if (params.category !== undefined) searchFields.category = params.category
  if (params.seoTitle !== undefined) searchFields.seoTitle = params.seoTitle
  if (params.moodImageUrl !== undefined) searchFields.moodImageUrl = params.moodImageUrl
  if (params.productTypeDial !== undefined) searchFields.productTypeDial = params.productTypeDial
  if (params.moodTags !== undefined) searchFields.moodTags = params.moodTags
  if (params.audienceTags !== undefined) searchFields.audienceTags = params.audienceTags
  if (params.mattersTags !== undefined) searchFields.mattersTags = params.mattersTags
  if (params.ivrExperience !== undefined) searchFields.ivrExperience = params.ivrExperience
  if (params.ivrUseCase !== undefined) searchFields.ivrUseCase = params.ivrUseCase
  if (params.ivrFeatures !== undefined) searchFields.ivrFeatures = params.ivrFeatures
  if (params.productFaqs !== undefined) {
    searchFields.productFaqs = withSanityKey(params.productFaqs, f => `${f.question}|${f.category}`)
  }
  // Phase 2 sync — mirror Shopify metafield content into productPage so search
  // projections + Studio editorial UX see everything the PDP renders. Source
  // of truth remains the Shopify metafield (xdipx.*); these are derived.
  if (params.careInstructions !== undefined)   searchFields.careInstructions   = params.careInstructions
  if (params.specifications !== undefined)     searchFields.specifications     = params.specifications
  if (params.boxContents !== undefined)        searchFields.boxContents        = params.boxContents
  if (params.sensationDialV2 !== undefined) {
    const items = params.sensationDialV2.items ?? []
    searchFields.sensationDialV2 = {
      ...params.sensationDialV2,
      items: withSanityKey(items, it => it.label),
    }
  }
  if (params.productSubtypeDial !== undefined) searchFields.productSubtypeDial = params.productSubtypeDial
  if (params.originalTitle !== undefined)      searchFields.originalTitle      = params.originalTitle
  // ivrMood mirror removed — IVR search now reads moodTags directly so there's
  // a single source of truth for mood tags on the productPage doc.
  if (params.archived !== undefined) searchFields.archived = params.archived
  if (params.hiddenUntilLive !== undefined) searchFields.hiddenUntilLive = params.hiddenUntilLive

  if (Object.keys(searchFields).length > 0) {
    await writeClient.patch(docId).set(searchFields).commit()
  }

  // Upload image to Sanity's own CDN so Studio can render it (Shopify CDN is blocked by Studio CSP).
  // Patch BOTH the published doc and any draft so Studio shows the image whether the doc has
  // pending edits or not — without this, a draft started in Studio masks the published image.
  if (params.imageUrl) {
    const publishedId = docId.replace(/^drafts\./, '')
    const draftId     = `drafts.${publishedId}`
    const states = await writeClient.fetch<{ _id: string; previewImageUrl?: string }[]>(
      `*[_id in [$pub, $dft]]{ _id, previewImageUrl }`,
      { pub: publishedId, dft: draftId },
    )
    const pub = states.find(s => !s._id.startsWith('drafts.'))
    const dft = states.find(s =>  s._id.startsWith('drafts.'))
    // Reuse the published image if it's already on Sanity's CDN; otherwise upload fresh.
    let sanityUrl: string | null = null
    if (pub?.previewImageUrl?.includes('cdn.sanity.io')) {
      sanityUrl = pub.previewImageUrl
    } else {
      sanityUrl = await uploadImageToSanity(writeClient, params.imageUrl, `${params.handle}-preview.jpg`)
    }
    if (sanityUrl) {
      // Patch whichever docs are missing the image (don't create a spurious draft).
      if (pub && pub.previewImageUrl !== sanityUrl) {
        await writeClient.patch(publishedId).set({ previewImageUrl: sanityUrl }).commit()
      }
      if (dft && dft.previewImageUrl !== sanityUrl) {
        await writeClient.patch(draftId).set({ previewImageUrl: sanityUrl }).commit()
      }
    }
  }

  return { created }
}

/**
 * WS2c — patch a productPage doc found by its Shopify product id, accepting
 * either the bare numeric id or the full gid (upsertProductPage always stores
 * the gid form on `shopifyProductId`, but callers like `activateShopifyProduct`
 * only have the numeric id, so this normalizes before matching). Generic:
 * callers pass whatever fields they need patched.
 *
 * Best-effort by design — returns `{ patched: false }` rather than throwing
 * when Sanity isn't configured or no matching doc exists, so callers (e.g.
 * `activateShopifyProduct`) can fire-and-forget without risking the Shopify
 * write that already happened.
 */
export async function patchProductPageByProductId(
  numericOrGidProductId: string,
  patch: Record<string, unknown>,
): Promise<{ patched: boolean }> {
  if (!projectId) return { patched: false }
  const writeClient = getClient(true, false, 'raw')
  if (!writeClient) return { patched: false }

  const gid = numericOrGidProductId.startsWith('gid://')
    ? numericOrGidProductId
    : `gid://shopify/Product/${numericOrGidProductId}`

  const doc = await writeClient.fetch<{ _id: string } | null>(
    `*[_type == "productPage" && shopifyProductId == $gid] | order(_id asc)[0]{ _id }`,
    { gid },
  )
  if (!doc) return { patched: false }

  await writeClient.patch(doc._id).set(patch).commit()
  return { patched: true }
}

/**
 * WS2c — clear the `hiddenUntilLive` import-stub flag the moment a product's
 * underlying Shopify record activates. Called from `activateShopifyProduct`
 * (app/lib/shopify.server.ts) — the universal chokepoint every activation
 * path (import publish, deal-rotator daily activation, admin queue
 * force-activate) already funnels through — so a draft-stage import stub
 * stops leaking into sitemap.xml / on-site search the moment it becomes
 * purchasable, regardless of which path activated it.
 */
export async function markProductPageLive(numericOrGidProductId: string): Promise<{ patched: boolean }> {
  return patchProductPageByProductId(numericOrGidProductId, { hiddenUntilLive: false })
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

// ─── PDP Defaults ─────────────────────────────────────────────────────────────
// Sitewide trust bar shown below the buy button on every product page.
// Trust items live as their own `trustItem` documents and are referenced from
// the singleton — same pattern (and same documents, if editors choose) as the
// homepage trust bar.
//
// GROQ quirk: combining `select()` with a trailing reference deref silently
// null-refs the items — see CONTENT_BLOCKS_PROJECTION above. Project
// `trustItems` directly here so TrustBarBlock can read it.

export async function getPdpTrustBar(): Promise<TrustBarBlock | null> {
  if (!projectId) return null
  return cached('sanity:pdp-trust-bar', 300, async () => {
    try {
      const client = getClient()
      if (!client) return null
      // Singleton lookup — Studio uses _id == "singleton.pdpDefaults" via the
      // structure config, but query by type so the bar still resolves if the
      // doc happens to live under a different id (e.g. seeded via the API
      // before Studio schema deploy).
      const data = await client.fetch<TrustBarBlock | null>(
        `*[_type == "pdpDefaults"] | order(_updatedAt desc)[0].trustBar{
          _type, _key, active, order, bgStyle,
          "trustItems": items[]->{ icon, headline, subheadline, active }
        }`
      )
      if (!data) return null
      // Drop items the editor has flipped to inactive so the rendered bar
      // doesn't have to filter; TrustBar's own filter remains as a guard.
      const trustItems = (data.trustItems ?? []).filter(
        (i): i is NonNullable<typeof i> => !!i && i.active !== false,
      )
      return { ...data, trustItems }
    } catch (err) {
      console.error('[sanity] getPdpTrustBar error:', err)
      return null
    }
  })
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
  const data = await cached('sanity:emma-persona', 300, async () => {
    try {
      const client = getClient()
      if (!client) return null
      return await client.fetch<{ avatarUrl: string | null; avatarAlt: string | null; displayName: string | null } | null>(
        `*[_id == "singleton.editor"][0]{
          "avatarUrl":   photo.asset->url,
          "avatarAlt":   coalesce(photo.alt, name, "Emma"),
          "displayName": coalesce(name, "Emma")
        }`
      )
    } catch (err) {
      console.error('[sanity] getEmmaPersona error:', err)
      return null
    }
  })
  if (!data) return null
  // Every consumer renders this avatar at 64px or less; w=192 covers 3x
  // displays. Applied outside cached() (idempotent — sanityImageUrl strips any
  // existing params) so stale KV entries holding the raw 2.18MB original are
  // fixed the moment this code deploys, not a TTL later.
  return {
    ...data,
    avatarUrl: data.avatarUrl ? sanityImageUrl(data.avatarUrl, { w: 192 }) : null,
  }
}

// ─── Product Page Content ─────────────────────────────────────────────────────

/**
 * Batch-fetch productPage `previewImageUrl` values keyed by Shopify handle.
 * Used as a thumbnail fallback in Emma chat product cards when a Shopify
 * product has no `images[0]` (newly imported items often lack a featured
 * image until the next sync run). Returns an empty Map on any failure so
 * callers can degrade gracefully.
 */
export async function getPreviewImagesByHandles(
  handles: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!projectId || handles.length === 0) return out
  try {
    const client = getClient()
    if (!client) return out
    const rows = await client.fetch<{ shopifyHandle: string; previewImageUrl?: string }[]>(
      `*[_type == "productPage" && shopifyHandle in $handles]{ shopifyHandle, previewImageUrl }`,
      { handles },
    )
    for (const r of rows ?? []) {
      if (r?.shopifyHandle && r.previewImageUrl) out.set(r.shopifyHandle, r.previewImageUrl)
    }
  } catch (err) {
    console.error('[sanity] getPreviewImagesByHandles error:', err)
  }
  return out
}

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
    // relatedGuides blocks carry dereferenced blogPost picks. Keep only
    // published ones and normalize to BlogPostCard shape (drop the transient
    // `status`; readingTime is display-only and unused by NotebookRail, so 0
    // is fine here).
    return (data?.sections ?? []).map((section: any) => {
      if (section?._type !== 'relatedGuides') return section
      const guides = (section.guides ?? [])
        .filter((g: any) => g && g.status === 'published')
        .map(({ status, ...card }: any) => ({ ...card, readingTime: 0 }))
      return { ...section, guides }
    }) as ContentBlock[]
  } catch (err) {
    console.error('[sanity] getProductPageBlocks error:', err)
    return []
  }
}

/**
 * Fetch the per-product FAQ list from Sanity. Returns [] when the product
 * has no `productFaqs` configured. Filters out entries missing question or
 * answer so the PDP never renders half-empty Q&A pairs (also keeps the
 * FAQPage JSON-LD valid).
 */
export async function getProductFaqs(handle: string): Promise<ProductFaq[]> {
  if (!projectId) return []
  try {
    const client = getClient()
    if (!client) return []
    const data = await client.fetch<{ faqs: ProductFaq[] | null } | null>(
      `*[_type == "productPage" && shopifyHandle == $handle][0]{
        "faqs": productFaqs[]{ question, answer, category }
      }`,
      { handle },
    )
    return (data?.faqs ?? [])
      .filter(f => f && f.question && f.answer)
      .map(f => ({ ...f, category: f.category ?? 'general' }))
  } catch (err) {
    console.error('[sanity] getProductFaqs error:', err)
    return []
  }
}

// ─── Collection Page (PLP SEO overrides) ─────────────────────────────────────

export type CollectionType = 'category' | 'brand' | 'theme'

export interface CollectionPageSanity {
  shopifyHandle:  string
  collectionType: CollectionType
  seoTitle:       string | null
  seoDescription: string | null
  h1:             string | null
  introHtml:      string | null
  heroImageUrl:   string | null
  heroImageAlt:   string | null
  faqs: Array<{ question: string; answer: string }>
  related: Array<{ handle: string; label: string }>
}

export async function getCollectionPage(handle: string, preview = false): Promise<CollectionPageSanity | null> {
  if (!projectId) return null
  try {
    const client = getClient(false, preview)
    if (!client) return null
    const data = await client.fetch<{
      shopifyHandle:  string
      collectionType: CollectionType | null
      seoTitle:       string | null
      seoDescription: string | null
      h1:             string | null
      introCopy:      unknown[] | null
      heroImage:      { url: string | null; alt: string | null } | null
      faqs:  Array<{ question: string; answer: string }> | null
      related: Array<{ handle: string; label: string }> | null
    } | null>(
      `*[_type == "collectionPage" && shopifyHandle == $handle][0]{
        shopifyHandle,
        collectionType,
        seoTitle,
        seoDescription,
        h1,
        introCopy,
        "heroImage": heroImageOverride{ "url": asset->url, alt },
        "faqs": faqs[]{ question, answer },
        "related": relatedCollections[]{ handle, label }
      }`,
      { handle },
    )
    if (!data) return null

    const introHtml = data.introCopy && data.introCopy.length > 0
      ? toHTML(data.introCopy as PortableTextBlocks)
      : null

    return {
      shopifyHandle:  data.shopifyHandle,
      collectionType: data.collectionType ?? 'category',
      seoTitle:       data.seoTitle ?? null,
      seoDescription: data.seoDescription ?? null,
      h1:             data.h1 ?? null,
      introHtml,
      heroImageUrl:   data.heroImage?.url ?? null,
      heroImageAlt:   data.heroImage?.alt ?? null,
      faqs:           (data.faqs ?? []).filter(f => f?.question && f?.answer),
      related:        (data.related ?? []).filter(r => r?.handle && r?.label),
    }
  } catch (err) {
    console.error('[sanity] getCollectionPage error:', err)
    return null
  }
}

/**
 * Bulk lookup of every collectionPage's collectionType, indexed by Shopify
 * handle. Used by the /collections hub to split the grid into "Shop by
 * category", "Shop by brand", and "Shop by theme" sections. Anything without
 * a collectionPage doc defaults to 'category' at the call site.
 */
export async function getCollectionTypeMap(): Promise<Map<string, CollectionType>> {
  const out = new Map<string, CollectionType>()
  if (!projectId) return out
  try {
    const client = getClient()
    if (!client) return out
    const data = await client.fetch<Array<{ shopifyHandle: string; collectionType: CollectionType | null }>>(
      `*[_type == "collectionPage"]{ shopifyHandle, collectionType }`,
    )
    for (const row of data ?? []) {
      if (row.shopifyHandle) {
        out.set(row.shopifyHandle, row.collectionType ?? 'category')
      }
    }
    return out
  } catch (err) {
    console.error('[sanity] getCollectionTypeMap error:', err)
    return out
  }
}

// ─── Collections Hub (editorial overrides) ─────────────────────────────────

export interface CollectionsHubSanity {
  seoTitle:       string | null
  seoDescription: string | null
  h1:             string | null
  introHtml:      string | null
  featured:       Array<{ handle: string; blurb: string | null }>
  faqs:           Array<{ question: string; answer: string }>
}

export async function getCollectionsHub(preview = false): Promise<CollectionsHubSanity | null> {
  if (!projectId) return null
  try {
    const client = getClient(false, preview)
    if (!client) return null
    const data = await client.fetch<{
      seoTitle:       string | null
      seoDescription: string | null
      h1:             string | null
      introCopy:      unknown[] | null
      featured:       Array<{ handle: string; blurb: string | null }> | null
      faqs:           Array<{ question: string; answer: string }> | null
    } | null>(
      `*[_type == "collectionsHub"][0]{
        seoTitle,
        seoDescription,
        h1,
        introCopy,
        "featured": featuredCollectionHandles[]{ handle, blurb },
        "faqs": faqs[]{ question, answer }
      }`,
    )
    if (!data) return null
    const introHtml = data.introCopy && data.introCopy.length > 0
      ? toHTML(data.introCopy as PortableTextBlocks)
      : null
    return {
      seoTitle:       data.seoTitle ?? null,
      seoDescription: data.seoDescription ?? null,
      h1:             data.h1 ?? null,
      introHtml,
      featured:       (data.featured ?? []).filter(f => f?.handle).map(f => ({ handle: f.handle, blurb: f.blurb ?? null })),
      faqs:           (data.faqs ?? []).filter(f => f?.question && f?.answer),
    }
  } catch (err) {
    console.error('[sanity] getCollectionsHub error:', err)
    return null
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
  "heroLqip": heroImage.asset->metadata.lqip,
  "heroWidth": heroImage.asset->metadata.dimensions.width,
  "heroHeight": heroImage.asset->metadata.dimensions.height,
  "author": author->{ name, "slug": slug.current, bio, "avatarUrl": avatar.asset->url, role, socialLinks },
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
  tag?: string
} = {}): Promise<{ posts: BlogPostCard[]; total: number }> {
  if (!projectId) return { posts: [], total: 0 }

  const page = opts.page ?? 1
  const perPage = opts.perPage ?? 12
  const start = (page - 1) * perPage
  const end = start + perPage

  const cacheKey = `posts:${page}:${perPage}:${opts.category ?? ''}:${opts.featured ?? ''}:${opts.authorSlug ?? ''}:${opts.tag ?? ''}`
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
    if (opts.tag) {
      filter += ` && $tag in tags`
      params.tag = opts.tag
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

// ─── Reverse lookup: posts → product ─────────────────────────────────────────
// Posts embed products as handle strings (blogProductEmbed.productHandle), so a
// product can find the posts that feature it without any Sanity reference. These
// power the inbound links: the PDP "From the Notebook" section and the
// per-collection notebook rail. Cards carry readingTime 0 (skips the min-read
// chip) since we don't fetch body text here.

export async function getNotebookPostsForProduct(handle: string, limit = 3): Promise<BlogPostCard[]> {
  if (!projectId || !handle) return []

  const cacheKey = `notebook-for-product:${handle}:${limit}`
  const cached = getCachedBlog<BlogPostCard[]>(cacheKey, BLOG_CACHE_TTL)
  if (cached) return cached

  try {
    const client = getClient()
    if (!client) return []
    const posts = await client.fetch<Omit<BlogPostCard, 'readingTime'>[]>(
      `*[_type == "blogPost" && status == "published"
        && count(body[_type == "blogProductEmbed" && productHandle == $handle]) > 0]
        | order(publishedAt desc) [0...$limit] { ${BLOG_POST_CARD_PROJECTION} }`,
      { handle, limit },
    )
    const result: BlogPostCard[] = (posts ?? []).map((p) => ({ ...p, readingTime: 0 }))
    setCachedBlog(cacheKey, result)
    return result
  } catch (err) {
    console.error('[sanity] getNotebookPostsForProduct error:', err)
    return []
  }
}

export async function getNotebookPostsForProductHandles(handles: string[], limit = 4): Promise<BlogPostCard[]> {
  if (!projectId || !handles?.length) return []

  const cacheKey = `notebook-for-handles:${handles.slice().sort().join(',')}:${limit}`
  const cached = getCachedBlog<BlogPostCard[]>(cacheKey, BLOG_CACHE_TTL)
  if (cached) return cached

  try {
    const client = getClient()
    if (!client) return []
    const posts = await client.fetch<Omit<BlogPostCard, 'readingTime'>[]>(
      `*[_type == "blogPost" && status == "published"
        && count(body[_type == "blogProductEmbed" && productHandle in $handles]) > 0]
        | order(publishedAt desc) [0...$limit] { ${BLOG_POST_CARD_PROJECTION} }`,
      { handles, limit },
    )
    const result: BlogPostCard[] = (posts ?? []).map((p) => ({ ...p, readingTime: 0 }))
    setCachedBlog(cacheKey, result)
    return result
  } catch (err) {
    console.error('[sanity] getNotebookPostsForProductHandles error:', err)
    return []
  }
}

// Fallback for the PDP Related Guides rail: the latest published posts that
// embed ANY product sharing this product's type (productTypeDial), excluding
// the current product. Powers the reverse product -> guide link for products
// that no post features directly yet. Mirrors getNotebookPostsForProductHandles
// but resolves the sibling handle set inline by type. readingTime 0 (no body
// fetched) skips the min-read chip.
export async function getNotebookPostsForProductType(
  productType: string,
  excludeHandle: string,
  limit = 3,
): Promise<BlogPostCard[]> {
  if (!projectId || !productType) return []

  const cacheKey = `notebook-for-type:${productType}:${excludeHandle}:${limit}`
  const cached = getCachedBlog<BlogPostCard[]>(cacheKey, BLOG_CACHE_TTL)
  if (cached) return cached

  try {
    const client = getClient()
    if (!client) return []
    const posts = await client.fetch<Omit<BlogPostCard, 'readingTime'>[]>(
      `*[_type == "blogPost" && status == "published"
        && count(body[_type == "blogProductEmbed" && productHandle in
          *[_type == "productPage" && productTypeDial == $type && shopifyHandle != $handle].shopifyHandle
        ]) > 0]
        | order(publishedAt desc) [0...$limit] { ${BLOG_POST_CARD_PROJECTION} }`,
      { type: productType, handle: excludeHandle, limit },
    )
    const result: BlogPostCard[] = (posts ?? []).map((p) => ({ ...p, readingTime: 0 }))
    setCachedBlog(cacheKey, result)
    return result
  } catch (err) {
    console.error('[sanity] getNotebookPostsForProductType error:', err)
    return []
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
            "image": image{
              "url": asset->url, alt,
              "lqip": asset->metadata.lqip,
              "width": asset->metadata.dimensions.width,
              "height": asset->metadata.dimensions.height
            },
            "secondImage": secondImage{
              "url": asset->url,
              "lqip": asset->metadata.lqip,
              "width": asset->metadata.dimensions.width,
              "height": asset->metadata.dimensions.height
            }
          }
        },
        seoTitle, seoDescription, noIndex,
        "ogImageUrl": ogImage.asset->url,
        tags,
        "relatedPosts": relatedPosts[]->{
          ${BLOG_POST_CARD_PROJECTION}
        },
        "autoRelated": *[_type == "blogPost" && status == "published" && category._ref == ^.category._ref && _id != ^._id] | order(publishedAt desc) [0...6] {
          ${BLOG_POST_CARD_PROJECTION}
        },
        "prevPost": *[_type == "blogPost" && status == "published" && publishedAt < ^.publishedAt] | order(publishedAt desc) [0] {
          title, "slug": slug.current,
          "heroImageUrl": heroImage.asset->url,
          "heroLqip": heroImage.asset->metadata.lqip,
          "category": category->{ name, "slug": slug.current, color }
        },
        "nextPost": *[_type == "blogPost" && status == "published" && publishedAt > ^.publishedAt] | order(publishedAt asc) [0] {
          title, "slug": slug.current,
          "heroImageUrl": heroImage.asset->url,
          "heroLqip": heroImage.asset->metadata.lqip,
          "category": category->{ name, "slug": slug.current, color }
        },
        "extras": *[_type == "blogPostExtras" && post._ref == ^._id][0]{
          deck,
          sources[]{ label, url },
          reviewedNote,
          seriesOrder,
          "series": series->{
            title, "slug": slug.current, kicker,
            "coverImageUrl": coverImage.asset->url,
            "postCount": count(posts)
          }
        }
      }`,
      { slug },
    )

    if (!raw) return null

    const readingTime = calculateReadingTime(raw.body ?? [])
    // Manual related picks first, topped up with same-category latest posts so
    // every post shows three. Related cards skip body fetch (readingTime 0
    // hides the "min read" chip).
    const manual = (raw.relatedPosts ?? []) as any[]
    const seen = new Set<string>([raw._id, ...manual.map((rp) => rp._id)])
    const topUp = ((raw.autoRelated ?? []) as any[]).filter((rp) => {
      if (seen.has(rp._id)) return false
      seen.add(rp._id)
      return true
    })
    const relatedPosts = [...manual, ...topUp].slice(0, 3).map((rp: any) => ({
      ...rp,
      readingTime: 0, // don't fetch body for related posts
    }))

    const { autoRelated: _autoRelated, ...rest } = raw
    const post: BlogPost = { ...rest, readingTime, relatedPosts }
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

// ─── Notebook redesign — additive loaders ────────────────────────────────────
// All of these fall back to null/[] when the additive docs don't exist, so the
// notebook renders unchanged until content is seeded.

export async function getNotebookSettings(): Promise<NotebookSettings | null> {
  if (!projectId) return null

  const cacheKey = 'notebookSettings'
  const cached = getCachedBlog<NotebookSettings>(cacheKey, BLOG_CAT_CACHE_TTL)
  if (cached) return cached

  try {
    const client = getClient()
    if (!client) return null
    const data = await client.fetch<NotebookSettings | null>(
      `*[_id == "singleton.notebookSettings"][0]{
        kicker,
        "mastheadImageUrl": mastheadImage.asset->url,
        mastheadImageAlt,
        newsletterHeading, newsletterBody, newsletterButtonLabel
      }`,
    )
    setCachedBlog(cacheKey, data ?? null)
    return data ?? null
  } catch (err) {
    console.error('[sanity] getNotebookSettings error:', err)
    return null
  }
}

export async function getBlogCategoryExtras(slug: string): Promise<BlogCategoryExtras | null> {
  if (!projectId) return null

  const cacheKey = `categoryExtras:${slug}`
  const cached = getCachedBlog<BlogCategoryExtras>(cacheKey, BLOG_CAT_CACHE_TTL)
  if (cached) return cached

  try {
    const client = getClient()
    if (!client) return null
    const data = await client.fetch<BlogCategoryExtras | null>(
      `*[_type == "blogCategoryExtras" && category->slug.current == $slug][0]{
        "headerImageUrl": headerImage.asset->url,
        headerImageAlt,
        "headerLqip": headerImage.asset->metadata.lqip,
        intro, accent
      }`,
      { slug },
    )
    setCachedBlog(cacheKey, data ?? null)
    return data ?? null
  } catch (err) {
    console.error('[sanity] getBlogCategoryExtras error:', err)
    return null
  }
}

const BLOG_SERIES_PROJECTION = `
  title, "slug": slug.current, kicker, description,
  "coverImageUrl": coverImage.asset->url,
  coverImageAlt,
  "coverLqip": coverImage.asset->metadata.lqip,
  "posts": posts[]->{ ${BLOG_POST_CARD_PROJECTION}, status }
`

export async function getBlogSeries(slug: string): Promise<BlogSeries | null> {
  if (!projectId) return null

  const cacheKey = `series:${slug}`
  const cached = getCachedBlog<BlogSeries>(cacheKey, BLOG_CACHE_TTL)
  if (cached) return cached

  try {
    const client = getClient()
    if (!client) return null
    const raw = await client.fetch<any>(
      `*[_type == "blogSeries" && slug.current == $slug][0]{ ${BLOG_SERIES_PROJECTION} }`,
      { slug },
    )
    if (!raw) return null
    const series: BlogSeries = {
      ...raw,
      posts: (raw.posts ?? [])
        .filter((p: any) => p && p.status === 'published')
        .map(({ status: _s, ...p }: any) => ({ ...p, readingTime: 0 })),
    }
    setCachedBlog(cacheKey, series)
    return series
  } catch (err) {
    console.error('[sanity] getBlogSeries error:', err)
    return null
  }
}

export async function getAllBlogSeries(): Promise<BlogSeries[]> {
  if (!projectId) return []

  const cacheKey = 'allSeries'
  const cached = getCachedBlog<BlogSeries[]>(cacheKey, BLOG_CAT_CACHE_TTL)
  if (cached) return cached

  try {
    const client = getClient()
    if (!client) return []
    const raw = await client.fetch<any[]>(
      `*[_type == "blogSeries" && count(posts) > 0] | order(_createdAt desc) { ${BLOG_SERIES_PROJECTION} }`,
    )
    const series: BlogSeries[] = (raw ?? []).map((s: any) => ({
      ...s,
      posts: (s.posts ?? [])
        .filter((p: any) => p && p.status === 'published')
        .map(({ status: _s, ...p }: any) => ({ ...p, readingTime: 0 })),
    }))
    setCachedBlog(cacheKey, series)
    return series
  } catch (err) {
    console.error('[sanity] getAllBlogSeries error:', err)
    return []
  }
}

export async function getGlossaryTerms(): Promise<GlossaryTerm[]> {
  if (!projectId) return []

  const cacheKey = 'glossaryTerms'
  const cached = getCachedBlog<GlossaryTerm[]>(cacheKey, BLOG_CAT_CACHE_TTL)
  if (cached) return cached

  try {
    const client = getClient()
    if (!client) return []
    const data = await client.fetch<GlossaryTerm[]>(
      `*[_type == "blogGlossaryTerm"] | order(term asc) {
        term, "slug": slug.current, definition, collectionHandle,
        "relatedPost": relatedPost->{ title, "slug": slug.current },
        "seeAlso": seeAlso[]->{ term, "slug": slug.current }
      }`,
    )
    if (data) setCachedBlog(cacheKey, data)
    return data ?? []
  } catch (err) {
    console.error('[sanity] getGlossaryTerms error:', err)
    return []
  }
}

/**
 * Notebook search — GROQ match over title/excerpt/tags. The corpus is small
 * (one post per day), so field-level match beats standing up a search index;
 * body text is intentionally excluded to keep results precise.
 */
export async function searchBlogPosts(q: string, limit = 24): Promise<BlogPostCard[]> {
  if (!projectId) return []
  const query = q.trim()
  if (!query) return []

  try {
    const client = getClient()
    if (!client) return []
    const rawPosts = await client.fetch<any[]>(
      `*[_type == "blogPost" && status == "published" && (
        title match $q || excerpt match $q || $plain in tags
      )] | order(publishedAt desc) [0...${limit}] { ${BLOG_POST_CARD_PROJECTION} }`,
      { q: `${query}*`, plain: query.toLowerCase() },
    )
    return (rawPosts ?? []).map((p: any) => ({ ...p, readingTime: 0 }))
  } catch (err) {
    console.error('[sanity] searchBlogPosts error:', err)
    return []
  }
}

export async function getBlogPostsForSitemap(): Promise<{ slug: string; publishedAt: string; _updatedAt: string; title?: string; description?: string }[]> {
  if (!projectId) return []
  try {
    const client = getClient()
    if (!client) return []
    // Excluding noIndex:true posts here matches the per-post meta robots
    // directive and prevents Search Console "Submitted URL marked noindex"
    // warnings from a sitemap-listed but noindex'd page.
    return await client.fetch(
      `*[_type == "blogPost" && status == "published" && noIndex != true] | order(publishedAt desc) {
        "slug": slug.current, publishedAt, _updatedAt, title,
        "description": coalesce(seoDescription, excerpt)
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
  // Catch BOTH cases: rails correctly targeted to homepage, AND rails for this
  // deal whose ref ended up in homepage sections regardless of target (a legacy
  // publish-flow bug could leak PDP rails into homepage sections — defensive
  // sweep here means rotator cleans up either way).
  const homepageTargeted = await getRailsByDealId(dealId, { target: 'homepage', status: 'live' })
  const allLiveForDeal   = await getRailsByDealId(dealId, { status: 'live' })
  const homepageRefIds   = await writeClient.fetch<string[]>(
    `*[_id == "singleton.homepage"][0].sections[defined(_ref)]._ref`,
  ).catch(() => [] as string[])
  const homepageRefSet   = new Set(homepageRefIds)
  const leaked = allLiveForDeal.filter(r => homepageRefSet.has(r._id) && !homepageTargeted.find(h => h._id === r._id))

  const toArchive = [...homepageTargeted, ...leaked]
  if (!toArchive.length) return { archived: [] }
  const archived: string[] = []
  for (const r of toArchive) {
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

export async function getProductHandlesForSitemap(): Promise<{ handle: string; _updatedAt: string; title?: string }[]> {
  if (!projectId) return []
  try {
    const client = getClient()
    if (!client) return []
    // WS2c — exclude draft-stage import stubs (opt-out: unset/false is
    // visible, so the existing live catalog needs no backfill).
    return await client.fetch(
      `*[_type == "productPage" && defined(shopifyHandle) && (!defined(hiddenUntilLive) || hiddenUntilLive != true)] | order(title asc) {
        "handle": shopifyHandle, _updatedAt, title
      }`,
    )
  } catch (err) {
    console.error('[sanity] getProductHandlesForSitemap error:', err)
    return []
  }
}

// ─── Home Config (discovery rebuild) ─────────────────────────────────────────
// Singleton: singleton.homeConfig
// 5-minute TTL so a variant flip propagates quickly without hammering Sanity.

const HOME_CONFIG_GROQ = `
  *[_id == "singleton.homeConfig"][0]{
    activeVariant,
    welcomeBackEnabled,
    emmaCopyOverrides,
    analyticsLabel
  }
`

export async function getHomeConfig(): Promise<HomeConfig | null> {
  if (!projectId) return null
  return cached('sanity:home-config', 300, async () => {
    try {
      const client = getClient()
      if (!client) return null
      const raw = await client.fetch<Partial<HomeConfig> | null>(HOME_CONFIG_GROQ)
      if (!raw) return null
      return {
        activeVariant:      raw.activeVariant      ?? 'off',
        welcomeBackEnabled: raw.welcomeBackEnabled  ?? true,
        emmaCopyOverrides:  raw.emmaCopyOverrides   ?? {},
        analyticsLabel:     raw.analyticsLabel      ?? '',
      }
    } catch (err) {
      console.error('[sanity] getHomeConfig error:', err)
      return null
    }
  })
}
