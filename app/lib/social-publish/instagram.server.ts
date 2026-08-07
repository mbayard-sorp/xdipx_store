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
/** Container ingest polling. Images finish immediately; Reels take longer. */
const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS = 120_000

function apiBase(): string {
  const version = process.env['IG_GRAPH_API_VERSION']?.trim() || DEFAULT_API_VERSION
  return `https://graph.instagram.com/${version}`
}

interface MetaError {
  message?: string
  code?: number
  error_subcode?: number
}

/** Meta returns 200-with-error often enough that status alone is not a verdict. */
async function igRequest(
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
function describe(error: MetaError): string {
  const base = error.message ?? 'Unknown Instagram API error'
  if (error.code === 190) {
    return `${base}. IG_GRAPH_ACCESS_TOKEN is expired or revoked. Regenerate it in the Meta App Dashboard (Instagram > API setup with Instagram business login) and update the Vercel env var.`
  }
  return base
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

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
    const params: Record<string, string> =
      input.media.kind === 'image'
        ? { image_url: input.media.imageUrl, caption }
        : {
            media_type: 'REELS',
            video_url: input.media.videoUrl,
            caption,
            ...(input.media.posterUrl ? { cover_url: input.media.posterUrl } : {}),
          }

    // 1. Create the container.
    const created = await igRequest(`/${igId}/media`, { method: 'POST', params, token })
    if (!created.ok) return { ok: false, reason: 'error', detail: describe(created.error) }

    const containerId = String(created.data['id'] ?? '')
    if (!containerId) return { ok: false, reason: 'error', detail: 'Instagram returned no container id' }

    // 2. Wait for ingest. The container stays valid for 24h, so a timeout is
    //    recoverable by hand with the id in the message.
    const deadline = Date.now() + POLL_TIMEOUT_MS
    for (;;) {
      const status = await igRequest(`/${containerId}`, {
        method: 'GET',
        params: { fields: 'status_code' },
        token,
      })
      if (!status.ok) return { ok: false, reason: 'error', detail: describe(status.error) }

      const code = String(status.data['status_code'] ?? '')
      if (code === 'FINISHED') break
      if (code === 'ERROR' || code === 'EXPIRED') {
        return { ok: false, reason: 'error', detail: `Instagram rejected the media (status ${code}). Check the media URL is public and, for images, JPEG.` }
      }
      if (Date.now() >= deadline) {
        return {
          ok: false,
          reason: 'error',
          detail: `Instagram is still processing after ${POLL_TIMEOUT_MS / 1000}s (container ${containerId}, valid 24h). Retry the post shortly.`,
        }
      }
      await sleep(POLL_INTERVAL_MS)
    }

    // 3. Publish.
    const published = await igRequest(`/${igId}/media_publish`, {
      method: 'POST',
      params: { creation_id: containerId },
      token,
    })
    if (!published.ok) return { ok: false, reason: 'error', detail: describe(published.error) }

    const mediaId = String(published.data['id'] ?? '')
    if (!mediaId) return { ok: false, reason: 'error', detail: 'Instagram published but returned no media id' }
    return { ok: true, externalPostId: mediaId }
  },
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
  if (!res.ok) return { ok: false, detail: describe(res.error) }

  const row = (res.data['data'] as Array<Record<string, unknown>> | undefined)?.[0] ?? {}
  const config = (row['config'] as Record<string, unknown> | undefined) ?? {}
  return {
    ok: true,
    quota: Number(config['quota_total'] ?? 100),
    used: Number(row['quota_usage'] ?? 0),
  }
}
