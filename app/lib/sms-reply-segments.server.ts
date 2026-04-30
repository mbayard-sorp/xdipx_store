/**
 * Splits Emma's SMS reply into one or more deliverable segments. Each segment
 * is a Twilio <Message>: a body, plus an optional MMS image URL pulled from
 * the Shopify product the segment is pitching.
 *
 * Convention (taught to Emma in SMS_MODE):
 *   - Multi-product pitches separate products with a line containing only "---"
 *   - Each product segment includes its xdipx.com/products/{handle} URL
 *   - Single-product replies have no delimiter — single segment
 *   - Replies without any product handle (commit acks, age-gate, STOP/HELP)
 *     pass through as one plain-text segment with no image
 */
import { getProductsByHandles } from '~/lib/shopify.server'

export interface SmsSegment {
  body: string
  mediaUrl?: string
}

const HANDLE_RE = /xdipx\.com\/products\/([a-z0-9][a-z0-9-]*)/i
const SPLIT_RE = /\n\s*-{3,}\s*\n/g

/**
 * Split a reply into deliverable segments and attach product images.
 * Returns at least one segment (the original reply if no split applies).
 */
export async function splitSmsReplyForMms(reply: string): Promise<SmsSegment[]> {
  if (!reply) return [{ body: '' }]

  const rawSegments = reply.split(SPLIT_RE).map((s) => s.trim()).filter(Boolean)
  if (rawSegments.length === 0) return [{ body: reply.trim() }]

  // Collect every handle so we can do one batched Shopify fetch.
  const handles: string[] = []
  for (const seg of rawSegments) {
    const m = seg.match(HANDLE_RE)
    if (m && m[1]) handles.push(m[1])
  }

  let imageByHandle = new Map<string, string>()
  if (handles.length > 0) {
    try {
      const products = await getProductsByHandles(handles)
      for (const p of products) {
        const img = p.images[0]?.url
        if (img) imageByHandle.set(p.handle, img)
      }
    } catch (err) {
      // Image lookup is best-effort — fall back to text-only delivery.
      console.warn('[sms-reply-segments] product image lookup failed', err)
      imageByHandle = new Map()
    }
  }

  return rawSegments.map((body): SmsSegment => {
    const m = body.match(HANDLE_RE)
    const url = m && m[1] ? imageByHandle.get(m[1]) : undefined
    return url ? { body, mediaUrl: url } : { body }
  })
}
