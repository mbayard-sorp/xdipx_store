/**
 * Sanity reads and pure helpers for `adBridgePage` documents (Ad Studio v2
 * PR-D). The route in app/routes/bridge.$slug.tsx is a thin shell over this.
 *
 * Published documents only, unless the request carries the Sanity preview
 * cookie (drafts perspective). A page also has to have `live: true` to render
 * to the public; preview shows it either way so the team can look first.
 */

import { cached } from '~/lib/kv.server'
import { getClient } from '~/lib/sanity.server'
import { SITE_ORIGIN } from '~/lib/social-meta'

// Headline helpers are isomorphic (the route's meta export and component use
// them), so they live in ad-bridge-copy.ts; re-exported here for server callers.
export { splitHeadline, plainHeadline } from '~/lib/ad-bridge-copy'

export type AdLane = 'meta' | 'snap' | 'google'

/** CTA whitelist for buttons (no arrow glyph, per the build brief). */
export const BRIDGE_CTA_LABELS = ['Take a peek', 'Show me', 'Find your fit'] as const
const DEFAULT_CTA = 'Show me'

export interface AdBridgePage {
  slug: string
  headline: string
  claim: string
  buttonLabel: string
  productHandle: string
  imageUrl: string | null
  imageAlt: string
  imageWidth: number | null
  imageHeight: number | null
  utmCampaign: string
  lane: AdLane
  live: boolean
  healthFraming: boolean
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/
const HANDLE_RE = /^[a-z0-9][a-z0-9-]*$/

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug)
}

export function normalizeLane(v: unknown): AdLane {
  return v === 'snap' || v === 'google' ? v : 'meta'
}

export function normalizeButtonLabel(v: unknown): string {
  return typeof v === 'string' && (BRIDGE_CTA_LABELS as readonly string[]).includes(v) ? v : DEFAULT_CTA
}

/**
 * The one outbound link: the destination PDP on the main host with the paid
 * UTMs. No redirect, no shortener. Same URL for every visitor.
 */
export function buildBridgeDestination(
  page: Pick<AdBridgePage, 'productHandle' | 'lane' | 'utmCampaign' | 'slug'>,
  origin: string = SITE_ORIGIN,
): string {
  const qs = new URLSearchParams({
    utm_source: page.lane,
    utm_medium: 'paid',
    utm_campaign: page.utmCampaign,
    utm_content: page.slug,
  })
  return `${origin}/products/${page.productHandle}?${qs.toString()}`
}

/**
 * Pick the packshot for the fallback image. Media position 0 wins, except for
 * the Nalpac packaging-shot convention (scripts/sweep-packshot-primaries.ts):
 * a primary whose filename stem ends in the letter A after a digit
 * (77096A.jpg) while a sibling shares the stem with a later letter (77096B.jpg)
 * is the retail blister-pack shot, and the bridge uses the clean sibling until
 * the sweep reorders Shopify. Read-only; nothing is written to Shopify.
 */
export function pickBridgePackshot(images: { url: string }[]): string | null {
  const first = images[0]?.url
  if (!first) return null
  const stem = (u: string) => /\/([^/?]+?)([A-Z])\.[a-z0-9]+(?:\?|$)/i.exec(u)
  const m = stem(first)
  if (!m || m[2]!.toUpperCase() !== 'A' || !/\d$/.test(m[1]!)) return first
  const siblings = images
    .slice(1)
    .map(i => ({ url: i.url, m: stem(i.url) }))
    .filter(x => x.m && x.m[1] === m[1] && x.m[2]!.toUpperCase() > 'A')
    .sort((a, b) => a.m![2]!.toUpperCase().localeCompare(b.m![2]!.toUpperCase()))
  return siblings[0]?.url ?? first
}

interface RawBridge {
  slug?: string
  headline?: string
  claim?: string
  buttonLabel?: string
  productHandle?: string
  imageUrl?: string | null
  imageAlt?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  utmCampaign?: string
  lane?: string
  live?: boolean
  healthFraming?: boolean
}

/** Map a raw Sanity row to a page, or null when a required field is bad. */
export function normalizeBridgePage(raw: RawBridge | null | undefined): AdBridgePage | null {
  if (!raw) return null
  const slug = raw.slug ?? ''
  const handle = raw.productHandle ?? ''
  if (!isValidSlug(slug) || !HANDLE_RE.test(handle)) return null
  if (!raw.headline?.trim() || !raw.claim?.trim() || !raw.utmCampaign?.trim()) return null
  return {
    slug,
    headline: raw.headline.trim(),
    claim: raw.claim.trim(),
    buttonLabel: normalizeButtonLabel(raw.buttonLabel),
    productHandle: handle,
    imageUrl: raw.imageUrl ?? null,
    imageAlt: raw.imageAlt?.trim() ?? '',
    imageWidth: raw.imageWidth ?? null,
    imageHeight: raw.imageHeight ?? null,
    utmCampaign: raw.utmCampaign.trim(),
    lane: normalizeLane(raw.lane),
    live: raw.live === true,
    healthFraming: raw.healthFraming === true,
  }
}

const BRIDGE_GROQ = `*[_type == "adBridgePage" && slug.current == $slug] | order(_updatedAt desc)[0]{
  "slug": slug.current,
  headline, claim, buttonLabel, productHandle,
  "imageUrl": image.asset->url,
  "imageAlt": image.alt,
  "imageWidth": image.asset->metadata.dimensions.width,
  "imageHeight": image.asset->metadata.dimensions.height,
  utmCampaign, lane, live, healthFraming
}`

/**
 * Fetch one bridge page. `preview` reads the drafts perspective and skips the
 * cache; the public path caches for a minute (empties for 15 seconds so a
 * just-published page does not sit behind a stale 404).
 */
export async function getAdBridgePage(slug: string, preview = false): Promise<AdBridgePage | null> {
  if (!isValidSlug(slug)) return null
  const run = async (): Promise<AdBridgePage | null> => {
    try {
      const client = getClient(false, preview)
      if (!client) return null
      const raw = await client.fetch<RawBridge | null>(BRIDGE_GROQ, { slug })
      return normalizeBridgePage(raw)
    } catch (err) {
      console.error('[ad-bridge] getAdBridgePage error:', err)
      return null
    }
  }
  if (preview) return run()
  return cached(`sanity:ad-bridge:${slug}`, 60, run, 15)
}
