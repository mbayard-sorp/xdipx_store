/**
 * Instagram publisher, live via the Instagram Graph API.
 *
 * Both media kinds use the same three-step container flow:
 *   1. POST /{IG_BUSINESS_ACCOUNT_ID}/media
 *        image: { image_url, caption }
 *        video: { media_type: 'REELS', video_url, caption, cover_url? }
 *      -> { id: containerId }.  The media URL must be publicly reachable
 *      (Vercel Blob qualifies) and images must be JPEG.
 *   2. Poll GET /{containerId}?fields=status_code until FINISHED. Images are
 *      usually FINISHED on the first poll; Reels ingest takes longer.
 *   3. POST /{IG_BUSINESS_ACCOUNT_ID}/media_publish { creation_id }
 *      -> { id: mediaId } = externalPostId.
 *
 * Auth: IG_GRAPH_ACCESS_TOKEN (long-lived, 60 days, generated in the Meta App
 * Dashboard under Instagram > API setup with Instagram business login) and
 * IG_BUSINESS_ACCOUNT_ID (the `user_id` from GET /me?fields=user_id,username).
 * Tokens expire silently, so code 190 is surfaced as a distinct, actionable
 * error rather than a generic failure.
 *
 * Docs: https://developers.facebook.com/docs/instagram-platform/content-publishing
 */

import type { SocialPublisher, PublishInput, PublishResult } from './types'

const DEFAULT_API_VERSION = 'v23.0'
/** IG caption ceiling. Drafts are far shorter; this is a guard, not a feature. */
const CAPTION_MAX = 2200
/**
 * IG accessibility-caption (alt_text) ceiling. The Graph API rejects alt_text
 * over 1000 characters, so a long brief is truncated rather than failing the
 * whole publish over an additive field.
 */
const ALT_TEXT_MAX = 1000
/** Container ingest polling. Images finish immediately; Reels take longer. */
const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS = 120_000
/** Instagram carousels hold 2-10 slides. */
const CAROUSEL_MIN_ITEMS = 2
const CAROUSEL_MAX_ITEMS = 10

function apiBase(): string {
  const version = process.env['IG_GRAPH_API_VERSION']?.trim() || DEFAULT_API_VERSION
  return `https://graph.instagram.com/${version}`
}

export interface MetaError {
  message?: string
  code?: number
  error_subcode?: number
}

/**
 * Meta returns 200-with-error often enough that status alone is not a
 * verdict. Exported so other Graph API callers on this account (the removal
 * watcher's `getInstagramMediaState`, the engagement capture in
 * `social-engagement.server.ts`) share one request/error convention instead
 * of each reinventing it.
 */
export async function igRequest(
  path: string,
  init: { method: 'GET' | 'POST'; params: Record<string, string>; token: string },
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: MetaError }> {
  const url = new URL(`${apiBase()}${path}`)
  const body = new URLSearchParams({ ...init.params, access_token: init.token })

  let res: Response
  try {
    res = init.method === 'GET'
      ? await fetch(`${url.toString()}?${body.toString()}`)
      : await fetch(url.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        })
  } catch (err) {
    return { ok: false, error: { message: `Network error: ${(err as Error).message}` } }
  }

  let json: Record<string, unknown>
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    return { ok: false, error: { message: `Non-JSON response (HTTP ${res.status})` } }
  }

  if (json['error']) return { ok: false, error: json['error'] as MetaError }
  if (!res.ok) return { ok: false, error: { message: `HTTP ${res.status}` } }
  return { ok: true, data: json }
}

