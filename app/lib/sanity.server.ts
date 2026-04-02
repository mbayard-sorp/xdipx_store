import { createClient } from '@sanity/client'
import type { HomepageSections, ContentBlock, AnnouncementMessage, SiteSettings } from '~/types/cms'

// Shared field projection reused by homepage + product page queries
const CONTENT_BLOCKS_PROJECTION = `
  _type, _key, active, order,
  // announcementBar
  messages, rotationIntervalMs, bgStyle,
  // promoBanner
  headline, subtext, ctaLabel, ctaLink, layout,
  "image": image{ asset, alt },
  // editorialTiles
  eyebrow, heading,
  "tiles": tiles[]{
    label, body, link, linkLabel, emoji,
    "image": image{ asset, alt }
  },
  // categoryGrid
  items[]{ label, link, emoji, "image": image{ asset, alt } },
  columns,
  // productCarousel
  shopifyTag, productLimit,
  // playTogetherBanner
  body, imagePosition,
  // brandLogoWall
  "logos": logos[]{ brand, emoji, link, "logo": logo{ asset, alt } },
  // testimonials
  "items": items[]{ quote, author, rating, verified },
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

// ─── Site Settings ────────────────────────────────────────────────────────────

let _settingsCache: { data: SiteSettings; ts: number } | null = null

export async function getSiteSettings(): Promise<SiteSettings | null> {
  if (!projectId) return null
  if (_settingsCache && Date.now() - _settingsCache.ts < 300_000) return _settingsCache.data
  try {
    const client = getClient()
    if (!client) return null
    const data = await client.fetch<SiteSettings>(
      `*[_id == "singleton.siteSettings"][0]{ _id, "logoUrl": logo.asset->url, "logoAlt": logo.alt, socialLinks[] }`
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