/** Token expiry is the predictable failure here, so name it precisely. */
export function describeInstagramApiError(error: MetaError): string {
  const base = error.message ?? 'Unknown Instagram API error'
  if (error.code === 190) {
    return `${base}. IG_GRAPH_ACCESS_TOKEN is expired or revoked. Regenerate it in the Meta App Dashboard (Instagram > API setup with Instagram business login) and update the Vercel env var.`
  }
  return base
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Instagram product tagging (#3744) — REMOVED, ticket #10732, policy not a
 * bug. This used to call `/{igId}/available_catalog_product_search` to
 * resolve a Shopify handle to a taggable Meta catalog product id. That edge
 * does not exist: the real one is `GET /{ig-user-id}/catalog_product_search`,
 * which requires a `catalog_id` this store has never had. Even corrected, it
 * needs an approved Instagram Shop in Business Manager, a product catalog,
 * and `instagram_shopping_tag_products` + `catalog_management` with a
 * verified business — none of which this account has ever set up. And none
 * of it is approvable: Meta's commerce policy prohibits promoting the
 * buying, selling, or trading of adult products across Shops on Facebook and
 * Instagram (facebook.com/policies_center/commerce/adult_products,
 * help.instagram.com/1627591223954487). A sexual-wellness catalog cannot
 * pass Shop review, so this call could never succeed regardless of how the
 * edge name or scopes were fixed. It shipped a malformed call from day one
 * (evidence: cron_runs.result on the 2026-09-22 04:00 UTC tick, IG row 293,
 * "Tried accessing nonexisting field (available_catalog_product_search)"),
 * which the #3744 degrade path swallowed into every publish, leaking a raw
 * Graph error into the run log on every single post. Untagged publishing was
 * always the actual outcome; this removal just stops attempting and logging
 * the impossible call. Do not re-add product tagging without an explicit
 * owner decision that a real, policy-compliant path exists.
 *
 * `PublishInput.productTagHandle` (`./types.ts`) is intentionally left in
 * place for callers to keep passing — `resolvePostProductHandle`'s other
 * callers (the gate stamp in `social-publish-job.server.ts`,
 * `admin.socials.queue.tsx`) still want the resolved handle for reasons
 * unrelated to tagging, and this adapter simply never reads the field now.
 */

/** Create one media container; returns its id or an error detail. */
async function createContainer(
  igId: string,
  params: Record<string, string>,
  token: string,
): Promise<{ ok: true; id: string } | { ok: false; detail: string }> {
  const created = await igRequest(`/${igId}/media`, { method: 'POST', params, token })
  if (!created.ok) return { ok: false, detail: describeInstagramApiError(created.error) }
  const id = String(created.data['id'] ?? '')
  if (!id) return { ok: false, detail: 'Instagram returned no container id' }
  return { ok: true, id }
}

/**
 * Poll a container to FINISHED. ERROR/EXPIRED and the ingest timeout fail
 * terminally — the container stays valid for 24h, so the id is in the message.
 */
async function pollUntilFinished(
  containerId: string,
  token: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  for (;;) {
    const status = await igRequest(`/${containerId}`, {
      method: 'GET',
      params: { fields: 'status_code' },
      token,
    })
    if (!status.ok) return { ok: false, detail: describeInstagramApiError(status.error) }

    const code = String(status.data['status_code'] ?? '')
    if (code === 'FINISHED') return { ok: true }
    if (code === 'ERROR' || code === 'EXPIRED') {
      return { ok: false, detail: `Instagram rejected the media (status ${code}). Check the media URL is public and, for images, JPEG.` }
    }
    if (Date.now() >= deadline) {
      return {
        ok: false,
        detail: `Instagram is still processing after ${POLL_TIMEOUT_MS / 1000}s (container ${containerId}, valid 24h). Retry the post shortly.`,
      }
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

/** Publish a finished container; returns the media id (externalPostId). */
async function publishContainer(
  igId: string,
  creationId: string,
  token: string,
): Promise<{ ok: true; id: string } | { ok: false; detail: string }> {
  const published = await igRequest(`/${igId}/media_publish`, {
    method: 'POST',
    params: { creation_id: creationId },
    token,
  })
  if (!published.ok) return { ok: false, detail: describeInstagramApiError(published.error) }
  const id = String(published.data['id'] ?? '')
  if (!id) return { ok: false, detail: 'Instagram published but returned no media id' }
  return { ok: true, id }
}

export const instagramPublisher: SocialPublisher = {
  platform: 'instagram',

  configured(): boolean {
    return !!process.env['IG_GRAPH_ACCESS_TOKEN']?.trim() && !!process.env['IG_BUSINESS_ACCOUNT_ID']?.trim()
  },

  async publish(input: PublishInput): Promise<PublishResult> {
    const token = process.env['IG_GRAPH_ACCESS_TOKEN']?.trim()
    const igId = process.env['IG_BUSINESS_ACCOUNT_ID']?.trim()
    if (!token || !igId) return { ok: false, reason: 'not_configured' }

    const caption = input.caption.slice(0, CAPTION_MAX)
    // Accessibility description (social_posts.alt_text, migration 085).
    // Verified 2026-08-22 against developers.facebook.com/docs/instagram-platform/
    // instagram-graph-api/reference/ig-user/media: `alt_text` is "Alternative
    // text, up to 1000 character, for an image. Only supported on a single
    // image or image media in a carousel." Capped here to that limit. Reels
    // have no alt_text field, so it is simply not attached there. Additive:
    // an absent value publishes exactly as before.
    const altText = input.altText?.trim().slice(0, ALT_TEXT_MAX) || undefined

    // Carousel: an item container per slide (image_url + is_carousel_item, no
    // caption), each polled to FINISHED, then one parent CAROUSEL container
    // (media_type=CAROUSEL, children=comma-joined ids, caption) published as a
    // single post. Any item that ERRORs fails the whole post terminally.
    if (input.media.kind === 'carousel') {
      const urls = input.media.imageUrls.slice(0, CAROUSEL_MAX_ITEMS)
      if (urls.length < CAROUSEL_MIN_ITEMS) {
        return {
          ok: false,
          reason: 'error',
          detail: `An Instagram carousel needs ${CAROUSEL_MIN_ITEMS}-${CAROUSEL_MAX_ITEMS} images; got ${input.media.imageUrls.length}.`,
        }
      }

      const childIds: string[] = []
      for (const [index, url] of urls.entries()) {
        const item = await createContainer(
          igId,
          {
            image_url: url,
            is_carousel_item: 'true',
            // Alt text on the first slide only; IG renders one accessibility
            // description for the whole carousel post.
            ...(index === 0 && altText ? { alt_text: altText } : {}),
          },
          token,
        )
        if (!item.ok) return { ok: false, reason: 'error', detail: item.detail }
        const ingested = await pollUntilFinished(item.id, token)
        if (!ingested.ok) return { ok: false, reason: 'error', detail: ingested.detail }
        childIds.push(item.id)
      }

      const parent = await createContainer(
        igId,
        { media_type: 'CAROUSEL', children: childIds.join(','), caption },
        token,
      )
      if (!parent.ok) return { ok: false, reason: 'error', detail: parent.detail }
      const ingested = await pollUntilFinished(parent.id, token)
      if (!ingested.ok) return { ok: false, reason: 'error', detail: ingested.detail }
      const published = await publishContainer(igId, parent.id, token)
      if (!published.ok) return { ok: false, reason: 'error', detail: published.detail }
      return { ok: true, externalPostId: published.id }
    }

    // Single image or Reels: one container, one poll, one publish.
    const params: Record<string, string> =
      input.media.kind === 'image'
        ? { image_url: input.media.imageUrl, caption, ...(altText ? { alt_text: altText } : {}) }
        : {
            media_type: 'REELS',
            video_url: input.media.videoUrl,
            caption,
            ...(input.media.posterUrl ? { cover_url: input.media.posterUrl } : {}),
          }

    const created = await createContainer(igId, params, token)
    if (!created.ok) return { ok: false, reason: 'error', detail: created.detail }
    const ingested = await pollUntilFinished(created.id, token)
    if (!ingested.ok) return { ok: false, reason: 'error', detail: ingested.detail }
    const published = await publishContainer(igId, created.id, token)
    if (!published.ok) return { ok: false, reason: 'error', detail: published.detail }
    return { ok: true, externalPostId: published.id }
  },
}

/**
 * Is a media object we published still on the account?
 *
 * Three answers, not two, and the third is the important one. A post can vanish
 * because Meta removed it (the signal the removal watcher exists to catch) or
 * because the token expired, the app is rate limited, or the network failed. On
 * an expired token EVERY lookup fails at once, and a watcher that read that as
 * "the whole feed was removed" would step volume down to nothing over an env
 * var. So an error that is not specifically "this object does not exist" comes
 * back as `unknown` and the caller decides.
 *
 * Code 100 with subcode 33 is Meta's "object does not exist, or you lack
 * permission to see it" and is what a deleted media returns. Permission loss
 * would produce it too, which is precisely why the caller must confirm the
 * token still works against another post before believing it.
 */
export async function getInstagramMediaState(
  mediaId: string,
): Promise<{ state: 'live' | 'gone' | 'unknown'; detail?: string }> {
  const token = process.env['IG_GRAPH_ACCESS_TOKEN']?.trim()
  if (!token) return { state: 'unknown', detail: 'Instagram keys are not configured' }

  const res = await igRequest(`/${mediaId}`, { method: 'GET', params: { fields: 'id' }, token })
  if (res.ok) return { state: 'live' }

  const { code, error_subcode: subcode } = res.error
  if (code === 100 && (subcode === 33 || subcode === undefined)) {
    return { state: 'gone', detail: describeInstagramApiError(res.error) }
  }
  return { state: 'unknown', detail: describeInstagramApiError(res.error) }
}

/**
 * Remaining API-published posts in the rolling 24h window (cap is 100).
 * Doubles as a cheap token liveness probe for the Social Studio.
 */
export async function getInstagramPublishingLimit(): Promise<
  { ok: true; quota: number; used: number } | { ok: false; detail: string }
> {
  const token = process.env['IG_GRAPH_ACCESS_TOKEN']?.trim()
  const igId = process.env['IG_BUSINESS_ACCOUNT_ID']?.trim()
  if (!token || !igId) return { ok: false, detail: 'Instagram keys are not configured' }

  const res = await igRequest(`/${igId}/content_publishing_limit`, {
    method: 'GET',
    params: { fields: 'config,quota_usage' },
    token,
  })
  if (!res.ok) return { ok: false, detail: describeInstagramApiError(res.error) }

  const row = (res.data['data'] as Array<Record<string, unknown>> | undefined)?.[0] ?? {}
  const config = (row['config'] as Record<string, unknown> | undefined) ?? {}
  return {
    ok: true,
    quota: Number(config['quota_total'] ?? 100),
    used: Number(row['quota_usage'] ?? 0),
  }
}
